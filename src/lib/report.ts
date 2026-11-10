import { z } from "zod";

/**
 * Kontraktet för Bilköpsrapporten ("Bilköpsrapport").
 *
 * Fältnamnen följer API:ets snake_case eftersom den här strukturen är exakt den
 * en framtida server-pipeline ska returnera: variantidentifiering → källsökning
 * → källbaserad rapport. Allt valideras med Zod innan det når gränssnittet.
 *
 * Ordregler för hela produkten (gäller även kodsträngar):
 *  - Produkten heter alltid "Bilköpsrapport".
 *  - Orden "protokoll", "besiktning" och "intyg" får bara förekomma i de
 *    avsiktliga förtydligandena "Detta är inte en besiktning" och
 *    "teknisk besiktning". Ingen annan text får antyda myndighet, godkännande
 *    eller besiktning.
 *
 * Exempeldatan i den här filen är fiktiv: bilen är påhittad, alla punkter är
 * platshållare och alla källor pekar på https://example.com/... De beskriver
 * ingen verklig bil, tillverkare eller källa.
 */

export const schemaVersion = "2.0";

/* ------------------------------------------------------------------ *
 * Grundtyper
 * ------------------------------------------------------------------ */

export const vehicleSchema = z.object({
  make: z.string().trim().min(1, "Ange bilmärke.").max(60, "Märket får vara högst 60 tecken."),
  model: z.string().trim().min(1, "Ange bilmodell.").max(60, "Modellen får vara högst 60 tecken."),
  year: z.number().int().min(1990, "Årsmodellen måste vara 1990 eller senare.").max(new Date().getFullYear(), `Årsmodellen kan inte vara senare än ${new Date().getFullYear()}.`),
  engine: z.string().trim().min(1, "Ange motor eller bränsletyp.").max(60, "Uppgiften får vara högst 60 tecken."),
  gearbox: z.enum(["Manuell", "Automat", "Vet ej"], { error: "Välj växellåda." }),
  drivetrain: z.enum(["Framhjulsdrift", "Bakhjulsdrift", "Fyrhjulsdrift", "Vet ej"], { error: "Välj drivning." }),
  mileage_km: z.number().int().min(0).max(2_000_000).nullable(),
});
export type Vehicle = z.infer<typeof vehicleSchema>;

/**
 * När i köpprocessen användaren är, enligt formuläret på startsidan. Följer med
 * förfrågan till backend men påverkar inte rapportens innehåll.
 */
export const purchaseTimingSchema = z.enum(["within_month", "later", "curious"]);
export type PurchaseTiming = z.infer<typeof purchaseTimingSchema>;

/** Exakt det underlag som backend tar emot: fordonsuppgifter plus köptidpunkt. */
export const reportRequestSchema = vehicleSchema.extend({ purchase_timing: purchaseTimingSchema });
export type ReportRequest = z.infer<typeof reportRequestSchema>;


export const riskLevelSchema = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const variantStatusSchema = z.enum(["identified", "partial", "unclear"]);
export type VariantStatus = z.infer<typeof variantStatusSchema>;

export const coverageSchema = z.enum(["good", "partial", "thin"]);
export type Coverage = z.infer<typeof coverageSchema>;

export const sourceTypeSchema = z.enum(["official", "statistics", "workshop", "media", "owner_forum", "other"]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

/**
 * Konfidensnivåer och reglerna för när de får sättas:
 *  - "well_documented": minst två oberoende källor, ELLER en officiell källa.
 *  - "reported": en trovärdig källa, eller flera samstämmiga ägarrapporter.
 *  - "uncertain": svagt, ensidigt eller motsägelsefullt underlag.
 * Nivån sätts av pipelinen.

 * Gränssnittet visar bara den nivå underlaget håller och får aldrig uppgradera
 * den. Regeln för "well_documented" kontrolleras dessutom i schemat nedan.
 */
export const confidenceSchema = z.enum(["well_documented", "reported", "uncertain"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const costBasisSchema = z.enum(["source", "estimate"]);
export type CostBasis = z.infer<typeof costBasisSchema>;

export const reviewStatusSchema = z.enum(["unreviewed", "reviewed", "removed"]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?)?$/.test(value) && !Number.isNaN(Date.parse(value));
}

/*
 * Id-regler: pipelinen kortar ned alla id:n server-side (s1–sN, i1–iN,
 * c1–cN) innan rapporten valideras, så gränsen på 64 tecken är bara ett tak för
 * att ett långt id från modellen aldrig ska kunna fälla en annars giltig
 * rapport.
 */
export const sourceSchema = z.object({
  id: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "Käll-id: gemener, siffror och bindestreck"),
  url: z.string().min(12).refine((value) => value.startsWith("https://"), "Källor måste använda https"),
  title: z.string().min(3).max(160),
  publisher: z.string().min(2).max(80),
  source_type: sourceTypeSchema,
  retrieved_at: z.string().refine(isIsoDate, "Hämtningsdatum ska vara ett ISO-datum"),
});
export type Source = z.infer<typeof sourceSchema>;

export const knownIssueSchema = z.object({
  id: z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "Punkt-id: gemener, siffror och bindestreck"),
  title: z.string().min(3).max(120),
  symptoms: z.string().min(3),
  how_to_check: z.string().min(3),
  /** Ungefär när i bilens liv punkten brukar bli aktuell. */
  typical_onset: z.string().min(3),
  applies_to: z.string().min(3),
  cost_range_sek: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }).nullable(),
  cost_basis: costBasisSchema.nullable(),
  severity: riskLevelSchema,
  safety_related: z.boolean(),
  confidence: confidenceSchema,
  evidence_summary: z.string().min(3),
  source_ids: z.array(z.string().min(2)).min(1),
});
export type KnownIssue = z.infer<typeof knownIssueSchema>;

