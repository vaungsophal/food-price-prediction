/**
 * GET /api/cron/scrape-wfp - the scheduled entry point.
 *
 * Protected by CRON_SECRET. Vercel Cron sends it as `Authorization: Bearer <secret>`.
 *
 * Safe to call repeatedly: the run is idempotent (see lib/scraper/pipeline.ts), so a
 * retried delivery re-discovers the same reports and inserts nothing.
 */

import { isAuthorizedCron, unauthorized } from '@/lib/auth'
import { runScrape } from '@/lib/scraper/pipeline'

// pdf.js and node:crypto both need the Node runtime; this cannot run on the edge.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Downloading and parsing several multi-megabyte PDFs does not fit in the default 10s.
export const maxDuration = 300

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return unauthorized()

  const summary = await runScrape()

  // 200 even for a partial run: the work is recorded in scrape_runs, and a non-2xx would
  // make Vercel retry a run that already did everything it could.
  return Response.json(
    {
      status: summary.status,
      runId: summary.runId,
      reportsFound: summary.reportsFound,
      reportsProcessed: summary.reportsProcessed,
      skippedAlreadyKnown: summary.skippedAlreadyKnown,
      recordsExtracted: summary.recordsExtracted,
      recordsInserted: summary.recordsInserted,
      recordsRejected: summary.recordsRejected,
      outcomes: summary.outcomes,
      error: summary.error ?? null,
    },
    { status: 200 },
  )
}
