/**
 * Delade typer och regler för regnummeruppslaget.
 *
 * Uppslaget hämtar bilens uppgifter från Vägtrafikregistret (via RegCheck) och
 * ger ett förslag som användaren själv bekräftar innan det hamnar i formuläret.
 */

/** Ett förslag på bil, så som formuläret kan fylla i det. */
export type VehicleSuggestion = {
  found: boolean;
  make: string;
  model: string;
  year: number | null;
  engine: string;
  gearbox: "Manuell" | "Automat" | "" | "Vet ej";
  confidence: "high" | "medium" | "low";
  /** Källan som uppgifterna kommer från, till exempel "Vägtrafikregistret". */
  source: string;
  /** Registrets fordonsslag, till exempel "Halvkombi" eller "MC". */
  bodyStyle: string;
};

/** Svar från uppslagsåtgärden: förslaget plus varför det inte blev något. */
export type VehicleLookupResponse = {
  suggestion: VehicleSuggestion;
  cached: boolean;
  /** Förklaring när inget förslag kunde hämtas, till exempel slut på krediter. */
  notice?: string;
};

export const emptyVehicleSuggestion: VehicleSuggestion = {
  found: false,
  make: "",
  model: "",
  year: null,
  engine: "",
  gearbox: "",
  confidence: "low",
  source: "",
  bodyStyle: "",
};

/**
 * Fordonsslag som inte är personbilar. Registret svarar även för motorcyklar,
 * mopeder, traktorer, släp och husvagnar; de uppgifterna hör inte hemma i en
 * bilköpsrapport, så de får aldrig fylla formuläret.
 */
const nonCarBodyStyles = /\b(mc|motorcykel|moped|traktor|släp|släpvagn|husvagn|buss|lastbil|lätt lastbil)\b/i;

/** Sant när fordonsslaget kan vara en personbil. Tomt svar räknas som okänt. */
export function isPassengerCar(bodyStyle: string): boolean {
  const value = bodyStyle.trim();
  if (value.length === 0) return true;
  return !nonCarBodyStyles.test(value);
}

/** Svensk skylt: tre bokstäver, två siffror och ett tecken som kan vara siffra eller bokstav. */
const registrationNumberPattern = /^[A-Z]{3}\d{2}[A-Z0-9]$/;

/** Tar bort mellanslag och bindestreck och gör bokstäverna stora. */
export function normalizeRegistrationNumber(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "").slice(0, 7);
}

/** Sant för ett registreringsnummer i svenskt format. */
export function isValidRegistrationNumber(value: string): boolean {
  return registrationNumberPattern.test(normalizeRegistrationNumber(value));
}

/** Gör om modellens växellådetext till formulärets värden. */
export function gearboxFromText(value: string): VehicleSuggestion["gearbox"] {
  const text = value.toLowerCase();
  if (text.includes("automat") || text.includes("dsg") || text.includes("cvt")) return "Automat";
  if (text.includes("manuell")) return "Manuell";
  return "";
}
