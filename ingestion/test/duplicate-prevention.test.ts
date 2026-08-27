/**
 * Duplicate prevention.
 *
 * The guarantee lives in a unique index in the migration, and the pipeline names those
 * same columns in its upsert `onConflict`. Nothing enforces that the two agree, and if they
 * drift the upsert stops deduplicating - silently, reinserting the same month of prices on
 * every run. So this reads both files and compares them.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const migration = read('../supabase/migrations/0001_init.sql')
const pipeline = read('../lib/scraper/pipeline.ts')

/** Columns inside the unique index on food_price_observations. */
function uniqueIndexColumns(): string[] {
  const match = migration.match(
    /create unique index food_price_observations_identity_idx\s*on food_price_observations \(([^;]*?)\);/s,
  )
  if (!match) throw new Error('unique index not found in the migration')

  // Split on top-level commas only: `coalesce(province, '')` contains one of its own.
  const columns: string[] = []
  let depth = 0
  let current = ''

  for (const character of match[1]) {
    if (character === '(') depth++
    if (character === ')') depth--
    if (character === ',' && depth === 0) {
      columns.push(current)
      current = ''
      continue
    }
    current += character
  }
  columns.push(current)

  return columns
    .map((column) => column.trim())
    .filter(Boolean)
    // coalesce(province, '') -> province
    .map((column) => column.replace(/^coalesce\(\s*([a-z_]+)\s*,.*\)$/i, '$1'))
}

/** Columns named in the pipeline's upsert conflict target. */
function conflictColumns(): string[] {
  const match = pipeline.match(/onConflict:\s*\n?\s*'([^']+)'/)
  if (!match) throw new Error('onConflict target not found in the pipeline')
  return match[1].split(',').map((column) => column.trim())
}

describe('the observation uniqueness key', () => {
  const indexColumns = uniqueIndexColumns()

  it('covers everything that makes an observation distinct', () => {
    expect(indexColumns).toEqual([
      'observation_date',
      'commodity_normalized',
      'unit_normalized',
      'geographic_scope',
      'province',
      'market',
      'price_type',
      'source_type',
    ])
  })

  it('includes source_type, so a PDF and an HDX price for one month can coexist', () => {
    // The two sources are not confirmed compatible, so they must not collide.
    expect(indexColumns).toContain('source_type')
  })

  it('includes geographic_scope, so different province sets stay separate series', () => {
    expect(indexColumns).toContain('geographic_scope')
  })

  it('matches the conflict target the pipeline upserts against', () => {
    // If these drift, re-running the cron quietly duplicates every observation.
    expect(conflictColumns()).toEqual(indexColumns)
  })
})

describe('the nullable columns in that key', () => {
  it('coalesces province and market, because NULL never equals NULL in Postgres', () => {
    // Without this the same national-scope row inserts again on every single run.
    expect(migration).toMatch(/coalesce\(province, ''\)/)
    expect(migration).toMatch(/coalesce\(market, ''\)/)
  })
})

describe('the pipeline upsert', () => {
  it('ignores duplicates rather than erroring on them', () => {
    expect(pipeline).toMatch(/ignoreDuplicates:\s*true/)
  })

  it('counts rows so a run can report what was genuinely new', () => {
    expect(pipeline).toMatch(/count:\s*'exact'/)
  })
})

describe('report-level idempotency', () => {
  it('makes source_url unique, so a report is processed once', () => {
    expect(migration).toMatch(/source_url\s+text not null unique/)
  })
})

describe('approval cannot be automated', () => {
  it('never writes an approved status from the pipeline', () => {
    // Only the admin route may set this. If this ever fails, unreviewed data is public.
    expect(pipeline).not.toMatch(/validation_status:\s*'approved'/)
  })
})
