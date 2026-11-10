# Security & operations

Plain-language guide to access, test data, privacy and publishing. None of the
steps below require code changes.

## 1. Who can open `/admin`

Access is an allow-list with a single account. You are an administrator only if
**all** of these hold:

1. You signed in with an email one-time code (a guest/anonymous account never
   qualifies).
2. The email address was verified with that code.
3. The address matches the Convex environment variable `ADMIN_EMAIL`.

There is no "claim admin" button and no admin role stored in the database: the
right is recomputed from `ADMIN_EMAIL` on every request. If `ADMIN_EMAIL` is not
set, **nobody** is an administrator.

### Set `ADMIN_EMAIL`

In the project's **Keys / API keys** tab, add a Convex environment variable:

- Name: `ADMIN_EMAIL`
- Value: the email address that should be able to review reports.

Or from a terminal in the project:

```bash
npx convex env set ADMIN_EMAIL you@example.com
```

### Sign in to `/admin`

1. Open `/admin`.
2. You are sent to `/auth` with `?returnTo=/admin`.
3. Enter the `ADMIN_EMAIL` address and press the arrow button.
4. Enter the 6-digit code from the email.
5. You land back on `/admin`.

Any other address is refused: guests, unverified addresses and different emails
all get "Sidan är bara för administratören".

## 2. Sign-in

Only email one-time codes are offered. "Continue as Guest" has been removed, and
the leftover `/dashboard` page and route are gone. The default destination after
sign-in is `/admin`.

## 3. Test data

`/admin` has a **Testdata** section with a "Ta bort testdata" button. It runs the
admin-only mutation `reportAdmin.purgeTestData`, which permanently deletes:

- every report created by the local fixture provider (`generation_meta.provider
  = "fixture"` or a `TEST-` report id), and
- every failed attempt,

together with their user flags. Normal reports are not touched.

Because it is admin-only, it cannot be run from an unauthenticated terminal
(`bunx convex run reportAdmin:purgeTestData` returns `NOT_SIGNED_IN`). Run it
from `/admin` after signing in, or from the Convex dashboard's **Functions** tab
while signed in as the admin.

It processes up to 1000 records per run; if it reports `scanned: 1000`, click it
again to continue.

### Fixture reports on the public page

Reports from the fixture provider are treated as "not found" on `/rapport/<id>`
unless the deployment runs `REPORT_PROVIDER=fixture` (test mode). Setting
`APP_ENV=production` hides them unconditionally.

## 4. What an anonymous visitor gets from `getReport`

`/rapport/<id>` reads only these fields:

- `reportId`, `status`, `reviewed` (true/false), `vehicle`, `report`,
  `statusLog`.

Removed from the public response: `reviewStatus` (replaced by the public
`reviewed` flag), `failureReason`, `createdAt`, `updatedAt`. `getReport` has
never returned `generation_meta`, token counts, costs, quality notes, unverified
URLs, user flags or any IP-derived value — those live only on
`/admin`'s `reportDetail`. Any unknown field is stripped by the schema before
the UI sees it.

## 5. Privacy / rate-limit identifiers

- Per-visitor rate limiting stores one row per visitor hash: the key is a
  40-character HMAC/hash of the IP (never the raw IP), plus a window start and a
  counter. Rows are deleted automatically once they have not been used for 48
  hours (`rateLimitRetentionMs` in `src/lib/reportCleanup.ts`).
- The daily cap counter stores only a date and a number, no personal data.
- The IP-derived `ownerKey` that used to be written onto each report has been
  removed entirely.
- These identifiers are never returned by any public function.

## 6. Settings

Both are optional Convex environment variables with sensible defaults, read in
`src/convex/reportPipeline.ts`:

| Variable               | Default | Meaning                                  |
| ---------------------- | ------- | ---------------------------------------- |
| `DAILY_REPORT_CAP`     | 40      | Max reports for everyone per day (Swedish time). |
| `RATE_LIMIT_PER_HOUR`  | 6       | Max reports per visitor per hour.        |

Change them in the **Keys / API keys** tab, or:

```bash
npx convex env set DAILY_REPORT_CAP 60
npx convex env set RATE_LIMIT_PER_HOUR 10
```

## 7. API keys

