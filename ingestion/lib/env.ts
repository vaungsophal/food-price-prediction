/**
 * Environment access, split by trust level.
 *
 * The service role key, CRON_SECRET and ADMIN_SECRET are read through functions that
 * throw when missing rather than through module-level constants. That matters on Next.js:
 * a module-level read runs at build time too, so a missing secret would break `next build`
 * instead of failing the one request that actually needed it - and a module-level constant
 * is far easier to accidentally import into a client component, which would inline the
 * secret into the browser bundle.
 *
 * Nothing in this file may be imported from a client component.
 */

import 'server-only'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example and the README.`,
    )
  }
  return value
}

/** Safe to expose: this pair is the public, RLS-constrained read path. */
export const publicEnv = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
}

/** Server-only. Never log these, never return them in a response body. */
export const serverEnv = {
  supabaseServiceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
  cronSecret: () => required('CRON_SECRET'),
  adminSecret: () => required('ADMIN_SECRET'),
}
