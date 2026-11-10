import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { reportSchema, reviewStatusSchema } from "../lib/report";
import { buildReportOverview, vehicleLabel } from "../lib/reportAdminOverview";
import { isAdminUser, requireAdmin } from "./adminAccess";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { providerSummaries } from "./reportProviders";
import { shouldPurgeReport } from "../lib/reportCleanup";

/**
 * Backend för /admin: granska genererade rapporter, se kostnader och sätta
 * review_status.
 *
 * Behörigheten är en allow-list: bara en inloggad användare vars verifierade
 * e-postadress matchar ADMIN_EMAIL är administratör. Gäster och anonyma konton
 * nekas alltid, och det finns ingen väg att själv ta rollen. Saknas ADMIN_EMAIL
 * är ingen administratör.
 *
 * Själva sammanställningen (kostnad per rapport, genomsnitt, täckning) ligger i
 * src/lib/reportAdminOverview.ts, så att samma beräkning kan testas utan en
 * inloggad session.
 */

async function reportDocument(ctx: QueryCtx | MutationCtx, reportId: string) {
  return await ctx.db
    .query("vehicleReports")
    .withIndex("by_report_id", (q) => q.eq("reportId", reportId))
    .first();
}

/** Vem är besökaren, och får hen se /admin? Ingen e-postadress lämnas ut. */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const isAdmin = await isAdminUser(ctx);
    return { isSignedIn: userId !== null, isAdmin };
  },
});

/**
 * Vilka research-leverantörer som är konfigurerade server-side, och vad de
 * kostar. Endast namn och priser – aldrig något nyckelvärde eller något
 * miljövariabelnamn. Kräver administratör: allmänheten ska inte se vilka
 * leverantörer eller priser som finns.
 */
export const providerStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return providerSummaries();
  },
});

/**
 * Listan i /admin: varje rapport med variant, täckning, antal punkter,
 * uppskattad kostnad, review_status och antal flaggor – plus kostnadsläget
 * högst upp (genomsnitt och total).
 */
export const listReports = query({
  args: { limit: v.optional(v.number()), reviewStatus: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 100), 1), 500);

    const documents = await ctx.db
      .query("vehicleReports")
      .withIndex("by_created_at", (q) => q)
      .order("desc")
      .take(500);
    const flags = await ctx.db
      .query("reportFlags")
      .withIndex("by_created_at", (q) => q)
      .order("desc")
      .take(1000);

    return buildReportOverview({
      documents,
      flags,
      limit,
      reviewStatus: args.reviewStatus,
      now: Date.now(),
    });
  },
});

/** En rapport med sina källor, flaggor och sin generation_meta. */
export const reportDetail = query({
  args: { reportId: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const document = await reportDocument(ctx, args.reportId);
    if (!document) return null;

    const flags = await ctx.db
      .query("reportFlags")
      .withIndex("by_report_id", (q) => q.eq("reportId", args.reportId))
      .order("desc")
      .take(100);

    const parsed = reportSchema.safeParse(document.report);
    const report = parsed.success ? parsed.data : null;

    return {
      reportId: document.reportId,
      vehicleLabel: vehicleLabel(document.vehicle),
      status: document.status,
      reviewStatus: document.reviewStatus,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      vehicle: document.vehicle,
      sources: report ? report.sources : [],
      issueTitles: report ? report.known_issues.map((issue) => issue.title) : [],
      coverage: report ? report.research_summary.coverage : null,
      researchNotes: report ? report.research_summary.notes : null,
      dataBasisNote: report ? report.data_basis_note : null,
      generationMeta: document.generationMeta ?? null,
      flags: flags.map((flag) => ({ kind: flag.kind, message: flag.message, createdAt: flag.createdAt, resolved: flag.resolved })),
      statusLog: document.statusLog,
      failureReason: document.failureReason ?? null,
      /* Felspåret: kategori, HTTP-status och feltext, kvalitetskontrollernas
         anmärkningar, antal försök, sökningar/token/kostnad per försök och
         modellens råsvar kortat till 2000 tecken. Går bara till admin. */
      failure: document.failure ?? null,
      reportAvailable: parsed.success,
    };
  },
});

/** Granska, godkänn eller ta bort en rapport. */
export const setReviewStatus = mutation({
  args: { reportId: v.string(), reviewStatus: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const reviewStatus = reviewStatusSchema.parse(args.reviewStatus);
    const document = await reportDocument(ctx, args.reportId);
    if (!document) throw new Error("REPORT_NOT_FOUND");
    await ctx.db.patch(document._id, { reviewStatus, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

/**
 * Raderar testdata permanent: alla poster från den lokala testleverantören
 * (provider "fixture") och alla misslyckade försök, tillsammans med deras
 * flaggor. Kräver administratör.
 *
 * Arbetar i en begränsad sats (upp till 1000 poster per körning) eftersom en
 * enda Convex-transaktion inte får röra obegränsat många dokument. Kör igen om
 * `scanned` är lika med 1000 och `deletedReports` är större än noll.
 */
export const purgeTestData = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const documents = await ctx.db
      .query("vehicleReports")
      .withIndex("by_created_at", (q) => q)
      .take(1000);

    let deletedReports = 0;
    let deletedFlags = 0;
    for (const document of documents) {
      if (!shouldPurgeReport(document)) continue;
      const flags = await ctx.db
        .query("reportFlags")
        .withIndex("by_report_id", (q) => q.eq("reportId", document.reportId))
        .take(100);
      for (const flag of flags) {
        await ctx.db.delete(flag._id);
        deletedFlags += 1;
      }
      await ctx.db.delete(document._id);
      deletedReports += 1;
    }
    return { scanned: documents.length, deletedReports, deletedFlags };
  },
});
