/**
 * Felspårning för misslyckade rapportkörningar.
 *
 * En körning som misslyckas ska lämna ett spår som går att läsa i /admin utan
 * att gissa: vilken sorts fel det var, vilken HTTP-status och feltext
 * leverantören gav (utan nycklar), vilken kvalitetskontroll som fällde svaret,
 * hur många försök som gjordes, vad varje försök kostade och vad modellen
 * faktiskt svarade (kortat).
 *
 * Modulen är avsiktligt ren: inga nätverksanrop och inga miljövariabler. Den
 * läses av Convex-pipelinen, av /admin och av verifieringen, så att samma
 * regler gäller överallt.
 */

import { z } from "zod";
import { generationStepMetaSchema, generationStepSchema } from "./report";

/**
 * Vilken sorts fel ett försök dog av. Kategorierna motsvarar exakt de lägen
 * pipelinen kan hamna i, så att en post aldrig behöver beskrivas som "okänt
 * fel" när orsaken egentligen är känd.
 */
export const failureKindSchema = z.enum([
  /** Tidsgränsen (RESEARCH_TIMEOUT_MS) slog till och anropet avbröts. */
  "timeout",
  /** Leverantören svarade med ett HTTP-fel (status och feltext sparas). */
  "provider_error",
  /** Ingen leverantör eller nyckel är konfigurerad server-side. */
  "provider_not_configured",
  /** Modellnamnet i LLM_MODEL finns inte hos leverantören. */
  "provider_model_unknown",
  /** Leverantören blockerade förfrågan eller svaret. */
  "provider_blocked",
  /** Leverantören svarade med ett tomt svar. */
  "provider_empty",
  /**
   * Leverantören svarade HTTP 200 med en läsbar svarsstruktur men utan text
   * (till exempel en candidate vars content saknar parts). Skiljs medvetet från
   * provider_error, som betyder att Google avvisade själva förfrågan – annars
   * går det inte att se i /admin om verktyget nekades eller om svaret bara inte
   * gick att tolka. finishReason sparas på försöket.
   */
  "empty_response",
  /** Svaret gick inte att läsa som JSON. */
  "invalid_json",
  /** Giltig JSON, men strukturen bröt mot rapportkontraktet. */
  "schema",
  /** Svaret gick att läsa men fälldes av kvalitetskontrollerna. */
  "quality",
  /**
   * Söksteget gjorde noll sökningar och gav inga källänkar, även efter det enda
   * tillåtna omförsöket med en mer tvingande formulering. Utan sökresultat finns
   * inget att bygga rapporten på, så skrivsteget körs aldrig.
   */
  "no_research",
  /**
   * Söksteget svarade med att be om bilens uppgifter ("klistra in
   * fordonsuppgifterna") i stället för att söka. Det betyder att anropet saknade
   * indata eller att modellen inte såg den – en annan orsak än att modellen
   * valde att inte söka, och därför en egen kategori. Inget omförsök görs: samma
   * anrop skulle ge samma svar. Meddelandet som skickades sparas på försöket.
   */
  "input_not_delivered",
  /** Posten låg kvar i arbetsläge för länge och stängdes av vakten. */
  "stale",
  /** Oväntat fel som inte hör till någon av kategorierna ovan. */
  "unexpected",
]);
export type FailureKind = z.infer<typeof failureKindSchema>;

/** Kort etikett, för listan i /admin. */
export const failureKindLabels: Record<FailureKind, string> = {
  timeout: "Tidsgräns",
  provider_error: "Leverantörsfel",
  provider_not_configured: "Leverantör saknas",
  provider_model_unknown: "Okänt modellnamn",
  provider_blocked: "Blockerat svar",
  provider_empty: "Tomt svar",
  empty_response: "Tomt svar (EMPTY_RESPONSE)",
  invalid_json: "Ogiltig JSON",
  schema: "Bröt mot kontraktet",
  quality: "Kvalitetskontroll",
  no_research: "Ingen sökning gjordes (NO_RESEARCH)",
  input_not_delivered: "Bilen skickades inte med (INPUT_NOT_DELIVERED)",
  stale: "Fastnade i arbetsläge",
  unexpected: "Oväntat fel",
};

