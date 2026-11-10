import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Schemalagda jobb.
 *
 * Ett enda jobb körs: vaktfunktionen som stänger rapportposter som legat i ett
 * arbetsläge för länge. Utan den skulle en körning som dör mitt i – processen
 * avbryts, ett fel inträffar utanför all felhantering – lämna posten som
 * "researching" för alltid, och /rapport/:id skulle snurra i evighet i stället
 * för att visa ett tydligt felläge.
 *
 * Gränsen är fem minuter, vilket är längre än den hårda tidsgränsen för hela
 * körningen (RESEARCH_TIMEOUT_MS, 200 s) inklusive stegens egna tak på 90 s och
 * det enda tillåtna omförsöket. En körning som faktiskt arbetar hinner därför
 * aldrig stängas av misstag.
 */
const crons = cronJobs();

crons.interval(
  "sweep-stale-reports",
  { minutes: 1 },
  internal.vehicleReports.sweepStaleReports,
  { staleMs: 5 * 60 * 1000 },
);

export default crons;
