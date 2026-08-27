/**
 * Annex table parsing, driven by named layout profiles.
 *
 * WFP has changed this report's layout at least three times in two years:
 *
 *   2024        "Cambodia - Market & Seasonal Monitoring", annex titled
 *               "Annex 1: Change in retail prices"
 *   2025 Q2-Q4  "Quarterly Market Monitoring Update", landscape, TWO side-by-side tables,
 *               units folded into the commodity name as "(kg)", Sep/Oct/Nov columns
 *               doubled across two years plus quarter averages
 *   2025-10 on  "Market Situation Update", portrait, one table headed either
 *               "Annex 2: Retail prices and changes ..." or "Table 1: Retail prices and
 *               changes as of <Month> <Year>", with Mon'YY columns and Change columns
 *
 * A single adaptive parser across all of those is a parser that quietly produces wrong
 * numbers on the layout it was not built for. Instead each layout is a profile that must
 * positively identify itself. An annex nobody recognises yields ZERO observations and
 * flags the report as needs_review - a human then looks at it. Silence beats fiction here,
 * because a wrong price is indistinguishable from a right one once it is in the table.
 *
 * Only the current monthly profile is implemented; see README "Known limitations".
 */

import {
  groupIntoRows,
  joinItems,
  type ExtractedDocument,
  type ExtractedPage,
  type PositionedItem,
  type PositionedRow,
} from './pdf-extractor'

export type PriceType = 'retail' | 'wholesale' | 'unknown'

/** One commodity-month-price cell, straight out of the PDF and not yet normalized. */
export interface RawObservation {
  commodityOriginal: string
  unitOriginal: string
  /** First of the observation month, YYYY-MM-DD. */
  observationDate: string
  priceKhr: number
  priceOriginal: string
  geographicScope: string
  priceType: PriceType
  extractionConfidence: number
  notes: string[]
  pageNumber: number
}

export interface TableParseResult {
  /** Profile that claimed the document, or null when none recognised it. */
  profile: string | null
  observations: RawObservation[]
  /** Headline observation month of the report, YYYY-MM-DD. */
  reportObservationDate: string | null
  geographicScope: string | null
  warnings: string[]
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const MONTH_NAMES = Object.keys(MONTHS).join('|')

/** Apostrophes seen in these PDFs: ASCII, right single quote, backtick, prime. */
const APOSTROPHES = "'’‘`ʼ′"

/** Column header like Jun'25 / Jan’26. */
const MONTH_COLUMN_RE = new RegExp(
  `^(${MONTH_NAMES})[a-z]*\\s*[${APOSTROPHES}]?\\s*(\\d{2}|\\d{4})$`,
  'i',
)

/** Heading month like "as of June 2026". */
const HEADING_MONTH_RE = new RegExp(
  `as of\\s+(${MONTH_NAMES})[a-z]*\\s+(\\d{4})`,
  'i',
)

/**
 * A price cell: digits with optional thousands separators and optional decimals.
 * Deliberately rejects anything carrying a percent sign, so the Change columns can never
 * be mistaken for prices even if column snapping drifts.
 */
const PRICE_RE = /^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\d+(?:\.\d{1,2})?$/

/** Cells that legitimately mean "no price recorded". Never invent a value for these. */
const MISSING_RE = /^[-–—−.•●⚫➜→\s]*$/

// ---------------------------------------------------------------------------
// Geographic scope
// ---------------------------------------------------------------------------

/**
 * Scope matters more than it looks. The July 2026 report covers 10 Tonle Sap provinces;
 * the January 2026 report covers seven Cambodia-Thailand border provinces and never says
 * so in the table heading. Blending those two into one series would produce a price
 * "history" that jumps between two different sets of markets - a silent data error that a
 * model would happily learn from.
 *
 * So scope is only ever taken from an explicit statement. Failing that it becomes
 * `unspecified`, which is its own bucket in the uniqueness key (so it cannot merge with a
 * known scope) and carries a confidence penalty that forces human review.
 */
export const UNSPECIFIED_SCOPE = 'unspecified (see source report)'

/** Counts WFP writes out in prose ("seven provinces along the border"). */
const WORD_NUMBERS: Record<string, string> = {
  five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', twenty: '20', 'twenty-four': '24',
}

const count = (raw: string) => WORD_NUMBERS[raw.toLowerCase()] ?? raw

const SCOPE_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/\b(\d+)\s+Tonle\s+Sap\s+provinces/i, (m) => `${count(m[1])} Tonle Sap provinces`],
  [/\b(\d+)\s+HGSF\s+provinces/i, (m) => `${count(m[1])} HGSF provinces`],
  // The dash between Cambodia and Thailand is a hyphen in one report and an en dash in
  // the next, and is sometimes dropped entirely by text extraction.
  [
    /\b(\d+|[a-z]+)\s+provinces\s+along\s+the\s+Cambodia\s*[-–—]?\s*Thailand\s+border/i,
    (m) => `${count(m[1])} Cambodia-Thailand border provinces`,
  ],
  [
    /\b(\d+|[a-z]+)\s+Cambodia\s*[-–—]?\s*Thailand\s+border\s+provinces/i,
    (m) => `${count(m[1])} Cambodia-Thailand border provinces`,
  ],
  [/\b(\d+)\s+provinces\s+nationwide/i, (m) => `${count(m[1])} provinces nationwide`],
]

