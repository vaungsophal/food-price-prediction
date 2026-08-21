import type { VercelRequest, VercelResponse } from '@vercel/node'
import { COMMODITIES, MARKETS, predictPrice, splitCommodityMarket } from './_lib/predictor'

/**
 * Telegram webhook.
 *
 * Replies using the "response method" pattern: instead of a second outbound call to
 * the Bot API, the sendMessage payload is returned in this response body. One less
 * network round-trip, which matters on a cold start.
 */

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? ''
const SITE_URL = process.env.SITE_URL ?? ''

const WELCOME = [
  '🇰🇭 *Cambodia Food Price Predictor*',
  '',
  'I forecast the next market price for food commodities in Cambodia, from World Food Programme data.',
  '',
  '*Try:*',
  '`/predict rice phnom penh`',
  '`/predict pork battambang`',
  '',
  '/commodities — what I can predict',
  '/markets — where I have data',
  SITE_URL ? `\nCharts and full history: ${SITE_URL}` : '',
].join('\n')

function truncate(text: string, limit = 3900): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…`
}

/** Tiny inline sparkline — conveys shape without needing an image. */
function sparkline(values: number[]): string {
  if (values.length < 2) return ''
  const blocks = '▁▂▃▄▅▆▇█'
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values
    .slice(-16)
    .map((v) => blocks[Math.min(7, Math.floor(((v - min) / span) * 7))])
    .join('')
}

function reply(text: string): string {
  return text
}

function handleCommand(text: string): string {
  const trimmed = text.trim()
  const [rawCommand, ...rest] = trimmed.split(/\s+/)
  const command = rawCommand.split('@')[0].toLowerCase() // strip @BotName in groups
  const argument = rest.join(' ')

  if (command === '/start' || command === '/help') return reply(WELCOME)

  if (command === '/commodities') {
    return truncate(`*Commodities*\n${COMMODITIES.map((c) => `• ${c}`).join('\n')}`)
  }

  if (command === '/markets') {
    return truncate(`*Markets*\n${MARKETS.join(', ')}`)
  }

  if (command === '/predict') {
    const parts = splitCommodityMarket(argument)
    if (!parts) {
      return 'Give me a commodity *and* a market.\nExample: `/predict rice phnom penh`'
    }

    const result = predictPrice(parts[0], parts[1])
    if ('error' in result) {
      const extra = result.suggestions?.length ? `\nTracked at: ${result.suggestions.join(', ')}` : ''
      return `⚠️ ${result.error}${extra}`
    }

    const arrow = result.trend === 'up' ? '📈' : result.trend === 'down' ? '📉' : '➡️'
    const spark = sparkline(result.prices)

    return [
      `*${result.commodity}*`,
      `📍 ${result.market}, ${result.province}`,
      `🏷 ${result.pricetype} · per ${result.unit}`,
      '',
      `Last recorded (${result.lastDate}): *$${result.lastPrice.toFixed(2)}*`,
      `Predicted next: *$${result.predictedPrice.toFixed(2)}* ${arrow}`,
      `Change: ${result.changePct >= 0 ? '+' : ''}${result.changePct.toFixed(1)}%`,
      spark ? `\nRecent trend: \`${spark}\`` : '',
      '',
      '_Model estimate — not official pricing._',
    ].join('\n')
  }

  return 'Unknown command. Try `/predict rice phnom penh` or /help'
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    // Browser health check — confirms the deploy loaded its artifacts
    res.status(200).json({ status: 'ok', commodities: COMMODITIES.length, markets: MARKETS.length })
    return
  }

  if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
    res.status(403).json({ error: 'forbidden' })
    return
  }

  const update = (req.body ?? {}) as any
  const message = update.message ?? update.edited_message
  const chatId = message?.chat?.id
  const text = message?.text

  // Always 200 — a non-200 makes Telegram retry the same update in a loop.
  if (!chatId || !text) {
    res.status(200).json({ ok: true })
    return
  }

  let body: string
  try {
    body = handleCommand(text)
  } catch (error) {
    console.error('handler error', error)
    body = 'Something went wrong on my side. Please try again.'
  }

  res.status(200).json({
    method: 'sendMessage',
    chat_id: chatId,
    text: body,
    parse_mode: 'Markdown',
  })
}
