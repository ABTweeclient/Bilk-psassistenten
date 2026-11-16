import { useAction, useMutation, useQuery } from "convex/react";
import qlarLogo from "@/assets/qlar-logo.png";
import { useState } from "react";
import { ArrowDown, ArrowRight, Check, ChevronRight, Gauge, ShieldCheck } from "lucide-react";
import { useSearchParams } from "react-router";
import { HeroSection } from "@/components/HeroSection";
import { VehicleForm } from "@/components/VehicleForm";
import { api } from "@/convex/_generated/api";
import { readOrderDraft, saveOrderDraft } from "@/lib/orderDraft";
import { formatPriceOre } from "@/lib/price";
import { type VehicleFormValues, type VehicleSubmission } from "@/lib/vehicleForm";
import type { VehicleSubmitMeta } from "@/components/VehicleForm";
import { TestModeBanner } from "@/components/TestModeBanner";
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
  const suggestVehicle = useAction(api.vehicleLookup.suggestByRegistration);
  const createOrder = useMutation(api.orders.createOrder);
  const createCheckout = useAction(api.orders.createCheckout);
  const config = useQuery(api.orders.publicConfig);
  const [searchParams] = useSearchParams();
  const cancelled = searchParams.get("avbruten") === "1";
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  /** Skylten från hero-fältet, så att formuläret kan fylla i den. */
  const [heroPlate, setHeroPlate] = useState("");
  /** Uppgifterna som fanns när betalningen avbröts. */
  const [draft] = useState<VehicleFormValues | null>(() => (cancelled ? readOrderDraft() : null));

  const price = config && config.priceOre > 0 ? formatPriceOre(config.priceOre) : "";
  const submitLabel = price ? `Köp rapport – ${price} kr` : "Köp rapport";

  /**
   * Skapar en order och skickar kunden till Stripe Checkout. Ingen rapport
   * skapas här – servern startar den först när betalningen är bekräftad, och
   * kunden följer den på /order/<token>.
   */
  async function handleSubmit(submission: VehicleSubmission, meta: VehicleSubmitMeta) {
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      saveOrderDraft(submission);
      const { orderId } = await createOrder({
        carInput: submission,
        consentAcceptedAt: meta.consentAcceptedAt ?? undefined,
      });
      const { url } = await createCheckout({ orderId });
      window.location.assign(url);
    } catch {
      setIsSubmitting(false);
      setErrorMessage("Kunde inte starta betalningen just nu. Försök igen om en stund.");
    }
  }

  /**
   * Hämtar bilens uppgifter från vägtrafikregistret. Uppslaget är en genväg:
   * svarar det inte fyller användaren i formuläret själv.
   */
  async function handleLookup(registrationNumber: string) {
    try {
      return await suggestVehicle({ registrationNumber });
    } catch {
      return null;
    }
  }

  return (
    <main className="bilinsyn-root" id="top">
      <HeroSection onAnalyse={setHeroPlate} />
      <div className="page-wrap">
        <section className="how-section" id="sa-fungerar-det" aria-labelledby="how-title">
          <div className="how-heading"><p className="eyebrow"><span className="eyebrow-dot" /> EN ENKLARE VÄG TILL BÄTTRE FRÅGOR</p><h2 id="how-title">Från fundering<br />till <span>förberedelse.</span></h2><p>Tre steg för att komma till visningen med bättre koll.</p></div>
          <div className="steps-list"><article className="step-row"><span className="step-number mono">01</span><div><p className="mono">BESKRIV BILEN</p><h3>Börja med det du vet.</h3></div><p>Ange modell, årsmodell, motor, växellåda och annan information du känner till.</p><ArrowRight className="step-arrow" size={18} aria-hidden="true" /></article><article className="step-row"><span className="step-number mono">02</span><div><p className="mono">VI SÖKER OCH SAMMANSTÄLLER</p><h3>Få relevanta områden.</h3></div><p>Uppgifterna används för att identifiera varianten och sammanställa publicerade källor om den.</p><ArrowRight className="step-arrow" size={18} aria-hidden="true" /></article><article className="step-row"><span className="step-number mono">03</span><div><p className="mono">FÅ BÄTTRE KOLL</p><h3>Ta med stödet till visningen.</h3></div><p>Få en tydlig rapport att använda inför visning, provkörning och samtalet med säljaren.</p><ArrowRight className="step-arrow" size={18} aria-hidden="true" /></article></div>
        </section>

        <ReportPreview />

        {/* Formuläret är sidans sista steg: först hur det fungerar, sedan hur
            rapporten ser ut, och först därefter fyller man i bilen. */}
        <section className="search-card search-card--standalone bento-reveal" id="fordonsokning" aria-label="Uppgifter om bilen">
          <TestModeBanner />
          {cancelled && (
            <p className="vf-cancel-note" role="status">
              Betalningen avbröts och inget drogs. Uppgifterna finns kvar nedan.
            </p>
          )}
          <VehicleForm
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
            onLookup={handleLookup}
            registrationNumber={heroPlate}
            submitLabel={submitLabel}
            requireConsent
            initialValues={draft ?? undefined}
          />
          {errorMessage && (
            <p className="vf-form-error" role="alert">{errorMessage}</p>
          )}
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

        <footer className="landing-footer">
          <a className="landing-brand" href="#top" aria-label="Qlar, startsida"><img className="brand-logo" src={qlarLogo} alt="Qlar" /></a>
          <p>Mer information inför beslutet. Färre överraskningar efter köpet.</p>
          <div className="footer-contact"><strong>Kontakt</strong><a href="mailto:qlar.uf@gmail.com">qlar.uf@gmail.com</a><span>Kontaktadress för tjänsten</span></div>
          <span className="footer-disclaimer"><ShieldCheck size={15} aria-hidden="true" /> Rapporten är vägledning från publicerade källor – inte en garanti eller kontroll av bilen.</span>
        </footer>
      </div>
    </main>
  );
}