export function detectGeographicScope(text: string): string | null {
  // pdf.js emits every positioned run separately, so joined page text is full of runs of
  // spaces: "seven   provinces   along   the   Cambodia -  Thailand   border". Collapse
  // whitespace first or each of these patterns misses on the real documents.
  const flat = text.replace(/\s+/g, ' ')

  for (const [re, format] of SCOPE_PATTERNS) {
    const match = flat.match(re)
    if (match) return format(match)
  }
  return null
}

// ---------------------------------------------------------------------------
// Small parsing helpers (exported for direct unit testing)
// ---------------------------------------------------------------------------

/**
 * "2,011" -> 2011, "-" -> null, "8.3%" -> null.
 * Returns null for every non-price rather than throwing: a table is full of legitimate
 * non-prices and the caller decides what each absence means.
 */
export function parsePrice(raw: string): number | null {
  const text = raw.trim()
  if (!text || MISSING_RE.test(text)) return null
  if (!PRICE_RE.test(text)) return null

  const value = Number(text.replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

/** "Jun'25" -> 2025-06-01. Two-digit years are 2000-based; these reports start in 2019. */
export function parseMonthColumn(raw: string): string | null {
  const match = raw.trim().match(MONTH_COLUMN_RE)
  if (!match) return null

  const month = MONTHS[match[1].toLowerCase()]
  if (!month) return null

  const rawYear = Number(match[2])
  const year = match[2].length === 2 ? 2000 + rawYear : rawYear

  return `${year}-${String(month).padStart(2, '0')}-01`
}

/** "as of June 2026" -> 2026-06-01. */
export function parseHeadingMonth(heading: string): string | null {
  const match = heading.match(HEADING_MONTH_RE)
  if (!match) return null

  const month = MONTHS[match[1].toLowerCase()]
  if (!month) return null

  return `${match[2]}-${String(month).padStart(2, '0')}-01`
}

const centerOf = (item: PositionedItem) => item.x + item.width / 2

// ---------------------------------------------------------------------------
// Monthly profile
// ---------------------------------------------------------------------------

const MONTHLY_HEADING_RE =
  /(?:Annex\s*\d+|Table\s*\d+)\s*:\s*(Retail|Wholesale)\s+prices\s+and\s+changes/i

interface MonthColumn {
  date: string
  center: number
}

interface TableLayout {
  priceType: PriceType
  heading: string
  headerRow: PositionedRow
  months: MonthColumn[]
  /** Voronoi boundaries between month columns. */
  boundaries: number[]
  /** Commodity text lives left of this. */
  commodityRight: number
  unitCenter: number
  /** Everything at or beyond this x is a Change column, never a price. */
  valuesRight: number
}

function findMonthlyLayout(page: ExtractedPage, rows: PositionedRow[]): TableLayout | null {
  const headingRow = rows.find((row) => MONTHLY_HEADING_RE.test(joinItems(row.items)))
  if (!headingRow) return null

  const heading = joinItems(headingRow.items)
  const priceType: PriceType = /wholesale/i.test(heading) ? 'wholesale' : 'retail'

  // The column header row: at least three Mon'YY cells. Three rather than one, because
  // "Change compared to Mar'26" continuation lines also contain a month token and must
  // not be mistaken for the header.
  let headerRow: PositionedRow | null = null
  let monthItems: PositionedItem[] = []

  for (const row of rows) {
    if (row.y >= headingRow.y) continue
    const months = row.items.filter((item) => parseMonthColumn(item.text) !== null)
    if (months.length >= 3) {
      headerRow = row
      monthItems = months
      break
    }
  }
  if (!headerRow) return null

  const months: MonthColumn[] = monthItems
    .map((item) => ({ date: parseMonthColumn(item.text)!, center: centerOf(item) }))
    .sort((a, b) => a.center - b.center)

  // Deduplicate repeated month headers, keeping the leftmost occurrence.
  const seen = new Set<string>()
  const unique = months.filter((m) => (seen.has(m.date) ? false : (seen.add(m.date), true)))
  if (unique.length < 3) return null

  // The Unit header is what separates commodity text from the price grid. The
  // "Food commodity" header is not needed: the commodity column always starts at the left
  // margin, so the unit column's left edge is the only boundary that matters.
  const unitHeader = headerRow.items.find((i) => /^unit$/i.test(i.text.trim()))

  // Left edge of the first month column, used as the commodity/unit cutoff when the
  // header labels themselves are missing.
  const firstMonth = unique[0].center
  const commodityRight = unitHeader ? unitHeader.x - 2 : firstMonth - 40
  const unitCenter = unitHeader ? centerOf(unitHeader) : commodityRight + 10

  // First non-month header sitting right of the last month column bounds the price region.
  const lastMonth = unique[unique.length - 1].center
  const changeHeader = headerRow.items
    .filter((i) => i.x > lastMonth && parseMonthColumn(i.text) === null && i.text.trim())
    .sort((a, b) => a.x - b.x)[0]

  const spacing =
    unique.length > 1 ? (lastMonth - firstMonth) / (unique.length - 1) : 40
  const valuesRight = changeHeader ? changeHeader.x - 1 : lastMonth + spacing / 2

  const boundaries: number[] = []
  for (let i = 0; i < unique.length - 1; i++) {
    boundaries.push((unique[i].center + unique[i + 1].center) / 2)
  }

  return {
    priceType,
    heading,
    headerRow,
    months: unique,
    boundaries,
    commodityRight,
    unitCenter,
    valuesRight,
  }
}

/** Which month column does this x belong to? Voronoi over the header centers. */
function columnFor(layout: TableLayout, center: number): MonthColumn | null {
  if (center >= layout.valuesRight) return null

  let index = 0
  while (index < layout.boundaries.length && center >= layout.boundaries[index]) index++

  return layout.months[index] ?? null
}

interface RowFragment {
  y: number
  labelItems: PositionedItem[]
  unitItems: PositionedItem[]
  priceCells: Map<string, PositionedItem>
  /** True once this fragment absorbed a neighbour, which costs confidence. */
  merged: boolean
}

function splitRow(layout: TableLayout, row: PositionedRow): RowFragment {
  const labelItems: PositionedItem[] = []
  const unitItems: PositionedItem[] = []
  const priceCells = new Map<string, PositionedItem>()

  for (const item of row.items) {
    const center = centerOf(item)

    if (item.x < layout.commodityRight) {
      labelItems.push(item)
      continue
    }

    // The unit cell sits between the commodity text and the first month column.
    if (center < layout.months[0].center - (layout.months[0].center - layout.unitCenter) / 2) {
      unitItems.push(item)
      continue
    }

    if (parsePrice(item.text) === null) continue

    const column = columnFor(layout, center)
    // Keep the first cell that claims a column. A second one means the geometry is
    // ambiguous, and overwriting would silently pick the rightmost number.
    if (column && !priceCells.has(column.date)) priceCells.set(column.date, item)
  }

  return { y: row.y, labelItems, unitItems, priceCells, merged: false }
}

/**
 * Reunite rows that the PDF split across two baselines.
 *
 * Partway down the July 2026 annex the commodity name and its unit start rendering ~3pt
 * above their own prices, so a row arrives as "Chinese spinach | KG" followed by a
 * bare numeric row. Neither half is usable alone, and dropping them would silently lose
 * a third of the table.
 */
function coalesce(fragments: RowFragment[], maxGap: number): RowFragment[] {
  const out: RowFragment[] = []

  for (const fragment of fragments) {
    const previous = out[out.length - 1]
    const hasLabel = fragment.labelItems.length > 0
    const hasPrices = fragment.priceCells.size > 0

    // Exactly one side brings the label and the other brings the prices, and neither
    // duplicates what the other already has.
    const isSplitRow =
      (previous !== undefined && previous.priceCells.size === 0 && hasPrices &&
        previous.labelItems.length > 0 && !hasLabel) ||
      (previous !== undefined && previous.labelItems.length === 0 && hasLabel &&
        previous.priceCells.size > 0 && !hasPrices)

    // A wrapped commodity name: "Orange-flesh Sweet" then "Potatoes*" on the next
    // baseline. The tell is the absent unit cell - every real commodity row carries one,
    // including rows whose prices are all "-", so this cannot swallow a priceless row.
    const isLabelContinuation =
      previous !== undefined &&
      hasLabel &&
      !hasPrices &&
      fragment.unitItems.length === 0 &&
      previous.labelItems.length > 0

    const canMerge =
      previous !== undefined &&
      previous.y - fragment.y <= maxGap &&
      (isSplitRow || isLabelContinuation)

    if (canMerge) {
      previous.labelItems.push(...fragment.labelItems)
      previous.unitItems.push(...fragment.unitItems)
      for (const [date, item] of fragment.priceCells) {
        if (!previous.priceCells.has(date)) previous.priceCells.set(date, item)
      }
      previous.merged = true
      continue
    }

    out.push(fragment)
  }

  return out
}

function parseMonthlyPage(
  page: ExtractedPage,
  documentText: string,
): { observations: RawObservation[]; layout: TableLayout; scope: string } | null {
  const rows = groupIntoRows(page.items)
  const layout = findMonthlyLayout(page, rows)
  if (!layout) return null

  const scope =
    detectGeographicScope(layout.heading) ??
    detectGeographicScope(page.rawText) ??
    detectGeographicScope(documentText) ??
    UNSPECIFIED_SCOPE

  const dataRows = rows.filter((row) => row.y < layout.headerRow.y)
  const fragments = coalesce(dataRows.map((row) => splitRow(layout, row)), 12)

  const observations: RawObservation[] = []

  for (const fragment of fragments) {
    if (fragment.priceCells.size === 0) continue

    const commodity = joinItems(fragment.labelItems)
    if (!commodity || !/[a-z]/i.test(commodity)) continue
    // Footnote and legend lines below the table ("* Food items for calculate ...").
    if (/^[*•]/.test(commodity) || /^note\b/i.test(commodity)) continue

    const unit = joinItems(fragment.unitItems)

    const notes: string[] = []
    let confidence = 1

    if (fragment.merged) {
      confidence -= 0.1
      notes.push('row reassembled from two text baselines')
    }
    if (!unit) {
      confidence -= 0.25
      notes.push('unit cell empty in source table')
    }
    if (scope === UNSPECIFIED_SCOPE) {
      confidence -= 0.25
      notes.push('report does not state a geographic scope')
    }

    for (const [observationDate, item] of fragment.priceCells) {
      const price = parsePrice(item.text)
      if (price === null) continue

      observations.push({
        commodityOriginal: commodity,
        unitOriginal: unit,
        observationDate,
        priceKhr: price,
        priceOriginal: item.text.trim(),
        geographicScope: scope,
        priceType: layout.priceType,
        extractionConfidence: Math.max(0, Math.round(confidence * 100) / 100),
        notes: [...notes],
        pageNumber: page.pageNumber,
      })
    }
  }

  return { observations, layout, scope }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseAnnexTables(doc: ExtractedDocument): TableParseResult {
  const documentText = doc.pages.map((p) => p.rawText).join('\n')
  const warnings: string[] = []
  const observations: RawObservation[] = []

  let reportObservationDate: string | null = null
  let geographicScope: string | null = null
  let matchedPages = 0

  for (const page of doc.pages) {
    if (!MONTHLY_HEADING_RE.test(page.rawText)) continue

    // The table of contents lists the annex by name, so the heading alone is not evidence
    // of a table. Require the month columns to actually be on the page before caring.
    const monthTokens = page.items.filter((i) => parseMonthColumn(i.text) !== null).length
    if (monthTokens < 3) continue

    const parsed = parseMonthlyPage(page, documentText)
    if (!parsed) {
      warnings.push(
        `page ${page.pageNumber}: heading matched but the column header could not be located`,
      )
      continue
    }

    matchedPages++
    observations.push(...parsed.observations)
    geographicScope ??= parsed.scope
    reportObservationDate ??= parseHeadingMonth(parsed.layout.heading)

    if (parsed.observations.length === 0) {
      warnings.push(`page ${page.pageNumber}: table located but no price cells parsed`)
    }
  }

  if (matchedPages === 0) {
    // Name the layout when we recognise it but cannot parse it, so the review queue says
    // something more useful than "unknown".
    const known = describeUnsupportedLayout(documentText)
    warnings.push(
      known
        ? `unsupported layout: ${known}. No observations extracted; needs manual entry.`
        : 'no recognised annex table found in this document',
    )
    return { profile: null, observations: [], reportObservationDate: null, geographicScope: null, warnings }
  }

  // Fall back to the newest column when the heading carries no "as of <month>".
  if (!reportObservationDate && observations.length > 0) {
    reportObservationDate = observations
      .map((o) => o.observationDate)
      .sort()
      .at(-1)!
  }

  return {
    profile: 'monthly-situation-update',
    observations,
    reportObservationDate,
    geographicScope,
    warnings,
  }
}

function describeUnsupportedLayout(text: string): string | null {
  if (/Quarterly Market Monitoring Update/i.test(text)) {
    return 'quarterly market monitoring update (two side-by-side tables)'
  }
  if (/Annex\s*\d+\s*:\s*Change\s+in\s+(retail|wholesale)\s+prices/i.test(text)) {
    return 'pre-2025 market & seasonal monitoring annex'
  }
  return null
}
