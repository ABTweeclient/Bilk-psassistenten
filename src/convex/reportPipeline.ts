"use node";

/**
 * Den riktiga rapportgenereringen.
 *
 * Genereringen sker i två anrop, och det är själva poängen: sökningen ska vara
 * mätbar. Ett enda anrop där modellen själv fick bestämma om den skulle söka
 * kunde komma tillbaka med noll sökningar och en påhittad sammanfattning.
 *
 *  1. SÖK (steg 1): ett kort anrop med sökverktyget påslaget, med en prompt som
 *     uttryckligen kräver minst tre olika sökfrågor. Svaret är en text. Antalet
 *     sökningar och källänkarna läses ur leverantörens egen metadata.
 *  2. SKRIV (steg 2): ett anrop utan sökverktyg som bygger hela rapporten ur
 *     fynden och en numrerad källista (s1, s2 …). Källor, sökstatistik och
 *     täckning fylls i av koden ur steg 1 – aldrig av modellen.
 *
 * Flödet i `generateReport`:
 *
 *  1. All indata valideras med Zod (den är otrusted, även från vår egen klient)
 *     och städas från HTML. Misstänkta instruktioner i fritextfälten ändrar
 *     aldrig reglerna – de loggas bara i generation_meta.
 *  2. Cache-nyckeln normaliseras (make|model|year|engine|gearbox|drivetrain).
 *  3. Rate limit per ip (hashat) och ett globalt dygnstak kontrolleras.
 *  4. En post skapas direkt med status "resolving_variant", så att gränssnittet
 *     kan visa verkliga steg medan arbetet pågår.
 *  5. Modellnamnet kontrolleras mot leverantörens modellista innan något anrop
 *     görs. Ett namn som inte finns kostar annars både tid och pengar utan att
 *     kunna lyckas.
 *  6. `runTwoStepGeneration` kör de två stegen med hård tidsgräns per steg
 *     (90 s) och ett tak för hela körningen (RESEARCH_TIMEOUT_MS).
 *     - Gör steg 1 noll sökningar eller noll källänkar görs exakt ett (1) nytt
 *       försök med en mer tvingande formulering. Gör det också noll sökningar
 *       avbryts körningen med NO_RESEARCH, utan fler försök: skrivsteget skulle
 *       ändå inte ha något underlag. Ber modellens svar i stället om bilens
 *       uppgifter ("klistra in fordonsuppgifterna") avbryts körningen direkt
 *       med INPUT_NOT_DELIVERED: då saknades indata i anropet, och samma anrop
 *       skulle ge samma svar. Bilens JSON följer alltid med i båda stegen, och
 *       det meddelande som skickades sparas på varje försök.
 *     - Steg 2 får aldrig ett nytt försök vid tidsgräns eller leverantörsfel.
 *       Ett formatfel får däremot ett rättelseförsök, eftersom det bara kostar
 *       token och inga nya sökningar.
 *  7. Svaret tolkas som JSON, körs genom de programmatiska kvalitetskontrollerna
 *     och valideras mot reportSchema.
 *  8. Den validerade rapporten sparas med generation_meta (modell, antal
 *     sökningar, token, uppskattad kostnad i SEK, varaktighet och tid, token och
 *     kostnad per steg) och review_status "unreviewed".
 *
 * Misslyckas körningen sparas i stället ett fullständigt felspår på posten
 * (failure): kategori, HTTP-status och feltext utan nycklar, vilken
 * kvalitetskontroll som fällde svaret, varje försök med steg, sökningar, token
 * och kostnad, samt modellens råsvar kortat till 2000 tecken. Posten lämnas
 * aldrig kvar i ett arbetsläge – allt oväntat fångas här, och en vaktfunktion
 * stänger dessutom poster som legat still i mer än fem minuter.
 *
 * Nycklar läses bara här, server-side, och följer aldrig med till klienten.
 */

import { createHash, createHmac, randomUUID } from "node:crypto";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import {
  buildReportSearchPrompt,
  buildReportSystemPrompt,
  buildSearchUserMessage,
  looksLikeInputRequest,
  reportPromptVersion,
  reportSearchRetryMessage,
  reportWriteUserMessage,
} from "../lib/reportPrompt";
import {
  generationMetaSchema,
  reportCacheKey,
  reportRequestSchema,
  reportSchema,
  type GenerationStep,
  type GenerationStepMeta,
  type PurchaseTiming,
  type Report,
  type ReportStatus,
  type Source,
  type Vehicle,
} from "../lib/report";
import {
  describeFailure,
  failureMetaSchema,
  isRetryableFailure,
  truncateRawResponse,
  truncateRequestExcerpt,
  type FailureAttempt,
  type FailureKind,
  type FailureMeta,
} from "../lib/reportFailure";
import { estimateCostSek, estimateCostUsd, parseUsdToSek, type ProviderId } from "../lib/reportPricing";
import { applyQualityChecks, QualityCheckError, stripHtml } from "./reportQuality";
import {
  assertProviderModel,
  ProviderError,
  redactSecrets,
  resolveChunkDomain,
  resolveProvider,
  type GroundingChunk,
  type SearchRequest,
  type SearchResult,
  type WriteRequest,
  type WriteResult,
} from "./reportProviders";

