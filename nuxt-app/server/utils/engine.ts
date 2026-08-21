/**
 * The forecasting engine — pure functions over the exported artifacts.
 *
 * Deliberately free of Nitro, Nuxt and Node built-ins so the Vitest suite can hand it
 * artifacts read straight off disk. `predictor.ts` is the thin wrapper that loads the
 * JSON out of server assets and memoises an instance of this.
 *
 * The model was trained with XGBoost in Python, but predicting doesn't need XGBoost: a
 * boosted-tree prediction is "walk each tree comparing a feature to a threshold, sum the
 * leaf weights, add the base score". That's a dozen lines in any language, which is what
 * keeps the deployed function free of ML dependencies (and under Vercel's 250 MB cap).
 */

export interface Tree {
  l: number[] // left child index, -1 marks a leaf
  r: number[] // right child index
  f: number[] // feature index tested at this node
  t: number[] // threshold compared against
  w: number[] // leaf weight
}

export interface ModelArtifact {
  base_score: number
  trees: Tree[]
}

export interface SeriesRecord {
  admin1: string
  category: string
  unit: string
  dates: string[]
  prices: number[]
}

/** commodity -> market -> pricetype -> series */
export type History = Record<string, Record<string, Record<string, SeriesRecord>>>

export type Encoders = Record<string, Record<string, number>>

export interface Artifacts {
  model: ModelArtifact
  encoders: Encoders
  featureCols: string[]
  history: History
}

export interface Forecast {
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
  /** The month being forecast, "YYYY-MM" — always the month after today. */
  targetPeriod: string
  /** Months between the last real observation and targetPeriod. 1 means the series is current. */
  monthsAhead: number
}

export interface ForecastFailure {
  error: string
  /** Markets that do carry this commodity, when the chosen one doesn't. */
  suggestions?: string[]
}

export type ForecastResult = Forecast | ForecastFailure

export function isFailure(result: ForecastResult): result is ForecastFailure {
  return 'error' in result
}

/** Levenshtein-style closeness in [0, 1], used only as a last-resort match. */
export function similarity(a: string, b: string): number {
  if (!a.length || !b.length) return 0

  // Single rolling row instead of the full matrix — the longest label here is short,
  // but this runs once per candidate on every fuzzy lookup.
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  const curr = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
    }
    prev = curr.slice()
  }

  return 1 - prev[b.length]! / Math.max(a.length, b.length)
}

/**
 * Map user text onto a real dataset label. People type "rice", not
 * "Rice (mixed, low quality)".
 *
 * Exact match, then substring (shortest wins, so "rice" lands on plain rice rather than
 * a longer variant), then edit distance. Below 0.6 similarity it returns null instead of
 * guessing — a wrong commodity silently charted is worse than an error the user can act on.
 */
