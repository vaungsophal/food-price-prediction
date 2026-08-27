/**
 * Extraction spot-check against real PDFs.
 *
 * Point it at downloaded WFP reports and it prints what the parser believes, plus a
 * pass/fail against values read by eye out of the PDF. Not part of the test suite, because
 * it needs the copyrighted PDFs on disk - the committed tests run on small structural
 * fixtures instead. Use this whenever WFP changes the layout.
 *
 *   npx tsx scripts/verify-extraction.ts <file.pdf> [...]
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { extractPositionedText } from '../lib/scraper/pdf-extractor'
import { parseAnnexTables } from '../lib/scraper/table-parser'
import { normalizeObservations } from '../lib/scraper/normalizer'

/** Values read by hand from the July 2026 report (WFP-0000175046), annex 2. */
const EXPECTED: Record<string, Array<[string, string, number]>> = {
  'WFP-0000175046': [
    ['mixed_rice', '2026-06-01', 2011],
    ['mixed_rice', '2025-06-01', 2101],
    ['mixed_rice', '2026-01-01', 1905],
    ['mixed_rice', '2026-02-01', 1889],
    ['mixed_rice', '2026-03-01', 1857],
    ['broken_rice_30_35', '2026-06-01', 1883],
    ['snakehead_fish_live', '2026-06-01', 10885],
    ['vegetable_oil', '2026-06-01', 31610],
    ['duck_egg', '2026-06-01', 4875],
    ['iodized_salt', '2026-06-01', 1205],
    ['pork_with_fat', '2026-06-01', 18519],
    ['chinese_spinach', '2026-06-01', 4025],
    ['orange_flesh_sweet_potato', '2026-06-01', 2000],
    ['chinese_kale', '2026-06-01', 5000],
    ['ripe_tamarind_no_seed', '2026-06-01', 12500],
  ],
  'WFP-0000171719': [
    ['mixed_rice', '2026-01-01', 1965],
    ['mixed_rice', '2025-06-01', 2171],
    ['broken_rice_30_35', '2026-01-01', 1800],
    ['snakehead_fish_live', '2026-01-01', 10159],
    ['dried_snakehead_fish', '2025-06-01', 29714],
  ],
}

async function main() {
  const files = process.argv.slice(2)
  if (files.length === 0) {
    console.error('usage: tsx scripts/verify-extraction.ts <file.pdf> [...]')
    process.exit(1)
  }

  let failures = 0

  for (const file of files) {
    const name = basename(file).replace(/\.pdf$/i, '')
    console.log(`\n${'='.repeat(72)}\n${name}\n${'='.repeat(72)}`)

    const doc = await extractPositionedText(new Uint8Array(readFileSync(file)))
    const parsed = parseAnnexTables(doc)

    console.log(`profile          : ${parsed.profile ?? '(none recognised)'}`)
    console.log(`observation date : ${parsed.reportObservationDate ?? '(unknown)'}`)
    console.log(`scope            : ${parsed.geographicScope ?? '(unknown)'}`)
    console.log(`raw cells        : ${parsed.observations.length}`)
    for (const warning of parsed.warnings) console.log(`  ! ${warning}`)

    const { observations, skipped } = normalizeObservations(parsed.observations)
    console.log(`normalized       : ${observations.length}  (skipped ${skipped.length})`)

    const unmapped = [
      ...new Set(
        observations
          .filter((o) => o.commodityNormalized.startsWith('unmapped__'))
          .map((o) => o.commodityOriginal),
      ),
    ]
    if (unmapped.length) console.log(`unmapped names   : ${unmapped.join(', ')}`)

    const months = [...new Set(observations.map((o) => o.observationDate))].sort()
    console.log(`months covered   : ${months.join(', ')}`)

    const expected = EXPECTED[name]
    if (!expected) {
      console.log('\n(no hand-checked expectations for this file)')
      continue
    }

    console.log('\nhand-checked values:')
    for (const [commodity, date, price] of expected) {
      const hit = observations.find(
        (o) => o.commodityNormalized === commodity && o.observationDate === date,
      )
      const ok = hit?.priceKhr === price
      if (!ok) failures++
      console.log(
        `  ${ok ? 'PASS' : 'FAIL'}  ${commodity} ${date}  expected ${price}  got ${hit?.priceKhr ?? '(missing)'}`,
      )
    }
  }

  console.log(failures === 0 ? '\nAll hand-checked values matched.' : `\n${failures} MISMATCH(ES).`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