/** Vad kategorin betyder, i klartext, för den som felsöker i /admin. */
export const failureKindExplanations: Record<FailureKind, string> = {
  timeout:
    "Ett av de två stegen avbröts av sin hårda tidsgräns (90 sekunder per steg, och aldrig mer än RESEARCH_TIMEOUT_MS för hela körningen). Inget svar hann fram, och steg 2 får inget nytt försök vid tidsgräns. När ett anrop avbryts får vi ingen användningsdata tillbaka, så sökningar, token och kostnad för just det steget står som 0 eller saknas här – de sökningar Google hann utföra syns i Googles egen faktureringsöversikt. Blir det här återkommande är MAX_SEARCHES för högt för tidsbudgeten.",
  provider_error:
    "Leverantören svarade med ett HTTP-fel. Statuskoden och leverantörens egen feltext sparas per försök, så att till exempel en nyckel utan åtkomst till sökverktyget syns direkt.",
  provider_not_configured:
    "Ingen leverantör med nyckel är konfigurerad server-side. Ingen förfrågan skickades, så körningen kostade inget.",
  provider_model_unknown:
    "Modellnamnet i LLM_MODEL finns inte hos leverantören. Kontrollen sker innan anropet, så körningen kostade inget – listan över namn som faktiskt finns visas i stället.",
  provider_blocked:
    "Leverantören vägrade behandla förfrågan eller svaret. Ett nytt försök med samma uppgifter hjälper sällan.",
  provider_empty: "Leverantören svarade utan innehåll.",
  empty_response:
    "Google svarade HTTP 200 och svarsstrukturen gick att läsa, men den innehöll ingen text. Kategorin skiljer det från ett HTTP-fel där Google avvisar förfrågan (till exempel ett sökverktyg som inte stöds). Vanligaste orsaken är finishReason MAX_TOKENS: tänk-token räknas mot maxOutputTokens, så tänkandet kan göra slut på hela budgeten innan själva svaret börjar. finishReason, sökningar, token och den råa svarsstrukturen sparas på försöket nedan.",
  invalid_json:
    "Modellens svar i skrivsteget gick inte att läsa som JSON. Felet sitter i formatet och inte i sökningen, så skrivsteget får ett rättelseförsök med samma fynd och källista – det kostar bara token, inga nya sökningar.",
  schema:
    "Svaret i skrivsteget var giltig JSON men bröt mot rapportkontraktet (till exempel saknade listor). Även det här är ett formatfel, så skrivsteget får ett rättelseförsök med samma underlag.",
  quality:
    "Svaret gick att läsa men fälldes av de programmatiska kvalitetskontrollerna. Det som fällde svaret listas per försök; ett nytt försök görs inte, eftersom kontrollerna mäter innehållet.",
  no_research:
    "Söksteget gjorde noll sökningar och returnerade inga källänkar, även efter det enda tillåtna omförsöket med en mer tvingande formulering. Google låter modellen avgöra själv om sökverktyget ska användas, så ett anrop kan komma tillbaka med ett svar ur minnet. Det här är alltså slutsatsen efter två försök där modellen hade uppgifterna men inte sökte – jämför med INPUT_NOT_DELIVERED, som betyder att modellen i stället bad om bilens uppgifter. Läs REQUEST-rutan på varje försök: står bilens JSON där fick modellen uppgifterna, och då gällde NO_RESEARCH. Skrivsteget kördes aldrig: utan sökresultat finns inga källor att bygga rapporten på.",
  input_not_delivered:
    "Modellen svarade med att be om bilens uppgifter i stället för att söka, trots att den ska få dem som JSON i samma meddelande. Då saknades indata i anropet, och det är ett fel i vår kod – inte i kundens uppgifter och inte modellens val. Jämför REQUEST-rutan på försöket med bilens variant ovan: där syns exakt vad modellen fick. Inget omförsök gjordes, eftersom samma anrop skulle ge samma svar.",
  stale:
    "Posten låg kvar i arbetsläge i mer än fem minuter utan att uppdateras och stängdes därför av vaktfunktionen. Det betyder att körningen avbröts innan den hann skriva ett resultat.",
  unexpected:
    "Ett fel som inte hör till någon av de kända kategorierna. Feltexten sparas ordagrant för att gå att felsöka.",
};

/** Så många tecken av modellens råsvar sparas för misslyckade körningar. */
export const rawResponseLimit = 2000;

/** Så många tecken av användarmeddelandet som skickades sparas per försök. */
export const requestExcerptLimit = 1500;

/**
 * Kortar modellens råsvar till {@link rawResponseLimit} tecken och säger om
 * något klipptes bort, så att /admin aldrig visar ett halvt svar som om det
 * vore hela.
 */
export function truncateRawResponse(text: string): { text: string; truncated: boolean } {
  if (text.length <= rawResponseLimit) return { text, truncated: false };
  return { text: text.slice(0, rawResponseLimit), truncated: true };
}

/**
 * Kortar det användarmeddelande som skickades till {@link requestExcerptLimit}
 * tecken. Fältet sparas på varje försök så att /admin kan visa exakt vad
 * modellen fick – det är den enda säkra vägen att skilja "modellen valde att
 * inte söka" från "bilen skickades inte med".
 */