export function fuzzyMatch(input: string, options: string[]): string | null {
  const query = input.trim().toLowerCase()
  if (!query) return null

  const exact = options.find((o) => o.toLowerCase() === query)
  if (exact) return exact

  const contains = options.filter((o) => o.toLowerCase().includes(query))
  if (contains.length) {
    return contains.reduce((best, o) => (o.length < best.length ? o : best))
  }

  let best: string | null = null
  let bestScore = 0.6
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
 * The month being forecast: the one after `from`, which defaults to today.
 *
 * This is deliberately tied to the calendar rather than to where a series' data happens to
 * stop. A user asking in August wants to hear about September, not about the month after
 * whatever the last WFP report contained.
 */
export function nextPeriod(from: Date = new Date()): string {
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth() + 1 // getUTCMonth is 0-based; this is the current month
  const target = (month % 12) + 1
  return `${target === 1 ? year + 1 : year}-${String(target).padStart(2, '0')}`
}

/** Whole months from one "YYYY-MM" to another. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty! - fy!) * 12 + (tm! - fm!)
}

export class Engine {
  readonly commodities: string[]
  readonly markets: string[]

  private readonly baseScore: number
  private readonly trees: Tree[]
  private readonly encoders: Encoders
  private readonly featureCols: string[]
  private readonly history: History

  constructor({ model, encoders, featureCols, history }: Artifacts) {
    this.baseScore = model.base_score
    this.trees = model.trees
    this.encoders = encoders
    this.featureCols = featureCols
    this.history = history

    this.commodities = Object.keys(history).sort()
    this.markets = [...new Set(Object.values(history).flatMap((byMarket) => Object.keys(byMarket)))].sort()
  }

  /** Sum every tree's leaf weight for this feature vector. */
  rawPredict(features: number[]): number {
    let total = this.baseScore
    for (const tree of this.trees) {
      let node = 0
      while (tree.l[node] !== -1) {
        node = features[tree.f[node]!]! < tree.t[node]! ? tree.l[node]! : tree.r[node]!
      }
      total += tree.w[node]!
    }
    return total
  }

  /** Markets where a given commodity actually has data — powers the dependent dropdown. */
  marketsFor(commodity: string): string[] {
    return this.history[commodity] ? Object.keys(this.history[commodity]!).sort() : []
  }

  marketsByCommodity(): Record<string, string[]> {
    return Object.fromEntries(this.commodities.map((c) => [c, this.marketsFor(c)]))
  }

  /** Feature vector for the period after a series' last observation. */
  /**
   * Feature vector for `targetPeriod` ("YYYY-MM").
   *
   * month and quarter describe the month being forecast; the three lag features describe the
   * most recent prices on record. When a series is current those two things are adjacent, and
   * this is an ordinary one-step-ahead forecast. When a series stopped reporting years ago they
   * are not, and the caller is responsible for saying so — `monthsAhead` on the result carries
   * the distance so the UI can show it rather than bury it.
   */
  buildFeatures(
    record: SeriesRecord,
    commodity: string,
    market: string,
    pricetype: string,
    targetPeriod: string,
  ): number[] {
    const { prices } = record

    const month = Number(targetPeriod.split('-')[1])
    const tail = prices.slice(-3)

    const values: Record<string, number> = {
      commodity_enc: this.encoders.commodity![commodity]!,
      market_enc: this.encoders.market![market]!,
      admin1_enc: this.encoders.admin1![record.admin1]!,
      category_enc: this.encoders.category![record.category]!,
      pricetype_enc: this.encoders.pricetype![pricetype]!,
      month,
      quarter: Math.floor((month - 1) / 3) + 1,
      lag_1: prices[prices.length - 1]!,
      lag_3: tail[0]!,
      rolling_mean_3: tail.reduce((sum, p) => sum + p, 0) / tail.length,
    }

    return this.featureCols.map((col) => values[col]!)
  }

  /**
   * `now` is injectable so tests don't depend on the wall clock; production passes nothing
   * and gets today.
   */
  predict(
    commodityInput: string,
    marketInput: string,
    preferredType = 'Retail',
    now: Date = new Date(),
  ): ForecastResult {
    const commodity = fuzzyMatch(commodityInput, this.commodities)
    if (!commodity) {
      return { error: `Nothing in the dataset matches "${commodityInput}". Try a staple like rice, pork or eggs.` }
    }

    const market = fuzzyMatch(marketInput, this.markets)
    if (!market) {
      return { error: `No market called "${marketInput}" is tracked. Check the spelling, or pick one from the list.` }
    }

    const byType = this.history[commodity]![market]
    if (!byType) {
      // Not every commodity is sold at every market — point them somewhere useful.
      return {
        error: `${commodity} isn't tracked at ${market}.`,
        suggestions: this.marketsFor(commodity).slice(0, 8),
      }
    }

    // Fall back to whichever price type this series has rather than failing.
    const pricetype = byType[preferredType] ? preferredType : Object.keys(byType)[0]!
    const record = byType[pricetype]!

    const { prices, dates } = record
    const lastDate = dates[dates.length - 1]!
    const lastPrice = prices[prices.length - 1]!

    const targetPeriod = nextPeriod(now)
    const features = this.buildFeatures(record, commodity, market, pricetype, targetPeriod)
    const predictedPrice = this.rawPredict(features)
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
      targetPeriod,
      monthsAhead: monthsBetween(lastDate, targetPeriod),
    }
  }
}
