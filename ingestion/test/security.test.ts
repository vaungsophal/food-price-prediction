/**
 * Authorization tests.
 *
 * These matter more than the parsing tests in one respect: a parsing bug produces a wrong
 * number that a reviewer can catch, whereas an authorization bug lets anyone approve data
 * or trigger runs. Environment variables are set here rather than mocked, so the real
 * comparison path is what runs.
 */

import { beforeAll, describe, expect, it } from 'vitest'

const CRON_SECRET = 'cron-secret-value-0123456789'
const ADMIN_SECRET = 'admin-secret-value-0123456789'

let isAuthorizedCron: (request: Request) => boolean
let isAuthorizedAdmin: (request: Request) => boolean

beforeAll(async () => {
  process.env.CRON_SECRET = CRON_SECRET
  process.env.ADMIN_SECRET = ADMIN_SECRET

  // Imported after the env is set, since the module reads secrets through functions.
  const auth = await import('@/lib/auth')
  isAuthorizedCron = auth.isAuthorizedCron
  isAuthorizedAdmin = auth.isAuthorizedAdmin
})

const request = (headers: Record<string, string>) =>
  new Request('https://example.test/api/cron/scrape-wfp', { headers })

describe('cron authorization', () => {
  it('accepts the correct bearer token', () => {
    expect(isAuthorizedCron(request({ authorization: `Bearer ${CRON_SECRET}` }))).toBe(true)
  })

  it('accepts the header case-insensitively, as HTTP requires', () => {
    expect(isAuthorizedCron(request({ authorization: `bearer ${CRON_SECRET}` }))).toBe(true)
  })

  it('refuses a missing header', () => {
    expect(isAuthorizedCron(request({}))).toBe(false)
  })

  it('refuses a wrong secret', () => {
    expect(isAuthorizedCron(request({ authorization: 'Bearer nope' }))).toBe(false)
  })

  it('refuses a secret that is a prefix of the real one', () => {
    expect(
      isAuthorizedCron(request({ authorization: `Bearer ${CRON_SECRET.slice(0, -1)}` })),
    ).toBe(false)
  })

  it('refuses the raw secret without the Bearer scheme', () => {
    expect(isAuthorizedCron(request({ authorization: CRON_SECRET }))).toBe(false)
  })

  it('refuses the admin secret', () => {
    // The two secrets are separate credentials and must not be interchangeable.
    expect(isAuthorizedCron(request({ authorization: `Bearer ${ADMIN_SECRET}` }))).toBe(false)
  })
})

describe('admin authorization', () => {
  it('accepts the bearer form', () => {
    expect(isAuthorizedAdmin(request({ authorization: `Bearer ${ADMIN_SECRET}` }))).toBe(true)
  })

  it('accepts the x-admin-secret header the review UI sends', () => {
    expect(isAuthorizedAdmin(request({ 'x-admin-secret': ADMIN_SECRET }))).toBe(true)
  })

  it('refuses a wrong secret in either form', () => {
    expect(isAuthorizedAdmin(request({ authorization: 'Bearer nope' }))).toBe(false)
    expect(isAuthorizedAdmin(request({ 'x-admin-secret': 'nope' }))).toBe(false)
  })

  it('refuses an empty secret', () => {
    expect(isAuthorizedAdmin(request({ 'x-admin-secret': '' }))).toBe(false)
  })

  it('refuses the cron secret', () => {
    expect(isAuthorizedAdmin(request({ authorization: `Bearer ${CRON_SECRET}` }))).toBe(false)
  })
})
