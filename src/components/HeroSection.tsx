import { useRef, useState } from "react";
import bilqlarLogo from "@/assets/bilqlar-logo.png";
import "./hero-section.css";

/**
 * Navigationen och hero-sektionen enligt den fastställda designen.
 * Klasserna är prefixade med bq- så att reglerna inte krockar med resten av
 * startsidans CSS.
 */
type HeroSectionProps = {
  /** Får skylten som skrivits i hero-fältet när man klickar på "Analysera". */
  onAnalyse?: (registrationNumber: string) => void;
};

export function HeroSection({ onAnalyse }: HeroSectionProps) {
  const [plate, setPlate] = useState("");
  const plateInput = useRef<HTMLInputElement>(null);

  /**
   * "Analysera" skickar med skylten till formuläret och hoppar dit, precis som
   * länken "Prova med din bil" gör.
   */
  function goToForm() {
    onAnalyse?.(plate.trim());
    document.getElementById("fordonsokning")?.scrollIntoView();
  }

  return (
    <section className="bq-hero">
      <div className="bq-wrap">
        <nav className="bq-nav" aria-label="Huvudmeny">
          <a className="bq-brand" href="#top" aria-label="Bilqlar, startsida">
            <img className="brand-logo" src={bilqlarLogo} alt="Bilqlar" />
          </a>
          <div className="bq-links">
            <a className="bq-on" href="#sa-fungerar-det">Så fungerar det</a>
            <a href="#exempelrapport">Rapporten</a>
            <a href="#fragor">Vanliga frågor</a>
          </div>
          <div className="bq-navr">
            <a className="bq-login" href="/auth">Logga in</a>
            <a className="bq-cta" href="#fordonsokning">Kom igång <span>↗</span></a>
          </div>
        </nav>

        <div className="bq-hero-grid">
          <div>
            <div className="bq-eyebrow"><span />ETT TYDLIGARE BILKÖP</div>
            <h1>Vet vad du köper<i className="bq-dot" /><br /><span className="bq-l2">Innan du köper det<i className="bq-dot" /></span></h1>
            <p className="bq-sub">Få koll på kända problem, viktiga kontrollpunkter och rätt frågor att ställa – anpassat efter bilen du funderar på.</p>
            <div className="bq-search">
              <label className="bq-plate">
                <span className="bq-eu">S</span>
                <input
                  ref={plateInput}
                  className="bq-num"
                  value={plate}
                  onChange={(event) => setPlate(event.target.value.toUpperCase())}
                  placeholder="ABC 123"
                  aria-label="Registreringsnummer"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                <span className="bq-cur" aria-hidden="true" />
              </label>
              <button type="button" className="bq-go" onClick={goToForm}>Analysera <b>→</b></button>
            </div>
            <div className="bq-hint"><span>Ange regnummer eller bilmodell</span><span>Mer information inför beslutet</span></div>
          </div>

          <div className="bq-panelwrap">
            <div className="bq-doc">
              <div className="head">
                <div>
                  <h3>Rapport för din bil</h3>
                  <div className="meta"><span className="pl"><span>JKL 482</span></span>Volvo · V70 2.4 · 2008</div>
                </div>
                <span className="ex">Förhandsvisning</span>
              </div>
              <div className="sum"><b>3 saker att ha koll på</b> <span className="bl" aria-hidden="true">innan du bestämmer dig, sammanställt för just den här bilmodellen.</span></div>
              <div className="item h">
                <div className="t">Motor</div>
                <div className="st">Kontrollera</div>
                <div className="d bl" aria-hidden="true">Kända svagheter för motorvarianten som brukar visa sig efter några år och vad man bör lyssna efter.</div>
                <div className="q"><span>Fråga säljaren:</span> <i className="bl" aria-hidden="true">Finns det kvitton på servicen och vad har gjorts senast?</i></div>
              </div>
              <div className="item m">
                <div className="t">Växellåda</div>
                <div className="st">Fråga om</div>
                <div className="d bl" aria-hidden="true">Vad som brukar märkas vid växling på låga varv och vad du bör testa under provkörningen.</div>
              </div>
              <div className="item l">
                <div className="t">Drivlina</div>
                <div className="st">Låg</div>
                <div className="d bl" aria-hidden="true">Kontrollpunkter för drivlinan och om det finns några återkommande mönster.</div>
              </div>
              <div className="foot">
                <button type="button" className="lk" onClick={() => plateInput.current?.focus()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                  Ange regnummer för att se din rapport
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="bq-strip">
        <div><span className="bq-k">01</span><div><b>Modell</b><small>Generation och kända mönster</small></div></div>
        <div><span className="bq-k">02</span><div><b>Motor</b><small>Svagheter att hålla koll på</small></div></div>
        <div><span className="bq-k">03</span><div><b>Växellåda</b><small>Vad du bör testa och fråga</small></div></div>
        <div><span className="bq-k">04</span><div><b>Drivlina</b><small>Kontrollpunkter vid visning</small></div></div>
      </div>
    </section>
  );
}
