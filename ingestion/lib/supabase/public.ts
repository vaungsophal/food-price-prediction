import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { publicEnv } from '../env'
import type { Database } from './types'

/**
 * Anon client, used by the public JSON API.
 *
 * The anon key is subject to RLS, so this connection can only ever see approved
 * observations and report metadata. That is deliberate belt-and-braces: /api/prices also
 * filters on validation_status, but if that filter were ever dropped in a refactor the
 * database would still refuse to hand over pending rows.
 */
let cached: SupabaseClient<Database> | null = null

export function supabasePublic(): SupabaseClient<Database> {
  if (cached) return cached

  cached = createClient<Database>(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return cached
}
