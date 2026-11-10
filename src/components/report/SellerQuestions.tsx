import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { GeneralLabel } from "@/components/report/evidence";
import { variantSpecificFirst, type SellerQuestion } from "@/lib/report";
import "@/styles/system.css";
import "./questions-documents.css";

/**
 * Frågorna att ställa till säljaren. Bara frågan syns när raden är stängd;
 * "Varför du frågar" och "Svar som bör oroa dig" ligger under.
 *
 * Frågorna sorteras så att de som gäller just den variant rapporten beskriver
 * ligger först. Kundvyn märker bara undantagen: de allmänna frågorna får en
 * liten "Allmänt"-markör.
 */
export function SellerQuestions({ questions }: { questions: readonly SellerQuestion[] }) {
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const ordered = variantSpecificFirst(questions);

  return (
    <div className="qd-questions">
      <p className="qd-questions__intro">
        Frågorna gäller den här varianten. De som är märkta <GeneralLabel /> kan ställas till vilken säljare som helst.
      </p>

      {ordered.map((entry, index) => {
        const isOpen = openQuestion === entry.question;
        const panelId = `qd-answer-${index}`;

        return (
          <div className="ds-accordion" key={entry.question}>
            <h3 className="qd-question__title">
              <button
                type="button"
                className="ds-accordion__trigger qd-question__trigger"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenQuestion(isOpen ? null : entry.question)}
              >
                <span className="ds-accordion__index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <span className="qd-question__body">
                  <span>{entry.question}</span>
                  {!entry.variant_specific && <GeneralLabel />}
                </span>
                <ChevronDown className="ds-accordion__chevron" size={18} aria-hidden="true" />
              </button>
            </h3>

            <div id={panelId} className={`ds-accordion__panel qd-answer ${isOpen ? "is-open" : ""}`} hidden={!isOpen}>
              <p className="qd-answer__label ds-mono">VARFÖR DU FRÅGAR</p>
              <p className="qd-answer__text">{entry.why}</p>
              <p className="qd-answer__label ds-mono">SVAR SOM BÖR OROA DIG</p>
              <p className="qd-answer__text qd-answer__flag">{entry.red_flag_answer}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
