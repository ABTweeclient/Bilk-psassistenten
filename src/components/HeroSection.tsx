import { useState } from "react";
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
      <div className="bq-gridbg" aria-hidden="true" />
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
            <div className="bq-panel">
              <div className="bq-ph">
                <div className="bq-car"><span className="bq-mini">ABC 123</span><div><b>Din bil</b><small>Modell · Motor · Växellåda · Drivlina</small></div></div>
                <span className="bq-ex">EXEMPELRAPPORT</span>
              </div>
              <div className="bq-pb">
                <div className="bq-pbh">
                  <div><div className="bq-lbl">OMRÅDEN ATT FÖRSTÅ</div><h3>Kända problem</h3></div>
                  <div className="bq-legend">
                    <span><i style={{ background: "#E8820C" }} />Hög</span>
                    <span><i style={{ background: "#F2A36E" }} />Medel</span>
                    <span><i style={{ background: "#E4DCD0" }} />Låg</span>
                  </div>
                </div>
                <div className="bq-rows">
                  <div className="bq-row"><span className="bq-n">01</span><span className="bq-t">Motor<small>Exempel på känd svaghet</small></span><div className="bq-seg"><i className="bq-a" /><i className="bq-a" /><i className="bq-a" /><i className="bq-a" /><i /></div><span className="bq-tag bq-h">Kontrollera</span></div>
                  <div className="bq-row"><span className="bq-n">02</span><span className="bq-t">Växellåda<small>Exempel på känd svaghet</small></span><div className="bq-seg"><i className="bq-b" /><i className="bq-b" /><i className="bq-b" /><i /><i /></div><span className="bq-tag bq-m">Fråga säljaren</span></div>
                  <div className="bq-row"><span className="bq-n">03</span><span className="bq-t">Drivlina<small>Inga tydliga mönster</small></span><div className="bq-seg"><i className="bq-b" /><i /><i /><i /><i /></div><span className="bq-tag bq-l">Låg risk</span></div>
                </div>
              </div>
              <div className="bq-pf">
                <div className="bq-lbl">ANALYSENS DELAR<b>4 av 4 klara</b></div>
                <div className="bq-track"><div>Modell<i>✓</i></div><div>Motor<i>✓</i></div><div>Växellåda<i>✓</i></div><div>Drivlina<i>✓</i></div></div>
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
