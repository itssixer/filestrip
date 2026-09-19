import { analyze } from './analyze.js'
import { onnxAdapter } from './model.js'
import type { ClassifierAdapter } from './types.js'
import type { WorkerRequest, WorkerResponse } from './protocol.js'

/**
 * Dedicated Worker entry point. Classification and hashing both run here so the
 * main thread never blocks on DCT or model inference.
 *
 * Build this file as its own bundle and hand the URL to `VisionEngine`.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse): void
}

const scope = self as unknown as WorkerScope

let adapter: ClassifierAdapter | null = null
let adapterKey = ''

/** Models are cached across messages; loading WASM per image would be wasteful. */
async function resolveAdapter(modelUrl?: string, inputSize?: number): Promise<ClassifierAdapter | null> {
  if (!modelUrl) return null
  const key = `${modelUrl}@${inputSize ?? 224}`
  if (adapter && adapterKey === key) return adapter

  try {
    adapter = await onnxAdapter(modelUrl, inputSize ?? 224)
    adapterKey = key
    return adapter
  } catch {
    adapter = null
    adapterKey = ''
    return null
  }
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (!message || message.type !== 'analyze') return

  try {
    const engine = await resolveAdapter(message.modelUrl, message.inputSize)
    const report = await analyze(message.bitmap, engine)
    scope.postMessage({ id: message.id, ok: true, report })
  } catch (err) {
    scope.postMessage({
      id: message.id,
      ok: false,
      error: err instanceof Error ? err.message : 'vision stage failed'
    })
  }
}
