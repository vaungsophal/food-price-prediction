# Build Prompt: Cambodia Food Price Data Pipeline

## Project context

I am building a Cambodia food-price prediction project for my university AI course.

Existing project:

- GitHub: <https://github.com/vaungsophal/food-price-prediction.git>
- Historical dataset: <https://data.humdata.org/dataset/wfp-food-prices-for-cambodia>
- Historical data currently ends in March 2026.
- The prediction system may later be accessed through a Telegram bot.

I want to add a separate data-ingestion application using **Next.js**, deploy it on **Vercel**, and store extracted data in **Supabase PostgreSQL**.

## Main objective

Build a production-ready Next.js application that periodically checks the following WFP publication page for new Cambodia market-monitoring reports:

<https://www.wfp.org/publications/wfp-cambodia-market-seasonal-monitoring-update>

When a new report is available, the system should:

1. Detect the newest WFP PDF report.
2. Download the PDF.
3. Extract food-price tables from the annex.
4. Normalize the extracted data.
5. Validate the values.
6. Save candidate records in Supabase.
7. Prevent duplicate records.
8. Require approval before records become usable by the prediction model.
9. Expose approved observations through a JSON API.
10. Run automatically using Vercel Cron.

This is not a real-time market-price feed. Describe it as a **publication-updated Cambodia food-price data pipeline**.

## Technology requirements

Use:

- Next.js with App Router
- TypeScript
- Node.js runtime for scraping and PDF processing
- Supabase PostgreSQL
- `@supabase/supabase-js`
- Cheerio for HTML parsing
- A Vercel-compatible JavaScript PDF-text extraction library
- Zod for runtime validation
- Vercel Cron
- Vitest or Jest for tests

Do not store persistent data in local JSON files because Vercel functions have non-durable local filesystems. The public API should return JSON generated from Supabase.

## Data sources

### Primary recent source

WFP Cambodia Market & Seasonal Monitoring reports:

<https://www.wfp.org/publications/wfp-cambodia-market-seasonal-monitoring-update>

The publication date and observation month can differ. For example, a July report may contain June observations. Always extract and store the actual observation month shown inside the report.

### Historical source

WFP/HDX Cambodia food-price CSV:

<https://data.humdata.org/dataset/wfp-food-prices-for-cambodia>

Keep historical HDX observations separate from newly extracted PDF observations until their commodity, unit, geographic scope, and price type are confirmed compatible.

## Required database design

Create Supabase SQL migrations for the following tables.

### `source_reports`

Store:

- `id`
- `title`
- `publication_date`
- `source_url`, unique
- `document_id`, when available
- `file_hash`, when available
- `processing_status`: `discovered`, `downloaded`, `extracted`, `needs_review`, `approved`, or `failed`
- `processing_error`
- `discovered_at`
- `processed_at`
- timestamps

### `food_price_observations`

Store:

- `id`
- `source_report_id`
- `observation_date`
- `commodity_original`
- `commodity_normalized`
- `unit_original`
- `unit_normalized`
- `price_khr`
- `geographic_scope`
- `province`, nullable
- `market`, nullable
- `price_type`: retail, wholesale, or unknown
- `source_type`: WFP_PDF, WFP_HDX, or MANUAL
- `extraction_confidence`
- `validation_status`: pending, approved, or rejected
- `validation_notes`
- timestamps

Create a uniqueness rule that prevents duplicate observations using the meaningful combination of observation date, normalized commodity, normalized unit, geographic scope, province, market, price type, and source.

### `scrape_runs`

Store the start time, finish time, status, reports found, reports processed, records extracted, records inserted, records rejected, and error message for each scheduled run.

Use Row Level Security. Public clients may read only approved observations. Only the server-side service-role client may insert, update, approve, or reject data.

## Required application structure

Use a clean structure similar to:

```text
app/
  api/
    cron/scrape-wfp/route.ts
    prices/route.ts
    reports/route.ts
    admin/observations/[id]/approve/route.ts
    admin/observations/[id]/reject/route.ts
  admin/
    observations/page.tsx
lib/
  supabase/admin.ts
  supabase/public.ts
  scraper/wfp-page.ts
  scraper/pdf-downloader.ts
  scraper/pdf-extractor.ts
  scraper/table-parser.ts
  scraper/normalizer.ts
  scraper/validator.ts
  scraper/pipeline.ts
  schemas/food-price.ts
supabase/
  migrations/
vercel.json
```

You may improve this structure when there is a clear reason.

## Scraping requirements

The scraper must:

- Fetch the WFP publication page with a descriptive user-agent.
- Detect report links from `docs.wfp.org/api/documents/.../download/`.
- Extract the report title and PDF URL.
- Avoid processing a report already stored in `source_reports`.
- Download only new reports.
- Apply request timeouts and limited retries with exponential backoff.
- Avoid aggressive scraping; run no more frequently than necessary.
- Record all successes and failures in `scrape_runs`.
- Continue safely when one report fails.
- Never silently insert partially parsed values as approved data.

## PDF extraction requirements

