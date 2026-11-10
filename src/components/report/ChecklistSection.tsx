import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { GeneralLabel } from "@/components/report/evidence";
import { checklistSections, type ChecklistItem } from "@/lib/report";
import { loadCheckedItems, saveCheckedItems } from "@/lib/reportProgress";
import "@/styles/system.css";
import "./checklist-section.css";

/**
 * Visningschecklistan i Bilköpsrapporten.
 *
 * Räknaren ligger kvar högst upp i avsnittet medan man scrollar, så att "7 av
 * 24 kontrollerade" syns hela tiden. Sektionerna kan fällas ihop, och varje rad
 * är en stor tryckyta.
 *
 * Avbockningarna sparas per rapport i localStorage (via reportProgress), så att
 * läget finns kvar efter en omladdning. Saknas lagring fungerar listan ändå,
 * men kommer inte ihåg något mellan besök.
 *
 * Avsnittet märker bara undantagen: de allmänna punkterna får en liten
 * "Allmänt"-markör, medan en enda rad överst säger att resten gäller bilen.
 */
export function ChecklistSection({ reportId, items }: { reportId: string; items: readonly ChecklistItem[] }) {
  return <ChecklistSectionState key={reportId} reportId={reportId} items={items} />;
}

function ChecklistSectionState({ reportId, items }: { reportId: string; items: readonly ChecklistItem[] }) {
  const [checked, setChecked] = useState<string[]>(() => loadCheckedItems(reportId));
  const [onlyVariant, setOnlyVariant] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);

  const sections = checklistSections(items);
  const total = items.length;
  const complete = checked.filter((id) => items.some((item) => item.id === id)).length;
  const variantCount = items.filter((item) => item.variant_specific).length;
  const progress = total > 0 ? complete / total : 0;
  const filterId = `cl-only-variant-${reportId}`;

  function toggle(id: string, next: boolean) {
    const updated = next ? [...checked, id] : checked.filter((entry) => entry !== id);
    setChecked(updated);
    saveCheckedItems(reportId, updated);
  }

  return (
    <div className="cl-checklist">
      <div className="cl-progress">
        <p className="ds-progress" aria-live="polite">
          <strong>{complete}</strong> av {total} kontrollerade
        </p>
        <div className="ds-progress-bar">
          <span className="ds-progress-bar__fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>

      <p className="cl-intro">
        Punkterna gäller din variant. De som är märkta <GeneralLabel /> gäller alla bilar.
      </p>

      <div className="cl-filter">
        <input
          id={filterId}
          type="checkbox"
          checked={onlyVariant}
          onChange={(event) => setOnlyVariant(event.target.checked)}
        />
        <label htmlFor={filterId}>Visa bara punkter specifika för min bil</label>
        <span className="cl-filter__count">
          {variantCount} av {total} punkter är specifika för din bil
        </span>
      </div>

      {sections.map((section, index) => {
        const panelId = `cl-panel-${index}`;
        const isOpen = !collapsed.includes(section.title);
        const sectionComplete = section.items.filter((item) => checked.includes(item.id)).length;
        const visibleCount = onlyVariant ? section.items.filter((item) => item.variant_specific).length : section.items.length;

        return (
          <section className="cl-section" key={section.title} hidden={visibleCount === 0}>
            <h4 className="cl-section__heading">
              <button
                type="button"
                className="cl-section__trigger"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() =>
                  setCollapsed((current) =>
                    isOpen ? [...current, section.title] : current.filter((entry) => entry !== section.title),
                  )
                }
              >
                <span className="cl-section__title">{section.title}</span>
                <span className="cl-section__count ds-mono" aria-hidden="true">
                  {sectionComplete}/{section.items.length}
                </span>
                <ChevronDown className="cl-section__chevron" size={18} aria-hidden="true" />
              </button>
            </h4>

            <div id={panelId} className={`cl-section__panel ${isOpen ? "is-open" : ""}`} hidden={!isOpen}>
              {section.items.map((item) => (
                <label className="ds-check" key={item.id} hidden={onlyVariant && !item.variant_specific}>
                  <span className="ds-check__control">
                    <input
                      type="checkbox"
                      checked={checked.includes(item.id)}
                      onChange={(event) => toggle(item.id, event.target.checked)}
                    />
                    <span className="ds-check__tick" aria-hidden="true">
                      <Check size={15} strokeWidth={3} />
                    </span>
                  </span>
                  <span className="ds-check__text">
                    <span>{item.text}</span>
                    {!item.variant_specific && <GeneralLabel />}
                  </span>
                </label>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
