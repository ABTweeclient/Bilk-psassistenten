/**
 * Registreringsnummeruppslag mot Vägtrafikregistret, via RegCheck
 * (registreringsnummerapi.se är samma API).
 *
 * Varför register och inte webbsökning: en sökning på en skylt landar ofta på
 * sidor som listar många bilar, och gav i test olika bilar för samma nummer.
 * Registret ger ett svar: märke, modell, årsmodell, motor, bränsle och
 * växellåda.
 *
 * Ekonomin styr utformningen:
 *  - Ett lyckat uppslag drar en kredit (2 kr). Därför cachas varje skylt i
 *    `vehicleLookups`: samma bil kostar bara en gång, oavsett antal rapporter.
 *  - Ett dygnstak (`REGNUMBER_DAILY_LOOKUP_CAP`, standard 20) hindrar att den
 *    publika knappen tömmer krediterna om någon trycker många gånger.
 *  - Saknas kontot, eller tar krediterna slut, kastas inget fel: svaret blir
 *    ett tomt förslag med en förklaring, och formuläret fylls i manuellt.
 *    Uppslaget är en genväg, aldrig ett krav för att kunna göra en rapport.
 *  - Den svenska testskylten SXM788 drar ingen kredit enligt RegChecks
 *    dokumentation och används för att verifiera flödet.
 */

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";
import {
  emptyVehicleSuggestion,
  gearboxFromText,
  isPassengerCar,
  isValidRegistrationNumber,
  normalizeRegistrationNumber,
  type VehicleSuggestion,
} from "../lib/vehicleLookup";

const lookupApiBase = "https://www.regcheck.org.uk/api/reg.asmx";
const creditsApiUrl = "https://www.regcheck.org.uk/ajax/getcredits.aspx";
const requestTimeoutMs = 15_000;
const defaultDailyCap = 20;
const defaultLowCreditThreshold = 10;

/** Användarnamnet för API-kontot. Saknas det är uppslaget avstängt. */
function apiUsername(): string | null {
  const username = process.env.REGNUMBER_API_USER?.trim();
  return username && username.length > 0 ? username : null;
}

function dailyCap(): number {
  const configured = Number(process.env.REGNUMBER_DAILY_LOOKUP_CAP);
  return Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : defaultDailyCap;
}

function lowCreditThreshold(): number {
  const configured = Number(process.env.REGNUMBER_LOW_CREDIT_THRESHOLD);
  return Number.isFinite(configured) && configured >= 0 ? Math.trunc(configured) : defaultLowCreditThreshold;
}

/** RegCheck lägger en del fält som { CurrentTextValue: "..." }, andra som sträng. */
function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "CurrentTextValue" in value) {
    const inner = (value as { CurrentTextValue?: unknown }).CurrentTextValue;
    return typeof inner === "string" ? inner.trim() : "";
  }
  return "";
}

function unescapeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

type RegCheckVehicle = Record<string, unknown>;

/** Läser JSON-delen ur RegChecks XML-svar. */
export function parseVehicleJson(xml: string): RegCheckVehicle | null {
  const match = /<vehicleJson>([\s\S]*?)<\/vehicleJson>/.exec(xml);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(unescapeXml(match[1]));
    return parsed && typeof parsed === "object" ? (parsed as RegCheckVehicle) : null;
  } catch {
    return null;
  }
}

/** Mappar registrets fält till formulärets förslag. */
export function toSuggestion(vehicle: RegCheckVehicle): VehicleSuggestion {
  const make = textValue(vehicle.CarMake);
  const model = textValue(vehicle.CarModel);
  const yearText = textValue(vehicle.RegistrationYear).replace(/[^\d]/g, "");
  const year = yearText.length === 4 ? Number(yearText) : null;
  const size = textValue(vehicle.EngineSize).replace(/\s*cm\b/i, " cm³");
  const fuel = textValue(vehicle.FuelType);
  return {
    ...emptyVehicleSuggestion,
    found: Boolean(make || model),
    make,
    model,
    year,
    engine: [size, fuel].filter(Boolean).join(" · "),
    gearbox: gearboxFromText(textValue(vehicle.Transmission)),
    confidence: "high",
    source: "Vägtrafikregistret",
    bodyStyle: textValue(vehicle.BodyStyle),
  };
}

