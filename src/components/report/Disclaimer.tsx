import { ReviewBadge } from "@/components/report/evidence";
import type { Report } from "@/lib/report";
import "@/styles/system.css";
import "./header-summary.css";

const notInspectionSentence = "Detta är inte en teknisk besiktning.";

/**
 * Rapportens avslutning: avrivningskant, underlagets omfattning och de
 * förtydliganden som krävs. Granskningsmärket visas bara för granskade
 * rapporter – ReviewBadge renderar inget annat.
 */
export function Disclaimer({ report }: { report: Report }) {
  const note = report.disclaimer_note;
  const sentenceAlreadyInNote = note.includes(notInspectionSentence);

  return (
    <footer className="dk-disclaimer">
      <span className="dk-tear" aria-hidden="true" />

      <h2 className="dk-disclaimer__title">Om underlaget</h2>

      <p className="dk-disclaimer__text">{report.data_basis_note}</p>
      <p className="dk-disclaimer__text">
        Kostnadsuppgifter är ungefärliga uppskattningar om inget annat anges och är inte offerter.
      </p>
      {!sentenceAlreadyInNote && <p className="dk-disclaimer__strong">{notInspectionSentence}</p>}
      <p className="dk-disclaimer__strong">{note}</p>

      <div className="dk-disclaimer__footer">
        <ReviewBadge status={report.review_status} />
        <p className="ds-note">
          Vägledningen ersätter inte att du själv tittar på bilen eller låter en oberoende verkstad undersöka den.
        </p>
      </div>
    </footer>
  );
}
