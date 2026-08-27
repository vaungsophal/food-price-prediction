/**
 * Run the pipeline by hand, without the cron.
 *
 *   npm run scrape              process up to MAX_REPORTS_PER_RUN new reports
 *   npm run scrape -- --max 1   process at most one
 *   npm run scrape -- --dry     discover only; touch nothing in the database
 *
 * Needs the same environment as the deployed app, so run it with a .env.local in place.
 * Everything it writes lands as pending, exactly as the cron would - this script has no
 * way to approve anything.
 */

import { config } from 'dotenv'
import { existsSync } from 'node:fs'

// Loaded before anything that reads process.env.
for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) config({ path: file })
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry')
  const maxIndex = args.indexOf('--max')
  const maxReports = maxIndex >= 0 ? Number(args[maxIndex + 1]) : undefined

  if (dryRun) {
    const { discoverReports, isProcessableReport } = await import('../lib/scraper/wfp-page')
    const reports = await discoverReports()
    const processable = reports.filter(isProcessableReport)

    console.log(`Discovered ${reports.length} report link(s); ${processable.length} processable.\n`)
    for (const report of processable.slice(0, 15)) {
      console.log(`  ${report.publicationDate ?? '????-??-??'}  ${report.documentId}  ${report.title}`)
    }
    console.log('\nDry run: nothing was written.')
    return
  }

  const { runScrape } = await import('../lib/scraper/pipeline')
  const summary = await runScrape(maxReports ? { maxReports } : {})

  console.log(`\nrun ${summary.runId ?? '(not recorded)'} finished: ${summary.status}`)
  console.log(`  reports found      ${summary.reportsFound}`)
  console.log(`  already known      ${summary.skippedAlreadyKnown}`)
  console.log(`  reports processed  ${summary.reportsProcessed}`)
  console.log(`  records extracted  ${summary.recordsExtracted}`)
  console.log(`  records inserted   ${summary.recordsInserted}`)
  console.log(`  records rejected   ${summary.recordsRejected}`)

  if (summary.outcomes.length > 0) console.log('')
  for (const outcome of summary.outcomes) {
    console.log(`  [${outcome.status}] ${outcome.title}`)
    console.log(
      `      extracted ${outcome.extracted}, inserted ${outcome.inserted}, ` +
        `duplicates ${outcome.duplicates}, rejected ${outcome.rejected}`,
    )
    if (outcome.message) console.log(`      ${outcome.message}`)
  }

  if (summary.error) console.error(`\nerror: ${summary.error}`)

  console.log('\nEverything written is PENDING. Review it at /admin/observations.')
  process.exit(summary.status === 'failed' ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