No key name or value appears in the browser code, the pages, or any network
response. The provider panel on `/admin` no longer shows environment variable
names, and `providerStatus` is admin-only. Run `bun scripts/verify-security.ts`
to check the client source automatically.

## 8. Publishing checklist

Convex keeps **development and production as separate deployments with separate
databases and separate environment variables**. Deploying functions does **not**
copy development data to production, and auth/users are separate too.

1. Create the production deployment: `npx convex deploy`.
2. Set the production environment variables (each one, with `--prod`):
   - `npx convex env set --prod ADMIN_EMAIL you@example.com`
   - `npx convex env set --prod SITE_URL https://your-domain`
   - `npx convex env set --prod APP_ENV production`
   - `npx convex env set --prod REPORT_PROVIDER google` (or `openai` / `anthropic`)
   - the search-capable AI key, e.g. `npx convex env set --prod GOOGLE_API_KEY ...`
   - optional: `LLM_MODEL`, `DAILY_REPORT_CAP`, `RATE_LIMIT_PER_HOUR`,
     `RATE_LIMIT_SECRET`, `USD_SEK_RATE`.
   - optional, for slow research calls: `RESEARCH_TIMEOUT_MS` (the hard limit
     for the whole two-step run, 200000 ms by default) and `MAX_SEARCHES` (the
     most searches the search prompt may ask for, 12 by default). Generation runs
     as two calls – a search step and a write step – and each step is capped at
     90 s regardless of this value. If `/admin` shows repeated `TIMEOUT` failures
     for a car, `MAX_SEARCHES` is too high for the time budget. Keep
     `RESEARCH_TIMEOUT_MS` below about four minutes, because the watchdog marks
     anything that has not moved for five minutes as failed
     (`src/convex/crons.ts`).
   - Do **not** set `REPORT_PROVIDER=fixture` in production.
3. Rebuild/redeploy the front end pointed at the production Convex URL
   (`VITE_CONVEX_URL`) and, if analytics is on, with `VITE_UMAMI_WEBSITE_ID`
   (plus the optional `VITE_UMAMI_DOMAINS`) set in the same place.
4. Sign in once on production with `ADMIN_EMAIL` and check `/admin`.
5. Nothing carries over from development: no reports, no users, no admin, no
   keys. Set everything in step 2 again.

## 9. Running the checks

```bash
bun scripts/verify-security.ts            # rules, public shape, key scan
bun scripts/verify-report-pipeline.ts     # quality checks, cache, admin overview
bun scripts/verify-two-step.ts            # the two-step run against a simulated provider
bun scripts/check-report-prompt.ts        # both prompts identical to their markdown files
CONVEX_URL=https://<deployment>.convex.cloud bun scripts/verify-security.ts --live
```

`verify-two-step.ts` needs no keys and makes no network calls. It proves the
four cases that matter for the two-step generation: a normal run, zero searches
twice (NO_RESEARCH, the write step never runs), zero searches on the first try
and a search on the second, and a step timeout with no retry.

## 10. Visitor analytics (Umami)

The tracker is in `src/components/system/analytics.tsx` and is mounted once in
`src/main.tsx`. It stays completely inactive (no script file, no requests) until
`VITE_UMAMI_WEBSITE_ID` is set.

Front-end environment variables (all optional, all public values):

| Variable                | Meaning                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `VITE_UMAMI_WEBSITE_ID` | Website ID from the Umami dashboard. Turns tracking on.        |
| `VITE_UMAMI_SCRIPT_URL` | Tracker URL. Default `https://cloud.umami.is/script.js`; set it for a self-hosted instance. |
| `VITE_UMAMI_DOMAINS`    | Comma-separated hostnames where tracking may run, e.g. `example.se,www.example.se`. Left empty = all hostnames. |

What is sent: the page path, page title, hostname, referrer, browser
language, screen size, and a daily-rotating hash derived from IP + user agent.
No cookies, no raw IP addresses, no accounts, no report contents. Report URLs
are normalised before sending (`/rapport/<id>` becomes `/rapport/:id`), so
individual report IDs never appear in the statistics.

`data-do-not-track="true"` is set, so browsers that still send a Do Not Track
preference are ignored. Removing the `VITE_UMAMI_WEBSITE_ID` key switches
analytics off again without any code change.