export const checklistItemSchema = z.object({
  id: z.string().min(2).max(64),
  text: z.string().min(3),
  variant_specific: z.boolean(),
  /** Rubriken punkten hör till. Sektionernas ordning följer första förekomsten. */
  section: z.string().min(2).max(60),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const sellerQuestionSchema = z.object({
  question: z.string().min(3),
  why: z.string().min(3),
  /** Svar som bör göra att köparen går vidare eller undersöker mer. */
  red_flag_answer: z.string().min(3),
  variant_specific: z.boolean(),
});
export type SellerQuestion = z.infer<typeof sellerQuestionSchema>;

export const researchSummarySchema = z.object({
  searches_run: z.number().int().min(0).max(200),
  sources_used: z.number().int().min(0).max(200),
  coverage: coverageSchema,
  notes: z.string().min(1),
});
export type ResearchSummary = z.infer<typeof researchSummarySchema>;

export const summarySchema = z.object({
  text: z.string().min(1),
  risk_level: riskLevelSchema,
  risk_score: z.number().int().min(0).max(100),
  /** De viktigaste kontrollerna, i prioriterad ordning. */
  top_checks: z.array(z.string().min(3)).min(1),
});
export type ReportSummary = z.infer<typeof summarySchema>;

/**
 * Underlagsraden sist i rapporten. Den skrivs alltid i kod, aldrig av modellen.
 *
 * Kundvyn visar inga källhänvisningar, så texten får aldrig hänvisa till en
 * källista som läsaren inte ser. Den ska bara säga vad rapporten bygger på och
 * att den inte säger något om det enskilda exemplaret.
 */
export const reportDataBasisNote =
  "Rapporten bygger på publicerad information om den här modellen och varianten, inte på det enskilda exemplar du tittar på.";

export const reportSchema = z
  .object({
    schema_version: z.string().min(1),
    /** Referens som identifierar just den här rapporten (används även för checklistans lokala sparande). */
    report_id: z.string().min(4).max(40),
    /** När rapporten sammanställdes. */
    generated_at: z.string().refine(isIsoDate, "Genereringsdatum ska vara ett ISO-datum"),
    variant_status: variantStatusSchema,
    /** Antaganden rapporten vilar på när varianten inte är helt fastställd. */
    assumptions: z.array(z.string().min(3)),
    vehicle: vehicleSchema,
    summary: summarySchema,
    research_summary: researchSummarySchema,
    known_issues: z.array(knownIssueSchema).min(1),
    good_to_know: z.array(z.string().min(3)).min(1),
    checklist: z.array(checklistItemSchema).min(1),
    seller_questions: z.array(sellerQuestionSchema).min(1),
    documents_to_verify: z.array(z.string().min(3)).min(1),
    sources: z.array(sourceSchema).min(1),
    data_basis_note: z.string().min(3),
    disclaimer_note: z.string().min(3),
    review_status: reviewStatusSchema,
  })
  .superRefine((report, ctx) => {
    const ids = report.sources.map((source) => source.id);

    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "Käll-id måste vara unika", path: ["sources"] });
    }

    const known = new Set(ids);
    report.known_issues.forEach((issue, index) => {
      issue.source_ids.forEach((id, idIndex) => {
        if (!known.has(id)) {
          ctx.addIssue({
            code: "custom",
            message: `Källan "${id}" finns inte i sources`,
            path: ["known_issues", index, "source_ids", idIndex],
          });
        }
      });

      if (issue.confidence === "well_documented") {
        const cited = report.sources.filter((source) => issue.source_ids.includes(source.id));
        const hasOfficial = cited.some((source) => source.source_type === "official");
        if (!hasOfficial && cited.length < 2) {
          ctx.addIssue({
            code: "custom",
            message: "well_documented kräver minst två källor eller en officiell källa",
            path: ["known_issues", index, "confidence"],
          });
        }
      }

      if (issue.cost_range_sek && issue.cost_range_sek.max < issue.cost_range_sek.min) {
        ctx.addIssue({ code: "custom", message: "Kostnadsintervallet är ogiltigt", path: ["known_issues", index, "cost_range_sek"] });
      }
    });

    if (new Set(report.checklist.map((item) => item.id)).size !== report.checklist.length) {
      ctx.addIssue({ code: "custom", message: "Checklistans id måste vara unika", path: ["checklist"] });
    }
  });
export type Report = z.infer<typeof reportSchema>;

/* ------------------------------------------------------------------ *
 * Etiketter och hjälpare som delas av gränssnittet
 * ------------------------------------------------------------------ */

