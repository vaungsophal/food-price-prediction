/**
 * Validation.
 *
 * Two outcomes only: `rejected` for a record that cannot possibly be right, and `pending`
 * for everything else. Nothing here can produce `approved` - that transition belongs to a
 * human in the admin UI, and keeping it out of this file is what makes "only reviewed data
 * reaches the model" a structural property rather than a promise.
 *
 * Rejected records are written, not dropped, with the reason attached. A silently
 * discarded record is a bug you cannot see; a rejected one shows up in the review queue.
 */

import { VALIDATION } from '../config'
import type { NormalizedObservation } from './normalizer'
import type { CandidateObservation } from '../schemas/food-price'
import { candidateObservationSchema } from '../schemas/food-price'
import { UNIT_MAP } from './commodity-map'

export interface PriorPrice {
  commodityNormalized: string
  unitNormalized: string
  geographicScope: string
  priceKhr: number
  observationDate: string
}

export interface ValidatedObservation {
  candidate: CandidateObservation
  status: 'pending' | 'rejected'
  notes: string[]
}

export interface ValidationContext {
  /** Publication date of the source report, ISO. Observations cannot postdate it. */
  publicationDate: string | null
  /**
   * Latest approved price per series, keyed by `commodity|unit|scope`. Used only to flag
   * outliers for attention - never to correct or replace an extracted value.
   */
  priorPrices: Map<string, PriorPrice>
}

export const seriesKey = (
  commodityNormalized: string,
  unitNormalized: string,
  geographicScope: string,
) => `${commodityNormalized}|${unitNormalized}|${geographicScope}`

const isKnownUnit = (unit: string) =>
  Object.values(UNIT_MAP).some((definition) => definition.normalized === unit)

/** Month-of-observation vs month-of-publication, both first-of-month ISO strings. */
function isAfterPublication(observationDate: string, publicationDate: string): boolean {
  // Compare by month: a report published 21 July can legitimately carry July observations,
  // so only a strictly later MONTH is impossible.
  return observationDate.slice(0, 7) > publicationDate.slice(0, 7)
}

export function validateObservation(
  observation: NormalizedObservation,
  context: ValidationContext,
): ValidatedObservation {
  const notes = [...observation.notes]
  const failures: string[] = []

  // --- hard failures: the record cannot be right ---------------------------------

  if (!observation.commodityNormalized || !observation.commodityOriginal.trim()) {
    failures.push('commodity is empty')
  }

  if (!Number.isFinite(observation.priceKhr) || observation.priceKhr <= 0) {
    failures.push(`price ${observation.priceKhr} is not a positive number`)
  } else if (observation.priceKhr < VALIDATION.minPriceKhr) {
    failures.push(
      `price ${observation.priceKhr} KHR is below the ${VALIDATION.minPriceKhr} KHR floor`,
    )
  } else if (observation.priceKhr > VALIDATION.maxPriceKhr) {
    failures.push(
      `price ${observation.priceKhr} KHR is above the ${VALIDATION.maxPriceKhr} KHR ceiling`,
    )
  }

  if (!/^\d{4}-\d{2}-01$/.test(observation.observationDate)) {
    failures.push(`observation date "${observation.observationDate}" is not a month start`)
  } else {
    if (observation.observationDate < VALIDATION.earliestObservationDate) {
      failures.push(
        `observation date ${observation.observationDate} predates ${VALIDATION.earliestObservationDate}, likely a misparsed year`,
      )
    }
    // The observation month must not be later than the month the report was published:
    // a report cannot contain prices from the future.
    if (
      context.publicationDate &&
      isAfterPublication(observation.observationDate, context.publicationDate)
    ) {
      failures.push(
        `observation month ${observation.observationDate.slice(0, 7)} is after the report was published (${context.publicationDate})`,
      )
    }
  }

  // --- soft flags: plausible, but a human should look --------------------------

  if (!isKnownUnit(observation.unitNormalized)) {
    notes.push(`unit "${observation.unitNormalized}" is not a recognised unit`)
  }

  if (observation.extractionConfidence < VALIDATION.extractionConfidenceMin) {
    notes.push(
      `extraction confidence ${observation.extractionConfidence} is below the ${VALIDATION.extractionConfidenceMin} threshold`,
    )
  }

  const prior = context.priorPrices.get(
    seriesKey(
      observation.commodityNormalized,
      observation.unitNormalized,
      observation.geographicScope,
    ),
  )

  if (prior && prior.priceKhr > 0 && observation.observationDate > prior.observationDate) {
    const change = (observation.priceKhr - prior.priceKhr) / prior.priceKhr
    if (Math.abs(change) > VALIDATION.suspiciousChangeRatio) {
      notes.push(
        `price moved ${(change * 100).toFixed(1)}% from the last approved value ` +
          `(${prior.priceKhr} KHR in ${prior.observationDate.slice(0, 7)}), ` +
          `beyond the ${(VALIDATION.suspiciousChangeRatio * 100).toFixed(0)}% review threshold`,
      )
    }
  }

  const candidate: CandidateObservation = {
    observationDate: observation.observationDate,
    commodityOriginal: observation.commodityOriginal,
    commodityNormalized: observation.commodityNormalized,
    unitOriginal: observation.unitOriginal,
    unitNormalized: observation.unitNormalized,
    priceKhr: observation.priceKhr,
    geographicScope: observation.geographicScope,
    province: observation.province,
    market: observation.market,
    priceType: observation.priceType,
    // Currency is KHR by construction: the annex tables are published in KHR and nothing
    // in this pipeline converts. A non-KHR source would need its own source_type.
    sourceType: 'WFP_PDF',
    extractionConfidence: observation.extractionConfidence,
    validationNotes: null,
  }

  // Last line of defence: if the shape is wrong at this point it is a programming error,
  // and the record is rejected rather than pushed at the database.
  const shape = candidateObservationSchema.safeParse(candidate)
  if (!shape.success) {
    failures.push(
      ...shape.error.issues.map((issue) => `${issue.path.join('.') || 'record'}: ${issue.message}`),
    )
  }

  const allNotes = [...notes, ...failures]

  return {
    candidate: { ...candidate, validationNotes: allNotes.length ? allNotes.join('; ') : null },
    status: failures.length > 0 ? 'rejected' : 'pending',
    notes: allNotes,
  }
}

export function validateAll(
  observations: NormalizedObservation[],
  context: ValidationContext,
): ValidatedObservation[] {
  return observations.map((observation) => validateObservation(observation, context))
}
