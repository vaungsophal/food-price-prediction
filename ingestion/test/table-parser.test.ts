import { describe, expect, it } from 'vitest'
import {
  detectGeographicScope,
  parseAnnexTables,
  parseHeadingMonth,
  parseMonthColumn,
  parsePrice,
  UNSPECIFIED_SCOPE,
} from '@/lib/scraper/table-parser'
import { buildAnnexPage, buildDocument } from './fixtures/annex-table'

describe('parsePrice', () => {
  it('converts thousands separators', () => {
    expect(parsePrice('2,011')).toBe(2011)
    expect(parsePrice('28,455')).toBe(28455)
    expect(parsePrice('1,234,567')).toBe(1234567)
  })

  it('accepts plain and decimal numbers', () => {
    expect(parsePrice('900')).toBe(900)
    expect(parsePrice('12.50')).toBe(12.5)
  })

  it('treats every missing-value marker as absent rather than zero', () => {
    // Returning 0 here would be a disaster: a free commodity is a plausible-looking lie.
    for (const missing of ['-', '–', '—', '', '   ', '⚫', '➜']) {
      expect(parsePrice(missing), `"${missing}" should be null`).toBeNull()
    }
  })

  it('refuses percentages, so Change columns can never become prices', () => {
    expect(parsePrice('8.3%')).toBeNull()
    expect(parsePrice('-4.3%')).toBeNull()
    expect(parsePrice('112.4%')).toBeNull()
  })

  it('refuses text', () => {
    expect(parsePrice('KG')).toBeNull()
    expect(parsePrice('n/a')).toBeNull()
  })
})

describe('parseMonthColumn', () => {
  it('reads Mon-apostrophe-YY headers whatever the apostrophe', () => {
    expect(parseMonthColumn("Jun'25")).toBe('2025-06-01')
    expect(parseMonthColumn('Jan’26')).toBe('2026-01-01')
    expect(parseMonthColumn('Dec`24')).toBe('2024-12-01')
  })

  it('reads four-digit years', () => {
    expect(parseMonthColumn('Mar 2026')).toBe('2026-03-01')
  })

  it('rejects anything that is not a month column', () => {
    expect(parseMonthColumn('Change')).toBeNull()
    expect(parseMonthColumn('Unit')).toBeNull()
    expect(parseMonthColumn('2,011')).toBeNull()
  })
})

describe('parseHeadingMonth', () => {
  it('reads the observation month out of the heading', () => {
    expect(parseHeadingMonth('Annex 2: Retail prices and changes as of June 2026')).toBe(
      '2026-06-01',
    )
    expect(parseHeadingMonth('Table 1: Retail prices and changes as of January 2026')).toBe(
      '2026-01-01',
    )
  })

  it('returns null when the heading names no month', () => {
    expect(parseHeadingMonth('Annex 1: Change in retail prices')).toBeNull()
  })
})

describe('detectGeographicScope', () => {
  it('reads scope through the irregular spacing that PDF extraction produces', () => {
    expect(
      detectGeographicScope('Retail   prices   in   10   Tonle   Sap   provinces'),
    ).toBe('10 Tonle Sap provinces')
  })

  it('handles the Cambodia-Thailand border wording and its varying dash', () => {
    expect(
      detectGeographicScope('monitoring to 23 markets located within seven provinces along the Cambodia – Thailand border'),
    ).toBe('7 Cambodia-Thailand border provinces')
    expect(
      detectGeographicScope('markets across seven Cambodia-Thailand border provinces'),
    ).toBe('7 Cambodia-Thailand border provinces')
  })

  it('returns null rather than guessing', () => {
    expect(detectGeographicScope('Retail prices and changes as of June 2026')).toBeNull()
  })
})

