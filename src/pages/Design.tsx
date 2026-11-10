import { CoverageBadge, CoverageNotice, ReviewBadge, SourceList, VariantLabel } from "@/components/report/evidence";
import { LoadingSequence } from "@/components/report/LoadingSequence";
import { useSimulatedResearch } from "@/components/report/useSimulatedResearch";
import { Reveal, RiskMeter } from "@/components/system/motion";
import {
  researchStageLines,
  sampleReport,
  sampleStates,
  severityLabels,
  stampTexts,
  type Coverage,
  type SampleState,
} from "@/lib/report";
import { Check, ChevronDown, Lock } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import "@/styles/system.css";
import "./design.css";

const demoChecks = [
  "Servicebok finns",
  "Motorolja",
  "Kylarvätska",
  "Bromsvätska",
  "Läckage under bilen",
  "Missljud vid kallstart",
  "Varningslampor",
  "Provkörning i låg fart",
  "Provkörning på landsväg",
  "Bromsprov",
  "Rattvridning",
  "Ojämnt underlag",
  "Däckmönster",
  "Jämnt slitage",
  "Fälgskador",
  "Lås och fjärr",
  "Elhissar och torkare",
  "Belysning och bromsljus",
  "Klimatanläggning",
  "Instrumentering",
  "Säten och bälten",
  "Fukt i kupén",
  "Nycklar och tillbehör",
  "Senaste kontrollrapporten från verkstad",
];

const demoQuestions = [
  {
    question: "När utfördes servicen senast och finns dokumentation?",
    why: "Servicehistoriken är det starkaste underlaget för hur bilen skötts. Utan den går det inte att bedöma kommande underhåll.",
  },
  {
    question: "Har bilen varit inblandad i en olycka eller lackats om?",
    why: "Reparationer efter skada påverkar både värdet och vilka delar som är extra viktiga att titta på vid visningen.",
  },
  {
    question: "Vad är nästa planerade service och vad brukar den kosta?",
    why: "Kommande underhåll är en del av den verkliga kostnaden de första åren och är lätt att glömma bort i prisförhandlingen.",
  },
];

const palette = [
  { name: "Primär orange", value: "#E65C00" },
  { name: "Mjuk orange", value: "#FFB380" },
  { name: "Analytisk blågrå", value: "#53617A" },
  { name: "Yta", value: "#F7F4EB" },
  { name: "Bakgrund", value: "#FDFBF7" },
];

const tableRows: { area: string; detail: string; severity: "high" | "medium" | "low" }[] = [
  { area: "Servicehistorik", detail: "Be om serviceunderlag och jämför datum med mätarställningen.", severity: "high" },
  { area: "Växellåda", detail: "Provkör både i krypfart och i jämn landsvägsfart och känn efter fördröjning.", severity: "medium" },
  { area: "El och elektronik", detail: "Starta kallt och varmt och kontrollera att inga varningslampor kvarstår.", severity: "low" },
];

/** Rubriker för länkarna till exempelrapportens tre täckningslägen. */
const stateLabels: Record<SampleState, string> = {
  good: "Bra underlag",
  partial: "Delvis underlag",
  thin: "Tunt underlag",
};

/* Stegen kommer från samma källa som rapportflödet använder, så att texten i
   översikten aldrig kan glida ifrån den som visas vid research. */
const statusLines = researchStageLines.map((text, index) => ({
  text,
  state: index < 2 ? "done" : index === 2 ? "active" : "idle",
}));

/** De tre täckningsnivåerna, med en egen kort förklaring på den tunna nivån. */
const coverageStates: { coverage: Coverage; notes?: string }[] = [
  { coverage: "good" },
  { coverage: "partial" },
  { coverage: "thin", notes: "Exempelförklaring: få publicerade källor handlar om exakt den här kombinationen av motor, växellåda och drivlina." },
];

