/**
 * GET /api/prices - the public read API, and the only thing the prediction service needs.
 *
 * Returns APPROVED observations only. Two independent mechanisms enforce that: the filter
 * below, and the RLS policy on the anon key this route uses. Either alone would do; both
 * together mean a refactor that loses the filter still cannot leak unreviewed data.
 *
 * Every value here is an OBSERVED price. This endpoint never returns forecasts - those
 * belong in a separate table owned by the prediction service. See the README.
 */

import { supabasePublic } from '@/lib/supabase/public'
import { priceQuerySchema } from '@/lib/schemas/food-price'
import { COMMODITY_MAP } from '@/lib/scraper/commodity-map'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Select strings must be single string literals - never concatenated or wrapped across
 * lines with `+`. supabase-js parses the query AT THE TYPE LEVEL to derive the row type,
 * and concatenation widens the argument to `string`, which the parser cannot read. The
 * symptom is every column becoming `GenericStringError` with no hint at the real cause.
 */
const PRICE_SELECT =
  'observation_date, commodity_normalized, unit_normalized, price_khr, geographic_scope, province, market, price_type, source_type, source_reports(source_url, title, publication_date)'

/** normalized key -> display label, built once from the mapping table. */
const LABELS = new Map(
  Object.values(COMMODITY_MAP).map((definition) => [definition.normalized, definition.label]),
)

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = priceQuerySchema.safeParse(Object.fromEntries(url.searchParams))

  if (!parsed.success) {
    return Response.json(
      {
        error: 'invalid query parameters',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 },
    )
  }

  const query = parsed.data

  if (query.startDate && query.endDate && query.startDate > query.endDate) {
    return Response.json({ error: 'startDate must not be after endDate' }, { status: 400 })
  }

  let statement = supabasePublic()
    .from('food_price_observations')
    .select(PRICE_SELECT, { count: 'exact' })
    .eq('validation_status', 'approved')

  if (query.commodity) statement = statement.eq('commodity_normalized', query.commodity)
  if (query.province) statement = statement.eq('province', query.province)
  if (query.market) statement = statement.eq('market', query.market)
  if (query.priceType) statement = statement.eq('price_type', query.priceType)
  if (query.sourceType) statement = statement.eq('source_type', query.sourceType)
  if (query.startDate) statement = statement.gte('observation_date', query.startDate)
  if (query.endDate) statement = statement.lte('observation_date', query.endDate)

  const from = (query.page - 1) * query.limit
  statement = statement
    .order('observation_date', { ascending: false })
    .order('commodity_normalized', { ascending: true })
    .range(from, from + query.limit - 1)

  const { data, error, count } = await statement

  if (error) {
    // The client gets a generic message; the detail goes to the server log only. Supabase
    // error text can echo table and column names, which is free reconnaissance.
    console.error('[api/prices] query failed:', error.message)
    return Response.json({ error: 'could not load prices' }, { status: 500 })
  }

  const rows = data ?? []

  // Asked separately rather than read off rows[0]: that would be the newest row on THIS
  // page, so page 2 would report an older "latest" than page 1, and a commodity filter
  // would report that commodity's latest as the dataset's. This is the real high-water
  // mark of approved observed data, which is what a prediction service is asking for.
  const { data: latest } = await supabasePublic()
    .from('food_price_observations')
    .select('observation_date')
    .eq('validation_status', 'approved')
    .order('observation_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  return Response.json({
    data: rows.map((row) => {
      // The embedded report comes back as an object for a to-one relationship, but typing
      // varies with the query shape, so normalize defensively.
      const report = Array.isArray(row.source_reports) ? row.source_reports[0] : row.source_reports

      return {
        observationDate: row.observation_date,
        commodity: row.commodity_normalized,
        commodityLabel: LABELS.get(row.commodity_normalized) ?? row.commodity_normalized,
        unit: row.unit_normalized,
        priceKhr: Number(row.price_khr),
        geographicScope: row.geographic_scope,
        province: row.province,
        market: row.market,
        priceType: row.price_type,
        sourceType: row.source_type,
        sourceUrl: report?.source_url ?? null,
        sourceTitle: report?.title ?? null,
        publicationDate: report?.publication_date ?? null,
      }
    }),
    pagination: {
      page: query.page,
      limit: query.limit,
      total: count ?? 0,
      totalPages: count ? Math.ceil(count / query.limit) : 0,
    },
    metadata: {
      // The newest month with an approved OBSERVED price, across the whole dataset. Named
      // "actual" to keep the line between measurement and model output impossible to blur.
      latestActualObservation: latest?.observation_date ?? null,
      generatedAt: new Date().toISOString(),
      note: 'Approved observations from published WFP reports. Not a live price feed.',
    },
  })
}