describe('parseAnnexTables', () => {
  const months = ["Jun'25", "Jan'26", "Feb'26", "Mar'26", "Jun'26"]

  const page = buildAnnexPage({
    heading: 'Annex 2: Retail prices and changes in 10 Tonle Sap provinces as of June 2026',
    months,
    rows: [
      {
        commodity: 'Mixed Rice*',
        unit: 'KG',
        values: ['2,101', '1,905', '1,889', '1,857', '2,011'],
        changes: ['8.3%', '-4.3%'],
      },
      {
        commodity: 'Vegetable Oil*',
        unit: '5 L',
        values: ['28,902', '28,181', '28,398', '29,707', '31,610'],
        changes: ['6.4%', '9.4%'],
      },
      // Every price missing - the row exists but recorded nothing.
      { commodity: 'Red tailed catfish', unit: 'KG', values: ['30,000', '-', '-', '-', '-'] },
      // Name and unit render one baseline above the numbers.
      {
        commodity: 'Chinese spinach',
        unit: 'KG',
        values: ['4,756', '3,121', '2,849', '4,066', '4,025'],
        splitBaseline: true,
      },
      // Long name wrapped onto a second line.
      {
        commodity: 'Orange-flesh Sweet Potatoes',
        unit: 'KG',
        values: ['2,383', '2,893', '2,825', '3,025', '2,000'],
        wrapLabel: true,
      },
    ],
  })

  const result = parseAnnexTables(buildDocument([page]))

  it('identifies the layout profile', () => {
    expect(result.profile).toBe('monthly-situation-update')
  })

  it('takes the observation month from the heading, not the publication month', () => {
    expect(result.reportObservationDate).toBe('2026-06-01')
  })

  it('reads the geographic scope from the heading', () => {
    expect(result.geographicScope).toBe('10 Tonle Sap provinces')
  })

  it('extracts every month column, not just the newest', () => {
    const rice = result.observations.filter((o) => o.commodityOriginal.startsWith('Mixed Rice'))
    expect(rice.map((o) => o.observationDate).sort()).toEqual([
      '2025-06-01',
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-06-01',
    ])
    expect(rice.find((o) => o.observationDate === '2026-06-01')?.priceKhr).toBe(2011)
    expect(rice.find((o) => o.observationDate === '2025-06-01')?.priceKhr).toBe(2101)
  })

  it('pairs each price with its own commodity', () => {
    // The failure this guards against is the whole reason for coordinate extraction:
    // flowed text attaches these numbers to the wrong rows.
    const oil = result.observations.find(
      (o) => o.commodityOriginal.startsWith('Vegetable Oil') && o.observationDate === '2026-06-01',
    )
    expect(oil?.priceKhr).toBe(31610)
    expect(oil?.unitOriginal).toBe('5 L')
  })

  it('emits nothing for missing cells instead of inventing a value', () => {
    const catfish = result.observations.filter((o) => o.commodityOriginal === 'Red tailed catfish')
    expect(catfish).toHaveLength(1)
    expect(catfish[0].observationDate).toBe('2025-06-01')
    expect(catfish[0].priceKhr).toBe(30000)
  })

  it('never reads a Change percentage as a price', () => {
    for (const observation of result.observations) {
      expect(observation.priceKhr).toBeGreaterThan(100)
      expect(observation.priceOriginal).not.toContain('%')
    }
  })

  it('reassembles a row split across two baselines', () => {
    const spinach = result.observations.filter((o) => o.commodityOriginal === 'Chinese spinach')
    expect(spinach).toHaveLength(5)
    expect(spinach.find((o) => o.observationDate === '2026-06-01')?.priceKhr).toBe(4025)
  })

  it('rejoins a wrapped commodity name with a space', () => {
    const potato = result.observations.find((o) => /Sweet Potatoes/.test(o.commodityOriginal))
    expect(potato?.commodityOriginal).toBe('Orange-flesh Sweet Potatoes')
    expect(potato?.priceKhr).toBe(2383)
  })

  it('marks retail as the price type', () => {
    expect(result.observations.every((o) => o.priceType === 'retail')).toBe(true)
  })
})

describe('parseAnnexTables on a wholesale annex', () => {
  it('records the price type as wholesale', () => {
    const page = buildAnnexPage({
      heading: 'Annex 3: Wholesale prices and changes as of June 2026',
      months: ["Jan'26", "Feb'26", "Jun'26"],
      rows: [{ commodity: 'Mixed Rice', unit: 'KG', values: ['1,800', '1,810', '1,900'] }],
    })

    const result = parseAnnexTables(buildDocument([page]))
    expect(result.observations.every((o) => o.priceType === 'wholesale')).toBe(true)
  })
})

describe('parseAnnexTables when scope is not stated', () => {
  const page = buildAnnexPage({
    heading: 'Table 1: Retail prices and changes as of January 2026',
    months: ["Nov'25", "Dec'25", "Jan'26"],
    rows: [{ commodity: 'Mixed Rice', unit: 'KG', values: ['1,993', '1,893', '1,965'] }],
  })

  const result = parseAnnexTables(buildDocument([page]))

  it('still parses the table', () => {
    expect(result.observations).toHaveLength(3)
  })

  it('refuses to guess a scope', () => {
    // Reports cover different province sets. Defaulting would silently merge series that
    // measure different markets.
    expect(result.geographicScope).toBe(UNSPECIFIED_SCOPE)
  })

  it('drops confidence so the rows are reviewed', () => {
    expect(result.observations.length).toBeGreaterThan(0)
    expect(result.observations.every((o) => o.extractionConfidence < 1)).toBe(true)
    expect(
      result.observations.every((o) => o.notes.some((note) => /geographic scope/.test(note))),
    ).toBe(true)
  })
})

describe('parseAnnexTables on an unrecognised layout', () => {
  it('extracts nothing and names the layout it saw', () => {
    const document = buildDocument([
      {
        pageNumber: 9,
        items: [],
        rawText:
          'Cambodia Quarterly Market Monitoring Update Annex 1: Change in retail prices Food commodity',
      },
    ])

    const result = parseAnnexTables(document)

    // Silence, not a guess. A half-parsed table is indistinguishable from a correct one.
    expect(result.observations).toHaveLength(0)
    expect(result.profile).toBeNull()
    expect(result.warnings.join(' ')).toMatch(/unsupported layout/i)
  })

  it('does not treat a table-of-contents mention as a table', () => {
    const document = buildDocument([
      {
        pageNumber: 1,
        items: [],
        rawText: 'TABLE OF CONTENT Annex 2: Retail prices and changes .......... 7',
      },
    ])

    const result = parseAnnexTables(document)
    expect(result.observations).toHaveLength(0)
    // No "header could not be located" noise for a contents line.
    expect(result.warnings.join(' ')).not.toMatch(/column header/i)
  })
})
