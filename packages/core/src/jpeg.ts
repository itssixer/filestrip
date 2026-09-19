import { concat, identifyPayload } from './util.js'
import type { RemovedBlock } from './types.js'

const SOI = 0xd8
const EOI = 0xd9
const SOS = 0xda
const COM = 0xfe

/** APP segments that carry identity or telemetry rather than decode data. */
function segmentLabel(marker: number, payload: Uint8Array): { kind: string; label: string } | null {
  if (marker === COM) return { kind: 'comment', label: 'JPEG comments' }
  if (marker === 0xe1) {
    const tag = String.fromCharCode(...payload.subarray(0, 4))
    if (tag === 'http') return { kind: 'xmp', label: 'XMP records' }
    return { kind: 'exif', label: 'EXIF block' }
  }
  if (marker === 0xed) return { kind: 'iptc', label: 'IPTC records' }
  if (marker === 0xee) return { kind: 'adobe', label: 'Adobe colour tags' }
  if (marker === 0xe2) return { kind: 'icc', label: 'ICC colour profile' }
  if (marker === 0xe0) return null
  if (marker >= 0xe3 && marker <= 0xec) return { kind: 'app', label: 'vendor APP segments' }
  if (marker === 0xef) return { kind: 'app', label: 'vendor APP segments' }
  return null
}

export interface JpegScrub {
  bytes: Uint8Array
  removed: RemovedBlock[]
  trailingBytes: number
  trailingLabel: string | null
}

/**
 * Rebuilds a JPEG from only the segments a decoder needs. Everything after the
 * EOI marker is dropped too, which is where polyglot archives hide.
 */
export function sanitizeJpeg(bytes: Uint8Array): JpegScrub | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return null

  const parts: Uint8Array[] = [bytes.subarray(0, 2)]
  const removed = new Map<string, RemovedBlock>()
  let i = 2
  let trailingBytes = 0
  let trailingLabel: string | null = null

  const drop = (kind: string, label: string, size: number) => {
    const prev = removed.get(kind)
    if (prev) prev.bytes += size
    else removed.set(kind, { kind, label, bytes: size })
  }

  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++
      continue
    }
    while (i + 1 < bytes.length && bytes[i + 1] === 0xff) i++
    if (i + 1 >= bytes.length) break

    const marker = bytes[i + 1]!

    if (marker === EOI) {
      parts.push(bytes.subarray(i, i + 2))
      const tail = bytes.subarray(i + 2)
      if (tail.length > 0) {
        trailingBytes = tail.length
        trailingLabel = identifyPayload(tail)
        drop('trailing', `appended ${trailingLabel}`, tail.length)
      }
      break
    }

    // Entropy-coded data runs to the end of the file; scan it for a real EOI.
    if (marker === SOS) {
      const end = findEoi(bytes, i + 2)
      if (end === -1) {
        parts.push(bytes.subarray(i))
        break
      }
      parts.push(bytes.subarray(i, end + 2))
      const tail = bytes.subarray(end + 2)
      if (tail.length > 0) {
        trailingBytes = tail.length
        trailingLabel = identifyPayload(tail)
        drop('trailing', `appended ${trailingLabel}`, tail.length)
      }
      break
    }

    // Standalone markers carry no length field.
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(i, i + 2))
      i += 2
      continue
    }

    if (i + 3 >= bytes.length) {
      parts.push(bytes.subarray(i))
      break
    }

    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!
    const total = 2 + len
    if (len < 2 || i + total > bytes.length) {
      parts.push(bytes.subarray(i))
      break
    }

    const payload = bytes.subarray(i + 4, i + total)
    const label = segmentLabel(marker, payload)
    if (label) drop(label.kind, label.label, total)
    else parts.push(bytes.subarray(i, i + total))

    i += total
  }

  return {
    bytes: concat(parts),
    removed: [...removed.values()],
    trailingBytes,
    trailingLabel
  }
}

/** Finds the EOI that terminates scan data, skipping stuffed 0xFF00 bytes. */
function findEoi(bytes: Uint8Array, from: number): number {
  for (let p = from; p + 1 < bytes.length; p++) {
    if (bytes[p] !== 0xff) continue
    const next = bytes[p + 1]!
    if (next === EOI) return p
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) continue
  }
  return -1
}

/** Returns the raw TIFF block inside APP1 so the EXIF parser can read it. */
export function findApp1Exif(bytes: Uint8Array): Uint8Array | null {
  let i = 2
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++
      continue
    }
    const marker = bytes[i + 1]!
    if (marker === SOS || marker === EOI) return null
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!
    const total = 2 + len
    if (len < 2 || i + total > bytes.length) return null
    if (marker === 0xe1) {
      const s = i + 4
      if (
        bytes[s] === 0x45 && bytes[s + 1] === 0x78 && bytes[s + 2] === 0x69 &&
        bytes[s + 3] === 0x66 && bytes[s + 4] === 0x00 && bytes[s + 5] === 0x00
      ) {
        return bytes.subarray(s + 6, i + total)
      }
    }
    i += total
  }
  return null
}

/** Bytes appended after the JPEG terminator, if any. */
export function jpegTrailing(bytes: Uint8Array): Uint8Array | null {
  for (let p = bytes.length - 2; p >= 2; p--) {
    if (bytes[p] === 0xff && bytes[p + 1] === EOI) {
      const tail = bytes.subarray(p + 2)
      return tail.length ? tail : null
    }
  }
  return null
}