export function truncateRequestExcerpt(text: string): { text: string; truncated: boolean } {
  if (text.length <= requestExcerptLimit) return { text, truncated: false };
  return { text: text.slice(0, requestExcerptLimit), truncated: true };
}

/** Ett enskilt försök mot leverantören som inte ledde hela vägen fram. */
export const failureAttemptSchema = z.object({
  /** 1 för första försöket, 2 för rättelseförsöket. */
  attempt: z.number().int().min(1),
  kind: failureKindSchema,
  /** Maskinkod, till exempel RESEARCH_TIMEOUT eller PROVIDER_FAILED. */
  code: z.string().min(1),
  /** HTTP-status från leverantören, när det finns en. */
  http_status: z.number().int().nullable(),
  /** Leverantörens feltext (eller den interna feltexten), utan nycklar. */
  message: z.string(),
  /** Vad kvalitetskontrollerna anmärkte på, rad för rad. */
  quality_issues: z.array(z.string()),
  /**
   * Vilket av de två stegen försöket gällde. Valfri eftersom poster som sparades
   * innan tvåstegsflödet saknar fältet.
   */
  stage: generationStepSchema.nullable().optional(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  /** Sökningar leverantören hann utföra i det här försöket. */
  searches: z.number().int().min(0),
  input_tokens: z.number().int().min(0).nullable(),
  output_tokens: z.number().int().min(0).nullable(),
  /** Uppskattad kostnad för just det här försöket, i USD och SEK. */
  cost_usd: z.number().min(0),
  cost_sek: z.number().min(0),
  duration_ms: z.number().int().min(0),
  /** Modellens råsvar, kortat till {@link rawResponseLimit} tecken. */
  raw_response: z.string(),
  raw_response_truncated: z.boolean(),
  /**
   * Användarmeddelandet som faktiskt skickades, kortat till
   * {@link requestExcerptLimit} tecken och rensat från nyckelvärden. Valfritt
   * eftersom poster som sparades innan fältet fanns saknar det.
   */
  request_excerpt: z.string().optional(),
  request_excerpt_truncated: z.boolean().optional(),
  /**
   * Leverantörens finishReason, när den gick att läsa (till exempel MAX_TOKENS).
   * Valfri eftersom poster som sparades innan fältet fanns saknar det.
   */
  finish_reason: z.string().nullable().optional(),
  at: z.string().min(1),
});
export type FailureAttempt = z.infer<typeof failureAttemptSchema>;

/** Allt som sparas på en misslyckad post, så att orsaken går att läsa i efterhand. */
export const failureMetaSchema = z.object({
  /** Huvudorsaken: det sista försökets kategori. */
  kind: failureKindSchema,
  /** Klartextsammanfattning på svenska, byggd av {@link describeFailure}. */
  summary: z.string().min(1),
  attempts: z.array(failureAttemptSchema).min(1),
  /**
   * Varje steg som faktiskt kostade pengar, även de som gick bra innan ett
   * senare steg misslyckades. Saknas på poster från före tvåstegsflödet.
   */
  steps: z.array(generationStepMetaSchema).optional(),
  attempt_count: z.number().int().min(1),
  /** Sant när ett rättelseförsök gjordes. */
  retried: z.boolean(),
  searches_total: z.number().int().min(0),
  input_tokens_total: z.number().int().min(0).nullable(),
  output_tokens_total: z.number().int().min(0).nullable(),
  cost_usd_total: z.number().min(0),
  cost_sek_total: z.number().min(0),
  /** Total tid från att posten skapades till att den markerades misslyckad. */
  duration_ms: z.number().int().min(0),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  failed_at: z.string().min(1),
  /** Varningar från modellkontrollen, till exempel att grounding inte är dokumenterat stött. */
  model_notes: z.array(z.string()),
});
export type FailureMeta = z.infer<typeof failureMetaSchema>;

/**
 * Ett nytt försök inne i ett steg görs bara när själva svarsformatet var fel:
 * ett tomt svar utan förklaring, ett svar som inte gick att läsa som JSON, eller
 * JSON som bröt mot kontraktet. I skrivsteget kostar ett sådant omförsök bara
 * token, eftersom inga nya sökningar görs.
 *
 * Vid tidsgräns, leverantörsfel, blockerat svar eller underkänt innehåll görs
 * aldrig ett nytt försök: det skulle kosta nya sökningar utan att kunna lyckas.
 *
 * "empty_response" räknas inte som retrybart. Ett sådant svar kommer tillbaka
 * med en känd finishReason, oftast MAX_TOKENS, och orsaken sitter då i anropets
 * budget – samma anrop igen skulle bara kosta nya tänk-token och sökningar utan
 * att ändra förutsättningarna. Åtgärden är att ändra tänkande-inställningen
 * eller maxOutputTokens, och det syns i /admin.
 */
export function isRetryableFailure(kind: FailureKind): boolean {
  return kind === "provider_empty" || kind === "invalid_json" || kind === "schema";
}

/**
 * Maskinkoder där gränssnittet inte ska uppmana till ett nytt försök med samma
 * bil.
 *
 * SCHEMA_INVALID betyder att rapporten inte kunde läsas tillräckligt säkert
 * ens efter rättelseförsöket. Det sitter i körningen och inte i användarens
 * uppgifter, och exakt samma förfrågan skulle ge samma resultat.
 *
 * NO_RESEARCH är däremot ett tekniskt fel som kan gå över: modellen lät bli att
 * använda sökverktyget den här gången. Kunden får därför ett lugnt besked om att
 * felet är tekniskt och att ett nytt försök kan göras om en stund.
 */
export const failureCodesWithoutRetry = ["SCHEMA_INVALID"] as const;

/** Sant när ett nytt försök med samma bil är värt att erbjuda. */
export function shouldOfferRetry(failureCode: string | null | undefined): boolean {
  if (!failureCode) return true;
  return !(failureCodesWithoutRetry as readonly string[]).includes(failureCode);
}

type AttemptFacts = Pick<
  FailureAttempt,
  "attempt" | "kind" | "http_status" | "message" | "quality_issues" | "duration_ms"
> & { finish_reason?: string | null };

/** finishReason för det sista försöket, eller "saknas" när leverantören inte gav någon. */
function lastFinishReason(attempts: readonly AttemptFacts[]): string {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const reason = attempts[index]?.finish_reason;
    if (reason) return reason;
  }
  return "saknas";
}

