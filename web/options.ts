import type { VercelRequest, VercelResponse } from '@vercel/node'
import { COMMODITIES, marketsFor } from './_lib/predictor'

/** Commodity list plus the markets each one is actually sold at (drives the dependent dropdown). */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const marketsByCommodity: Record<string, string[]> = {}
  for (const commodity of COMMODITIES) marketsByCommodity[commodity] = marketsFor(commodity)

  // Static for the life of a deploy, so let the CDN hold it
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate')
  res.status(200).json({ commodities: COMMODITIES, marketsByCommodity })
}
