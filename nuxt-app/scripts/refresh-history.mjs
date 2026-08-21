/**
 * refresh-history.mjs - rebuild history.json from the live HDX feed.
 *
 * The trained artifacts (model.json, encoders.json, feature_cols.json) come out of the
 * notebook and only change when the model is retrained. history.json is different: it is
 * pure data transformation over the WFP CSV, so it can be refreshed without Python, without
 * the pickles, and without retraining anything.
 *
 * That works because the model has no notion of absolute time. Its features are five label
 * encodings, month, quarter, and three lags - no year, no date. Hand it lag features from a
 * newer observation and it forecasts the period after that one, unchanged.
 *
 *     npm run refresh        rebuild by hand
 *     npm run build          runs automatically first
 *
 * Filters mirror notebook cell 14 exactly (2019 onward, commodities with 300+ rows) so the
 * refreshed file stays consistent with the cohort the model was trained on.
 *
 * On a network failure this warns and exits 0, leaving the committed history.json in place -
 * a deploy should not fail because HDX is briefly unreachable.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PACKAGE_API = 'https://data.humdata.org/api/3/action/package_show?id=wfp-food-prices-for-cambodia'
const CSV_BASENAME = 'wfp_food_prices_khm.csv'
const FROM_DATE = '2019-01-01'
const MIN_ROWS_PER_COMMODITY = 300
const CHART_POINTS = 24
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000
const DOWNLOAD_ATTEMPTS = 3

const ARTIFACTS = new URL('../server/assets/artifacts/', import.meta.url)
const historyPath = fileURLToPath(new URL('history.json', ARTIFACTS))
const encodersPath = fileURLToPath(new URL('encoders.json', ARTIFACTS))
const stampPath = fileURLToPath(new URL('source.json', ARTIFACTS))

/** Minimal RFC 4180 parser - commodity names carry commas inside quotes. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      }
      else field += c
      continue
    }

    if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }

  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

function fail(message, error) {
  console.warn(`\n  refresh-history: ${message}`)
  if (error) console.warn(`  ${error.message}`)
  console.warn('  Keeping the committed history.json. Build continues.\n')
  process.exit(0)
}

// ---------- 1. Resolve the CSV through the HDX package API ----------
// Resolving by dataset id rather than hardcoding the download URL means a re-upload
// (which mints a new resource id) does not silently break the refresh.
let pkg
try {
  const response = await fetch(PACKAGE_API)
  if (!response.ok) throw new Error(`HDX package_show returned ${response.status}`)
  pkg = await response.json()
}
catch (error) {
  fail('could not reach the HDX package API.', error)
}

if (!pkg?.success) fail('HDX package_show reported failure.')

const resource = pkg.result.resources.find(
  (r) => r.format?.toUpperCase() === 'CSV' && r.url?.endsWith(CSV_BASENAME),
)
if (!resource) fail(`no CSV resource named ${CSV_BASENAME} in the dataset.`)

console.log(`  dataset coverage : ${pkg.result.dataset_date}`)
console.log(`  resource updated : ${resource.last_modified}`)

// ---------- 2. Skip the download when HDX has not republished ----------
// The CSV is ~12 MB and can take minutes to pull, so no build should pay for it blindly.
// package_show is 31 KB and already says whether the resource changed, so the common case
// costs one small request.
const force = process.argv.includes('--force')
let stamp = null
try { stamp = JSON.parse(readFileSync(stampPath, 'utf8')) }
catch { /* never refreshed before */ }

if (!force && stamp?.resourceLastModified === resource.last_modified && existsSync(historyPath)) {
  console.log('\n  history.json is already built from this exact resource revision.')
  console.log('  Nothing to download. Pass --force to rebuild anyway.\n')
  process.exit(0)
}

