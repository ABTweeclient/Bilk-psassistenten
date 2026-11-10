import { ArrowRight, ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  confidenceLabels,
  formatSekRange,
  severityLabels,
  sortIssues,
  type Confidence,
  type KnownIssue,
  type Report,
  type RiskLevel,
} from "@/lib/report";
import "@/styles/system.css";
import "./issues-table.css";

/**
 * Kända problem i en Bilköpsrapport – som hopfällda kort på alla skärmbredder.
 *
 * Kortet visar rubrik, allvarlighet, en rad om symptomen och en tydlig
 * "Så kontrollerar du"-affordans. Hela kortets header är en knapp med
 * aria-expanded/aria-controls. Resten fälls ut vid klick: först och störst
 * "Så kontrollerar du", därefter hela symptomtexten, "Typiskt när" som en
 * liten notis och – bara när uppgiften finns – en ungefärlig kostnad.
 * Säkerhet i uppgiften visas bara om nivån skiljer sig mellan punkterna;
 * annars vore den samma rad på varje kort.
 *
 * Allvarlighet visas alltid med både text och en formmarkör, aldrig enbart med
 * färg. Kundvyn visar inga källhänvisningar: underlaget finns kvar i databasen
 * och i /admin.
 */

const severityShape: Record<RiskLevel, string> = { high: "full", medium: "half", low: "none" };
const confidenceShape: Record<Confidence, string> = { well_documented: "full", reported: "half", uncertain: "none" };
const severityBadge: Record<RiskLevel, string> = { high: "ds-badge--high", medium: "ds-badge--medium", low: "ds-badge--low" };

function ShapeMarker({ shape, fill }: { shape: "circle" | "square"; fill: string }) {
  return <span className="it-shape" data-shape={shape} data-fill={fill} aria-hidden="true" />;
}

function SeverityCell({ issue }: { issue: KnownIssue }) {
  return (
    <span className={`ds-badge it-severity ${severityBadge[issue.severity]}`}>
      <ShapeMarker shape="circle" fill={severityShape[issue.severity]} />
      {severityLabels[issue.severity]}
      {issue.safety_related ? " · säkerhetsrelaterad" : ""}
    </span>
  );
}

function ConfidenceCell({ issue }: { issue: KnownIssue }) {
  return (
    <span className="ds-badge ds-badge--confidence">
      <ShapeMarker shape="square" fill={confidenceShape[issue.confidence]} />
      {confidenceLabels[issue.confidence]}
    </span>
  );
}

/** Kostnadsraden skrivs bara ut när det finns ett intervall och ett underlag. */
function CostLine({ issue }: { issue: KnownIssue }) {
  const range = issue.cost_range_sek;
  if (!range || range.max <= 0 || issue.cost_basis === null) return null;

  const formatted = formatSekRange(range);
  if (!formatted) return null;

  const note = issue.cost_basis === "estimate" ? "uppskattning" : issue.cost_basis === "source" ? "från källa" : null;

  return (
    <p className="ip-card__fact">
      <span className="ip-card__fact-label ds-mono">Ungefärlig kostnad</span>
      <span className="ip-card__cost ds-mono">{formatted}</span>
      {note ? <span className="ip-card__cost-note">{note}</span> : null}
    </p>
  );
}

export function IssuesTable({ report }: { report: Report }) {
  const issues = sortIssues(report.known_issues);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const confidenceVaries = new Set(issues.map((issue) => issue.confidence)).size > 1;

  function toggle(id: string, next: boolean) {
    setOpenIds((current) => (next ? [...current, id] : current.filter((entry) => entry !== id)));
  }

  return (
    <div className="ip-wrap">
      <ul className="ip-list">
        {issues.map((issue, index) => {
          const panelId = `ip-panel-${index}`;
          const isOpen = openIds.includes(issue.id);

          return (
            <li key={issue.id}>
              <article className="ip-card" data-severity={issue.severity} data-open={isOpen}>
                <h3 className="ip-card__heading">
                  <button
                    type="button"
                    className="ip-card__trigger"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => toggle(issue.id, !isOpen)}
                  >
                    <span className="ip-card__row">
                      <span className="ip-card__title">{issue.title}</span>
                      <SeverityCell issue={issue} />
                      <span className="ip-card__chevron" aria-hidden="true">
                        <ChevronDown size={22} strokeWidth={2.25} />
                      </span>
                    </span>
                    <span className="ip-card__preview">{issue.symptoms}</span>
                    <span className="ip-card__action">
                      <span className="ip-card__action-label">{isOpen ? "Dölj" : "Så kontrollerar du"}</span>
                      <ArrowRight className="ip-card__action-icon" size={16} strokeWidth={2.25} aria-hidden="true" />
                    </span>
                  </button>
                </h3>

                <div id={panelId} className={`ip-card__panel ${isOpen ? "is-open" : ""}`} hidden={!isOpen}>
                  <div className="ip-card__check">
                    <p className="ip-card__label ds-mono">Så kontrollerar du</p>
                    <p className="ip-card__check-text">{issue.how_to_check}</p>
                  </div>

                  <div className="ip-card__symptom">
                    <p className="ip-card__label ds-mono">Symptom</p>
                    <p>{issue.symptoms}</p>
                  </div>

                  {confidenceVaries && (
                    <p className="ip-card__fact">
                      <span className="ip-card__fact-label ds-mono">Säkerhet i uppgiften</span>
                      <ConfidenceCell issue={issue} />
                    </p>
                  )}

                  <CostLine issue={issue} />

                  <p className="ip-card__onset">
                    <span className="ip-card__onset-label ds-mono">Typiskt när</span> {issue.typical_onset}
                  </p>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