Focus on annex tables containing food commodity, unit, month, price, and price-change information.

The parser must handle:

- Thousands separators such as `2,011`
- KHR prices
- Units such as KG and litre
- Missing values represented by `-`, blank cells, or symbols
- Multiple month columns
- Report month differing from observation month
- Repeated commodities
- Layout changes between reports
- Khmer or English content when practical

Extract every usable month-price pair rather than only the newest column, but prevent duplicates when observations already exist.

Preserve original extracted text for auditing. Normalize commodity names through an explicit mapping table rather than destructive string replacement. Examples include mixed rice, broken rice, snakehead fish, pork with fat, vegetable oil, and eggs.

If extraction confidence is low or required fields are missing, store the record as pending review or reject it with a reason. Do not invent missing values and do not use an LLM to guess prices.

## Validation requirements

Validate at least the following:

- Observation date is a valid month and is not later than the report publication date.
- Price is numeric and positive.
- Unit is recognized.
- Commodity is not empty.
- Currency is KHR unless explicitly stored otherwise.
- Price changes are within configurable reasonable limits.
- A newly extracted price should be flagged when it differs greatly from the previous approved observation.
- Duplicate observations are not inserted.

Create configurable validation thresholds. Flag suspicious records for manual review instead of deleting them.

## JSON API requirements

Create:

```text
GET /api/prices
```

Support query parameters:

- `commodity`
- `province`
- `market`
- `priceType`
- `startDate`
- `endDate`
- `sourceType`
- `page`
- `limit`

Return approved records only by default.

Example response:

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
      "priceType": "retail",
      "sourceType": "WFP_PDF",
      "sourceUrl": "https://docs.wfp.org/api/documents/.../download/"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1
  },
  "metadata": {
    "latestActualObservation": "2026-06-01",
    "generatedAt": "2026-08-27T00:00:00Z"
  }
}
```

Also create an endpoint that returns source-report processing status without exposing secrets or internal stack traces.

## Admin review requirements

Create a simple protected admin interface that allows an authorized user to:

- View pending observations
- Compare extracted values with nearby approved observations
- Open the original WFP PDF
- Approve an observation
- Reject an observation with notes
- Filter by report, commodity, month, and status

Do not implement insecure authentication. If full authentication is outside the first version, protect all mutation endpoints using a strong server-side admin secret and clearly document the limitation.

## Vercel Cron requirements

Create a protected cron endpoint:

```text
GET /api/cron/scrape-wfp
```

Protect it using `CRON_SECRET` and verify:

```text
Authorization: Bearer <CRON_SECRET>
```

Schedule it weekly. The endpoint must be idempotent: running it repeatedly must not duplicate reports or observations.

## Environment variables

Provide `.env.example` containing only placeholders:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
ADMIN_SECRET=
```

Never commit real credentials. Never expose `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, or `ADMIN_SECRET` to client-side code.

## Prediction integration

Do not train the ML model inside the scraping request.

The data pipeline should expose approved observations through the JSON API. The separate Python prediction service can fetch these records, merge compatible observations with historical data, retrain when new approved actual data exists, and store forecasts separately from actual observations.

Never treat a model prediction as an actual price.

Suggested separation:

```text
food_price_observations = actual and approved source data
food_price_forecasts = model-generated future values
```

## Testing requirements

Add tests for:

- WFP report-link discovery
- Duplicate report detection
- Parsing representative annex text
- Thousands-separator conversion
- Missing-value handling
- Observation-date extraction
- Commodity normalization
- Duplicate observation prevention
- Validation of suspicious price changes
- Cron authorization
- Public API filtering and pagination

Store small, legally appropriate text fixtures derived from table structure rather than complete copyrighted reports.

## Documentation requirements

Create a README explaining:

- System architecture
- Local setup
- Supabase setup and migrations
- Environment variables
- Running the scraper manually
- Running tests
- Deploying to Vercel
- Configuring Vercel Cron
- Reviewing pending observations
- API examples
- Known PDF-extraction limitations
- Difference between publication date and observation date
- Why the project is publication-updated rather than real-time

## Expected implementation process

1. Inspect the existing repository before changing anything.
2. Preserve existing user code and unrelated changes.
3. Propose the final architecture briefly.
4. Implement the database migration and server-side data layer.
5. Implement report discovery and idempotent processing.
6. Implement PDF extraction and validation.
7. Implement the JSON API.
8. Implement the review interface.
9. Add tests.
10. Run linting, type-checking, tests, and a production build.
11. Fix any failures within the requested scope.
12. Provide exact Supabase and Vercel deployment instructions.

## Definition of done

The task is complete when:

- The application builds successfully.
- A protected weekly cron job can check for new WFP reports.
- Already processed reports are skipped safely.
- Extracted observations are stored in Supabase as pending.
- An authorized reviewer can approve or reject observations.
- Only approved observations appear in the public JSON API.
- Duplicate data is prevented.
- Tests cover the critical parsing and security behavior.
- The project can be deployed to Vercel using documented environment variables.
- The system never labels delayed WFP observations as live prices.

