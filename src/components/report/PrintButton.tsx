import { Printer } from "lucide-react";
import "@/styles/system.css";
import "./feedback.css";

/**
 * Skriv ut-knapp för rapporten. Bär klassen `rpt-print` eftersom
 * rapportens utskriftsstilar dolde den, och använder webbläsarens utskrift
 * (utskriftsarket sköts av CSS, inte av en separat PDF-tjänst).
 */
export function PrintButton({ label = "Skriv ut rapporten", className }: { label?: string; className?: string }) {
  return (
    <button
      type="button"
      className={`ds-btn ds-btn--secondary rpt-print fw-print${className ? ` ${className}` : ""}`}
      onClick={() => window.print()}
    >
      <Printer size={16} aria-hidden="true" />
      {label}
    </button>
  );
}
