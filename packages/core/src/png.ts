import { concat, fourcc, u32, identifyPayload } from './util.js'
import type { RemovedBlock, TelemetryHit } from './types.js'

/** Ancillary chunks that carry text, timestamps, or colour identity. */
const DROP: Record<string, { kind: string; label: string }> = {
  tEXt: { kind: 'text', label: 'PNG text chunks' },
  zTXt: { kind: 'text', label: 'PNG text chunks' },
  iTXt: { kind: 'xmp', label: 'XMP records' },
  eXIf: { kind: 'exif', label: 'EXIF block' },
  tIME: { kind: 'time', label: 'modification timestamp' },
  iCCP: { kind: 'icc', label: 'ICC colour profile' },
  sRGB: { kind: 'colour', label: 'colour space markers' },
  gAMA: { kind: 'colour', label: 'colour space markers' },
  cHRM: { kind: 'colour', label: 'colour space markers' },
  dSIG: { kind: 'signature', label: 'digital signature' }
}

export interface PngScrub {
  bytes: Uint8Array
  removed: RemovedBlock[]
  trailingBytes: number
  trailingLabel: string | null
}

export function sanitizePng(bytes: Uint8Array): PngScrub | null {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null

  const parts: Uint8Array[] = [bytes.subarray(0, 8)]
  const removed = new Map<string, RemovedBlock>()
  let i = 8
  let trailingBytes = 0
  let trailingLabel: string | null = null

  const drop = (kind: string, label: string, size: number) => {
    const prev = removed.get(kind)
    if (prev) prev.bytes += size
    else removed.set(kind, { kind, label, bytes: size })
  }

  while (i + 12 <= bytes.length) {
    const len = u32(bytes, i)
    const type = fourcc(bytes, i + 4)
    const total = 12 + len
    if (i + total > bytes.length) break

    const rule = DROP[type]
    if (rule) drop(rule.kind, rule.label, total)
    else parts.push(bytes.subarray(i, i + total))

    i += total

    if (type === 'IEND') {
      const tail = bytes.subarray(i)
      if (tail.length > 0) {
        trailingBytes = tail.length
        trailingLabel = identifyPayload(tail)
        drop('trailing', `appended ${trailingLabel}`, tail.length)
      }
      break
    }
  }

  return {
    bytes: concat(parts),
    removed: [...removed.values()],
    trailingBytes,
    trailingLabel
  }
}

export function pngMetadata(bytes: Uint8Array): TelemetryHit[] {
  const hits: TelemetryHit[] = []
  if (bytes.length < 8) return hits
  let i = 8

  while (i + 12 <= bytes.length) {
    const len = u32(bytes, i)
    const type = fourcc(bytes, i + 4)
    if (i + 12 + len > bytes.length) break

    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const raw = bytes.subarray(i + 8, i + 8 + len)
      let key = ''
      let p = 0
      while (p < raw.length && raw[p] !== 0 && p < 80) {
        key += String.fromCharCode(raw[p]!)
        p++
      }
      const value = type === 'tEXt' ? readAscii(raw, p + 1) : `${type} record`
      hits.push({ key: key || type, value: value || `${type} record` })
    }
    if (type === 'eXIf') hits.push({ key: 'eXIf', value: 'embedded EXIF chunk' })
    if (type === 'tIME') hits.push({ key: 'tIME', value: 'modification timestamp' })
    if (type === 'iCCP') hits.push({ key: 'iCCP', value: 'ICC colour profile' })

    i += 12 + len
    if (type === 'IEND') break
  }
  return hits
}

export function pngTrailing(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 8) return null
  let i = 8
  while (i + 12 <= bytes.length) {
    const len = u32(bytes, i)
    const type = fourcc(bytes, i + 4)
    if (i + 12 + len > bytes.length) break
    i += 12 + len
    if (type === 'IEND') {
      const tail = bytes.subarray(i)
      return tail.length ? tail : null
    }
  }
  return null
}

function readAscii(bytes: Uint8Array, from: number): string {
  let s = ''
  for (let p = from; p < bytes.length && p < from + 80; p++) {
    const c = bytes[p]!
    if (c === 0) break
    if (c >= 32 && c < 127) s += String.fromCharCode(c)
  }
  return s
}
