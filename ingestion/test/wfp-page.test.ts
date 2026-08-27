import { describe, expect, it } from 'vitest'
import {
  detectLanguage,
  extractDocumentId,
  isProcessableReport,
  parsePublicationDateFromTitle,
  parseReportLinks,
  sortByPublicationDate,
} from '@/lib/scraper/wfp-page'
import { buildPublicationHtml } from './fixtures/annex-table'

describe('parseReportLinks', () => {
  const html = buildPublicationHtml([
    { title: 'Cambodia Market Situation Update - July 2026', documentId: 'WFP-0000175046' },
    { title: 'Cambodia Market Situation Update - April 2026', documentId: 'WFP-0000173383' },
    { title: 'Cambodia - Market & Seasonal Monitoring - November 2024 - (English)', documentId: 'WFP-0000163707' },
    { title: 'Cambodia - Market & Seasonal Monitoring - November 2024 - (Khmer)', documentId: 'WFP-0000163708' },
  ])

  const reports = parseReportLinks(html)

  it('finds every docs.wfp.org download link', () => {
    expect(reports).toHaveLength(4)
    expect(reports[0].sourceUrl).toBe('https://docs.wfp.org/api/documents/WFP-0000175046/download/')
  })

  it('takes the title from the row rather than the anchor text', () => {
    // Every anchor on the real page reads "Download".
    expect(reports[0].title).toBe('Cambodia Market Situation Update - July 2026')
    expect(reports.some((report) => /^download$/i.test(report.title))).toBe(false)
  })

  it('pulls the document id out of the URL', () => {
    expect(reports[0].documentId).toBe('WFP-0000175046')
  })

  it('ignores links that are not report downloads', () => {
    // The bare WFP-1 anchor has no row, so its only text is "Download" - not a title.
    const noise = `<html><body>
      <a href="https://www.wfp.org/publications/other">Other publication</a>
      <a href="https://docs.wfp.org/api/documents/WFP-1/download/">Download</a>
      <table><tbody>
        <tr>
          <td>Report A</td>
          <td><a href="https://docs.wfp.org/api/documents/WFP-2/download/">Download</a></td>
        </tr>
      </tbody></table>
    </body></html>`

    const found = parseReportLinks(noise)
    expect(found.map((report) => report.documentId)).toEqual(['WFP-2'])
  })
})

describe('duplicate report detection', () => {
  it('collapses a link the page lists more than once', () => {
    // The live page repeats at least one row inside its collapsed "View all" section.
    const html = buildPublicationHtml([
      { title: 'Cambodia Market Situation Update - July 2026', documentId: 'WFP-0000175046' },
      { title: 'Cambodia Market Situation Update - July 2026', documentId: 'WFP-0000175046' },
    ])

    expect(parseReportLinks(html)).toHaveLength(1)
  })

  it('keeps distinct documents that share a month', () => {
    const html = buildPublicationHtml([
      { title: 'Cambodia - Market & Seasonal Monitoring - November 2024 - (English)', documentId: 'WFP-A' },
      { title: 'Cambodia - Market & Seasonal Monitoring - November 2024 - (Khmer)', documentId: 'WFP-B' },
    ])

    expect(parseReportLinks(html)).toHaveLength(2)
  })
})

describe('parsePublicationDateFromTitle', () => {
  it('reads the month and year from the title', () => {
    expect(parsePublicationDateFromTitle('Cambodia Market Situation Update - July 2026')).toBe(
      '2026-07-01',
    )
    expect(
      parsePublicationDateFromTitle('Cambodia - Market & Seasonal Monitoring - January 2024 - (English)'),
    ).toBe('2024-01-01')
  })

  it('returns null when the title carries no date', () => {
    expect(parsePublicationDateFromTitle('Cambodia Market Bulletin')).toBeNull()
  })

  it('is a PUBLICATION date, which is not the observation date', () => {
    // The July 2026 report contains June 2026 prices. Conflating the two would date every
    // observation a month late.
    expect(parsePublicationDateFromTitle('Cambodia Market Situation Update - July 2026')).toBe(
      '2026-07-01',
    )
  })
})

describe('language handling', () => {
  it('detects the edition from the title', () => {
    expect(detectLanguage('... - November 2024 - (Khmer)')).toBe('khmer')
    expect(detectLanguage('... - November 2024 - (English)')).toBe('english')
    expect(detectLanguage('Cambodia Market Situation Update - July 2026')).toBe('unknown')
  })

  it('skips Khmer editions, which duplicate the English tables', () => {
    expect(isProcessableReport({ language: 'khmer' } as never)).toBe(false)
    expect(isProcessableReport({ language: 'english' } as never)).toBe(true)
    expect(isProcessableReport({ language: 'unknown' } as never)).toBe(true)
  })
})

describe('extractDocumentId', () => {
  it('handles the URL with and without a trailing slash', () => {
    expect(extractDocumentId('https://docs.wfp.org/api/documents/WFP-1/download/')).toBe('WFP-1')
    expect(extractDocumentId('https://docs.wfp.org/api/documents/WFP-1/download')).toBe('WFP-1')
  })

  it('returns null for an unrelated URL', () => {
    expect(extractDocumentId('https://www.wfp.org/publications/x')).toBeNull()
  })
})

describe('sortByPublicationDate', () => {
  it('puts the newest report first so a capped run takes the most recent', () => {
    const sorted = sortByPublicationDate([
      { publicationDate: '2025-11-01' },
      { publicationDate: '2026-07-01' },
      { publicationDate: null },
      { publicationDate: '2026-01-01' },
    ] as never)

    expect(sorted.map((report) => report.publicationDate)).toEqual([
      '2026-07-01',
      '2026-01-01',
      '2025-11-01',
      null,
    ])
  })
})