/** Ett anrop med hårt tidsstopp, utan att kräva Node-runtime. */
async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Kreditsaldot i antal uppslag. null när det inte går att läsa. */
async function creditBalance(username: string): Promise<number | null> {
  try {
    const response = await fetchWithTimeout(`${creditsApiUrl}?username=${encodeURIComponent(username)}`);
    if (!response.ok) return null;
    const credits = Number((await response.text()).trim());
    return Number.isFinite(credits) ? Math.trunc(credits) : null;
  } catch {
    return null;
  }
}

/** Cachad skylt: ett betalt uppslag per bil. */
export const findCached = internalQuery({
  args: { registrationNumber: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("vehicleLookups")
      .withIndex("by_registration_number", (q) => q.eq("registrationNumber", args.registrationNumber))
      .first();
  },
});

export const saveLookup = internalMutation({
  args: {
    registrationNumber: v.string(),
    make: v.string(),
    model: v.string(),
    year: v.union(v.number(), v.null()),
    engine: v.string(),
    gearbox: v.string(),
    source: v.string(),
    bodyStyle: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("vehicleLookups")
      .withIndex("by_registration_number", (q) => q.eq("registrationNumber", args.registrationNumber))
      .first();
    if (existing) return;
    await ctx.db.insert("vehicleLookups", {
      registrationNumber: args.registrationNumber,
      make: args.make,
      model: args.model,
      ...(args.year === null ? {} : { year: args.year }),
      engine: args.engine,
      gearbox: args.gearbox,
      source: args.source,
      bodyStyle: args.bodyStyle,
      fetchedAt: Date.now(),
    });
  },
});

