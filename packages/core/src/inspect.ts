import { sniff, identifyPayload } from './util.js'
import { findApp1Exif, jpegTrailing } from './jpeg.js'
import { pngMetadata, pngTrailing } from './png.js'
import { webpExif, webpMetadata, webpTrailing } from './webp.js'
import { parseExif, tagText } from './exif.js'
import type { InspectResult, RiskLevel, TelemetryHit, TelemetryVector } from './types.js'

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input)
}

function collect(tags: Record<string, unknown>, names: string[]): TelemetryHit[] {
  const hits: TelemetryHit[] = []
  for (const name of names) {
    const value = tagText(tags[name] as never)
    if (value) hits.push({ key: name, value })
  }
  return hits
}

function score(vectors: TelemetryVector[]): RiskLevel {
  const has = (id: string) => vectors.find((v) => v.id === id)?.hits.length ?? 0
  if (has('gps') > 0 || has('payload') > 0) return 'Critical'
  if (has('serial') > 0 || has('ghost') > 0) return 'Caution'
  if (has('time') > 0 || has('device') > 0) return 'Caution'
  return 'Low'
}

/**
 * Read-only telemetry sweep. Reports what a file is broadcasting without
 * modifying it, so the UI can show exposure before the user commits to a purge.
 */
export function inspect(input: Uint8Array | ArrayBuffer): InspectResult {
  const bytes = toBytes(input)
  const format = sniff(bytes)

  let tiff: Uint8Array | null = null
  let containerHits: TelemetryHit[] = []
  let trailing: Uint8Array | null = null

  if (format === 'jpeg') {
    tiff = findApp1Exif(bytes)
    trailing = jpegTrailing(bytes)
  } else if (format === 'png') {
    containerHits = pngMetadata(bytes)
    trailing = pngTrailing(bytes)
  } else if (format === 'webp') {
    tiff = webpExif(bytes)
    containerHits = webpMetadata(bytes)
    trailing = webpTrailing(bytes)
  }

  const exif = tiff ? parseExif(tiff) : null
  const tags = exif?.tags ?? {}
  const gpsTags = exif?.gpsTags ?? {}

  const gpsHits: TelemetryHit[] = []
  if (exif?.gps) {
    gpsHits.push({ key: 'Latitude', value: exif.gps.lat.toFixed(6) })
    gpsHits.push({ key: 'Longitude', value: exif.gps.lon.toFixed(6) })
    if (exif.gps.altitude !== undefined) {
      gpsHits.push({ key: 'Altitude', value: `${exif.gps.altitude.toFixed(1)} m` })
    }
  }
  gpsHits.push(...collect(gpsTags, ['GPSDateStamp', 'GPSTimeStamp', 'GPSMapDatum']))

  const serialHits = collect(tags, [
    'BodySerialNumber',
    'LensSerialNumber',
    'CameraSerialNumber',
    'ImageUniqueID',
    'CameraOwnerName'
  ])

  const timeHits = collect(tags, [
    'DateTimeOriginal',
    'DateTime',
    'DateTimeDigitized',
    'OffsetTime',
    'OffsetTimeOriginal',
    'OffsetTimeDigitized'
  ])

  const deviceHits = [
    ...collect(tags, ['Make', 'Model', 'LensMake', 'LensModel', 'Software', 'Artist', 'Copyright']),
    ...containerHits
  ]

  const ghostHits: TelemetryHit[] = []
  if (exif?.thumbnail) {
    const { width, height, bytes: size } = exif.thumbnail
    ghostHits.push({
      key: 'IFD1 preview',
      value: width && height ? `${width} × ${height} (${size.toLocaleString()} bytes)` : `${size.toLocaleString()} bytes`
    })
  }

  const payloadHits: TelemetryHit[] = []
  if (trailing && trailing.length > 0) {
    payloadHits.push({
      key: identifyPayload(trailing),
      value: `${trailing.length.toLocaleString()} bytes after terminator`
    })
  }

  const vectors: TelemetryVector[] = [
    { id: 'gps', title: 'GPS telemetry', threat: 'Critical', hits: gpsHits },
    { id: 'payload', title: 'Appended EOF payload', threat: 'Critical', hits: payloadHits },
    { id: 'serial', title: 'Device and lens serials', threat: 'High', hits: serialHits },
    { id: 'ghost', title: 'Ghost thumbnail (IFD1)', threat: 'High', hits: ghostHits },
    { id: 'time', title: 'Timestamps and UTC offsets', threat: 'Medium', hits: timeHits },
    { id: 'device', title: 'Device and software trail', threat: 'Medium', hits: deviceHits }
  ]

  return {
    format,
    level: score(vectors),
    gps: exif?.gps ?? null,
    ghostThumbnail: exif?.thumbnail ?? null,
    exifTags: exif?.tagCount ?? 0,
    trailingBytes: trailing?.length ?? 0,
    vectors
  }
}
