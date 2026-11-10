import { reportDataBasisNote, reportSchema, type Coverage, type Report, type Source } from "../lib/report";

/**
 * Programmatiska kvalitetskontroller för en Bilköpsrapport.
 *
 * Modellen är aldrig betrodd att upprätthålla reglerna själv. Den här modulen
 * tar modellens JSON, städar den och kontrollerar den i kod innan rapporten får
 * sparas eller visas:
 *
 *  1. Källor med fel protokoll, dubblerad url eller dubblerat id tas bort.
 *      Källor som skickas in från koden (sökstegets egna träffar) ersätter
 *      alltid modellens sources-fält: modellen får bara hänvisa till id:n.
 *  2. Punkter som inte längre har någon kvarvarande källa tas bort.
 *  3. "well_documented" nedgraderas till "reported" när underlaget inte bär det.
 *  4. Källor som ingen kvarvarande punkt hänvisar till tas bort.
 *  5. Källor som inte går att koppla till sökverktygets egna träffar tas bort: en
 *     url som modellen har skrivit ur minnet är ingen källa. Punkter som bara
 *     hänvisade till sådana källor försvinner med dem, och kvarstår inget
 *     sökunderlag alls kastas svaret med kategorin "no_research".
 *  6. research_summary skrivs alltid om i kod: searches_run och sources_used är
 *     de verkliga siffrorna från söksteget, coverage räknas ur de överlevande
 *     punkterna och notes byggs ur samma siffror. Modellens egna värden sparas
 *     aldrig.
 *  7. Högst 25 % av punkterna/frågorna får vara allmänna (variant_specific=false).
 *  8. Alla id:n kortas ned server-side till s1–sN, i1–iN och c1–cN och
 *     source_ids mappas om, så att ett långt eller märkligt id från modellen
 *     aldrig kan fälla en annars giltig rapport.
 *  9. Resultatet valideras mot reportSchema – ett ogiltigt svar kastas i stället
 *     för att sparas.
 *
 * Modulen är avsiktligt ren: ingen nätverksåtkomst, inga Convex-anrop och inga
 * miljövariabler. Den kan därför testas direkt.
 */

/* ------------------------------------------------------------------ *
 * HTML-sanering
 * ------------------------------------------------------------------ */

const htmlTagPattern = /<[^>]*>/g;
const htmlEntityPattern = /&(#\d+|[a-z]+);/gi;

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
};

/**
 * Tar bort HTML från en sträng och normaliserar blanksteg.
 *
 * Entiteter avkodas först, därefter tas allt som ser ut som en tagg bort. Det
 * gör att även `&lt;script&gt;` försvinner i stället för att bli en tagg senare.
 * Innehållet renderas aldrig som HTML, men texten ska ändå vara ren.
 */
export function stripHtml(value: string): string {
  const decoded = value.replace(htmlEntityPattern, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key in namedEntities) return namedEntities[key];
    if (key.startsWith("#")) {
      const code = Number(key.slice(1));
      if (Number.isInteger(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
    }
    return match;
  });

  return decoded.replace(htmlTagPattern, " ").replace(/\s+/g, " ").trim();
}

/** Kör {@link stripHtml} på varje sträng i en array eller ett enkelt objekt. */
export function stripHtmlDeep<T>(value: T): T {
  if (typeof value === "string") return stripHtml(value) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => stripHtmlDeep(entry)) as unknown as T;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = stripHtmlDeep(entry);
    }
    return result as unknown as T;
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * Url-normalisering
 * ------------------------------------------------------------------ */

/**
 * Normaliserar en url för jämförelse mot sökresultaten: gemener, ingen
 * query, ingen fragmentdel och ingen avslutande snedstreck.
 */
