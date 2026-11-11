import { useAction, useQuery } from "convex/react";
import qlarLogo from "@/assets/qlar-logo.png";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ChecklistSection } from "@/components/report/ChecklistSection";
import { Disclaimer } from "@/components/report/Disclaimer";
import { DocumentsToVerify } from "@/components/report/DocumentsToVerify";
import { FeedbackWidget } from "@/components/report/FeedbackWidget";
import { GoodToKnow } from "@/components/report/GoodToKnow";
import { IssuesTable } from "@/components/report/IssuesTable";
import { LoadingSequence } from "@/components/report/LoadingSequence";
import { PrintButton } from "@/components/report/PrintButton";
import { ReportHeader } from "@/components/report/ReportHeader";
import { SellerQuestions } from "@/components/report/SellerQuestions";
import { Reveal } from "@/components/system/motion";
import { api } from "@/convex/_generated/api";
import {
  coverageLabels,
  isSampleState,
  publicReportViewSchema,
  reportSchema,
  researchStatusFromLog,
  sampleReportForState,
  sampleStates,
  type Report as ReportModel,
  type SampleState,
} from "@/lib/report";
import { reportErrorMessage } from "@/lib/reportErrors";
import "@/styles/system.css";
import "@/components/report/report.css";

/**
 * Bilköpsrapporten.
 *
 * - `/rapport/:reportId` visar en riktig, genererad rapport. Medan backend
 *   arbetar drivs laddningsvyn av serverns statuslogg, och först när status är
 *   "done" och innehållet validerar mot reportSchema visas rapporten.
 * - `/rapport` (utan id) visar den fiktiva förhandsvisningen, som finns kvar för
 *   att kunna granska alla tre täckningsnivåer (`?state=good|partial|thin`).
 */

const sectionDelays = [0, 60, 120, 180, 240, 300];

/** Innehållsförteckningen överst i rapporten. */
const tocItems = [
  { id: "sammanfattning", label: "Sammanfattning" },
  { id: "kanda-problem", label: "Kända problem" },
  { id: "checklista", label: "Checklista" },
  { id: "fragor", label: "Frågor" },
  { id: "dokument", label: "Dokument" },
] as const;

/** Det korta rapport-ID som visas för kunden: databasens id, utan prefix. */
function shortReportId(value: string) {
  const compact = value.replace(/[^a-z0-9]/gi, "");
  return compact.slice(-8).toUpperCase();
}

