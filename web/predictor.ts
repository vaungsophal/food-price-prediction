/**
 * Shared prediction logic for the API routes.
 *
 * The model was trained with XGBoost in Python, but predicting doesn't need XGBoost:
 * a boosted-tree prediction is "walk each tree comparing a feature to a threshold,
 * sum the leaf weights, add the base score". That's a dozen lines in any language,
 * so the deployed function ships no ML dependencies at all.
 *
 * Verified to match the Python model within float32 rounding (~3e-6).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ARTIFACTS = join(process.cwd(), 'api', '_lib', 'artifacts')

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(ARTIFACTS, name), 'utf-8')) as T
}

interface Tree {
  l: number[] // left child index, -1 marks a leaf
  r: number[] // right child index
  f: number[] // feature index tested at this node
  t: number[] // threshold compared against
  w: number[] // leaf weight
}

interface SeriesRecord {
  admin1: string
  category: string
  unit: string
  dates: string[]
  prices: number[]
}

type History = Record<string, Record<string, Record<string, SeriesRecord>>>

// Loaded once per cold start, reused across warm invocations.
const { base_score: BASE_SCORE, trees: TREES } = load<{ base_score: number; trees: Tree[] }>('model.json')
const ENCODERS = load<Record<string, Record<string, number>>>('encoders.json')
const FEATURE_COLS = load<string[]>('feature_cols.json')
const HISTORY = load<History>('history.json')

export const COMMODITIES = Object.keys(HISTORY).sort()
export const MARKETS = [
  ...new Set(Object.values(HISTORY).flatMap((byMarket) => Object.keys(byMarket))),
].sort()

/** Sum every tree's leaf weight for this feature vector. */
function rawPredict(features: number[]): number {
  let total = BASE_SCORE
  for (const tree of TREES) {
    let node = 0
    while (tree.l[node] !== -1) {
      node = features[tree.f[node]] < tree.t[node] ? tree.l[node] : tree.r[node]
    }
    total += tree.w[node]
  }
  return total
}

/** Levenshtein-style closeness, used only as a last-resort match. */
function similarity(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const dist: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dist[i][j] = Math.min(dist[i - 1][j] + 1, dist[i][j - 1] + 1, dist[i - 1][j - 1] + cost)
    }
  }
  return 1 - dist[a.length][b.length] / Math.max(a.length, b.length)
}

/**
 * Map user text onto a real dataset label.
 * People type "rice", not "Rice (mixed, low quality)".
 */
export function fuzzyMatch(input: string, options: string[]): string | null {
  const query = input.trim().toLowerCase()
  if (!query) return null

  const exact = options.find((o) => o.toLowerCase() === query)
  if (exact) return exact

  const contains = options.filter((o) => o.toLowerCase().includes(query))
  if (contains.length) {
    // shortest wins: "rice" should land on the plain rice entry, not a longer variant
    return contains.reduce((best, o) => (o.length < best.length ? o : best))
  }

  let best: string | null = null
  let bestScore = 0.6 // below this, treat it as no match rather than guessing wildly
  for (const option of options) {
    const score = similarity(query, option.toLowerCase())
    if (score > bestScore) {
      bestScore = score
      best = option
    }
  }
  return best
}

/**
 * Split "rice phnom penh" into ["rice", "phnom penh"].
 * Tries progressively longer market names from the right, since market names
 * contain spaces but we can't know where the boundary is up front.
 */
export function splitCommodityMarket(text: string): [string, string] | null {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return null

  const known = new Set(MARKETS.map((m) => m.toLowerCase()))
  for (let i = words.length - 1; i > 0; i--) {
    if (known.has(words.slice(i).join(' ').toLowerCase())) {
      return [words.slice(0, i).join(' '), words.slice(i).join(' ')]
    }
  }
  return [words.slice(0, -1).join(' '), words[words.length - 1]]
}

export interface PredictionSuccess {
  commodity: string
  market: string
  province: string
  pricetype: string
  unit: string
  lastDate: string
  lastPrice: number
  predictedPrice: number
  changePct: number
  trend: 'up' | 'down' | 'stable'
  dates: string[]
  prices: number[]
}

export interface PredictionError {
  error: string
  suggestions?: string[]
}

export type PredictionResult = PredictionSuccess | PredictionError

export function predictPrice(
  commodityInput: string,
  marketInput: string,
  preferredType = 'Retail',
): PredictionResult {
  const commodity = fuzzyMatch(commodityInput, COMMODITIES)
  if (!commodity) {
    return { error: `No data for "${commodityInput}".` }
  }

  const market = fuzzyMatch(marketInput, MARKETS)
  if (!market) {
    return { error: `No data for market "${marketInput}".` }
  }

  const byType = HISTORY[commodity][market]
  if (!byType) {
    // Not every commodity is sold at every market — point them somewhere useful
    return {
      error: `${commodity} isn't tracked at ${market}.`,
      suggestions: Object.keys(HISTORY[commodity]).sort().slice(0, 8),
    }
  }

  // Fall back to whichever price type exists rather than failing
  const pricetype = byType[preferredType] ? preferredType : Object.keys(byType)[0]
  const record = byType[pricetype]

  const { prices, dates } = record
  const lastPrice = prices[prices.length - 1]
  const lastDate = dates[dates.length - 1]

  // The model predicts the next reporting period, so roll the month forward
  const month = Number(lastDate.split('-')[1])
  const nextMonth = (month % 12) + 1
  const nextQuarter = Math.floor((nextMonth - 1) / 3) + 1

  const tail = prices.slice(-3)
  const values: Record<string, number> = {
    commodity_enc: ENCODERS.commodity[commodity],
    market_enc: ENCODERS.market[market],
    admin1_enc: ENCODERS.admin1[record.admin1],
    category_enc: ENCODERS.category[record.category],
    pricetype_enc: ENCODERS.pricetype[pricetype],
    month: nextMonth,
    quarter: nextQuarter,
    lag_1: lastPrice,
    lag_3: tail[0],
    rolling_mean_3: tail.reduce((sum, p) => sum + p, 0) / tail.length,
  }

  const predictedPrice = rawPredict(FEATURE_COLS.map((col) => values[col]))
  const changePct = lastPrice ? ((predictedPrice - lastPrice) / lastPrice) * 100 : 0

  return {
    commodity,
    market,
    province: record.admin1,
    pricetype,
    unit: record.unit,
    lastDate,
    lastPrice,
    predictedPrice,
    changePct,
    trend: changePct > 0.5 ? 'up' : changePct < -0.5 ? 'down' : 'stable',
    dates,
    prices,
  }
}

/** Markets where a given commodity actually has data — powers the dependent dropdown. */
export function marketsFor(commodity: string): string[] {
  return HISTORY[commodity] ? Object.keys(HISTORY[commodity]).sort() : []
}
