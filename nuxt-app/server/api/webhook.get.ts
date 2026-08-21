/**
 * Health check. Visit this after deploying: if it reports commodity and market counts,
 * the artifacts resolved inside the built output.
 */
export default defineEventHandler(async () => {
  const predictor = await usePredictor()
  return {
    status: 'ok',
    commodities: predictor.commodities.length,
    markets: predictor.markets.length,
    hint: 'POST Telegram updates here.',
  }
})
