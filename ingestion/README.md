# Cambodia food-price data pipeline

A **publication-updated** ingestion service. It watches the WFP Cambodia market monitoring
publication page, extracts the annex price tables out of each new PDF, and files the
results for human review before anything becomes usable.

This is a separate application from the forecasting app in [`../nuxt-app`](../nuxt-app).
Nothing in this directory touches that app or its data.

---

## Why "publication-updated" and not real-time

This is not a market-price feed, and describing it as one would be wrong in two distinct
ways:

1. **Data arrives only when WFP publishes.** Reports appear roughly monthly, on no fixed
   day. Between publications the dataset does not change, no matter how often the cron runs.
2. **The month a price refers to is not the month it was published.** The July 2026 report
   carries **June 2026** prices. April, March and February 2026 reports exist; May does not.

So the newest number in this system is typically four to eight weeks old, and any interface
built on it should say so.

### Publication date vs observation date

These are different columns and must never be conflated:

| | Where it comes from | Example |
|---|---|---|
| `source_reports.publication_date` | The report title on the WFP page | `2026-07-01` |
| `food_price_observations.observation_date` | The annex heading *inside* the PDF | `2026-06-01` |

The observation date is always read from the document itself. The validator rejects any
observation whose month is **later** than its report's publication month, since a report
cannot contain prices from the future.

---

## Architecture

```
Vercel Cron (weekly)
    │  Authorization: Bearer $CRON_SECRET
    ▼
GET /api/cron/scrape-wfp
    │
    ▼
lib/scraper/pipeline.ts
    │
    ├── wfp-page.ts ......... discover report links (cheerio)
    ├── pdf-downloader.ts ... fetch + SHA-256 hash
    ├── pdf-extractor.ts .... positioned text via pdfjs-dist
    ├── table-parser.ts ..... layout profiles → raw cells
    ├── normalizer.ts ....... commodity/unit mapping table
    └── validator.ts ........ hard rejects + soft review flags
    │
    ▼
Supabase Postgres        ← everything lands as `pending`
    │
    ▼
/admin/observations      ← a human approves or rejects
    │
    ▼
GET /api/prices          ← approved observations only
    │
    ▼
Python prediction service (separate; consumes this API)
```

### Three properties worth stating explicitly

**Nothing automated can approve data.** The pipeline writes only `pending` or `rejected`.
`approved` is reachable exclusively through `POST /api/admin/observations/:id/approve`. A
test asserts the pipeline source never writes an approved status.

**An unrecognised layout extracts nothing.** See "PDF extraction" below.

**Re-running is always safe.** `source_reports.source_url` is unique, and observations have
a unique index over their meaning, so a repeated run inserts nothing.

---

## PDF extraction, and how much to trust it

### Coordinates, not flowed text

The annex tables are absolutely-positioned text runs whose document order does **not** match
their visual row order. Flowed extraction — `pdftotext -layout`, or joining pdf.js items in
document order — attaches prices to the **wrong commodities**. On the July 2026 report a
flowed extraction reports mixed rice at 1,905 KHR and hangs 2,011 off a fish row four lines
down. Both numbers are real; the pairing is invented, and the output looks entirely
plausible.

So `pdf-extractor.ts` keeps every item's x/y and `table-parser.ts` rebuilds rows and columns
geometrically: rows by clustering on y, columns by partitioning on the header x positions.

### Supported layouts

WFP has changed this report's layout at least three times in two years. Rather than one
adaptive parser, each layout is a **profile** that must positively identify itself.

| Report series | Layout | Status |
|---|---|---|
| Market Situation Update (Oct 2025 →) | `Annex 2:` / `Table 1: Retail prices and changes` | **Supported** |
| Quarterly Market Monitoring Update (2025) | Landscape, two side-by-side tables, units inside the name | **Not supported** |
| Market & Seasonal Monitoring (2024) | `Annex 1: Change in retail prices` | **Not supported** |

An unsupported report is downloaded, recognised by name, and marked `needs_review` with
**zero observations extracted**. It is never half-parsed. The two unsupported series predate
the current format and their period is already covered by the historical HDX CSV.

Verified against the live reports: the parser reproduces 20 hand-checked values across the
July 2026 and January 2026 reports exactly, and extracts 0 from the quarterly and 2024
layouts.

### Known limitations

- **Only the current monthly layout is parsed.** When WFP next changes it, runs will report
  `needs_review` and extract nothing until a profile is added. That is the intended failure
  mode.
