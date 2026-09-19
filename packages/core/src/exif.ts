import { ascii, u16, u32 } from './util.js'
import type { GpsFix } from './types.js'

const T_BYTE = 1
const T_ASCII = 2
const T_SHORT = 3
const T_LONG = 4
const T_RATIONAL = 5
const T_UNDEFINED = 7
const T_SLONG = 9
const T_SRATIONAL = 10

const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825

const TAGS: Record<number, string> = {
  0x010f: 'Make',
  0x0110: 'Model',
  0x0131: 'Software',
  0x0132: 'DateTime',
  0x013b: 'Artist',
  0x8298: 'Copyright',
  0x9003: 'DateTimeOriginal',
  0x9004: 'DateTimeDigitized',
  0x9010: 'OffsetTime',
  0x9011: 'OffsetTimeOriginal',
  0x9012: 'OffsetTimeDigitized',
  0xa420: 'ImageUniqueID',
  0xa430: 'CameraOwnerName',
  0xa431: 'BodySerialNumber',
  0xa433: 'LensMake',
  0xa434: 'LensModel',
  0xa435: 'LensSerialNumber',
  0xc62f: 'CameraSerialNumber',
  0x0201: 'JPEGInterchangeFormat',
  0x0202: 'JPEGInterchangeFormatLength',
  0x0100: 'ImageWidth',
  0x0101: 'ImageLength'
}

const GPS_TAGS: Record<number, string> = {
  0x0001: 'GPSLatitudeRef',
  0x0002: 'GPSLatitude',
  0x0003: 'GPSLongitudeRef',
  0x0004: 'GPSLongitude',
  0x0005: 'GPSAltitudeRef',
  0x0006: 'GPSAltitude',
  0x0007: 'GPSTimeStamp',
  0x0012: 'GPSMapDatum',
  0x001d: 'GPSDateStamp'
}

type TagValue = string | number | number[]

function typeSize(type: number): number {
  if (type === T_BYTE || type === T_ASCII || type === T_UNDEFINED) return 1
  if (type === T_SHORT) return 2
  if (type === T_LONG || type === T_SLONG) return 4
  if (type === T_RATIONAL || type === T_SRATIONAL) return 8
  return 1
}

interface Ifd {
  entries: Record<string, TagValue>
  pointers: { exif?: number; gps?: number }
  count: number
  next: number
}

function readIfd(tiff: Uint8Array, offset: number, le: boolean, names: Record<number, string>): Ifd {
  const entries: Record<string, TagValue> = {}
  const pointers: { exif?: number; gps?: number } = {}
  if (offset < 0 || offset + 2 > tiff.length) {
    return { entries, pointers, count: 0, next: 0 }
  }

  const n = u16(tiff, offset, le)
  let p = offset + 2
  let count = 0

  for (let i = 0; i < n; i++) {
    if (p + 12 > tiff.length) break
    const tag = u16(tiff, p, le)
    const type = u16(tiff, p + 2, le)
    const items = u32(tiff, p + 4, le)
    count++

    if (tag === TAG_EXIF_IFD) pointers.exif = u32(tiff, p + 8, le)
    else if (tag === TAG_GPS_IFD) pointers.gps = u32(tiff, p + 8, le)

    const name = names[tag]
    if (name) {
      const value = decode(tiff, p, type, items, le)
      if (value !== null) entries[name] = value
    }
    p += 12
  }

  const next = p + 4 <= tiff.length ? u32(tiff, p, le) : 0
  return { entries, pointers, count, next }
}

