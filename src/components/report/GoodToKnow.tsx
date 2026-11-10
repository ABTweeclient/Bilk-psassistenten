import "@/styles/system.css";
import "./header-summary.css";

/** Bra att veta: en numrerad lista med hur rapporten ska läsas och användas. */
export function GoodToKnow({ items }: { items: readonly string[] }) {
  return (
    <div className="dk-good">
      <ol className="dk-good__list">
        {items.map((item, index) => (
          <li key={item}>
            <span className="dk-good__number ds-mono" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
      <p className="ds-note dk-good__note">
        Punkterna är allmänna och säger inget om en viss säljare eller ett visst exemplar.
      </p>
    </div>
  );
}
