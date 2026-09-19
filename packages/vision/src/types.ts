/** NSFWJS-compatible class names so community models drop in unchanged. */
export type VisionClass = 'Porn' | 'Hentai' | 'Sexy' | 'Drawing' | 'Neutral'

export type SafetyRating = 'Clean' | 'Suggestive' | 'Explicit'

export interface ClassScore {
  label: VisionClass
  score: number
}

export interface PerceptualHashes {
  /** 64-bit gradient hash, hex encoded. Robust to scaling and mild compression. */
  dhash: string
  /** 64-bit DCT hash, hex encoded. More robust to gamma and blur than dhash. */
  phash: string
  /** 256-bit DCT hash, hex encoded. PDQ-style, for higher-precision matching. */
  pdq: string
}

export interface VisionReport {
  /** False when no classifier model is configured; hashes are still returned. */
  modelAvailable: boolean
  /** Identifier of the backend that produced the scores. */
  backend: 'onnx' | 'tfjs' | 'heuristic' | 'none'
  rating: SafetyRating
  /** Combined Porn + Hentai + Sexy confidence, 0 to 1. */
  explicitConfidence: number
  scores: ClassScore[]
  hashes: PerceptualHashes
  width: number
  height: number
  /** Wall-clock milliseconds spent in the vision stage. */
  durationMs: number
}

export interface ClassifierAdapter {
  readonly backend: 'onnx' | 'tfjs' | 'heuristic'
  /** Square edge length the model expects, e.g. 224. */
  readonly inputSize: number
  /**
   * Receives planar RGB floats normalised to 0..1 in NHWC order and returns one
   * score per `VisionClass`.
   */
  run(pixels: Float32Array, size: number): Promise<ClassScore[]>
}

export interface VisionOptions {
  /** Explicit confidence above which the UI should blur the preview. */
  blurThreshold?: number
  /** Run on the main thread instead of a Web Worker. */
  inline?: boolean
}
