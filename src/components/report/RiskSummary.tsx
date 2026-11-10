import { formatNumber, type Report } from "@/lib/report";
import "@/styles/system.css";
import "./header-summary.css";

/**
 * Bedömningen i rapportens hero: en kort, färgkodad tagg som sammanfattar hur
 * många kända punkter rapporten innehåller, en faktarad om underlaget och de
 * fyra viktigaste kontrollerna.
 *
 * Fyra är ett tak, inte ett krav: listan ska rymmas i första vyn på mobil. Ett
 * längre underlag finns kvar i rapportdatan och i /admin, men hero:n ska gå att
 * läsa utan att scrolla.
 */
const heroChecksLimit = 4;

type TagTone = "few" | "some" | "many";

function assessmentTag(count: number): { label: string; tone: TagTone } {
  if (count <= 3) return { label: "Få kända punkter", tone: "few" };
  if (count <= 5) return { label: "Några punkter att kontrollera", tone: "some" };
  return { label: "Många punkter att kontrollera", tone: "many" };
}

export function RiskSummary({ report }: { report: Report }) {
  const { summary, known_issues: issues, vehicle } = report;
  const checks = summary.top_checks.slice(0, heroChecksLimit);
  const tag = assessmentTag(issues.length);
  const safetyCount = issues.filter((issue) => issue.safety_related).length;
  const issueCountLabel = issues.length === 1 ? "känt område" : "kända områden";
  const safetyCountLabel = safetyCount === 1 ? "säkerhetsrelaterad" : "säkerhetsrelaterade";
  const mileage = vehicle.mileage_km === null ? "" : `, ca ${formatNumber(vehicle.mileage_km)} km`;
  const facts = [
    `${issues.length} ${issueCountLabel}`,
    `${safetyCount} ${safetyCountLabel}`,
    `${vehicle.make} ${vehicle.model} (${vehicle.year})${mileage}`,
  ].join(" · ");

  return (
    <div className="rs-summary">
      <div className="rs-assessment">
        <span className={`rs-tag rs-tag--${tag.tone}`}>{tag.label}</span>
        <p className="rs-facts">{facts}</p>
      </div>

      <p className="rs-summary__text">{summary.text}</p>

      <section className="rs-checks" aria-labelledby="rs-checks-title">
        <h2 id="rs-checks-title" className="rs-checks__title ds-mono">
          VIKTIGASTE KONTROLLERNA
        </h2>
        <ol className="rs-checks__list">
          {checks.map((check, index) => (
            <li key={check}>
              <span className="rs-checks__number ds-mono" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{check}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
