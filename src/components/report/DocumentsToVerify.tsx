import { Check } from "lucide-react";
import { useState } from "react";
import "@/styles/system.css";
import "./questions-documents.css";

/**
 * Dokument att be säljaren om. Bockarna gäller bara den här visningen och
 * sparas inte mellan besök – det är underlaget, inte rapporten, som ska bockas
 * av och tas med.
 */
export function DocumentsToVerify({ documents }: { documents: readonly string[] }) {
  const [gathered, setGathered] = useState<string[]>([]);
  const total = documents.length;
  const complete = gathered.length;

  const toggle = (document: string, next: boolean) =>
    setGathered((current) => (next ? [...current, document] : current.filter((entry) => entry !== document)));

  return (
    <div className="qd-documents">
      <p className="qd-documents__count ds-note" aria-live="polite">
        <strong>{complete}</strong> av {total} dokument att be om
      </p>

      <div className="qd-documents__list">
        {documents.map((document, index) => (
          <label className="ds-check" key={document}>
            <span className="ds-check__control">
              <input
                type="checkbox"
                checked={gathered.includes(document)}
                onChange={(event) => toggle(document, event.target.checked)}
                aria-label={document}
              />
              <span className="ds-check__tick" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>
            </span>
            <span className="ds-check__text qd-document__text">
              <span>
                <span className="ds-check__number">{String(index + 1).padStart(2, "0")}</span> {document}
              </span>
            </span>
          </label>
        ))}
      </div>

      <p className="ds-note qd-documents__note">
        Kvitton och underlag är det enklaste sättet att kontrollera det säljaren berättar. Be om kopior redan innan
        visningen, så hinner du jämföra dem i lugn och ro.
      </p>
    </div>
  );
}
