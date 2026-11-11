/**
 * Research-leverantörerna.
 *
 * En leverantör tar en systemprompt och ett fordonsmeddelande och returnerar
 * modellens råa textsvar plus vad sökningen kostade att göra. Modulen känner
 * igen fyra leverantörer:
 *
 *  - "google": Gemini med det inbyggda sökverktyget Google Search. Kräver
 *    GOOGLE_API_KEY.
 *  - "openai": Responses-API:t med web_search-verktyget. Kräver OPENAI_API_KEY.
 *  - "anthropic": Messages-API:t med web_search-verktyget. Kräver
 *    ANTHROPIC_API_KEY.
 *  - "fixture": en lokal testleverantör utan nätverksanrop. Används bara när
 *    REPORT_PROVIDER=fixture, och resultatet märks tydligt som testkörning.
 *
 * Tre saker gäller för alla riktiga leverantörer:
 *
 *  1. Varje anrop har en hård tidsgräns via AbortController, satt av
 *     pipelinen per steg. Gränsen gäller hela anropet, inte bara anslutningen.
 *  2. Alla fel kastas som {@link ProviderError} med en kategori
 *     ({@link FailureKind}) och, när det finns en, HTTP-status. Då kan
 *     pipelinen spara exakt orsak i stället för ett allmänt fel.
 *  3. Nyckelvärden tas bort ur all feltext innan den sparas.
 *
 * Google har dessutom en modellkontroll: modellnamnet i LLM_MODEL verifieras
 * mot Googles egen modellista innan ett anrop görs, eftersom ett anrop med ett
 * namn som inte finns kostar både tid och pengar utan att kunna lyckas.
 *
 * Nycklarna läses uteslutande server-side ur Convex miljövariabler och följer
 * aldrig med till klienten. Priserna ligger i src/lib/reportPricing.ts.
 */

import { z } from "zod";
import { rawResponseLimit, type FailureKind } from "../lib/reportFailure";
import { providerPricing, type ProviderId } from "../lib/reportPricing";
import type { Vehicle } from "../lib/report";

/**
 * Genereringen sker i två anrop, och leverantörsmodulen har därför två
 * funktioner per leverantör: ett söksteg med sökverktyget och ett skrivsteg
 * utan verktyg. Uppdelningen är det som gör sökningen mätbar: steg 1 svarar
 * med sökverktygets egna källänkar, och steg 2 kan bara bygga på dem.
 */

/** En källträff från sökverktyget: url, titel och domän. */
export type GroundingChunk = {
  url: string;
  title: string;
  /**
   * Den riktiga utgivardomänen, utan www. Tom när den inte går att avgöra.
   * Den är aldrig sökverktygets omdirigeringsvärd, eftersom en sådan skulle
   * göra alla träffar till samma utgivare.
   */
  domain: string;
};

/** En källträff som leverantören anger den: uri, titel och eventuell domän. */
export type ChunkWeb = {
  uri?: string;
  title?: string;
  domain?: string;
};

/** Steg 1: sökningen. Kort anrop med sökverktyget påslaget. */
export type SearchRequest = {
  vehicle: Vehicle;
  systemPrompt: string;
  userMessage: string;
  model: string;
  maxSearches: number;
  timeoutMs: number;
};

export type SearchResult = {
  provider: ProviderId;
  model: string;
  /** Modellens sammanfattning av fynden. Tom när bara källänkar kom tillbaka. */
  text: string;
  /** Antal sökningar leverantören faktiskt utförde. */
  searches: number;
  /** Källänkarna som sökverktyget returnerade. Källor byggs alltid ur dem. */
  chunks: GroundingChunk[];
  inputTokens: number | null;
  outputTokens: number | null;
  /** Leverantörens finishReason, när den finns (till exempel STOP eller MAX_TOKENS). */
  finishReason?: string | null;
  /**
   * Token som gick åt till verktygets resultat. Google fyller i fältet när
   * sökresultat läggs in i prompten, och det är därför det enda spåret när
   * groundingMetadata utelämnas trots att en sökning kördes.
   */
  toolPromptTokens?: number | null;
};

/** Steg 2: skrivningen, utan sökverktyg, enbart ur fynden och källistan. */
export type WriteRequest = {
  vehicle: Vehicle;
  systemPrompt: string;
  userMessage: string;
  model: string;
  timeoutMs: number;
};

export type WriteResult = {
  provider: ProviderId;
  model: string;
  /** Modellens råa svar. Pipelinen tolkar det som JSON. */
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason?: string | null;
};

/**
 * Det vi kunde läsa ur leverantörens svar innan något gick fel.
 *
 * Ett misslyckat anrop kostar pengar precis som ett lyckat: Google fakturerar
 * tänk-token och utförda sökningar även när svaret är oanvändbart. Därför följer
 * användningen och finishReason med på felet, så att /admin kan visa sökningar,
 * token och kostnad för körningen i stället för nollor och "uppgift saknas".
 */
export type ProviderDiagnostics = {
  searches?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Leverantörens finishReason, till exempel MAX_TOKENS. */
  finishReason?: string | null;
  /** Kortad, nyckelrensad rå svarsstruktur. Null när inget svar togs emot. */
  rawResponse?: string | null;
};

export class ProviderError extends Error {
  readonly code: string;
  /** Vilken sorts fel det var, för felspårningen i /admin. */
  readonly kind: FailureKind;
  /** HTTP-status från leverantören, när felet kom från ett svar. */
  readonly status: number | null;
  /** Användning och finishReason, när svaret hann läsas innan felet uppstod. */
  readonly diagnostics: ProviderDiagnostics;

  constructor(
    code: string,
    message: string,
    options: { kind?: FailureKind; status?: number | null; diagnostics?: ProviderDiagnostics } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.kind = options.kind ?? "provider_error";
    this.status = options.status ?? null;
    this.diagnostics = options.diagnostics ?? {};
  }
}

/**
 * Miljövariabler vars värden aldrig får hamna i en sparad feltext.
 *
 * Leverantörernas felsvar brukar vara fria från nycklar, men en url eller en
 * feltext som upprepar nyckeln är inte omöjlig – därför byts varje känt
 * nyckelvärde mot en platshållare innan texten lämnar den här modulen.
 */
const secretEnvVars = ["GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;

export function redactSecrets(text: string): string {
  let result = text;
  for (const name of secretEnvVars) {
    const value = process.env[name];
    if (value && value.length >= 8) result = result.split(value).join("[nyckel]");
  }
  return result;
}

/**
 * Kör ett leverantörsanrop med en hård tidsgräns.
 *
 * Två saker gör gränsen verklig: en AbortController som avbryter själva
 * anslutningen, och en kapplöpning mot en timer som avslutar anropet även om
 * underliggande bibliotek skulle strunta i signalen. Utan kapplöpningen kan en
 * hängande förfrågan hålla en post i arbetsläge tills Convex själv ger upp.
 */
export async function runWithHardTimeout<T>(
  timeoutMs: number,
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new ProviderError(
    "RESEARCH_TIMEOUT",
    `${label} avbröts efter ${Math.round(timeoutMs / 1000)} s av tidsgränsen för steget.`,
    { kind: "timeout" },
  );

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timeout);
    }, timeoutMs);
  });

  try {
    const call = run(controller.signal);
    /* Extra lyssnare: annars blir den avbrutna förfrågan ett ohanterat avbrott
       när kapplöpningen redan har avgjorts. */
    call.catch(() => undefined);
    return await Promise.race([call, deadline]);
  } catch (error) {
    if (controller.signal.aborted) throw timeout;
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      "PROVIDER_UNREACHABLE",
      `${label} kunde inte genomföras: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
      { kind: "provider_error" },
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Läser ett JSON-svar. Ett svar som inte är JSON är ett formatfel, inte ett leverantörsfel. */
async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ProviderError(
      "PROVIDER_INVALID_JSON",
      `${label} svarade med något som inte är giltig JSON (HTTP ${response.status}).`,
      { kind: "invalid_json", status: response.status },
    );
  }
}

/** Tolkar leverantörens svarskuvert. En oväntad struktur är ett leverantörsfel, inte ett formatfel i rapporten. */
function parseEnvelope<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "roten"}: ${issue.message}`)
      .join("; ");
    throw new ProviderError("PROVIDER_UNEXPECTED_SHAPE", `${label} svarade med en oväntad struktur: ${issues}`, {
      kind: "provider_error",
    });
  }
  return parsed.data;
}

