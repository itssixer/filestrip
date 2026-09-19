import type { VisionReport } from './types.js'

export interface AnalyzeRequest {
  id: number
  type: 'analyze'
  bitmap: ImageBitmap
  /** ONNX model URL to load inside the Worker, if the host configured one. */
  modelUrl?: string
  inputSize?: number
}

export type WorkerRequest = AnalyzeRequest

export type WorkerResponse =
  | { id: number; ok: true; report: VisionReport }
  | { id: number; ok: false; error: string }