/* ------------------------------------------------------------------ *
 * Konfiguration (miljövariabler med standardvärden)
 * ------------------------------------------------------------------ */

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** Högsta antal sökningar som prompten får be om. */
const maxSearches = () => envInt("MAX_SEARCHES", 12, 1, 60);
/**
 * Hård tidsgräns för hela körningen. Stegen har dessutom var sitt tak på 90 s,
 * så ett normalt flöde hinner aldrig hit – gränsen finns för det fall att båda
 * stegen drar ut på tiden.
 */
const researchTimeoutMs = () => envInt("RESEARCH_TIMEOUT_MS", 200_000, 30_000, 600_000);
/** Globalt tak per dygn (Europe/Stockholm). */
const dailyReportCap = () => envInt("DAILY_REPORT_CAP", 40, 1, 100_000);
/** Tak per klient och timme. */
const hourlyLimit = () => envInt("RATE_LIMIT_PER_HOUR", 6, 1, 1_000);

/** Tak per steg. Söksteget och skrivsteget får aldrig ta mer än så här var. */
export const stepTimeoutMs = 90_000;
/** Högsta antal källänkar som skickas vidare till skrivsteget. */
export const maxChunksForWrite = 40;
/** Högsta antal tecken av fyndsammanfattningen som skickas vidare. */
export const maxFindingsChars = 12_000;

const dayFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" });

/** Dygnsnyckeln räknas i svensk tid, så att dygnstaket följer svensk dag. */
function stockholmDay(date: Date): string {
  return dayFormatter.format(date);
}

/* ------------------------------------------------------------------ *
 * Indata
 * ------------------------------------------------------------------ */

/**
 * Mönster för text som ser ut som ett försök att styra modellen. Det används
 * bara för att upptäcka och logga försöket i generation_meta – det ändrar
 * aldrig reglerna, och fritexten behandlas alltid som data.
 */
export const injectionPattern =
  /(ignore|bortse från|strunta i|glöm)[^.\n]{0,40}(previous|tidigare|all|alla)[^.\n]{0,20}(instruction|instruktion)|system\s*prompt|jailbreak|developer\s*mode|utvecklarläge/i;

/**
 * Städar fordonsuppgifterna innan de går vidare.
 *
 * Texten är otrusted: HTML tas bort, blanksteg normaliseras och fritexten kan
 * därmed aldrig bryta sig ur JSON-ramen eller se ut som en instruktion. Texten
 * skickas ändå bara som data, i ett eget meddelande, och allt modellen svarar
 * valideras och kontrolleras programmatiskt efteråt.
 */
export function sanitizeVehicle(request: {
  make: string;
  model: string;
  engine: string;
  year: number;
  gearbox: Vehicle["gearbox"];
  drivetrain: Vehicle["drivetrain"];
  mileage_km: number | null;
}): { vehicle: Vehicle; injectionSuspected: boolean } {
  const vehicle: Vehicle = {
    make: stripHtml(request.make),
    model: stripHtml(request.model),
    engine: stripHtml(request.engine),
    year: request.year,
    gearbox: request.gearbox,
    drivetrain: request.drivetrain,
    mileage_km: request.mileage_km,
  };
  const injectionSuspected = [vehicle.make, vehicle.model, vehicle.engine].some((value) => injectionPattern.test(value));
  return { vehicle, injectionSuspected };
}

/** Hashar ip-adressen (eller klient-id:t) så att rå ip aldrig sparas. */
async function ownerKeyFor(ctx: ActionCtx, clientKey: string | undefined): Promise<string> {
  const metadata = await ctx.meta.getRequestMetadata().catch(() => null);
  const identity = metadata?.ip ?? clientKey ?? "unknown";
  const secret = process.env.RATE_LIMIT_SECRET;
  const hash = secret
    ? createHmac("sha256", secret).update(identity).digest("hex")
    : createHash("sha256").update(identity).digest("hex");
  return hash.slice(0, 40);
}

/* ------------------------------------------------------------------ *
 * Källor ur sökstegets källträffar
 * ------------------------------------------------------------------ */

/**
 * Bygger rapportens källor ur sökstegets egna källträffar.
 *
 * Det här är den enda vägen till en källa i en rapport. Modellen får bara
 * hänvisa till id:n (s1, s2 …) ur den här listan, och en url som inte finns här
 * kan därför aldrig hamna i en rapport. Publiceringsnamnet är den riktiga
 * utgivardomänen, eftersom sökresultatet inte säger något säkert om utgivarens
 * typ: source_type sätts därför till "other" i stället för att gissa.
 *
 * Domänen räknas ut igen här, ur url, titel och domän tillsammans. Googles
 * träffar är omdirigeringslänkar, så enbart url:ens värdnamn duger inte som
 * utgivare – då skulle sju olika sajter bli en och samma utgivare.
 */
export function sourcesFromChunks(chunks: readonly GroundingChunk[], retrievedAt: string): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const chunk of chunks) {
    if (sources.length >= maxChunksForWrite) break;
    const url = chunk.url.trim();
    if (!url.startsWith("https://")) continue;
    const key = url.replace(/#.*$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const domain = resolveChunkDomain({ uri: url, title: chunk.title, domain: chunk.domain });
    const publisher = (stripHtml(domain) || "okänd utgivare").slice(0, 80);
    const title = (stripHtml(chunk.title) || publisher || url).slice(0, 160);
    sources.push({
      id: `s${sources.length + 1}`,
      url,
      title: title.length >= 3 ? title : url.slice(0, 160),
      publisher: publisher.length >= 2 ? publisher : "okänd utgivare",
      source_type: "other",
      retrieved_at: retrievedAt,
    });
  }
  return sources;
}

