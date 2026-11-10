/**
 * Bevis för tvåstegsgenereringen – utan ett enda riktigt anrop.
 *
 *   bun scripts/verify-two-step.ts
 *
 * Skriptet kör exakt samma kod som produktionspipelinen
 * (`runTwoStepGeneration`) mot en simulerad leverantör, och bevisar fyra fall:
 *
 *   a) normalt: söksteget söker, skrivsteget bygger rapporten ur källistan.
 *   b) noll sökningar båda gångerna: körningen avbryts med NO_RESEARCH, och
 *      skrivsteget körs aldrig.
 *   c) noll sökningar första gången, sökning andra: exakt ett omförsök görs och
 *      rapporten byggs på det andra försöket.
 *   d) tidsgräns: söksteget respektive skrivsteget avbryts, och inget nytt
 *      försök görs.
 *
 * Dessutom kontrolleras att modellens egna siffror för sökningar, källor och
 * täckning alltid skrivs över med de verkliga, att tid, sökningar, token och
 * kostnad bokförs per steg – även när körningen misslyckas – och att bilens
 * uppgifter följer med i båda stegen:
 *
 *   e) indata med tomma fält, mellanslag i modellnamnet och saknat miltal:
 *      bilens JSON finns i både sök- och skrivstegets meddelande.
 *   f) modellen svarar med att be om bilens uppgifter: körningen får kategorin
 *      INPUT_NOT_DELIVERED, inget omförsök görs och skrivsteget körs aldrig.
 *   g) sju omdirigeringslänkar med olika titlar: utgivaren läses ur titeln, så
 *      att sju sajter blir sju utgivare – och täckningen "Bra" och
 *      "väldokumenterat" därmed kan sättas på riktiga grunder.
 *
 * Inga nycklar läses, inga nätverksanrop görs och ingen miljövariabel krävs.
 */

