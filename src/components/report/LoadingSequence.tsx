import type { CSSProperties } from "react";
import type { ResearchStatus } from "@/lib/report";
import "@/styles/system.css";
import "./report.css";

/** Row shape and reveal delay for the skeleton, so no inline style is repeated by hand. */
const SKELETON_ROWS: ReadonlyArray<readonly [string, number]> = [
  ["wide", 60], ["short", 120], ["block", 200], ["wide", 280], ["short", 340], ["block", 420],
];

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Laddningsvyn för en Bilköpsrapport.
 *
 * Den visar bara de steg som statusrapporteringen faktiskt har lämnat, plus
 * förfluten tid. Ingen procentandel visas, inga framtida steg hittas på, och
 * sista steget ligger kvar tills rapporten finns – flödet får aldrig se färdigt
 * ut i förtid. Samma vy används av den riktiga sömmen (`requestReport`) och av
 * demot på /design (se `useSimulatedResearch`).
 */
export function LoadingSequence({ status, note }: { status: ResearchStatus; note?: string }) {
  const { stages, elapsedSeconds } = status;
  const current = stages.length > 0 ? stages[stages.length - 1] : null;
  const atLastReportedStage = current ? current.index === current.total - 1 : false;

  return (
    <section className="rp-loading" aria-busy="true" aria-labelledby="rp-loading-title">
      <div className="rp-loading__top">
        <span className="ds-status-dot" aria-hidden="true" />
        <h2 id="rp-loading-title" className="ds-mono">RAPPORTEN SAMMANSTÄLLS</h2>
        <span className="rp-loading__clock ds-mono" role="timer" aria-label="Förfluten tid">{formatClock(elapsedSeconds)}</span>
      </div>

      <div className="rp-loading__grid">
        <div className="rp-loading__doc" aria-hidden="true">
          <div className="ds-skeleton-row ds-skeleton-row--heading" />
          {SKELETON_ROWS.map(([width, delay]) => (
            <div
              key={delay}
              className={`ds-skeleton-row ds-skeleton-row--${width}`}
              style={{ "--skeleton-delay": `${delay}ms` } as CSSProperties}
            />
          ))}
        </div>

        <div className="rp-loading__status">
          <p className="rp-loading__label ds-mono">FRAMSTEG</p>
          <p className="rp-loading__stage" role="status" aria-live="polite" aria-atomic="true">
            {current ? current.label : "Forskningsarbetet har startat…"}
          </p>
          {stages.length > 0 && (
            <ol className="ds-status-list">
              {stages.map((stage, index) => (
                <li key={stage.index} data-state={index === stages.length - 1 ? "active" : "done"}>
                  <span className="ds-status-dot" aria-hidden="true" />
                  <span>{stage.label}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="ds-note">
            Sökningen och sammanställningen tar oftast under en minut, och rapporten visas först när hela underlaget är klart.
            {atLastReportedStage ? " Sista steget pågår just nu." : ""}
          </p>
          {note ? <p className="ds-note rp-loading__note">{note}</p> : null}
        </div>
      </div>
    </section>
  );
}
