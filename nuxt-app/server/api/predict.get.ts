import { isFailure } from '../utils/engine'

/** Forecast plus the 24-point history the chart draws. */
export default defineEventHandler(async (event) => {
  const { commodity, market, pricetype } = getQuery(event)

  if (typeof commodity !== 'string' || typeof market !== 'string' || !commodity || !market) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Pass both a commodity and a market, e.g. /api/predict?commodity=rice&market=Phnom Penh',
    })
  }

  const predictor = await usePredictor()
  const result = predictor.predict(commodity, market, typeof pricetype === 'string' ? pricetype : 'Retail')

  if (isFailure(result)) {
    throw createError({
      statusCode: 404,
      statusMessage: result.error,
      data: result,
    })
  }

  setResponseHeader(event, 'cache-control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=3600')

  return result
})