- **Geographic scope is sometimes absent.** Reports cover different province sets — July 2026
  covers 10 Tonle Sap provinces, January 2026 covers 7 Cambodia–Thailand border provinces —
  and the January table heading never says so. Scope is only ever taken from an explicit
  statement; failing that it is stored as `unspecified (see source report)`, which is its own
  bucket in the uniqueness key and carries a confidence penalty. **Series with different
  scopes must not be merged**: they measure different markets.
- **Khmer-language editions are skipped.** They duplicate the English tables.
- **Fuel and fertilizer are excluded.** Gasoline, diesel and urea share the annex but are not
  food; they are dropped at normalization with a recorded reason.
- **Prices are stored exactly as printed.** A "10 pcs" egg price is not divided by ten. Any
  per-unit conversion belongs downstream, so that `price_khr` always matches the PDF.
- **Unmapped commodities are kept, not guessed.** They get an `unmapped__` key, reduced
  confidence and a review flag. The fix is to add a line to `COMMODITY_MAP`.
- **`docs.wfp.org` requires a browser-shaped user-agent.** It rejects a bare token UA and a
  bare `Mozilla/5.0`, but accepts the descriptive `Mozilla/5.0 (compatible; …; +url)` form,
  which is what `lib/config.ts` sends. If downloads start returning 403, check this first.

---

## Local setup

Requires Node 20+.

```bash
cd ingestion
npm install
cp .env.example .env.local     # then fill it in
```

### Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migration. Either paste `supabase/migrations/0001_init.sql` into the SQL editor,
   or use the CLI:

   ```bash
   supabase link --project-ref <your-ref>
   supabase db push
   ```

3. From **Project Settings → API**, copy into `.env.local`:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

4. Generate the two secrets:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Use separate values for `CRON_SECRET` and `ADMIN_SECRET`.

### Environment variables

| Variable | Reaches the browser? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | RLS-constrained read key |
| `SUPABASE_SERVICE_ROLE_KEY` | **no** | Bypasses RLS; all writes |
| `CRON_SECRET` | **no** | Authorizes the cron endpoint |
| `ADMIN_SECRET` | **no** | Authorizes review and mutations |

The three server-only values must never appear in a `NEXT_PUBLIC_` variable or be imported
by a client component. `lib/env.ts` is marked `server-only` to make that a build error
rather than a leak.

Optional tuning (validation thresholds, batch size, user-agent) is listed in `.env.example`
with defaults in `lib/config.ts`.

### Row Level Security

RLS is enabled on all three tables. The `anon` key may read **approved observations only**
and report metadata; it has no write policy at all, so it cannot insert, update or delete
anywhere. Every mutation goes through the service-role client on the server.

`/api/prices` therefore enforces approved-only twice: once in its query filter and once in
the database. Losing the filter in a refactor still cannot leak unreviewed data.

---

## Running it

```bash
npm run dev          # http://localhost:3000
npm run scrape       # run the pipeline by hand
npm run scrape -- --dry      # discover only; writes nothing
npm run scrape -- --max 1    # process at most one new report
npm test             # 112 tests
npm run typecheck
npm run lint
npm run build
```

