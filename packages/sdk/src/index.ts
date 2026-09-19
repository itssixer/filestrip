import { purgeFile } from '@filestrip/core/browser'
import { inspect } from '@filestrip/core'
import { VisionEngine } from '@filestrip/vision'
import { scan } from '@filestrip/sentinel'
import { headline } from './summary.js'
import type { ExposureLevel, InspectOutcome, PurgeOutcome, StripConfig } from './types.js'

const RANK: Record<ExposureLevel, number> = { Low: 0, Caution: 1, Critical: 2 }

function worst(...levels: ExposureLevel[]): ExposureLevel {
  return levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'Low')
}

/**
 * Unified STRIP Engine client. Owns the vision Worker so repeated calls reuse
 * one thread and one loaded model.
 */
export class Strip {
  private readonly config: StripConfig
  private vision: VisionEngine | null = null

  constructor(config: StripConfig = {}) {
    this.config = config
  }

  private visionEngine(): VisionEngine {
    if (!this.vision) {
      this.vision = new VisionEngine({
        workerUrl: this.config.visionWorkerUrl,
        modelUrl: this.config.modelUrl,
        inline: !this.config.visionWorkerUrl
      })
    }
    return this.vision
  }

  /** Stage 1 only: binary purge plus a random filename. Fast enough to run on drop. */
  async sanitize(file: Blob): Promise<PurgeOutcome> {
    const result = await purgeFile(file)
    return { ...result, headline: headline(result.summary) }
  }

  /**
   * Full analysis. Telemetry is synchronous, so vision and sentinel run
   * concurrently and a failure in either degrades rather than rejects.
   */
  async inspect(file: Blob): Promise<InspectOutcome> {
    const started = Date.now()
    const buffer = new Uint8Array(await file.arrayBuffer())
    const telemetry = inspect(buffer)

    let width = 0
    let height = 0
    let bitmap: ImageBitmap | null = null
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(file)
        width = bitmap.width
        height = bitmap.height
      } catch {
        bitmap = null
      }
    }

    const visionTask = this.config.skipVision
      ? Promise.resolve(null)
      : this.visionEngine().analyze(file).catch(() => null)

    const sentinelTask = this.config.skipSentinel
      ? Promise.resolve(null)
      : scan(bitmap ?? file, {
          ocr: this.config.ocr,
          faces: this.config.faces,
          dimensions: width && height ? { width, height } : undefined
        }).catch(() => null)

    const [vision, sentinel] = await Promise.all([visionTask, sentinelTask])
    bitmap?.close?.()

    // Auto-blur requires a real classifier. The colour heuristic false-positives
    // on warm-toned photos, and blurring a sunset would be worse than useless.
    const threshold = this.config.blurThreshold ?? 0.6
    const shouldBlur = Boolean(vision?.modelAvailable && vision.explicitConfidence >= threshold)

    return {
      telemetry,
      vision,
      sentinel,
      level: worst(telemetry.level, sentinel?.level ?? 'Low'),
      shouldBlur,
      width: width || vision?.width || 0,
      height: height || vision?.height || 0,
      durationMs: Date.now() - started
    }
  }

  /** Inspect, then purge, in one call. Used by the remediation button. */
  async inspectAndPurge(file: Blob): Promise<{ report: InspectOutcome; purged: PurgeOutcome }> {
    const report = await this.inspect(file)
    const purged = await this.sanitize(file)
    return { report, purged }
  }

  dispose(): void {
    this.vision?.terminate()
    this.vision = null
  }
}

export function createStrip(config: StripConfig = {}): Strip {
  return new Strip(config)
}

export { headline }
export { STRIP_ENGINE_VERSION, sanitize, inspect, randomName } from '@filestrip/core'
export { purgeFile } from '@filestrip/core/browser'
export { dhash, phash, hamming, similarity } from '@filestrip/vision'
export { scanText, scanDocuments, luhn, validSsn, parseTd3, tesseractAdapter, nativeFaceAdapter } from '@filestrip/sentinel'
export type {
  StripConfig,
  PurgeOutcome,
  InspectOutcome,
  ExposureLevel,
  InspectResult,
  SanitizeResult,
  VisionReport,
  SentinelReport
} from './types.js'
