-- Cambodia food-price data pipeline - initial schema.
--
-- Three tables:
--   source_reports          one row per WFP PDF we have seen (the unit of idempotency)
--   food_price_observations one row per (month, commodity, unit, scope, price type) price
--   scrape_runs             one row per scheduled run, for operational visibility
--
-- Nothing here reaches the public API until a human sets validation_status = 'approved'.
-- RLS at the bottom enforces that in the database, so a leaked anon key still cannot read
-- pending rows or write anything at all.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------

create type report_processing_status as enum (
  'discovered',   -- link found on the publication page, nothing downloaded yet
  'downloaded',   -- PDF fetched and hashed
  'extracted',    -- annex parsed, observations written as pending
  'needs_review', -- parsed with low confidence, or layout not recognised
  'approved',     -- a reviewer has signed off on this report's observations
  'failed'        -- download or parse raised; processing_error explains
);

create type observation_price_type  as enum ('retail', 'wholesale', 'unknown');
create type observation_source_type as enum ('WFP_PDF', 'WFP_HDX', 'MANUAL');
create type observation_validation  as enum ('pending', 'approved', 'rejected');

-- ---------------------------------------------------------------------------
-- source_reports
-- ---------------------------------------------------------------------------

create table source_reports (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  publication_date  date,
  source_url        text not null unique,
  document_id       text,
  file_hash         text,
  processing_status report_processing_status not null default 'discovered',
  processing_error  text,
  discovered_at     timestamptz not null default now(),
  processed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- source_url is the idempotency key: a re-run re-discovers the same URLs and the insert
-- becomes a no-op. document_id (e.g. WFP-0000175046) is parsed out of the URL when present
-- and is useful to humans, but it is the URL that guarantees uniqueness.
create index source_reports_status_idx      on source_reports (processing_status);
create index source_reports_document_id_idx on source_reports (document_id);
create index source_reports_publication_idx on source_reports (publication_date desc);

-- ---------------------------------------------------------------------------
-- food_price_observations
-- ---------------------------------------------------------------------------

create table food_price_observations (
  id                    uuid primary key default gen_random_uuid(),
  source_report_id      uuid references source_reports (id) on delete cascade,

  -- Always the first of the observation month. A July report routinely carries June
  -- observations, so this is read from inside the PDF and never from the publication date.
  observation_date      date not null,

  -- *_original preserves exactly what came out of the PDF, for auditing a bad parse.
  -- *_normalized is the join key the prediction model consumes.
  commodity_original    text not null,
  commodity_normalized  text not null,
  unit_original         text not null,
  unit_normalized       text not null,

  price_khr             numeric(12, 2) not null check (price_khr > 0),

  geographic_scope      text not null,
  province              text,
  market                text,

  price_type            observation_price_type  not null default 'unknown',
  source_type           observation_source_type not null default 'WFP_PDF',

  -- 0..1. Below EXTRACTION_CONFIDENCE_MIN the pipeline files the row for review
  -- instead of trusting it.
  extraction_confidence numeric(3, 2) not null default 1.00
                          check (extraction_confidence >= 0 and extraction_confidence <= 1),

  validation_status     observation_validation not null default 'pending',
  validation_notes      text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Duplicate prevention.
--
-- province and market are nullable, and in Postgres NULL <> NULL, so a plain unique
-- constraint over these columns would let the same national-scope row insert forever.
-- Coalescing to the empty string inside a unique INDEX gives NULL and '' one shared
-- identity, which is what we want: "no province recorded" is a single bucket.
create unique index food_price_observations_identity_idx
  on food_price_observations (
    observation_date,
    commodity_normalized,
    unit_normalized,
    geographic_scope,
    coalesce(province, ''),
    coalesce(market, ''),
    price_type,
    source_type
  );

create index food_price_observations_lookup_idx
  on food_price_observations (validation_status, observation_date desc, commodity_normalized);
create index food_price_observations_report_idx
  on food_price_observations (source_report_id);
-- Serves the "previous approved price for this series" spike check in the validator.
create index food_price_observations_series_idx
  on food_price_observations (commodity_normalized, unit_normalized, geographic_scope, observation_date desc)
  where validation_status = 'approved';

-- ---------------------------------------------------------------------------
-- scrape_runs
-- ---------------------------------------------------------------------------

create type scrape_run_status as enum ('running', 'success', 'partial', 'failed');

create table scrape_runs (
  id                 uuid primary key default gen_random_uuid(),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  status             scrape_run_status not null default 'running',
  reports_found      integer not null default 0,
  reports_processed  integer not null default 0,
  records_extracted  integer not null default 0,
  records_inserted   integer not null default 0,
  records_rejected   integer not null default 0,
  error_message      text,
  created_at         timestamptz not null default now()
);

create index scrape_runs_started_idx on scrape_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

create trigger source_reports_touch
  before update on source_reports
  for each row execute function touch_updated_at();

create trigger food_price_observations_touch
  before update on food_price_observations
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- The service-role key bypasses RLS entirely, so these policies describe what the ANON
-- key may do. Writes have no policy at all, which means anon cannot insert, update or
-- delete anywhere: every mutation goes through the server-side service-role client.

alter table source_reports          enable row level security;
alter table food_price_observations enable row level security;
alter table scrape_runs             enable row level security;

-- Approved observations only. Pending and rejected rows are invisible to the public.
create policy "anon reads approved observations"
  on food_price_observations
  for select
  to anon, authenticated
  using (validation_status = 'approved');

-- Report metadata is public (title, date, URL, status) so /api/reports can show
-- processing state. No secrets live in these columns, and the route additionally strips
-- processing_error before responding so parser stack traces never leak.
create policy "anon reads report metadata"
  on source_reports
  for select
  to anon, authenticated
  using (true);

-- scrape_runs is operational data: no anon policy at all, so it is server-side only.