export const sourceTypeLabels: Record<SourceType, string> = {
  official: "Officiell källa",
  statistics: "Statistik",
  workshop: "Verkstad",
  media: "Media",
  owner_forum: "Ägarforum",
  other: "Övrigt",
};

export const coverageLabels: Record<Coverage, string> = { good: "Bra", partial: "Delvis", thin: "Tunt" };

export const coverageDescriptions: Record<Coverage, string> = {
  good: "Flera oberoende källor beskriver samma variant, och minst en av dem är officiell.",
  partial:
    "Det finns publicerad information om modellen, men bara delvis om exakt den kombination av motor, växellåda och drivning som rapporten gäller.",
  thin: "Det finns begränsat med publicerad information om just den här varianten, så punkterna är färre och mer försiktigt formulerade.",
};

export const confidenceLabels: Record<Confidence, string> = {
  well_documented: "Väldokumenterat",
  reported: "Rapporterat",
  uncertain: "Osäkert",
};

export const severityLabels: Record<RiskLevel, string> = { low: "Låg", medium: "Medel", high: "Hög" };

/** Stämpelns text. Formuleras som vår egen bedömning – aldrig som godkännande. */
export const stampTexts: Record<RiskLevel, string> = {
  low: "VÅR BEDÖMNING: LÅG RISK",
  medium: "VÅR BEDÖMNING: MEDELHÖG RISK",
  high: "VÅR BEDÖMNING: HÖG RISK",
};

/** Huvudnotisen i rapportens sidhuvud (ordagrant enligt briefen). */
export const notInspectionNotice = "Detta är inte en besiktning. Rapporten är vägledning baserad på publicerade källor.";

/** Notisen högst upp när underlaget är tunt (ordagrant enligt briefen). */
export const thinCoverageNotice =
  "Det finns begränsat med publicerad information om just den här varianten. Rapporten innehåller därför färre och mer försiktiga punkter.";

/** 1-baserat nummer för en källa, så att punkter och Källor matchar varandra. */
export function sourceNumber(sources: readonly Source[], id: string) {
  const index = sources.findIndex((source) => source.id === id);
  return index === -1 ? 0 : index + 1;
}

/** Sortering: säkerhetsrelaterade punkter först, därefter högst allvarlighetsgrad. */
const severityWeight: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

export function sortIssues(issues: readonly KnownIssue[]) {
  return [...issues].sort((a, b) => {
    if (a.safety_related !== b.safety_related) return a.safety_related ? -1 : 1;
    return severityWeight[a.severity] - severityWeight[b.severity];
  });
}

/** Punktlistans sortering: variant-specifika punkter först, i övrigt oförändrad ordning. */
export function variantSpecificFirst<T extends { variant_specific: boolean }>(items: readonly T[]) {
  return [...items].sort((a, b) => Number(b.variant_specific) - Number(a.variant_specific));
}

/** Checklistan grupperad i sektioner, i den ordning sektionerna först dyker upp. */
export function checklistSections(items: readonly ChecklistItem[]) {
  const sections: Array<{ title: string; items: ChecklistItem[] }> = [];
  for (const item of items) {
    const existing = sections.find((section) => section.title === item.section);
    if (existing) existing.items.push(item);
    else sections.push({ title: item.section, items: [item] });
  }
  return sections.map((section) => ({ title: section.title, items: variantSpecificFirst(section.items) }));
}

const sekFormatter = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" });

/** "4 000–18 000 kr", eller null när ingen uppskattning finns. */
export function formatSekRange(range: { min: number; max: number } | null) {
  if (!range) return null;
  return `${sekFormatter.format(range.min)}–${sekFormatter.format(range.max)} kr`;
}

export function formatNumber(value: number) {
  return sekFormatter.format(value);
}

export function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

/* ------------------------------------------------------------------ *
 * Exempeldata (fiktiv)
 * ------------------------------------------------------------------ */

export const sampleStates = ["good", "partial", "thin"] as const;
export type SampleState = (typeof sampleStates)[number];

export function isSampleState(value: string | null): value is SampleState {
  return value !== null && (sampleStates as readonly string[]).includes(value);
}