export function normaliseSourceUrl(url: string): string {
  const trimmed = url.trim();
  const withoutProtocol = trimmed.replace(/^https?:\/\//i, "");
  const withoutFragment = withoutProtocol.split("#")[0];
  const withoutQuery = withoutFragment.split("?")[0];
  return withoutQuery.replace(/\/+$/, "").toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Typer
 * ------------------------------------------------------------------ */

export type QualityCheckOptions = {
  /** Url:er som faktiskt kom från sökverktyget, för spårbarhet. */
  verifiedSourceUrls?: readonly string[];
  /**
   * Källor byggda i kod ur sökstegets källträffar. När listan finns ersätter
   * den modellens eget sources-fält helt: modellen får bara hänvisa till id:n,
   * aldrig skapa en källa.
   */
  sources?: readonly Source[];
  /** Verkligt antal sökningar som söksteget gjorde. */
  searchesRun?: number;
};

export type QualityCheckResult = {
  /** Städad och schemagiltig rapport, redo att sparas. */
  report: Report;
  /** Korta svenska noteringar om varje ändring. Tom när inget ändrades. */
  notes: string[];
  droppedIssues: number;
  droppedSources: number;
  downgradedIssues: number;
  trimmedChecklist: number;
  trimmedQuestions: number;
  /** Källor som inte kunde matchas mot sökresultaten. De tas aldrig bort här. */
  unverifiedSourceUrls: string[];
};

/**
 * Kastas när svaret inte går att rädda.
 *
 * `kind` skiljer på formatfel och innehållsfel, eftersom pipelinen bara gör ett
 * nytt försök när formatet var fel: ett svar som går att läsa men underkänns på
 * innehåll blir inte bättre av att sökas fram en gång till. "no_research" är
 * det tredje läget: svaret gick att läsa, men det finns inget sökunderlag kvar
 * att bygga rapporten på, och då är ett nytt försök bortkastat.
 */
export class QualityCheckError extends Error {
  readonly issues: string[];
  readonly kind: "schema" | "quality" | "no_research";

  constructor(issues: string[], kind: "schema" | "quality" | "no_research" = "quality") {
    super(`Rapporten klarade inte kvalitetskontrollerna: ${issues.join("; ")}`);
    this.name = "QualityCheckError";
    this.issues = issues;
    this.kind = kind;
  }
}

/**
 * Löst typad intern vy av modellens JSON.
 *
 * Fälten är `unknown` med flit: innehållet är otrusted data som först i slutet av
 * funktionen blir en typad `Report`. Inga `any` behövs för det.
 */
type LooseSource = Record<string, unknown> & { id?: unknown; url?: unknown; publisher?: unknown; source_type?: unknown };
type LooseIssue = Record<string, unknown> & { source_ids?: unknown; confidence?: unknown };
type LooseItem = Record<string, unknown> & { variant_specific?: unknown };
type LooseReport = Record<string, unknown> & {
  sources?: unknown;
  known_issues?: unknown;
  checklist?: unknown;
  seller_questions?: unknown;
  research_summary?: unknown;
};

function fail(issues: string[], kind: "schema" | "quality" | "no_research" = "quality"): never {
  throw new QualityCheckError(issues, kind);
}

/**
 * Utgivarens nyckel vid räkning av oberoende utgivare.
 *
 * Två källor från samma sajt är en utgivare, oavsett om den skrivs med www,
 * versaler eller som en url. Källorna får sin utgivare ur sökningens riktiga
 * domän, så nyckeln är normalt redan ett rent värdnamn – normaliseringen här
 * skyddar mot modellskrivna källor och äldre rapporter.
 */
function publisherKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

/** Djup kopia av modellens JSON så att inget muteras på plats. */
function cloneReport(raw: unknown): LooseReport {
  try {
    return JSON.parse(JSON.stringify(raw)) as LooseReport;
  } catch {
    return fail(["Svaret kunde inte läsas som JSON."], "schema");
  }
}

/* ------------------------------------------------------------------ *
 * Huvudfunktionen
 * ------------------------------------------------------------------ */

const variantSpecificGeneralShare = 0.25;

/**
 * Hur många allmänna poster som får finnas kvar när listan trimmas.
 *
 * Regeln gäller den lista som faktiskt sparas: g ≤ 0,25 · (s + g) är samma sak
 * som g ≤ s / 3. Antalet räknas därför ur antalet variant-specifika poster,
 * inte ur modellens ursprungliga lista.
 */
function generalAllowance(specificCount: number): number {
  return Math.floor((specificCount * variantSpecificGeneralShare) / (1 - variantSpecificGeneralShare));
}

/**
 * Kör alla kontroller på modellens råa JSON.
 *
 * Returnerar en städad rapport som garanterat passerar `reportSchema`, eller
 * kastar {@link QualityCheckError} när svaret inte går att rädda.
 */
export function applyQualityChecks(input: { report: unknown; options?: QualityCheckOptions }): QualityCheckResult {
  const raw = input.report;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(["Svaret är inte ett JSON-objekt."], "schema");
  }

  /* Egen djup kopia: modellens objekt får aldrig muteras på plats. */
  const candidate = cloneReport(raw);

  const structuralIssues: string[] = [];
  const codeSources = input.options?.sources;
  if (!Array.isArray(candidate.sources) && !codeSources) structuralIssues.push("sources saknas eller är inte en lista.");
  if (!Array.isArray(candidate.known_issues)) structuralIssues.push("known_issues saknas eller är inte en lista.");
  if (!Array.isArray(candidate.checklist)) structuralIssues.push("checklist saknas eller är inte en lista.");
  if (!Array.isArray(candidate.seller_questions)) structuralIssues.push("seller_questions saknas eller är inte en lista.");
  /* research_summary skrivs alltid om i kod när söksteget har rapporterat sina
     siffror. Saknas fältet då är det inget skäl att fälla en annars giltig
     rapport – det fylls i nedan. */
  const summaryWrittenInCode = typeof input.options?.searchesRun === "number";
  if ((!candidate.research_summary || typeof candidate.research_summary !== "object") && !summaryWrittenInCode) {
    structuralIssues.push("research_summary saknas.");
  }
  if (structuralIssues.length > 0) fail(structuralIssues, "schema");

  /* All text städas från HTML innan något annat tittar på den. */
  const cleaned = stripHtmlDeep(candidate as Record<string, unknown>) as LooseReport;

  /* Källor byggs alltid i kod ur sökstegets källträffar när de finns. Modellens
     eget sources-fält ignoreras då helt: en url som modellen har skrivit själv
     är ingen källa, och det ska inte ens vara möjligt att få med en. */
  const chunkSourceCount = codeSources?.length ?? null;
  if (codeSources) {
    cleaned.sources = codeSources.map((source) => ({ ...source }));
  }
  if (summaryWrittenInCode) {
    const existing = cleaned.research_summary;
    cleaned.research_summary = existing && typeof existing === "object" ? existing : {};
  }

  const notes: string[] = [];
  let droppedSources = 0;
  let droppedIssues = 0;
  let downgradedIssues = 0;
  let trimmedChecklist = 0;
  let trimmedQuestions = 0;

  /* 1. Källor: https, unik url och unikt id. */
  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();
  const survivingSources: LooseSource[] = [];
  for (const entry of cleaned.sources as LooseSource[]) {
    const url = typeof entry?.url === "string" ? entry.url.trim() : "";
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!url.startsWith("https://") || !id || seenUrls.has(url) || seenIds.has(id)) {
      droppedSources += 1;
      continue;
    }
    seenUrls.add(url);
    seenIds.add(id);
    survivingSources.push({ ...entry, id, url });
  }
  if (droppedSources > 0) {
    notes.push(`${droppedSources} ${droppedSources === 1 ? "källa" : "källor"} togs bort (dubblerad eller ogiltig url/id).`);
  }

  const sourcesById = new Map(survivingSources.map((source): [string, LooseSource] => [source.id as string, source]));

  /* 2. Punkter utan kvarvarande källa tas bort. */
  let survivingIssues: LooseIssue[] = [];
  for (const entry of cleaned.known_issues as LooseIssue[]) {
    const cited = Array.isArray(entry?.source_ids)
      ? (entry.source_ids as unknown[]).filter((id): id is string => typeof id === "string" && sourcesById.has(id))
      : [];
    if (cited.length === 0) {
      droppedIssues += 1;
      continue;
    }
    survivingIssues.push({ ...entry, source_ids: cited });
  }
  if (droppedIssues > 0) {
    notes.push(`${droppedIssues} ${droppedIssues === 1 ? "punkt" : "punkter"} togs bort eftersom de saknade källor.`);
  }
  if (survivingIssues.length === 0) {
    fail(["Ingen punkt har en källa som finns i sources."]);
  }

  /* 3. "well_documented" kräver två utgivare eller en officiell/statistisk källa. */
  for (const issue of survivingIssues) {
    if (issue.confidence !== "well_documented") continue;
    const cited = (issue.source_ids as string[]).map((id) => sourcesById.get(id)).filter((source): source is LooseSource => Boolean(source));
    const publishers = new Set(cited.map((source) => publisherKey(source.publisher)).filter(Boolean));
    const hasPrimarySource = cited.some((source) => source.source_type === "official" || source.source_type === "statistics");
    if (!hasPrimarySource && publishers.size < 2) {
      issue.confidence = "reported";
      downgradedIssues += 1;
    }
  }
  if (downgradedIssues > 0) {
    notes.push(
      `${downgradedIssues} ${downgradedIssues === 1 ? "punkt" : "punkter"} nedgraderades från "väldokumenterat" till "rapporterat" eftersom underlaget inte bär den nivån.`,
    );
  }

  /* 4. Endast källor som en kvarvarande punkt hänvisar till behålls, sorterade efter första hänvisning. */
  const citedOrder: string[] = [];
  for (const issue of survivingIssues) {
    for (const id of issue.source_ids as string[]) {
      if (!citedOrder.includes(id)) citedOrder.push(id);
    }
  }
  let citedSources = citedOrder.map((id) => sourcesById.get(id)).filter((source): source is LooseSource => Boolean(source));
  droppedSources += survivingSources.length - citedSources.length;
  if (survivingSources.length - citedSources.length > 0) {
    notes.push(
      `${survivingSources.length - citedSources.length} ${survivingSources.length - citedSources.length === 1 ? "källa" : "källor"} togs bort eftersom ingen punkt hänvisade till dem.`,
    );
  }

  /* 4b. Källor som inte går att koppla till sökverktygets träffar tas bort.
     Modellen kan skriva en trovärdig url ur minnet; en sådan url är ingen källa,
     och en punkt som bara vilar på den försvinner med den. Finns inget kvar att
     bygga på alls är svaret inte en rapport utan ett forskningsmisslyckande. */
  const traceable = keepTraceableSources({
    sources: citedSources,
    issues: survivingIssues,
    verified: input.options?.verifiedSourceUrls,
  });
  const unverifiedSourceUrls = traceable.unverifiedUrls;
  if (unverifiedSourceUrls.length > 0) {
    notes.push(
      `${unverifiedSourceUrls.length} ${unverifiedSourceUrls.length === 1 ? "källa" : "källor"} kunde inte kopplas till sökresultaten och togs bort.`,
    );
  }
  const issuesLostWithSources = survivingIssues.length - traceable.issues.length;
  if (issuesLostWithSources > 0) {
    notes.push(
      `${issuesLostWithSources} ${issuesLostWithSources === 1 ? "punkt" : "punkter"} togs bort eftersom källan inte kunde kopplas till sökresultaten.`,
    );
  }
  citedSources = traceable.sources;
  survivingIssues = traceable.issues;
  if (survivingIssues.length === 0 || citedSources.length === 0) {
    fail(
      ["Ingen källa i svaret kunde kopplas till sökverktygets träffar – rapporten saknar då underlag."],
      "no_research",
    );
  }

  /* 5. Sökstatistik och täckning sätts alltid i kod, aldrig av modellen.

     Modellen kan inte veta hur många sökningar som faktiskt gjordes eller vilka
     källor sökningen returnerade – den ser bara sin egen prompt. Därför skrivs
     searches_run, sources_used, coverage och notes över med de verkliga
     värdena, oavsett vad modellen skrev. */
  const publishers = new Set(citedSources.map((source) => publisherKey(source.publisher)).filter(Boolean));
  const hasPrimarySource = citedSources.some((source) => source.source_type === "official" || source.source_type === "statistics");
  const issueCount = survivingIssues.length;
  const hasSourceSupport = publishers.size >= 2 || hasPrimarySource;
  const coverage: Coverage = issueCount < 3 ? "thin" : issueCount >= 6 && hasSourceSupport ? "good" : "partial";

  const researchSummary = cleaned.research_summary as Record<string, unknown>;
  const previousCoverage = researchSummary.coverage;
  const previousSourcesUsed = researchSummary.sources_used;
  const previousSearches = researchSummary.searches_run;
  const searchesRun =
    typeof input.options?.searchesRun === "number"
      ? Math.max(0, Math.trunc(input.options.searchesRun))
      : Number.isFinite(previousSearches)
        ? Math.max(0, Math.trunc(Number(previousSearches)))
        : 0;

  const coverageText: Record<Coverage, string> = {
    good: "Bra",
    partial: "Delvis",
    thin: "Tunt",
  };
  const pool = chunkSourceCount ?? citedSources.length;
  researchSummary.coverage = coverage;
  researchSummary.sources_used = citedSources.length;
  researchSummary.searches_run = searchesRun;
  researchSummary.notes =
    `Söksteget gjorde ${searchesRun} ${searchesRun === 1 ? "sökning" : "sökningar"} och gav ${pool} ${pool === 1 ? "källänk" : "källänkar"}. ` +
    `${issueCount} ${issueCount === 1 ? "punkt vilar" : "punkter vilar"} på ${citedSources.length} ${citedSources.length === 1 ? "källa" : "källor"} från ${publishers.size} ${publishers.size === 1 ? "utgivare" : "oberoende utgivare"}. ` +
    `Täckningen sattes i kod till "${coverageText[coverage]}" utifrån det. ` +
    "Siffrorna kommer från sökningen och har inte skrivits av modellen.";

  if (previousCoverage !== undefined && previousCoverage !== coverage) {
    notes.push(`Underlagets täckning sattes om i kod till "${coverage}" utifrån ${issueCount} kvarvarande punkter.`);
  }
  if (previousSourcesUsed !== undefined && previousSourcesUsed !== citedSources.length) {
    notes.push(`Antalet använda källor räknades om i kod till ${citedSources.length}.`);
  }
  if (previousSearches !== undefined && previousSearches !== searchesRun) {
    notes.push(
      `Modellens uppgift om ${String(previousSearches)} sökningar skrevs över med det verkliga antalet (${searchesRun}).`,
    );
  }

  /* 6. Högst 25 % allmänna punkter, separat för checklista och säljarfrågor. */
  const checklist = limitGeneralItems(cleaned.checklist as LooseItem[]);
  trimmedChecklist = checklist.removed;
  if (checklist.removed > 0) {
    notes.push(`${checklist.removed} allmänna punkter togs bort ur checklistan för att hålla andelen variant-specifika punkter hög.`);
  }

  const questions = limitGeneralItems(cleaned.seller_questions as LooseItem[]);
  trimmedQuestions = questions.removed;
  if (questions.removed > 0) {
    notes.push(`${questions.removed} allmänna frågor togs bort för att hålla andelen variant-specifika frågor hög.`);
  }

  /* Granskningsstatus sätts alltid av oss, aldrig av modellen, och alla id:n
     kortas ned så att de alltid ryms i kontraktet. */
  const renamed = renameIdentifiers({ sources: citedSources, issues: survivingIssues, checklist: checklist.items });
  if (renamed.longIds > 0) {
    notes.push(
      `${renamed.longIds} ${renamed.longIds === 1 ? "id" : "id:n"} var för långt eller hade fel tecken och kortades server-side till i1–iN, s1–sN och c1–cN.`,
    );
  }
  cleaned.sources = renamed.sources;
  cleaned.known_issues = renamed.issues;
  cleaned.checklist = renamed.checklist;
  cleaned.seller_questions = questions.items;
  cleaned.review_status = "unreviewed";

  /* Underlagsraden ägs av oss. Kundvyn visar inga källhänvisningar, och en
     mening som hänvisar till "de listade källorna" pekar då på något läsaren
     inte ser. Texten skrivs därför alltid över med den fasta formuleringen. */
  cleaned.data_basis_note = reportDataBasisNote;

  /* 8. Slutlig validering: ett ogiltigt svar får aldrig sparas eller visas. */
  const parsed = reportSchema.safeParse(cleaned);
  if (!parsed.success) {
    fail(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "roten"}: ${issue.message}`),
      "schema",
    );
  }

  return {
    report: parsed.data,
    notes,
    droppedIssues,
    droppedSources,
    downgradedIssues,
    trimmedChecklist,
    trimmedQuestions,
    unverifiedSourceUrls,
  };
}

/**
 * Behåller alla variant-specifika punkter och trimmar de allmänna så att de
 * högst utgör 25 % av listan. Listan blir aldrig tom.
 */
function limitGeneralItems(items: LooseItem[]): { items: LooseItem[]; removed: number } {
  if (items.length === 0) return { items, removed: 0 };

  const general = items.filter((item) => item?.variant_specific === false);
  const specific = items.filter((item) => item?.variant_specific !== false);
  const allowance = generalAllowance(specific.length);

  if (general.length <= allowance) return { items, removed: 0 };

  const keptGeneral = general.slice(0, allowance);
  if (keptGeneral.length === 0 && specific.length === 0) {
    /* Hela listan var allmän och gränsen gav noll platser: behåll en post så att
       rapporten fortfarande har ett innehåll, och säg det rakt ut. */
    return { items: general.slice(0, 1), removed: general.length - 1 };
  }

  return { items: [...specific, ...keptGeneral], removed: general.length - keptGeneral.length };
}

/**
 * Behåller bara de källor som går att hitta bland sökverktygets egna träffar.
 *
 * Jämförelsen görs på normaliserad url (protokoll, query och fragment bort),
 * eftersom sökverktyget och modellen ofta skriver samma sida på lite olika sätt.
 * Utan verifieringslista (till exempel en leverantör utan sökmetadata) behålls
 * allt som redan har passerat url-kontrollen.
 */
function keepTraceableSources(input: {
  sources: readonly LooseSource[];
  issues: LooseIssue[];
  verified: readonly string[] | undefined;
}): { sources: LooseSource[]; issues: LooseIssue[]; unverifiedUrls: string[] } {
  if (!input.verified || input.verified.length === 0) {
    return { sources: [...input.sources], issues: input.issues, unverifiedUrls: [] };
  }

  const known = new Set(input.verified.map((url) => normaliseSourceUrl(url)));
  const traceable: LooseSource[] = [];
  const unverifiedUrls: string[] = [];
  for (const source of input.sources) {
    const url = String(source.url ?? "");
    if (url !== "" && known.has(normaliseSourceUrl(url))) traceable.push(source);
    else unverifiedUrls.push(url);
  }

  const keptIds = new Set(traceable.map((source) => source.id as string));
  const issues: LooseIssue[] = [];
  for (const issue of input.issues) {
    const cited = (issue.source_ids as string[]).filter((id) => keptIds.has(id));
    if (cited.length === 0) continue;
    issues.push({ ...issue, source_ids: cited });
  }

  return { sources: traceable, issues, unverifiedUrls };
}

/** Ett id som inte längre får plats i kontraktet, eller som innehåller fel tecken. */
function idNeedsRenaming(id: unknown): boolean {
  if (typeof id !== "string") return true;
  return id.length > 24 || !/^[a-z0-9][a-z0-9-]*$/.test(id);
}

/**
 * Kortar ned alla id:n server-side: s1–sN för källor, i1–iN för punkter och
 * c1–cN för checklistan, och mappar om source_ids så att hänvisningarna
 * fortfarande pekar på samma källa.
 *
 * Modellen kan skriva ett beskrivande id som "d4-oljelackage-2015-2018" eller
 * ett id med versaler. Sådana id:n får aldrig fälla en rapport som i övrigt är
 * giltig; de byts ut i stället, och antalet omskrivna id:n rapporteras.
 */
function renameIdentifiers(input: {
  sources: readonly LooseSource[];
  issues: readonly LooseIssue[];
  checklist: readonly LooseItem[];
}): { sources: LooseSource[]; issues: LooseIssue[]; checklist: LooseItem[]; longIds: number } {
  let longIds = 0;
  const sourceIds = new Map<string, string>();

  const sources = input.sources.map((source, index) => {
    const id = `s${index + 1}`;
    if (idNeedsRenaming(source.id)) longIds += 1;
    sourceIds.set(String(source.id ?? ""), id);
    return { ...source, id };
  });

  const issues = input.issues.map((issue, index) => {
    if (idNeedsRenaming(issue.id)) longIds += 1;
    const cited = (issue.source_ids as string[]).map((old) => sourceIds.get(old) ?? old);
    return { ...issue, id: `i${index + 1}`, source_ids: cited };
  });

  const checklist = input.checklist.map((item, index) => {
    if (idNeedsRenaming(item.id)) longIds += 1;
    return { ...item, id: `c${index + 1}` };
  });

  return { sources, issues, checklist, longIds };
}
