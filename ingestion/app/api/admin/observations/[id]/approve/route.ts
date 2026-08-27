/**
 * POST /api/admin/observations/[id]/approve
 *
 * The one transition that makes data visible to the public API and usable by the model.
 * Nothing automated may perform it - the pipeline can only ever write `pending` or
 * `rejected`. This route is the only path to `approved`.
 */

import { isAuthorizedAdmin, unauthorized } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { approveBodySchema } from '@/lib/schemas/food-price'
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

  // An empty body is fine here: approval notes are optional.
  const raw = await request.json().catch(() => ({}))
  const body = approveBodySchema.safeParse(raw ?? {})
  if (!body.success) {
    return Response.json({ error: 'invalid request body' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin()
    .from('food_price_observations')
    .update({
      validation_status: 'approved',
      // Keep the extraction notes when the reviewer adds none - they explain why the row
      // was queued, and erasing them loses the audit trail.
      ...(body.data.notes ? { validation_notes: body.data.notes } : {}),
    })
    .eq('id', id)
    .select('id, validation_status, observation_date, commodity_normalized, price_khr')
    .maybeSingle()

  if (error) {
    console.error('[admin/approve] update failed:', error.message)
    return Response.json({ error: 'could not approve the observation' }, { status: 500 })
  }
  if (!data) {
    return Response.json({ error: 'observation not found' }, { status: 404 })
  }

  return Response.json({
    id: data.id,
    validationStatus: data.validation_status,
    observationDate: data.observation_date,
    commodity: data.commodity_normalized,
    priceKhr: Number(data.price_khr),
  })
}
