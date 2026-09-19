export const STRIP_ENGINE_VERSION = '1.0.0'

export { sanitize, isSupported } from './sanitize.js'
export { inspect } from './inspect.js'
export { randomName } from './name.js'
export { sniff, mimeFor, extFor, identifyPayload, crc32 } from './util.js'
export { parseExif, tagText } from './exif.js'
export type { ExifData } from './exif.js'
export type {
  Format,
  RiskLevel,
  Threat,
  RemovedBlock,
  SanitizeResult,
  InspectResult,
  TelemetryHit,
  TelemetryVector,
  GpsFix
} from './types.js'