function ReportToc() {
  return (
    <nav className="rpt-toc" aria-label="Innehåll i rapporten">
      <span className="rpt-toc__label ds-mono" aria-hidden="true">INNEHÅLL</span>
      <ul className="rpt-toc__list">
        {tocItems.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`}>{item.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Efter den här tiden utan statusändring visar sidan ett tydligt felläge med
 * möjlighet att köra om, i stället för att snurra vidare i tysthet. Gränsen är
 * satt strax över den hårda tidsgränsen för ett researchanrop.
 */
const stuckAfterMs = 150_000;

function SectionHeader({ number, title }: { number: string; title: string }) {
  const headingId = `rpt-${number}`;
  return (
    <div className="rpt-section__head">
      <h2 className="ds-section-header" id={headingId}>
        <span className="ds-section-header__number" aria-hidden="true">{number}</span>
        <span className="ds-section-header__title">{title}</span>
      </h2>
    </div>
  );
}

function Topbar() {
  return (
    <div className="rpt-topbar">
      <Link className="rpt-topbar__brand" to="/" aria-label="Qlar, startsida">
        <img className="rpt-topbar__logo" src={qlarLogo} alt="Qlar" />
      </Link>
      <div className="rpt-topbar__actions">
        <Link className="rpt-topbar__link" to="/">Ny sökning</Link>
        <PrintButton label="Skriv ut" />
      </div>
    </div>
  );
}

/** Rapportens alla delar, byggda helt från validerad data. */
function ReportBody({
  report,
  sample,
  reportId,
  createdAt,
}: {
  report: ReportModel;
  sample: boolean;
  reportId?: string;
  createdAt?: string | null;
}) {
  return (
    <main className="rpt-main">
      <ReportHeader
        report={report}
        sample={sample}
        createdAt={createdAt}
        shortId={sample ? "EXEMPEL" : reportId ? shortReportId(reportId) : null}
      />

      <ReportToc />

      <Reveal as="section" id="kanda-problem" className="rpt-section" delay={sectionDelays[1]} labelledBy="rpt-01">
        <SectionHeader number="01" title="Kända problem" />
        <p className="rpt-section__intro">Säkerhetsrelaterade områden först, sedan efter allvarlighetsgrad.</p>
        <p className="rpt-section__hint">Tryck på ett problem för att se hur du kontrollerar det vid visning.</p>
        <IssuesTable report={report} />
      </Reveal>

      <Reveal as="section" id="checklista" className="rpt-section" delay={sectionDelays[2]} labelledBy="rpt-02">
        <SectionHeader number="02" title="Checklista vid visning" />
        <ChecklistSection reportId={reportId ?? report.report_id} items={report.checklist} />
      </Reveal>

      <Reveal as="section" id="fragor" className="rpt-section" delay={sectionDelays[3]} labelledBy="rpt-03">
        <SectionHeader number="03" title="Frågor till säljaren" />
        <SellerQuestions questions={report.seller_questions} />
      </Reveal>

      <Reveal as="section" id="dokument" className="rpt-section" delay={sectionDelays[4]} labelledBy="rpt-04">
        <SectionHeader number="04" title="Dokument att verifiera" />
        <DocumentsToVerify documents={report.documents_to_verify} />
      </Reveal>

      <Reveal as="section" id="bra-att-veta" className="rpt-section" delay={sectionDelays[5]} labelledBy="rpt-05">
        <SectionHeader number="05" title="Bra att veta" />
        <GoodToKnow items={report.good_to_know} />
      </Reveal>

      <Disclaimer report={report} />

      <Reveal as="section" className="rpt-section" delay={0}>
        <FeedbackWidget reportId={reportId} />
      </Reveal>
    </main>
  );
}

/** Knappen som kör samma bil en gång till. */
function RetryButton({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <button type="button" className="ds-btn ds-btn--primary" onClick={onRetry} disabled={busy}>
      {busy ? "Startar en ny körning…" : "Försök igen"}
    </button>
  );
}

/** Enkel, lugn statusruta för väntan, fel och saknade rapporter. */
function StatePanel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <main className="rpt-main">
      <section className="ds-panel" aria-live="polite">
        <p className="ds-mono">BILKÖPSRAPPORT</p>
        <h1 className="ds-section-header__title">{title}</h1>
        <p className="ds-note">{children}</p>
        {action && <div className="ds-row">{action}</div>}
      </section>
    </main>
  );
}

/** Den riktiga rapporten, driven av serverns status. */
function GeneratedReport({ reportId }: { reportId: string }) {
  const record = useQuery(api.vehicleReports.getReport, { reportId });
  const generateReport = useAction(api.reportPipeline.generateReport);
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");

  const view = record ? publicReportViewSchema.safeParse(record) : null;
  const parsed = view?.success ? view.data : null;
  const isPending = parsed !== null && parsed.status !== "done" && parsed.status !== "failed";
  /* Tiden räknas från postens senaste statusändring, inte från när sidan
     öppnades: en körning i två steg kan i värsta fall ta upp till 200 sekunder
     innan tidsgränsen slår till, och då är det först när statusen står still
     som något verkligen är fel. */
  const lastChangeAt = parsed && parsed.statusLog.length > 0 ? parsed.statusLog[parsed.statusLog.length - 1].at : null;
  const stuck = isPending && lastChangeAt !== null && now - lastChangeAt >= stuckAfterMs;

  /**
   * Kör samma bil en gång till. Köptidpunkten påverkar inte rapportens innehåll
   * och sparades inte på posten, så den sätts till det neutrala värdet.
   */
  async function retry() {
    if (!parsed || retrying) return;
    setRetrying(true);
    setRetryError("");
    try {
      const result = await generateReport({ input: { ...parsed.vehicle, purchase_timing: "curious" } });
      if (result.reportId === reportId) setRetrying(false);
      else navigate(`/rapport/${result.reportId}`);
    } catch (error) {
      setRetrying(false);
      setRetryError(reportErrorMessage(error));
    }
  }

  useEffect(() => {
    document.title = "Bilköpsrapport";
  }, []);

  /* Klockan i laddningsvyn tickar medan rapporten tas fram. */
  useEffect(() => {
    if (!isPending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isPending]);

  const reportContent = parsed?.report ? reportSchema.safeParse(parsed.report) : null;
  /* Datumet är när körningen blev klar (statusen done), inte när sidan öppnas. */
  const doneAt = parsed ? parsed.statusLog.filter((entry) => entry.status === "done").pop()?.at : undefined;

  return (
    <div className="rpt-page">
      <div className="rpt-wrap">
        <Topbar />

        {record === undefined && (
          <StatePanel title="Hämtar rapporten…">
            <span aria-busy="true">Ett ögonblick, vi tittar efter rapporten.</span>
          </StatePanel>
        )}

        {record === null && (
          <StatePanel
            title="Rapporten hittades inte"
            action={<Link className="ds-btn ds-btn--primary" to="/">Gå till startsidan</Link>}
          >
            Rapportlänken kan vara fel, eller så har rapporten tagits bort. Du kan ta fram en ny rapport från
            startsidan.
          </StatePanel>
        )}

        {/*
          * Servern säger om ett nytt försök är värt något. Felen sitter i
          * körningen och inte i uppgifterna: ett tekniskt fel ska beskrivas som
          * just tekniskt, aldrig som att bilvarianten skulle sakna underlag.
          */}
        {parsed && parsed.status === "failed" && (
          <StatePanel
            title="Rapporten kunde inte sammanställas"
            action={
              parsed.retryable ? (
                <>
                  <RetryButton onRetry={retry} busy={retrying} />
                  <Link className="ds-btn ds-btn--secondary" to="/">Ny sökning</Link>
                </>
              ) : (
                <>
                  <Link className="ds-btn ds-btn--primary" to="/">Ny sökning</Link>
                  <Link className="ds-btn ds-btn--secondary" to="/rapport">Se en exempelrapport</Link>
                </>
              )
            }
          >
            {parsed.retryable
              ? "Ett tekniskt fel inträffade när rapporten skulle tas fram, och ingen ofullständig rapport visas. Det beror inte på uppgifterna du angav. Försök igen om en stund – knappen kör samma bil en gång till."
              : "Ett tekniskt fel inträffade när rapporten skulle tas fram, och ingen ofullständig rapport visas. Det beror inte på uppgifterna du angav. Försök igen om en stund, eller ta fram en rapport för en annan bil."}
            {retryError && (
              <span className="rpt-retry__error" role="alert">{retryError}</span>
            )}
          </StatePanel>
        )}

        {parsed && isPending && !stuck && (
          <main className="rpt-main">
            <div className="rp-loading-vehicle ds-panel">
              <p className="ds-mono">BILEN I RAPPORTEN</p>
              <p>
                {parsed.vehicle.make} {parsed.vehicle.model} {parsed.vehicle.year} · {parsed.vehicle.engine} ·{" "}
                {parsed.vehicle.gearbox} · {parsed.vehicle.drivetrain}
              </p>
            </div>
            <LoadingSequence
              status={researchStatusFromLog(parsed.statusLog, now)}
              note="Stegen kommer från servern och uppdateras medan rapporten tas fram. Den här sidan fylls på så snart underlaget är sammanställt."
            />
          </main>
        )}

        {parsed && isPending && stuck && (
          <StatePanel
            title="Rapporten tar längre tid än väntat"
            action={
              <>
                <RetryButton onRetry={retry} busy={retrying} />
                <Link className="ds-btn ds-btn--secondary" to="/">Ny sökning</Link>
              </>
            }
          >
            Körningen har pågått i över 150 sekunder utan att statusen ändrats. Sidan uppdateras fortfarande, och om
            körningen har stannat stängs posten automatiskt som misslyckad inom några minuter. Du kan också köra samma
            bil en gång till direkt.
            {retryError && (
              <span className="rpt-retry__error" role="alert">{retryError}</span>
            )}
          </StatePanel>
        )}

        {parsed && parsed.status === "done" && reportContent?.success && (
          <ReportBody
            report={reportContent.data}
            sample={false}
            reportId={parsed.reportId}
            createdAt={doneAt ? new Date(doneAt).toISOString() : null}
          />
        )}

        {parsed && parsed.status === "done" && reportContent && !reportContent.success && (
          <StatePanel
            title="Rapporten kunde inte visas"
            action={<Link className="ds-btn ds-btn--primary" to="/">Gå till startsidan</Link>}
          >
            Rapportens innehåll validerade inte och visas därför inte. Ta fram en ny rapport från startsidan.
          </StatePanel>
        )}
      </div>
    </div>
  );
}

/** Den fiktiva förhandsvisningen på /rapport. */
function SampleReport() {
  const [params] = useSearchParams();
  const requested = params.get("state");
  const state: SampleState = isSampleState(requested) ? requested : "partial";
  const report = sampleReportForState(state);

  useEffect(() => {
    const previous = document.title;
    document.title = "Bilköpsrapport – exempel";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="rpt-page">
      <div className="rpt-wrap">
        <Topbar />

        <div className="rpt-statebar" aria-label="Förhandsvisa underlagets täckning">
          <span className="ds-mono">FÖRHANDSVISNING AV UNDERLAG</span>
          {sampleStates.map((option) => (
            <Link key={option} to={`/rapport?state=${option}`} aria-current={option === state}>
              {coverageLabels[option]}
            </Link>
          ))}
        </div>

        <ReportBody report={report} sample />
      </div>
    </div>
  );
}

export default function Report() {
  const { reportId } = useParams();

  return reportId ? <GeneratedReport reportId={reportId} /> : <SampleReport />;
}
