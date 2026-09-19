import { analyze } from './analyze.js'
import { heuristicAdapter, onnxAdapter, tfjsAdapter } from './model.js'
import type { ClassifierAdapter, VisionReport } from './types.js'
import type { WorkerResponse } from './protocol.js'

export interface EngineOptions {
  /**
   * URL of the bundled Worker script. Supply this to keep analysis off the main
   * thread; without it the engine runs inline.
   */
  workerUrl?: string | URL
  /** ONNX model URL loaded inside the Worker. Weights are never bundled here. */
  modelUrl?: string
  inputSize?: number
  /** Force main-thread execution. */
  inline?: boolean
}

/**
 * Vision stage front-end. Owns the Worker lifecycle and falls back to
 * main-thread analysis when Workers or OffscreenCanvas are unavailable.
 */
export class VisionEngine {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, { resolve(r: VisionReport): void; reject(e: Error): void }>()
  private inlineAdapter: ClassifierAdapter | null = null
  private readonly options: EngineOptions

  constructor(options: EngineOptions = {}) {
    this.options = options
  }

  private ensureWorker(): Worker | null {
    if (this.options.inline || !this.options.workerUrl) return null
    if (this.worker) return this.worker
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null

    try {
      const worker = new Worker(this.options.workerUrl, { type: 'module' })
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.ok) entry.resolve(message.report)
        else entry.reject(new Error(message.error))
      }
      worker.onerror = () => {
        for (const entry of this.pending.values()) entry.reject(new Error('vision worker crashed'))
        this.pending.clear()
        this.worker?.terminate()
        this.worker = null
      }
      this.worker = worker
      return worker
    } catch {
      return null
    }
  }

  private async ensureInlineAdapter(): Promise<ClassifierAdapter | null> {
    if (this.inlineAdapter) return this.inlineAdapter
    if (!this.options.modelUrl) return null
    try {
      this.inlineAdapter = await onnxAdapter(this.options.modelUrl, this.options.inputSize ?? 224)
    } catch {
      this.inlineAdapter = null
    }
    return this.inlineAdapter
  }

  async analyze(file: Blob): Promise<VisionReport> {
    const worker = this.ensureWorker()

    if (worker) {
      // ImageBitmap transfers without a copy, so large photos stay cheap.
      const bitmap = await createImageBitmap(file)
      const id = ++this.seq
      return new Promise<VisionReport>((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        worker.postMessage(
          {
            id,
            type: 'analyze',
            bitmap,
            modelUrl: this.options.modelUrl,
            inputSize: this.options.inputSize
          },
          [bitmap]
        )
      }).catch(async (err) => {
        // A failed Worker should not lose the result; retry inline once.
        if (err instanceof Error && err.message === 'vision worker crashed') {
          return analyze(file, await this.ensureInlineAdapter())
        }
        throw err
      })
    }

    return analyze(file, await this.ensureInlineAdapter())
  }

  terminate(): void {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
  }
}

/** One-shot convenience wrapper. Prefer `VisionEngine` for repeated analysis. */
export async function analyzeImage(file: Blob, options: EngineOptions = {}): Promise<VisionReport> {
  const engine = new VisionEngine(options)
  try {
    return await engine.analyze(file)
  } finally {
    engine.terminate()
  }
}

export { analyze, explicitConfidence, rate } from './analyze.js'
export { dhash, phash, hamming, similarity, toGrayscale, resizeGray } from './hash.js'
export { heuristicAdapter, onnxAdapter, tfjsAdapter }
export { decode, toTensor } from './preprocess.js'
export type {
  VisionReport,
  VisionClass,
  SafetyRating,
  ClassScore,
  PerceptualHashes,
  ClassifierAdapter,
  VisionOptions
} from './types.js'
export type { WorkerRequest, WorkerResponse } from './protocol.js'
