/**
 * Priser för research-leverantörerna.
 *
 * Siffrorna är konstanter som hör hemma i koden (inte i modellen) eftersom de
 * styr den uppskattade kostnaden i /admin. Priserna är kontrollerade mot
 * leverantörernas prissidor i oktober 2026 och kan behöva uppdateras när de
 * ändras – därför ligger de samlade här och ingen annanstans.
 *
 * Modulen är avsiktligt ren: ingen nätverksåtkomst och inga miljövariabler.
 * Växelkursen skickas in, så att samma beräkning kan testas utan att läsa
 * konfiguration.
 */

export type ProviderId = "google" | "openai" | "anthropic" | "fixture";

export type ProviderPrice = {
  /** Visningsnamn i /admin. */
  label: string;
  /** Modell som används när LLM_MODEL inte är satt. */
  defaultModel: string;
  /** USD per miljon indata-token. */
  inputPerMillionUsd: number;
  /** USD per miljon utdata-token. */
  outputPerMillionUsd: number;
  /** USD per sökning som sökverktyget utför. */
  searchPerCallUsd: number;
  /**
   * Sökträffarnas innehåll faktureras ibland som ett fast antal indata-token
   * per sökning i stället för som verkliga token. 0 när leverantören fakturerar
   * de verkliga tokenmängderna.
   */
  searchContentInputTokensPerCall: number;
  note: string;
};

export const providerPricing: Record<ProviderId, ProviderPrice> = {
  google: {
    label: "Google Gemini (inbyggt Google Search)",
    defaultModel: "gemini-3.8-flash",
    /// Införingspris t.o.m. 2026-12-31, därefter 1,50/7,50 USD per miljon token.
    inputPerMillionUsd: 0.75,
    outputPerMillionUsd: 3.75,
    /// Grounding med Google Search: 5 000 sökningar per månad ingår (delas av
    /// alla Gemini 3.x-modeller), därefter 14 USD per 1 000 sökningar.
    searchPerCallUsd: 0.014,
    searchContentInputTokensPerCall: 0,
    note: "Grounding med Google Search: 14 USD per 1 000 sökningar efter 5 000 kostnadsfria per månad. Tänk-token räknas som utdata.",
  },
  openai: {
    label: "OpenAI Responses (web_search-verktyget)",
    defaultModel: "gpt-4.1-mini",
    inputPerMillionUsd: 0.4,
    outputPerMillionUsd: 1.6,
    searchPerCallUsd: 0.01,
    searchContentInputTokensPerCall: 8000,
    note: "Web search: ca 10 USD per 1 000 anrop. Sökinnehållet faktureras dessutom som 8 000 indata-token per anrop.",
  },
  anthropic: {
    label: "Anthropic Claude (web_search-verktyget)",
    defaultModel: "claude-sonnet-4-5",
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
    searchPerCallUsd: 0.01,
    searchContentInputTokensPerCall: 0,
    note: "Web search: ca 10 USD per 1 000 sökningar, utöver modellens tokenpris.",
  },
  fixture: {
    label: "Lokal testleverantör (endast för verifiering)",
    defaultModel: "fixture",
    inputPerMillionUsd: 0,
    outputPerMillionUsd: 0,
    searchPerCallUsd: 0,
    searchContentInputTokensPerCall: 0,
    note: "Gör inga nätverksanrop och kostar inget. Används bara när REPORT_PROVIDER=fixture och rapporten märks tydligt som testkörning.",
  },
};

export const defaultUsdToSek = 10.8;

/** Läser växelkursen ur miljön och faller tillbaka på {@link defaultUsdToSek}. */
export function parseUsdToSek(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultUsdToSek;
}

/** Uppskattad kostnad i USD, avrundad till ören (2 decimaler i SEK senare). */
export function estimateCostUsd(
  provider: ProviderId,
  tokens: { inputTokens: number | null; outputTokens: number | null; searches: number },
): number {
  const price = providerPricing[provider];
  const inputTokens = (tokens.inputTokens ?? 0) + price.searchContentInputTokensPerCall * tokens.searches;
  const outputTokens = tokens.outputTokens ?? 0;
  const tokenCost = (inputTokens / 1_000_000) * price.inputPerMillionUsd + (outputTokens / 1_000_000) * price.outputPerMillionUsd;
  return tokenCost + price.searchPerCallUsd * tokens.searches;
}

/** Kostnaden i SEK, avrundad till två decimaler. */
export function estimateCostSek(usd: number, usdToSek: number): number {
  return Math.round(usd * usdToSek * 100) / 100;
}
