import { describe, expect, it } from 'vitest'
import {
  cleanCommodityName,
  fallbackCommodityKey,
  isNonFood,
  normalizeObservations,
  normalizeUnit,
} from '@/lib/scraper/normalizer'
import type { RawObservation } from '@/lib/scraper/table-parser'

function raw(overrides: Partial<RawObservation> = {}): RawObservation {
  return {
    commodityOriginal: 'Mixed Rice*',
    unitOriginal: 'KG',
    observationDate: '2026-06-01',
    priceKhr: 2011,
    priceOriginal: '2,011',
    geographicScope: '10 Tonle Sap provinces',
    priceType: 'retail',
    extractionConfidence: 1,
    notes: [],
    pageNumber: 7,
    ...overrides,
  }
}

describe('cleanCommodityName', () => {
  it('strips footnote markers', () => {
    expect(cleanCommodityName('Mixed Rice*')).toBe('Mixed Rice')
    expect(cleanCommodityName('Duck egg*')).toBe('Duck egg')
  })

  it('preserves the punctuation that carries meaning', () => {
    // A slug-everything approach would erase the distinctions these names depend on.
    expect(cleanCommodityName('30-35% broken rice')).toBe('30-35% broken rice')
    expect(cleanCommodityName('Trey Pra (Live)')).toBe('Trey Pra (Live)')
    expect(cleanCommodityName('Green bean/mung bean')).toBe('Green bean/mung bean')
  })
})

describe('commodity normalization', () => {
  it('maps known names to stable keys and labels', () => {
    const { observations } = normalizeObservations([raw()])
    expect(observations[0].commodityNormalized).toBe('mixed_rice')
    expect(observations[0].commodityLabel).toBe('Mixed Rice')
  })

  it('is case and spacing insensitive', () => {
    const { observations } = normalizeObservations([
      raw({ commodityOriginal: '  MIXED   RICE  ' }),
    ])
    expect(observations[0].commodityNormalized).toBe('mixed_rice')
  })

  it('keeps commodities that a naive slug would merge apart', () => {
    const { observations } = normalizeObservations([
      raw({ commodityOriginal: 'Trey Pra (Live)' }),
      raw({ commodityOriginal: 'Trey Por' }),
      raw({ commodityOriginal: '30-35% broken rice' }),
    ])

    const keys = observations.map((o) => o.commodityNormalized)
    expect(new Set(keys).size).toBe(3)
    expect(keys).toContain('trey_pra_live')
    expect(keys).toContain('trey_por')
    expect(keys).toContain('broken_rice_30_35')
  })

  it('always preserves the original text for auditing', () => {
    const { observations } = normalizeObservations([raw({ commodityOriginal: 'Mixed Rice*' })])
    expect(observations[0].commodityOriginal).toBe('Mixed Rice*')
  })

  it('flags an unmapped commodity for review instead of dropping or guessing it', () => {
    const { observations } = normalizeObservations([
      raw({ commodityOriginal: 'Dragon fruit' }),
    ])

    expect(observations).toHaveLength(1)
    expect(observations[0].commodityNormalized).toBe('unmapped__dragon_fruit')
    expect(observations[0].extractionConfidence).toBeLessThan(1)
    expect(observations[0].notes.join(' ')).toMatch(/not in the mapping table/)
  })

  it('marks unmapped keys so they can never be mistaken for curated ones', () => {
    expect(fallbackCommodityKey('Some New Vegetable')).toBe('unmapped__some_new_vegetable')
  })
})

describe('unit normalization', () => {
  it('maps the units these tables use', () => {
    expect(normalizeUnit('KG')).toEqual({ normalized: 'kg', known: true })
    expect(normalizeUnit('5 L')).toEqual({ normalized: 'litre', known: true })
    expect(normalizeUnit('10 pcs')).toEqual({ normalized: 'piece', known: true })
    expect(normalizeUnit('730 ml')).toEqual({ normalized: 'ml', known: true })
    expect(normalizeUnit('L')).toEqual({ normalized: 'litre', known: true })
  })

  it('reports an unknown unit rather than silently accepting it', () => {
    expect(normalizeUnit('bushel')).toEqual({ normalized: 'bushel', known: false })
  })
})

describe('non-food exclusion', () => {
  it('recognises the fuel and fertilizer rows that share the annex', () => {
    expect(isNonFood('Gasoline (Regular)')).toBe(true)
    expect(isNonFood('Diesel')).toBe(true)
    expect(isNonFood('Fertilizer: Urea')).toBe(true)
    expect(isNonFood('Mixed Rice')).toBe(false)
  })

  it('skips them with a stated reason instead of letting them into the dataset', () => {
    const { observations, skipped } = normalizeObservations([
      raw({ commodityOriginal: 'Gasoline (Regular)', unitOriginal: 'L' }),
      raw(),
    ])

    expect(observations).toHaveLength(1)
    expect(observations[0].commodityNormalized).toBe('mixed_rice')
    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toMatch(/non-food/)
  })
})

describe('geographic detail', () => {
  it('leaves province and market null, because the annex reports an aggregate', () => {
    const { observations } = normalizeObservations([raw()])
    expect(observations[0].province).toBeNull()
    expect(observations[0].market).toBeNull()
    expect(observations[0].geographicScope).toBe('10 Tonle Sap provinces')
  })
})
