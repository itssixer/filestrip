export type Format = 'jpeg' | 'png' | 'webp' | 'gif' | 'unknown'

export type RiskLevel = 'Low' | 'Caution' | 'Critical'

export type Threat = 'Critical' | 'High' | 'Medium'

/** A single metadata block the purge removed, used to build the scrub summary. */
export interface RemovedBlock {
  /** Machine-readable kind, e.g. `exif`, `xmp`, `trailing`. */
  kind: string
  /** Human label shown in the UI, e.g. "GPS telemetry". */
  label: string
  /** Bytes reclaimed by dropping this block. */
  bytes: number
}

export interface SanitizeResult {
  bytes: Uint8Array
  type: string
  format: Format
  /** True when any block was dropped. */
  changed: boolean
  removed: RemovedBlock[]
  /** Number of EXIF/TIFF tags present before the purge. */
  exifTags: number
  /** Bytes found appended after the image terminator (polyglots, archives). */
  trailingBytes: number
  /** Sentence fragments describing the purge, ready to join into a summary. */
  summary: string[]
}

export interface TelemetryHit {
  key: string
  value: string
}

export interface TelemetryVector {
  id: string
  title: string
  threat: Threat
  hits: TelemetryHit[]
}

export interface GpsFix {
  lat: number
  lon: number
  altitude?: number
}

export interface InspectResult {
  format: Format
  level: RiskLevel
  gps: GpsFix | null
  /** Embedded IFD1 preview that may show uncropped content. */
  ghostThumbnail: { width: number; height: number; bytes: number } | null
  exifTags: number
  trailingBytes: number
  vectors: TelemetryVector[]
}
