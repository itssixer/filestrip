import { extFor } from './util.js'
import type { Format } from './types.js'

const FORMATS = new Set<string>(['jpeg', 'png', 'webp', 'gif', 'unknown'])

/**
 * Crypto-random, non-sequential filename. Original names leak as much as EXIF
 * does ("IMG_4401_beach-house.jpg"), so nothing from the input is reused.
 *
 * @param formatOrExt A `Format` (mapped to its canonical extension, so `jpeg`
 *   becomes `.jpg`) or a literal extension to use as-is.
 * @param bytes Entropy in bytes; 3 gives a 6-character hex token.
 */
export function randomName(formatOrExt: Format | string, bytes = 3): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  let id = ''
  for (const b of buf) id += b.toString(16).padStart(2, '0')

  const key = formatOrExt.toLowerCase()
  const ext = FORMATS.has(key) ? extFor(key as Format) : key.replace(/^\./, '')
  return `fs_${id}.${ext}`
}
