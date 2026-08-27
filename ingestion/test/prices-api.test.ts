/**
 * Public API tests.
 *
 * The Supabase client is replaced with a small fake that records the query it was asked to
 * build. That keeps the tests hermetic while still checking the things that matter: that
 * the approved-only filter is always applied, that filters map to the right columns, and
 * that pagination computes the right range.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { priceQuerySchema } from '@/lib/schemas/food-price'

interface RecordedQuery {
  table: string
  filters: Array<{ op: string; column: string; value: unknown }>
  range: [number, number] | null
  order: Array<{ column: string; ascending: boolean }>
}

let recorded: RecordedQuery[] = []
let rows: unknown[] = []
let total = 0

function fakeBuilder(table: string) {
  const query: RecordedQuery = { table, filters: [], range: null, order: [] }
  recorded.push(query)

  const builder = {
    select: () => builder,
    eq(column: string, value: unknown) {
      query.filters.push({ op: 'eq', column, value })
      return builder
    },
    gte(column: string, value: unknown) {
      query.filters.push({ op: 'gte', column, value })
      return builder
    },
    lte(column: string, value: unknown) {
      query.filters.push({ op: 'lte', column, value })
      return builder
    },
    order(column: string, options?: { ascending?: boolean }) {
      query.order.push({ column, ascending: options?.ascending ?? true })
      return builder
    },
    limit: () => builder,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    range(from: number, to: number) {
      query.range = [from, to]
      // Terminal call for the main query: resolve with the fake page.
      return Promise.resolve({ data: rows, error: null, count: total })
    },
  }

  return builder
}

vi.mock('@/lib/supabase/public', () => ({
  supabasePublic: () => ({ from: (table: string) => fakeBuilder(table) }),
}))

const { GET } = await import('@/app/api/prices/route')

const call = (query: string) => GET(new Request(`https://example.test/api/prices${query}`))

beforeEach(() => {
  recorded = []
  total = 0
  rows = [
    {
      observation_date: '2026-06-01',
      commodity_normalized: 'mixed_rice',
      unit_normalized: 'kg',
      price_khr: 2011,
      geographic_scope: '10 Tonle Sap provinces',
      province: null,
      market: null,
      price_type: 'retail',
      source_type: 'WFP_PDF',
      source_reports: {
        source_url: 'https://docs.wfp.org/api/documents/WFP-0000175046/download/',
        title: 'Cambodia Market Situation Update - July 2026',
        publication_date: '2026-07-01',
      },
    },
  ]
  total = 1
})

describe('approved-only access', () => {
  it('always filters to approved observations', async () => {
    await call('')
    const main = recorded[0]
    expect(main.filters).toContainEqual({ op: 'eq', column: 'validation_status', value: 'approved' })
  })

  it('applies that filter even when other filters are present', async () => {
    await call('?commodity=mixed_rice&priceType=retail')
    expect(recorded[0].filters).toContainEqual({
      op: 'eq',
      column: 'validation_status',
      value: 'approved',
    })
  })
})

describe('filtering', () => {
  it('maps each query parameter to its column', async () => {
    await call(
      '?commodity=mixed_rice&province=Siem+Reap&market=Psar&priceType=wholesale&sourceType=WFP_HDX',
    )

    const filters = recorded[0].filters
    expect(filters).toContainEqual({ op: 'eq', column: 'commodity_normalized', value: 'mixed_rice' })
    expect(filters).toContainEqual({ op: 'eq', column: 'province', value: 'Siem Reap' })
    expect(filters).toContainEqual({ op: 'eq', column: 'market', value: 'Psar' })
    expect(filters).toContainEqual({ op: 'eq', column: 'price_type', value: 'wholesale' })
    expect(filters).toContainEqual({ op: 'eq', column: 'source_type', value: 'WFP_HDX' })
  })

  it('turns startDate and endDate into a range', async () => {
    await call('?startDate=2026-01-01&endDate=2026-06-30')
    const filters = recorded[0].filters
    expect(filters).toContainEqual({ op: 'gte', column: 'observation_date', value: '2026-01-01' })
    expect(filters).toContainEqual({ op: 'lte', column: 'observation_date', value: '2026-06-30' })
  })

  it('applies no optional filter when none is given', async () => {
    await call('')
    expect(recorded[0].filters).toHaveLength(1)
  })

  it('rejects a reversed date range', async () => {
    const response = await call('?startDate=2026-06-01&endDate=2026-01-01')
    expect(response.status).toBe(400)
  })

  it('rejects an unknown priceType instead of ignoring it', async () => {
    const response = await call('?priceType=barter')
    expect(response.status).toBe(400)
  })

  it('rejects a malformed date', async () => {
    expect((await call('?startDate=June+2026')).status).toBe(400)
  })
})

describe('pagination', () => {
  it('defaults to the first page of 50', async () => {
    const response = await call('')
    const body = await response.json()

    expect(recorded[0].range).toEqual([0, 49])
    expect(body.pagination.page).toBe(1)
    expect(body.pagination.limit).toBe(50)
  })

  it('computes the range for a later page', async () => {
    await call('?page=3&limit=20')
    expect(recorded[0].range).toEqual([40, 59])
  })

  it('reports the total and page count', async () => {
    total = 133
    const body = await (await call('?limit=50')).json()
    expect(body.pagination.total).toBe(133)
    expect(body.pagination.totalPages).toBe(3)
  })

  it('caps limit so one request cannot pull the whole table', () => {
    expect(priceQuerySchema.safeParse({ limit: '5000' }).success).toBe(false)
    expect(priceQuerySchema.parse({ limit: '500' }).limit).toBe(500)
  })

  it('rejects a zero or negative page', async () => {
    expect((await call('?page=0')).status).toBe(400)
    expect((await call('?page=-1')).status).toBe(400)
  })

  it('orders newest first', async () => {
    await call('')
    expect(recorded[0].order[0]).toEqual({ column: 'observation_date', ascending: false })
  })
})

describe('response shape', () => {
  it('returns camelCase records with their source URL', async () => {
    const body = await (await call('')).json()

    expect(body.data[0]).toMatchObject({
      observationDate: '2026-06-01',
      commodity: 'mixed_rice',
      commodityLabel: 'Mixed Rice',
      unit: 'kg',
      priceKhr: 2011,
      geographicScope: '10 Tonle Sap provinces',
      priceType: 'retail',
      sourceType: 'WFP_PDF',
      sourceUrl: 'https://docs.wfp.org/api/documents/WFP-0000175046/download/',
    })
  })

  it('asks for the dataset-wide latest observation separately from the page', async () => {
    // Reading it off the first row would make page 2 report a different "latest".
    await call('?page=2')
    expect(recorded.length).toBeGreaterThan(1)
  })

  it('states that this is not a live feed', async () => {
    const body = await (await call('')).json()
    expect(body.metadata.note).toMatch(/not a live price feed/i)
  })
})
