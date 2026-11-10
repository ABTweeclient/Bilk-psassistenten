/**
 * Reglerna för vem som får vara administratör.
 *
 * Rollen är en allow-list med ett enda konto: en inloggad användare vars
 * e-postadress är verifierad med en engångskod och exakt matchar miljövariabeln
 * ADMIN_EMAIL. Allt annat – gäster, anonyma konton, konton med annan adress och
 * konton vars e-post inte är verifierad – nekas. Är ADMIN_EMAIL inte satt är
 * ingen administratör.
 *
 * Modulen är avsiktligt ren: den läser ingen miljövariabel och gör inga
 * databasanrop. Convex-lagret (src/convex/adminAccess.ts) plockar fram
 * användarens uppgifter och skickar in dem här, så att exakt samma regel kan
 * testas utan en inloggad session.
 */

export type AdminCandidate = {
  /** Användarens e-postadress, eller null/undefined om den saknas. */
  email?: string | null;
  /** Sant bara när adressen är verifierad (emailVerificationTime satt). */
  emailVerified?: boolean;
  /** Sant för gästkonton som skapats anonymt. */
  isAnonymous?: boolean;
};

/** Trimmar och gemener – jämförelsen ska tåla skiftläge och blanksteg. */
export function normalizeAdminEmail(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().toLowerCase() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Avgör om ett konto får vara administratör.
 *
 * Sant endast när ADMIN_EMAIL är satt, kontot inte är anonymt, adressen är
 * verifierad och adressen matchar ADMIN_EMAIL.
 */
export function isAdminCandidate(
  candidate: AdminCandidate,
  adminEmailRaw: string | null | undefined,
): boolean {
  const adminEmail = normalizeAdminEmail(adminEmailRaw);
  if (!adminEmail) return false;
  if (candidate.isAnonymous === true) return false;
  if (candidate.emailVerified !== true) return false;
  return normalizeAdminEmail(candidate.email) === adminEmail;
}