const sampleInput = {
  schema_version: schemaVersion,
  report_id: "EXEMPEL-0001",
  generated_at: "2028-01-01T09:00:00Z",
  variant_status: "unclear" as const,
  assumptions: [
    "Exemplet utgår från att bilen har automatväxellåda och framhjulsdrift.",
    "Exemplet utgår från att bilen använts normalt och servats löpande.",
    "Exemplet utgår från att mätarställningen stämmer.",
  ],
  vehicle: {
    make: "Exempelbil",
    model: "Modell X",
    year: 2019,
    engine: "X20 (fiktiv motor)",
    gearbox: "Automat" as const,
    drivetrain: "Framhjulsdrift" as const,
    mileage_km: 9540,
  },
  summary: {
    text: "Det här är en exempelrapport som visar hur en Bilköpsrapport är uppbyggd. Bilen, punkterna och källorna är påhittade och beskriver ingen verklig bil. Strukturen visar vilka områden som är värda att titta närmare på, vad du kan kontrollera själv och vilka frågor som är värda att ställa till säljaren.",
    risk_level: "medium" as const,
    risk_score: 42,
    top_checks: [
      "Kontrollera att serviceunderlag finns och hänger ihop med mätarställningen.",
      "Provkör både kallt och varmt och känn efter hur växellådan växlar i låg fart.",
      "Bromsa mjukt och hårt från landsvägsfart och känn efter pulser eller sneddragning.",
      "Kontrollera kupé och bagageutrymme för fukt och lukt.",
    ],
  },
  research_summary: {
    searches_run: 0,
    sources_used: 5,
    coverage: "partial" as const,
    notes:
      "Exempelsökningarna täcker modellserien brett men bara delvis just den kombination av motor, växellåda och drivning som rapporten gäller.",
  },
  known_issues: [
    {
      id: "bromsar-fram",
      title: "Slitna bromsar fram",
      symptoms: "Pulsering i bromspedalen, ojämn inbromsning eller ljud vid lätt bromsning.",
      how_to_check: "Bromsa mjukt från låg fart och därefter hårt från landsvägsfart. Känn efter pulser och sneddragning.",
      typical_onset: "Brukar bli aktuellt någon gång mellan 60 000 och 120 000 km beroende på körsätt.",
      applies_to: "Exempelbil Modell X med skivbromsar fram, alla årgångar i exemplet.",
      cost_range_sek: { min: 3500, max: 9000 },
      cost_basis: "source" as const,
      severity: "high" as const,
      safety_related: true,
      confidence: "well_documented" as const,
      evidence_summary: "Källorna beskriver samma sak: pulserande bromsar är vanligt förekommande och bör åtgärdas innan köp.",
      source_ids: ["s1", "s3"],
    },
    {
      id: "servicehistorik",
      title: "Serviceunderlag som inte går att följa",
      symptoms: "Ofullständig servicehistorik, saknade kvitton eller datum som inte stämmer med mätarställningen.",
      how_to_check: "Be om serviceunderlag och jämför datum och mätarställning mot bilens egna uppgifter.",
      typical_onset: "Gäller hela bilens liv och syns först när du begär in underlaget.",
      applies_to: "Alla exemplar i exemplet.",
      /* Ingen kostnadssiffra: luckor i historiken är en värderingsfråga, inte en reparation. */
      cost_range_sek: null,
      cost_basis: null,
      severity: "high" as const,
      safety_related: false,
      confidence: "reported" as const,
      evidence_summary: "En ägarrapport och en verkstadskälla tar båda upp att luckor i historiken försvårar bedömningen av bilens skick.",
      source_ids: ["s3", "s5"],
    },
    {
      id: "vaxellada-ryck",
      title: "Växellådan kan rycka vid låg fart",
      symptoms: "Ryck eller fördröjning vid växling i krypfart, tydligast med kall växellåda.",
      how_to_check: "Kör i krypfart med kall bil och låt växellådan växla upp och ner flera gånger.",
      typical_onset: "Rapporteras oftast från omkring 80 000 km.",
      applies_to: "Exempelbil Modell X med automatväxellåda.",
      cost_range_sek: { min: 6000, max: 24000 },
      cost_basis: "estimate" as const,
      severity: "medium" as const,
      safety_related: false,
      confidence: "well_documented" as const,
      evidence_summary: "Två oberoende källor beskriver ryckig växling i låg fart som något att provköra särskilt noga.",
      source_ids: ["s2", "s4"],
    },
    {
      id: "oljelackage",
      title: "Oljeläckage kring motorns täckningar",
      symptoms: "Spår av olja under bilen, oljelukt efter körning eller sjunkande oljenivå.",
      how_to_check: "Kontrollera motorn kall, titta under bilen och be att få se senaste oljenivå.",
      typical_onset: "Förekommer från omkring 70 000 km i de rapporter som finns.",
      applies_to: "Exempelmotorn X20 i exemplet.",
      cost_range_sek: { min: 2500, max: 11000 },
      cost_basis: "estimate" as const,
      severity: "medium" as const,
      safety_related: false,
      confidence: "reported" as const,
      evidence_summary: "Verkstadserfarenheterna beskriver läckage kring täckningarna som en återkommande åtgärd på bilar med hög körsträcka.",
      source_ids: ["s3"],
    },
    {
      id: "fukt-bagage",
      title: "Fukt i bagageutrymmet",
      symptoms: "Imma på insidan av bakrutan, unken lukt eller fuktiga mattor i bagageutrymmet.",
      how_to_check: "Lyft bagagerumsmattan och kontrollera efter fukt, lukt och missfärgning.",
      typical_onset: "Brukar komma smygande med åren när tätningar åldras.",
      applies_to: "Karossen i exemplet, oberoende av motor.",
      cost_range_sek: null,
      cost_basis: null,
      severity: "medium" as const,
      safety_related: false,
      confidence: "uncertain" as const,
      evidence_summary: "Bara en enstaka ägardiskussion tar upp detta, och inget underlag beskriver hur vanligt det är.",
      source_ids: ["s5"],
    },
    {
      id: "klimatanlaggning",
      title: "Klimatanläggningen kan tappa kyleffekt",
      symptoms: "Svag kyla på lägsta temperatur, imma som inte försvinner eller lukt vid start.",
      how_to_check: "Starta bilen kall och varm och kontrollera att kylan kommer snabbt och jämnt.",
      typical_onset: "Kan bli aktuellt närsomhelst, ofta kopplat till servicehistoriken.",
      applies_to: "Alla exemplar i exemplet.",
      cost_range_sek: { min: 1500, max: 7000 },
      cost_basis: "estimate" as const,
      severity: "low" as const,
      safety_related: false,
      confidence: "reported" as const,
      evidence_summary: "Mediekällan beskriver kontroll av klimatanläggningen som en enkel åtgärd vid provkörning.",
      source_ids: ["s4"],
    },
  ],
  good_to_know: [
    "Rapporten väger samman publicerade källor och säger inget om just det exemplar du tittar på.",
    "Ju fler uppgifter du har om bilen – motor, växellåda och drivning – desto mer träffsäker blir vägledningen.",
    "Kostnadsintervallen är grova uppskattningar om inget annat anges.",
    "Punkter med lägre säkerhet i uppgiften är formulerade mer försiktigt med flit.",
    "Ta med rapporten till visningen och bocka av checklistan på plats.",
  ],
  checklist: [
    { id: "c01", text: "Serviceunderlag finns och är läsbart", variant_specific: false, section: "Dokumentation och historik" },
    { id: "c02", text: "Servicedatum stämmer med mätarställningen", variant_specific: true, section: "Dokumentation och historik" },
    { id: "c03", text: "Antalet ägare stämmer med uppgifterna", variant_specific: false, section: "Dokumentation och historik" },
    { id: "c04", text: "Motoroljan ligger på rätt nivå och ser ren ut", variant_specific: true, section: "Motor och vätskor" },
    { id: "c05", text: "Kylarvätskan har rätt nivå och färg", variant_specific: true, section: "Motor och vätskor" },
    { id: "c06", text: "Inga spår av läckage under motor och växellåda", variant_specific: true, section: "Motor och vätskor" },
    { id: "c07", text: "Bromsvätskan ser ren ut", variant_specific: false, section: "Motor och vätskor" },
    { id: "c08", text: "Kall start går tyst och jämnt", variant_specific: true, section: "Provkörning" },
    { id: "c09", text: "Växellådan växlar mjukt i krypfart", variant_specific: true, section: "Provkörning" },
    { id: "c10", text: "Växellådan växlar utan fördröjning på landsväg", variant_specific: true, section: "Provkörning" },
    { id: "c11", text: "Inga varningslampor lyser efter provkörning", variant_specific: false, section: "Provkörning" },
    { id: "c12", text: "Bilen drar inte snett vid inbromsning", variant_specific: false, section: "Provkörning" },
    { id: "c13", text: "Bromsarna tar jämnt utan pulsering", variant_specific: true, section: "Bromsar och däck" },
    { id: "c14", text: "Däcken har godkänt mönsterdjup", variant_specific: false, section: "Bromsar och däck" },
    { id: "c15", text: "Däcken är jämnt slitna och av samma typ", variant_specific: true, section: "Bromsar och däck" },
    { id: "c16", text: "Fälgarna är fria från kantstötningar", variant_specific: false, section: "Bromsar och däck" },
    { id: "c17", text: "All belysning, blinkers och bromsljus fungerar", variant_specific: false, section: "El och elektronik" },
    { id: "c18", text: "Instrumentering och skärmar reagerar korrekt", variant_specific: false, section: "El och elektronik" },
    { id: "c19", text: "Klimatanläggningen kyler snabbt", variant_specific: true, section: "El och elektronik" },
    { id: "c20", text: "Elhissar, speglar och torkare fungerar", variant_specific: false, section: "El och elektronik" },
    { id: "c21", text: "Ingen fukt eller lukt i bagageutrymmet", variant_specific: true, section: "Kupé och bagageutrymme" },
    { id: "c22", text: "Mattor och klädsel är torra", variant_specific: false, section: "Kupé och bagageutrymme" },
    { id: "c23", text: "Säten, bälten och barnlås fungerar", variant_specific: false, section: "Kupé och bagageutrymme" },
    { id: "c24", text: "Nycklar och tillbehör finns med", variant_specific: false, section: "Kupé och bagageutrymme" },
  ],
  seller_questions: [
    {
      question: "Hur har bilen servats och kan jag få se underlaget?",
      why: "Servicehistoriken är det enskilt starkaste underlaget för hur bilen skötts.",
      red_flag_answer: "Svar som \"det har alltid skötts\" utan att något underlag kan visas.",
      variant_specific: true,
    },
    {
      question: "Har bromsarna fram bytts, och i så fall när?",
      why: "Bromsar fram är den punkt som oftast kräver åtgärd på den här typen av bil.",
      red_flag_answer: "Otydliga svar om när arbetet gjordes, eller att det gjordes \"nyligen\" utan kvitto.",
      variant_specific: true,
    },
    {
      question: "Har växellådan fått ny olja, och när?",
      why: "Oljebyte i växellådan hänger ihop med hur den växlar i låg fart.",
      red_flag_answer: "Att bilen aldrig fått något oljebyte i växellådan.",
      variant_specific: true,
    },
    {
      question: "Har bilen använts för att dra släp eller husvagn?",
      why: "Dragbelastning sliter mer på växellåda och drivning än vanlig körning.",
      red_flag_answer: "Tvekan eller ändrade uppgifter om vad bilen använts till.",
      variant_specific: true,
    },
    {
      question: "Har det varit problem med fukt eller läckage?",
      why: "Fukt i bagageutrymmet och läckage kring motorn är återkommande teman i underlaget.",
      red_flag_answer: "Att fuktproblem beskrivs som \"normalt för årsmodellen\" utan åtgärd.",
      variant_specific: true,
    },
    {
      question: "Varför säljer du bilen?",
      why: "Svaret ger en bild av ägandet och gör det lättare att förstå om något förändrats nyligen.",
      red_flag_answer: "Förklaringar som ändras under samtalet.",
      variant_specific: false,
    },
    {
      question: "Har bilen varit inblandad i en skada och lagats?",
      why: "Reparationer efter skada påverkar både värdet och hur bilen bör granskas.",
      red_flag_answer: "Att skador beskrivs som \"småsaker\" utan dokumentation.",
      variant_specific: false,
    },
    {
      question: "Hur länge har du ägt bilen och hur många ägare har den haft?",
      why: "Korta ägandetider och många ägare är värda att följa upp med fler frågor.",
      red_flag_answer: "Uppgifter som inte stämmer med registrerade ägarbyten.",
      variant_specific: false,
    },
  ],
  documents_to_verify: [
    "Serviceunderlag eller digital servicehistorik",
    "Kvitton på utförda arbeten och bytta delar",
    "Underlag för senaste kontrollen hos verkstad",
    "Registreringsbevis och uppgift om antal ägare",
    "Kvitton för däck, bromsar eller andra nyligen utförda arbeten",
    "Eventuella garanti- eller försäkringsbevis",
  ],
  sources: [
    {
      id: "s1",
      url: "https://example.com/exempeltillverkaren/serviceinformation",
      title: "Fiktiv serviceinformation för exempelmotorn",
      publisher: "Exempeltillverkaren (fiktiv)",
      source_type: "official" as const,
      retrieved_at: "2028-01-01",
    },
    {
      id: "s2",
      url: "https://example.com/exempelstatistik/agarsammanstallning",
      title: "Fiktiv sammanställning av ägarrapporter",
      publisher: "Exempelstatistik (fiktiv)",
      source_type: "statistics" as const,
      retrieved_at: "2028-01-01",
    },
    {
      id: "s3",
      url: "https://example.com/exempelverkstaden/erfarenheter",
      title: "Fiktiva verkstadserfarenheter av bromsar och vätskor",
      publisher: "Exempelverkstaden (fiktiv)",
      source_type: "workshop" as const,
      retrieved_at: "2028-01-01",
    },
    {
      id: "s4",
      url: "https://example.com/exempeltidningen/kopguide",
      title: "Fiktiv köpguide: kontrollpunkter vid provkörning",
      publisher: "Exempeltidningen (fiktiv)",
      source_type: "media" as const,
      retrieved_at: "2028-01-01",
    },
    {
      id: "s5",
      url: "https://example.com/exempelforumet/fukt-bagageutrymme",
      title: "Fiktiv ägardiskussion om fukt i bagageutrymmet",
      publisher: "Exempelforumet (fiktivt)",
      source_type: "owner_forum" as const,
      retrieved_at: "2028-01-01",
    },
  ],
  data_basis_note: `${reportDataBasisNote} I den här förhandsvisningen är bilen, punkterna och alla källor påhittade exempel.`,
  disclaimer_note:
    "Detta är inte en teknisk besiktning. Rapporten är vägledning för dig som köpare och ersätter inte en undersökning av bilen.",
  review_status: "unreviewed" as const,
};

