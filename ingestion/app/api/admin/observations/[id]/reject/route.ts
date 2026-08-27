/**
 * POST /api/admin/observations/[id]/reject
 *
 * Rejection marks a record unusable but KEEPS it. Deleting would destroy the evidence of
 * what the parser did wrong, which is the main thing this queue is for. Notes are required
 * so the row explains itself later.
 */

import { isAuthorizedAdmin, unauthorized } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rejectBodySchema } from '@/lib/schemas/food-price'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const idSchema = z.string().uuid()

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedAdmin(request)) return unauthorized()

  const { id } = await context.params
  if (!idSchema.safeParse(id).success) {
    return Response.json({ error: 'invalid observation id' }, { status: 400 })
  }

  const raw = await request.json().catch(() => null)
  const body = rejectBodySchema.safeParse(raw)
  if (!body.success) {
    return Response.json(
      {
        error: 'invalid request body',
        details: body.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    )
  }

  const { data, error } = await supabaseAdmin()
    .from('food_price_observations')
    .update({ validation_status: 'rejected', validation_notes: body.data.notes })
    .eq('id', id)
    .select('id, validation_status')
    .maybeSingle()

  if (error) {
    console.error('[admin/reject] update failed:', error.message)
    return Response.json({ error: 'could not reject the observation' }, { status: 500 })
  }
  if (!data) {
    return Response.json({ error: 'observation not found' }, { status: 404 })
  }

  return Response.json({ id: data.id, validationStatus: data.validation_status })
}
