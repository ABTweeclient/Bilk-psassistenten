/**
 * Sammanställningen som /admin visar: en rad per rapport och kostnadsläget
 * högst upp.
 *
 * Funktionen är ren och tar emot posterna som de ser ut i databasen. Det gör
 * att samma beräkning kan granskas och testas utan en inloggad admin-session,
 * medan backend bara ansvarar för att läsa och behörighetskontrollera.
 *
 * Misslyckade körningar räknas med sina egna siffror: sökningar, token och
 * kostnad sparas i felspåret (src/lib/reportFailure.ts) även när ingen rapport
 * blev klar, så att pengarna som gick åt syns i stället för att försvinna.
 */

/* Relativ import: filen läses både av frontend, av Convex och av verifieringen. */
import { failureMetaSchema, type FailureKind, type FailureMeta } from "./reportFailure";
import { reportSchema, type Coverage, type ReviewStatus } from "./report";

export type AdminOverviewDocument = {
  reportId: string;
  vehicle: unknown;
  status: string;
  reviewStatus: string;
  report?: unknown;
  generationMeta?: unknown;
  failure?: unknown;
  createdAt: number;
  failureReason?: string;
};

export type AdminOverviewFlag = { reportId: string; resolved: boolean };

export type AdminReportRow = {
  reportId: string;
  vehicleLabel: string;
  status: string;
  reviewStatus: string;
  coverage: Coverage | null;
  issueCount: number;
  sourceCount: number;
  estimatedCostSek: number | null;
  /** Sant när kostnaden kommer från ett misslyckat försök i stället för en färdig rapport. */
  costFromFailure: boolean;
  provider: string | null;
  searchesRun: number | null;
  createdAt: number;
  flagCount: number;
  failureReason: string | null;
  /** Felkategori, klartextsammanfattning och antal försök – null när körningen lyckades. */
  failureKind: FailureKind | null;
  failureSummary: string | null;
  attemptCount: number | null;
};

export type AdminOverview = {
  generatedAt: number;
  totals: {
    count: number;
    averageCostSek: number;
    totalCostSek: number;
    pricedCount: number;
    openFlags: number;
    failedCount: number;
    /** Kostnaden för körningar som misslyckades – pengar som gick åt utan rapport. */
    failedCostSek: number;
    /** Antal sökningar som gjordes i misslyckade körningar. */
    failedSearches: number;
    byReviewStatus: Record<ReviewStatus, number>;
    byCoverage: Record<Coverage, number>;
  };
  reports: AdminReportRow[];
};

export function vehicleLabel(raw: unknown): string {
  const vehicle = raw as Partial<Record<"make" | "model" | "year" | "engine" | "gearbox" | "drivetrain", unknown>>;
  const parts = [vehicle.make, vehicle.model, vehicle.year, vehicle.engine, vehicle.gearbox, vehicle.drivetrain].filter(
    (part): part is string | number => typeof part === "string" || typeof part === "number",
  );
  return parts.length > 0 ? parts.join(" · ") : "Okänd bil";
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function reviewStatusOf(value: string): ReviewStatus {
  return value === "reviewed" || value === "removed" ? value : "unreviewed";
}

/** Läser felspåret defensivt: en post med ett äldre eller trasigt spår visas utan detaljer. */
export function parseFailureMeta(raw: unknown): FailureMeta | null {
  const parsed = failureMetaSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function buildReportOverview(input: {
  documents: readonly AdminOverviewDocument[];
  flags: readonly AdminOverviewFlag[];
  limit: number;
  reviewStatus?: string;
  now: number;
}): AdminOverview {
  const flagsPerReport = new Map<string, number>();
  for (const flag of input.flags) flagsPerReport.set(flag.reportId, (flagsPerReport.get(flag.reportId) ?? 0) + 1);

  const byReviewStatus: Record<ReviewStatus, number> = { unreviewed: 0, reviewed: 0, removed: 0 };
  const byCoverage: Record<Coverage, number> = { good: 0, partial: 0, thin: 0 };
  let totalCostSek = 0;
  let pricedCount = 0;
  let failedCount = 0;
  let failedCostSek = 0;
  let failedSearches = 0;

  const rows: AdminReportRow[] = input.documents.map((document) => {
    const meta = (document.generationMeta ?? null) as Record<string, unknown> | null;
    const failure = parseFailureMeta(document.failure);

    /* En misslyckad körning har ingen generation_meta men kan ändå ha kostat
       sökningar. Då visas felspårets kostnad i stället, tydligt märkt i /admin. */
    const reportCost = numeric(meta?.estimated_cost_sek);
    const cost = reportCost ?? failure?.cost_sek_total ?? null;
    if (cost !== null) {
      totalCostSek += cost;
      pricedCount += 1;
    }
    if (failure) {
      failedCount += 1;
      failedCostSek += failure.cost_sek_total;
      failedSearches += failure.searches_total;
    }
    byReviewStatus[reviewStatusOf(document.reviewStatus)] += 1;

    /* En rapport som inte validerar räknas inte som innehåll – den syns i
       stället via sin status, precis som i gränssnittet. */
    const parsed = reportSchema.safeParse(document.report);
    const coverage = parsed.success ? parsed.data.research_summary.coverage : null;
    if (coverage) byCoverage[coverage] += 1;

    return {
      reportId: document.reportId,
      vehicleLabel: vehicleLabel(document.vehicle),
      status: document.status,
      reviewStatus: document.reviewStatus,
      coverage,
      issueCount: parsed.success ? parsed.data.known_issues.length : 0,
      sourceCount: parsed.success ? parsed.data.sources.length : 0,
      estimatedCostSek: cost,
      costFromFailure: reportCost === null && failure !== null,
      provider: typeof meta?.provider === "string" ? meta.provider : (failure?.provider ?? null),
      searchesRun: numeric(meta?.searches_run) ?? failure?.searches_total ?? null,
      createdAt: document.createdAt,
      flagCount: flagsPerReport.get(document.reportId) ?? 0,
      failureReason: document.failureReason ?? null,
      failureKind: failure?.kind ?? null,
      failureSummary: failure?.summary ?? null,
      attemptCount: failure?.attempt_count ?? null,
    };
  });

  const filtered = input.reviewStatus ? rows.filter((row) => row.reviewStatus === input.reviewStatus) : rows;

  return {
    generatedAt: input.now,
    totals: {
      count: rows.length,
      averageCostSek: pricedCount > 0 ? Math.round((totalCostSek / pricedCount) * 100) / 100 : 0,
      totalCostSek: Math.round(totalCostSek * 100) / 100,
      pricedCount,
      openFlags: input.flags.filter((flag) => !flag.resolved).length,
      failedCount,
      failedCostSek: Math.round(failedCostSek * 100) / 100,
      failedSearches,
      byReviewStatus,
      byCoverage,
    },
    reports: filtered.slice(0, input.limit),
  };
}