export default function Design() {
  const [checked, setChecked] = useState<string[]>(demoChecks.slice(0, 7));
  const [openQuestion, setOpenQuestion] = useState<number | null>(0);
  const { status, isRunning, start, stop } = useSimulatedResearch();

  useEffect(() => {
    const existing = document.querySelector('meta[name="robots"]');
    const previous = existing?.getAttribute("content") ?? null;
    const meta = existing ?? document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", "noindex, nofollow");
    if (!existing) document.head.appendChild(meta);
    return () => {
      if (previous === null) meta.remove();
      else meta.setAttribute("content", previous);
    };
  }, []);

  function toggleCheck(item: string) {
    setChecked((current) => current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item]);
  }

  const progress = checked.length / demoChecks.length;

  return (
    <main className="ds-page">
      <div className="ds-page__inner">
        <header className="ds-page__head">
          <p className="ds-page__eyebrow">INTERN DESIGNÖVERSIKT</p>
          <h1>Bilköpsassistentens komponenter</h1>
          <p className="ds-page__intro">
            Den här sidan visar prototypens delade komponenter i varje läge, så att knappar, fält, etiketter och
            rapportdelar kan granskas på ett ställe innan de används i det riktiga flödet.
          </p>
          <p className="ds-page__internal"><Lock size={14} aria-hidden="true" /> Intern sida som är undantagen från sökmotorer och inte länkas från navigeringen.</p>
          <div className="ds-swatch-grid">
            {palette.map((token) => (
              <div className="ds-swatch" key={token.value}>
                <span className="ds-swatch__color" style={{ background: token.value }} aria-hidden="true" />
                <span className="ds-swatch__meta">
                  <span className="ds-swatch__name">{token.name}</span>
                  <span className="ds-swatch__value">{token.value}</span>
                </span>
              </div>
            ))}
          </div>
        </header>

        <Reveal as="section" className="ds-section" delay={0}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">01</span>
            <h2 className="ds-section-header__title">Knappar</h2>
          </div>
          <div className="ds-section__grid ds-section__grid--two">
            <div className="ds-panel">
              <p className="ds-panel__label">NORMALLÄGE</p>
              <div className="ds-row">
                <button type="button" className="ds-btn ds-btn--primary">Analysera bilen</button>
                <button type="button" className="ds-btn ds-btn--secondary">Exempelrapport</button>
                <button type="button" className="ds-btn ds-btn--ghost">Avbryt</button>
              </div>
            </div>
            <div className="ds-panel">
              <p className="ds-panel__label">INAKTIV OCH PÅGÅENDE</p>
              <div className="ds-row">
                <button type="button" className="ds-btn ds-btn--primary" disabled>Analysera bilen</button>
                <button type="button" className="ds-btn ds-btn--primary" aria-busy="true">
                  <span className="ds-btn__spinner" aria-hidden="true" />
                  Bygger rapporten
                </button>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={90}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">02</span>
            <h2 className="ds-section-header__title">Fält och val</h2>
          </div>
          <div className="ds-section__grid ds-section__grid--two">
            <div className="ds-panel ds-stack">
              <label className="ds-field">
                <span className="ds-field__label">BILMÄRKE OCH MODELL</span>
                <input className="ds-input" type="text" defaultValue="Exempelbil Modell X" />
                <span className="ds-field__hint">Skriv så mycket du vet – modell, motor, växellåda och årsmodell.</span>
              </label>
              <label className="ds-field">
                <span className="ds-field__label">ÅRSMODELL</span>
                <input className="ds-input" type="text" defaultValue="20" aria-invalid="true" aria-describedby="design-year-error" />
                <span className="ds-field__error" id="design-year-error">Ange en årsmodell med fyra siffror.</span>
              </label>
            </div>
            <div className="ds-panel ds-stack">
              <label className="ds-field">
                <span className="ds-field__label">VÄXELLÅDA</span>
                <select className="ds-select" defaultValue="Automat">
                  <option value="Automat">Automat</option>
                  <option value="Manuell">Manuell</option>
                </select>
                <span className="ds-field__hint">Växellådan styr vilka punkter som blir relevanta i rapporten.</span>
              </label>
              <label className="ds-field">
                <span className="ds-field__label">SÖKNING</span>
                <input className="ds-input" type="search" placeholder="Sök bland kontrollpunkter" />
                <span className="ds-field__hint">Användbart när rapporten innehåller många punkter.</span>
              </label>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={180}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">03</span>
            <h2 className="ds-section-header__title">Etiketter</h2>
          </div>
          <div className="ds-panel ds-stack">
            <p className="ds-panel__label">ALLVARLIGHETSGRAD</p>
            <div className="ds-row">
              <span className="ds-badge ds-badge--high">HÖG</span>
              <span className="ds-badge ds-badge--medium">MEDEL</span>
              <span className="ds-badge ds-badge--low">LÅG</span>
            </div>
            <p className="ds-panel__label">SÄKERHET I BEDÖMNINGEN</p>
            <div className="ds-row">
              <span className="ds-badge ds-badge--confidence">HÖG SÄKERHET</span>
              <span className="ds-badge ds-badge--confidence">MEDEL</span>
            </div>
            <p className="ds-panel__label">STÄMPEL</p>
            <div className="ds-row">
              <span className="ds-stamp ds-stamp--low is-landed">{stampTexts.low}</span>
              <span className="ds-stamp ds-stamp--medium is-landed">{stampTexts.medium}</span>
              <span className="ds-stamp ds-stamp--high is-landed">{stampTexts.high}</span>
            </div>
            <p className="ds-note">
              Stämpeln formulerar vår egen bedömning. Den är en textetikett med rak ram – ingen sigill, stjärna eller
              godkännandemärkning.
            </p>
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={270}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">04</span>
            <h2 className="ds-section-header__title">Rapportram</h2>
          </div>
          <div className="ds-frame ds-panel">
            <p className="ds-panel__label">RAMENS HÖRN</p>
            <p className="ds-note">
              Ramen används som en diskret markering kring rapportens första del, aldrig som ett genomgående motiv.
            </p>
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={360}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">05</span>
            <h2 className="ds-section-header__title">Sektionsrubrik</h2>
          </div>
          <div className="ds-panel ds-stack">
            <div className="ds-section-header">
              <span className="ds-section-header__number">01</span>
              <h3 className="ds-section-header__title">Sammanfattning</h3>
            </div>
            <div className="ds-section-header">
              <span className="ds-section-header__number">02</span>
              <h3 className="ds-section-header__title">Frågor till säljaren</h3>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={360}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">06</span>
            <h2 className="ds-section-header__title">Tabell</h2>
          </div>
          <div className="ds-panel">
            <table className="ds-table">
              <caption>Exempel på hur områden, kontroller och nivåer visas i rapporten.</caption>
              <thead>
                <tr>
                  <th scope="col">OMRÅDE</th>
                  <th scope="col">ATT VARA UPPMÄRKSAM PÅ</th>
                  <th scope="col">NIVÅ</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={row.area}>
                    <th scope="row">{row.area}</th>
                    <td>{row.detail}</td>
                    <td>
                      <span className={`ds-badge ds-badge--${row.severity}`}>
                        {severityLabels[row.severity].toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={360}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">07</span>
            <h2 className="ds-section-header__title">Kryssruta</h2>
          </div>
          <div className="ds-panel">
            <p className="ds-progress" aria-live="polite">
              <strong>{checked.length}</strong> av {demoChecks.length} kontrollerade
            </p>
            <span className="ds-progress-bar" aria-hidden="true">
              <span className="ds-progress-bar__fill" style={{ transform: `scaleX(${progress})` }} />
            </span>
            <div className="ds-checklist">
              {demoChecks.map((item, index) => (
                <label className="ds-check" key={item}>
                  <span className="ds-check__control">
                    <input type="checkbox" checked={checked.includes(item)} onChange={() => toggleCheck(item)} />
                    <span className="ds-check__tick" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
                  </span>
                  <span className="ds-check__text">
                    <span className="ds-check__number">{String(index + 1).padStart(2, "0")}</span> {item}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={360}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">08</span>
            <h2 className="ds-section-header__title">Dragspel</h2>
          </div>
          <div className="ds-panel">
            {demoQuestions.map((item, index) => (
              <div className="ds-accordion" key={item.question}>
                <button
                  type="button"
                  className="ds-accordion__trigger"
                  aria-expanded={openQuestion === index}
                  aria-controls={`design-question-${index}`}
                  onClick={() => setOpenQuestion(openQuestion === index ? null : index)}
                >
                  <span className="ds-accordion__index">{String(index + 1).padStart(2, "0")}</span>
                  <span>{item.question}</span>
                  <ChevronDown className="ds-accordion__chevron" size={18} aria-hidden="true" />
                </button>
                <div
                  className={`ds-accordion__panel ${openQuestion === index ? "is-open" : ""}`}
                  id={`design-question-${index}`}
                  hidden={openQuestion !== index}
                >
                  {item.why}
                </div>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={360}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">09</span>
            <h2 className="ds-section-header__title">Skelettrader</h2>
          </div>
          <div className="ds-section__grid ds-section__grid--two">
            <div className="ds-panel">
              <p className="ds-panel__label">MEDAN RAPPORTEN BYGGS UPP</p>
              <div aria-hidden="true">
                <span className="ds-skeleton-row ds-skeleton-row--heading" style={{ "--skeleton-delay": "0ms" } as CSSProperties} />
                <span className="ds-skeleton-row ds-skeleton-row--wide" style={{ "--skeleton-delay": "90ms" } as CSSProperties} />
                <span className="ds-skeleton-row ds-skeleton-row--short" style={{ "--skeleton-delay": "180ms" } as CSSProperties} />
              </div>
              <p className="ds-note">Skelettraderna är dekorativa och läses inte upp. Statusraderna intill beskriver vad som händer.</p>
            </div>
            <div className="ds-panel">
              <p className="ds-panel__label">STATUSRADER</p>
              <ol className="ds-status-list" aria-live="polite">
                {statusLines.map((line) => (
                  <li key={line.text} data-state={line.state}>
                    <span className="ds-status-dot" aria-hidden="true" />
                    {line.text}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={360}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">10</span>
            <h2 className="ds-section-header__title">Riskmätare</h2>
          </div>
          <div className="ds-section__grid ds-section__grid--two">
            <div className="ds-panel">
              <RiskMeter score={42} level="medium" />
            </div>
            <div className="ds-panel">
              <RiskMeter score={71} level="high" />
            </div>
          </div>
          <p className="ds-note">
            Mätaren fylls till sitt värde, varefter nivåtexten och stämpeln landar. Alla siffror i rapporten är
            exempelvärden i prototypen.
          </p>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={360}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">11</span>
            <h2 className="ds-section-header__title">Underlag och täckning</h2>
          </div>
          <div className="ds-panel ds-stack">
            <p className="ds-panel__label">TÄCKNINGSNIVÅER</p>
            <div className="ds-row">
              {coverageStates.map((state) => (
                <CoverageBadge key={state.coverage} coverage={state.coverage} notes={state.notes} />
              ))}
            </div>
            <p className="ds-note">
              Etiketten beskriver hur bra underlaget är för just den varianten. Förklaringen visas när man pekar på
              eller klickar på etiketten.
            </p>
            <p className="ds-panel__label">NOTIS VID TUNT UNDERLAG</p>
            <CoverageNotice coverage="thin" />
            <p className="ds-note">
              Notisen visas högst upp i rapporten när täckningen är tunt. Vid bra eller delvis täckning renderas inget
              alls – det tomma resultatet är avsiktligt.
            </p>
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={360}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">12</span>
            <h2 className="ds-section-header__title">Källor</h2>
          </div>
          <div className="ds-panel ds-stack">
            <p className="ds-note">
              Numreringen här är samma numrering som rapportens punkter hänvisar till i sina Underlag-paneler. I
              exempelrapporten är länkar och utgivare platshållare som inte leder till någon riktig källa.
            </p>
            <SourceList sources={sampleReport.sources} />
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={360}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">13</span>
            <h2 className="ds-section-header__title">Variantetiketter och granskning</h2>
          </div>
          <div className="ds-panel ds-stack">
            <p className="ds-panel__label">VARIANTETIKETTER</p>
            <div className="ds-label-row">
              <VariantLabel variantSpecific />
              <p className="ds-note">Punkten gäller just den kombination av modell, motor, växellåda och drivlina som användaren angav.</p>
            </div>
            <div className="ds-label-row">
              <VariantLabel variantSpecific={false} />
              <p className="ds-note">Punkten är allmän och gäller oavsett variant.</p>
            </div>
            <p className="ds-note">
              Variant-specifika punkter listas först i varje sektion, och filtret ”Visa bara punkter specifika för min
              bil” döljer de allmänna.
            </p>
            <p className="ds-panel__label">GRANSKNING</p>
            <div className="ds-row">
              <ReviewBadge status="reviewed" />
              <span className="ds-note">Visas bara när rapporten är granskad av oss.</span>
            </div>
            <div className="ds-row">
              <ReviewBadge status="unreviewed" />
              <span className="ds-note">Här renderas ingenting alls. Det tomma resultatet är produktregeln – en ogranskad rapport får aldrig visa en granskningsmärkning.</span>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={360}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">14</span>
            <h2 className="ds-section-header__title">Lägen i exempelrapporten</h2>
          </div>
          <div className="ds-panel ds-stack">
            <p className="ds-note">
              Exempelrapporten finns i tre täckningslägen. Öppna den i valt läge för att granska etiketten, förklaringen
              och – vid tunt underlag – notisen högst upp i rapporten.
            </p>
            <div className="ds-row">
              {sampleStates.map((state) => (
                <Link className="ds-btn ds-btn--secondary" key={state} to={`/rapport?state=${state}`}>
                  {stateLabels[state]}
                </Link>
              ))}
            </div>
            <p className="ds-note">
              Standardläget är <strong>Delvis underlag</strong>, samma underlag som exemplet utgår från.
            </p>
          </div>
        </Reveal>

        <Reveal as="section" className="ds-section" delay={360}>
          <div className="ds-section-header">
            <span className="ds-section-header__number">15</span>
            <h2 className="ds-section-header__title">Laddningssekvensen</h2>
          </div>
          <div className="ds-panel ds-stack">
            <div className="ds-row">
              <button type="button" className="ds-btn ds-btn--primary" onClick={start} disabled={isRunning}>
                Spela upp laddningssekvensen
              </button>
              <button type="button" className="ds-btn ds-btn--secondary" onClick={stop} disabled={!isRunning}>
                Stoppa
              </button>
            </div>
            <p className="ds-note">
              Sekvensen drivs av en simulerad status i demot och går aldrig i mål av sig själv: den stannar på sista
              steget tills något annat säger att rapporten finns. Exakt samma vy drivs i det riktiga flödet av den
              status en backend rapporterar.
            </p>
            {status.stages.length > 0 && <LoadingSequence status={status} />}
          </div>
        </Reveal>
      </div>
    </main>
  );
}
