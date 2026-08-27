import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { publicEnv, serverEnv } from '../env'
import type { Database } from './types'

/**
 * Service-role client. Bypasses RLS entirely, so this is the ONLY thing that may write,
 * approve or reject - and it must never be constructed anywhere a browser can reach.
 *
 * Lazily built and memoized: constructing at module scope would demand the secret during
 * `next build`, when no request needs it.
 */
let cached: SupabaseClient<Database> | null = null

export function supabaseAdmin(): SupabaseClient<Database> {
  if (cached) return cached

  cached = createClient<Database>(publicEnv.supabaseUrl(), serverEnv.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'cambodia-food-price-ingestion' } },
  })

  return cached
}
