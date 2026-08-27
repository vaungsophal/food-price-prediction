/**
 * GET /api/admin/observations - the review queue.
 *
 * Admin-secret protected and served by the service-role client, because a reviewer needs
 * to see exactly what the public cannot: pending and rejected rows.
 *
 * Alongside each observation it returns `nearby`, the approved values on either side of it
 * in the same series. That is the context that makes review possible in seconds - a price
 * is judged against its neighbours, not in isolation.
 */

import { isAuthorizedAdmin, unauthorized } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Select strings must be single string literals - never concatenated or wrapped across
 * lines with `+`. supabase-js parses the query AT THE TYPE LEVEL to derive the row type,
 * and concatenation widens the argument to `string`, which the parser cannot read. The
 * symptom is every column becoming `GenericStringError` with no hint at the real cause.
 */
const OBSERVATION_SELECT =
  'id, observation_date, commodity_original, commodity_normalized, unit_original, unit_normalized, price_khr, geographic_scope, province, market, price_type, source_type, extraction_confidence, validation_status, validation_notes, created_at, source_reports(id, title, source_url, publication_date, processing_status)'

const querySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  reportId: z.string().uuid().optional(),
  commodity: z.string().min(1).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export async function GET(request: Request) {
  if (!isAuthorizedAdmin(request)) return unauthorized()

  const url = new URL(request.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))

  if (!parsed.success) {
    return Response.json(
      {
        error: 'invalid query parameters',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    )
  }

  const { status, reportId, commodity, month, page, limit } = parsed.data
  const db = supabaseAdmin()
  const from = (page - 1) * limit

  let statement = db
    .from('food_price_observations')
    .select(OBSERVATION_SELECT, { count: 'exact' })
    .eq('validation_status', status)

  if (reportId) statement = statement.eq('source_report_id', reportId)
  if (commodity) statement = statement.eq('commodity_normalized', commodity)
  if (month) {
    // A month filter is a range over that month's first and last day.
    const start = `${month}-01`
    const [year, m] = month.split('-').map(Number)
    const end = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10)
    statement = statement.gte('observation_date', start).lte('observation_date', end)
  }

  const { data, error, count } = await statement
    .order('extraction_confidence', { ascending: true })
    .order('observation_date', { ascending: false })
    .range(from, from + limit - 1)

  if (error) {
    console.error('[api/admin/observations] query failed:', error.message)
    return Response.json({ error: 'could not load observations' }, { status: 500 })
  }

  const rows = data ?? []
  const nearby = await loadNearbyApproved(rows)

  return Response.json({
    data: rows.map((row) => {
      const report = Array.isArray(row.source_reports) ? row.source_reports[0] : row.source_reports
      const key = `${row.commodity_normalized}|${row.unit_normalized}|${row.geographic_scope}`

      return {
        id: row.id,
        observationDate: row.observation_date,
        commodityOriginal: row.commodity_original,
        commodityNormalized: row.commodity_normalized,
        unitOriginal: row.unit_original,
        unitNormalized: row.unit_normalized,
        priceKhr: Number(row.price_khr),
        geographicScope: row.geographic_scope,
        province: row.province,
        market: row.market,
        priceType: row.price_type,
        sourceType: row.source_type,
        extractionConfidence: Number(row.extraction_confidence),
        validationStatus: row.validation_status,
        validationNotes: row.validation_notes,
        report: report
          ? {
              id: report.id,
              title: report.title,
              sourceUrl: report.source_url,
              publicationDate: report.publication_date,
              processingStatus: report.processing_status,
            }
          : null,
        // Approved values from the same series, for eyeballing plausibility.
        nearby: (nearby.get(key) ?? []).map((n) => ({
          observationDate: n.observation_date,
          priceKhr: Number(n.price_khr),
        })),
      }
    }),
    pagination: { page, limit, total: count ?? 0 },
  })
}

interface NearbyRow {
  commodity_normalized: string
  unit_normalized: string
  geographic_scope: string
  observation_date: string
  price_khr: number
}

/** Approved prices for every series present in this page of the queue. */
async function loadNearbyApproved(
  rows: Array<{ commodity_normalized: string }>,
): Promise<Map<string, NearbyRow[]>> {
  const commodities = [...new Set(rows.map((r) => r.commodity_normalized))]
  const grouped = new Map<string, NearbyRow[]>()
  if (commodities.length === 0) return grouped

  const { data } = await supabaseAdmin()
    .from('food_price_observations')
    .select('commodity_normalized, unit_normalized, geographic_scope, observation_date, price_khr')
    .eq('validation_status', 'approved')
    .in('commodity_normalized', commodities)
    .order('observation_date', { ascending: false })
    .limit(500)

  for (const row of data ?? []) {
    const key = `${row.commodity_normalized}|${row.unit_normalized}|${row.geographic_scope}`
    const list = grouped.get(key) ?? []
    // Six months of context is plenty to judge a single value.
    if (list.length < 6) list.push(row as NearbyRow)
    grouped.set(key, list)
  }

  return grouped
}