/* ------------------------------------------------------------------ *
 * Svar från modellen
 * ------------------------------------------------------------------ */

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/** Plockar ut JSON-objektet ur modellens svar, även med kodstaket runt om. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error("RESPONSE_EMPTY");
  const withoutFence = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  for (const candidate of [withoutFence, trimmed]) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* fortsätter med nästa försök */
    }
  }
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(withoutFence.slice(start, end + 1));
    } catch {
      /* inget giltigt objekt hittades */
    }
  }
  throw new Error("RESPONSE_NOT_JSON");
}

/** Förklarar i klartext att modellen bad om bilens uppgifter i stället för att söka. */
function inputNotDeliveredMessage(result: SearchResult): string {
  const answer = result.text.trim().replace(/\s+/g, " ").slice(0, 400);
  return `Modellens svar ber om bilens uppgifter i stället för att söka (0 sökningar, 0 källänkar, finishReason: ${
    result.finishReason ?? "saknas"
  }). Bilens data skickas alltid med i anropet, så det här är ett fel i vår kod. Modellens svar började: "${answer}"`;
}

/** Förklarar i klartext att söksteget inte gjorde någon sökning. */
function noResearchMessage(result: SearchResult): string {
  const facts = [
    `${result.searches} sökningar`,
    `${result.chunks.length} källänkar`,
    `finishReason: ${result.finishReason ?? "saknas"}`,
    result.toolPromptTokens === null || result.toolPromptTokens === undefined
      ? null
      : `verktygs-token: ${result.toolPromptTokens}`,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  return `Sökverktyget användes inte (${facts}). Utan sökresultat finns inga källor att bygga rapporten på, så skrivsteget kördes inte.`;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

type QualityOutcome =
  | { ok: true; report: Report; notes: string[]; unverifiedSourceUrls: string[] }
  | { ok: false; kind: FailureKind; issues: string[] };

/**
 * Kör de programmatiska kontrollerna och sammanfattar felet i stället för att
 * kasta, med rätt kategori: ogiltig JSON, bruten struktur eller underkänt
 * innehåll.
 */
function runQualityChecks(
  text: string,
  verifiedSourceUrls: readonly string[],
  vehicle: Vehicle,
  codeSources: readonly Source[],
  searchesRun: number,
): QualityOutcome {
  let parsedJson: unknown;
  try {
    parsedJson = extractJson(text);
  } catch (error) {
    const empty = error instanceof Error && error.message === "RESPONSE_EMPTY";
    return {
      ok: false,
      kind: "invalid_json",
      issues: [empty ? "Svaret var tomt – ingen JSON alls." : "Svaret gick inte att läsa som JSON."],
    };
  }

  try {
    const result = applyQualityChecks({
      report: parsedJson,
      options: { verifiedSourceUrls, sources: codeSources, searchesRun },
    });
    /* Fordonsuppgifterna i rapporten är alltid de validerade uppgifterna från
       formuläret – aldrig något modellen har skrivit om på egen hand. */
    const report = reportSchema.parse({ ...result.report, vehicle });
    return { ok: true, report, notes: result.notes, unverifiedSourceUrls: result.unverifiedSourceUrls };
  } catch (error) {
    if (error instanceof QualityCheckError) return { ok: false, kind: error.kind, issues: error.issues };
    return {
      ok: false,
      kind: "schema",
      issues: [error instanceof Error ? error.message : "Okänt fel i svaret."],
    };
  }
}

/* ------------------------------------------------------------------ *
 * Felspårning
 * ------------------------------------------------------------------ */

/** Maskinkod per felkategori. Samma kod sparas på posten och skickas till klienten. */
export const codeForFailureKind: Record<FailureKind, string> = {
  timeout: "TIMEOUT",
  provider_error: "PROVIDER_FAILED",
  provider_not_configured: "PROVIDER_NOT_CONFIGURED",
  provider_model_unknown: "PROVIDER_MODEL_UNKNOWN",
  provider_blocked: "PROVIDER_BLOCKED",
  provider_empty: "PROVIDER_EMPTY",
  empty_response: "EMPTY_RESPONSE",
  invalid_json: "INVALID_JSON",
  schema: "SCHEMA_INVALID",
  quality: "VALIDATION_FAILED",
  no_research: "NO_RESEARCH",
  input_not_delivered: "INPUT_NOT_DELIVERED",
  stale: "STALE_TIMEOUT",
  unexpected: "GENERATION_FAILED",
};

/** Den användning ett steg hann göra innan det gav upp. */
type StepUsage = { searches: number; inputTokens: number | null; outputTokens: number | null };

const emptyUsage: StepUsage = { searches: 0, inputTokens: null, outputTokens: null };

/** Kostnaden för ett steg, i USD och SEK, utifrån den användning vi känner till. */
function stepCost(provider: ProviderId, usage: StepUsage, usdToSek: number): { cost_usd: number; cost_sek: number } {
  const costUsd = estimateCostUsd(provider, usage);
  return { cost_usd: round(costUsd, 4), cost_sek: estimateCostSek(costUsd, usdToSek) };
}

/** Bygger ett sparat försök. Modellens råsvar kortas, feltexten städas. */
function buildAttempt(input: {
  attempt: number;
  stage: GenerationStep;
  kind: FailureKind;
  code: string;
  httpStatus: number | null;
  message: string;
  qualityIssues?: string[];
  provider: ProviderId | null;
  model: string | null;
  usage?: StepUsage;
  /** Leverantörens finishReason, till exempel MAX_TOKENS. */
  finishReason?: string | null;
  durationMs: number;
  rawText?: string;
  /** Användarmeddelandet som skickades, så att /admin kan se vad modellen fick. */
  requestText?: string;
  usdToSek: number;
}): FailureAttempt {
  const raw = truncateRawResponse(input.rawText ?? "");
  const request = input.requestText ? truncateRequestExcerpt(redactSecrets(input.requestText)) : null;
  const cost = stepCost(input.provider ?? "google", input.usage ?? emptyUsage, input.usdToSek);
  return {
    attempt: input.attempt,
    stage: input.stage,
    kind: input.kind,
    code: input.code,
    http_status: input.httpStatus,
    message: input.message.slice(0, 1200),
    quality_issues: (input.qualityIssues ?? []).slice(0, 12),
    provider: input.provider,
    model: input.model,
    searches: (input.usage ?? emptyUsage).searches,
    input_tokens: (input.usage ?? emptyUsage).inputTokens,
    output_tokens: (input.usage ?? emptyUsage).outputTokens,
    cost_usd: cost.cost_usd,
    cost_sek: cost.cost_sek,
    duration_ms: input.durationMs,
    raw_response: raw.text,
    raw_response_truncated: raw.truncated,
    ...(request ? { request_excerpt: request.text, request_excerpt_truncated: request.truncated } : {}),
    finish_reason: input.finishReason ?? null,
    at: new Date().toISOString(),
  };
}

/** Ett steg som mäts: tid, sökningar, token och kostnad. */
function meterStep(input: {
  step: GenerationStep;
  attempt: number;
  durationMs: number;
  searches: number;
  inputTokens: number | null;
  outputTokens: number | null;
  provider: ProviderId;
  usdToSek: number;
}): GenerationStepMeta {
  const usage: StepUsage = { searches: input.searches, inputTokens: input.inputTokens, outputTokens: input.outputTokens };
  const cost = stepCost(input.provider, usage, input.usdToSek);
  return {
    step: input.step,
    attempt: input.attempt,
    duration_ms: Math.max(0, Math.round(input.durationMs)),
    searches: input.searches,
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
    cost_usd: cost.cost_usd,
    cost_sek: cost.cost_sek,
  };
}

/**
 * Ett kastat fel blir ett sparat försök med kategori, steg och HTTP-status.
 *
 * Exporterad tillsammans med {@link buildFailureMeta} eftersom det är ren logik
 * utan databas eller nätverk: verifieringen kör samma kod som pipelinen och kan
 * därmed kontrollera exakt vad som sparas vid ett misslyckande.
 */
export function attemptFromError(
  error: unknown,
  facts: {
    attempt: number;
    stage: GenerationStep;
    provider: ProviderId | null;
    model: string | null;
    durationMs: number;
    /** Användarmeddelandet som skickades i försöket, om det finns. */
    requestText?: string;
    usdToSek: number;
  },
): FailureAttempt {
  const known = error instanceof ProviderError ? error : null;
  const kind: FailureKind = known?.kind ?? "unexpected";
  /* Ett misslyckat anrop kostar lika mycket som ett lyckat: Google fakturerar
     tänk-token och utförda sökningar även när svaret inte gick att använda.
     Därför sparas den användning och den råa struktur som hann läsas, i stället
     för nollor och "uppgift saknas". */
  const diagnostics = known?.diagnostics;
  return buildAttempt({
    attempt: facts.attempt,
    stage: facts.stage,
    kind,
    code: known?.code ?? "GENERATION_FAILED",
    httpStatus: known?.status ?? null,
    message: known?.message ?? (error instanceof Error ? error.message : "Oväntat fel utan feltext."),
    provider: facts.provider,
    model: facts.model,
    usage: diagnostics
      ? {
          searches: diagnostics.searches ?? 0,
          inputTokens: diagnostics.inputTokens ?? null,
          outputTokens: diagnostics.outputTokens ?? null,
        }
      : undefined,
    finishReason: diagnostics?.finishReason ?? null,
    durationMs: facts.durationMs,
    rawText: diagnostics?.rawResponse ?? undefined,
    requestText: facts.requestText,
    usdToSek: facts.usdToSek,
  });
}

function sumKnown(values: ReadonlyArray<number | null>): number | null {
  if (values.length === 0 || values.every((value) => value === null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/**
 * Summerar alla steg och försök till det felspår som sparas på posten och visas
 * i /admin.
 *
 * Sökningar, token och kostnad räknas ur `steps` när den listan finns, eftersom
 * den innehåller varje anrop som faktiskt kostade pengar – även de steg som gick
 * bra innan ett senare steg misslyckades. Äldre poster utan `steps` summeras ur
 * försöken som förut.
 */
export function buildFailureMeta(input: {
  kind: FailureKind;
  attempts: readonly FailureAttempt[];
  steps?: readonly GenerationStepMeta[];
  provider: ProviderId | null;
  model: string | null;
  durationMs: number;
  timeoutMs: number;
  usdToSek: number;
  modelNotes?: string[];
}): FailureMeta {
  const steps = input.steps ?? [];
  const costUsd = steps.length > 0
    ? steps.reduce<number>((total, step) => total + step.cost_usd, 0)
    : input.attempts.reduce<number>((total, attempt) => total + attempt.cost_usd, 0);
  const searchesTotal = steps.length > 0
    ? steps.reduce<number>((total, step) => total + step.searches, 0)
    : input.attempts.reduce<number>((total, attempt) => total + attempt.searches, 0);
  const inputTokensTotal = steps.length > 0
    ? sumKnown(steps.map((step) => step.input_tokens))
    : sumKnown(input.attempts.map((attempt) => attempt.input_tokens));
  const outputTokensTotal = steps.length > 0
    ? sumKnown(steps.map((step) => step.output_tokens))
    : sumKnown(input.attempts.map((attempt) => attempt.output_tokens));

  return failureMetaSchema.parse({
    kind: input.kind,
    summary: describeFailure({ kind: input.kind, attempts: input.attempts, timeoutMs: input.timeoutMs }),
    attempts: input.attempts.length > 0
      ? input.attempts
      : [
          buildAttempt({
            attempt: 1,
            stage: "search",
            kind: input.kind,
            code: codeForFailureKind[input.kind],
            httpStatus: null,
            message: "Körningen avbröts utan ett sparat försök.",
            provider: input.provider,
            model: input.model,
            durationMs: input.durationMs,
            usdToSek: input.usdToSek,
          }),
        ],
    steps,
    attempt_count: Math.max(input.attempts.length, 1),
    retried: input.attempts.length > 1,
    searches_total: searchesTotal,
    input_tokens_total: inputTokensTotal,
    output_tokens_total: outputTokensTotal,
    cost_usd_total: round(costUsd, 4),
    cost_sek_total: estimateCostSek(costUsd, input.usdToSek),
    duration_ms: input.durationMs,
    provider: input.provider,
    model: input.model,
    failed_at: new Date().toISOString(),
    model_notes: input.modelNotes ?? [],
  });
}

/* ------------------------------------------------------------------ *
 * Den rena tvåstegskörningen
 * ------------------------------------------------------------------ */

/** Leverantören så som körningen behöver den: två funktioner, inget annat. */
export type GenerationProvider = {
  id: ProviderId;
  search: (request: SearchRequest) => Promise<SearchResult>;
  write: (request: WriteRequest) => Promise<WriteResult>;
};

export type GenerationInput = {
  vehicle: Vehicle;
  purchaseTiming: PurchaseTiming;
  provider: GenerationProvider;
  model: string;
  maxSearches: number;
  /** Tak för hela körningen i millisekunder. */
  timeoutMs: number;
  usdToSek: number;
  /** Dagens datum som ISO-datum (YYYY-MM-DD) för källornas hämtningsdatum. */
  today: string;
  /** Klocka, utbytbar så att tidsgränser kan bevisas utan väntetid. */
  now?: () => number;
  /** Statusrapportering till frontend. Anropas före varje steg. */
  setStatus?: (status: ReportStatus) => Promise<void> | void;
  /** Varningar från modellkontrollen, som följer med till /admin. */
  modelNotes?: string[];
};

export type GenerationSuccess = {
  ok: true;
  report: Report;
  searches: number;
  steps: GenerationStepMeta[];
  groundingUrls: string[];
  qualityNotes: string[];
  unverifiedSourceUrls: string[];
  retried: boolean;
  durationMs: number;
  costUsd: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export type GenerationFailure = {
  ok: false;
  kind: FailureKind;
  code: string;
  message: string;
  failure: FailureMeta;
};

export type GenerationOutcome = GenerationSuccess | GenerationFailure;

/**
 * Kör söksteget och skrivsteget och returnerar antingen en validerad rapport
 * eller ett komplett felspår. Funktionen kastar aldrig: allt som kan gå fel
 * fångas och beskrivs, så att posten aldrig lämnas i ett arbetsläge.
 *
 * Den är avsiktligt fri från Convex, databas och miljövariabler – allt skickas
 * in. Det är därför testskriptet kan köra exakt samma kod mot en simulerad
 * leverantör och bevisa alla fyra fallen utan ett enda riktigt anrop.
 */
export async function runTwoStepGeneration(input: GenerationInput): Promise<GenerationOutcome> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  const steps: GenerationStepMeta[] = [];
  const attempts: FailureAttempt[] = [];
  const providerId = input.provider.id;

  const reportStatus = async (status: ReportStatus) => {
    try {
      await input.setStatus?.(status);
    } catch {
      /* En misslyckad statusuppdatering får aldrig stoppa körningen: posten
         stängs ändå av vaktfunktionen om den blir stående. */
    }
  };

  const remainingMs = () => Math.max(0, input.timeoutMs - (now() - startedAt));
  const stepLimit = () => Math.min(stepTimeoutMs, remainingMs());

  const finishFailure = (kind: FailureKind, summaryOverride?: string): GenerationFailure => {
    const failure = buildFailureMeta({
      kind,
      attempts,
      steps,
      provider: providerId,
      model: input.model,
      durationMs: now() - startedAt,
      timeoutMs: input.timeoutMs,
      usdToSek: input.usdToSek,
      modelNotes: input.modelNotes ?? [],
    });
    return {
      ok: false,
      kind,
      code: codeForFailureKind[kind],
      message: summaryOverride ?? failure.summary,
      failure,
    };
  };

  /* ---------------- Steg 1: sök ---------------- */

  await reportStatus("researching");
  const searchPrompt = buildReportSearchPrompt({ maxSearches: input.maxSearches, today: input.today });
  let findings: SearchResult | null = null;
  let decisive: FailureKind | null = null;
  let attemptCounter = 0;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    attemptCounter += 1;
    const limit = stepLimit();
    const stepStartedAt = now();

    if (limit < 1_000) {
      const failure = buildAttempt({
        attempt: attemptCounter,
        stage: "search",
        kind: "timeout",
        code: "RESEARCH_TIMEOUT",
        httpStatus: null,
        message: `Tidsbudgeten för hela körningen (${Math.round(input.timeoutMs / 1000)} s) var slut innan söksteget kunde starta.`,
        provider: providerId,
        model: input.model,
        durationMs: 0,
        usdToSek: input.usdToSek,
      });
      attempts.push(failure);
      return finishFailure("timeout");
    }

    /* Bilens uppgifter måste följa med i söksteget. Utan dem svarade modellen
       "klistra in fordonsuppgifterna" i stället för att söka. Meddelandet byggs
       på ett ställe och sparas ordagrant i felspåret, så att /admin kan
       kontrollera vad modellen faktiskt fick. */
    const searchUserMessage = buildSearchUserMessage(
      input.vehicle,
      attempt > 1 ? reportSearchRetryMessage : undefined,
    );

    let result: SearchResult | null = null;
    try {
      result = await input.provider.search({
        vehicle: input.vehicle,
        systemPrompt: searchPrompt,
        userMessage: searchUserMessage,
        model: input.model,
        maxSearches: input.maxSearches,
        timeoutMs: limit,
      });
    } catch (error) {
      const durationMs = now() - stepStartedAt;
      const failure = attemptFromError(error, {
        attempt: attemptCounter,
        stage: "search",
        provider: providerId,
        model: input.model,
        durationMs,
        requestText: searchUserMessage,
        usdToSek: input.usdToSek,
      });
      attempts.push(failure);
      steps.push(
        meterStep({
          step: "search",
          attempt,
          durationMs,
          searches: failure.searches,
          inputTokens: failure.input_tokens,
          outputTokens: failure.output_tokens,
          provider: providerId,
          usdToSek: input.usdToSek,
        }),
      );
      /* Tidsgräns och leverantörsfel får aldrig ett nytt försök: det kostar nya
         sökningar utan att kunna lyckas. */
      return finishFailure(failure.kind);
    }

    const durationMs = now() - stepStartedAt;
    steps.push(
      meterStep({
        step: "search",
        attempt,
        durationMs,
        searches: result.searches,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        provider: providerId,
        usdToSek: input.usdToSek,
      }),
    );

    if (result.searches === 0 || result.chunks.length === 0) {
      /* Ber modellens svar om bilens uppgifter är felet vårt, inte modellens val:
         då saknades indata i anropet. Kategorin blir INPUT_NOT_DELIVERED och
         inget omförsök görs, eftersom samma anrop skulle ge samma svar. */
      const askedForInput = looksLikeInputRequest(result.text);
      const kind: FailureKind = askedForInput ? "input_not_delivered" : "no_research";
      const failure = buildAttempt({
        attempt: attemptCounter,
        stage: "search",
        kind,
        code: codeForFailureKind[kind],
        httpStatus: null,
        message: askedForInput ? inputNotDeliveredMessage(result) : noResearchMessage(result),
        provider: providerId,
        model: input.model,
        usage: { searches: result.searches, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
        finishReason: result.finishReason ?? null,
        durationMs,
        rawText: result.text,
        requestText: searchUserMessage,
        usdToSek: input.usdToSek,
      });
      attempts.push(failure);
      decisive = kind;
      if (askedForInput) break;
      /* Exakt ett omförsök, med en mer tvingande formulering. Därefter avbryts
         körningen utan fler försök. */
      if (attempt < 2) continue;
      break;
    }

    findings = result;
    decisive = null;
    break;
  }

  if (!findings) {
    return finishFailure(decisive ?? "no_research");
  }

  /* ---------------- Steg 2: skriv ---------------- */

  await reportStatus("analyzing");

  const sources = sourcesFromChunks(findings.chunks, input.today);
  if (sources.length === 0) {
    /* Kan bara hända om alla källänkar var ogiltiga, men då finns inget att
       bygga rapporten på. */
    attempts.push(
      buildAttempt({
        attempt: attemptCounter + 1,
        stage: "search",
        kind: "no_research",
        code: codeForFailureKind.no_research,
        httpStatus: null,
        message: "Söksteget returnerade källänkar som inte gick att använda som källor (endast https tillåts).",
        provider: providerId,
        model: input.model,
        usage: { searches: findings.searches, inputTokens: findings.inputTokens, outputTokens: findings.outputTokens },
        finishReason: findings.finishReason ?? null,
        durationMs: 0,
        rawText: findings.text,
        usdToSek: input.usdToSek,
      }),
    );
    return finishFailure("no_research");
  }

  const findingsText = findings.text.trim().slice(0, maxFindingsChars);
  const writePrompt = buildReportSystemPrompt({ maxSearches: input.maxSearches, today: input.today });
  const writePayload = {
    vehicle: input.vehicle,
    purchase_timing: input.purchaseTiming,
    findings: findingsText.length > 0
      ? findingsText
      : "Sökningen gav inga sammanfattade fynd. Bygg rapporten enbart på källistan och var försiktig i formuleringarna.",
    sources: sources.map((source) => ({ id: source.id, title: source.title, publisher: source.publisher, url: source.url })),
  };
  const verifiedUrls = findings.chunks.map((chunk) => chunk.url);

  await reportStatus("writing");

  let success: { result: WriteResult; outcome: Extract<QualityOutcome, { ok: true }> } | null = null;
  let decisiveWrite: FailureKind | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    attemptCounter += 1;
    const limit = stepLimit();
    const stepStartedAt = now();

    if (limit < 1_000) {
      attempts.push(
        buildAttempt({
          attempt: attemptCounter,
          stage: "write",
          kind: "timeout",
          code: "RESEARCH_TIMEOUT",
          httpStatus: null,
          message: `Tidsbudgeten för hela körningen (${Math.round(input.timeoutMs / 1000)} s) var slut innan skrivsteget kunde starta.`,
          provider: providerId,
          model: input.model,
          durationMs: 0,
          usdToSek: input.usdToSek,
        }),
      );
      return finishFailure("timeout");
    }

    /* Andra varvet i skrivsteget sker bara efter ett formatfel, och då följer en
       kort rättelse med. Inga nya sökningar görs, så det kostar bara token. */
    const correction = attempt > 1
      ? `\n\nDitt förra svar kunde inte användas. Använd korta id:n (i1, i2, c1 …), ange source_ids som id:n ur källistan och returnera bara ett JSON-objekt som följer kontraktet exakt.`
      : "";

    /* Bilens uppgifter följer med även här, tillsammans med fynden och
       källistan. Samma text sparas i felspåret om steget misslyckas. */
    const writeUserMessage = `${reportWriteUserMessage}\n\n${JSON.stringify(writePayload)}${correction}`;

    let result: WriteResult;
    try {
      result = await input.provider.write({
        vehicle: input.vehicle,
        systemPrompt: writePrompt,
        userMessage: writeUserMessage,
        model: input.model,
        timeoutMs: limit,
      });
    } catch (error) {
      const durationMs = now() - stepStartedAt;
      const failure = attemptFromError(error, {
        attempt: attemptCounter,
        stage: "write",
        provider: providerId,
        model: input.model,
        durationMs,
        requestText: writeUserMessage,
        usdToSek: input.usdToSek,
      });
      attempts.push(failure);
      steps.push(
        meterStep({
          step: "write",
          attempt,
          durationMs,
          searches: 0,
          inputTokens: failure.input_tokens,
          outputTokens: failure.output_tokens,
          provider: providerId,
          usdToSek: input.usdToSek,
        }),
      );
      /* Steg 2 får aldrig ett nytt försök vid tidsgräns eller leverantörsfel. */
      return finishFailure(failure.kind);
    }

    const durationMs = now() - stepStartedAt;
    steps.push(
      meterStep({
        step: "write",
        attempt,
        durationMs,
        searches: 0,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        provider: providerId,
        usdToSek: input.usdToSek,
      }),
    );

    const outcome = runQualityChecks(result.text, verifiedUrls, input.vehicle, sources, findings.searches);
    if (outcome.ok) {
      success = { result, outcome };
      decisiveWrite = null;
      break;
    }

    attempts.push(
      buildAttempt({
        attempt: attemptCounter,
        stage: "write",
        kind: outcome.kind,
        code: codeForFailureKind[outcome.kind],
        httpStatus: null,
        message: outcome.issues.join("; "),
        qualityIssues: outcome.issues,
        provider: providerId,
        model: input.model,
        usage: { searches: 0, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
        finishReason: result.finishReason ?? null,
        durationMs,
        rawText: result.text,
        requestText: writeUserMessage,
        usdToSek: input.usdToSek,
      }),
    );
    decisiveWrite = outcome.kind;
    if (isRetryableFailure(outcome.kind) && attempt < 2) continue;
    break;
  }

  if (!success) {
    return finishFailure(decisiveWrite ?? "quality");
  }

  const costUsd = round(steps.reduce<number>((total, step) => total + step.cost_usd, 0), 4);
  return {
    ok: true,
    report: success.outcome.report,
    searches: findings.searches,
    steps,
    groundingUrls: findings.chunks.map((chunk) => chunk.url).slice(0, 60),
    qualityNotes: success.outcome.notes,
    unverifiedSourceUrls: success.outcome.unverifiedSourceUrls,
    retried: attempts.length > 0,
    durationMs: now() - startedAt,
    costUsd,
    inputTokens: sumKnown(steps.map((step) => step.input_tokens)),
    outputTokens: sumKnown(steps.map((step) => step.output_tokens)),
  };
}

/* ------------------------------------------------------------------ *
 * Felhantering mot databasen
 * ------------------------------------------------------------------ */

/**
 * Markerar posten misslyckad utan att själv kunna kasta vidare.
 *
 * Om just den skrivningen skulle strula är det viktigare att det ursprungliga
 * felet når användaren än att felet loggas, och vaktfunktionen
 * (vehicleReports.sweepStaleReports) fångar posten ändå inom fem minuter.
 */
async function markFailed(ctx: ActionCtx, reportId: string, reason: string, failure: FailureMeta) {
  try {
    await ctx.runMutation(internal.vehicleReports.failReport, { reportId, reason, failure });
  } catch (error) {
    console.error("[reportPipeline] kunde inte spara felorsaken på posten:", error);
  }
}

/* ------------------------------------------------------------------ *
 * Actionen
 * ------------------------------------------------------------------ */

export const generateReport = action({
  args: { input: v.any(), clientKey: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ reportId: string; cached: boolean }> => {
    const parsed = reportRequestSchema.safeParse(args.input);
    if (!parsed.success) fail("INVALID_INPUT", "Uppgifterna om bilen kunde inte tolkas.");
    const request = parsed.data;

    const { vehicle, injectionSuspected } = sanitizeVehicle(request);
    if (!vehicle.make || !vehicle.model || !vehicle.engine) {
      fail("INVALID_INPUT", "Ange bilmärke, modell och motor eller bränsletyp.");
    }

    const cacheKey = reportCacheKey(vehicle);

    /* Nyckeln används bara för rate limit och sparas i reportUsage, som gallras
       automatiskt efter rateLimitRetentionMs. Den skrivs aldrig på rapporten. */
    const ownerKey = await ownerKeyFor(ctx, args.clientKey);

    const quota = await ctx.runMutation(internal.vehicleReports.consumeReportQuota, {
      key: ownerKey,
      day: stockholmDay(new Date()),
      perHourLimit: hourlyLimit(),
      dailyCap: dailyReportCap(),
    });
    if (!quota.allowed) {
      if (quota.reason === "DAILY_CAP_REACHED") fail("DAILY_CAP_REACHED", "Dagens tak för antal rapporter är nått. Försök igen i morgon.");
      fail("RATE_LIMITED", "För många förfrågningar just nu. Vänta en stund och försök igen.");
    }

    const cached = await ctx.runQuery(internal.vehicleReports.findCachedReport, { cacheKey });
    if (cached?.report) return { reportId: cached.reportId, cached: true };

    const reportId = randomUUID();
    await ctx.runMutation(internal.vehicleReports.createReport, { reportId, cacheKey, vehicle });

    const usdToSek = parseUsdToSek(process.env.USD_SEK_RATE);
    const timeoutMs = researchTimeoutMs();
    let recorded = false;

    try {
      const provider = resolveProvider();

      /* Modellkontrollen sker innan något anrop: ett namn som inte finns kostar
         annars både tid och pengar utan att kunna lyckas. Varningen sparas på
         körningen i stället för att stoppa den. */
      const modelWarning = await assertProviderModel(provider.id, provider.defaultModel());
      const modelNotes = modelWarning ? [modelWarning] : [];

      const outcome = await runTwoStepGeneration({
        vehicle,
        purchaseTiming: request.purchase_timing,
        provider: { id: provider.id, search: provider.search, write: provider.write },
        model: provider.defaultModel(),
        maxSearches: maxSearches(),
        timeoutMs,
        usdToSek,
        today: stockholmDay(new Date()),
        setStatus: async (status) => {
          await ctx.runMutation(internal.vehicleReports.setReportStatus, { reportId, status });
        },
        modelNotes,
      });

      if (!outcome.ok) {
        await markFailed(ctx, reportId, outcome.code, outcome.failure);
        recorded = true;
        fail(outcome.code, outcome.failure.summary);
      }

      const generationMeta = generationMetaSchema.parse({
        provider: provider.id,
        model: provider.defaultModel(),
        prompt_version: reportPromptVersion,
        searches_run: outcome.searches,
        sources_used: outcome.report.research_summary.sources_used,
        input_tokens: outcome.inputTokens,
        output_tokens: outcome.outputTokens,
        cost_usd: outcome.costUsd,
        usd_sek_rate: usdToSek,
        estimated_cost_sek: estimateCostSek(outcome.costUsd, usdToSek),
        duration_ms: outcome.durationMs,
        generated_at: new Date().toISOString(),
        retried: outcome.retried,
        injection_suspected: injectionSuspected,
        grounding_urls: outcome.groundingUrls,
        unverified_source_urls: outcome.unverifiedSourceUrls,
        quality_notes: [ ...modelNotes, ...outcome.qualityNotes],
        steps: outcome.steps,
      });

      await ctx.runMutation(internal.vehicleReports.completeReport, {
        reportId,
        report: outcome.report,
        generationMeta,
        status: "done",
      });

      return { reportId, cached: false };
    } catch (error) {
      /* Posten får aldrig ligga kvar i arbetsläge: allt oväntat fångas här och
         skrivs till posten med samma detaljnivå som de kända felen. */
      if (recorded) {
        if (error instanceof ConvexError) throw error;
        throw new ConvexError({ code: "GENERATION_FAILED", message: error instanceof Error ? error.message : "Rapporten kunde inte skapas." });
      }

      const failure = attemptFromError(error, {
        attempt: 1,
        stage: "search",
        provider: null,
        model: null,
        durationMs: 0,
        usdToSek,
      });
      const failureMeta = buildFailureMeta({
        kind: failure.kind,
        attempts: [failure],
        provider: null,
        model: null,
        durationMs: 0,
        timeoutMs,
        usdToSek,
      });
      await markFailed(ctx, reportId, codeForFailureKind[failure.kind], failureMeta);

      if (error instanceof ConvexError) throw error;
      fail(codeForFailureKind[failure.kind], failureMeta.summary);
    }
  },
});