function parseSample(input: unknown): Report {
  const result = reportSchema.safeParse(input);
  if (!result.success) {
    console.error("[report] Exempeldata uppfyller inte schemat:", result.error.issues);
    throw new Error("Exempeldata uppfyller inte rapportschemat");
  }
  return result.data;
}

/** Den validerade exempelrapporten, exakt som den definieras ovan. */
export const sampleReport: Report = parseSample(sampleInput);

/** Exemplet i ett valt täckningsläge, för att kunna granska alla tre lägena. */
export function sampleReportForState(state: SampleState): Report {
  const coverageNotes: Record<SampleState, { searches_run: number; sources_used: number; notes: string }> = {
    good: {
      searches_run: 12,
      sources_used: 5,
      notes: "Exempelsökningarna hittar flera oberoende källor som beskriver samma variant, varav en är officiell.",
    },
    partial: {
      searches_run: 7,
      sources_used: 5,
      notes: sampleInput.research_summary.notes,
    },
    thin: {
      searches_run: 3,
      sources_used: 2,
      notes: "Exempelsökningarna hittar bara enstaka källor om just den här varianten, och de säger inte samma sak.",
    },
  };

  const summary = coverageNotes[state];
  return reportSchema.parse({
    ...sampleInput,
    research_summary: { ...sampleInput.research_summary, coverage: state, ...summary },
    // Ett tunt underlag ska också visa färre punkter, precis som notisen säger.
    known_issues: state === "thin" ? sampleInput.known_issues.slice(0, 3) : sampleInput.known_issues,
  });
}

