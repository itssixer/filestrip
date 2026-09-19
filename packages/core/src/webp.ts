import { concat, fourcc, u32, identifyPayload } from './util.js'
import type { RemovedBlock, TelemetryHit } from './types.js'

/** RIFF chunks are padded to even length. */
function pad(n: number): number {
  return n + (n & 1)
}

const DROP: Record<string, { kind: string; label: string }> = {
  EXIF: { kind: 'exif', label: 'EXIF block' },
  'XMP ': { kind: 'xmp', label: 'XMP records' },
  ICCP: { kind: 'icc', label: 'ICC colour profile' }
}

export interface WebpScrub {
  bytes: Uint8Array
  removed: RemovedBlock[]
  trailingBytes: number
  trailingLabel: string | null
}

export function sanitizeWebp(bytes: Uint8Array): WebpScrub | null {
  if (bytes.length < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') return null

  const chunks: Uint8Array[] = []
  const removed = new Map<string, RemovedBlock>()
  let i = 12
  let vp8xIndex = -1
  let vp8x: Uint8Array | null = null

  const drop = (kind: string, label: string, size: number) => {
    const prev = removed.get(kind)
    if (prev) prev.bytes += size
    else removed.set(kind, { kind, label, bytes: size })
  }

  const riffEnd = Math.min(bytes.length, 8 + u32(bytes, 4, true))

  while (i + 8 <= riffEnd) {
    const type = fourcc(bytes, i)
    const size = u32(bytes, i + 4, true)
    if (i + 8 + size > bytes.length) break

    const rule = DROP[type]
    if (rule) {
      drop(rule.kind, rule.label, 8 + size)
    } else {
      if (type === 'VP8X') {
        vp8x = bytes.slice(i, i + 8 + size)
        vp8xIndex = chunks.length
      }
      chunks.push(bytes.subarray(i, i + 8 + size))
    }
    i += 8 + pad(size)
  }

  // VP8X advertises EXIF/XMP presence; clear those flags now that they are gone.
  if (vp8x && vp8xIndex >= 0 && vp8x.length > 8) {
    const flags = vp8x[8]!
    const cleared = flags & ~0x08 & ~0x04
    if (cleared !== flags) {
      vp8x[8] = cleared
      drop('colour', 'colour space markers', 0)
    }
    chunks[vp8xIndex] = vp8x
  }

  let trailingBytes = 0
  let trailingLabel: string | null = null
  const tail = bytes.subarray(riffEnd)
  if (tail.length > 0) {
    trailingBytes = tail.length
    trailingLabel = identifyPayload(tail)
    drop('trailing', `appended ${trailingLabel}`, tail.length)
  }

  const body = concat(chunks)
  const out = new Uint8Array(12 + body.length)
  out[0] = 0x52; out[1] = 0x49; out[2] = 0x46; out[3] = 0x46
  const riffSize = 4 + body.length
  out[4] = riffSize & 0xff
  out[5] = (riffSize >> 8) & 0xff
  out[6] = (riffSize >> 16) & 0xff
  out[7] = (riffSize >> 24) & 0xff
  out[8] = 0x57; out[9] = 0x45; out[10] = 0x42; out[11] = 0x50
  out.set(body, 12)

  return {
    bytes: out,
    removed: [...removed.values()],
    trailingBytes,
    trailingLabel
  }
}

export function webpMetadata(bytes: Uint8Array): TelemetryHit[] {
  const hits: TelemetryHit[] = []
  if (bytes.length < 12) return hits
  let i = 12
  const riffEnd = Math.min(bytes.length, 8 + u32(bytes, 4, true))
  while (i + 8 <= riffEnd) {
    const type = fourcc(bytes, i)
    const size = u32(bytes, i + 4, true)
    if (type === 'EXIF') hits.push({ key: 'EXIF', value: 'RIFF EXIF chunk' })
    if (type === 'XMP ') hits.push({ key: 'XMP', value: 'RIFF XMP chunk' })
    if (type === 'ICCP') hits.push({ key: 'ICCP', value: 'ICC colour profile' })
    i += 8 + pad(size)
  }
  return hits
}

/** Returns the EXIF chunk payload so the TIFF parser can read WebP telemetry. */
export function webpExif(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 12) return null
  let i = 12
  const riffEnd = Math.min(bytes.length, 8 + u32(bytes, 4, true))
  while (i + 8 <= riffEnd) {
    const type = fourcc(bytes, i)
    const size = u32(bytes, i + 4, true)
    if (i + 8 + size > bytes.length) break
    if (type === 'EXIF') return bytes.subarray(i + 8, i + 8 + size)
    i += 8 + pad(size)
  }
  return null
}

export function webpTrailing(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 12) return null
  const riffEnd = 8 + u32(bytes, 4, true)
  if (riffEnd >= bytes.length) return null
  const tail = bytes.subarray(riffEnd)
  return tail.length ? tail : null
}
