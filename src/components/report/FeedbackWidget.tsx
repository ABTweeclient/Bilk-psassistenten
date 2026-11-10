import { useMutation } from "convex/react";
import { useId, useState } from "react";
import { api } from "@/convex/_generated/api";
import { reportFlagLabels, reportFlagKindSchema, reportFlagSchema, type ReportFlagKind } from "@/lib/report";
import "@/styles/system.css";
import "./feedback.css";

/**
 * Feedbackwidget för en Bilköpsrapport.
 *
 * Med ett rapport-id skickas flaggan till backend och syns i /admin. Utan
 * rapport-id (förhandsvisningen) sparas ingenting, och formuläret säger det
 * rakt ut.
 */
export function FeedbackWidget({ reportId }: { reportId?: string }) {
  const flagReport = useMutation(api.vehicleReports.flagReport);
  const [kind, setKind] = useState<ReportFlagKind>("wrong");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const messageId = useId();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportId) {
      setState("sent");
      return;
    }
    const parsed = reportFlagSchema.safeParse({ kind, message });
    if (!parsed.success) {
      setState("error");
      setError(parsed.error.issues[0]?.message ?? "Kontrollera texten och försök igen.");
      return;
    }
    setState("sending");
    setError("");
    try {
      await flagReport({ reportId, kind, message });
      setMessage("");
      setState("sent");
    } catch {
      setState("error");
      setError("Det gick inte att skicka just nu. Försök igen om en liten stund.");
    }
  }

  return (
    <section id="feedback" className="rpt-feedback fw-feedback" aria-labelledby="fw-feedback-title">
      <p className="ds-mono fw-feedback__eyebrow">TYCK TILL OM RAPPORTEN</p>
      <h2 id="fw-feedback-title" className="fw-feedback__title">Stämmer inte något, eller saknades något?</h2>
      <p className="ds-note fw-feedback__intro">
        {reportId
          ? "Din flagga går till oss som granskar rapporterna. Skriv kort vad som var fel eller saknades."
          : "I den här förhandsvisningen sparas ingenting – formuläret visar bara hur flödet ser ut."}
      </p>

      <form className="fw-feedback__form" onSubmit={handleSubmit}>
        {reportId && (
          <div className="ds-field fw-feedback__field">
            <label className="ds-field__label" htmlFor={`${messageId}-kind`}>VAD GÄLLER DET?</label>
            <select
              id={`${messageId}-kind`}
              className="ds-select"
              value={kind}
              onChange={(event) => {
                const parsed = reportFlagKindSchema.safeParse(event.target.value);
                if (parsed.success) {
                  setKind(parsed.data);
                  setState("idle");
                }
              }}
            >
              {(Object.keys(reportFlagLabels) as ReportFlagKind[]).map((option) => (
                <option key={option} value={option}>{reportFlagLabels[option]}</option>
              ))}
            </select>
          </div>
        )}

        <div className="ds-field fw-feedback__field">
          <label className="ds-field__label" htmlFor={messageId}>{reportId ? "BESKRIV KORT" : "VAD SAKNADES?"}</label>
          <textarea
            id={messageId}
            className="fw-textarea"
            rows={4}
            maxLength={600}
            required={Boolean(reportId)}
            value={message}
            placeholder="Till exempel: punkten om växellådan stämmer inte, eller så verkar kostnadsuppskattningen orimlig."
            onChange={(event) => {
              setMessage(event.target.value);
              setState("idle");
              setError("");
            }}
          />
        </div>

        <div className="fw-feedback__actions">
          <button type="submit" className="ds-btn ds-btn--primary" disabled={state === "sending"}>
            {state === "sending" ? "Skickar…" : "Skicka feedback"}
          </button>
          <button
            type="button"
            className="ds-btn ds-btn--ghost"
            onClick={() => {
              setMessage("");
              setState("idle");
              setError("");
            }}
          >
            Rensa
          </button>
        </div>

        <p className="fw-feedback__confirmation" role="status" aria-live="polite">
          {state === "sent" ? (reportId ? "Tack! Vi går igenom din flagga." : "Tack! I den här förhandsvisningen skickas inget vidare.") : ""}
        </p>
        {state === "error" && <p className="ds-field__error" role="alert">{error}</p>}
      </form>
    </section>
  );
}
