/**
 * Outbound HTTP with timeouts, bounded retries and exponential backoff.
 *
 * Two rules this enforces that matter for a scraper pointed at someone else's server:
 *
 *   - Every request has a deadline. A hung socket on Vercel burns the whole function
 *     budget and takes the run down with it.
 *   - 4xx is never retried. A 403 or a 404 will be a 403 or a 404 next time too, and
 *     hammering a document server that has already said no is exactly the behaviour that
 *     gets a scraper blocked.
 */

import { HTTP, USER_AGENT } from './config'

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Retry server errors and network faults; never retry a client error. */
function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === null || error.status >= 500 || error.status === 429
  }
  return true
}

interface FetchOptions {
  timeoutMs: number
  accept: string
  maxAttempts?: number
}

async function fetchOnce(url: string, options: FetchOptions): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: options.accept,
        'Accept-Language': 'en',
      },
    })

    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status} ${response.statusText}`, response.status, url)
    }

    return response
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(`timed out after ${options.timeoutMs}ms`, null, url)
    }
    throw new HttpError(error instanceof Error ? error.message : String(error), null, url)
  } finally {
    clearTimeout(timer)
  }
}

async function withRetries(url: string, options: FetchOptions): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? HTTP.maxAttempts
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchOnce(url, options)
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts || !isRetryable(error)) break
      // 1s, 2s, 4s - enough to ride out a blip without holding the function open for long.
      await sleep(HTTP.backoffBaseMs * 2 ** (attempt - 1))
    }
  }

  throw lastError
}

export async function fetchHtml(url: string): Promise<string> {
  const response = await withRetries(url, {
    timeoutMs: HTTP.pageTimeoutMs,
    accept: 'text/html,application/xhtml+xml',
  })
  return response.text()
}

export async function fetchPdf(url: string): Promise<Uint8Array> {
  const response = await withRetries(url, {
    timeoutMs: HTTP.pdfTimeoutMs,
    accept: 'application/pdf,*/*',
  })

  // Trust the header when it is present, but check the real size too: a truncated or
  // chunked response can exceed the advertised length.
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > HTTP.maxPdfBytes) {
    throw new HttpError(
      `PDF is ${declared} bytes, over the ${HTTP.maxPdfBytes} byte limit`,
      null,
      url,
    )
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > HTTP.maxPdfBytes) {
    throw new HttpError(
      `PDF is ${bytes.byteLength} bytes, over the ${HTTP.maxPdfBytes} byte limit`,
      null,
      url,
    )
  }

  // docs.wfp.org answers a blocked request with an HTML error page under a 200, so the
  // status code alone is not proof we got a document.
  if (!looksLikePdf(bytes)) {
    throw new HttpError('response body is not a PDF (missing %PDF- header)', null, url)
  }

  return bytes
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 5) return false
  // "%PDF-"
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  )
}

export const politenessDelay = () => sleep(HTTP.politenessDelayMs)