type ProviderDefinition = {
  id: ProviderId;
  label: string;
  isConfigured: () => boolean;
  defaultModel: () => string;
  search: (request: SearchRequest) => Promise<SearchResult>;
  write: (request: WriteRequest) => Promise<WriteResult>;
};

/** Modellnamnet: LLM_MODEL styr alla leverantörer, annars leverantörens standard. */
function modelFor(id: ProviderId): string {
  const configured = process.env.LLM_MODEL?.trim();
  return configured && configured.length > 0 ? configured : providerPricing[id].defaultModel;
}

/**
 * Läser leverantörens felmeddelande i en kort, läsbar form.
 *
 * Status och orsak räcker för att felsöka (till exempel om en nyckel saknar
 * åtkomst till sökverktyget), utan att hela svarskroppen läcker vidare.
 */
async function readError(response: Response): Promise<string> {
  try {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: string; status?: string; details?: Array<{ reason?: string; "@type"?: string }> };
      };
      if (parsed.error) {
        const reasons = (parsed.error.details ?? [])
          .map((detail) => detail.reason ?? detail["@type"])
          .filter((detail): detail is string => typeof detail === "string")
          .slice(0, 3)
          .join(", ");
        return redactSecrets([parsed.error.status, parsed.error.message, reasons].filter(Boolean).join(" | ").slice(0, 500));
      }
    } catch {
      /* svaret var inte JSON */
    }
    return redactSecrets(body.slice(0, 300));
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ *
 * Google Gemini med Google Search-grounding
 * ------------------------------------------------------------------ */

/**
 * Googles svarskuvert, tolkat tolerant.
 *
 * Både candidates och content.parts får saknas. Google svarar HTTP 200 med ett
 * fullt läsbart kuvert även när det inte finns någon text att hämta: en
 * thinking-modell som gör slut på maxOutputTokens lämnar en candidate med
 * finishReason MAX_TOKENS och ett content utan parts. En strikt tolkning gör då
 * ett läsbart svar till ett formatfel och kastar bort finishReason, token och
 * sökningar som redan har betalats för.
 */
const googleResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            finishReason: z.string().optional(),
            content: z
              .object({ parts: z.array(z.object({ text: z.string().optional() }).passthrough()).optional() })
              .passthrough()
              .optional(),
            groundingMetadata: z
              .object({
                webSearchQueries: z.array(z.string()).optional(),
                groundingChunks: z
                  .array(
                    z
                      .object({
                        web: z
                          .object({
                            uri: z.string().optional(),
                            title: z.string().optional(),
                            domain: z.string().optional(),
                          })
                          .passthrough()
                          .optional(),
                      })
                      .passthrough(),
                  )
                  .optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    promptFeedback: z
      .object({ blockReason: z.string().optional(), blockReasonMessage: z.string().optional() })
      .passthrough()
      .optional(),
    usageMetadata: z
      .object({
        promptTokenCount: z.number().optional(),
        candidatesTokenCount: z.number().optional(),
        thoughtsTokenCount: z.number().optional(),
        toolUsePromptTokenCount: z.number().optional(),
        totalTokenCount: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type GoogleEnvelope = z.infer<typeof googleResponseSchema>;

/** En enskild candidate ur Googles svar. */
type GoogleCandidate = NonNullable<GoogleEnvelope["candidates"]>[number];

/** Användningen i ett Google-svar. Utdata räknar tänk-token, eftersom de faktureras som utdata. */
function googleUsage(usage: GoogleEnvelope["usageMetadata"]): {
  inputTokens: number | null;
  outputTokens: number | null;
  thoughtsTokens: number | null;
  toolPromptTokens: number | null;
} {
  if (!usage) return { inputTokens: null, outputTokens: null, thoughtsTokens: null, toolPromptTokens: null };
  const thoughts = usage.thoughtsTokenCount ?? null;
  const answer = usage.candidatesTokenCount ?? null;
  return {
    inputTokens: usage.promptTokenCount ?? null,
    outputTokens: answer === null && thoughts === null ? null : (answer ?? 0) + (thoughts ?? 0),
    thoughtsTokens: thoughts,
    toolPromptTokens: usage.toolUsePromptTokenCount ?? null,
  };
}

/** Värdnamnet i en url, eller en tom sträng när url:en inte går att läsa. */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Värdar som bara är omdirigeringar, inte utgivare.
 *
 * Googles sökgrounding returnerar nästan alltid sina träffar som
 * vertexaisearch.cloud.google.com/grounding-api-redirect/… . Räknas det värdet
 * som utgivare blir alla källor samma utgivare, och då kan underlaget aldrig
 * bli "Bra" eller en punkt "väldokumenterad" – oavsett hur många oberoende
 * sajter sökningen faktiskt hittade.
 */
const redirectHostPattern = /(^|\.)vertexaisearch\.cloud\.google\.com$|(^|\.)googleusercontent\.com$/;

/** Gör om ett domän- eller url-liknande värde till ett rent värdnamn. */
function cleanHost(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[\s/?#]/)[0]
    .replace(/:[0-9]+$/, "")
    .replace(/\.+$/, "");
}

/** Sant för ett riktigt värdnamn med en rimlig toppdomän – inte en omdirigering. */
function isRealHost(host: string): boolean {
  if (!host.includes(".") || redirectHostPattern.test(host)) return false;
  if (/\.xn--[a-z0-9-]{2,}$/.test(host)) return true;
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}$/.test(host);
}

/**
 * Utgivardomänen ur en fritext, till exempel en sidtitel.
 *
 * Googles `web.title` är ofta den riktiga domänen ("bobistheoilguy.com") eller
 * en sidtitel med domänen sist ("Oljetråd – saabwisonline.com"). Därför läses
 * den första domänliknande token ur titeln. En titel utan domän ger tom sträng.
 */
export function domainFromText(text: string): string {
  const value = text.trim();
  if (value.length === 0) return "";
  if (/^https?:\/\//i.test(value)) {
    const host = cleanHost(hostnameOf(value));
    return isRealHost(host) ? host : "";
  }
  for (const candidate of value.match(/[a-z0-9][a-z0-9.-]*\.[a-z]{2,24}/gi) ?? []) {
    const host = cleanHost(candidate);
    if (isRealHost(host)) return host;
  }
  return "";
}

/**
 * Den riktiga utgivardomänen för en källträff.
 *
 * Ordningen är: Googles eget domänfält, sedan domänen i titeln, och först sist
 * url:ens värdnamn. Url:en är sista utväg eftersom Googles träffar nästan alltid
 * är omdirigeringslänkar; en sådan värd godtas aldrig som utgivare. Går ingen
 * domän att avgöra lämnas den tom, och källan räknas då som okänd utgivare i
 * stället för att smitta ihop alla träffar till en påhittad utgivare.
 */
export function resolveChunkDomain(web: ChunkWeb): string {
  const declared = cleanHost(web.domain ?? "");
  if (isRealHost(declared)) return declared;
  const fromTitle = domainFromText(web.title ?? "");
  if (fromTitle) return fromTitle;
  const host = cleanHost(hostnameOf((web.uri ?? "").trim()));
  return isRealHost(host) ? host : "";
}

/** Bygger en källträff ur leverantörens råa fält. Null när url:en inte är https. */
export function groundingChunkFromWeb(web: ChunkWeb): GroundingChunk | null {
  const url = (web.uri ?? "").trim();
  if (!url.startsWith("https://")) return null;
  const domain = resolveChunkDomain(web);
  const title = (web.title?.trim() || domain || url).slice(0, 160);
  return { url, title, domain };
}

/**
 * Källträffarna i ett Google-svar, oberoende av om det fanns någon text.
 *
 * Bara https-urler behålls och dubbletter tas bort. Det är den här listan som
 * blir rapportens källor, så den får aldrig kompletteras ur minnet.
 */
function googleChunks(candidate: GoogleCandidate | undefined): GroundingChunk[] {
  const seen = new Set<string>();
  const chunks: GroundingChunk[] = [];
  for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
    const built = groundingChunkFromWeb(chunk.web ?? {});
    if (!built) continue;
    const key = built.url.replace(/#.*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    chunks.push(built);
  }
  return chunks;
}

/** Sökningarna och träffarna i ett Google-svar, oberoende av om det fanns någon text. */
function googleGrounding(candidate: GoogleCandidate | undefined) {
  const queries = candidate?.groundingMetadata?.webSearchQueries ?? [];
  return { chunks: googleChunks(candidate), queries };
}

/**
 * Antal sökningar i ett Google-svar.
 *
 * Modellen bestämmer själv om sökverktyget ska användas, och Google har ingen
 * inställning som tvingar fram en sökning. Sökfrågorna i groundingMetadata är
 * det exakta antalet; saknas de räknas källänkarna, och som sista spår används
 * toolUsePromptTokenCount, som räknas upp när sökresultat läggs in i prompten.
 * Utan det spåret ser en körning som faktiskt sökte ut som en körning utan
 * sökning, bara för att groundingMetadata saknas i svaret.
 */
function googleSearchCount(queries: number, groundingUrls: number, toolPromptTokens: number | null): number {
  if (queries > 0) return queries;
  if (groundingUrls > 0) return groundingUrls;
  return toolPromptTokens !== null && toolPromptTokens > 0 ? 1 : 0;
}

/**
 * Läser Googles svar en gång: både den tolkade strukturen och en kortad,
 * nyckelrensad råtext som går att spara för felsökning.
 */
async function readGoogleEnvelope(response: Response): Promise<{ data: unknown; raw: string }> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }
  const raw = redactSecrets(body).slice(0, rawResponseLimit);
  if (body.trim().length === 0) {
    throw new ProviderError("PROVIDER_INVALID_JSON", `Google svarade med en tom svarskropp (HTTP ${response.status}).`, {
      kind: "invalid_json",
      status: response.status,
      diagnostics: { rawResponse: raw },
    });
  }
  try {
    return { data: JSON.parse(body) as unknown, raw };
  } catch {
    throw new ProviderError(
      "PROVIDER_INVALID_JSON",
      `Google svarade med något som inte är giltig JSON (HTTP ${response.status}).`,
      { kind: "invalid_json", status: response.status, diagnostics: { rawResponse: raw } },
    );
  }
}

/**
 * Förklarar i klartext varför ett Google-svar saknade text, med de siffror som
 * gör orsaken begriplig. finishReason följer alltid med, eftersom MAX_TOKENS
 * (tänkandet åt upp hela utdatabudgeten) kräver en helt annan åtgärd än SAFETY
 * eller RECITATION.
 */
function emptyAnswerMessage(input: {
  finishReason: string | null;
  blockReason: string | null;
  searches: number;
  inputTokens: number | null;
  outputTokens: number | null;
  thoughtsTokens: number | null;
}): string {
  const facts = [
    `finishReason: ${input.finishReason ?? "saknas"}`,
    input.blockReason ? `blockReason: ${input.blockReason}` : null,
    `${input.searches} sökningar`,
    `indata ${input.inputTokens ?? "saknas"} token`,
    `utdata ${input.outputTokens ?? "saknas"} token`,
    `varav tänk ${input.thoughtsTokens ?? "saknas"} token`,
  ]
    .filter((part): part is string => part !== null)
    .join(", ");
  const hint =
    input.finishReason === "MAX_TOKENS"
      ? " Tänk-token räknas mot maxOutputTokens, så tänkandet gjorde slut på hela utdatabudgeten innan svaret började. Sänk tänkandet eller höj maxOutputTokens."
      : "";
  return `Google svarade utan textinnehåll (EMPTY_RESPONSE, ${facts}).${hint}`;
}

/**
 * Tänkandet i ett Google-anrop.
 *
 * Google har två styrningar: Gemini 2.5 tar thinkingBudget (antal tänk-token),
 * Gemini 3 och 4 tar thinkingLevel (minimal/låg/medium/hög). Fel parameter för
 * fel familj ger ett 400-svar, så valet görs på modellnamnet. Tänk-token räknas
 * alltid mot maxOutputTokens, därför hålls tänkandet lågt: utrymmet ska räcka
 * till själva rapportens JSON, inte till intern resonemangstext.
 */
export function googleThinkingConfig(model: string, budgetTokens: number): Record<string, unknown> | null {
  const name = shortModelName(model).toLowerCase();
  if (/^gemini-(3|4)/.test(name)) return { thinkingLevel: "low" };
  if (/^gemini-2\.5/.test(name)) return { thinkingBudget: budgetTokens };
  return null;
}

/** Läser människoformulerat vad tänkandet är inställt på, för /admin. */
export function describeGoogleThinking(model: string, budgetTokens: number): string {
  const config = googleThinkingConfig(model, budgetTokens);
  if (!config) return "Modellen styr tänkandet själv (ingen tänkande-inställning skickas).";
  if ("thinkingLevel" in config) return `thinkingLevel=low (Gemini 3/4: lågt tänkande, utrymme kvar till svaret).`;
  return `thinkingBudget=${budgetTokens} (Gemini 2.5: högst ${budgetTokens} tänk-token, resten kvar till svaret).`;
}

/** Tänk-budget för Gemini 2.5-modeller (gäller hela 2.5-familjen). */
export const googleThinkingBudgetTokens = 4096;

/**
 * Hur stort svarsutrymme ett riktigt rapportanrop får. Tänk-token räknas in i
 * samma tak, så taket måste rymma både tänkandet och hela rapportens JSON.
 */
export const googleReportMaxOutputTokens = 32_768;

/**
 * Svarsutrymme för söksteget. Steget svarar med en sammanfattning på 250–500
 * ord, inte med JSON, så taket kan vara mindre än rapportens – men det måste
 * ändå rymma tänkandet.
 */
export const googleSearchMaxOutputTokens = 8_192;

/**
 * Utrymme för testanropet i /admin. Taket måste rymma tänkandet med marginal:
 * ett tak på 64 token gjorde att tänk-token åt upp hela budgeten och svaret
 * kom tillbaka utan parts, vilket såg ut som ett formatfel i stället för ett
 * slut på utrymme.
 */
export const googleProbeMaxOutputTokens = 1024;

/** Tänk-budget för testanropet på en Gemini 2.5-modell. */
export const googleProbeThinkingBudgetTokens = 512;

/** Google-anropet med sökverktyget påslaget. Steg 1: söka, inte skriva. */
async function googleSearch(request: SearchRequest): Promise<SearchResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new ProviderError("PROVIDER_NOT_CONFIGURED", "GOOGLE_API_KEY saknas på servern.", {
      kind: "provider_not_configured",
    });
  }
  const model = request.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const thinking = googleThinkingConfig(model, googleThinkingBudgetTokens);
  /* Hela användarmeddelandet – inklusive bilens JSON och, vid omförsöket, den
     tvingande extra meningen – byggs av anroparen (buildSearchUserMessage), så
     att exakt den text som skickades kan sparas i felspåret. */
  const userMessage = request.userMessage;
  const response = await runWithHardTimeout(request.timeoutMs, "Google-sökningen", (signal) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: googleSearchMaxOutputTokens,
          ...(thinking ? { thinkingConfig: thinking } : {}),
        },
      }),
      signal,
    }),
  );
  if (!response.ok) {
    throw new ProviderError("PROVIDER_FAILED", `Google svarade ${response.status}: ${await readError(response)}`, {
      kind: "provider_error",
      status: response.status,
    });
  }

  /* Svarskroppen läses i sin helhet en gång, så att finishReason, token,
     sökningar och den råa strukturen finns kvar även när texten saknas. */
  const { data: rawData, raw } = await readGoogleEnvelope(response);
  const parsed = googleResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "roten"}: ${issue.message}`)
      .join("; ");
    throw new ProviderError("PROVIDER_UNEXPECTED_SHAPE", `Google svarade med en oväntad struktur: ${issues}`, {
      kind: "provider_error",
      status: response.status,
      diagnostics: { rawResponse: raw },
    });
  }

  const envelope = parsed.data;
  const candidate = envelope.candidates?.[0];
  const usage = googleUsage(envelope.usageMetadata);
  const { chunks, queries } = googleGrounding(candidate);
  const searches = googleSearchCount(queries.length, chunks.length, usage.toolPromptTokens);
  const finishReason = candidate?.finishReason ?? null;
  const blockReason = envelope.promptFeedback?.blockReason ?? null;
  const diagnostics: ProviderDiagnostics = {
    searches,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    finishReason,
    rawResponse: raw,
  };

  const answer = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("");

  /* Blockerat svar och tomt svar är två olika saker: det första betyder att
     Google vägrade, det andra att svaret kom tillbaka utan text. Båda behåller
     användningen, annars ser en betald körning ut som gratis i /admin. */
  if (blockReason) {
    throw new ProviderError(
      "PROVIDER_BLOCKED",
      `Svaret blockerades: ${blockReason}${
        envelope.promptFeedback?.blockReasonMessage ? ` – ${envelope.promptFeedback.blockReasonMessage}` : ""
      }`,
      { kind: "provider_blocked", status: response.status, diagnostics },
    );
  }
  /* Ett svar utan text men med källänkar är användbart: skrivsteget kan bygga
     rapporten ur källistan. Först när både text och källänkar saknas är svaret
     oanvändbart. */
  if (answer.trim().length === 0 && chunks.length === 0) {
    throw new ProviderError(
      "EMPTY_RESPONSE",
      emptyAnswerMessage({
        finishReason,
        blockReason,
        searches,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        thoughtsTokens: usage.thoughtsTokens,
      }),
      { kind: "empty_response", status: response.status, diagnostics },
    );
  }

  return {
    provider: "google",
    model,
    text: answer,
    searches,
    chunks,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    finishReason,
    toolPromptTokens: usage.toolPromptTokens,
  };
}

/**
 * Google-anropet utan sökverktyg. Steg 2: skriva rapporten ur fynden.
 *
 * Verktyget skickas med flit inte med här. Ett söksteg och ett skrivsteg som
 * inte kan söka är det som gör att källistan i rapporten exakt motsvarar det
 * sökningen faktiskt returnerade.
 */
async function googleWrite(request: WriteRequest): Promise<WriteResult> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new ProviderError("PROVIDER_NOT_CONFIGURED", "GOOGLE_API_KEY saknas på servern.", {
      kind: "provider_not_configured",
    });
  }
  const model = request.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const thinking = googleThinkingConfig(model, googleThinkingBudgetTokens);
  const response = await runWithHardTimeout(request.timeoutMs, "Google-skrivningen", (signal) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: request.userMessage }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: googleReportMaxOutputTokens,
          ...(thinking ? { thinkingConfig: thinking } : {}),
        },
      }),
      signal,
    }),
  );
  if (!response.ok) {
    throw new ProviderError("PROVIDER_FAILED", `Google svarade ${response.status}: ${await readError(response)}`, {
      kind: "provider_error",
      status: response.status,
    });
  }

  const { data: rawData, raw } = await readGoogleEnvelope(response);
  const parsed = googleResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "roten"}: ${issue.message}`)
      .join("; ");
    throw new ProviderError("PROVIDER_UNEXPECTED_SHAPE", `Google svarade med en oväntad struktur: ${issues}`, {
      kind: "provider_error",
      status: response.status,
      diagnostics: { rawResponse: raw },
    });
  }

  const envelope = parsed.data;
  const candidate = envelope.candidates?.[0];
  const usage = googleUsage(envelope.usageMetadata);
  const finishReason = candidate?.finishReason ?? null;
  const blockReason = envelope.promptFeedback?.blockReason ?? null;
  const diagnostics: ProviderDiagnostics = {
    searches: 0,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    finishReason,
    rawResponse: raw,
  };
  const answer = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("");

  if (blockReason) {
    throw new ProviderError(
      "PROVIDER_BLOCKED",
      `Svaret blockerades: ${blockReason}${
        envelope.promptFeedback?.blockReasonMessage ? ` – ${envelope.promptFeedback.blockReasonMessage}` : ""
      }`,
      { kind: "provider_blocked", status: response.status, diagnostics },
    );
  }
  if (answer.trim().length === 0) {
    throw new ProviderError(
      "EMPTY_RESPONSE",
      emptyAnswerMessage({
        finishReason,
        blockReason,
        searches: 0,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        thoughtsTokens: usage.thoughtsTokens,
      }),
      { kind: "empty_response", status: response.status, diagnostics },
    );
  }

  return {
    provider: "google",
    model,
    text: answer,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    finishReason,
  };
}

