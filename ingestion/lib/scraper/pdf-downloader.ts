/**
 * PDF download and content hashing.
 *
 * The hash is over the file bytes and exists to answer "did this URL's content change?".
 * WFP has been known to silently re-upload a corrected report at the same URL; comparing
 * hashes is how a reviewer finds out rather than assuming the first parse still holds.
 */

import { createHash } from 'node:crypto'
import { fetchPdf } from '../http'

export interface DownloadedPdf {
  bytes: Uint8Array
  /** SHA-256, hex. */
  fileHash: string
  byteLength: number
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function downloadPdf(url: string): Promise<DownloadedPdf> {
  const bytes = await fetchPdf(url)
  return { bytes, fileHash: hashBytes(bytes), byteLength: bytes.byteLength }
}
