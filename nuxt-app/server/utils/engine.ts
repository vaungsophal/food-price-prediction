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

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

/** Unicode block sparkline — the only chart Telegram can render inline. */
export function sparkline(values: number[]): string {
  if (!values.length) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  return values
    .map((v) => BLOCKS[span === 0 ? 3 : Math.min(BLOCKS.length - 1, Math.floor(((v - min) / span) * BLOCKS.length))]!)
    .join('')
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

  /**
   * Split "rice phnom penh" into ["rice", "phnom penh"].
   *
   * Market names contain spaces and we can't know the boundary up front, so try
   * progressively longer candidates from the right against the known market list. If none
   * match, assume the last word is the market and let fuzzyMatch sort it out.
   */
  splitCommodityMarket(text: string): [string, string] | null {
    const words = text.trim().split(/\s+/).filter(Boolean)
    if (words.length < 2) return null

    const known = new Set(this.markets.map((m) => m.toLowerCase()))
    for (let i = words.length - 1; i > 0; i--) {
      if (known.has(words.slice(i).join(' ').toLowerCase())) {
        return [words.slice(0, i).join(' '), words.slice(i).join(' ')]
      }
    }
    return [words.slice(0, -1).join(' '), words[words.length - 1]!]
  }

  /** Feature vector for the period after a series' last observation. */
  buildFeatures(record: SeriesRecord, commodity: string, market: string, pricetype: string): number[] {
    const { prices, dates } = record
    const lastDate = dates[dates.length - 1]!

    // The model predicts the next reporting period, so roll the month forward.
    const month = (Number(lastDate.split('-')[1]) % 12) + 1
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

  predict(commodityInput: string, marketInput: string, preferredType = 'Retail'): ForecastResult {
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
    const lastPrice = prices[prices.length - 1]!
    const predictedPrice = this.rawPredict(this.buildFeatures(record, commodity, market, pricetype))
    const changePct = lastPrice ? ((predictedPrice - lastPrice) / lastPrice) * 100 : 0

    return {
      commodity,
      market,
      province: record.admin1,
      pricetype,
      unit: record.unit,
      lastDate: dates[dates.length - 1]!,
      lastPrice,
      predictedPrice,
      changePct,
      trend: changePct > 0.5 ? 'up' : changePct < -0.5 ? 'down' : 'stable',
      dates,
      prices,
    }
  }
}
