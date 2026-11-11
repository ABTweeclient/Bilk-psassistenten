import { useAction } from "convex/react";
import qlarLogo from "@/assets/qlar-logo.png";
import { useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronRight, FileCheck2, Gauge, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router";
import { VehicleForm } from "@/components/VehicleForm";
import { api } from "@/convex/_generated/api";
import { reportErrorMessage } from "@/lib/reportErrors";
import { type VehicleSubmission } from "@/lib/vehicleForm";
import "./Landing.css";

const reportAreas = [
  { name: "MOTOR", count: "3 kontrollområden" },
  { name: "VÄXELLÅDA", count: "2 kontrollområden" },
  { name: "DRIVLINA", count: "2 kontrollområden" },
  { name: "ELEKTRONIK", count: "1 kontrollområde" },
  { name: "ÖVRIGT", count: "4 kontrollområden" },
];

function SampleGraph() {
  return (
    <svg className="sample-graph" viewBox="0 0 320 76" role="img" aria-label="Illustrativ grafisk rapportvisualisering">
      <path className="graph-grid" d="M1 18.5h318M1 38.5h318M1 58.5h318" />
      <path className="graph-area" d="M2 54 C30 54 35 27 65 31 S102 61 128 48 S169 20 194 30 S228 57 252 42 S287 24 318 17 V76 H2Z" />
      <path className="graph-line" d="M2 54 C30 54 35 27 65 31 S102 61 128 48 S169 20 194 30 S228 57 252 42 S287 24 318 17" />
      <circle cx="65" cy="31" r="4" /><circle cx="194" cy="30" r="4" /><circle cx="252" cy="42" r="4" />
    </svg>
  );
}

function ReportPreview() {
  const [activeArea, setActiveArea] = useState("MOTOR");
  return (
    <section className="report-showcase" id="exempelrapport" aria-labelledby="report-title">
      <div className="showcase-copy">
        <p className="eyebrow"><span className="eyebrow-dot" /> SÅ SER RAPPORTEN UT</p>
        <h2 id="report-title">Allt viktigt.<br /><span>Överblickbart.</span></h2>
        <p>En tydlig struktur med områden att undersöka, frågor att ställa och sådant att verifiera. Bilden här är en illustrativ förhandsvisning.</p>
        <a className="text-link" href="#fordonsokning">Prova med din bil <ArrowDown size={16} aria-hidden="true" /></a>
      </div>
      <div className="report-stage">
        <div className="report-back-card report-back-card--left" aria-hidden="true"><span className="report-mini-label">ILLUSTRATION</span><div className="mini-bars"><i /><i /><i /><i /></div><span className="mini-caption">Illustrativa kontrollområden</span></div>
        <div className="report-back-card report-back-card--right" aria-hidden="true"><span className="report-mini-label">INFÖR VISNING</span><span className="mini-check"><Check size={13} /> Kontrollpunkter</span><span className="mini-check"><Check size={13} /> Säljarfrågor</span><span className="mini-check"><Check size={13} /> Dokumentlista</span></div>
        <div className="report-main-card">
          <div className="report-card-top"><span className="report-card-mark"><Gauge size={17} aria-hidden="true" /></span><span className="mono">RAPPORTSTRUKTUR · DEMO</span><span className="demo-chip">ILLUSTRATION</span></div>
          <h3>Så är rapporten uppbyggd</h3>
          <p className="report-spec">Sammanfattning <span>·</span> kända problem <span>·</span> checklista <span>·</span> källor</p>
          <SampleGraph />
          <div className="area-tabs" aria-label="Exempel på rapportområden">
            {reportAreas.map((area) => <button key={area.name} type="button" aria-label={`${area.name}, ${area.count}`} aria-pressed={activeArea === area.name} onClick={() => setActiveArea(area.name)}><span>{area.name}</span><span className="area-count" aria-hidden="true">{area.count.split(" ")[0].padStart(2, "0")}</span><ChevronRight size={14} aria-hidden="true" /></button>)}
          </div>
          <p className="area-selection" aria-live="polite"><span className="area-indicator" /> {activeArea} <span>· illustrativ struktur</span></p>
        </div>
        <span className="stage-note"><ShieldCheck size={15} aria-hidden="true" /> Illustration av rapportens delar – inte en fordonsanalys</span>
      </div>
    </section>
  );
}

export default function Landing() {
  const generateReport = useAction(api.reportPipeline.generateReport);
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  /**
   * Skickar uppgifterna till backend, som validerar dem, rate limitar och startar
   * research. Så snart posten finns går vi vidare till /rapport/:id, där
   * laddningsvyn drivs av serverns verkliga status.
   */
  async function handleSubmit(submission: VehicleSubmission) {
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const result = await generateReport({ input: submission });
      navigate(`/rapport/${result.reportId}`);
    } catch (error) {
      setIsSubmitting(false);
      setErrorMessage(reportErrorMessage(error));
    }
  }

  return (
    <main className="bilinsyn-root" id="top">
      <div className="page-wrap">
        <header className="landing-nav">
          <a className="landing-brand" href="#top" aria-label="Qlar, startsida"><img className="brand-logo" src={qlarLogo} alt="Qlar" /></a>
          <nav aria-label="Huvudmeny"><a href="#sa-fungerar-det">Så fungerar det</a><a href="#exempelrapport">Rapporten</a><a href="#priser">Priser</a></nav>
          <a className="nav-action" href="#fordonsokning">Kom igång <ArrowUpRight size={16} aria-hidden="true" /></a>
        </header>

        <section className="hero-bento" aria-labelledby="hero-heading">
          <div className="hero-panel bento-reveal">
            <p className="eyebrow"><span className="eyebrow-dot" /> ETT TYDLIGARE BILKÖP</p>
            <h1 id="hero-heading">Vet vad du köper.<br /><span>Innan du köper det.</span></h1>
            <p className="hero-lede">Få koll på kända problem, viktiga kontrollpunkter och rätt frågor att ställa – anpassat efter bilen du funderar på.</p>
            <a className="text-link" href="#fordonsokning">Prova med din bil <ArrowDown size={16} aria-hidden="true" /></a>
            <div className="hero-footnote"><span className="footnote-rule" /> Mer information inför beslutet. Färre överraskningar efter köpet.</div>
          </div>

          <aside className="known-card bento-reveal bento-hover" aria-label="Exempel på områden i en rapport">
            <div className="card-heading"><span className="mono">OMRÅDEN ATT FÖRSTÅ</span><span className="round-arrow"><ArrowUpRight size={15} aria-hidden="true" /></span></div>
            <h2>Kända problem</h2>
            <p className="muted-copy">Rapporten hjälper dig se var det kan vara klokt att ställa fler frågor.</p>
            <div className="known-rows"><div><span className="area-icon">01</span><span>Motor</span><span className="row-line" /></div><div><span className="area-icon">02</span><span>Växellåda</span><span className="row-line" /></div><div><span className="area-icon">03</span><span>Drivlina</span><span className="row-line" /></div></div>
            <span className="illustration-note mono">RAPPORTENS STRUKTUR · EXEMPEL</span>
          </aside>

          <aside className="analysis-card bento-reveal bento-hover" aria-label="Exempel på analysstruktur">
            <div className="card-heading"><span className="mono">ANALYSENS DELAR</span><span className="analysis-pulse" /></div>
            <div className="analysis-rows"><div><span>Modell</span><span className="analysis-check"><Check size={13} /></span></div><div><span>Motor</span><span className="analysis-check"><Check size={13} /></span></div><div><span>Växellåda</span><span className="analysis-check"><Check size={13} /></span></div><div><span>Drivlina</span><span className="analysis-check"><Check size={13} /></span></div></div>
            <p className="illustration-note mono">SÅ KAN UNDERLAGET STRUKTURERAS</p>
          </aside>
        </section>

        <section className="how-section" id="sa-fungerar-det" aria-labelledby="how-title">
          <div className="how-heading"><p className="eyebrow"><span className="eyebrow-dot" /> EN ENKLARE VÄG TILL BÄTTRE FRÅGOR</p><h2 id="how-title">Från fundering<br />till <span>förberedelse.</span></h2><p>Tre steg för att komma till visningen med bättre koll.</p></div>
          <div className="steps-list"><article className="step-row"><span className="step-number mono">01</span><div><p className="mono">BESKRIV BILEN</p><h3>Börja med det du vet.</h3></div><p>Ange modell, årsmodell, motor, växellåda och annan information du känner till.</p><ArrowRight className="step-arrow" size={18} aria-hidden="true" /></article><article className="step-row"><span className="step-number mono">02</span><div><p className="mono">VI SÖKER OCH SAMMANSTÄLLER</p><h3>Få relevanta områden.</h3></div><p>Uppgifterna används för att identifiera varianten och sammanställa publicerade källor om den.</p><ArrowRight className="step-arrow" size={18} aria-hidden="true" /></article><article className="step-row"><span className="step-number mono">03</span><div><p className="mono">FÅ BÄTTRE KOLL</p><h3>Ta med stödet till visningen.</h3></div><p>Få en tydlig rapport att använda inför visning, provkörning och samtalet med säljaren.</p><ArrowRight className="step-arrow" size={18} aria-hidden="true" /></article></div>
        </section>

        <ReportPreview />

        {/* Formuläret är sidans sista steg: först hur det fungerar, sedan hur
            rapporten ser ut, och först därefter fyller man i bilen. */}
        <section className="search-card search-card--standalone bento-reveal" id="fordonsokning" aria-label="Uppgifter om bilen">
          <VehicleForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
          {errorMessage && (
            <p className="vf-form-error" role="alert">{errorMessage}</p>
          )}
        </section>

        <section className="trust-section" id="om-rapporten" aria-labelledby="trust-title">
          <div className="trust-heading">
            <p className="eyebrow"><span className="eyebrow-dot" /> TYDLIGT UNDERLAG, ÄRLIGA GRÄNSER</p>
            <h2 id="trust-title">Vad rapporten är<br /><span>och inte är.</span></h2>
            <p>Se vad som bygger på publicerade källor och vad du själv behöver kontrollera.</p>
          </div>
          <div className="trust-columns">
            <article className="trust-card trust-card--is">
              <span className="trust-kicker mono">DET HÄR FÅR DU</span>
              <h3>Ett stöd inför ditt beslut.</h3>
              <ul><li>En sammanställning av publicerade källor med synliga hänvisningar.</li><li>Förslag på frågor, kontrollpunkter och dokument att be om.</li><li>En tydlig förklaring av hur mycket underlaget täcker.</li></ul>
            </article>
            <article className="trust-card trust-card--is-not">
              <span className="trust-kicker mono">DET HÄR FÅR DU INTE</span>
              <h3>Ingen garanti om ett enskilt exemplar.</h3>
              <ul><li>Ingen kontroll av bilen du tittar på och ingen garanti om dess skick.</li><li>Ingen säker prognos om framtida fel eller reparationskostnader.</li><li>Ingen teknisk besiktning – rapporten bygger på publicerade källor.</li></ul>
            </article>
          </div>
        </section>

        <section className="faq-section" id="fragor" aria-labelledby="faq-title">
          <div className="faq-heading"><p className="eyebrow"><span className="eyebrow-dot" /> VANLIGA FRÅGOR</p><span className="sr-only">Vanliga frågor</span><h2 id="faq-title">Bra att veta<br /><span>innan du börjar.</span></h2></div>
          <div className="faq-list">
            <details><summary>Är rapporten baserad på bilen jag anger?</summary><p>Ja, på varianten. Uppgifterna du anger – märke, modell, årsmodell, motor, växellåda och drivning – styr vilken variant som undersöks. Rapporten beskriver modellvarianten och säger aldrig något om skicket på det enskilda exemplaret du tittar på.</p></details>
            <details><summary>Varifrån kommer uppgifterna?</summary><p>Rapporten sammanställs från publicerade källor som hittas vid sökningen, och varje punkt bygger på minst en källa. Källhänvisningarna är interna och visas inte i rapporten.</p></details>
            <details><summary>Hur lång tid tar det?</summary><p>Det tar oftast under en minut. Du följer arbetet i realtid och rapporten öppnas så snart underlaget är sammanställt.</p></details>
            <details><summary>Vad betyder underlagets täckning?</summary><p>Etiketten visar hur väl de publicerade källorna beskriver just den angivna varianten – bra, delvis eller tunt. Vid tunt underlag blir punkterna färre och mer försiktigt formulerade.</p></details>
            <details><summary>Ersätter rapporten en egen kontroll?</summary><p>Nej. Använd den som vägledning inför frågor och kontroller, och verifiera alltid bilens skick och dokumentation själv.</p></details>
          </div>
        </section>

        <section className="price-note" id="priser"><div className="price-mark"><FileCheck2 size={21} aria-hidden="true" /></div><div><p className="eyebrow">TRANSPARENT FRÅN START</p><h2>Kostnadsfritt i den här versionen.</h2><p>Du kan ta fram rapporter utan kostnad medan tjänsten byggs ut. Innan något börjar kosta säger vi till i god tid.</p></div><span className="price-status mono">EARLY ACCESS</span></section>

        <footer className="landing-footer">
          <a className="landing-brand" href="#top" aria-label="Bilköpsassistenten, startsida"><span className="brand-symbol" aria-hidden="true"><span /><span /></span><span>bilköps<span>assistenten</span></span></a>
          <p>Mer information inför beslutet. Färre överraskningar efter köpet.</p>
          <div className="footer-contact"><strong>Kontakt</strong><a href="mailto:kontakt@example.com">kontakt@example.com</a><span>Kontaktadress för tjänsten</span></div>
          <span className="footer-disclaimer"><ShieldCheck size={15} aria-hidden="true" /> Rapporten är vägledning från publicerade källor – inte en garanti eller kontroll av bilen.</span>
        </footer>
      </div>
    </main>
  );
}
