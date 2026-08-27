/**
 * GET /api/reports - processing status of the source reports.
 *
 * Exists so an operator can answer "did the last run see the new report, and what happened
 * to it?" without database access.
 *
 * `processing_error` is deliberately NOT returned. It holds parser messages and occasional
 * stack text, which is internal detail; the endpoint reports THAT a report failed, and the
 * reason lives in the server logs and the admin UI.
 */

import { supabasePublic } from '@/lib/supabase/public'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Single literal, for the reason explained in app/api/prices/route.ts.
const REPORT_SELECT =
  'id, title, publication_date, source_url, document_id, processing_status, discovered_at, processed_at'

const querySchema = z.object({
  status: z
    .enum(['discovered', 'downloaded', 'extracted', 'needs_review', 'approved', 'failed'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export async function GET(request: Request) {
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

  const { status, page, limit } = parsed.data
  const from = (page - 1) * limit

  let statement = supabasePublic()
    .from('source_reports')
    .select(REPORT_SELECT, { count: 'exact' })

  if (status) statement = statement.eq('processing_status', status)

  const { data, error, count } = await statement
    .order('publication_date', { ascending: false, nullsFirst: false })
    .range(from, from + limit - 1)

  if (error) {
    console.error('[api/reports] query failed:', error.message)
    return Response.json({ error: 'could not load reports' }, { status: 500 })
  }

  return Response.json({
    data: (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      publicationDate: row.publication_date,
      sourceUrl: row.source_url,
      documentId: row.document_id,
      processingStatus: row.processing_status,
      discoveredAt: row.discovered_at,
      processedAt: row.processed_at,
    })),
    pagination: { page, limit, total: count ?? 0 },
    metadata: { generatedAt: new Date().toISOString() },
  })
}
