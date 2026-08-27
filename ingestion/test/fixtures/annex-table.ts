/**
 * Fixture builders.
 *
 * These synthesise the GEOMETRY of a WFP annex table - heading, header row, column
 * positions, row baselines - without reproducing a report's text. The commodity names used
 * in tests are the handful needed to exercise the mapping table, and no fixture reproduces
 * a meaningful portion of any published document.
 *
 * The coordinates mirror the real layout closely enough to be a fair test: heading near the
 * top of the page, header row beneath it, month columns evenly spaced, Change columns to
 * their right, data rows marching down at a fixed leading.
 */

import type { ExtractedDocument, ExtractedPage, PositionedItem } from '@/lib/scraper/pdf-extractor'

/** Rough advance width. Real values come from pdf.js; proportionality is what matters. */
const widthOf = (text: string) => text.length * 5

function item(text: string, x: number, y: number): PositionedItem {
  return { text, x, y, width: widthOf(text), height: 9 }
}

export interface FixtureRow {
  commodity: string
  unit: string
  /** One entry per month column. Use '-' for a missing value. */
  values: string[]
  /** Percent cells in the Change columns, which must never be read as prices. */
  changes?: string[]
  /**
   * Render the commodity and unit one baseline ABOVE the prices, as the real PDFs start
   * doing partway down a page.
   */
  splitBaseline?: boolean
  /** Render the commodity across two baselines, as a wrapped long name. */
  wrapLabel?: boolean
}

export interface FixturePageOptions {
  heading: string
  months: string[]
  rows: FixtureRow[]
  pageNumber?: number
  /** Prose elsewhere on the page, e.g. a sentence stating the geographic scope. */
  bodyText?: string[]
}

const HEADING_Y = 807
const HEADER_Y = 771
const FIRST_ROW_Y = 738
const ROW_LEADING = 15

const COMMODITY_X = 55
const UNIT_X = 182
const FIRST_MONTH_X = 231
const MONTH_SPACING = 44

export function buildAnnexPage(options: FixturePageOptions): ExtractedPage {
  const { heading, months, rows, pageNumber = 7, bodyText = [] } = options
  const items: PositionedItem[] = []

  items.push(item(heading, 51, HEADING_Y))

  items.push(item('Food commodity', COMMODITY_X, HEADER_Y))
  items.push(item('Unit', UNIT_X, HEADER_Y))
  months.forEach((month, index) => {
    items.push(item(month, FIRST_MONTH_X + index * MONTH_SPACING, HEADER_Y))
  })

  const changeX = FIRST_MONTH_X + months.length * MONTH_SPACING + 6
  items.push(item('Change', changeX, HEADER_Y))
  items.push(item('Change', changeX + 56, HEADER_Y))

  let y = FIRST_ROW_Y

  for (const row of rows) {
    // Values sit slightly right of the header, as right-aligned numerals do.
    const valueY = row.splitBaseline ? y - 3 : y

    if (row.wrapLabel) {
      // Split on the last space, second half rendered at the left margin below.
      const cut = row.commodity.lastIndexOf(' ')
      items.push(item(row.commodity.slice(0, cut), COMMODITY_X + 8, y))
      items.push(item(row.commodity.slice(cut + 1), COMMODITY_X, y - 11))
    } else {
      items.push(item(row.commodity, COMMODITY_X, y))
    }

    if (row.unit) items.push(item(row.unit, UNIT_X, y))

    row.values.forEach((value, index) => {
      if (value === '') return
      items.push(item(value, FIRST_MONTH_X + index * MONTH_SPACING + 4, valueY))
    })

    ;(row.changes ?? []).forEach((change, index) => {
      items.push(item(change, changeX + index * 56 + 20, valueY))
    })

    y -= ROW_LEADING + (row.wrapLabel ? 11 : 0)
  }

  bodyText.forEach((text, index) => {
    items.push(item(text, 51, 200 - index * 12))
  })

  return {
    pageNumber,
    items,
    rawText: items.map((entry) => entry.text).join(' '),
  }
}

export function buildDocument(pages: ExtractedPage[]): ExtractedDocument {
  return { pageCount: pages.length, pages }
}

/** A publication page shaped like WFP's: a document-links table of title + download cells. */
export function buildPublicationHtml(
  entries: Array<{ title: string; documentId: string }>,
): string {
  const rows = entries
    .map(
      (entry) => `
      <tr>
        <td>${entry.title}</td>
        <td>
          <div class="document-links-table__actions-cell">
            <span class="file-type file-type--document">PDF | 1.2 MB</span>
            <a href="https://docs.wfp.org/api/documents/${entry.documentId}/download/"
               class="document-links-table__link">Download</a>
          </div>
        </td>
      </tr>`,
    )
    .join('\n')

  return `<!doctype html>
<html><body>
  <h1>WFP Cambodia - Market &amp; Seasonal Monitoring Update</h1>
  <section class="document-links-table">
    <table><tbody>${rows}</tbody></table>
  </section>
</body></html>`
}