// ---------- 3. Download ----------
console.log(`  downloading      : ${(Number(resource.size) / 1e6).toFixed(1)} MB, this can take minutes`)
let csv
for (let attempt = 1; ; attempt++) {
  try {
    const response = await fetch(resource.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    if (!response.ok) throw new Error(`download returned ${response.status}`)
    csv = await response.text()
    break
  }
  catch (error) {
    if (attempt >= DOWNLOAD_ATTEMPTS) fail(`could not download the price CSV after ${attempt} attempts.`, error)
    console.warn(`  attempt ${attempt} failed (${error.message}); retrying`)
  }
}

const rows = parseCsv(csv)
const header = rows.shift()
const col = Object.fromEntries(header.map((name, i) => [name, i]))
for (const needed of ['date', 'admin1', 'category', 'commodity', 'market', 'unit', 'pricetype', 'usdprice']) {
  if (col[needed] === undefined) fail(`the CSV is missing the "${needed}" column - WFP changed the schema.`)
}
console.log(`  rows downloaded  : ${rows.length.toLocaleString()}`)

// ---------- 4. Filter to the cohort the model was trained on ----------
const fromDate = rows.filter((r) => r[col.date] >= FROM_DATE && Number.isFinite(Number(r[col.usdprice])))

const perCommodity = new Map()
for (const r of fromDate) perCommodity.set(r[col.commodity], (perCommodity.get(r[col.commodity]) ?? 0) + 1)
const kept = fromDate.filter((r) => perCommodity.get(r[col.commodity]) >= MIN_ROWS_PER_COMMODITY)

console.log(`  after filtering  : ${kept.length.toLocaleString()} rows, `
  + `${new Set(kept.map((r) => r[col.commodity])).size} commodities`)

// ---------- 5. Group into (commodity, market, pricetype) series ----------
// The grouping fields are carried on the bucket rather than packed into the key, so no
// separator has to be chosen that the data is guaranteed not to contain.
const series = new Map()
for (const r of kept) {
  const commodity = r[col.commodity]
  const market = r[col.market]
  const pricetype = r[col.pricetype]
  const key = JSON.stringify([commodity, market, pricetype])

  let bucket = series.get(key)
  if (!bucket) series.set(key, (bucket = { commodity, market, pricetype, rows: [] }))
  bucket.rows.push(r)
}

// ---------- 6. Emit, dropping anything the encoders cannot encode ----------
// A label the trained LabelEncoders never saw has no integer code, so the predictor could
// not build a feature vector for it. Skipping is safe; the report says what was skipped so
// a genuinely new commodity or market is visible as a reason to retrain.
const encoders = JSON.parse(readFileSync(encodersPath, 'utf8'))
const known = Object.fromEntries(
  Object.entries(encoders).map(([column, map]) => [column, new Set(Object.keys(map))]),
)

const ordered = [...series.values()].sort((a, b) =>
  a.commodity.localeCompare(b.commodity, 'en')
  || a.market.localeCompare(b.market, 'en')
  || a.pricetype.localeCompare(b.pricetype, 'en'))

const history = {}
const unknown = { commodity: new Set(), market: new Set(), admin1: new Set(), category: new Set(), pricetype: new Set() }
let skippedShort = 0
let skippedUnencodable = 0

for (const { commodity, market, pricetype, rows: points } of ordered) {
  points.sort((a, b) => (a[col.date] < b[col.date] ? -1 : a[col.date] > b[col.date] ? 1 : 0))
  const window = points.slice(-CHART_POINTS)
  const last = window[window.length - 1]
  const admin1 = last[col.admin1]
  const category = last[col.category]

  let encodable = true
  for (const [column, value] of [['commodity', commodity], ['market', market], ['admin1', admin1],
    ['category', category], ['pricetype', pricetype]]) {
    if (!known[column]?.has(value)) { unknown[column].add(value); encodable = false }
  }

  // lag_3 and rolling_mean_3 both need three observations.
  if (window.length < 3) { skippedShort++; continue }
  if (!encodable) { skippedUnencodable++; continue }

  const byMarket = (history[commodity] ??= {})
  const byType = (byMarket[market] ??= {})
  byType[pricetype] = {
    admin1,
    category,
    unit: last[col.unit],
    dates: window.map((r) => r[col.date].slice(0, 7)),
    prices: window.map((r) => Number(Number(r[col.usdprice]).toFixed(3))),
  }
}

// ---------- 7. Record what was built, and report ----------
const commodities = Object.keys(history).length
const markets = new Set(Object.values(history).flatMap((m) => Object.keys(m))).size
const emitted = Object.values(history)
  .reduce((n, m) => n + Object.values(m).reduce((k, t) => k + Object.keys(t).length, 0), 0)

let previous = null
try { previous = readFileSync(historyPath, 'utf8') }
catch { /* first run */ }

const next = JSON.stringify(history)
writeFileSync(historyPath, next)

// The stamp is what lets the next build skip the download. It doubles as a record of
// exactly which published revision the shipped forecasts were built from.
writeFileSync(stampPath, `${JSON.stringify({
  datasetDate: pkg.result.dataset_date,
  resourceLastModified: resource.last_modified,
  refreshedAt: new Date().toISOString(),
  rowsDownloaded: rows.length,
  seriesEmitted: emitted,
}, null, 2)}\n`)

console.log(`  written          : ${commodities} commodities, ${markets} markets, ${emitted.toLocaleString()} series`)
console.log(`  skipped          : ${skippedShort} too short, ${skippedUnencodable} unencodable`)

for (const [column, values] of Object.entries(unknown)) {
  if (values.size) {
    console.log(`\n  NEW ${column} labels the model has never seen (${values.size}) - retrain to include them:`)
    for (const v of [...values].sort().slice(0, 10)) console.log(`    - ${v}`)
    if (values.size > 10) console.log(`    ... and ${values.size - 10} more`)
  }
}

console.log(previous === next
  ? '\n  history.json unchanged - the feed has published nothing new.\n'
  : '\n  history.json updated.\n')
