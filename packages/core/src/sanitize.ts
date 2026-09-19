import { sniff, mimeFor } from './util.js'
import { sanitizeJpeg, findApp1Exif } from './jpeg.js'
import { sanitizePng } from './png.js'
import { sanitizeWebp, webpExif } from './webp.js'
import { parseExif } from './exif.js'
import type { RemovedBlock, SanitizeResult, Format } from './types.js'

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input)
}

/**
 * Turns the removed-block list into sentence fragments the UI can join, e.g.
 * "Scrubbed 18 EXIF tags, GPS telemetry, lens serial number, and randomized filename".
 */
function buildSummary(
  removed: RemovedBlock[],
  exifTags: number,
  flags: { gps: boolean; serial: boolean; thumbnail: boolean; software: boolean },
  trailing: { bytes: number; label: string | null }
): string[] {
  const lines: string[] = []

  if (exifTags > 0) lines.push(`${exifTags} EXIF tag${exifTags === 1 ? '' : 's'}`)
  if (flags.gps) lines.push('GPS telemetry')
  if (flags.serial) lines.push('camera and lens serial numbers')
  if (flags.thumbnail) lines.push('embedded ghost thumbnail')
  if (flags.software) lines.push('editing software trail')

  const kinds = new Set(removed.map((r) => r.kind))
  if (kinds.has('iptc')) lines.push('IPTC records')
  if (kinds.has('xmp')) lines.push('XMP records')
  if (kinds.has('text')) lines.push('embedded text chunks')
  if (kinds.has('comment')) lines.push('hidden comments')
  if (kinds.has('icc') || kinds.has('colour') || kinds.has('adobe')) lines.push('colour space markers')
  if (kinds.has('time')) lines.push('modification timestamps')
  if (trailing.bytes > 0) {
    lines.push(`${trailing.label ?? 'appended payload'} (${trailing.bytes.toLocaleString()} bytes)`)
  }

  lines.push('randomized filename')
  return lines
}

/**
 * Binary purge. Rebuilds the container from decode-critical blocks only, so
 * nothing needs to be decoded and no canvas is required. Safe in a Worker.
 */
export function sanitize(input: Uint8Array | ArrayBuffer): SanitizeResult {
  const bytes = toBytes(input)
  const format = sniff(bytes)

  let scrub: { bytes: Uint8Array; removed: RemovedBlock[]; trailingBytes: number; trailingLabel: string | null } | null = null
  let tiff: Uint8Array | null = null

  if (format === 'jpeg') {
    scrub = sanitizeJpeg(bytes)
    tiff = findApp1Exif(bytes)
  } else if (format === 'png') {
    scrub = sanitizePng(bytes)
  } else if (format === 'webp') {
    scrub = sanitizeWebp(bytes)
    tiff = webpExif(bytes)
  }

  if (!scrub) {
    return {
      bytes,
      type: mimeFor(format),
      format,
      changed: false,
      removed: [],
      exifTags: 0,
      trailingBytes: 0,
      summary: []
    }
  }

  const exif = tiff ? parseExif(tiff) : null
  const tags = exif?.tags ?? {}
  const flags = {
    gps: Boolean(exif?.gps) || Object.keys(exif?.gpsTags ?? {}).length > 0,
    serial: Boolean(tags['BodySerialNumber'] || tags['LensSerialNumber'] || tags['CameraSerialNumber'] || tags['ImageUniqueID']),
    thumbnail: Boolean(exif?.thumbnail),
    software: Boolean(tags['Software'] || tags['Artist'] || tags['CameraOwnerName'])
  }

  const exifTags = exif?.tagCount ?? 0
  const changed = scrub.removed.length > 0

  return {
    bytes: scrub.bytes,
    type: mimeFor(format),
    format,
    changed,
    removed: scrub.removed,
    exifTags,
    trailingBytes: scrub.trailingBytes,
    summary: changed
      ? buildSummary(scrub.removed, exifTags, flags, { bytes: scrub.trailingBytes, label: scrub.trailingLabel })
      : ['no metadata found', 'randomized filename']
  }
}

/** True when the STRIP Engine can purge this input. */
export function isSupported(input: string | Uint8Array | ArrayBuffer): boolean {
  if (typeof input === 'string') return /^image\/(jpeg|jpg|png|webp)$/i.test(input.trim())
  const format = sniff(toBytes(input))
  return format === 'jpeg' || format === 'png' || format === 'webp'
}

export type { Format }
