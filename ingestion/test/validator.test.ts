import { describe, expect, it } from 'vitest'
import { seriesKey, validateObservation, type ValidationContext } from '@/lib/scraper/validator'
import type { NormalizedObservation } from '@/lib/scraper/normalizer'

function observation(overrides: Partial<NormalizedObservation> = {}): NormalizedObservation {
  return {
    commodityOriginal: 'Mixed Rice*',
    commodityNormalized: 'mixed_rice',
    commodityLabel: 'Mixed Rice',
    unitOriginal: 'KG',
    unitNormalized: 'kg',
    observationDate: '2026-06-01',
    priceKhr: 2011,
    geographicScope: '10 Tonle Sap provinces',
    province: null,
    market: null,
    priceType: 'retail',
    extractionConfidence: 1,
    notes: [],
    ...overrides,
  }
}

function context(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return { publicationDate: '2026-07-01', priorPrices: new Map(), ...overrides }
}

describe('validateObservation', () => {
  it('never returns approved - only a human can do that', () => {
    const result = validateObservation(observation(), context())
    expect(result.status).toBe('pending')
    // The type itself excludes 'approved', which is the point.
    expect(['pending', 'rejected']).toContain(result.status)
  })

  it('accepts a clean record as pending', () => {
    const result = validateObservation(observation(), context())
    expect(result.status).toBe('pending')
    expect(result.notes).toHaveLength(0)
  })
})

describe('price validation', () => {
  it('rejects a non-positive price', () => {
    expect(validateObservation(observation({ priceKhr: 0 }), context()).status).toBe('rejected')
    expect(validateObservation(observation({ priceKhr: -5 }), context()).status).toBe('rejected')
  })

  it('rejects prices outside the configured sanity band', () => {
    expect(validateObservation(observation({ priceKhr: 3 }), context()).status).toBe('rejected')
    expect(validateObservation(observation({ priceKhr: 9_000_000 }), context()).status).toBe(
      'rejected',
    )
  })

  it('says why it rejected, on the record itself', () => {
    const result = validateObservation(observation({ priceKhr: 2 }), context())
    expect(result.candidate.validationNotes).toMatch(/below the .* floor/)
  })
})

describe('observation date validation', () => {
  it('accepts an observation month earlier than publication - the normal case', () => {
    // A July report carrying June prices.
    const result = validateObservation(
      observation({ observationDate: '2026-06-01' }),
      context({ publicationDate: '2026-07-01' }),
    )
    expect(result.status).toBe('pending')
  })

  it('accepts an observation in the same month as publication', () => {
    const result = validateObservation(
      observation({ observationDate: '2026-07-01' }),
      context({ publicationDate: '2026-07-21' }),
    )
    expect(result.status).toBe('pending')
  })

  it('rejects an observation month later than the report that carries it', () => {
    const result = validateObservation(
      observation({ observationDate: '2026-09-01' }),
      context({ publicationDate: '2026-07-01' }),
    )
    expect(result.status).toBe('rejected')
    expect(result.candidate.validationNotes).toMatch(/after the report was published/)
  })

  it('rejects a date that is not a month start', () => {
    const result = validateObservation(observation({ observationDate: '2026-06-15' }), context())
    expect(result.status).toBe('rejected')
  })

  it('rejects an implausibly old date, which usually means a misparsed year', () => {
    const result = validateObservation(observation({ observationDate: '1926-06-01' }), context())
    expect(result.status).toBe('rejected')
  })
})

describe('suspicious price changes', () => {
  const prior = new Map([
    [
      seriesKey('mixed_rice', 'kg', '10 Tonle Sap provinces'),
      {
        commodityNormalized: 'mixed_rice',
        unitNormalized: 'kg',
        geographicScope: '10 Tonle Sap provinces',
        priceKhr: 2000,
        observationDate: '2026-03-01',
      },
    ],
  ])

  it('flags a large jump for review without rejecting it', () => {
    const result = validateObservation(
      observation({ priceKhr: 8000 }),
      context({ priorPrices: prior }),
    )

    // Still pending: a genuine 4x is possible, and deleting it would lose real data.
    expect(result.status).toBe('pending')
    expect(result.notes.join(' ')).toMatch(/review threshold/)
  })

  it('flags a large fall too', () => {
    const result = validateObservation(
      observation({ priceKhr: 400 }),
      context({ priorPrices: prior }),
    )
    expect(result.notes.join(' ')).toMatch(/review threshold/)
  })

  it('says nothing about an ordinary movement', () => {
    const result = validateObservation(
      observation({ priceKhr: 2100 }),
      context({ priorPrices: prior }),
    )
    expect(result.notes).toHaveLength(0)
  })

  it('does not compare against a NEWER prior value', () => {
    // Back-filling an older month must not be judged against a later one.
    const result = validateObservation(
      observation({ observationDate: '2026-01-01', priceKhr: 8000 }),
      context({ priorPrices: prior }),
    )
    expect(result.notes.join(' ')).not.toMatch(/review threshold/)
  })

  it('does not compare across different geographic scopes', () => {
    const result = validateObservation(
      observation({ priceKhr: 8000, geographicScope: '7 Cambodia-Thailand border provinces' }),
      context({ priorPrices: prior }),
    )
    expect(result.notes.join(' ')).not.toMatch(/review threshold/)
  })
})

describe('confidence and units', () => {
  it('notes a low-confidence extraction', () => {
    const result = validateObservation(
      observation({ extractionConfidence: 0.4 }),
      context(),
    )
    expect(result.status).toBe('pending')
    expect(result.notes.join(' ')).toMatch(/confidence/)
  })

  it('notes an unrecognised unit', () => {
    const result = validateObservation(observation({ unitNormalized: 'bushel' }), context())
    expect(result.notes.join(' ')).toMatch(/not a recognised unit/)
  })
})

describe('currency', () => {
  it('records WFP_PDF as the source type, which fixes the currency as KHR', () => {
    const result = validateObservation(observation(), context())
    expect(result.candidate.sourceType).toBe('WFP_PDF')
  })
})