/* ------------------------------------------------------------------ *
 * Modellkontroll (Google) och grounding-test
 * ------------------------------------------------------------------ */

/** Ett namn ur Googles modellista, så som listan svarar. */
export type GoogleModelInfo = { name: string; supportedGenerationMethods: string[] };

const modelsListSchema = z
  .object({
    models: z
      .array(
        z
          .object({
            name: z.string().optional(),
            supportedGenerationMethods: z.array(z.string()).optional(),
          })
          .passthrough(),
      )
      .optional(),
    nextPageToken: z.string().optional(),
  })
  .passthrough();

const googleModelsUrl = "https://generativelanguage.googleapis.com/v1beta/models";
/** Modellistan hämtas högst var tionde minut: den ändras sällan och kostar ett anrop. */
const googleModelCacheTtlMs = 10 * 60 * 1000;
let googleModelCache: { at: number; models: GoogleModelInfo[] } | null = null;

function shortModelName(name: string): string {
  return name.replace(/^models\//, "");
}

/** Hämtar Googles modellista. Kastar ProviderError vid nätverks- eller HTTP-fel. */
export async function listGoogleModels(apiKey: string, timeoutMs = 20_000): Promise<GoogleModelInfo[]> {
  const cached = googleModelCache;
  if (cached && Date.now() - cached.at < googleModelCacheTtlMs) return cached.models;

  const collected: GoogleModelInfo[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 3; page += 1) {
    const url = new URL(googleModelsUrl);
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await runWithHardTimeout(timeoutMs, "Modellistan", (signal) =>
      fetch(url.toString(), { headers: { "x-goog-api-key": apiKey }, signal }),
    );
    if (!response.ok) {
      throw new ProviderError("PROVIDER_FAILED", `Modellistan svarade ${response.status}: ${await readError(response)}`, {
        kind: "provider_error",
        status: response.status,
      });
    }
    const data = parseEnvelope(modelsListSchema, await readJsonResponse(response, "Modellistan"), "Modellistan");
    for (const model of data.models ?? []) {
      if (typeof model.name === "string" && model.name.length > 0) {
        collected.push({ name: shortModelName(model.name), supportedGenerationMethods: model.supportedGenerationMethods ?? [] });
      }
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  if (collected.length === 0) {
    throw new ProviderError("PROVIDER_FAILED", "Modellistan var tom.", { kind: "provider_error" });
  }
  googleModelCache = { at: Date.now(), models: collected };
  return collected;
}

/**
 * Modellfamiljer där Google Search-grounding är dokumenterat stödd.
 *
 * Google har inget fält i modellistan som säger vilka verktyg en modell tar,
 * så det här är en familjekontroll byggd på Googles grounding-dokumentation.
 * Den används bara som varning – ett riktigt anrop med verktyget i /admin är
 * det som avgör saken.
 */
export function googleSearchGroundingSupported(model: string): boolean {
  const name = shortModelName(model).toLowerCase();
  if (name === "gemini-flash-latest" || name === "gemini-pro-latest") return true;
  return /^gemini-(2\.5|3|4)/.test(name);
}

export type GoogleModelCheck = {
  configuredModel: string;
  modelExists: boolean;
  supportsGenerateContent: boolean;
  groundingSupported: boolean;
  suggestions: string[];
  modelsAvailable: string[];
  /** Feltext när själva listningen inte gick att göra. Då är modelExists inte tillförlitligt. */
  listFailed: string | null;
};

/** Kontrollerar LLM_MODEL mot Googles egen modellista. Ingen nyckel lämnar servern. */
export async function checkGoogleModel(model: string, timeoutMs = 20_000): Promise<GoogleModelCheck> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new ProviderError("PROVIDER_NOT_CONFIGURED", "GOOGLE_API_KEY saknas på servern.", {
      kind: "provider_not_configured",
    });
  }
  const configuredModel = shortModelName(model);

  let models: GoogleModelInfo[] = [];
  let listFailed: string | null = null;
  try {
    models = await listGoogleModels(apiKey, timeoutMs);
  } catch (error) {
    listFailed = error instanceof Error ? error.message : "Modellistan kunde inte hämtas.";
  }

  const names = models.map((entry) => entry.name).sort();
  const match = models.find((entry) => entry.name === configuredModel);
  const wanted = configuredModel.split("-");
  const suggestions = names
    .filter((name) => wanted.some((part) => part.length > 2 && name.includes(part)))
    .slice(0, 6);

  return {
    configuredModel,
    modelExists: Boolean(match),
    supportsGenerateContent: Boolean(match?.supportedGenerationMethods.includes("generateContent")),
    groundingSupported: googleSearchGroundingSupported(configuredModel),
    suggestions: suggestions.length > 0 ? suggestions : names.filter((name) => name.startsWith("gemini")).slice(0, 6),
    modelsAvailable: names,
    listFailed,
  };
}

export type GroundingProbe = {
  /** ok = Google svarade med text, rejected = Google avvisade, unreadable = svaret gick inte att tolka. */
  outcome: "ok" | "rejected" | "unreadable";
  /** Maskinkod för det som hände, till exempel OK, PROVIDER_FAILED eller EMPTY_RESPONSE. */
  code: string;
  ok: boolean;
  status: number | null;
  message: string;
  /** Om anropet gjordes med sökverktyget påslaget. */
  withSearchTool: boolean;
  finishReason: string | null;
  blockReason: string | null;
  searches: number;
  inputTokens: number | null;
  outputTokens: number | null;
  thoughtsTokens: number | null;
  /** Modellens text, kortad. Tom när svaret saknade text. */
  text: string;
  /** Kortad, nyckelrensad rå svarsstruktur. Satt när texten saknas. */
  rawResponse: string | null;
  durationMs: number;
};

/**
 * Gör ett litet, riktigt anrop mot Google för att se vad som faktiskt händer:
 * med sökverktyget påslaget för att avgöra om modellen tar emot Google
 * Search-grounding, och utan verktyget för att avgöra om ett fel sitter i
 * verktyget eller i tolkningen av svaret. Anropet är litet men inte gratis.
 */
export async function probeGoogle(
  model: string,
  options: { withSearchTool: boolean; timeoutMs?: number },
): Promise<GroundingProbe> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const startedAt = Date.now();
  const base: GroundingProbe = {
    outcome: "rejected",
    code: "PROVIDER_FAILED",
    ok: false,
    status: null,
    message: "",
    withSearchTool: options.withSearchTool,
    finishReason: null,
    blockReason: null,
    searches: 0,
    inputTokens: null,
    outputTokens: null,
    thoughtsTokens: null,
    text: "",
    rawResponse: null,
    durationMs: 0,
  };
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return { ...base, code: "PROVIDER_NOT_CONFIGURED", message: "GOOGLE_API_KEY saknas på servern." };
  }
  const thinking = googleThinkingConfig(model, googleProbeThinkingBudgetTokens);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(shortModelName(model))}:generateContent`;
    const response = await runWithHardTimeout(timeoutMs, "Grounding-testet", (signal) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          /* Testet ber modellen att faktiskt söka. Google låter modellen avgöra
             själv om sökverktyget ska användas, så en trivial fråga kan besvaras
             utan sökning – och då säger testet inget om sökningen. Antalet
             sökningar i panelen visar svaret. */
          contents: [
            {
              role: "user",
              parts: [{ text: "Sök med sökverktyget efter vilket datum det är i dag och svara sedan med bara datumet." }],
            },
          ],
          ...(options.withSearchTool ? { tools: [{ google_search: {} }] } : {}),
          generationConfig: {
            temperature: 0,
            maxOutputTokens: googleProbeMaxOutputTokens,
            ...(thinking ? { thinkingConfig: thinking } : {}),
          },
        }),
        signal,
      }),
    );
    const durationMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ...base,
        status: response.status,
        message: `Google svarade HTTP ${response.status}: ${await readError(response)}`,
        durationMs,
      };
    }

    /* Svaret läses tolerant: även utan text finns finishReason, token och
       sökningar kvar att visa, så att det går att se skillnad på "Google
       avvisade" och "svaret gick inte att tolka". */
    const { data: rawData, raw } = await readGoogleEnvelope(response);
    const parsed = googleResponseSchema.safeParse(rawData);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "roten"}: ${issue.message}`)
        .join("; ");
      return {
        ...base,
        outcome: "unreadable",
        code: "PROVIDER_UNEXPECTED_SHAPE",
        status: response.status,
        message: `Google svarade med en struktur som inte gick att tolka: ${issues}`,
        rawResponse: raw,
        durationMs,
      };
    }

    const envelope = parsed.data;
    const candidate = envelope.candidates?.[0];
    const usage = googleUsage(envelope.usageMetadata);
    const { chunks, queries } = googleGrounding(candidate);
    const searches = googleSearchCount(queries.length, chunks.length, usage.toolPromptTokens);
    const finishReason = candidate?.finishReason ?? null;
    const blockReason = envelope.promptFeedback?.blockReason ?? null;
    const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("").trim();
    const facts = {
      status: response.status,
      finishReason,
      blockReason,
      searches,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      thoughtsTokens: usage.thoughtsTokens,
      durationMs,
    };

    if (blockReason) {
      return {
        ...base,
        ...facts,
        outcome: "rejected",
        code: "PROVIDER_BLOCKED",
        message: `Google blockerade anropet: ${blockReason}.`,
        rawResponse: raw,
      };
    }

    if (text.length === 0) {
      return {
        ...base,
        ...facts,
        outcome: "unreadable",
        code: "EMPTY_RESPONSE",
        message: emptyAnswerMessage({ finishReason, blockReason, searches, ...usage }),
        rawResponse: raw,
      };
    }

    return {
      ...base,
      ...facts,
      outcome: "ok",
      code: "OK",
      ok: true,
      message: options.withSearchTool
        ? "Google tog emot sökverktyget och svarade med text."
        : "Anropet utan sökverktyg svarade med text.",
      text: text.slice(0, 200),
    };
  } catch (error) {
    const failure = error instanceof ProviderError ? error : null;
    return {
      ...base,
      outcome: failure?.kind === "empty_response" ? "unreadable" : "rejected",
      code: failure?.code ?? "PROVIDER_UNREACHABLE",
      status: failure?.status ?? null,
      message: failure?.message ?? (error instanceof Error ? error.message : "Ovkänt fel i grounding-testet."),
      finishReason: failure?.diagnostics.finishReason ?? null,
      searches: failure?.diagnostics.searches ?? 0,
      inputTokens: failure?.diagnostics.inputTokens ?? null,
      outputTokens: failure?.diagnostics.outputTokens ?? null,
      rawResponse: failure?.diagnostics.rawResponse ?? null,
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Kontrollerar att modellnamnet finns hos leverantören innan ett anrop görs.
 *
 * Bara Google har en modellista vi kan lita på här. Går listan inte att hämta
 * släpps anropet igenom och en varning returneras – kontrollen är en besparing,
 * inte en grind. Returnerar en varningstext när modellen finns men något är
 * osäkert, annars null.
 */
export async function assertProviderModel(provider: ProviderId, model: string): Promise<string | null> {
  if (provider !== "google" || !process.env.GOOGLE_API_KEY) return null;

  const check = await checkGoogleModel(model).catch(() => null);
  if (!check) return "Modellkontrollen mot Googles modellista kunde inte genomföras.";
  if (check.listFailed) return `Modellkontrollen mot Googles modellista misslyckades: ${check.listFailed}`;

  if (!check.modelExists) {
    throw new ProviderError(
      "PROVIDER_MODEL_UNKNOWN",
      `Modellnamnet "${model}" finns inte i Googles modellista. Tillgängliga namn: ${check.suggestions.join(", ") || "listan var tom"}.`,
      { kind: "provider_model_unknown" },
    );
  }
  if (!check.supportsGenerateContent) {
    throw new ProviderError(
      "PROVIDER_MODEL_UNKNOWN",
      `Modellen "${model}" tar enligt Googles modellista inte emot generateContent.`,
      { kind: "provider_model_unknown" },
    );
  }
  if (!check.groundingSupported) {
    return `Google Search-grounding är inte dokumenterat stödd för "${model}". Kontrollera modellnamnet i LLM_MODEL.`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * OpenAI Responses med web_search
 * ------------------------------------------------------------------ */

const openaiResponseSchema = z
  .object({
    output: z
      .array(
        z
          .object({
            type: z.string(),
            content: z
              .array(
                z
                  .object({
                    type: z.string(),
                    text: z.string().optional(),
                    annotations: z
                      .array(z.object({ url: z.string().optional(), title: z.string().optional() }).passthrough())
                      .optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).passthrough().optional(),
    error: z.object({ message: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

/** Bygger en källträff ur en annotering, med domänen ur url:ens värdnamn. */
function chunkFromAnnotation(annotation: { url?: string; title?: string }): GroundingChunk | null {
  const url = annotation.url?.trim() ?? "";
  if (!url.startsWith("https://")) return null;
  const domain = hostnameOf(url);
  return { url, domain, title: (annotation.title?.trim() || domain || url).slice(0, 160) };
}

/** Ett anrop till OpenAI Responses, med eller utan web_search-verktyget. */
async function openaiCall(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  timeoutMs: number;
  withSearchTool: boolean;
  label: string;
}): Promise<z.infer<typeof openaiResponseSchema>> {
  const response = await runWithHardTimeout(input.timeoutMs, input.label, (signal) =>
    fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({
        model: input.model,
        instructions: input.systemPrompt,
        input: input.userMessage,
        ...(input.withSearchTool ? { tools: [{ type: "web_search" }] } : {}),
        max_output_tokens: 8000,
      }),
      signal,
    }),
  );
  if (!response.ok) {
    throw new ProviderError("PROVIDER_FAILED", `OpenAI svarade ${response.status}: ${await readError(response)}`, {
      kind: "provider_error",
      status: response.status,
    });
  }
  const data = parseEnvelope(openaiResponseSchema, await readJsonResponse(response, "OpenAI"), "OpenAI");
  if (data.error?.message) {
    throw new ProviderError("PROVIDER_FAILED", redactSecrets(data.error.message), { kind: "provider_error" });
  }
  return data;
}

/** Steg 1 hos OpenAI: web_search-verktyget och en sammanfattning av fynden. */
async function openaiSearch(request: SearchRequest): Promise<SearchResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("PROVIDER_NOT_CONFIGURED", "OPENAI_API_KEY saknas på servern.", {
      kind: "provider_not_configured",
    });
  }
  const model = request.model;
  const userMessage = request.userMessage;
  const data = await openaiCall({ apiKey, model, systemPrompt: request.systemPrompt, userMessage, timeoutMs: request.timeoutMs, withSearchTool: true, label: "OpenAI-sökningen" });
  const items = data.output ?? [];
  const messageParts = items.flatMap((item) => (item.type === "message" ? (item.content ?? []) : []));
  const answer = messageParts
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("");

  const seen = new Set<string>();
  const chunks: GroundingChunk[] = [];
  for (const annotation of messageParts.flatMap((part) => part.annotations ?? [])) {
    const chunk = chunkFromAnnotation(annotation);
    if (!chunk || seen.has(chunk.url)) continue;
    seen.add(chunk.url);
    chunks.push(chunk);
  }

  if (answer.trim().length === 0 && chunks.length === 0) {
    throw new ProviderError("PROVIDER_EMPTY", "OpenAI returnerade ett tomt svar.", { kind: "provider_empty" });
  }

  return {
    provider: "openai",
    model,
    text: answer,
    searches: items.filter((item) => item.type === "web_search_call").length,
    chunks,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
  };
}

/** Steg 2 hos OpenAI: samma anrop utan verktyg. */
async function openaiWrite(request: WriteRequest): Promise<WriteResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("PROVIDER_NOT_CONFIGURED", "OPENAI_API_KEY saknas på servern.", {
      kind: "provider_not_configured",
    });
  }
  const model = request.model;
  const data = await openaiCall({ apiKey, model, systemPrompt: request.systemPrompt, userMessage: request.userMessage, timeoutMs: request.timeoutMs, withSearchTool: false, label: "OpenAI-skrivningen" });
  const answer = (data.output ?? [])
    .flatMap((item) => (item.type === "message" ? (item.content ?? []) : []))
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("");
  if (answer.trim().length === 0) {
    throw new ProviderError("PROVIDER_EMPTY", "OpenAI returnerade ett tomt svar.", { kind: "provider_empty" });
  }
  return {
    provider: "openai",
    model,
    text: answer,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Anthropic Messages med web_search
 * ------------------------------------------------------------------ */

const anthropicResponseSchema = z
  .object({
    content: z
      .array(
        z
          .object({
            type: z.string(),
            text: z.string().optional(),
            content: z.unknown().optional(),
            url: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    usage: z
      .object({
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
        server_tool_use: z.object({ web_search_requests: z.number().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    error: z.object({ message: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

/** Plockar källträffar ur sökresultatblocken, oavsett hur de är nästlade. */
function collectChunks(value: unknown, found: Map<string, GroundingChunk>) {
  if (typeof value === "string") {
    if (value.startsWith("https://") && !found.has(value)) {
      const domain = hostnameOf(value);
      found.set(value, { url: value, domain, title: domain || value });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectChunks(entry, found);
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.url === "string" && record.url.startsWith("https://")) {
      const existing = found.get(record.url);
      const domain = hostnameOf(record.url);
      const title = (typeof record.title === "string" && record.title.trim()) || existing?.title || domain || record.url;
      found.set(record.url, { url: record.url, domain, title: title.slice(0, 160) });
    }
    for (const entry of Object.values(record)) {
      if (typeof entry === "object" && entry !== null) collectChunks(entry, found);
    }
  }
}

/** Ett anrop till Anthropic Messages, med eller utan web_search-verktyget. */
async function anthropicCall(input: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  timeoutMs: number;
  maxSearches: number;
  withSearchTool: boolean;
  label: string;
}): Promise<z.infer<typeof anthropicResponseSchema>> {
  const response = await runWithHardTimeout(input.timeoutMs, input.label, (signal) =>
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": input.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 8000,
        system: input.systemPrompt,
        messages: [{ role: "user", content: input.userMessage }],
        ...(input.withSearchTool
          ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: input.maxSearches }] }
          : {}),
      }),
      signal,
    }),
  );
  if (!response.ok) {
    throw new ProviderError("PROVIDER_FAILED", `Anthropic svarade ${response.status}: ${await readError(response)}`, {
      kind: "provider_error",
      status: response.status,
    });
  }
  const data = parseEnvelope(anthropicResponseSchema, await readJsonResponse(response, "Anthropic"), "Anthropic");
  if (data.error?.message) {
    throw new ProviderError("PROVIDER_FAILED", redactSecrets(data.error.message), { kind: "provider_error" });
  }
  return data;
}

/** Steg 1 hos Anthropic: web_search och en sammanfattning av fynden. */
async function anthropicSearch(request: SearchRequest): Promise<SearchResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ProviderError("PROVIDER_NOT_CONFIGURED", "ANTHROPIC_API_KEY saknas på servern.", {
      kind: "provider_not_configured",
    });
  }
  const model = request.model;
  const userMessage = request.userMessage;
  const data = await anthropicCall({
    apiKey,
    model,
    systemPrompt: request.systemPrompt,
    userMessage,
    timeoutMs: request.timeoutMs,
    maxSearches: request.maxSearches,
    withSearchTool: true,
    label: "Anthropic-sökningen",
  });
  const blocks = data.content ?? [];
  const answer = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  const found = new Map<string, GroundingChunk>();
  for (const block of blocks) {
    if (block.type === "web_search_tool_result") collectChunks(block.content, found);
  }
  const chunks = [...found.values()];

  if (answer.trim().length === 0 && chunks.length === 0) {
    throw new ProviderError("PROVIDER_EMPTY", "Anthropic returnerade ett tomt svar.", { kind: "provider_empty" });
  }

  return {
    provider: "anthropic",
    model,
    text: answer,
    searches: data.usage?.server_tool_use?.web_search_requests ?? (chunks.length > 0 ? 1 : 0),
    chunks,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
  };
}

/** Steg 2 hos Anthropic: samma anrop utan verktyg. */
async function anthropicWrite(request: WriteRequest): Promise<WriteResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ProviderError("PROVIDER_NOT_CONFIGURED", "ANTHROPIC_API_KEY saknas på servern.", {
      kind: "provider_not_configured",
    });
  }
  const model = request.model;
  const data = await anthropicCall({
    apiKey,
    model,
    systemPrompt: request.systemPrompt,
    userMessage: request.userMessage,
    timeoutMs: request.timeoutMs,
    maxSearches: 0,
    withSearchTool: false,
    label: "Anthropic-skrivningen",
  });
  const answer = (data.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  if (answer.trim().length === 0) {
    throw new ProviderError("PROVIDER_EMPTY", "Anthropic returnerade ett tomt svar.", { kind: "provider_empty" });
  }
  return {
    provider: "anthropic",
    model,
    text: answer,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Lokal testleverantör
 * ------------------------------------------------------------------ */

type FixtureSource = {
  id: string;
  url: string;
  title: string;
  publisher: string;
  source_type: string;
  retrieved_at: string;
};

/**
 * Bygger ett komplett, schemagiltigt rapportsvar utan nätverksanrop.
 *
 * Används för automatisk verifiering av pipelinen (programmatiska kontroller,
 * cache, statuslogg) och märker alltid innehållet som en testkörning, så att
 * ett testresultat aldrig kan förväxlas med en riktig rapport.
 */
function fixtureReport(vehicle: Vehicle, searches: number) {
  const today = new Date().toISOString().slice(0, 10);
  const label = `${vehicle.make} ${vehicle.model} ${vehicle.year}`;
  const sources: FixtureSource[] = [
    { id: "s1", url: "https://example.com/test/tillverkaren/service", title: `Testkälla: serviceinformation för ${label}`, publisher: "Testtillverkaren", source_type: "official", retrieved_at: today },
    { id: "s2", url: "https://example.com/test/statistik/agarsammanstallning", title: "Testkälla: sammanställning av ägarrapporter", publisher: "Teststatistik", source_type: "statistics", retrieved_at: today },
    { id: "s3", url: "https://example.com/test/verkstaden/erfarenheter", title: "Testkälla: verkstadserfarenheter", publisher: "Testverkstaden", source_type: "workshop", retrieved_at: today },
    { id: "s4", url: "https://example.com/test/tidningen/kopguide", title: "Testkälla: köpguide", publisher: "Testtidningen", source_type: "media", retrieved_at: today },
    { id: "s5", url: "https://example.com/test/forumet/agartrad", title: "Testkälla: ägartråd", publisher: "Testforumet", source_type: "owner_forum", retrieved_at: today },
  ];
  const issueBase = {
    cost_range_sek: null as { min: number; max: number } | null,
    cost_basis: null as string | null,
    safety_related: false,
  };
  const issues = [
    { ...issueBase, id: "bromsar", title: "Bromsar fram kan pulsera", symptoms: "Pulsering i pedalen vid lätt bromsning.", how_to_check: "Bromsa mjukt från låg fart och känn efter pulser.", typical_onset: "Ofta någon gång mellan 60 000 och 120 000 km.", applies_to: `Testvariant av ${label}.`, cost_range_sek: { min: 3500, max: 9000 }, cost_basis: "source", severity: "high", safety_related: true, confidence: "well_documented", evidence_summary: "Två oberoende testkällor beskriver samma sak.", source_ids: ["s1", "s3"] },
    { ...issueBase, id: "service", title: "Serviceunderlag att följa upp", symptoms: "Luckor i historiken.", how_to_check: "Jämför servicedatum mot mätarställningen.", typical_onset: "Gäller hela bilens liv.", applies_to: "Alla exemplar i testkörningen.", severity: "high", confidence: "reported", evidence_summary: "Testkällorna tar upp historiken.", source_ids: ["s2"] },
    { ...issueBase, id: "vaxellada", title: "Växellådan kan rycka i låg fart", symptoms: "Ryck vid växling i krypfart.", how_to_check: "Provkör kall bil i krypfart.", typical_onset: "Rapporteras från omkring 80 000 km.", applies_to: `Testvariant av ${label} med ${vehicle.gearbox}.`, cost_range_sek: { min: 6000, max: 24000 }, cost_basis: "estimate", severity: "medium", confidence: "well_documented", evidence_summary: "Två testkällor beskriver ryckig växling.", source_ids: ["s3", "s4"] },
    { ...issueBase, id: "lackage", title: "Oljeläckage kring motorn", symptoms: "Spår av olja under bilen.", how_to_check: "Kontrollera motorn kall och titta under bilen.", typical_onset: "Från omkring 70 000 km.", applies_to: `Testvariant av ${label} med ${vehicle.engine}.`, cost_range_sek: { min: 2500, max: 11000 }, cost_basis: "estimate", severity: "medium", confidence: "reported", evidence_summary: "Verkstadskällan beskriver återkommande läckage.", source_ids: ["s3"] },
    { ...issueBase, id: "fukt", title: "Fukt i bagageutrymmet", symptoms: "Imma och unken lukt.", how_to_check: "Lyft bagagerumsmattan och leta efter fukt.", typical_onset: "Smygande med åren.", applies_to: "Karossen i testkörningen.", severity: "medium", confidence: "uncertain", evidence_summary: "Endast en enstaka ägardiskussion tar upp detta.", source_ids: ["s5"] },
    { ...issueBase, id: "klimatanlaggning", title: "Klimatanläggningen kan tappa kyleffekt", symptoms: "Svag kyla på lägsta temperatur.", how_to_check: "Starta bilen och kontrollera att kylan kommer snabbt.", typical_onset: "När som helst, ofta kopplat till servicehistoriken.", applies_to: "Alla exemplar i testkörningen.", cost_range_sek: { min: 1500, max: 7000 }, cost_basis: "estimate", severity: "low", confidence: "reported", evidence_summary: "Mediekällan beskriver kontrollen.", source_ids: ["s4"] },
  ];

  return {
    schema_version: "2.0",
    report_id: `TEST-${vehicle.make.slice(0, 4).toUpperCase()}-${vehicle.year}`.slice(0, 40),
    generated_at: new Date().toISOString(),
    variant_status: "partial",
    assumptions: ["Testkörning: rapporten är genererad av en lokal testleverantör och beskriver ingen verklig bil."],
    vehicle,
    summary: {
      text: `TESTKÖRNING. Det här svaret kommer från den lokala testleverantören och beskriver ingen verklig bil. Det används för att verifiera att pipelinen, de programmatiska kontrollerna och cacheflödet fungerar för ${label}.`,
      risk_level: "medium",
      risk_score: 42,
      top_checks: ["Kontrollera serviceunderlaget.", "Provkör kallt och varmt.", "Kontrollera bromsarna."],
    },
    research_summary: { searches_run: searches, sources_used: sources.length, coverage: "partial", notes: "Testkörning utan nätverksanrop." },
    known_issues: issues,
    good_to_know: ["Testkörning: innehållet är inte en verklig bedömning.", "Källor och punkter är platshållare.", "Används bara för verifiering."],
    checklist: Array.from({ length: 12 }, (_, index) => ({
      id: `c${String(index + 1).padStart(2, "0")}`,
      text: `Testpunkt ${index + 1} för ${label}`,
      variant_specific: index % 4 !== 3,
      section: index < 6 ? "Provkörning" : "Dokumentation",
    })),
    seller_questions: Array.from({ length: 6 }, (_, index) => ({
      question: `Testfråga ${index + 1} till säljaren?`,
      why: "Testkörning: frågan visar bara strukturen.",
      red_flag_answer: "Testkörning: otydliga svar utan underlag.",
      variant_specific: index !== 5,
    })),
    documents_to_verify: ["Serviceunderlag", "Kvitton på utförda arbeten", "Registreringsbevis", "Underlag för senaste verkstadsbesök"],
    sources,
    data_basis_note: "Testkörning: rapporten bygger på påhittade testkällor och beskriver ingen verklig bil.",
    disclaimer_note: "Detta är inte en teknisk besiktning. Testkörningen är bara vägledning.",
    review_status: "unreviewed",
  };
}

/** Steg 1 i testläget: påhittade källträffar, inga nätverksanrop. */
async function fixtureSearch(request: SearchRequest): Promise<SearchResult> {
  const searches = Math.min(Math.max(request.maxSearches, 1), 5);
  const report = fixtureReport(request.vehicle, searches);
  return {
    provider: "fixture",
    model: "fixture",
    text: `Testkörning: söksteget hittade ${report.sources.length} påhittade testkällor. Ingen verklig bil beskrivs.`,
    searches,
    chunks: report.sources.map((source) => ({
      url: source.url,
      title: source.title,
      domain: hostnameOf(source.url),
    })),
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** Steg 2 i testläget: ett komplett testrapportsvar utan nätverksanrop. */
async function fixtureWrite(request: WriteRequest): Promise<WriteResult> {
  const report = fixtureReport(request.vehicle, 0);
  return {
    provider: "fixture",
    model: "fixture",
    text: JSON.stringify(report),
    inputTokens: 0,
    outputTokens: 0,
  };
}

/* ------------------------------------------------------------------ *
 * Registret
 * ------------------------------------------------------------------ */

const providerDefinitions: readonly ProviderDefinition[] = [
  {
    id: "google",
    label: providerPricing.google.label,
    isConfigured: () => Boolean(process.env.GOOGLE_API_KEY),
    defaultModel: () => modelFor("google"),
    search: googleSearch,
    write: googleWrite,
  },
  {
    id: "openai",
    label: providerPricing.openai.label,
    isConfigured: () => Boolean(process.env.OPENAI_API_KEY),
    defaultModel: () => modelFor("openai"),
    search: openaiSearch,
    write: openaiWrite,
  },
  {
    id: "anthropic",
    label: providerPricing.anthropic.label,
    isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
    defaultModel: () => modelFor("anthropic"),
    search: anthropicSearch,
    write: anthropicWrite,
  },
  {
    id: "fixture",
    label: providerPricing.fixture.label,
    isConfigured: () => process.env.REPORT_PROVIDER === "fixture",
    defaultModel: () => "fixture",
    search: fixtureSearch,
    write: fixtureWrite,
  },
];

export type ProviderSummary = {
  id: ProviderId;
  label: string;
  model: string;
  configured: boolean;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  searchPerCallUsd: number;
  note: string;
};

/**
 * Leverantörsöversikten som visas i /admin: vilka leverantörer som är
 * konfigurerade och vad de kostar. Innehåller varken nyckelvärden eller
 * miljövariabelnamn, och lämnas bara ut till en administratör.
 */
export function providerSummaries(): ProviderSummary[] {
  return providerDefinitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    model: definition.defaultModel(),
    configured: definition.isConfigured(),
    inputPerMillionUsd: providerPricing[definition.id].inputPerMillionUsd,
    outputPerMillionUsd: providerPricing[definition.id].outputPerMillionUsd,
    searchPerCallUsd: providerPricing[definition.id].searchPerCallUsd,
    note: providerPricing[definition.id].note,
  }));
}

/**
 * Väljer leverantör.
 *
 * REPORT_PROVIDER pekar ut en specifik leverantör. Utan den används den första
 * konfigurerade i ordningen Google, OpenAI, Anthropic. Testleverantören kan
 * aldrig väljas av misstag: den är bara konfigurerad när REPORT_PROVIDER=fixture.
 */
export function resolveProvider(): ProviderDefinition {
  const requested = process.env.REPORT_PROVIDER?.trim();
  if (requested) {
    const match = providerDefinitions.find((definition) => definition.id === requested);
    if (!match) {
      throw new ProviderError("PROVIDER_NOT_CONFIGURED", `Okänd leverantör: ${requested}`, { kind: "provider_not_configured" });
    }
    if (!match.isConfigured()) {
      throw new ProviderError("PROVIDER_NOT_CONFIGURED", `Leverantören ${requested} är inte konfigurerad.`, {
        kind: "provider_not_configured",
      });
    }
    return match;
  }

  const configured = providerDefinitions.find((definition) => definition.id !== "fixture" && definition.isConfigured());
  if (!configured) {
    throw new ProviderError("PROVIDER_NOT_CONFIGURED", "Ingen LLM-leverantör är konfigurerad.", {
      kind: "provider_not_configured",
    });
  }
  return configured;
}

