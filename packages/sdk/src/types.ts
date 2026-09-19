import type { InspectResult, SanitizeResult, RiskLevel } from '@filestrip/core'
import type { VisionReport } from '@filestrip/vision'
import type { SentinelReport, OcrAdapter, FaceAdapter } from '@filestrip/sentinel'

export interface StripConfig {
  /** URL of the bundled vision Worker. Without it, vision runs on the main thread. */
  visionWorkerUrl?: string | URL
  /** ONNX classifier URL. Weights are never bundled with these packages. */
  modelUrl?: string
  /** Explicit confidence at or above which the preview should be blurred. */
  blurThreshold?: number
  /** WASM OCR backend. Sentinel skips text scanning when absent. */
  ocr?: OcrAdapter
  /** Custom face detector. Falls back to the platform Shape Detection API. */
  faces?: FaceAdapter
  /** Skip the vision stage entirely. */
  skipVision?: boolean
  /** Skip the sentinel stage entirely. */
  skipSentinel?: boolean
}

export interface PurgeOutcome extends SanitizeResult {
  blob: Blob
  name: string
  reencoded: boolean
  originalBytes: number
  /** Ready-to-render sentence, e.g. "Scrubbed 18 EXIF tags, GPS telemetry, and randomized filename". */
  headline: string
}

/** Rolls telemetry, content, and PII risk into one index for the UI. */
export type ExposureLevel = RiskLevel

export interface InspectOutcome {
  telemetry: InspectResult
  vision: VisionReport | null
  sentinel: SentinelReport | null
  /** Highest risk across all three stages. */
  level: ExposureLevel
  /** True when the preview should start blurred. */
  shouldBlur: boolean
  width: number
  height: number
  durationMs: number
}

export type { InspectResult, SanitizeResult, VisionReport, SentinelReport }
