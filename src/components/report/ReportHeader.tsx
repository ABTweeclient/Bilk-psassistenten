import { CoverageBadge, CoverageNotice, ReviewBadge } from "@/components/report/evidence";
import { RiskSummary } from "@/components/report/RiskSummary";
import { formatDate, formatNumber, type Report } from "@/lib/report";
import "@/styles/system.css";
import "./header-summary.css";

const variantStatusLabels: Record<Report["variant_status"], string> = {
  identified: "Exakt variant identifierad",
  partial: "Varianten är delvis identifierad",
  unclear: "Varianten är inte säkert fastställd",
};

/**
 * Rapportens hero: bilen, en kort bedömningstagg med faktarad, en kort text
 * och de viktigaste kontrollerna – allt överst, så att första vyn på mobil
 * räcker.
 *
 * Här finns inget tekniskt: modellens rapport-ID, schemaversionen och
 * sökstatistiken hör till /admin. Datumet är rapportens skapadedatum och
 * rapport-ID:t är det korta id:t från databasen.
 *
 * Inget får likna myndighet, sigill, godkännande eller underkännande: bara
 * text, tunna linjer och lugna färger.
 */
export function ReportHeader({
  report,
  sample = true,
  createdAt,
  shortId,
}: {
  report: Report;
  sample?: boolean;
  createdAt?: string | null;
  shortId?: string | null;
}) {
  const vehicle = report.vehicle;
  const date = createdAt ?? report.generated_at;

  return (
    <header className="hs-hero" id="sammanfattning">
      <CoverageNotice coverage={report.research_summary.coverage} />

      <div className="hs-hero__top">
        <span className="hs-hero__eyebrow ds-mono">Bilköpsrapport</span>
        {sample && <span className="hs-example ds-mono">EXEMPEL</span>}
        <span className="hs-hero__variant ds-mono">{variantStatusLabels[report.variant_status]}</span>
      </div>

      <div className="hs-hero__identity">
        <h1 className="hs-hero__title" id="rpt-report-title">
          {vehicle.make} {vehicle.model}
          <span className="hs-hero__year ds-mono">{vehicle.year}</span>
        </h1>
        <p className="hs-hero__spec ds-mono">
          {vehicle.engine} · {vehicle.gearbox} · {vehicle.drivetrain}
          {vehicle.mileage_km === null ? "" : ` · ${formatNumber(vehicle.mileage_km)} km`}
        </p>
      </div>

      <RiskSummary report={report} />

      <p className="hs-hero__basis">Sammanställd från publicerade källor</p>

      <div className="hs-hero__foot">
        <p className="hs-hero__refs ds-mono">
          <span>RAPPORT {shortId ?? "EXEMPEL"}</span>
          <span>{formatDate(date)}</span>
        </p>
        <div className="hs-hero__badges">
          <CoverageBadge coverage={report.research_summary.coverage} />
          <ReviewBadge status={report.review_status} />
        </div>
      </div>

      {report.variant_status !== "identified" && report.assumptions.length > 0 && (
        <section className="hs-assumptions" aria-labelledby="hs-assumptions-title">
          <h2 id="hs-assumptions-title" className="hs-assumptions__title ds-mono">
            RAPPORTEN UTGÅR FRÅN
          </h2>
          <ul className="hs-assumptions__list">
            {report.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </section>
      )}
    </header>
  );
}
