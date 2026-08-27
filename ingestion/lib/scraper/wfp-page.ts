/**
 * Report discovery on the WFP publication page.
 *
 * The page renders a table of document links; each row is a title cell plus a cell holding
 * a `docs.wfp.org/api/documents/<id>/download/` anchor. Some months are published twice,
 * once in English and once in Khmer, under otherwise identical titles.
 */

import * as cheerio from 'cheerio'
import { fetchHtml } from '../http'
import { WFP_PUBLICATION_URL } from '../config'
import { discoveredReportSchema, type DiscoveredReport } from '../schemas/food-price'

const DOWNLOAD_URL_RE = /^https?:\/\/docs\.wfp\.org\/api\/documents\/([^/]+)\/download\/?/i

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

/**
 * Publication date from the title, e.g. "Cambodia Market Situation Update - July 2026".
 *
 * This is the PUBLICATION month, not the observation month. The July 2026 report carries
 * June 2026 prices. The observation month is read from inside the PDF and the two are
 * kept strictly apart - see the README section on publication vs observation dates.
 *
 * Returned as the first of the month, since the page gives no day.
 */
export function parsePublicationDateFromTitle(title: string): string | null {
  const match = title.match(
    new RegExp(`\\b(${MONTHS.join('|')})\\b[\\s,'-]*(\\d{4})`, 'i'),
  )
  if (!match) return null

  const month = MONTHS.indexOf(match[1].toLowerCase()) + 1
  return `${match[2]}-${String(month).padStart(2, '0')}-01`
}

export function detectLanguage(title: string): DiscoveredReport['language'] {
  if (/\bkhmer\b/i.test(title)) return 'khmer'
  if (/\benglish\b/i.test(title)) return 'english'
  // Untagged titles have been English throughout the current report series.
  return 'unknown'
}

export function extractDocumentId(url: string): string | null {
  return url.match(DOWNLOAD_URL_RE)?.[1] ?? null
}

/**
 * Pull every report link out of the publication page HTML.
 *
 * Deduplicated by URL: the page repeats at least one row inside its collapsed "View all"
 * section, and processing the same document twice would be wasted downloads.
 */
export function parseReportLinks(html: string): DiscoveredReport[] {
  const $ = cheerio.load(html)
  const found = new Map<string, DiscoveredReport>()

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href')?.trim()
    if (!href || !DOWNLOAD_URL_RE.test(href)) return

    // The anchor itself just reads "Download"; the title lives in the row's first cell.
    const row = $(element).closest('tr')
    const cellTitle = row.find('td').first().text().trim()
    const fallback = $(element).attr('title')?.trim() || $(element).text().trim()
    const title = cellTitle || fallback

    if (!title || /^download$/i.test(title)) return

    const candidate = {
      title,
      sourceUrl: href,
      documentId: extractDocumentId(href),
      publicationDate: parsePublicationDateFromTitle(title),
      language: detectLanguage(title),
    }

    const parsed = discoveredReportSchema.safeParse(candidate)
    if (parsed.success && !found.has(parsed.data.sourceUrl)) {
      found.set(parsed.data.sourceUrl, parsed.data)
    }
  })

  return [...found.values()]
}

/**
 * Khmer editions duplicate their English counterpart's tables. Parsing both would produce
 * two identical observation sets competing for one uniqueness key, so only the English
 * edition is processed. Untagged titles are kept - the current monthly series does not
 * label its language.
 */
export function isProcessableReport(report: DiscoveredReport): boolean {
  return report.language !== 'khmer'
}

/** Newest first, so a capped run always takes the most recent reports. */
export function sortByPublicationDate(reports: DiscoveredReport[]): DiscoveredReport[] {
  return [...reports].sort((a, b) => (b.publicationDate ?? '').localeCompare(a.publicationDate ?? ''))
}

export async function discoverReports(url = WFP_PUBLICATION_URL): Promise<DiscoveredReport[]> {
  return sortByPublicationDate(parseReportLinks(await fetchHtml(url)))
}
