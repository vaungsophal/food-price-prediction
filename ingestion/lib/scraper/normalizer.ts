/**
 * Turn a raw extracted cell into a candidate observation.
 *
 * Normalization here is lookup-driven (see commodity-map.ts) and non-destructive: the
 * original strings ride along untouched so a reviewer can always see what the PDF actually
 * said. Nothing in this file invents a value, and nothing drops a row for being unfamiliar
 * - unknown commodities and units lose confidence and go to the review queue.
 */

import { COMMODITY_MAP, NON_FOOD_SKIP_REASON, UNIT_MAP } from './commodity-map'
import { NON_FOOD_COMMODITIES } from '../config'
import type { RawObservation } from './table-parser'

export interface NormalizedObservation {
  commodityOriginal: string
  commodityNormalized: string
  commodityLabel: string
  unitOriginal: string
  unitNormalized: string
  observationDate: string
  priceKhr: number
  geographicScope: string
  province: string | null
  market: string | null
  priceType: RawObservation['priceType']
  extractionConfidence: number
  notes: string[]
}

export interface SkippedObservation {
  raw: RawObservation
  reason: string
}

export interface NormalizeResult {
  observations: NormalizedObservation[]
  skipped: SkippedObservation[]
}

/**
 * Strip the footnote markers and trailing punctuation the PDFs attach to names, without
 * touching anything that carries meaning. Hyphens, slashes, percentages and parentheses
 * all survive: "30-35% broken rice" and "Trey Pra (Live)" must stay distinguishable.
 */
export function cleanCommodityName(raw: string): string {
  return raw
    .replace(/[*†‡¹²³]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[,;:.]+$/, '')
    .trim()
}

/** Lookup key: case-folded, whitespace-collapsed. Nothing else is removed. */
function lookupKey(name: string): string {
  return cleanCommodityName(name).toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Fallback machine key for a commodity we have no mapping for. Marked with an `unmapped__`
 * prefix so these can never be mistaken for a curated key, and so they are trivial to find
 * when it is time to add them to COMMODITY_MAP.
 */
export function fallbackCommodityKey(name: string): string {
  const slug = cleanCommodityName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `unmapped__${slug || 'unknown'}`
}

export function normalizeUnit(raw: string): { normalized: string; known: boolean } {
  const key = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  const direct = UNIT_MAP[key] ?? UNIT_MAP[key.replace(/\s+/g, '')]
  if (direct) return { normalized: direct.normalized, known: true }

  return { normalized: key || 'unknown', known: false }
}

export function isNonFood(name: string): boolean {
  const key = lookupKey(name)
  return NON_FOOD_COMMODITIES.some((token) => key.includes(token))
}

export function normalizeObservations(raws: RawObservation[]): NormalizeResult {
  const observations: NormalizedObservation[] = []
  const skipped: SkippedObservation[] = []

  for (const raw of raws) {
    const cleaned = cleanCommodityName(raw.commodityOriginal)

    if (!cleaned) {
      skipped.push({ raw, reason: 'empty commodity name' })
      continue
    }

    // Fuel and fertilizer share the annex with food. They are real prices, but they are
    // not food prices, and this pipeline feeds a food-price model.
    if (isNonFood(cleaned)) {
      skipped.push({ raw, reason: NON_FOOD_SKIP_REASON })
      continue
    }

    const notes = [...raw.notes]
    let confidence = raw.extractionConfidence

    const mapped = COMMODITY_MAP[lookupKey(cleaned)]
    if (!mapped) {
      confidence -= 0.3
      notes.push(`commodity "${cleaned}" is not in the mapping table`)
    }

    const unit = normalizeUnit(raw.unitOriginal)
    if (!unit.known && raw.unitOriginal) {
      confidence -= 0.2
      notes.push(`unit "${raw.unitOriginal}" is not in the mapping table`)
    }

    observations.push({
      commodityOriginal: raw.commodityOriginal,
      commodityNormalized: mapped?.normalized ?? fallbackCommodityKey(cleaned),
      commodityLabel: mapped?.label ?? cleaned,
      unitOriginal: raw.unitOriginal,
      unitNormalized: unit.normalized,
      observationDate: raw.observationDate,
      priceKhr: raw.priceKhr,
      geographicScope: raw.geographicScope,
      // These reports publish an aggregate across a set of provinces, not a per-market
      // price, so there is no province or market to record. Leaving them null keeps them
      // honestly empty instead of implying a precision the source does not have.
      province: null,
      market: null,
      priceType: raw.priceType,
      extractionConfidence: Math.max(0, Math.round(confidence * 100) / 100),
      notes,
    })
  }

  return { observations, skipped }
}
