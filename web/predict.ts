import type { VercelRequest, VercelResponse } from '@vercel/node'
import { predictPrice } from './_lib/predictor'

/** GET /api/predict?commodity=Rice...&market=Phnom%20Penh */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const commodity = String(req.query.commodity ?? '')
  const market = String(req.query.market ?? '')
  const pricetype = String(req.query.pricetype ?? 'Retail')

  if (!commodity || !market) {
    res.status(400).json({ error: 'Pass both a commodity and a market.' })
    return
  }

  const result = predictPrice(commodity, market, pricetype)
  if ('error' in result) {
    res.status(404).json(result)
    return
  }

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate')
  res.status(200).json(result)
}