/* ------------------------------------------------------------------ *
 * Researchflödet
 * ------------------------------------------------------------------ */

/**
 * Stegen är desamma som backend rapporterar. Gränssnittet visar de steg som
 * kommer från servern via `onStage` och hittar aldrig på egna steg.
 */
export const researchStageLines = [
  "Identifierar exakt variant",
  "Söker efter publicerad information",
  "Går igenom källor",
  "Sammanställer rapporten",
] as const;

/**
 * Den tvåstegskörningen tar realistiskt 40–200 sekunder: söksteget och
 * skrivsteget har var sitt tak på 90 sekunder, och hela körningen på 200.
 * Det visas ärligt för användaren i stället för en påhittad procentandel.
 */
export const researchTiming = { minSeconds: 40, maxSeconds: 200 } as const;

export type ResearchStage = { index: number; total: number; label: string };
export type ResearchProgress = { onStage?: (stage: ResearchStage) => void };

/** Status för pågående research, oavsett om den kommer från en backend eller en demo. */
export type ResearchStatus = { stages: ResearchStage[]; elapsedSeconds: number };

/**
 * Exempel på en sökrad som sökfältet på startsidan kan fyllas med.
 * Själva rapporten i den här förhandsvisningen använder fiktiva fordonsuppgifter.
 */
