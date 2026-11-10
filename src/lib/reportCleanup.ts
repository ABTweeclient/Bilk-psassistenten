/**
 * Rena regler för städning, testdata och rate-limit-lagring.
 *
 * Modulen läser inga miljövariabler och gör inga databasanrop: backend skickar
 * in värdena och får ett svar. Det gör att exakt samma regel kan testas utan en
 * databas (se scripts/verify-security.ts).
 */

/**
 * Hur länge en ip-härledd rate-limit-nyckel får ligga kvar efter sin senaste
 * användning. Fönstret är en timme, så 48 timmar utan aktivitet betyder att
 * nyckeln är inaktuell och raderas.
 */
export const rateLimitRetentionMs = 48 * 60 * 60 * 1000;

/** Sant när generation_meta säger att rapporten kommer från testleverantören. */
export function isFixtureGenerationMeta(meta: unknown): boolean {
  if (meta && typeof meta === "object") {
    const provider = (meta as { provider?: unknown }).provider;
    if (typeof provider === "string") return provider === "fixture";
  }
  return false;
}

/**
 * Sant för poster som skapats av den lokala testleverantören. Känns igen på
 * generation_meta.provider, och som reserv på testets report_id-prefix.
 */
export function isFixtureReport(document: { generationMeta?: unknown; report?: unknown }): boolean {
  if (isFixtureGenerationMeta(document.generationMeta)) return true;
  const report = document.report as { report_id?: unknown } | null | undefined;
  return typeof report?.report_id === "string" && report.report_id.startsWith("TEST-");
}

/** Testdata som ska raderas permanent: fixture-rapporter och misslyckade försök. */
export function shouldPurgeReport(document: { generationMeta?: unknown; report?: unknown; status?: unknown }): boolean {
  return isFixtureReport(document) || document.status === "failed";
}

/**
 * Testrapporter visas bara när deploymenten uttryckligen kör testläget
 * (REPORT_PROVIDER=fixture) och inte är märkt som produktion (APP_ENV).
 * Standardläget är alltid att de är dolda.
 */
export function fixtureReportsVisible(reportProvider: string | undefined, appEnv: string | undefined): boolean {
  return reportProvider === "fixture" && appEnv !== "production";
}
