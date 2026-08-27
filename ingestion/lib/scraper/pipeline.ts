/**
 * The pipeline: discover -> download -> extract -> normalize -> validate -> store.
 *
 * Idempotency is the load-bearing property, because Vercel Cron gives at-least-once
 * delivery and a reviewer may also trigger a run by hand. It comes from two places, both
 * in the database rather than in this code:
 *
 *   - `source_reports.source_url` is unique, so a report is only ever processed once.
 *   - `food_price_observations` has a unique index over the meaning of an observation, so
 *     re-inserting the same month/commodity/unit/scope/type is a no-op.
 *
 * Insert conflicts are therefore expected and are counted as "already known", not errors.
 *
 * One failing report never takes down a run: each is processed inside its own try/catch,
 * its failure recorded against its own row, and the run continues.
 */

import 'server-only'

import { supabaseAdmin } from '../supabase/admin'
import { PIPELINE, VALIDATION } from '../config'
import { politenessDelay } from '../http'
import { downloadPdf } from './pdf-downloader'
import { extractPositionedText } from './pdf-extractor'
import { parseAnnexTables } from './table-parser'
import { normalizeObservations } from './normalizer'
import { seriesKey, validateAll, type PriorPrice, type ValidationContext } from './validator'
import { discoverReports, isProcessableReport } from './wfp-page'
import type { DiscoveredReport } from '../schemas/food-price'
import type { ReportProcessingStatus, ScrapeRunStatus } from '../supabase/types'

export interface ReportOutcome {
  title: string
  sourceUrl: string
  status: ReportProcessingStatus
  extracted: number
  inserted: number
  rejected: number
  duplicates: number
  message?: string
}

export interface RunSummary {
  runId: string | null
  status: ScrapeRunStatus
  reportsFound: number
  reportsProcessed: number
  recordsExtracted: number
  recordsInserted: number
  recordsRejected: number
  skippedAlreadyKnown: number
  outcomes: ReportOutcome[]
  error?: string
}

/** Postgres unique-violation. Expected on re-runs, so it is a signal rather than a fault. */
const UNIQUE_VIOLATION = '23505'

export async function runScrape(options: { maxReports?: number } = {}): Promise<RunSummary> {
  const db = supabaseAdmin()
  const maxReports = options.maxReports ?? PIPELINE.maxReportsPerRun

  const { data: run } = await db
    .from('scrape_runs')
    .insert({ status: 'running' })
    .select('id')
    .single()

  const runId = run?.id ?? null

  const summary: RunSummary = {
    runId,
    status: 'success',
    reportsFound: 0,
    reportsProcessed: 0,
    recordsExtracted: 0,
    recordsInserted: 0,
    recordsRejected: 0,
    skippedAlreadyKnown: 0,
    outcomes: [],
  }

  try {
    const discovered = (await discoverReports()).filter(isProcessableReport)
    summary.reportsFound = discovered.length

    // Ask the database which URLs it already holds, rather than checking one at a time.
    const { data: known } = await db
      .from('source_reports')
      .select('source_url')
      .in(
        'source_url',
        discovered.map((report) => report.sourceUrl),
      )

    const knownUrls = new Set((known ?? []).map((row) => row.source_url))
    const fresh = discovered.filter((report) => !knownUrls.has(report.sourceUrl))
    summary.skippedAlreadyKnown = discovered.length - fresh.length

    // Newest first (discoverReports sorts), capped so one run cannot exceed the function
    // budget while chewing through the ~30-report backlog.
    const batch = fresh.slice(0, maxReports)

    for (const [index, report] of batch.entries()) {
      if (index > 0) await politenessDelay()

      const outcome = await processReport(report)
      summary.outcomes.push(outcome)
      summary.reportsProcessed++
      summary.recordsExtracted += outcome.extracted
      summary.recordsInserted += outcome.inserted
      summary.recordsRejected += outcome.rejected

      if (outcome.status === 'failed') summary.status = 'partial'
    }

    await finishRun(runId, summary)
    return summary
  } catch (error) {
    summary.status = 'failed'
    summary.error = error instanceof Error ? error.message : String(error)
    await finishRun(runId, summary)
    return summary
  }
}

async function finishRun(runId: string | null, summary: RunSummary): Promise<void> {
  if (!runId) return

  await supabaseAdmin()
    .from('scrape_runs')
    .update({
      finished_at: new Date().toISOString(),
      status: summary.status,
      reports_found: summary.reportsFound,
      reports_processed: summary.reportsProcessed,
      records_extracted: summary.recordsExtracted,
      records_inserted: summary.recordsInserted,
      records_rejected: summary.recordsRejected,
      error_message: summary.error ?? null,
    })
    .eq('id', runId)
}

