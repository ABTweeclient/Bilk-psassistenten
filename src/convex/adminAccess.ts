/**
 * Convex-lagret för administratörsbehörigheten.
 *
 * Hämtar den inloggade användaren och skickar in uppgifterna till den rena
 * regeln i src/lib/adminAccess.ts. Ingen adminroll sparas i databasen längre:
 * behörigheten räknas fram ur ADMIN_EMAIL vid varje anrop, så att en ändrad
 * adress får effekt direkt och gäster aldrig kan ta sig in.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { isAdminCandidate } from "../lib/adminAccess";
import { internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";

type AdminContext = QueryCtx | MutationCtx;

async function candidateFor(ctx: AdminContext) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  if (!user) return null;
  return {
    user,
    candidate: {
      email: user.email,
      emailVerified: user.emailVerificationTime !== undefined,
      isAnonymous: user.isAnonymous,
    },
  };
}

/** Sant bara för det verifierade ADMIN_EMAIL-kontot. Allt annat ger falskt. */
export async function isAdminUser(ctx: AdminContext): Promise<boolean> {
  const found = await candidateFor(ctx);
  if (!found) return false;
  return isAdminCandidate(found.candidate, process.env.ADMIN_EMAIL);
}

/**
 * Kräver administratörsbehörighet och returnerar användaren.
 *
 * Kastar ett tydligt fel i stället för att läcka data: ej inloggad, gäst,
 * overifierad adress, annan adress eller saknad ADMIN_EMAIL nekas alla.
 */
export async function requireAdmin(ctx: AdminContext) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("NOT_SIGNED_IN");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("NOT_SIGNED_IN");
  const candidate = {
    email: user.email,
    emailVerified: user.emailVerificationTime !== undefined,
    isAnonymous: user.isAnonymous,
  };
  if (candidate.isAnonymous === true) throw new Error("NOT_ADMIN");
  const configured = isAdminCandidate({ ...candidate, emailVerified: true }, process.env.ADMIN_EMAIL);
  if (!configured) {
    throw new Error(process.env.ADMIN_EMAIL ? "NOT_ADMIN" : "ADMIN_NOT_CONFIGURED");
  }
  if (!isAdminCandidate(candidate, process.env.ADMIN_EMAIL)) {
    throw new Error(candidate.emailVerified ? "NOT_ADMIN" : "EMAIL_NOT_VERIFIED");
  }
  return user;
}

/**
 * Behörighetskontrollen för actions.
 *
 * En action har ingen egen databasåtkomst, så kontrollen körs som en intern
 * query och svaret går tillbaka till actionen. Det ger samma enda regel som
 * /admin använder: bara det verifierade ADMIN_EMAIL-kontot är administratör.
 */
export const viewerIsAdmin = internalQuery({
  args: {},
  handler: async (ctx) => ({ isAdmin: await isAdminUser(ctx) }),
});
