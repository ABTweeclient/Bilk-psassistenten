/**
 * Felkoder från rapportgenereringen översatta till lugn svenska.
 *
 * Backend svarar alltid med en kod i sitt ConvexError (se
 * src/convex/reportPipeline.ts). Koden översätts här, på ett ställe, så att
 * formuläret på startsidan och "Försök igen" på /rapport/:id säger samma sak.
 * Okända fel får en allmän text, så att ingen teknisk detalj läcker ut.
 */

export const reportErrorMessages: Record<string, string> = {
  INVALID_INPUT: "Kontrollera uppgifterna om bilen och försök igen.",
  RATE_LIMITED: "För många förfrågningar just nu. Vänta en liten stund och försök igen.",
  DAILY_CAP_REACHED: "Dagens tak för antal rapporter är nått. Försök igen i morgon.",
  PROVIDER_NOT_CONFIGURED: "Rapportgenereringen är inte färdigkonfigurerad. Kontakta oss så löser vi det.",
  PROVIDER_MODEL_UNKNOWN: "Modellinställningen stämmer inte. Kontakta oss så löser vi det.",
  PROVIDER_FAILED: "Källsökningen svarade inte som den skulle. Försök igen om en stund.",
  PROVIDER_BLOCKED: "Förfrågan kunde inte behandlas. Försök igen med lite andra uppgifter.",
  PROVIDER_EMPTY: "Källsökningen svarade utan innehåll. Försök igen om en stund.",
  EMPTY_RESPONSE: "Källsökningen svarade utan text den här gången. Försök igen om en stund.",
  TIMEOUT: "Sökningen tog för lång tid den här gången. Försök igen om en stund.",
  INVALID_JSON: "Svaret från sökningen hade fel format den här gången. Försök gärna igen om en stund.",
  /*
   * Båda felen sitter i körningen, inte i användarens uppgifter. Texterna säger
   * därför att det är ett tekniskt fel – aldrig att varianten skulle sakna
   * underlag, och aldrig att kunden borde prova en annan motor.
   */
  SCHEMA_INVALID:
    "Ett tekniskt fel inträffade när svaret skulle läsas, så ingen rapport skapades. Det beror inte på uppgifterna du angav. Försök igen om en stund.",
  NO_RESEARCH:
    "Ett tekniskt fel inträffade när underlaget skulle sökas fram, så ingen rapport skapades. Det beror inte på uppgifterna du angav – försök igen om en stund.",
  INPUT_NOT_DELIVERED:
    "Ett tekniskt fel inträffade när bilens uppgifter skulle skickas till sökningen, så ingen rapport skapades. Det beror inte på uppgifterna du angav – försök igen om en stund.",
  VALIDATION_FAILED: "Rapporten klarade inte kvalitetskontrollerna. Försök igen om en stund.",
  STALE_TIMEOUT: "Körningen avbröts innan rapporten blev klar. Försök igen.",
  GENERATION_FAILED: "Det gick inte att ta fram rapporten just nu. Försök igen om en stund.",
};

/** Plockar ut felkoden ur ett ConvexError (eller ur feltexten som reserv). */
export function errorCodeOf(error: unknown): string | null {
  const data = (error as { data?: unknown } | null)?.data;
  if (data && typeof data === "object" && "code" in data) {
    const code = (data as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/\b([A-Z][A-Z_]{3,})\b/);
  return match ? match[1] : null;
}

/** Den text användaren ska se för ett misslyckat anrop. */
export function reportErrorMessage(error: unknown): string {
  const code = errorCodeOf(error);
  return (code && reportErrorMessages[code]) ?? reportErrorMessages.GENERATION_FAILED;
}
