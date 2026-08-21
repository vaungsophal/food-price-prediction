/**
 * Telegram webhook.
 *
 * Two rules shape everything here:
 *
 *  1. **Always answer 200.** Telegram retries any non-2xx with the same update, so an
 *     exception on malformed input would turn into a loop. Failures are reported to the
 *     user as text, never as a status code.
 *  2. **Reply through the response body**, using Telegram's response-method pattern:
 *     the JSON we return *is* the API call. No outbound request, no round-trip, and
 *     `BOT_TOKEN` never has to exist on Vercel.
 */

import { isFailure, sparkline } from '../utils/engine'

const TELEGRAM_MAX = 4096

interface TelegramUpdate {
  message?: { chat?: { id?: number }, text?: string }
}

/** Escape the characters legacy Markdown treats as formatting, for interpolated values. */
function escapeMd(text: string): string {
  return text.replace(/([_*[\]`])/g, '\\$1')
}

/** Trim to Telegram's hard limit on a line boundary rather than mid-word. */
function truncate(text: string, note: string): string {
  if (text.length <= TELEGRAM_MAX) return text
  const budget = TELEGRAM_MAX - note.length - 1
  const boundary = text.lastIndexOf('\n', budget)
  return text.slice(0, boundary === -1 ? budget : boundary) + '\n' + note
}

/**
 * encodeURIComponent leaves parentheses alone, and an unescaped ")" closes a Markdown
 * link early — which would break every commodity name, since most carry a bracketed
 * qualifier like "Rice (mixed, low quality)".
 */
function encodeForLink(value: string): string {
  return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function reply(chatId: number, text: string) {
  return {
    method: 'sendMessage',
    chat_id: chatId,
    text: text.slice(0, TELEGRAM_MAX),
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  }
}

const HELP = [
  '*Cambodia Food Price Forecast*',
  '',
  'Commands:',
  '`/predict <commodity> <market>` — next-period forecast',
  '`/commodities` — what is tracked',
  '`/markets` — where it is tracked',
  '`/help` — this message',
  '',
  'Example: `/predict rice Phnom Penh`',
  '',
  '_Forecasts are model estimates, not official prices._',
].join('\n')

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)

  // Reject spoofed calls before doing any work, but still with a 200 body — Telegram
  // itself never sees this branch, and a 401 would only invite retries from whoever did.
  const secret = config.webhookSecret
  if (secret && getHeader(event, 'x-telegram-bot-api-secret-token') !== secret) {
    setResponseStatus(event, 200)
    return { ok: false, error: 'bad secret token' }
  }

  let update: TelegramUpdate
  try {
    update = await readBody<TelegramUpdate>(event)
  }
  catch {
    return {}
  }

  const chatId = update?.message?.chat?.id
  const text = update?.message?.text?.trim()

  // Edits, joins, callbacks, stickers — nothing to answer, but still a 200.
  if (typeof chatId !== 'number' || !text) return {}

  // Group chats append @BotName to commands.
  const [rawCommand = '', ...rest] = text.split(/\s+/)
  const command = rawCommand.split('@')[0]!.toLowerCase()
  const argument = rest.join(' ').trim()

  if (command === '/start' || command === '/help') {
    return reply(chatId, HELP)
  }

  const predictor = await usePredictor()

  if (command === '/commodities') {
    const body = ['*Tracked commodities*', '', ...predictor.commodities.map((c) => `• ${escapeMd(c)}`)].join('\n')
    return reply(chatId, truncate(body, '_…list truncated._'))
  }

  if (command === '/markets') {
    const body = ['*Tracked markets*', '', ...predictor.markets.map((m) => `• ${escapeMd(m)}`)].join('\n')
    return reply(chatId, truncate(body, '_…list truncated._'))
  }

  if (command !== '/predict') {
    return reply(chatId, `I don't know \`${escapeMd(command)}\`.\n\n${HELP}`)
  }

  if (!argument) {
    return reply(chatId, 'Tell me what and where, like `/predict rice Phnom Penh`. `/commodities` lists the options.')
  }

  const split = predictor.splitCommodityMarket(argument)
  if (!split) {
    return reply(
      chatId,
      `\`${escapeMd(argument)}\` is only one word — I need a commodity *and* a market, like \`/predict rice Phnom Penh\`.`,
    )
  }

  const [commodityInput, marketInput] = split
  const result = predictor.predict(commodityInput, marketInput)

  if (isFailure(result)) {
    const lines = [escapeMd(result.error)]
    if (result.suggestions?.length) {
      lines.push('', 'It is tracked at:', ...result.suggestions.map((m) => `• ${escapeMd(m)}`))
    }
    else {
      lines.push('', 'Try `/commodities` or `/markets` to see what is available.')
    }
    return reply(chatId, lines.join('\n'))
  }

  const arrow = result.trend === 'up' ? '▲' : result.trend === 'down' ? '▼' : '▬'
  const sign = result.changePct >= 0 ? '+' : ''
  const siteUrl = config.siteUrl

  const lines = [
    `*${escapeMd(result.commodity)}*`,
    `${escapeMd(result.market)}, ${escapeMd(result.province)} · ${escapeMd(result.pricetype)}`,
    '',
    `Last recorded (${result.lastDate}): *$${result.lastPrice.toFixed(3)}* / ${escapeMd(result.unit)}`,
    `Next period forecast: *$${result.predictedPrice.toFixed(3)}*`,
    `${arrow} ${sign}${result.changePct.toFixed(1)}%`,
    '',
    `\`${sparkline(result.prices.slice(-24))}\``,
    `_${result.dates[0]} → ${result.lastDate}, ${result.prices.length} observations_`,
  ]

  if (siteUrl) {
    const query = `commodity=${encodeForLink(result.commodity)}&market=${encodeForLink(result.market)}`
    lines.push('', `[See the chart](${siteUrl.replace(/\/$/, '')}/?${query})`)
  }

  lines.push('', '_Model estimate, not an official price._')

  return reply(chatId, lines.join('\n'))
})