import { reportDataBasisNote, reportSchema, type Vehicle } from "../src/lib/report";
import { buildSearchUserMessage } from "../src/lib/reportPrompt";
import { parseFailureMeta } from "../src/lib/reportAdminOverview";
import { groundingChunkFromWeb, ProviderError, resolveChunkDomain } from "../src/convex/reportProviders";
import { runTwoStepGeneration, type GenerationProvider } from "../src/convex/reportPipeline";
import type { GroundingChunk, SearchRequest, SearchResult, WriteRequest, WriteResult } from "../src/convex/reportProviders";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` – ${detail}` : ""}`);
  }
}

const vehicle: Vehicle = {
  make: "Testbil",
  model: "Tvåsteg",
  year: 2018,
  engine: "2,0 diesel",
  gearbox: "Automat",
  drivetrain: "Framhjulsdrift",
  mileage_km: 120_000,
};

const chunks = [
  { url: "https://tillverkaren.example.se/service", title: "Serviceinformation", domain: "tillverkaren.example.se" },
  { url: "https://statistik.example.se/agare", title: "Ägarstatistik", domain: "statistik.example.se" },
  { url: "https://verkstaden.example.se/erfarenheter", title: "Verkstadserfarenheter", domain: "verkstaden.example.se" },
  { url: "https://tidningen.example.se/kopguide", title: "Köpguide", domain: "tidningen.example.se" },
  { url: "https://forumet.example.se/trad", title: "Ägartråd", domain: "forumet.example.se" },
];

/**
 * Modellens svar i skrivsteget. `source_ids` pekar på källistan som koden
 * skickade in, och `sources` är tom – källorna fylls alltid i av koden.
 * Siffrorna i research_summary är medvetet påhittade, för att bevisa att de
 * aldrig får stå kvar.
 */
function modelAnswer(): unknown {
  const issue = (index: number, severity: string, sourceIds: string[]) => ({
    id: `i${index + 1}`,
    title: `Problem ${index + 1}`,
    symptoms: "Symptom som går att känna igen vid provkörning.",
    how_to_check: "Kontroll som köparen kan göra själv.",
    typical_onset: "Blir aktuellt med tiden.",
    applies_to: "Testvarianten.",
    cost_range_sek: { min: 1000, max: 5000 },
    cost_basis: "estimate",
    severity,
    safety_related: index === 0,
    confidence: "reported",
    evidence_summary: "Källorna beskriver samma sak.",
    source_ids: sourceIds,
  });

  return {
    schema_version: "2.0",
    report_id: "TEST-TVASTEG-1",
    generated_at: new Date().toISOString(),
    variant_status: "partial",
    assumptions: ["Antagande om utförandet."],
    vehicle,
    summary: {
      text: "Testrapport byggd ur fynden i söksteget.",
      risk_level: "medium",
      risk_score: 40,
      top_checks: ["Kontroll 1", "Kontroll 2"],
    },
    /* Påhittade siffror: 99 sökningar och 77 källor. De ska skrivas över. */
    research_summary: { searches_run: 99, sources_used: 77, coverage: "good", notes: "Påhittad anteckning från modellen." },
    known_issues: [
      issue(0, "high", ["s1", "s2"]),
      issue(1, "high", ["s2"]),
      issue(2, "medium", ["s3"]),
      issue(3, "medium", ["s1"]),
      issue(4, "low", ["s4"]),
      issue(5, "low", ["s5"]),
    ],
    good_to_know: ["Bra att veta."],
    checklist: Array.from({ length: 12 }, (_, index) => ({
      id: `c${index + 1}`,
      text: `Testpunkt ${index + 1}`,
      variant_specific: index % 5 !== 4,
      section: index < 6 ? "Provkörning" : "Dokumentation",
    })),
    seller_questions: Array.from({ length: 6 }, (_, index) => ({
      question: `Testfråga ${index + 1}?`,
      why: "Skäl.",
      red_flag_answer: "Svar som bör göra köparen försiktig.",
      variant_specific: index !== 5,
    })),
    documents_to_verify: ["Serviceunderlag", "Kvitton", "Registreringsbevis", "Garantibevis"],
    sources: [],
    data_basis_note: "Bygger på källorna i söksteget.",
    disclaimer_note: "Detta är inte en teknisk besiktning av bilen.",
    review_status: "unreviewed",
  };
}

function searchOk(searches: number): SearchResult {
  return {
    provider: "google",
    model: "simulerad",
    text: "Kända problem: två oberoende källor beskriver samma sak (verkstaden.example.se). Återkallelser: inga hittade (tillverkaren.example.se).",
    searches,
    chunks,
    inputTokens: 1500,
    outputTokens: 400,
    finishReason: "STOP",
  };
}

const writeOk: WriteResult = {
  provider: "google",
  model: "simulerad",
  text: JSON.stringify(modelAnswer()),
  inputTokens: 9000,
  outputTokens: 3000,
  finishReason: "STOP",
};

/** Räknar anropen och svarar enligt ett scenario. */
function simulatedProvider(behaviour: {
  search: Array<SearchResult | Error>;
  write?: Array<WriteResult | Error>;
}): GenerationProvider & {
  searchCalls: number;
  writeCalls: number;
  searchRequests: SearchRequest[];
  writeRequests: WriteRequest[];
} {
  /* Prislistan för "google" används med flit: leverantören är simulerad, men
     kostnadsberäkningen ska vara den riktiga så att stegens kronbelopp går att
     kontrollera. Inga nätverksanrop görs. */
  const state = { searchCalls: 0, writeCalls: 0, searchRequests: [] as SearchRequest[], writeRequests: [] as WriteRequest[] };
  return {
    id: "google",
    get searchCalls() {
      return state.searchCalls;
    },
    get writeCalls() {
      return state.writeCalls;
    },
    get searchRequests() {
      return state.searchRequests;
    },
    get writeRequests() {
      return state.writeRequests;
    },
    async search(request: SearchRequest) {
      state.searchRequests.push(request);
      const step = behaviour.search[Math.min(state.searchCalls, behaviour.search.length - 1)];
      state.searchCalls += 1;
      if (step instanceof Error) throw step;
      return step;
    },
    async write(request: WriteRequest) {
      state.writeRequests.push(request);
      const queue = behaviour.write ?? [writeOk];
      const step = queue[Math.min(state.writeCalls, queue.length - 1)];
      state.writeCalls += 1;
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

/** Läser bilens JSON ur ett användarmeddelande, så som det skickades. */
function vehicleJsonIn(message: string): unknown {
  const start = message.indexOf("{");
  const end = message.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(message.slice(start, end + 1));
  } catch {
    return null;
  }
}

function run(
  provider: GenerationProvider,
  overrides: { timeoutMs?: number; vehicle?: Vehicle } = {},
) {
  return runTwoStepGeneration({
    vehicle: overrides.vehicle ?? vehicle,
    purchaseTiming: "curious",
    provider,
    model: "simulerad-modell",
    maxSearches: 8,
    timeoutMs: overrides.timeoutMs ?? 200_000,
    usdToSek: 10.8,
    today: "2026-10-28",
  });
}

/* ------------------------------------------------------------------ *
 * (a) Normalt svar
 * ------------------------------------------------------------------ */

console.log("\na) Söksteget söker och skrivsteget bygger rapporten");

{
  const provider = simulatedProvider({ search: [searchOk(4)], write: [writeOk] });
  const outcome = await run(provider);

  check("körningen lyckas", outcome.ok === true);
  if (outcome.ok) {
    const parsed = reportSchema.safeParse(outcome.report);
    check("rapporten validerar mot reportSchema", parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 2)));
    check("söksteget anropades en gång", provider.searchCalls === 1, String(provider.searchCalls));
    check("skrivsteget anropades en gång", provider.writeCalls === 1, String(provider.writeCalls));
    check("båda stegen bokförs", outcome.steps.length === 2 && outcome.steps[0].step === "search" && outcome.steps[1].step === "write");

    const summary = outcome.report.research_summary;
    check("modellens påhittade sökantal skrivs över med det verkliga", summary.searches_run === 4, String(summary.searches_run));
    check("antalet använda källor räknas i kod", summary.sources_used === outcome.report.sources.length, String(summary.sources_used));
    check("modellens påhittade källantal (77) finns inte kvar", summary.sources_used !== 77);
    check("täckningen räknas i kod till good", summary.coverage === "good", summary.coverage);
    check("anteckningen skrivs av koden", summary.notes.includes("4 sökningar") && !summary.notes.includes("Påhittad"), summary.notes);
    check(
      "underlagsraden skrivs av koden och nämner ingen källista",
      outcome.report.data_basis_note === reportDataBasisNote && !/källor|källistan/i.test(outcome.report.data_basis_note),
      outcome.report.data_basis_note,
    );
    check(
      "källorna byggs ur sökstegets träffar, med id s1–sN",
      outcome.report.sources.length === chunks.length && outcome.report.sources.every((source, index) => source.id === `s${index + 1}`),
      outcome.report.sources.map((source) => source.id).join(","),
    );
    check(
      "varje källa är en av sökningens url:er",
      outcome.report.sources.every((source) => chunks.some((chunk) => chunk.url === source.url)),
    );
    check(
      "källornas publiceringsnamn är domänen",
      outcome.report.sources.every((source, index) => source.publisher === chunks[index].domain),
    );
    check("sökningarna bokförs på söksteget", outcome.steps[0].searches === 4);
    check("skrivsteget kostar token men inga sökningar", outcome.steps[1].searches === 0 && (outcome.steps[1].input_tokens ?? 0) > 0);
    const stepCost = outcome.steps.reduce((total, step) => total + step.cost_usd, 0);
    check("kostnaden är summan av stegen", Math.abs(stepCost - outcome.costUsd) < 1e-6, `${stepCost} mot ${outcome.costUsd}`);
    check("körningen är inte markerad som omkörd", outcome.retried === false);
  } else {
    check("körningen lyckas", false, `${outcome.kind}: ${outcome.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * (b) Noll sökningar båda gångerna
 * ------------------------------------------------------------------ */

console.log("\nb) Söksteget gör noll sökningar båda gångerna");

{
  const zeroSearch: SearchResult = {
    provider: "google",
    model: "simulerad",
    text: "Jag svarade ur minnet utan att söka.",
    searches: 0,
    chunks: [],
    inputTokens: 1557,
    outputTokens: 210,
    finishReason: "STOP",
  };
  const provider = simulatedProvider({ search: [zeroSearch], write: [writeOk] });
  const outcome = await run(provider);

  check("körningen misslyckas", outcome.ok === false);
  if (!outcome.ok) {
    check("felkategorin är no_research", outcome.kind === "no_research", outcome.kind);
    check("maskinkoden är NO_RESEARCH", outcome.code === "NO_RESEARCH", outcome.code);
    check("exakt två sökförsök gjordes", provider.searchCalls === 2, String(provider.searchCalls));
    check("skrivsteget kördes aldrig", provider.writeCalls === 0, String(provider.writeCalls));
    check("båda försöken sparas med steget sök", outcome.failure.attempts.length === 2 && outcome.failure.attempts.every((attempt) => attempt.stage === "search"));
    check("inget försök gäller skrivsteget", outcome.failure.attempts.every((attempt) => attempt.stage !== "write"));
    check("båda sökförsöken bokförs som steg", outcome.failure.steps?.length === 2, String(outcome.failure.steps?.length));
    check("felet beskriver att sökverktyget inte användes", outcome.failure.summary.includes("0 sökningar"), outcome.failure.summary);
    check("tiden och token för misslyckade anrop sparas", (outcome.failure.input_tokens_total ?? 0) > 0, String(outcome.failure.input_tokens_total));
    check("felspåret kan läsas tillbaka av /admin", parseFailureMeta(outcome.failure) !== null);
    check(
      "meddelandet som skickades sparas på varje sökförsök",
      outcome.failure.attempts.every((attempt) => (attempt.request_excerpt ?? "").includes("FORDONSUPPGIFTER")),
      outcome.failure.attempts.map((attempt) => attempt.request_excerpt?.slice(0, 40) ?? "saknas").join(" | "),
    );
    check(
      "bilens uppgifter fanns med i båda sökförsöken",
      provider.searchRequests.every((request) => JSON.stringify(vehicleJsonIn(request.userMessage)).includes("Testbil")),
    );
  }
}

/* ------------------------------------------------------------------ *
 * (c) Noll sökningar första gången, sökning andra
 * ------------------------------------------------------------------ */

console.log("\nc) Första försöket söker inte, det andra gör det");

{
  const zeroSearch: SearchResult = {
    provider: "google",
    model: "simulerad",
    text: "Svar ur minnet.",
    searches: 0,
    chunks: [],
    inputTokens: 1500,
    outputTokens: 100,
    finishReason: "STOP",
  };
  const provider = simulatedProvider({ search: [zeroSearch, searchOk(3)], write: [writeOk] });
  const outcome = await run(provider);

  check("körningen lyckas efter omförsöket", outcome.ok === true, outcome.ok ? "" : `${outcome.kind}: ${outcome.message}`);
  check("exakt två sökförsök gjordes", provider.searchCalls === 2, String(provider.searchCalls));
  check("skrivsteget kördes en gång", provider.writeCalls === 1, String(provider.writeCalls));

  if (outcome.ok) {
    check("sökningarna kommer från det andra försöket", outcome.report.research_summary.searches_run === 3, String(outcome.report.research_summary.searches_run));
    check("körningen är markerad som omkörd", outcome.retried === true);
    check(
      "det misslyckade första försöket syns ändå i bokföringen",
      outcome.steps.filter((step) => step.step === "search").length === 2,
      String(outcome.steps.filter((step) => step.step === "search").length),
    );
    check(
      "båda sökförsöken räknas in i kostnaden",
      outcome.costUsd > outcome.steps[outcome.steps.length - 1].cost_usd,
    );
    check("rapporten validerar", reportSchema.safeParse(outcome.report).success);
  }
}

/* ------------------------------------------------------------------ *
 * (d) Tidsgräns
 * ------------------------------------------------------------------ */

console.log("\nd) Tidsgränsen slår till");

{
  const provider = simulatedProvider({
    search: [new ProviderError("RESEARCH_TIMEOUT", "Google-sökningen avbröts efter 90 s av tidsgränsen för steget.", { kind: "timeout" })],
    write: [writeOk],
  });
  const outcome = await run(provider);

  check("körningen misslyckas", outcome.ok === false);
  if (!outcome.ok) {
    check("felkategorin är timeout", outcome.kind === "timeout", outcome.kind);
    check("maskinkoden är TIMEOUT", outcome.code === "TIMEOUT", outcome.code);
    check("söksteget görs om högst en gång", provider.searchCalls === 1, String(provider.searchCalls));
    check("skrivsteget körs aldrig efter en tidsgräns i steg 1", provider.writeCalls === 0, String(provider.writeCalls));
    check("försöket sparas med steget sök", outcome.failure.attempts[0]?.stage === "search");
    check("felet förklaras med tidsgränsen", outcome.failure.summary.includes("Tidsgränsen"), outcome.failure.summary);
  }
}

{
  const provider = simulatedProvider({
    search: [searchOk(4)],
    write: [new ProviderError("RESEARCH_TIMEOUT", "Google-skrivningen avbröts efter 90 s av tidsgränsen för steget.", { kind: "timeout" })],
  });
  const outcome = await run(provider);

  check("en tidsgräns i skrivsteget ger ett misslyckande", outcome.ok === false);
  if (!outcome.ok) {
    check("skrivsteget får inget nytt försök vid tidsgräns", provider.writeCalls === 1, String(provider.writeCalls));
    check("försöket sparas med steget skriv", outcome.failure.attempts[0]?.stage === "write", outcome.failure.attempts[0]?.stage ?? "saknas");
    check("sökstegets kostnad finns kvar i felspåret", (outcome.failure.steps ?? []).some((step) => step.step === "search" && step.searches === 4));
    check(
      "felspåret räknar in båda stegen i kostnaden",
      (outcome.failure.cost_sek_total ?? 0) > 0,
      String(outcome.failure.cost_sek_total),
    );
    check("felet säger att det gällde skrivsteget", outcome.failure.summary.includes("Tidsgränsen"), outcome.failure.summary);
  }
}

/* ------------------------------------------------------------------ *
 * (e) Indata med tomma fält, mellanslag och saknat miltal
 * ------------------------------------------------------------------ */

console.log("\ne) Bilens uppgifter följer med i både sök- och skrivsteget");

{
  /* Medvetet ostädad indata: mellanslag runt märke och modell, ett drivningsvärde
     som inte är ett av de vanliga och inget miltal. Inget av det får göra att
     bilens uppgifter tappas bort på vägen. */
  const sparse: Vehicle = {
    make: " Audi ",
    model: " A6 ",
    year: 2019,
    engine: "2,0 TDI",
    gearbox: "Automat",
    drivetrain: "Vet ej",
    mileage_km: null,
  };
  const provider = simulatedProvider({ search: [searchOk(3)], write: [writeOk] });
  const outcome = await run(provider, { vehicle: sparse });

  check("körningen lyckas med gles indata", outcome.ok === true, outcome.ok ? "" : `${outcome.kind}: ${outcome.message}`);
  check("söksteget anropades", provider.searchRequests.length === 1, String(provider.searchRequests.length));

  const searchJson = provider.searchRequests[0]
    ? (vehicleJsonIn(provider.searchRequests[0].userMessage) as { vehicle?: Record<string, unknown> } | null)
    : null;
  check("söksteget fick bilens JSON", searchJson !== null, provider.searchRequests[0]?.userMessage.slice(0, 120) ?? "inget meddelande");
  check(
    "mellanslag i modellnamnet finns kvar i det som skickades",
    searchJson?.vehicle?.model === " A6 ",
    JSON.stringify(searchJson?.vehicle?.model),
  );
  check("märket skickas med", searchJson?.vehicle?.make === " Audi ", JSON.stringify(searchJson?.vehicle?.make));
  check("saknat miltal skickas som null", searchJson?.vehicle?.mileage_km === null, JSON.stringify(searchJson?.vehicle?.mileage_km));
  check(
    "ett tomt fält skickas som tomt värde, inte bortglömt",
    buildSearchUserMessage({ ...sparse, engine: "" }).includes('"engine":""') &&
      buildSearchUserMessage({ ...sparse, engine: "" }).includes('"mileage_km":null'),
    buildSearchUserMessage({ ...sparse, engine: "" }).slice(-160),
  );
  check(
    "växellåda, drivning och årsmodell följer med",
    searchJson?.vehicle?.gearbox === "Automat" && searchJson?.vehicle?.drivetrain === "Vet ej" && searchJson?.vehicle?.year === 2019,
    JSON.stringify(searchJson?.vehicle),
  );

  const writeJson = provider.writeRequests[0]
    ? (vehicleJsonIn(provider.writeRequests[0].userMessage) as { vehicle?: Record<string, unknown> } | null)
    : null;
  check("skrivsteget fick samma biluppgifter", writeJson?.vehicle?.model === " A6 ", JSON.stringify(writeJson?.vehicle?.model));
  check(
    "skrivsteget fick bilen tillsammans med fynd och källor",
    writeJson !== null && (provider.writeRequests[0]?.userMessage ?? "").includes("\"sources\""),
  );
}

/* ------------------------------------------------------------------ *
 * (f) Modellen ber om bilens uppgifter
 * ------------------------------------------------------------------ */

console.log("\nf) Modellen svarar med att be om bilens uppgifter");

{
  const asking: SearchResult = {
    provider: "google",
    model: "simulerad",
    text: "Jag väntar på bilens uppgifter. Klistra in fordonsuppgifterna (JSON) så söker jag.",
    searches: 0,
    chunks: [],
    inputTokens: 600,
    outputTokens: 120,
    finishReason: "STOP",
  };
  const provider = simulatedProvider({ search: [asking], write: [writeOk] });
  const outcome = await run(provider);

  check("körningen misslyckas", outcome.ok === false);
  if (!outcome.ok) {
    check("felkategorin är input_not_delivered", outcome.kind === "input_not_delivered", outcome.kind);
    check("maskinkoden är INPUT_NOT_DELIVERED", outcome.code === "INPUT_NOT_DELIVERED", outcome.code);
    check("inget omförsök görs", provider.searchCalls === 1, String(provider.searchCalls));
    check("skrivsteget körs aldrig", provider.writeCalls === 0, String(provider.writeCalls));
    check("bara ett försök sparas", outcome.failure.attempts.length === 1, String(outcome.failure.attempts.length));
    check("försöket har rätt kategori", outcome.failure.attempts[0]?.kind === "input_not_delivered", outcome.failure.attempts[0]?.kind ?? "saknas");
    check(
      "felet säger att modellen bad om uppgifterna",
      outcome.failure.summary.includes("be om bilens uppgifter"),
      outcome.failure.summary,
    );
    check(
      "meddelandet som skickades visar att bilen faktiskt fanns med",
      (outcome.failure.attempts[0]?.request_excerpt ?? "").includes("Testbil") &&
        (outcome.failure.attempts[0]?.request_excerpt ?? "").includes("FORDONSUPPGIFTER"),
      (outcome.failure.attempts[0]?.request_excerpt ?? "saknas").slice(0, 120),
    );
    check("meddelandet kortas till 1500 tecken", (outcome.failure.attempts[0]?.request_excerpt ?? "").length <= 1500);
    check("felspåret kan läsas tillbaka av /admin", parseFailureMeta(outcome.failure) !== null);
  }
}

/* ------------------------------------------------------------------ *
 * (g) Omdirigeringslänkar med olika titlar
 * ------------------------------------------------------------------ */

console.log("\ng) Sju omdirigeringslänkar ger sju utgivare");

{
  /* Googles sökgrounding returnerar nästan alltid träffarna som
     vertexaisearch.cloud.google.com/grounding-api-redirect/… . Den riktiga
     sajten står bara i web.title. Här simuleras exakt det: sju olika sajter,
     sju olika titlar och samma omdirigeringsvärd. */
  const redirectBase = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/";
  const realDomains = [
    "bobistheoilguy.com",
    "saabwisonline.com",
    "verkstadstidningen.se",
    "agarsidan.se",
    "besiktningsbloggen.se",
    "mekanikern.se",
    "reservdelsguiden.se",
  ];

  check(
    "titeln blir utgivare när url:en är en omdirigering",
    realDomains.every(
      (domain, index) =>
        resolveChunkDomain({ uri: `${redirectBase}${index}`, title: domain }) === domain,
    ),
    realDomains.map((domain, index) => resolveChunkDomain({ uri: `${redirectBase}${index}`, title: domain })).join(", "),
  );
  check(
    "domänen läses även ur en sidtitel med domänen sist, utan www och skiftläge",
    resolveChunkDomain({ uri: `${redirectBase}x`, title: "Tråd om vevhusventilation – WWW.SAABWISONLINE.COM" }) === "saabwisonline.com",
  );
  check(
    "www räknas bort så att samma sajt inte blir två utgivare",
    resolveChunkDomain({ uri: `${redirectBase}x`, title: "www.bobistheoilguy.com" }) === "bobistheoilguy.com" &&
      resolveChunkDomain({ uri: `${redirectBase}y`, title: "bobistheoilguy.com" }) === "bobistheoilguy.com",
  );
  check(
    "en titel som är en url ger också rätt domän",
    resolveChunkDomain({ uri: `${redirectBase}x`, title: "https://www.mekanikern.se/oljebyte" }) === "mekanikern.se",
  );
  check(
    "omdirigeringsvärden blir aldrig utgivare när titeln saknar domän",
    resolveChunkDomain({ uri: `${redirectBase}x` }) === "",
    resolveChunkDomain({ uri: `${redirectBase}x` }),
  );
  check(
    "en vanlig url utan titel ger fortfarande sitt värdnamn",
    resolveChunkDomain({ uri: "https://www.verkstadstidningen.se/artikel" }) === "verkstadstidningen.se",
  );

  const redirectChunks = realDomains.map((domain, index) =>
    groundingChunkFromWeb({
      uri: `${redirectBase}${index}abc`,
      title: index === 1 ? `Tråd om vevhusventilation – ${domain.toUpperCase()}` : domain,
    }),
  );
  check("alla sju träffarna blir källträffar", redirectChunks.every((chunk) => chunk !== null));
  check(
    "varje träff får sin riktiga domän",
    redirectChunks.every((chunk, index) => chunk?.domain === realDomains[index]),
    redirectChunks.map((chunk) => chunk?.domain ?? "saknas").join(", "),
  );

  /* Modellens svar: sju punkter som tillsammans hänvisar till alla sju källor.
     Punkt 1 påstår "väldokumenterad" och vilar på två olika utgivare – den ska
     stå kvar. Punkt 6 påstår samma sak men vilar på en enda källa – den ska
     nedgraderas. */
  const answer = modelAnswer() as unknown as {
    known_issues: Array<Record<string, unknown>>;
  };
  answer.known_issues.forEach((issue, index) => {
    issue.source_ids = index === 5 ? ["s7"] : [`s${index + 1}`, `s${index + 2}`];
    issue.confidence = index === 0 || index === 5 ? "well_documented" : "reported";
  });

  const provider = simulatedProvider({
    search: [{ ...searchOk(5), chunks: redirectChunks.filter((chunk): chunk is GroundingChunk => chunk !== null) }],
    write: [{ ...writeOk, text: JSON.stringify(answer) }],
  });
  const outcome = await run(provider);

  check("körningen lyckas", outcome.ok === true, outcome.ok ? "" : `${outcome.kind}: ${outcome.message}`);
  if (outcome.ok) {
    const publishers = outcome.report.sources.map((source) => source.publisher);
    check("alla sju källorna finns kvar", outcome.report.sources.length === 7, String(outcome.report.sources.length));
    check(
      "utgivaren är den riktiga domänen, inte omdirigeringsvärden",
      publishers.every((publisher, index) => publisher === realDomains[index]),
      publishers.join(", "),
    );
    check(
      "inga källor får Googles omdirigeringsvärd som utgivare",
      !publishers.some((publisher) => publisher.includes("vertexaisearch") || publisher.includes("googleusercontent")),
    );
    check("sju distinkta utgivare räknas", new Set(publishers).size === 7, String(new Set(publishers).size));
    check(
      "täckningen blir Bra med sju punkter och sju utgivare",
      outcome.report.research_summary.coverage === "good",
      outcome.report.research_summary.coverage,
    );
    check(
      "sammanfattningsraden räknar sju källor från sju utgivare",
      outcome.report.research_summary.notes.includes("7 källor från 7 oberoende utgivare"),
      outcome.report.research_summary.notes,
    );
    check(
      "väldokumenterad står kvar när två olika utgivare bär punkten",
      outcome.report.known_issues[0]?.confidence === "well_documented",
      outcome.report.known_issues[0]?.confidence ?? "saknas",
    );
    check(
      "väldokumenterad nedgraderas när bara en utgivare bär punkten",
      outcome.report.known_issues[5]?.confidence === "reported",
      outcome.report.known_issues[5]?.confidence ?? "saknas",
    );
  }
}

console.log(failures === 0 ? "\nAlla kontroller passerade." : `\n${failures} kontroll(er) misslyckades.`);
process.exit(failures === 0 ? 0 : 1);
