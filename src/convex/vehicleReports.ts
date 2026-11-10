import { v } from "convex/values";
import { z } from "zod";
import { describeFailure, failureMetaSchema } from "../lib/reportFailure";
import { fixtureReportsVisible, isFixtureReport, rateLimitRetentionMs } from "../lib/reportCleanup";
import { shouldOfferRetry } from "../lib/reportFailure";
import { reportDataBasisNote, reportFlagSchema, reportStatusSchema, reviewStatusSchema, vehicleSchema } from "../lib/report";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";

/**
 * Lagringen för genererade Bilköpsrapporter.
 *
 * Allt som kommer ut härifrån är otrusted data: rapporten valideras mot
 * reportSchema i gränssnittet innan något visas, och en borttagen rapport
 * (review_status "removed") lämnas aldrig ut.
 */

const reportIdSchema = z.string().min(4).max(64).regex(/^[a-zA-Z0-9-]+$/);

/** Max antal poster som genomsöks när en klient letar efter en cachad variant. */
const cacheScanLimit = 25;

function parseReportId(value: string): string | null {
  const parsed = reportIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Testrapporter är publika bara i testläget (se src/lib/reportCleanup.ts). */
function fixtureVisible(): boolean {
  return fixtureReportsVisible(process.env.REPORT_PROVIDER, process.env.APP_ENV);
}

/**
 * Sätter den publika granskningsflaggan på rapportinnehållet (bara true/false)
 * och den fasta underlagsraden.
 *
 * Underlagsraden skrivs om även här, inte bara vid generering, så att rapporter
 * som skapades innan texten blev fast också visar rätt mening. Kundvyn visar
 * inga källhänvisningar, och en mening som hänvisar till "de listade källorna"
 * pekar då på något läsaren inte ser.
 */
function withPublicReviewStatus(report: unknown, reviewed: boolean): unknown {
  if (report && typeof report === "object") {
    return {
      ...(report as Record<string, unknown>),
      review_status: reviewed ? "reviewed" : "unreviewed",
      data_basis_note: reportDataBasisNote,
    };
  }
  return report;
}

/** Raderar rate-limit-nycklar som inte använts sedan `cutoff`. */
async function deleteExpiredUsageKeys(ctx: MutationCtx, cutoff: number): Promise<number> {
  const stale = await ctx.db
    .query("reportUsage")
    .withIndex("by_window_start", (q) => q.lt("windowStart", cutoff))
    .take(200);
  for (const row of stale) await ctx.db.delete(row._id);
  return stale.length;
}

/**
 * Den reaktiva läsningen för /rapport/:id. Statusen ändras medan pipelinen
 * arbetar, så prenumerationen driver laddningsvyns steg i realtid.
 */
export const getReport = query({
  args: { reportId: v.string() },
  handler: async (ctx, args) => {
    const reportId = parseReportId(args.reportId);
    if (!reportId) return null;
    const document = await ctx.db
      .query("vehicleReports")
      .withIndex("by_report_id", (q) => q.eq("reportId", reportId))
      .first();
    if (!document || document.reviewStatus === "removed") return null;
    /** En post vars fordonsuppgifter inte validerar lämnas aldrig ut. */
    if (!vehicleSchema.safeParse(document.vehicle).success) return null;
    /** Testkörningar är aldrig publika utan att testläget är påslaget. */
    if (isFixtureReport(document) && !fixtureVisible()) return null;

    const reviewed = document.reviewStatus === "reviewed";

    /**
     * Bara det som behövs för att visa rapporten lämnas ut: statusen, bilen,
     * innehållet och stegen som laddningsvyn visar. Ingen generation_meta, inga
     * token, kostnader, kvalitetsnotiser, okontrollerade url:er, flaggor,
     * granskningsinterna fält eller ip-härledd data. Granskningen sammanfattas
     * som en enda publik flagga: reviewed true/false.
     *
     * `retryable` är den enda upplysningen om en misslyckad körning: sant när ett
     * nytt försök med samma bil kan ge ett annat resultat, falskt när felet satt i
     * formatet eller i utebliven sökning. Den avslöjar inget om kostnader, token
     * eller leverantörer – bara om knappen "Försök igen" är värd att visa.
     */
    return {
      reportId: document.reportId,
      status: reportStatusSchema.catch("failed").parse(document.status),
      reviewed,
      retryable: shouldOfferRetry(document.failureReason),
      vehicle: document.vehicle,
      report: document.report ? withPublicReviewStatus(document.report, reviewed) : null,
      statusLog: Array.isArray(document.statusLog) ? document.statusLog : [],
    };
  },
});

/** Flaggning från en användare som läst rapporten. */
export const flagReport = mutation({
  args: { reportId: v.string(), kind: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    const reportId = parseReportId(args.reportId);
    if (!reportId) throw new Error("REPORT_NOT_FOUND");
    const document = await ctx.db
      .query("vehicleReports")
      .withIndex("by_report_id", (q) => q.eq("reportId", reportId))
      .first();
    if (!document || document.reviewStatus === "removed") throw new Error("REPORT_NOT_FOUND");

    const flag = reportFlagSchema.parse({ kind: args.kind, message: args.message });
    await ctx.db.insert("reportFlags", {
      reportId,
      kind: flag.kind,
      message: flag.message,
      createdAt: Date.now(),
      resolved: false,
    });
    return { ok: true as const };
  },
});

/* ------------------------------------------------------------------ *
 * Pipelinen (endast via internal: aldrig anropbart från klienten)
 * ------------------------------------------------------------------ */

/** Letar efter en tidigare färdig rapport för samma variant. */
export const findCachedReport = internalQuery({
  args: { cacheKey: v.string() },
  handler: async (ctx, args) => {
    const documents = await ctx.db
      .query("vehicleReports")
      .withIndex("by_cache_key", (q) => q.eq("cacheKey", args.cacheKey))
      .order("desc")
      .take(cacheScanLimit);
    const cached = documents.find((document) => document.status === "done" && document.reviewStatus !== "removed");
    if (!cached) return null;
    return {
      reportId: cached.reportId,
      status: cached.status,
      report: cached.report ?? null,
      generationMeta: cached.generationMeta ?? null,
      createdAt: cached.createdAt,
    };
  },
});

/** Skapar posten direkt, så att gränssnittet kan visa verkliga steg från första sekunden. */
export const createReport = internalMutation({
  args: { reportId: v.string(), cacheKey: v.string(), vehicle: v.any() },
  handler: async (ctx, args) => {
    const at = Date.now();
    await ctx.db.insert("vehicleReports", {
      reportId: args.reportId,
      cacheKey: args.cacheKey,
      vehicle: args.vehicle,
      status: "resolving_variant",
      reviewStatus: "unreviewed",
      statusLog: [{ status: "resolving_variant", at }],
      createdAt: at,
      updatedAt: at,
    });
  },
});

/** Flyttar posten till nästa steg i pipelinen och loggar när det hände. */
export const setReportStatus = internalMutation({
  args: { reportId: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const status = reportStatusSchema.parse(args.status);
    const document = await ctx.db
      .query("vehicleReports")
      .withIndex("by_report_id", (q) => q.eq("reportId", args.reportId))
      .first();
    if (!document) throw new Error("REPORT_NOT_FOUND");
    const at = Date.now();
    await ctx.db.patch(document._id, {
      status,
      statusLog: [...document.statusLog, { status, at }],
      updatedAt: at,
    });
  },
});

/** Sparar den färdiga, validerade rapporten. En ogiltig rapport når aldrig hit. */
export const completeReport = internalMutation({
  args: { reportId: v.string(), report: v.any(), generationMeta: v.any(), status: v.string() },
  handler: async (ctx, args) => {
    const status = reportStatusSchema.parse(args.status);
    const document = await ctx.db
      .query("vehicleReports")
      .withIndex("by_report_id", (q) => q.eq("reportId", args.reportId))
      .first();
    if (!document) throw new Error("REPORT_NOT_FOUND");
    const at = Date.now();
    await ctx.db.patch(document._id, {
      status,
      report: args.report,
      generationMeta: args.generationMeta,
      reviewStatus: "unreviewed",
      failureReason: undefined,
      statusLog: [...document.statusLog, { status, at }],
      updatedAt: at,
    });
  },
});

/**
 * Markerar posten som misslyckad med en maskinläsbar orsak och ett fullständigt
 * felspår: kategori, HTTP-status, feltext, kvalitetskontrollernas anmärkningar,
 * antal försök, sökningar, token, kostnad och modellens råsvar (kortat).
 *
 * Anropas alltid med en orsak – en post får aldrig ligga kvar i ett arbetsläge.
 */
export const failReport = internalMutation({
  args: { reportId: v.string(), reason: v.string(), failure: v.optional(v.any()) },
  handler: async (ctx, args) => {
    const document = await ctx.db
      .query("vehicleReports")
      .withIndex("by_report_id", (q) => q.eq("reportId", args.reportId))
      .first();
    if (!document) return;
    const at = Date.now();
    await ctx.db.patch(document._id, {
      status: "failed",
      failureReason: args.reason,
      failure: args.failure,
      statusLog: [...document.statusLog, { status: "failed", at }],
      updatedAt: at,
    });
  },
});

/**
 * Vaktfunktionen: stänger poster som legat i ett arbetsläge för länge.
 *
 * Om en körning dör utan att hinna skriva något – processen avbryts, Convex
 * startar om funktionen, ett fel inträffar utanför all felhantering – skulle
 * posten annars stå kvar som "researching" för alltid och laddningsvyn aldrig
 * bli klar. Körs av cron och markerar allt som inte uppdaterats på `staleMs`
 * som misslyckat, med kategori "stale" och den tid som gått.
 */
export const sweepStaleReports = internalMutation({
  args: { staleMs: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const cutoff = now - args.staleMs;
    const activeStatuses = ["queued", "resolving_variant", "researching", "analyzing", "writing"];
    const stale: Array<{ reportId: string; status: string }> = [];

    for (const status of activeStatuses) {
      const documents = await ctx.db
        .query("vehicleReports")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(50);
      for (const document of documents) {
        if (document.updatedAt > cutoff) continue;
        const attempt = {
          attempt: 1,
          kind: "stale" as const,
          code: "STALE_TIMEOUT",
          http_status: null,
          message: `Posten stod kvar i statusen ${document.status} i ${Math.round((now - document.updatedAt) / 1000)} s utan att uppdateras.`,
          quality_issues: [],
          provider: null,
          model: null,
          searches: 0,
          input_tokens: null,
          output_tokens: null,
          cost_usd: 0,
          cost_sek: 0,
          duration_ms: Math.max(0, now - document.createdAt),
          raw_response: "",
          raw_response_truncated: false,
          at: new Date(now).toISOString(),
        };
        const failure = failureMetaSchema.parse({
          kind: "stale",
          summary: describeFailure({ kind: "stale", attempts: [attempt] }),
          attempts: [attempt],
          attempt_count: 1,
          retried: false,
          searches_total: 0,
          input_tokens_total: null,
          output_tokens_total: null,
          cost_usd_total: 0,
          cost_sek_total: 0,
          duration_ms: attempt.duration_ms,
          provider: null,
          model: null,
          failed_at: attempt.at,
          model_notes: [],
        });

        await ctx.db.patch(document._id, {
          status: "failed",
          failureReason: "STALE_TIMEOUT",
          failure,
          statusLog: [...document.statusLog, { status: "failed", at: now }],
          updatedAt: now,
        });
        stale.push({ reportId: document.reportId, status: document.status });
      }
    }
    return { markedFailed: stale.length, reports: stale };
  },
});

/**
 * Rate limit per klient och globalt dygnstak.
 *
 * Kontrollen ligger i en enda mutation, så att Convexs transaktioner gör
 * samtidiga förfrågningar säkra: antingen får förfrågan plats eller inte.
 */
export const consumeReportQuota = internalMutation({
  args: { key: v.string(), day: v.string(), perHourLimit: v.number(), dailyCap: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const day = args.day;

    /* Rensa bort rate-limit-nycklar som inte använts på ett tag, så att inga
       ip-härledda värden ligger kvar efter sin livstid. Görs i samma mutation
       som kontrollen, i en begränsad sats. */
    await deleteExpiredUsageKeys(ctx, now - rateLimitRetentionMs);

    const daily = await ctx.db
      .query("reportDailyUsage")
      .withIndex("by_day", (q) => q.eq("day", day))
      .first();
    const usedToday = daily?.count ?? 0;
    if (usedToday >= args.dailyCap) return { allowed: false as const, reason: "DAILY_CAP_REACHED" as const, usedToday };

    const usage = await ctx.db
      .query("reportUsage")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    const windowExpired = !usage || now - usage.windowStart >= 60 * 60 * 1000;
    const countInWindow = windowExpired ? 0 : usage.count;
    if (countInWindow >= args.perHourLimit) return { allowed: false as const, reason: "RATE_LIMITED" as const, usedToday };

    if (usage) await ctx.db.patch(usage._id, { windowStart: windowExpired ? now : usage.windowStart, count: countInWindow + 1 });
    else await ctx.db.insert("reportUsage", { key: args.key, windowStart: now, count: 1 });

    if (daily) await ctx.db.patch(daily._id, { count: daily.count + 1 });
    else await ctx.db.insert("reportDailyUsage", { day, count: 1 });

    return { allowed: true as const, reason: null, usedToday: usedToday + 1 };
  },
});