export const exampleVehicleInput = "Volvo V60 D4 AWD Geartronic 2018";

/** Loose parser for the natural-language vehicle line. Replaceable later by real vehicle identification. */
export function parseVehicleInput(value: string): Vehicle | null {
  const words = value.trim().split(/\s+/);
  if (words.length < 2) return null;
  const yearMatch = value.match(/\b(19[5-9]\d|20\d{2})\b/);
  const normalized = value.toLowerCase();
  const parsed = vehicleSchema.safeParse({
    make: words[0],
    model: words[1],
    year: yearMatch ? Number(yearMatch[1]) : new Date().getFullYear() - 5,
    engine: words.find((word) => /^(d|t|b|tsi|tdi|x)\d/i.test(word)) ?? words[2] ?? "Okänd",
    gearbox: /automat|dsg|aut\./i.test(normalized) ? "Automat" : "Manuell",
    drivetrain: /awd|4wd|fyrhjulsdrift|quattro|4motion|xdrive/i.test(normalized)
      ? "Fyrhjulsdrift"
      : /bakhjulsdrift|rwd/i.test(normalized)
        ? "Bakhjulsdrift"
        : "Framhjulsdrift",
    mileage_km: null,
  });
  return parsed.success ? parsed.data : null;
}

/* ------------------------------------------------------------------ *
 * Genereringspipelinen: status, cache-nyckel och metadata
 * ------------------------------------------------------------------ */

/**
 * Status för en rapportpost medan backend arbetar. Gränssnittet visar de här
 * stegen i tur och ordning och hittar aldrig på egna.
 */
export const reportStatusSchema = z.enum([
  "queued",
  "resolving_variant",
  "researching",
  "analyzing",
  "writing",
  "done",
  "failed",
]);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const reportStatusLabels: Record<ReportStatus, string> = {
  queued: "I kö",
  resolving_variant: "Identifierar variant",
  researching: "Söker källor",
  analyzing: "Går igenom källor",
  writing: "Sammanställer",
  done: "Klar",
  failed: "Misslyckades",
};

/**
 * Backendens statusar översatta till laddningsvyns steg, i den ordning de
 * inträffar. Etiketterna är samma fyra steg som researchflödet alltid har visat.
 */
export const reportStageForStatus: ReadonlyArray<{ status: ReportStatus; label: string }> = [
  { status: "resolving_variant", label: researchStageLines[0] },
  { status: "researching", label: researchStageLines[1] },
  { status: "analyzing", label: researchStageLines[2] },
  { status: "writing", label: researchStageLines[3] },
];

export const statusLogEntrySchema = z.object({ status: reportStatusSchema, at: z.number() });
export type StatusLogEntry = z.infer<typeof statusLogEntrySchema>;

/**
 * Bygger laddningsvyns status ur backendens statuslogg.
 *
 * Bara de steg som backend faktiskt har rapporterat tas med, och det senaste
 * steget ligger kvar tills rapporten är klar. Ingenting hittas på här.
 */
export function researchStatusFromLog(log: readonly StatusLogEntry[], now: number): ResearchStatus {
  const rankOf = (status: ReportStatus) => reportStageForStatus.findIndex((stage) => stage.status === status);
  const highest = log.reduce((highest, entry) => Math.max(highest, rankOf(entry.status)), -1);
  const stages: ResearchStage[] = reportStageForStatus
    .slice(0, Math.max(highest + 1, 0))
    .map((stage, index) => ({ index, total: reportStageForStatus.length, label: stage.label }));
  const startedAt = log.length > 0 ? log[0].at : now;

  return { stages, elapsedSeconds: Math.max(0, Math.floor((now - startedAt) / 1000)) };
}

