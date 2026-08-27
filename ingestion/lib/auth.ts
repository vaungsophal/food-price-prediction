/**
 * Shared-secret authorization for the cron and admin endpoints.
 *
 * KNOWN LIMITATION, stated plainly: this is a bearer secret, not user authentication.
 * There are no accounts, so every reviewer shares one credential and an approval records
 * no individual. That is an accepted trade-off for a first version, and it is safe only
 * because the secret is server-side and every mutation route checks it. See the README
 * section "Admin access and its limits" before putting this in front of real reviewers.
 */

import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { serverEnv } from './env'

/**
 * Constant-time compare. A plain `===` on a secret leaks its length and, in principle, its
 * contents through timing; the cost of doing this properly is one function.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  // timingSafeEqual throws on a length mismatch, so length is checked first - it is not
  // secret enough to matter, and there is no way to compare unequal buffers safely.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null

  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
export function isAuthorizedCron(request: Request): boolean {
  const token = bearerToken(request)
  return token !== null && secretsMatch(token, serverEnv.cronSecret())
}

/**
 * Admin routes accept the same bearer form, plus an `x-admin-secret` header so the review
 * UI can call them from the browser without putting the secret in a URL (where it would
 * land in server logs and browser history).
 */
export function isAuthorizedAdmin(request: Request): boolean {
  const expected = serverEnv.adminSecret()

  const token = bearerToken(request)
  if (token !== null && secretsMatch(token, expected)) return true

  const header = request.headers.get('x-admin-secret')
  return header !== null && secretsMatch(header, expected)
}

/** A refusal that says nothing about why - no hint about the secret's shape or presence. */
export function unauthorized(): Response {
  return Response.json({ error: 'unauthorized' }, { status: 401 })
}