Triggering the cron endpoint locally:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/scrape-wfp
```

Checking extraction against real PDFs (not part of `npm test`, since it needs the PDFs on
disk):

```bash
npx tsx scripts/verify-extraction.ts path/to/report.pdf
```

### First run

The publication page lists ~30 reports. `MAX_REPORTS_PER_RUN` defaults to **3** so a single
invocation cannot exceed the function timeout; the backlog is worked through over successive
runs, newest first. Raise it when running locally, where there is no timeout.

---

## Reviewing observations

Open `/admin/observations`, paste the `ADMIN_SECRET`, and work the queue. Each card shows:

- the extracted price, and the original commodity and unit text from the PDF
- observation month vs publication month
- geographic scope and price type
- extraction confidence, highlighted when below threshold
- change against the previous **approved** value in the same series, highlighted when large
- recent approved values nearby, for comparison
- a link to the source PDF
- validation notes explaining why the record was queued

Filter by status, commodity and month. Approving publishes a record to `/api/prices`;
rejecting requires a reason and **keeps** the record, since a rejected row is the evidence of
what the parser got wrong.

The spike check compares only against **approved** values, so a bad extraction can never
become the baseline that normalises its successors.

### Admin access and its limits

Stated plainly: this is a **shared bearer secret, not user authentication.** There are no
accounts, every reviewer uses the same credential, and an approval records no individual.
The API is the security boundary — the page is only a shell, and every request behind it is
checked server-side with a constant-time comparison. The secret is held in `sessionStorage`
and sent in a header, never in a URL.

That is an accepted trade-off for a first version. Before real reviewers use it, add Supabase
Auth with a reviewer role and record the approver's identity on each row.

---

## API

### `GET /api/prices`

Approved observations only.

| Parameter | Notes |
|---|---|
| `commodity` | normalized key, e.g. `mixed_rice` |
| `province`, `market` | usually null for these reports (see below) |
| `priceType` | `retail`, `wholesale`, `unknown` |
| `startDate`, `endDate` | `YYYY-MM-DD` |
| `sourceType` | `WFP_PDF`, `WFP_HDX`, `MANUAL` |
| `page` | default 1 |
| `limit` | default 50, max 500 |

`province` and `market` are null for PDF-sourced rows: the annex publishes an aggregate
across a set of provinces, not a per-market price. `geographic_scope` records which set.

```bash
curl 'http://localhost:3000/api/prices?commodity=mixed_rice&startDate=2026-01-01&limit=5'
```

```json
{
  "data": [
    {
      "observationDate": "2026-06-01",
      "commodity": "mixed_rice",
      "commodityLabel": "Mixed Rice",
      "unit": "kg",
      "priceKhr": 2011,
      "geographicScope": "10 Tonle Sap provinces",
      "province": null,
      "market": null,
      "priceType": "retail",
      "sourceType": "WFP_PDF",
      "sourceUrl": "https://docs.wfp.org/api/documents/WFP-0000175046/download/",
      "sourceTitle": "Cambodia Market Situation Update - July 2026",
      "publicationDate": "2026-07-01"
    }
  ],
  "pagination": { "page": 1, "limit": 5, "total": 1, "totalPages": 1 },
  "metadata": {
    "latestActualObservation": "2026-06-01",
    "generatedAt": "2026-08-27T00:00:00.000Z",
    "note": "Approved observations from published WFP reports. Not a live price feed."
  }
}
```

### `GET /api/reports`

Processing status per source report. Supports `status`, `page`, `limit`. Deliberately omits
`processing_error`, so parser internals are not exposed publicly.

### Admin endpoints

All require `x-admin-secret: <ADMIN_SECRET>` or `Authorization: Bearer <ADMIN_SECRET>`.

```
GET  /api/admin/observations?status=pending&commodity=&month=&reportId=
POST /api/admin/observations/:id/approve   { "notes": "optional" }
POST /api/admin/observations/:id/reject    { "notes": "required" }
```

---

## Deploying to Vercel

```bash
npm i -g vercel
cd ingestion
vercel link
```

Set the five environment variables for Production, Preview and Development:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add CRON_SECRET
vercel env add ADMIN_SECRET
```

Then `vercel --prod`.

If this repository holds both apps, set the Vercel project's **Root Directory** to
`ingestion` so it does not build the Nuxt app.

### Vercel Cron

`vercel.json` registers the schedule:

```json
{ "crons": [{ "path": "/api/cron/scrape-wfp", "schedule": "0 6 * * 1" }] }
```

Mondays 06:00 UTC — 13:00 in Cambodia. Weekly is deliberately generous: reports appear
monthly, so this is four checks per publication and no load worth mentioning on WFP's server.

Vercel sends `Authorization: Bearer $CRON_SECRET` automatically once `CRON_SECRET` is set in
the project. Cron delivery is at-least-once, which is fine: the endpoint is idempotent.

Note that cron jobs run only on **production** deployments.

---

## Prediction integration

No model is trained inside a scraping request. The split is:

```
food_price_observations   actual, approved, measured  ← this service owns it
food_price_forecasts      model output                ← the prediction service owns it
```

The Python service polls `/api/prices`, merges compatible rows with the historical HDX data,
retrains when new approved actuals appear, and stores forecasts separately.

**A forecast is never an observation.** This API only ever returns measured prices, and
`metadata.latestActualObservation` exists so a consumer can tell exactly how far the real
data reaches before its own predictions begin.

### Merging with the historical HDX data

Keep PDF and HDX observations apart until compatibility is confirmed — `source_type`
is part of the uniqueness key precisely so they can coexist for the same month. Before
merging a series, check that commodity, unit, geographic scope and price type all agree.
The HDX CSV records per-market retail prices; these PDFs record multi-province aggregates.
**They are not the same measurement.**

---

## Tests

```bash
npm test
```

112 tests covering report discovery and deduplication, annex parsing, thousands separators,
missing values, observation-date extraction, commodity and unit normalization, the
duplicate-prevention key (including that the migration and the pipeline's conflict target
still agree), suspicious price changes, cron and admin authorization, and public API
filtering and pagination.

Fixtures synthesise the *geometry* of an annex table — heading, header row, column
positions, row baselines — rather than reproducing report text. No fixture contains a
meaningful portion of any published document.
