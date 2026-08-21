/** Drives the dependent commodity -> market dropdowns. */
export default defineEventHandler(async (event) => {
  const predictor = await usePredictor()

  // The artifacts only change when the model is re-exported and redeployed.
  setResponseHeader(event, 'cache-control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400')

  return {
    commodities: predictor.commodities,
    marketsByCommodity: predictor.marketsByCommodity(),
  }
})