/**
 * Cache-nyckeln för en förfrågan: make|model|year|engine|gearbox|drivetrain,
 * gemener och trimmad till enkla blanksteg. Miltalet ingår med flit inte –
 * samma variant ska kunna återanvändas oavsett mätarställning.
 */
export function reportCacheKey(
  vehicle: Pick<Vehicle, "make" | "model" | "year" | "engine" | "gearbox" | "drivetrain">,
): string {
  return [vehicle.make, vehicle.model, String(vehicle.year), vehicle.engine, vehicle.gearbox, vehicle.drivetrain]
    .map((part) => part.trim().replace(/\s+/g, " ").toLowerCase())
    .join("|");
}

/**
 * De två stegen i genereringen: söksteget (med sökverktyget) och skrivsteget
 * (utan sökverktyg, enbart ur fynden).
 */
export const generationStepSchema = z.enum(["search", "write"]);
export type GenerationStep = z.infer<typeof generationStepSchema>;

export const generationStepLabels: Record<GenerationStep, string> = {
  search: "Steg 1 – sökning",
  write: "Steg 2 – skrivning",
};

/**
 * Ett genomfört steg: tid, sökningar, token och kostnad. Sparas både för
 * lyckade körningar (i generation_meta) och för misslyckade (per försök), så att
 * /admin alltid kan visa vad varje steg kostade.
 */
export const generationStepMetaSchema = z.object({
  step: generationStepSchema,
  /** 1 för stegets första anrop, 2 för stegets enda tillåtna omförsök. */
  attempt: z.number().int().min(1),
  duration_ms: z.number().int().min(0),
  searches: z.number().int().min(0),
  input_tokens: z.number().int().min(0).nullable(),
  output_tokens: z.number().int().min(0).nullable(),
  cost_usd: z.number().min(0),
  cost_sek: z.number().min(0),
});
export type GenerationStepMeta = z.infer<typeof generationStepMetaSchema>;

/**
 * Vad en generering faktiskt kostade och hur den gick till. Sparas på posten
 * och visas i /admin. `cost_usd` och `usd_sek_rate` sparas tillsammans med
 * kronbeloppet så att en gammal kostnad alltid går att räkna om.
 */
export const generationMetaSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  prompt_version: z.string().min(1),
  searches_run: z.number().int().min(0),
  sources_used: z.number().int().min(0),
  input_tokens: z.number().int().min(0).nullable(),
  output_tokens: z.number().int().min(0).nullable(),
  cost_usd: z.number().min(0),
  usd_sek_rate: z.number().positive(),
  estimated_cost_sek: z.number().min(0),
  duration_ms: z.number().int().min(0),
  generated_at: z.string().min(1),
  retried: z.boolean(),
  injection_suspected: z.boolean(),
  grounding_urls: z.array(z.string()),
  unverified_source_urls: z.array(z.string()),
  quality_notes: z.array(z.string()),
  /** Tid, sökningar, token och kostnad per steg. Tom för poster före tvåstegsflödet. */
  steps: z.array(generationStepMetaSchema),
});
export type GenerationMeta = z.infer<typeof generationMetaSchema>;

/** Flaggningar som användare kan lämna på en rapport. */
export const reportFlagKindSchema = z.enum(["wrong", "missing", "unsafe", "other"]);
export type ReportFlagKind = z.infer<typeof reportFlagKindSchema>;

export const reportFlagLabels: Record<ReportFlagKind, string> = {
  wrong: "Felaktigt innehåll",
  missing: "Saknar något",
  unsafe: "Osäkert innehåll",
  other: "Övrigt",
};

export const reportFlagSchema = z.object({
  kind: reportFlagKindSchema,
  message: z.string().trim().min(3, "Skriv några ord om vad som är fel.").max(600, "Meddelandet får vara högst 600 tecken."),
});

/**
 * Det gränssnittet läser från backend. `report` är null så länge rapporten
 * inte är klar, och valideras alltid mot reportSchema innan den visas.
 *
 * Bara det som behövs för att visa rapporten ingår. Granskningen sammanfattas
 * som en enda publik flagga, `reviewed` (true/false) – inga interna
 * granskningsvärden, ingen generation_meta, inga kostnader, token eller
 * ip-härledd data.
 */
export const publicReportViewSchema = z.object({
  reportId: z.string().min(4),
  status: reportStatusSchema,
  reviewed: z.boolean(),
  /**
   * Sant när ett nytt försök med samma bil kan ge ett annat resultat. Är det
   * falskt (fel format eller inget sökunderlag) uppmanar gränssnittet inte till
   * ett nytt försök, eftersom samma körning då bara skulle kosta pengar utan att
   * kunna lyckas.
   */
  retryable: z.boolean(),
  vehicle: vehicleSchema,
  report: z.unknown().nullable(),
  statusLog: z.array(statusLogEntrySchema),
});
export type PublicReportView = z.infer<typeof publicReportViewSchema>;
