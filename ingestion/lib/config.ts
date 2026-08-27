/**
 * Every tunable the pipeline has, in one place.
 *
 * The validation thresholds in particular are deliberately overridable from the
 * environment: what counts as a "suspicious" price jump for rice is a judgement call, and
 * a reviewer drowning in false positives should be able to widen the band without a
 * redeploy. Nothing here ever deletes a record - thresholds only decide whether a row is
 * filed as pending or rejected, and rejected rows stay in the table with a reason.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const WFP_PUBLICATION_URL =
  'https://www.wfp.org/publications/wfp-cambodia-market-seasonal-monitoring-update'

/**
 * docs.wfp.org sits behind a WAF that 403s a bare token user-agent such as
 * "CambodiaFoodPricePipeline/1.0", and also 403s a bare "Mozilla/5.0". It does accept the
 * conventional `Mozilla/5.0 (compatible; <name>; +<url>)` form, which is both descriptive
 * and identifiable - so we stay honest about who we are and still get the file. Verified
 * against the live host; see README "Known limitations" if this ever starts failing.
 */
export const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ??
  'Mozilla/5.0 (compatible; CambodiaFoodPricePipeline/1.0; +https://github.com/vaungsophal/food-price-prediction)'

export const HTTP = {
  /** Publication page is small; the PDFs run to a few MB. */
  pageTimeoutMs: num('HTTP_PAGE_TIMEOUT_MS', 30_000),
  pdfTimeoutMs: num('HTTP_PDF_TIMEOUT_MS', 120_000),
  maxAttempts: num('HTTP_MAX_ATTEMPTS', 3),
  backoffBaseMs: num('HTTP_BACKOFF_BASE_MS', 1_000),
  /** Politeness gap between consecutive PDF downloads in one run. */
  politenessDelayMs: num('HTTP_POLITENESS_DELAY_MS', 2_000),
  /** Refuse to buffer anything larger than this. */
  maxPdfBytes: num('HTTP_MAX_PDF_BYTES', 40 * 1024 * 1024),
}

export const PIPELINE = {
  /**
   * Cap on how many previously unseen reports one cron run will download. The backlog on
   * first run is ~30 PDFs; processing them all in one Vercel invocation would blow the
   * function timeout, so we chip away weekly instead.
   */
  maxReportsPerRun: num('MAX_REPORTS_PER_RUN', 3),
}

export const VALIDATION = {
  /** Nothing below this lands as anything other than pending. */
  extractionConfidenceMin: num('EXTRACTION_CONFIDENCE_MIN', 0.6),

  /**
   * Absolute sanity band on a KHR price, spanning iodized salt (~1,200/kg) through dried
   * fish (~30,000/kg) with generous headroom. Outside this the number is far likelier to
   * be a mis-snapped column than a real price.
   */
  minPriceKhr: num('MIN_PRICE_KHR', 100),
  maxPriceKhr: num('MAX_PRICE_KHR', 500_000),

  /**
   * Month-on-month change against the most recent APPROVED observation in the same series
   * that flags a row for closer human attention. Cambodian vegetable prices genuinely swing
   * 50%+ seasonally, so this is a "look at this" line, not an error.
   */
  suspiciousChangeRatio: num('SUSPICIOUS_CHANGE_RATIO', 0.6),

  /** Observation dates further back than this are almost certainly a misparsed year. */
  earliestObservationDate: process.env.EARLIEST_OBSERVATION_DATE ?? '2015-01-01',
}

/**
 * Fuel and fertilizer share the annex table with food, and the annex heading counts them
 * among "retail prices". They are not food prices, and feeding them to a food-price model
 * would be wrong, so they are dropped at normalization with an explicit reason rather than
 * silently slipping through under an unmapped commodity name.
 */
export const NON_FOOD_COMMODITIES = [
  'gasoline',
  'diesel',
  'fertilizer',
  'urea',
  'dap',
  'petrol',
  'lpg',
]
