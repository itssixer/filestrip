import type { ClassifierAdapter, ClassScore, VisionClass } from './types.js'

const LABELS: VisionClass[] = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy']

function softmax(values: number[]): number[] {
  const max = Math.max(...values)
  const exps = values.map((v) => Math.exp(v - max))
  const sum = exps.reduce((a, b) => a + b, 0) || 1
  return exps.map((v) => v / sum)
}

function toScores(raw: ArrayLike<number>, labels: VisionClass[] = LABELS): ClassScore[] {
  const values = Array.from(raw, Number)
  const total = values.reduce((a, b) => a + b, 0)
  // Already a probability distribution if it sums to ~1, otherwise treat as logits.
  const probs = Math.abs(total - 1) < 0.05 ? values : softmax(values)
  return labels
    .map((label, i) => ({ label, score: probs[i] ?? 0 }))
    .sort((a, b) => b.score - a.score)
}

/**
 * Loads an ONNX classifier with `onnxruntime-web`, which must be installed by
 * the host application. Model weights are never bundled with this package.
 */
export async function onnxAdapter(modelUrl: string, inputSize = 224): Promise<ClassifierAdapter> {
  // Indirect specifier: onnxruntime-web is an optional peer dependency, so it
  // must not become a hard build-time requirement of this package.
  const specifier = 'onnxruntime-web'
  const ort = (await import(specifier)) as unknown as {
    InferenceSession: {
      create(path: string, options?: unknown): Promise<{
        inputNames: string[]
        outputNames: string[]
        run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>
      }>
    }
    Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown
  }

  const session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  })

  return {
    backend: 'onnx',
    inputSize,
    async run(pixels, size) {
      const input = new ort.Tensor('float32', pixels, [1, size, size, 3])
      const feeds: Record<string, unknown> = { [session.inputNames[0]!]: input }
      const output = await session.run(feeds)
      const first = output[session.outputNames[0]!]
      return toScores(first?.data ?? [])
    }
  }
}

/**
 * Loads a TensorFlow.js graph model. Accepts an already-imported `tf` namespace
 * so the host controls which backend (WASM, WebGL, WebGPU) is registered.
 */
export async function tfjsAdapter(
  tf: {
    loadGraphModel(url: string): Promise<{ predict(input: unknown): { data(): Promise<Float32Array>; dispose(): void } }>
    tensor(data: Float32Array, shape: number[]): { dispose(): void }
  },
  modelUrl: string,
  inputSize = 224
): Promise<ClassifierAdapter> {
  const model = await tf.loadGraphModel(modelUrl)

  return {
    backend: 'tfjs',
    inputSize,
    async run(pixels, size) {
      const input = tf.tensor(pixels, [1, size, size, 3])
      const output = model.predict(input)
      const data = await output.data()
      output.dispose()
      input.dispose()
      return toScores(data)
    }
  }
}

/**
 * Statistical fallback used when no model is configured. It measures skin-tone
 * coverage, saturation, and centre-weighted contrast.
 *
 * This is deliberately conservative: it is a colour statistic, not a classifier,
 * so it never reports `Porn` or `Hentai` and its confidence is capped. Treat it
 * as a hint that a file deserves review, never as moderation ground truth.
 */
export function heuristicAdapter(): ClassifierAdapter {
  return {
    backend: 'heuristic',
    inputSize: 64,
    async run(pixels, size) {
      let skin = 0
      let saturated = 0
      let total = 0

      for (let i = 0; i < size * size; i++) {
        const r = pixels[i * 3]! * 255
        const g = pixels[i * 3 + 1]! * 255
        const b = pixels[i * 3 + 2]! * 255
        total++

        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const delta = max - min

        // Widely cited RGB skin-tone bounds (Kovac et al.).
        const isSkin =
          r > 95 && g > 40 && b > 20 &&
          delta > 15 &&
          Math.abs(r - g) > 15 &&
          r > g && r > b
        if (isSkin) skin++
        if (max > 0 && delta / max > 0.45) saturated++
      }

      const skinRatio = total ? skin / total : 0
      const saturationRatio = total ? saturated / total : 0

      // Large skin coverage with low scene variety is the only signal here.
      // The floor is deliberately high: warm gradients and sunsets sit around
      // 0.3-0.4 skin ratio, and flagging those would make the signal useless.
      const raw = Math.max(0, skinRatio - 0.55) / 0.35
      const suggestive = Math.min(0.5, raw * (1 - saturationRatio * 0.4))
      const neutral = 1 - suggestive

      return [
        { label: 'Neutral', score: neutral },
        { label: 'Sexy', score: suggestive },
        { label: 'Drawing', score: 0 },
        { label: 'Porn', score: 0 },
        { label: 'Hentai', score: 0 }
      ].sort((a, b) => b.score - a.score) as ClassScore[]
    }
  }
}
