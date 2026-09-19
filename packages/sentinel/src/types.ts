export type PiiKind =
  | 'payment-card'
  | 'ssn'
  | 'passport-mrz'
  | 'drivers-licence'
  | 'address'
  | 'phone'
  | 'email'
  | 'date-of-birth'

export type DocumentKind = 'drivers-licence' | 'passport' | 'payment-card' | 'id-card'

export type SentinelLevel = 'Low' | 'Caution' | 'Critical'

export interface PiiFinding {
  kind: PiiKind
  /** Redacted sample, never the raw value. */
  preview: string
  /** 0 to 1. Validator-backed hits (Luhn, MRZ checksum) score highest. */
  confidence: number
  /** Which rule fired, e.g. "Luhn checksum" or "TD3 MRZ check digits". */
  evidence: string
}

export interface DocumentFinding {
  kind: DocumentKind
  confidence: number
  evidence: string[]
}

export interface FaceBox {
  x: number
  y: number
  width: number
  height: number
}

export interface SentinelReport {
  level: SentinelLevel
  /** False when no OCR adapter was supplied; layout and faces still run. */
  ocrAvailable: boolean
  documents: DocumentFinding[]
  pii: PiiFinding[]
  faces: FaceBox[]
  /** True when the platform exposed no face detector. */
  faceDetectionUnavailable: boolean
  durationMs: number
}

export interface OcrAdapter {
  /** Returns the plain text found in the image. */
  recognize(source: Blob | ImageBitmap): Promise<string>
}

export interface FaceAdapter {
  detect(source: Blob | ImageBitmap): Promise<FaceBox[]>
}

export interface SentinelOptions {
  ocr?: OcrAdapter
  faces?: FaceAdapter
  /** Image dimensions, used for document layout inference. */
  dimensions?: { width: number; height: number }
}
