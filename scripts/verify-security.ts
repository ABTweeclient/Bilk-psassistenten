/**
 * Verifiering av säkerhetsstädningen.
 *
 *   bun scripts/verify-security.ts
 *   CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-security.ts --live
 *
 * --pure (standard) kontrollerar reglerna utan nätverk eller databas:
 *   ADMIN_EMAIL-allow-listen, städreglerna för testdata, testrapporternas
 *   synlighet, rate-limitens livstid, den publika getReport-formen och att inga
 *   nyckelnamn eller nyckelvärden finns i klientkoden.
 *
 * --live kontrollerar dessutom mot deploymenten att anonyma anrop till varje
 *   admin-funktion nekas och att ett okänt rapport-id ger null.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../src/convex/_generated/api";
import { isAdminCandidate, normalizeAdminEmail } from "../src/lib/adminAccess";
import {
  fixtureReportsVisible,
  isFixtureReport,
  rateLimitRetentionMs,
  shouldPurgeReport,
} from "../src/lib/reportCleanup";
import { publicReportViewSchema } from "../src/lib/report";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` – ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------ *
 * Rena kontroller
 * ------------------------------------------------------------------ */

function pureChecks() {
  console.log("\nADMIN_EMAIL – allow-list");
  const admin = { email: "admin@example.com", emailVerified: true, isAnonymous: false };
  check("ADMIN_EMAIL-kontot accepteras", isAdminCandidate(admin, "admin@example.com"));
  check(
    "skiftläge och blanksteg spelar ingen roll",
    isAdminCandidate({ ...admin, email: " Admin@Example.com " }, "  ADMIN@example.com "),
  );
  check("annan e-post nekas", !isAdminCandidate({ ...admin, email: "nagon@example.com" }, "admin@example.com"));
  check(
    "gäst nekas även med rätt adress",
    !isAdminCandidate({ email: "admin@example.com", emailVerified: false, isAnonymous: true }, "admin@example.com"),
  );
  check(
    "oidentifierad gäst nekas",
    !isAdminCandidate({ email: null, emailVerified: false, isAnonymous: true }, "admin@example.com"),
  );
  check(
    "overifierad adress nekas",
    !isAdminCandidate({ email: "admin@example.com", emailVerified: false }, "admin@example.com"),
  );
  check(
    "saknad ADMIN_EMAIL ger ingen admin",
    !isAdminCandidate(admin, undefined) && !isAdminCandidate(admin, "") && !isAdminCandidate(admin, "   "),
  );
  check(
    "normaliseringen trimmar och gör gemener",
    normalizeAdminEmail("  A@B.se ") === "a@b.se" && normalizeAdminEmail("   ") === null,
  );

  console.log("\nTestdata – vad som raderas");
  check("fixture-leverantörens poster raderas", shouldPurgeReport({ generationMeta: { provider: "fixture" } }));
  check("TEST-prefixade rapport-id raderas", shouldPurgeReport({ report: { report_id: "TEST-VOLV-2018" } }));
  check("misslyckade försök raderas", shouldPurgeReport({ status: "failed" }));
  check(
    "en vanlig färdig rapport rörs inte",
    !shouldPurgeReport({ status: "done", generationMeta: { provider: "google" }, report: { report_id: "abc-123" } }),
  );
  check(
    "fixture känns igen på meta men inte på google",
    isFixtureReport({ generationMeta: { provider: "fixture" } }) &&
      !isFixtureReport({ generationMeta: { provider: "google" }, report: { report_id: "x" } }),
  );

  console.log("\nTestrapporter på den publika sidan");
  check(
    "dolda utan testläge",
    !fixtureReportsVisible(undefined, undefined) && !fixtureReportsVisible("google", undefined),
  );
  check(
    "synliga bara i testläget",
    fixtureReportsVisible("fixture", undefined) && fixtureReportsVisible("fixture", "development"),
  );
  check("alltid dolda i produktion", !fixtureReportsVisible("fixture", "production"));

  console.log("\nRate-limitens livstid");
  const hours = rateLimitRetentionMs / 3_600_000;
  check("ip-härledda nycklar gallras inom 24–48 timmar", hours >= 24 && hours <= 48, `${hours} timmar`);

  console.log("\nDen publika getReport-formen");
  const raw = {
    reportId: "abc-123",
    status: "done",
    reviewStatus: "reviewed",
    reviewed: true,
    vehicle: {
      make: "Volvo",
      model: "V60",
      year: 2018,
      engine: "D4",
      gearbox: "Automat",
      drivetrain: "Fyrhjulsdrift",
      mileage_km: 12000,
    },
    report: { report_id: "abc-123" },
    /* Den enda upplysningen om en misslyckad körning: om ett nytt försök är
       värt något. Den avslöjar inget om orsaken. */
    retryable: false,
    failureReason: "PROVIDER_FAILED",
    statusLog: [{ status: "resolving_variant", at: 1 }],
    createdAt: 1,
    updatedAt: 2,
    generationMeta: { provider: "google", estimated_cost_sek: 4.2, quality_notes: ["intern notis"] },
    /* Felspåret innehåller leverantörens feltext och modellens råsvar. Det ska
       aldrig kunna läsas ut av en besökare, bara av administratören i /admin. */
    failure: {
      kind: "provider_error",
      summary: "Leverantören svarade med ett fel – HTTP 429: RESOURCE_EXHAUSTED",
      attempts: [{ attempt: 1, message: "RESOURCE_EXHAUSTED", raw_response: "{ trasigt" }],
      attempt_count: 1,
      searches_total: 0,
      cost_sek_total: 0,
      model: "gemini-3.8-flash",
    },
    ownerKey: "ip-härledd-nyckel",
    flags: [{ kind: "wrong", message: "användarflagga" }],
  };
  const parsed = publicReportViewSchema.safeParse(raw);
  check("den publika vyn validerar", parsed.success);
  if (parsed.success) {
    const keys = Object.keys(parsed.data).sort();
    check(
      "bara de fält som behövs för att visa rapporten finns kvar",
      JSON.stringify(keys) === JSON.stringify(["report", "reportId", "retryable", "reviewed", "status", "statusLog", "vehicle"]),
      keys.join(", "),
    );
    check(
      "generation_meta, felspår, kostnad, flaggor och ip-härledd nyckel rensas bort",
      !("generationMeta" in parsed.data) &&
        !("failure" in parsed.data) &&
        !("ownerKey" in parsed.data) &&
        !("flags" in parsed.data) &&
        !("failureReason" in parsed.data) &&
        !("reviewStatus" in parsed.data) &&
        !("createdAt" in parsed.data),
    );
    check("granskningen sammanfattas som en publik boolean", parsed.data.reviewed === true);
  }

  console.log("\nNycklar i klientkoden");
  const clientFiles = collectClientFiles("src").filter((file) => !file.includes(`src${sep}convex${sep}`));
  const offenders = clientFiles.filter((file) => {
    const text = readFileSync(file, "utf8");
    return /process\.env/.test(text) || /apiKeyEnvVar/.test(text) || /_API_KEY/.test(text);
  });
  check(
    `inga nyckelnamn eller nyckelvärden i ${clientFiles.length} klientfiler`,
    offenders.length === 0,
    offenders.join(", "),
  );
}