async function processReport(report: DiscoveredReport): Promise<ReportOutcome> {
  const db = supabaseAdmin()

  const outcome: ReportOutcome = {
    title: report.title,
    sourceUrl: report.sourceUrl,
    status: 'discovered',
    extracted: 0,
    inserted: 0,
    rejected: 0,
    duplicates: 0,
  }

  // Claim the report first. Doing this before the download means a crash mid-parse still
  // leaves a row a human can see, instead of a report that vanishes until the next run.
  const { data: inserted, error: insertError } = await db
    .from('source_reports')
    .insert({
      title: report.title,
      publication_date: report.publicationDate,
      source_url: report.sourceUrl,
      document_id: report.documentId,
      processing_status: 'discovered',
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    // A concurrent run claimed it first. That is the unique constraint doing its job.
    if (insertError?.code === UNIQUE_VIOLATION) {
      outcome.status = 'discovered'
      outcome.message = 'already claimed by another run'
      return outcome
    }
    outcome.status = 'failed'
    outcome.message = insertError?.message ?? 'could not record the report'
    return outcome
  }

  const reportId = inserted.id

  try {
    const pdf = await downloadPdf(report.sourceUrl)
    await db
      .from('source_reports')
      .update({ processing_status: 'downloaded', file_hash: pdf.fileHash })
      .eq('id', reportId)

    const document = await extractPositionedText(pdf.bytes)
    const parsed = parseAnnexTables(document)

    // An unrecognised layout yields nothing and says so. Extracting "something" from a
    // layout the parser was not built for is how wrong prices get into a dataset.
    if (!parsed.profile || parsed.observations.length === 0) {
      await markReport(reportId, 'needs_review', parsed.warnings.join('; ') || 'no observations extracted')
      outcome.status = 'needs_review'
      outcome.message = parsed.warnings.join('; ') || 'no observations extracted'
      return outcome
    }

    const { observations, skipped } = normalizeObservations(parsed.observations)
    outcome.extracted = observations.length

    const context: ValidationContext = {
      publicationDate: report.publicationDate,
      priorPrices: await loadPriorPrices(observations),
    }

    const validated = validateAll(observations, context)

    const rows = validated.map((entry) => ({
      source_report_id: reportId,
      observation_date: entry.candidate.observationDate,
      commodity_original: entry.candidate.commodityOriginal,
      commodity_normalized: entry.candidate.commodityNormalized,
      unit_original: entry.candidate.unitOriginal,
      unit_normalized: entry.candidate.unitNormalized,
      price_khr: entry.candidate.priceKhr,
      geographic_scope: entry.candidate.geographicScope,
      province: entry.candidate.province,
      market: entry.candidate.market,
      price_type: entry.candidate.priceType,
      source_type: entry.candidate.sourceType,
      extraction_confidence: entry.candidate.extractionConfidence,
      // Never 'approved'. Approval is a human action, taken in the admin UI.
      validation_status: entry.status,
      validation_notes: entry.candidate.validationNotes,
    }))

    // ignoreDuplicates leans on the unique index: a re-run inserts nothing and errors on
    // nothing. `count` reports how many rows were genuinely new.
    const { count, error: writeError } = await db
      .from('food_price_observations')
      .upsert(rows, {
        onConflict:
          'observation_date,commodity_normalized,unit_normalized,geographic_scope,province,market,price_type,source_type',
        ignoreDuplicates: true,
        count: 'exact',
      })

    if (writeError) throw new Error(`storing observations failed: ${writeError.message}`)

    outcome.inserted = count ?? 0
    outcome.duplicates = rows.length - outcome.inserted
    outcome.rejected = validated.filter((entry) => entry.status === 'rejected').length

    const needsReview =
      outcome.rejected > 0 ||
      skipped.length > 0 ||
      parsed.warnings.length > 0 ||
      validated.some(
        (entry) => entry.candidate.extractionConfidence < VALIDATION.extractionConfidenceMin,
      )

    await markReport(
      reportId,
      needsReview ? 'needs_review' : 'extracted',
      needsReview
        ? [
            ...parsed.warnings,
            outcome.rejected ? `${outcome.rejected} record(s) rejected by validation` : '',
            skipped.length ? `${skipped.length} row(s) skipped during normalization` : '',
          ]
            .filter(Boolean)
            .join('; ')
        : null,
    )

    outcome.status = needsReview ? 'needs_review' : 'extracted'
    return outcome
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markReport(reportId, 'failed', message)
    outcome.status = 'failed'
    outcome.message = message
    return outcome
  }
}

async function markReport(
  reportId: string,
  status: ReportProcessingStatus,
  error: string | null,
): Promise<void> {
  await supabaseAdmin()
    .from('source_reports')
    .update({
      processing_status: status,
      processing_error: error,
      processed_at: new Date().toISOString(),
    })
    .eq('id', reportId)
}

/**
 * Most recent APPROVED price for each series being written, for the spike check.
 *
 * Deliberately approved-only: comparing a new extraction against an unreviewed one would
 * let a bad parse establish itself as the baseline and quietly normalise its successors.
 */
async function loadPriorPrices(
  observations: Array<{
    commodityNormalized: string
    unitNormalized: string
    geographicScope: string
  }>,
): Promise<Map<string, PriorPrice>> {
  const commodities = [...new Set(observations.map((o) => o.commodityNormalized))]
  if (commodities.length === 0) return new Map()

  const { data } = await supabaseAdmin()
    .from('food_price_observations')
    .select('commodity_normalized, unit_normalized, geographic_scope, price_khr, observation_date')
    .eq('validation_status', 'approved')
    .in('commodity_normalized', commodities)
    .order('observation_date', { ascending: false })

  const prices = new Map<string, PriorPrice>()

  for (const row of data ?? []) {
    // Rows arrive newest first, so the first hit per series is the one we want.
    const key = seriesKey(row.commodity_normalized, row.unit_normalized, row.geographic_scope)
    if (prices.has(key)) continue

    prices.set(key, {
      commodityNormalized: row.commodity_normalized,
      unitNormalized: row.unit_normalized,
      geographicScope: row.geographic_scope,
      priceKhr: Number(row.price_khr),
      observationDate: row.observation_date,
    })
  }

  return prices
}
