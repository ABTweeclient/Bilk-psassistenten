import { useEffect, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Lock, ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { SourceList } from "@/components/report/evidence";
import { coverageLabels, generationStepLabels, type GenerationStepMeta } from "@/lib/report";
import { parseFailureMeta } from "@/lib/reportAdminOverview";
import {
  failureKindExplanations,
  failureKindLabels,
  rawResponseLimit,
  requestExcerptLimit,
  type FailureAttempt,
  type FailureMeta,
} from "@/lib/reportFailure";
import { estimateCostUsd } from "@/lib/reportPricing";
import type { ProviderModelCheck } from "@/convex/reportProviderCheck";
import "@/styles/system.css";
import "@/components/report/evidence.css";
import "./admin.css";

/**
 * Intern granskningssida för genererade rapporter.
 *
 * Sidan visar varje rapport med variant, täckning, antal punkter och
 * uppskattad kostnad, och låter en administratör sätta review_status till
 * "reviewed" eller "removed". Kostnaderna är uppskattningar som backend räknar
 * fram från sina pris- och valutakonstanter.
 */

type ReviewStatus = "unreviewed" | "reviewed" | "removed";

const reviewFilterOptions: Array<{ value: "all" | ReviewStatus; label: string }> = [
  { value: "all", label: "Alla" },
  { value: "unreviewed", label: "Ogranskad" },
  { value: "reviewed", label: "Granskad" },
  { value: "removed", label: "Borttagen" },
];

const reviewStatusLabels: Record<string, string> = {
  unreviewed: "Ogranskad",
  reviewed: "Granskad",
  removed: "Borttagen",
};

const reportStatusLabels: Record<string, string> = {
  queued: "I kö",
  resolving_variant: "Identifierar variant",
  researching: "Söker källor",
  analyzing: "Analyserar",
  writing: "Sammanställer",
  done: "Klar",
  failed: "Misslyckad",
};

const flagKindLabels: Record<string, string> = {
  wrong: "Felaktigt innehåll",
  missing: "Saknar något",
  unsafe: "Osäker uppgift",
  other: "Övrigt",
};

/**
 * Vilka research-leverantörer som är konfigurerade server-side, och vad de
 * kostar. Endast leverantörsnamn och priser visas – aldrig något nyckelvärde
 * och aldrig något miljövariabelnamn. Bara en administratör kan läsa den här
 * panelen, och backend nekar alla andra.
 */
function ProviderPanel() {
  const providers = useQuery(api.reportAdmin.providerStatus);
  if (!providers || providers.length === 0) return null;

  return (
    <section className="adm-section" aria-labelledby="adm-providers-title">
      <h2 id="adm-providers-title" className="adm-section-title">Research-leverantörer</h2>
      <p className="adm-note">
        Nycklarna sätts server-side som Convex miljövariabler och följer aldrig med till klienten. Panelen visas bara för
        administratören.
      </p>
      <div className="adm-detail">
        {providers.map((provider) => (
          <div className="adm-panel" key={provider.id}>
            <p className="adm-eyebrow ds-mono">{provider.configured ? "KONFIGURERAD" : "SAKNAS"}</p>
            <h3 className="adm-detail__title">{provider.label}</h3>
            <dl className="adm-spec">
              <div><dt className="ds-mono">MODELL</dt><dd>{provider.model}</dd></div>
              <div><dt className="ds-mono">IN/UT PER 1M TOKEN</dt><dd>{moneyDetailed.format(provider.inputPerMillionUsd)} / {moneyDetailed.format(provider.outputPerMillionUsd)} USD</dd></div>
              <div><dt className="ds-mono">PER SÖKNING</dt><dd>{moneyDetailed.format(provider.searchPerCallUsd)} USD</dd></div>
            </dl>
            <p className="adm-note">{provider.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Registersaldot för registreringsnummeruppslaget. Visar hur många betalda
 * uppslag som är kvar, och varnar när det börjar ta slut – ett uppslag drar en
 * kredit. Endast administratören kan läsa saldot.
 */
function LookupPanel() {
  const creditStatus = useAction(api.vehicleLookup.creditStatus);
  type LookupState =
    | { kind: "busy" }
    | { kind: "error"; message: string }
    | { kind: "ready"; configured: false }
    | { kind: "ready"; configured: true; credits: number | null; threshold: number };
  const [state, setState] = useState<LookupState>({ kind: "busy" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await creditStatus({});
        if (cancelled) return;
        setState(
          result.configured
            ? { kind: "ready", configured: true, credits: result.credits, threshold: result.threshold }
            : { kind: "ready", configured: false },
        );
      } catch (error) {
        if (!cancelled) {
          setState({ kind: "error", message: error instanceof Error ? error.message : "Kunde inte läsa saldot." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [creditStatus]);

  return (
    <section className="adm-section" aria-labelledby="adm-lookup-title">
      <h2 id="adm-lookup-title" className="adm-section-title">Registreringsnummeruppslag</h2>
      <p className="adm-note">
        Uppslag mot Vägtrafikregistret via RegCheck. Ett lyckat uppslag drar en kredit (2 kr), och varje skylt cachas –
        samma bil kostar alltså bara en gång. Saknas kontot eller tar krediterna slut fungerar formuläret ändå, med
        manuell ifyllning.
      </p>
      {state.kind === "busy" && <p className="adm-note">Läser kreditsaldo…</p>}
      {state.kind === "error" && <p className="adm-note">Kunde inte läsa saldot: {state.message}</p>}
      {state.kind === "ready" && !state.configured && (
        <p className="adm-note">Uppslaget är inte aktiverat i backend. Formuläret fungerar med manuell ifyllning.</p>
      )}
      {state.kind === "ready" && state.configured && (
        <div className="adm-detail">
          <div className="adm-panel">
            <p className="adm-eyebrow ds-mono">
              {state.credits === null
                ? "SALDO OKÄNT"
                : state.credits <= 0
                  ? "SLUT"
                  : state.credits <= (state.threshold ?? 10)
                    ? "LÅGT SALDO"
                    : "SALDO"}
            </p>
            <h3 className="adm-detail__title">
              {state.credits === null ? "Kunde inte läsas" : `${state.credits} uppslag kvar`}
            </h3>
            <p className="adm-note">
              Varningen visas när saldot är {state.threshold} uppslag eller lägre. Taket per dygn hindrar att krediterna
              töms av misstag.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Tar bort testkörningar och misslyckade försök permanent. Knappen är bara ett
 * bekvämt sätt att köra samma admin-mutation som kan anropas via API:t.
 */
function PurgePanel() {
  const purgeTestData = useMutation(api.reportAdmin.purgeTestData);
  const [state, setState] = useState<{ kind: "idle" | "busy" | "done" | "error"; message?: string }>({ kind: "idle" });

  return (
    <section className="adm-section" aria-labelledby="adm-purge-title">
      <h2 id="adm-purge-title" className="adm-section-title">Testdata</h2>
      <p className="adm-note">
        Tar bort alla rapporter som skapats av den lokala testleverantören (fixture) och alla misslyckade försök,
        permanent, inklusive deras flaggor. Vanliga rapporter rörs inte.
      </p>
      <div className="adm-actions">
        <button
          type="button"
          className="ds-btn ds-btn--ghost adm-danger"
          disabled={state.kind === "busy"}
          onClick={async () => {
            setState({ kind: "busy" });
            try {
              const result = await purgeTestData({});
              setState({
                kind: "done",
                message: `Klart. ${result.deletedReports} rapport(er) och ${result.deletedFlags} flagga(or) togs bort (av ${result.scanned} genomsökta).`,
              });
            } catch (error) {
              setState({ kind: "error", message: error instanceof Error ? error.message : "Kunde inte ta bort testdata." });
            }
          }}
        >
          {state.kind === "busy" ? "Tar bort testdata…" : "Ta bort testdata"}
        </button>
      </div>
      <p className="adm-status-note" role="status" aria-live="polite">{state.kind === "done" ? state.message : ""}</p>
      {state.kind === "error" && <p className="adm-error" role="alert">{state.message}</p>}
    </section>
  );
}

const money = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 2 });
const moneyDetailed = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 3 });
const dateTime = new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" });

function formatSek(value: number | null | undefined, formatter = money) {
  return typeof value === "number" && Number.isFinite(value) ? `${formatter.format(value)} kr` : "–";
}

function formatWhen(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? dateTime.format(new Date(value)) : "–";
}

function coverageText(coverage: string | null | undefined) {
  if (!coverage) return "–";
  return coverageLabels[coverage as keyof typeof coverageLabels] ?? coverage;
}

function formatDuration(ms: number | null | undefined) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${Math.round(ms / 100) / 10} s`;
}

/** Rubrik för rutan: modellens textsvar eller leverantörens råa svarsstruktur. */
function rawResponseLabel(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[")
    ? "RÅ SVARSSTRUKTUR FRÅN LEVERANTÖREN"
    : "MODELLENS RÅSVAR";
}

/*
 * Felspåret för en misslyckad körning.
 *
 * Panelen svarar på frågan "varför blev det inget?" i tur och ordning: vilken
 * sorts fel, vilken HTTP-status och feltext leverantören gav, vilken
 * kvalitetskontroll som fällde svaret, hur många försök som gjordes och vad
 * modellen faktiskt svarade. Nycklar förekommer aldrig – feltexterna städas
 * server-side innan de sparas.
 */
function AttemptCard({ attempt }: { attempt: FailureAttempt }) {
  return (
    <div className="adm-attempt">
      <p className="adm-eyebrow ds-mono">
        FÖRSÖK {attempt.attempt} · {failureKindLabels[attempt.kind]} · {attempt.code}
      </p>
      <dl className="adm-meta">
        <MetaRow label="STEG">
          {attempt.stage ? generationStepLabels[attempt.stage] : "– (post från före tvåstegsflödet)"}
        </MetaRow>
        <MetaRow label="HTTP-STATUS">
          {attempt.http_status === null ? "Ingen HTTP-status (felet kom inte från ett svar)" : attempt.http_status}
        </MetaRow>
        <MetaRow label="FINISH REASON">{attempt.finish_reason || "saknas"}</MetaRow>
        <MetaRow label="FELTEXT">{attempt.message || "–"}</MetaRow>
        <MetaRow label="TID">{formatDuration(attempt.duration_ms)}</MetaRow>
        <MetaRow label="SÖKNINGAR">{attempt.searches}</MetaRow>
        <MetaRow label="TOKENS IN / UT">
          {attempt.input_tokens ?? "saknas"} / {attempt.output_tokens ?? "saknas"}
        </MetaRow>
        <MetaRow label="KOSTNAD">
          {formatSek(attempt.cost_sek, moneyDetailed)} ({moneyDetailed.format(attempt.cost_usd)} USD)
        </MetaRow>
        <MetaRow label="MODELL / LEVERANTÖR">{[attempt.model, attempt.provider].filter(Boolean).join(" · ") || "–"}</MetaRow>
        <MetaRow label="TIDPUNKT">{attempt.at}</MetaRow>
      </dl>

      {attempt.quality_issues.length > 0 && (
        <>
          <p className="adm-eyebrow ds-mono adm-meta__spacer">KVALITETSKONTROLLER SOM FÄLLDE SVARET</p>
          <ul className="adm-notes-list">
            {attempt.quality_issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </>
      )}

      {/* Det faktiska meddelandet som skickades. Utan det går det inte att se
          om modellen fick bilens uppgifter eller svarade i blindo – vilket är
          hela skillnaden mellan INPUT_NOT_DELIVERED och NO_RESEARCH. */}
      {attempt.request_excerpt ? (
        <>
          <p className="adm-eyebrow ds-mono adm-meta__spacer">
            MEDDELANDET SOM SKICKADES TILL MODELLEN
            {attempt.request_excerpt_truncated ? ` · KORTAT TILL ${requestExcerptLimit} TECKEN` : ""}
          </p>
          <pre className="adm-raw ds-mono">{attempt.request_excerpt}</pre>
        </>
      ) : (
        <p className="adm-note adm-meta__spacer">
          Meddelandet som skickades sparades inte för det här försöket (post från före fältet fanns).
        </p>
      )}

      <p className="adm-eyebrow ds-mono adm-meta__spacer">
        {rawResponseLabel(attempt.raw_response)}
        {attempt.raw_response_truncated ? ` · KORTAT TILL ${rawResponseLimit} TECKEN` : ""}
      </p>
      {attempt.raw_response ? (
        <pre className="adm-raw ds-mono">{attempt.raw_response}</pre>
      ) : (
        <p className="adm-note">Inget svar hann sparas för det här försöket.</p>
      )}
    </div>
  );
}

/*
 * Tid, sökningar, token och kostnad per steg – och summan.
 *
 * Stegen bokförs även när körningen misslyckas, så att ett dyrt söksteg syns
 * fast skrivsteget aldrig blev klart. Det gör att kostnaden går att följa upp
 * utan att gissa utifrån totalbeloppet.
 */
function StepTable({ steps }: { steps: readonly GenerationStepMeta[] }) {
  if (steps.length === 0) return null;

  const sum = (values: Array<number | null>) =>
    values.every((value) => value === null) ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0);
  const totalSearches = steps.reduce((total, step) => total + step.searches, 0);
  const totalCostSek = steps.reduce((total, step) => total + step.cost_sek, 0);
  const totalCostUsd = steps.reduce((total, step) => total + step.cost_usd, 0);
  const totalInput = sum(steps.map((step) => step.input_tokens));
  const totalOutput = sum(steps.map((step) => step.output_tokens));

  return (
    <div className="adm-steps-wrap">
      <table className="adm-steps">
        <caption className="ds-mono">PER STEG: TID, SÖKNINGAR, TOKEN OCH KOSTNAD</caption>
        <thead>
          <tr>
            <th scope="col">STEG</th>
            <th scope="col">FÖRSÖK</th>
            <th scope="col">TID</th>
            <th scope="col">SÖKNINGAR</th>
            <th scope="col">TOKENS IN</th>
            <th scope="col">TOKENS UT</th>
            <th scope="col">KOSTNAD</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step, index) => (
            <tr key={`${step.step}-${step.attempt}-${index}`}>
              <th scope="row">{generationStepLabels[step.step]}</th>
              <td className="adm-num">{step.attempt}</td>
              <td className="adm-num">{formatDuration(step.duration_ms)}</td>
              <td className="adm-num">{step.searches}</td>
              <td className="adm-num">{step.input_tokens ?? "saknas"}</td>
              <td className="adm-num">{step.output_tokens ?? "saknas"}</td>
              <td className="adm-num">{formatSek(step.cost_sek, moneyDetailed)}</td>
            </tr>
          ))}
          <tr className="adm-steps__total">
            <th scope="row">TOTALT</th>
            <td className="adm-num">–</td>
            <td className="adm-num">{formatDuration(steps.reduce((total, step) => total + step.duration_ms, 0))}</td>
            <td className="adm-num">{totalSearches}</td>
            <td className="adm-num">{totalInput ?? "saknas"}</td>
            <td className="adm-num">{totalOutput ?? "saknas"}</td>
            <td className="adm-num">
              {formatSek(totalCostSek, moneyDetailed)} ({moneyDetailed.format(totalCostUsd)} USD)
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Läser stegen ur generation_meta eller felspåret, defensivt. */
function metaSteps(meta: Record<string, unknown> | null | undefined): GenerationStepMeta[] {
  const value = metaValue(meta, "steps");
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is GenerationStepMeta =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as GenerationStepMeta).step === "string" &&
      typeof (entry as GenerationStepMeta).duration_ms === "number",
  );
}

function FailurePanel({ failure, failureReason }: { failure: FailureMeta; failureReason: string | null }) {
  return (
    <div className="adm-panel">
      <p className="adm-eyebrow ds-mono">MISSLYCKANDE</p>
      <h3 className="adm-detail__title">{failureKindLabels[failure.kind]}</h3>
      <p className="adm-failure" role="alert">{failure.summary}</p>
      <p className="adm-note">{failureKindExplanations[failure.kind]}</p>
      <p className="adm-note ds-mono">KOD: {failureReason ?? "–"}</p>

      <dl className="adm-meta">
        <MetaRow label="FÖRSÖK">
          {failure.attempt_count}
          {failure.retried ? " (ett rättelseförsök gjordes)" : " (inget rättelseförsök)"}
        </MetaRow>
        <MetaRow label="TOTAL TID">{formatDuration(failure.duration_ms)}</MetaRow>
        <MetaRow label="SÖKNINGAR TOTALT">{failure.searches_total}</MetaRow>
        <MetaRow label="TOKENS IN TOTALT">{failure.input_tokens_total ?? "Uppgift saknas"}</MetaRow>
        <MetaRow label="TOKENS UT TOTALT">{failure.output_tokens_total ?? "Uppgift saknas"}</MetaRow>
        <MetaRow label="KOSTNAD TOTALT">
          {formatSek(failure.cost_sek_total, moneyDetailed)} ({moneyDetailed.format(failure.cost_usd_total)} USD)
        </MetaRow>
        <MetaRow label="LEVERANTÖR / MODELL">{[failure.provider, failure.model].filter(Boolean).join(" · ") || "–"}</MetaRow>
        <MetaRow label="MISSLYCKADES">{failure.failed_at}</MetaRow>
      </dl>

      {failure.model_notes.length > 0 && (
        <>
          <p className="adm-eyebrow ds-mono adm-meta__spacer">MODELLKONTROLLEN</p>
          <ul className="adm-notes-list">
            {failure.model_notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}

      {failure.steps && failure.steps.length > 0 && (
        <>
          <p className="adm-eyebrow ds-mono adm-meta__spacer">STEGEN I KÖRNINGEN</p>
          <StepTable steps={failure.steps} />
        </>
      )}

      {failure.attempts.map((attempt) => (
        <AttemptCard key={attempt.attempt} attempt={attempt} />
      ))}
    </div>
  );
}

/** Ett testanrop så som backend beskriver det. */
type ProbeResult = NonNullable<ProviderModelCheck["probe"]>;

/**
 * Rubrik som skiljer på vad som faktiskt hände: Google avvisade förfrågan
 * (till exempel för att modellen inte tar sökverktyget) eller så kom ett svar
 * tillbaka som inte gick att tolka. Under den gamla rubriken "Sökverktyget
 * avvisades" såg de två helt olika lägena likadana ut.
 */
function probeHeading(probe: ProbeResult): string {
  if (probe.outcome === "ok") {
    return probe.withSearchTool ? "Sökverktyget togs emot" : "Samma anrop utan sökverktyg svarade normalt";
  }
  if (probe.outcome === "unreadable") return "Svaret kunde inte tolkas";
  if (probe.code === "PROVIDER_BLOCKED") return "Google blockerade anropet";
  return probe.withSearchTool ? "Google avvisade verktyget" : "Google avvisade anropet";
}

/** Ett enskilt testanrop, med finishReason, token och rå struktur när texten saknas. */
function ProbePanel({ probe, title }: { probe: ProbeResult; title: string }) {
  const costUsd = estimateCostUsd("google", {
    inputTokens: probe.inputTokens,
    outputTokens: probe.outputTokens,
    searches: probe.searches,
  });

  return (
    <div className="adm-panel">
      <p className="adm-eyebrow ds-mono">{title}</p>
      <h3 className="adm-detail__title">{probeHeading(probe)}</h3>
      <p className={probe.ok ? "adm-note" : "adm-error"} role={probe.ok ? undefined : "alert"}>
        {probe.message}
      </p>
      <dl className="adm-meta">
        <MetaRow label="KATEGORI">{probe.ok ? "OK" : `${probe.code} (fel)`}</MetaRow>
        <MetaRow label="HTTP-STATUS">
          {probe.status === null ? "Ingen HTTP-status" : probe.status}
        </MetaRow>
        <MetaRow label="FINISH REASON">{probe.finishReason ?? "saknas"}</MetaRow>
        {probe.blockReason && <MetaRow label="BLOCK REASON">{probe.blockReason}</MetaRow>}
        <MetaRow label="SÖKNINGAR">{probe.searches}</MetaRow>
        <MetaRow label="TOKENS IN / UT">
          {probe.inputTokens ?? "saknas"} / {probe.outputTokens ?? "saknas"}
        </MetaRow>
        <MetaRow label="VARAV TÄNK-TOKEN">{probe.thoughtsTokens ?? "saknas"}</MetaRow>
        <MetaRow label="TID">{formatDuration(probe.durationMs)}</MetaRow>
        <MetaRow label="TESTETS KOSTNAD">{moneyDetailed.format(costUsd)} USD</MetaRow>
      </dl>

      {probe.text && (
        <>
          <p className="adm-eyebrow ds-mono adm-meta__spacer">MODELLENS SVAR</p>
          <pre className="adm-raw ds-mono">{probe.text}</pre>
        </>
      )}
      {!probe.text && probe.rawResponse && (
        <>
          <p className="adm-eyebrow ds-mono adm-meta__spacer">
            RÅ SVARSSTRUKTUR · KORTAT TILL {rawResponseLimit} TECKEN
          </p>
          <pre className="adm-raw ds-mono">{probe.rawResponse}</pre>
        </>
      )}
    </div>
  );
}

/**
 * Jämför de två testanropen och säger var felet sitter: bara i sökverktyget,
 * eller i tolkningen och modellen (då misslyckas båda).
 */
function compareProbes(withTool: ProbeResult | null, withoutTool: ProbeResult | null): { ok: boolean; text: string } | null {
  if (!withTool || !withoutTool) return null;
  if (withTool.ok && withoutTool.ok) {
    return { ok: true, text: "Båda anropen svarade med text – sökverktyget och tolkningen fungerar." };
  }
  if (!withTool.ok && withoutTool.ok) {
    return {
      ok: false,
      text: `Felet sitter i sökverktyget: samma anrop utan verktyg svarade normalt, medan anropet med verktyget gav ${withTool.code}.`,
    };
  }
  if (withTool.ok && !withoutTool.ok) {
    return {
      ok: false,
      text: `Anropet med sökverktyget svarade normalt, men utan verktyg gav ${withoutTool.code} – felet hänger alltså inte ihop med verktyget.`,
    };
  }
  return {
    ok: false,
    text: `Båda anropen misslyckades (${withTool.code} med verktyget, ${withoutTool.code} utan). Då sitter felet inte i verktyget, utan i anropets budget, i modellen eller i tolkningen – jämför finishReason och den råa strukturen nedan.`,
  };
}

/**
 * Modellkontrollen: finns modellnamnet i LLM_MODEL hos Google, och tar modellen
 * emot sökverktyget? Kontrollen görs server-side mot Googles egen modellista
 * plus två små riktiga anrop – ett med sökverktyget och ett utan – så att ett
 * misslyckande går att hänföra till rätt sak. Nycklar lämnar aldrig servern.
 */
function ModelCheckPanel() {
  const checkModel = useAction(api.reportProviderCheck.checkModel);
  const [state, setState] = useState<{ kind: "idle" | "busy" | "error"; message?: string }>({ kind: "idle" });
  const [result, setResult] = useState<ProviderModelCheck | null>(null);

  const comparison = compareProbes(result?.probe ?? null, result?.probeWithoutTool ?? null);

  return (
    <section className="adm-section" aria-labelledby="adm-model-check-title">
      <h2 id="adm-model-check-title" className="adm-section-title">Modellkontroll</h2>
      <p className="adm-note">
        Kontrollerar att modellnamnet i <span className="ds-mono">LLM_MODEL</span> finns i Googles modellista och tar emot
        Google Search-grounding. Grounding avgörs med två små riktiga anrop – ett med sökverktyget och ett utan – eftersom
        Googles modellista inte säger vilka verktyg en modell tar, och eftersom ett tomt svar kan bero på verktyget, på
        tolkningen eller på att tänk-token åt upp hela utdatabudgeten. Båda anropen kostar några ören, och deras sökningar,
        token och finishReason redovisas nedan. Anropet med verktyget ber modellen att söka: Google låter modellen avgöra
        själv om sökverktyget ska användas, så antalet sökningar i rutan nedan är det enda säkra svaret på om en sökning
        verkligen gjordes.
      </p>
      <div className="adm-actions">
        <button
          type="button"
          className="ds-btn ds-btn--primary"
          disabled={state.kind === "busy"}
          onClick={async () => {
            setState({ kind: "busy" });
            try {
              const checked = await checkModel({});
              setResult(checked);
              setState({ kind: "idle" });
            } catch (error) {
              setState({ kind: "error", message: error instanceof Error ? error.message : "Kontrollen kunde inte genomföras." });
            }
          }}
        >
          {state.kind === "busy" ? "Kontrollerar modellen…" : "Kontrollera modellen"}
        </button>
      </div>
      {state.kind === "error" && <p className="adm-error" role="alert">{state.message}</p>}

      {result && (
        <div className="adm-detail">
          <div className="adm-panel">
            <p className="adm-eyebrow ds-mono">KONFIGURERAD MODELL</p>
            <h3 className="adm-detail__title ds-mono">{result.model}</h3>
            <dl className="adm-meta">
              <MetaRow label="LEVERANTÖR">{result.provider}</MetaRow>
              <MetaRow label="KONTROLLERAD">{result.checkedAt}</MetaRow>
              <MetaRow label="TÄNKANDE I ANROPET">{result.thinking}</MetaRow>
              {result.google && (
                <>
                  <MetaRow label="FINNS I MODELLISTAN">{result.google.modelExists ? "Ja" : "Nej"}</MetaRow>
                  <MetaRow label="TAR EMOT generateContent">{result.google.supportsGenerateContent ? "Ja" : "Nej"}</MetaRow>
                  <MetaRow label="GROUNDING ENLIGT FAMILJ">
                    {result.google.groundingSupported ? "Ja, dokumenterat stödd" : "Nej, inte dokumenterat stödd"}
                  </MetaRow>
                  <MetaRow label="NAMN I MODELLISTAN">{result.google.modelsAvailable} st</MetaRow>
                </>
              )}
            </dl>
            {result.google && !result.google.modelExists && result.google.suggestions.length > 0 && (
              <>
                <p className="adm-eyebrow ds-mono adm-meta__spacer">NÄRMAST TILLGÄNGLIGA NAMN</p>
                <ul className="adm-notes-list adm-notes-list--mono">
                  {result.google.suggestions.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </>
            )}
            {result.error && <p className="adm-error" role="alert">{result.error}</p>}
          </div>

          {result.probe && <ProbePanel probe={result.probe} title="TEST MED SÖKVERKTYGET" />}
          {result.probeWithoutTool && <ProbePanel probe={result.probeWithoutTool} title="SAMMA TEST UTAN SÖKVERKTYG" />}

          {comparison && (
            <p className={comparison.ok ? "adm-note" : "adm-error"} role={comparison.ok ? undefined : "alert"}>
              {comparison.text}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/* generation_meta lagras som ett fritt objekt. Läsningen sker därför defensivt,
   så att en nyckel som saknas eller har ändrad typ aldrig kraschar sidan. */
function metaValue(meta: Record<string, unknown> | null | undefined, key: string): unknown {
  return meta && typeof meta === "object" ? meta[key] : undefined;
}

function metaText(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metaValue(meta, key);
  return typeof value === "string" && value.trim() ? value : null;
}

function metaNumber(meta: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metaValue(meta, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metaStringList(meta: Record<string, unknown> | null | undefined, key: string): string[] {
  const value = metaValue(meta, key);
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="adm-meta__row">
      <dt className="ds-mono adm-meta__label">{label}</dt>
      <dd className="adm-meta__value">{children}</dd>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <main className="adm-page">
      <div className="adm-inner adm-inner--narrow">
        <p className="adm-loading" role="status" aria-live="polite">{label}</p>
      </div>
    </main>
  );
}

export default function Admin() {
  const viewer = useQuery(api.reportAdmin.viewer);
  const [reviewFilter, setReviewFilter] = useState<"all" | ReviewStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionState, setActionState] = useState<{ kind: "idle" | "busy" | "done" | "error"; message?: string }>({ kind: "idle" });
  const setReviewStatus = useMutation(api.reportAdmin.setReviewStatus);

  const isAdmin = viewer?.isAdmin === true;

  const list = useQuery(
    api.reportAdmin.listReports,
    isAdmin ? { limit: 100, ...(reviewFilter === "all" ? {} : { reviewStatus: reviewFilter }) } : "skip",
  );
  const detail = useQuery(
    api.reportAdmin.reportDetail,
    isAdmin && selectedId ? { reportId: selectedId } : "skip",
  );
  /* Felspåret läses defensivt: en post med ett äldre eller trasigt spår visas utan detaljer. */
  const failureMeta = parseFailureMeta(detail?.failure) ?? null;

  if (viewer === undefined) return <Loading label="Laddar behörighet…" />;

  if (!isAdmin) {
    return (
      <main className="adm-page">
        <div className="adm-inner adm-inner--narrow">
          <header className="adm-head">
            <p className="adm-eyebrow ds-mono">INTERN GRANSKNING</p>
            <h1>Rapportgranskning</h1>
          </header>

          <section className="adm-panel" aria-labelledby="adm-locked-title">
            <p className="adm-locked__icon" aria-hidden="true"><Lock size={18} /></p>
            <h2 id="adm-locked-title">Sidan är bara för administratören</h2>
            <p className="adm-note">
              Granskning av rapporter kräver att du loggar in med den e-postadress som är satt som{" "}
              <span className="ds-mono">ADMIN_EMAIL</span> och bekräftar den med koden som skickas till adressen. Gäster
              och andra konton nekas.
            </p>
            <p className="adm-note">
              {viewer.isSignedIn
                ? "Det här kontot är inte administratör."
                : "Logga in med administratörens e-postadress för att fortsätta."}
            </p>
          </section>
        </div>
      </main>
    );
  }

  const totals = list?.totals;
  const reports = list?.reports ?? [];

  return (
    <main className="adm-page">
      <div className="adm-inner">
        <header className="adm-head">
          <p className="adm-eyebrow ds-mono">INTERN GRANSKNING</p>
          <h1>Rapportgranskning</h1>
          <p className="adm-lede">
            Här granskas rapporter som genererats av researchflödet. Granskningsstatus styr om en rapport får visas:
            borttagna rapporter används inte och kan inte hämtas från cachen.
          </p>
          {viewer.isSignedIn && (
            <p className="adm-note">
              <ShieldCheck size={14} aria-hidden="true" /> Inloggad med administratörsbehörighet.
            </p>
          )}
        </header>

        <section className="adm-section" aria-labelledby="adm-totals-title">
          <h2 id="adm-totals-title" className="adm-section-title">Kostnader och omfattning</h2>
          {totals === undefined ? (
            <p className="adm-loading" role="status" aria-live="polite">Räknar samman…</p>
          ) : (
            <>
              <dl className="adm-stat-grid">
                <div className="adm-stat">
                  <dt className="ds-mono">RAPPORTER</dt>
                  <dd>{totals.count}</dd>
                </div>
                <div className="adm-stat">
                  <dt className="ds-mono">GENOMSNITT PER RAPPORT</dt>
                  <dd>{formatSek(totals.averageCostSek, moneyDetailed)}</dd>
                </div>
                <div className="adm-stat">
                  <dt className="ds-mono">TOTAL KOSTNAD</dt>
                  <dd>{formatSek(totals.totalCostSek, moneyDetailed)}</dd>
                </div>
                <div className="adm-stat">
                  <dt className="ds-mono">RAPPORTER MED KOSTNAD</dt>
                  <dd>{totals.pricedCount}</dd>
                </div>
                <div className="adm-stat">
                  <dt className="ds-mono">MISSLYCKADE FÖRSÖK</dt>
                  <dd>{totals.failedCount}</dd>
                </div>
                <div className="adm-stat">
                  <dt className="ds-mono">KOSTNAD MISSLYCKADE</dt>
                  <dd>{formatSek(totals.failedCostSek, moneyDetailed)}</dd>
                </div>
                <div className="adm-stat">
                  <dt className="ds-mono">SÖKNINGAR MISSLYCKADE</dt>
                  <dd>{totals.failedSearches}</dd>
                </div>
                <div className="adm-stat">
                  <dt className="ds-mono">ÖPPNA FLAGGOR</dt>
                  <dd>{totals.openFlags}</dd>
                </div>
              </dl>
              <p className="adm-note">
                Granskningsstatus: ogranskade {totals.byReviewStatus.unreviewed} · granskade{" "}
                {totals.byReviewStatus.reviewed} · borttagna {totals.byReviewStatus.removed}. Täckning: bra{" "}
                {totals.byCoverage.good} · delvis {totals.byCoverage.partial} · tunt {totals.byCoverage.thin}.
              </p>
              <p className="adm-note">
                Total kostnad och genomsnitt räknar även in de försök som misslyckades: sökningarna är redan betalda,
                även när ingen rapport blev klar. Kostnaden för dem visas i raden märkt “från misslyckat försök”.
              </p>
            </>
          )}
        </section>

        <section className="adm-section" aria-labelledby="adm-list-title">
          <div className="adm-section-head">
            <h2 id="adm-list-title" className="adm-section-title">Rapporter</h2>
            <div className="adm-filter">
              <label className="ds-mono adm-filter__label" htmlFor="adm-review-filter">VISA</label>
              <select
                id="adm-review-filter"
                className="ds-select adm-filter__select"
                value={reviewFilter}
                onChange={(event) => setReviewFilter(event.target.value as "all" | ReviewStatus)}
              >
                {reviewFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          {list === undefined ? (
            <p className="adm-loading" role="status" aria-live="polite">Hämtar rapporter…</p>
          ) : reports.length === 0 ? (
            <p className="adm-note">Inga rapporter matchar filtret.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <caption className="adm-table__caption">
                  Välj en rad för att se rapportens källor, kostnad och granskningsåtgärder.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">BIL</th>
                    <th scope="col">TÄCKNING</th>
                    <th scope="col">PUNKTER</th>
                    <th scope="col">KOSTNAD</th>
                    <th scope="col">LEVERANTÖR</th>
                    <th scope="col">SKAPAD</th>
                    <th scope="col">STATUS</th>
                    <th scope="col">FLAGGOR</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => {
                    const selected = report.reportId === selectedId;
                    return (
                      <tr
                        key={report.reportId}
                        className={selected ? "is-selected" : undefined}
                        aria-current={selected ? "true" : undefined}
                      >
                        <th scope="row">
                          <button
                            type="button"
                            className="adm-row-button"
                            aria-pressed={selected}
                            onClick={() => {
                              setSelectedId(report.reportId);
                              setActionState({ kind: "idle" });
                            }}
                          >
                            {report.vehicleLabel}
                          </button>
                          <span className="ds-mono adm-row-id">{report.reportId}</span>
                        </th>
                        <td>{coverageText(report.coverage)}</td>
                        <td className="adm-num">{report.issueCount}</td>
                        <td className="adm-num">
                          {formatSek(report.estimatedCostSek)}
                          {report.costFromFailure && (
                            <span className="ds-mono adm-substatus">från misslyckat försök</span>
                          )}
                        </td>
                        <td className="ds-mono">{report.provider ?? "–"}</td>
                        <td className="adm-nowrap">{formatWhen(report.createdAt)}</td>
                        <td>
                          <span className="adm-chip ds-mono">
                            {reviewStatusLabels[report.reviewStatus] ?? report.reviewStatus}
                          </span>
                          {report.status !== "done" && (
                            <span className="ds-mono adm-substatus">
                              {reportStatusLabels[report.status] ?? report.status}
                              {report.failureKind ? ` · ${failureKindLabels[report.failureKind]}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="adm-num">
                          {report.flagCount > 0 ? (
                            <>
                              <span className="adm-flag-badge">{report.flagCount}</span>
                              <span className="adm-sr-only"> flaggor från användare</span>
                            </>
                          ) : (
                            <span aria-hidden="true">–</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <ProviderPanel />

        <LookupPanel />

        <ModelCheckPanel />

        <PurgePanel />

        <section className="adm-section" aria-labelledby="adm-detail-title">
          <h2 id="adm-detail-title" className="adm-section-title">Rapportdetaljer</h2>

          {!selectedId && <p className="adm-note">Välj en rapport i listan ovan.</p>}

          {selectedId && detail === undefined && (
            <p className="adm-loading" role="status" aria-live="polite">Hämtar rapporten…</p>
          )}

          {selectedId && detail === null && (
            <p className="adm-note" role="status">Rapporten hittades inte.</p>
          )}

          {selectedId && detail && (
            <div className="adm-detail">
              <div className="adm-panel">
                <p className="adm-eyebrow ds-mono">VARIANT</p>
                <h3 className="adm-detail__title">{detail.vehicleLabel}</h3>
                <dl className="adm-spec">
                  <div><dt className="ds-mono">MÄRKE</dt><dd>{detail.vehicle.make}</dd></div>
                  <div><dt className="ds-mono">MODELL</dt><dd>{detail.vehicle.model}</dd></div>
                  <div><dt className="ds-mono">ÅRSMODELL</dt><dd>{detail.vehicle.year}</dd></div>
                  <div><dt className="ds-mono">MOTOR</dt><dd>{detail.vehicle.engine}</dd></div>
                  <div><dt className="ds-mono">VÄXELLÅDA</dt><dd>{detail.vehicle.gearbox}</dd></div>
                  <div><dt className="ds-mono">DRIVNING</dt><dd>{detail.vehicle.drivetrain}</dd></div>
                  <div>
                    <dt className="ds-mono">MÄTARSTÄLLNING</dt>
                    <dd>{detail.vehicle.mileage_km === null ? "Uppgift saknas" : `${detail.vehicle.mileage_km} km`}</dd>
                  </div>
                  <div><dt className="ds-mono">TÄCKNING</dt><dd>{coverageText(detail.coverage)}</dd></div>
                  <div><dt className="ds-mono">SKAPAD</dt><dd>{formatWhen(detail.createdAt)}</dd></div>
                  <div><dt className="ds-mono">UPPDATERAD</dt><dd>{formatWhen(detail.updatedAt)}</dd></div>
                </dl>

                {detail.researchNotes && <p className="adm-note adm-detail__notes">{detail.researchNotes}</p>}
                {detail.failureReason && (
                  <p className="adm-error" role="alert">
                    Misslyckad körning: {failureMeta ? failureKindLabels[failureMeta.kind] : detail.failureReason}
                  </p>
                )}

                <div className="adm-actions">
                  <button
                    type="button"
                    className="ds-btn ds-btn--primary"
                    disabled={detail.reviewStatus === "reviewed" || actionState.kind === "busy"}
                    onClick={async () => {
                      setActionState({ kind: "busy" });
                      try {
                        await setReviewStatus({ reportId: detail.reportId, reviewStatus: "reviewed" });
                        setActionState({ kind: "done", message: "Rapporten är markerad som granskad." });
                      } catch (error) {
                        setActionState({
                          kind: "error",
                          message: error instanceof Error ? error.message : "Kunde inte spara.",
                        });
                      }
                    }}
                  >
                    Markera som granskad
                  </button>
                  <button
                    type="button"
                    className="ds-btn ds-btn--secondary"
                    disabled={detail.reviewStatus === "unreviewed" || actionState.kind === "busy"}
                    onClick={async () => {
                      setActionState({ kind: "busy" });
                      try {
                        await setReviewStatus({ reportId: detail.reportId, reviewStatus: "unreviewed" });
                        setActionState({ kind: "done", message: "Rapporten är markerad som ogranskad." });
                      } catch (error) {
                        setActionState({
                          kind: "error",
                          message: error instanceof Error ? error.message : "Kunde inte spara.",
                        });
                      }
                    }}
                  >
                    Markera som ogranskad
                  </button>
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost adm-danger"
                    disabled={detail.reviewStatus === "removed" || actionState.kind === "busy"}
                    onClick={async () => {
                      setActionState({ kind: "busy" });
                      try {
                        await setReviewStatus({ reportId: detail.reportId, reviewStatus: "removed" });
                        setActionState({ kind: "done", message: "Rapporten är borttagen och används inte längre." });
                      } catch (error) {
                        setActionState({
                          kind: "error",
                          message: error instanceof Error ? error.message : "Kunde inte spara.",
                        });
                      }
                    }}
                  >
                    Ta bort rapporten
                  </button>
                </div>

                <p className="adm-status-note" role="status" aria-live="polite">
                  {actionState.kind === "done" ? actionState.message : ""}
                </p>
                {actionState.kind === "error" && <p className="adm-error" role="alert">{actionState.message}</p>}
                <p className="adm-note">
                  Nuvarande granskningsstatus:{" "}
                  <strong>{reviewStatusLabels[detail.reviewStatus] ?? detail.reviewStatus}</strong>.
                  {detail.reportAvailable
                    ? " Rapportinnehållet finns sparat."
                    : " Ingen giltig rapport är sparad för den här posten."}
                </p>
              </div>

              {failureMeta && <FailurePanel failure={failureMeta} failureReason={detail.failureReason} />}

              <div className="adm-panel">
                <p className="adm-eyebrow ds-mono">GENERERING</p>
                <h3 className="adm-detail__title">Metadata</h3>
                <dl className="adm-meta">
                  <MetaRow label="MODELL">{metaText(detail.generationMeta, "model") ?? "–"}</MetaRow>
                  <MetaRow label="LEVERANTÖR">{metaText(detail.generationMeta, "provider") ?? "–"}</MetaRow>
                  <MetaRow label="PROMPT-VERSION">{metaText(detail.generationMeta, "prompt_version") ?? "–"}</MetaRow>
                  <MetaRow label="SÖKNINGAR">{metaNumber(detail.generationMeta, "searches_run") ?? "–"}</MetaRow>
                  <MetaRow label="KÄLLOR ANVÄNDA">{metaNumber(detail.generationMeta, "sources_used") ?? "–"}</MetaRow>
                  <MetaRow label="TOKENS IN">{metaNumber(detail.generationMeta, "input_tokens") ?? "Uppgift saknas"}</MetaRow>
                  <MetaRow label="TOKENS UT">{metaNumber(detail.generationMeta, "output_tokens") ?? "Uppgift saknas"}</MetaRow>
                  <MetaRow label="UPPSKATTAD KOSTNAD">
                    {formatSek(metaNumber(detail.generationMeta, "estimated_cost_sek"), moneyDetailed)}
                  </MetaRow>
                  <MetaRow label="VARAKTIGHET">
                    {metaNumber(detail.generationMeta, "duration_ms") === null
                      ? "–"
                      : `${Math.round((metaNumber(detail.generationMeta, "duration_ms") as number) / 100) / 10} s`}
                  </MetaRow>
                  <MetaRow label="KÄLLOR SOM TAS BORT">
                    {metaStringList(detail.generationMeta, "unverified_source_urls").length}
                  </MetaRow>
                  <MetaRow label="OMKÖRNING">
                    {metaValue(detail.generationMeta, "retried") === true ? "Ja, ett korrigeringsförsök" : "Nej"}
                  </MetaRow>
                  <MetaRow label="INJEKTIONSMISSTANKE">
                    {metaValue(detail.generationMeta, "injection_suspected") === true ? "Ja" : "Nej"}
                  </MetaRow>
                  <MetaRow label="GENERERAD">{metaText(detail.generationMeta, "generated_at") ?? "–"}</MetaRow>
                </dl>

                {metaSteps(detail.generationMeta).length > 0 && (
                  <>
                    <p className="adm-eyebrow ds-mono adm-meta__spacer">STEGEN I KÖRNINGEN</p>
                    <StepTable steps={metaSteps(detail.generationMeta)} />
                  </>
                )}

                {metaStringList(detail.generationMeta, "quality_notes").length > 0 && (
                  <>
                    <p className="adm-eyebrow ds-mono adm-meta__spacer">KVALITETSKONTROLLER</p>
                    <ul className="adm-notes-list">
                      {metaStringList(detail.generationMeta, "quality_notes").map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </>
                )}

                {metaStringList(detail.generationMeta, "unverified_source_urls").length > 0 && (
                  <>
                    <p className="adm-eyebrow ds-mono adm-meta__spacer">
                      KÄLLOR SOM TAS BORT – FANNS INTE BLAND SÖKTRÄFFARNA
                    </p>
                    <ul className="adm-notes-list adm-notes-list--mono">
                      {metaStringList(detail.generationMeta, "unverified_source_urls").map((url) => (
                        <li key={url}>{url}</li>
                      ))}
                    </ul>
                  </>
                )}

                <p className="adm-eyebrow ds-mono adm-meta__spacer">STATUSLOGG</p>
                <ol className="adm-log">
                  {detail.statusLog.map((entry, index) => (
                    <li key={`${entry.status}-${entry.at}-${index}`}>
                      <span className="ds-mono">{entry.status}</span>
                      <span className="adm-log__time">{formatWhen(entry.at)}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="adm-panel">
                <p className="adm-eyebrow ds-mono">FLAGGOR FRÅN ANVÄNDARE</p>
                <h3 className="adm-detail__title">
                  {detail.flags.length === 0 ? "Inga flaggor" : `${detail.flags.length} flaggor`}
                </h3>
                {detail.flags.length === 0 ? (
                  <p className="adm-note">Ingen användare har flaggat den här rapporten.</p>
                ) : (
                  <ul className="adm-flags">
                    {detail.flags.map((flag, index) => (
                      <li key={`${flag.createdAt}-${index}`}>
                        <span className="ds-mono adm-chip">{flagKindLabels[flag.kind] ?? flag.kind}</span>
                        <span className="adm-flags__message">{flag.message}</span>
                        <span className="adm-flags__time ds-mono">{formatWhen(flag.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="adm-panel">
                <p className="adm-eyebrow ds-mono">PUNKTER ({detail.issueTitles.length})</p>
                <h3 className="adm-detail__title">Områden i rapporten</h3>
                {detail.issueTitles.length === 0 ? (
                  <p className="adm-note">Inga punkter finns i rapporten.</p>
                ) : (
                  <ol className="adm-issues">
                    {detail.issueTitles.map((title, index) => (
                      <li key={title}>
                        <span className="ds-mono adm-issues__number">{String(index + 1).padStart(2, "0")}</span>
                        <span>{title}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {detail.dataBasisNote && <p className="adm-note adm-detail__notes">{detail.dataBasisNote}</p>}
              </div>

              <div className="adm-panel">
                <p className="adm-eyebrow ds-mono">KÄLLOR ({detail.sources.length})</p>
                <h3 className="adm-detail__title">Underlag</h3>
                {detail.sources.length === 0 ? (
                  <p className="adm-note">Inga källor är kopplade till rapporten.</p>
                ) : (
                  <SourceList sources={detail.sources} />
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
