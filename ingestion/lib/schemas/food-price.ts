/**
 * Runtime shapes. Zod is the boundary guard here: everything in this file describes data
 * that came from outside the program - a scraped PDF, a query string, a request body - and
 * is therefore untrusted until parsed.
 */

import { z } from 'zod'

/** First-of-month ISO date. The pipeline stores months, never mid-month days. */
export const monthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/, 'expected an ISO date on the first of a month')

export const priceTypeSchema = z.enum(['retail', 'wholesale', 'unknown'])
export const sourceTypeSchema = z.enum(['WFP_PDF', 'WFP_HDX', 'MANUAL'])
export const validationStatusSchema = z.enum(['pending', 'approved', 'rejected'])

/** A candidate observation, after normalization and before it is written. */
export const candidateObservationSchema = z.object({
  observationDate: monthDateSchema,
  commodityOriginal: z.string().min(1),
  commodityNormalized: z.string().min(1),
  unitOriginal: z.string(),
  unitNormalized: z.string().min(1),
  priceKhr: z.number().positive().finite(),
  geographicScope: z.string().min(1),
  province: z.string().min(1).nullable(),
  market: z.string().min(1).nullable(),
  priceType: priceTypeSchema,
  sourceType: sourceTypeSchema,
  extractionConfidence: z.number().min(0).max(1),
  validationNotes: z.string().nullable(),
})

export type CandidateObservation = z.infer<typeof candidateObservationSchema>

/** A report link discovered on the WFP publication page. */
export const discoveredReportSchema = z.object({
  title: z.string().min(1),
  sourceUrl: z.string().url(),
  documentId: z.string().nullable(),
  publicationDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  language: z.enum(['english', 'khmer', 'unknown']),
})

export type DiscoveredReport = z.infer<typeof discoveredReportSchema>

// ---------------------------------------------------------------------------
// Public API query
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

/**
 * `/api/prices` query parameters. Note `limit` is capped: an uncapped page size lets one
 * request pull the whole table, which is both a performance problem and an easy way to
 * hammer the free Supabase tier.
 */
export const priceQuerySchema = z.object({
  commodity: z.string().min(1).optional(),
  province: z.string().min(1).optional(),
  market: z.string().min(1).optional(),
  priceType: priceTypeSchema.optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  sourceType: sourceTypeSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
})

export type PriceQuery = z.infer<typeof priceQuerySchema>

/** Body for a rejection. Notes are mandatory - a rejection without a reason is useless. */
export const rejectBodySchema = z.object({
  notes: z.string().min(1, 'a rejection must say why').max(2000),
})

/** Body for an approval. Notes are optional here. */
export const approveBodySchema = z.object({
  notes: z.string().max(2000).optional(),
})