function decode(tiff: Uint8Array, entryPos: number, type: number, items: number, le: boolean): TagValue | null {
  const size = typeSize(type) * items
  const dataOff = size <= 4 ? entryPos + 8 : u32(tiff, entryPos + 8, le)
  if (dataOff < 0 || dataOff + size > tiff.length) return null

  if (type === T_ASCII) {
    const s = ascii(tiff, dataOff, items)
    return s || null
  }
  if (type === T_RATIONAL || type === T_SRATIONAL) {
    if (items === 3) {
      return [rational(tiff, dataOff, le), rational(tiff, dataOff + 8, le), rational(tiff, dataOff + 16, le)]
    }
    return rational(tiff, dataOff, le)
  }
  if (type === T_SHORT && items === 1) return u16(tiff, dataOff, le)
  if (type === T_LONG && items === 1) return u32(tiff, dataOff, le)
  if (type === T_BYTE && items === 1) return tiff[dataOff]!
  if (type === T_UNDEFINED && items > 0 && items < 64) {
    const s = ascii(tiff, dataOff, items)
    return s || null
  }
  return null
}

function rational(tiff: Uint8Array, i: number, le: boolean): number {
  const n = u32(tiff, i, le)
  const d = u32(tiff, i + 4, le)
  if (!d) return 0
  return n / d
}

/** Converts a degrees/minutes/seconds triple plus hemisphere into a signed decimal. */
function toDecimal(value: TagValue | undefined, ref: TagValue | undefined): number | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const [d, m, s] = value as [number, number, number]
  if (![d, m, s].every((n) => Number.isFinite(n))) return null
  let deg = d + m / 60 + s / 3600
  const hemisphere = typeof ref === 'string' ? ref.trim().toUpperCase() : ''
  if (hemisphere === 'S' || hemisphere === 'W') deg = -deg
  return Number.isFinite(deg) ? deg : null
}

export interface ExifData {
  tags: Record<string, TagValue>
  gpsTags: Record<string, TagValue>
  gps: GpsFix | null
  /** IFD1 preview that can leak pre-crop content. */
  thumbnail: { width: number; height: number; bytes: number } | null
  tagCount: number
}

export function parseExif(tiff: Uint8Array): ExifData | null {
  if (!tiff || tiff.length < 8) return null

  const le = tiff[0] === 0x49 && tiff[1] === 0x49
  const be = tiff[0] === 0x4d && tiff[1] === 0x4d
  if (!le && !be) return null

  const ifd0Offset = u32(tiff, 4, le)
  const ifd0 = readIfd(tiff, ifd0Offset, le, TAGS)

  const tags: Record<string, TagValue> = { ...ifd0.entries }
  let tagCount = ifd0.count

  if (ifd0.pointers.exif !== undefined) {
    const sub = readIfd(tiff, ifd0.pointers.exif, le, TAGS)
    Object.assign(tags, sub.entries)
    tagCount += sub.count
  }

  let gpsTags: Record<string, TagValue> = {}
  let gps: GpsFix | null = null
  if (ifd0.pointers.gps !== undefined) {
    const sub = readIfd(tiff, ifd0.pointers.gps, le, GPS_TAGS)
    gpsTags = sub.entries
    tagCount += sub.count

    const lat = toDecimal(gpsTags['GPSLatitude'], gpsTags['GPSLatitudeRef'])
    const lon = toDecimal(gpsTags['GPSLongitude'], gpsTags['GPSLongitudeRef'])
    if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      gps = { lat, lon }
      const alt = gpsTags['GPSAltitude']
      if (typeof alt === 'number' && Number.isFinite(alt)) gps.altitude = alt
    }
  }

  let thumbnail: ExifData['thumbnail'] = null
  if (ifd0.next) {
    const ifd1 = readIfd(tiff, ifd0.next, le, TAGS)
    tagCount += ifd1.count
    const length = ifd1.entries['JPEGInterchangeFormatLength']
    if (typeof length === 'number' && length > 0) {
      thumbnail = {
        width: typeof ifd1.entries['ImageWidth'] === 'number' ? (ifd1.entries['ImageWidth'] as number) : 0,
        height: typeof ifd1.entries['ImageLength'] === 'number' ? (ifd1.entries['ImageLength'] as number) : 0,
        bytes: length
      }
    }
  }

  return { tags, gpsTags, gps, thumbnail, tagCount }
}

export function tagText(value: TagValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(4)
  if (Array.isArray(value)) return value.map((n) => (Number.isInteger(n) ? n : Number(n.toFixed(4)))).join(', ')
  return ''
}