export type DescribeFailureInput = {
  kind: FailureKind;
  attempts: readonly AttemptFacts[];
  /** Den konfigurerade tidsgränsen, när sammanhanget känner till den. */
  timeoutMs?: number;
};

/** Summerar misslyckandet i klartext, med de siffror som gör det begripligt. */
export function describeFailure(input: DescribeFailureInput): string {
  const attempts = input.attempts;
  const count = attempts.length;
  const last = attempts[count - 1];
  const tries = count === 1 ? "Ett försök gjordes." : `${count} försök gjordes.`;

  switch (input.kind) {
    case "timeout": {
      const seconds = Math.round((last?.duration_ms ?? 0) / 1000);
      const limit = input.timeoutMs ? ` (gränsen är ${Math.round(input.timeoutMs / 1000)} s)` : "";
      return `Tidsgränsen slog till i försök ${last?.attempt ?? count}: anropet avbröts efter ${seconds} s${limit}. ${tries}`;
    }
    case "provider_error": {
      const status = last?.http_status ? `HTTP ${last.http_status}: ` : "";
      return `Leverantören svarade med ett fel – ${status}${last?.message ?? ""} ${tries}`;
    }
    case "provider_not_configured":
      return `Ingen leverantör är konfigurerad server-side. Ingen förfrågan skickades och körningen kostade inget. ${tries}`;
    case "provider_model_unknown":
      return `Modellnamnet finns inte hos leverantören: ${last?.message ?? ""} Ingen förfrågan skickades och körningen kostade inget.`;
    case "provider_blocked":
      return `Leverantören blockerade svaret: ${last?.message ?? ""} ${tries}`;
    case "provider_empty":
      return `Leverantören svarade utan innehåll i försök ${last?.attempt ?? count}. ${tries}`;
    case "empty_response":
      return `Leverantören svarade utan text i försök ${last?.attempt ?? count} (EMPTY_RESPONSE, finishReason ${lastFinishReason(attempts)}). ${tries}`;
    case "invalid_json":
      return `Modellens svar gick inte att läsa som JSON: ${last?.message ?? ""} ${tries}`;
    case "schema":
      return `Svaret var giltig JSON men bröt mot rapportkontraktet: ${(last?.quality_issues ?? []).join("; ")} ${tries}`;
    case "quality":
      return `Kvalitetskontrollerna fällde svaret: ${(last?.quality_issues ?? []).join("; ")} ${tries}`;
    case "no_research":
      return `Söksteget gjorde noll sökningar i försök ${last?.attempt ?? count}: ${last?.message ?? ""} Skrivsteget kördes aldrig.`;
    case "input_not_delivered":
      return `Söksteget svarade med att be om bilens uppgifter i försök ${last?.attempt ?? count}: ${last?.message ?? ""} Bilens data följer alltid med i anropet, så det här är ett fel i vår kod. Skrivsteget kördes aldrig.`;
    case "stale":
      return "Körningen låg kvar i arbetsläge utan att uppdateras och stängdes av vaktfunktionen, som markerar allt som legat still i mer än fem minuter som misslyckat.";
    case "unexpected":
      return `Oväntat fel: ${last?.message ?? ""} ${tries}`;
  }
}
