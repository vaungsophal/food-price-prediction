/**
 * PDF text extraction, with coordinates.
 *
 * The important decision in this file is that we do NOT use flowed text extraction.
 *
 * The WFP annex tables are laid out as absolutely-positioned text runs, and the reading
 * order recorded in the PDF does not match the visual row order. Extracting plain text -
 * `pdftotext -layout`, or joining pdf.js items in document order - produces a table where
 * prices are attached to the WRONG commodities. Checked against the July 2026 report, a
 * flowed extraction reports mixed rice at 1,905 KHR and hangs 2,011 off a fish row four
 * lines down. Both numbers are real; the pairing is fiction. That is the single most
 * dangerous failure mode for this project, because the output looks perfectly plausible.
 *
 * So we keep every item's x/y and rebuild rows and columns geometrically in table-parser.
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

/** One positioned text run. Origin is bottom-left, y grows upward. */
export interface PositionedItem {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface ExtractedPage {
  pageNumber: number
  items: PositionedItem[]
  /** Items joined in document order. Fine for heading detection, never for table data. */
  rawText: string
}

export interface ExtractedDocument {
  pageCount: number
  pages: ExtractedPage[]
}

export async function extractPositionedText(data: Uint8Array): Promise<ExtractedDocument> {
  const doc = await getDocument({
    data,
    // These reports embed their fonts; disabling the extras keeps the function lean and
    // avoids pdf.js reaching for worker/canvas machinery that does not exist on Vercel.
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    // These reports trip a stream of harmless font warnings; keep the run log readable.
    verbosity: 0,
  }).promise

  try {
    const pages: ExtractedPage[] = []

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      try {
        const content = await page.getTextContent()
        const items: PositionedItem[] = []
        const rawParts: string[] = []

        for (const raw of content.items) {
          const item = raw as TextItem
          if (typeof item.str !== 'string') continue
          rawParts.push(item.str)
          if (!item.str.trim()) continue

          items.push({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width ?? 0,
            height: item.height ?? 0,
          })
        }

        pages.push({ pageNumber, items, rawText: rawParts.join(' ') })
      } finally {
        page.cleanup()
      }
    }

    return { pageCount: doc.numPages, pages }
  } finally {
    await doc.destroy()
  }
}

/** A visual row: items sharing a baseline, ordered left to right. */
export interface PositionedRow {
  y: number
  items: PositionedItem[]
}

/**
 * Cluster items into visual rows.
 *
 * Single-linkage on y rather than rounding to a fixed grid: rounding splits a row whose
 * baseline happens to straddle a bucket boundary, which is exactly what happens partway
 * down the July 2026 annex where the commodity name sits 3pt above its own prices.
 */
export function groupIntoRows(items: PositionedItem[], toleranceY = 3.5): PositionedRow[] {
  if (items.length === 0) return []

  const byY = [...items].sort((a, b) => b.y - a.y)
  const rows: PositionedRow[] = []
  let current: PositionedItem[] = [byY[0]]
  let anchor = byY[0].y

  for (const item of byY.slice(1)) {
    if (Math.abs(item.y - anchor) <= toleranceY) {
      current.push(item)
    } else {
      rows.push(finishRow(current))
      current = [item]
      anchor = item.y
    }
  }
  rows.push(finishRow(current))

  return rows
}

function finishRow(items: PositionedItem[]): PositionedRow {
  const sorted = [...items].sort((a, b) => a.x - b.x)
  // Median y is steadier than the first item's: superscripts and footnote markers sit off
  // the baseline and would otherwise drag the row's reported position with them.
  const ys = [...items].map((i) => i.y).sort((a, b) => a - b)
  return { y: ys[Math.floor(ys.length / 2)], items: sorted }
}

/**
 * Join adjacent items into a single string, inserting a space only where the horizontal
 * gap suggests one. pdf.js splits "30-35% broken rice" into three runs with no gaps;
 * blindly joining with spaces yields "30 - 35% broken rice" and breaks the commodity
 * lookup, while blindly concatenating welds genuinely separate words together.
 */
export function joinItems(items: PositionedItem[], spaceThreshold = 1.2): string {
  if (items.length === 0) return ''

  let out = items[0].text
  let cursor = items[0].x + items[0].width

  for (const item of items.slice(1)) {
    const gap = item.x - cursor
    // A strongly negative gap means the text wrapped to a new visual line that a caller
    // has stitched into this row ("Orange-flesh Sweet" + "Potatoes*"). Those always need
    // a space, or the two lines weld into "SweetPotatoes" and the lookup misses.
    const wrapped = gap < -spaceThreshold
    const alreadySpaced = /\s$/.test(out) || /^\s/.test(item.text)
    out += (gap > spaceThreshold || wrapped) && !alreadySpaced ? ` ${item.text}` : item.text
    cursor = item.x + item.width
  }

  return out.replace(/\s+/g, ' ').trim()
}