const sep = process.platform === "win32" ? "\\" : "/";

function collectClientFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      found.push(...collectClientFiles(path));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      found.push(path.split(sep).join(sep));
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * Live-kontroller mot deploymenten
 * ------------------------------------------------------------------ */

async function liveChecks() {
  const url = process.env.CONVEX_URL;
  if (!url) throw new Error("Sätt CONVEX_URL till deploymentens url, till exempel https://<deployment>.convex.cloud");
  const http = new ConvexHttpClient(url);

  console.log("\nAnonyma anrop till admin-funktionerna");
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["providerStatus", () => http.query(api.reportAdmin.providerStatus, {})],
    ["listReports", () => http.query(api.reportAdmin.listReports, {})],
    ["reportDetail", () => http.query(api.reportAdmin.reportDetail, { reportId: "abc-123" })],
    ["purgeTestData", () => http.mutation(api.reportAdmin.purgeTestData, {})],
  ];
  for (const [name, call] of calls) {
    let blocked = false;
    try {
      await call();
    } catch {
      blocked = true;
    }
    check(`anonymt anrop till ${name} nekas`, blocked);
  }

  const missing = await http.query(api.vehicleReports.getReport, {
    reportId: "00000000-0000-0000-0000-000000000000",
  });
  check("okänt rapport-id ger null åt anonyma", missing === null);
}

const mode = process.argv.includes("--live") ? "live" : "pure";

try {
  if (mode === "pure") pureChecks();
  else await liveChecks();
} catch (error) {
  failures += 1;
  console.error("\nVerifieringen avbröts:", error);
}

console.log(failures === 0 ? "\nAlla kontroller passerade." : `\n${failures} kontroll(er) misslyckades.`);
process.exit(failures === 0 ? 0 : 1);