/** Tar bort en cachad skylt, till exempel när den visade sig vara fel fordonstyp. */
export const forgetLookup = internalMutation({
  args: { registrationNumber: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("vehicleLookups")
      .withIndex("by_registration_number", (q) =>
        q.eq("registrationNumber", normalizeRegistrationNumber(args.registrationNumber)),
      )
      .take(10);
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

/** Räknar betalda uppslag per dygn och säger nej över taket. */
export const consumeLookupQuota = internalMutation({
  args: { day: v.string(), cap: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("lookupUsage")
      .withIndex("by_day", (q) => q.eq("day", args.day))
      .first();
    if (!existing) {
      await ctx.db.insert("lookupUsage", { day: args.day, count: 1 });
      return { allowed: true, used: 1 };
    }
    if (existing.count >= args.cap) return { allowed: false, used: existing.count };
    await ctx.db.patch(existing._id, { count: existing.count + 1 });
    return { allowed: true, used: existing.count + 1 };
  },
});

export const suggestByRegistration = action({
  args: { registrationNumber: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ suggestion: VehicleSuggestion; cached: boolean; notice?: string }> => {
    const registrationNumber = normalizeRegistrationNumber(args.registrationNumber);
    if (!isValidRegistrationNumber(registrationNumber)) {
      throw new ConvexError({
        code: "INVALID_REGISTRATION",
        message: "Skriv ett svenskt registreringsnummer, till exempel ABC123.",
      });
    }

    /* Cachen först: en känd bil kostar ingenting och svarar direkt. */
    const cached = await ctx.runQuery(internal.vehicleLookup.findCached, { registrationNumber });
    if (cached) {
      /* Äldre poster saknar fordonsslag. De släpps igenom som förut, men en
         post som visar sig vara till exempel en motorcykel fyller inget. */
      if (!isPassengerCar(cached.bodyStyle ?? "")) {
        return {
          cached: true,
          suggestion: emptyVehicleSuggestion,
          notice: "Numret tillhör ingen personbil. Ange bilens uppgifter själv.",
        };
      }
      return {
        cached: true,
        suggestion: {
          ...emptyVehicleSuggestion,
          found: true,
          make: cached.make,
          model: cached.model,
          year: cached.year ?? null,
          engine: cached.engine,
          gearbox: cached.gearbox as VehicleSuggestion["gearbox"],
          confidence: "high",
          source: cached.source,
          bodyStyle: cached.bodyStyle ?? "",
        },
      };
    }

    const username = apiUsername();
    if (!username) {
      return {
        cached: false,
        suggestion: emptyVehicleSuggestion,
        notice: "Automatiskt uppslag är inte aktiverat. Fyll i uppgifterna själv.",
      };
    }

    const day = `lookup-${new Date().toISOString().slice(0, 10)}`;
    const quota = await ctx.runMutation(internal.vehicleLookup.consumeLookupQuota, { day, cap: dailyCap() });
    if (!quota.allowed) {
      return {
        cached: false,
        suggestion: emptyVehicleSuggestion,
        notice: "Dagens uppslag är slut. Fyll i uppgifterna själv.",
      };
    }

    let response: Response;
    try {
      const url = `${lookupApiBase}/CheckSweden?RegistrationNumber=${encodeURIComponent(registrationNumber)}&username=${encodeURIComponent(username)}`;
      response = await fetchWithTimeout(url, { headers: { accept: "application/xml" } });
    } catch {
      return {
        cached: false,
        suggestion: emptyVehicleSuggestion,
        notice: "Registret svarade inte. Fyll i uppgifterna själv.",
      };
    }

    /* RegCheck svarar 500 både för okänt konto och för slut på krediter. Ett
       saldo hos tjänsten skiljer fallen åt, så meddelandet blir begripligt. */
    if (!response.ok) {
      const credits = await creditBalance(username);
      return {
        cached: false,
        suggestion: emptyVehicleSuggestion,
        notice:
          credits !== null && credits <= 0
            ? "Uppslagskrediterna är slut. Fyll i uppgifterna själv."
            : "Uppslaget är inte tillgängligt just nu. Fyll i uppgifterna själv.",
      };
    }

    const suggestion = toSuggestion(parseVehicleJson(await response.text()) ?? {});
    if (!suggestion.found) {
      return {
        cached: false,
        suggestion: emptyVehicleSuggestion,
        notice: "Registret hittade ingen bil på numret. Kontrollera numret eller fyll i själv.",
      };
    }

    /* Registret svarar även för motorcyklar, mopeder och släp. De får inte
       fylla ett bilformulär, så de stoppas innan något cachas. */
    if (!isPassengerCar(suggestion.bodyStyle)) {
      return {
        cached: false,
        suggestion: emptyVehicleSuggestion,
        notice: `Numret tillhör ingen personbil (${suggestion.bodyStyle.toLowerCase()}). Ange bilens uppgifter själv.`,
      };
    }

    await ctx.runMutation(internal.vehicleLookup.saveLookup, {
      registrationNumber,
      make: suggestion.make,
      model: suggestion.model,
      year: suggestion.year,
      engine: suggestion.engine,
      gearbox: suggestion.gearbox,
      source: suggestion.source,
      bodyStyle: suggestion.bodyStyle,
    });

    return { suggestion, cached: false };
  },
});

/**
 * Kreditsaldot för /admin. Endast administratören får läsa det; knappen i
 * formuläret behöver det inte.
 */
export const creditStatus = action({
  args: {},
  handler: async (ctx): Promise<{ configured: boolean; credits: number | null; low: boolean; threshold: number }> => {
    const viewer = await ctx.runQuery(internal.adminAccess.viewerIsAdmin, {});
    if (!viewer.isAdmin) {
      throw new ConvexError({ code: "NOT_ADMIN", message: "Endast administratören kan se kreditsaldot." });
    }

    const username = apiUsername();
    const threshold = lowCreditThreshold();
    if (!username) return { configured: false, credits: null, low: false, threshold };

    const credits = await creditBalance(username);
    return { configured: true, credits, low: credits !== null && credits <= threshold, threshold };
  },
});
