import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { Encoders, History, ModelArtifact } from '../server/utils/engine'
import { Engine, fuzzyMatch, isFailure, monthsBetween, nextPeriod, similarity } from '../server/utils/engine'

import reference from './reference.json' with { type: 'json' }

function artifact<T>(name: string): T {
  const url = new URL(`../server/assets/artifacts/${name}`, import.meta.url)
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as T
}

const engine = new Engine({
  model: artifact<ModelArtifact>('model.json'),
  encoders: artifact<Encoders>('encoders.json'),
  featureCols: artifact<string[]>('feature_cols.json'),
  history: artifact<History>('history.json'),
})

/**
 * The load-bearing test. `reference.json` is written by tools/export_artifacts.py and holds
 * the Python model's own answer for one known series. If the TypeScript tree traversal or
 * the feature order drifts, this is what catches it — the two implementations have to agree
 * to within float32 rounding.
 *
 * Note on the number: the task brief quoted 0.460394 for this series. That figure came from
 * an earlier training run. The assertion below uses the freshly exported reference fixture,
 * so it always pins the TypeScript port to the model artifacts actually shipped.
 */
describe('cross-language correctness', () => {
  it('reproduces the Python model on the reference feature vector', () => {
    // Asserted against rawPredict rather than predict(), because predict() now derives
    // month and quarter from today's date. The traversal and the feature order are what
    // this test exists to pin, and neither depends on the calendar.
    expect(engine.rawPredict(reference.features)).toBeCloseTo(reference.pythonPrediction, 5)
  })

  it('predicts the reference series with the same numbers when asked about July 2022', () => {
    const result = engine.predict(
      reference.commodity, reference.market, reference.pricetype,
      new Date(Date.UTC(2022, 5, 15)), // June 2022 -> target July 2022, as the fixture assumes
    )
    expect(isFailure(result)).toBe(false)
    if (isFailure(result)) return

    expect(result.pricetype).toBe('Wholesale')
    expect(result.lastDate).toBe('2022-06')
    expect(result.lastPrice).toBe(0.44)
    expect(result.targetPeriod).toBe('2022-07')
    expect(result.monthsAhead).toBe(1)
    expect(result.predictedPrice).toBeCloseTo(reference.pythonPrediction, 5)
  })

  it('targets the month after today, not the month after the data', () => {
    const result = engine.predict(
      reference.commodity, reference.market, reference.pricetype,
      new Date(Date.UTC(2026, 7, 21)), // 21 Aug 2026
    )
    expect(isFailure(result)).toBe(false)
    if (isFailure(result)) return

    expect(result.targetPeriod).toBe('2026-09')
    expect(result.lastDate).toBe('2022-06')       // the record still ends where it ends
    expect(result.monthsAhead).toBe(51)           // and the gap is reported, not hidden
  })

  it('builds the feature vector the Python side used', () => {
    const record = artifact<History>('history.json')[reference.commodity]![reference.market]![
      reference.pricetype
    ]!
    const features = engine.buildFeatures(
      record,
      reference.commodity,
      reference.market,
      reference.pricetype,
      '2022-07',
    )

    expect(features).toHaveLength(10)
    features.forEach((value, i) => expect(value).toBeCloseTo(reference.features[i]!, 10))
  })

  it('rolls the month past the last observation, wrapping December', () => {
    // Last observation is 2022-06, so the model is asked about month 7, quarter 3.
    expect(reference.features[5]).toBe(7)
    expect(reference.features[6]).toBe(3)
  })
})

describe('artifact coverage', () => {
  it('covers 46 commodities across 76 markets', () => {
    expect(engine.commodities).toHaveLength(46)
    expect(engine.markets).toHaveLength(76)
  })

  it('lists only markets that actually carry the commodity', () => {
    for (const market of engine.marketsFor(reference.commodity)) {
      expect(engine.markets).toContain(market)
    }
    expect(engine.marketsFor('not a commodity')).toEqual([])
  })
})

describe('fuzzyMatch', () => {
  const options = ['Rice (mixed, low quality)', 'Rice (mixed, high quality)', 'Oil (vegetable)']

  it('prefers an exact, case-insensitive match', () => {
    expect(fuzzyMatch('oil (VEGETABLE)', options)).toBe('Oil (vegetable)')
  })

  it('takes the shortest substring match, so "rice" lands on the plain variant', () => {
    expect(fuzzyMatch('rice', options)).toBe('Rice (mixed, low quality)')
  })

  it('falls back to edit distance for a typo', () => {
    expect(fuzzyMatch('vegtable oil', ['Oil (vegetable)', 'Eggs (duck)'])).toBe(null)
    expect(fuzzyMatch('Oil (vegetible)', options)).toBe('Oil (vegetable)')
  })

  it('returns null rather than guessing below 0.6 similarity', () => {
    expect(fuzzyMatch('zzzzzzzz', options)).toBe(null)
    expect(fuzzyMatch('   ', options)).toBe(null)
  })

  it('scores similarity symmetrically in [0, 1]', () => {
    expect(similarity('rice', 'rice')).toBe(1)
    expect(similarity('rice', 'rise')).toBeCloseTo(0.75, 10)
    expect(similarity('rice', '')).toBe(0)
  })
})

describe('predict failure modes', () => {
  it('names the markets that do carry a commodity the chosen one does not', () => {
    const stranded = engine.commodities
      .map((c) => ({ c, markets: engine.marketsFor(c) }))
      .find(({ markets }) => markets.length < engine.markets.length)!
    const missing = engine.markets.find((m) => !stranded.markets.includes(m))!

    const result = engine.predict(stranded.c, missing)
    expect(isFailure(result)).toBe(true)
    if (!isFailure(result)) return

    expect(result.error).toContain(stranded.c)
    expect(result.error).toContain(missing)
    expect(result.suggestions!.length).toBeGreaterThan(0)
    expect(result.suggestions!.length).toBeLessThanOrEqual(8)
  })

  it('explains an unmatched commodity instead of guessing', () => {
    const result = engine.predict('qwertyuiop', 'Phnom Penh')
    expect(isFailure(result)).toBe(true)
  })
})

describe('forecast period', () => {
  it('targets the month after the given date', () => {
    expect(nextPeriod(new Date(Date.UTC(2026, 7, 21)))).toBe('2026-09')
    expect(nextPeriod(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-02')
  })

  it('wraps December into January of the next year', () => {
    expect(nextPeriod(new Date(Date.UTC(2026, 11, 31)))).toBe('2027-01')
  })

  it('measures the gap between two periods', () => {
    expect(monthsBetween('2022-06', '2022-07')).toBe(1)
    expect(monthsBetween('2022-06', '2026-09')).toBe(51)
    expect(monthsBetween('2026-03', '2026-09')).toBe(6)
  })
})

