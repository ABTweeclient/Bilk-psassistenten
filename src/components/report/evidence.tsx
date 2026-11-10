import { BadgeCheck } from "lucide-react";
import { useId, useState } from "react";
import {
  coverageDescriptions,
  coverageLabels,
  sourceTypeLabels,
  thinCoverageNotice,
  type Coverage,
  type ReviewStatus,
  type Source,
} from "@/lib/report";
import "@/styles/system.css";
import "./evidence.css";

/**
 * Underlags-UI för rapporten: hur väl det researchade materialet täcker just
 * den här bilvarianten, och vilka källor varje punkt bygger på.
 *
 * Produktregel: gränssnittet får bara visa den nivå som underlaget faktiskt
 * håller. Ingen badge uppgraderas, och "Granskad av oss" visas aldrig om
 * rapporten inte är granskad.
 */

const coverageBadgeVariant: Record<Coverage, string> = {
  good: "ds-badge--low",
  partial: "ds-badge--confidence",
  thin: "ds-badge--medium",
};

const retrievedFormatter = new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" });

function formatRetrieved(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : retrievedFormatter.format(parsed);
}

/**
 * "Underlag: Bra / Delvis / Tunt" med en kort förklaring som visas vid hover,
 * vid klick/tryck och vid tangentbordsfokus.
 */
export function CoverageBadge({ coverage, notes }: { coverage: Coverage; notes?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <span className="ev-coverage" data-coverage={coverage}>
      <button
        type="button"
        className={`ev-coverage__trigger ds-badge ${coverageBadgeVariant[coverage]}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="ev-coverage__dot" aria-hidden="true" />
        Underlag: {coverageLabels[coverage]}
      </button>

      <span id={panelId} className="ev-coverage__panel">
        {notes ? <span className="ds-note ev-coverage__notes">{notes}</span> : null}
        <span className="ev-coverage__explain">{coverageDescriptions[coverage]}</span>
      </span>
    </span>
  );
}

/**
 * Notisen högst upp i rapporten. Visas bara när underlaget är tunt, och aldrig
 * i något annat läge.
 */
export function CoverageNotice({ coverage }: { coverage: Coverage }) {
  if (coverage !== "thin") return null;

  return (
    <aside className="ev-notice">
      <span className="ev-notice__label">Begränsat underlag</span>
      <p role="note" className="ev-notice__text">
        {thinCoverageNotice}
      </p>
    </aside>
  );
}

/** Numrerad källförteckning. Punkt *n* får id `rp-source-n` som rapporten länkar till. */
export function SourceList({ sources, note }: { sources: readonly Source[]; note?: string }) {
  return (
    <div className="ev-sources-wrap">
      <ol className="ev-sources" role="list">
        {sources.map((source, index) => {
          const number = index + 1;
          return (
            <li className="ev-source" id={`rp-source-${number}`} key={source.id}>
              <span className="ev-source__number ds-mono" aria-hidden="true">
                {String(number).padStart(2, "0")}
              </span>
              <span className="ev-source__body">
                <span className="ev-source__meta ds-mono">
                  <span className="ds-badge">{sourceTypeLabels[source.source_type]}</span>
                  <span>Hämtad {formatRetrieved(source.retrieved_at)}</span>
                </span>
                <a className="ev-source__title" href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                  <span className="ev-sr-only"> (öppnas i ny flik)</span>
                </a>
                <span className="ev-source__publisher">
                  Utgivare: <strong>{source.publisher}</strong>
                </span>
                <span className="ev-source__url ds-mono">{source.url}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="ds-note ev-sources__note">
        {note ??
          "Länkarna i exempelrapporten är platshållare och leder ingenstans. I en färdig rapport går varje rad till den källa som punkten bygger på."}
      </p>
    </div>
  );
}

/** "Specifikt för din bil" eller "Allmänt". */
export function VariantLabel({ variantSpecific }: { variantSpecific: boolean }) {
  return (
    <span className="ev-variant" data-variant={variantSpecific ? "specific" : "general"}>
      <span className="ev-variant__dot" aria-hidden="true" />
      {variantSpecific ? "Specifikt för din bil" : "Allmänt"}
    </span>
  );
}

/**
 * Liten markör som bara visas för allmänna punkter.
 *
 * Kundvyn märker inte längre varje variantspecifik punkt: en enda rad i
 * avsnittets början säger att punkterna gäller bilen, och bara undantagen –
 * de allmänna – får en markör. Det håller listan lugn och läsbar.
 */
export function GeneralLabel() {
  return (
    <span className="ev-variant" data-variant="general">
      <span className="ev-variant__dot" aria-hidden="true" />
      Allmänt
    </span>
  );
}

/** Visas bara för granskade rapporter. Returnerar inget för "unreviewed". */
export function ReviewBadge({ status }: { status: ReviewStatus }) {
  if (status !== "reviewed") return null;

  return (
    <span className="ev-review">
      <BadgeCheck size={14} aria-hidden="true" />
      Granskad av oss
    </span>
  );
}
