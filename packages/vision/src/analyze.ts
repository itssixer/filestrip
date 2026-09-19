import { decode, toTensor } from './preprocess.js'
import { dhash, phash } from './hash.js'
import { heuristicAdapter } from './model.js'
import type { ClassifierAdapter, ClassScore, SafetyRating, VisionReport } from './types.js'

const EXPLICIT_LABELS = new Set(['Porn', 'Hentai', 'Sexy'])

/** Sums the explicit classes so one number can drive the blur decision. */
export function explicitConfidence(scores: ClassScore[]): number {
  return scores.reduce((sum, s) => (EXPLICIT_LABELS.has(s.label) ? sum + s.score : sum), 0)
}

export function rate(scores: ClassScore[]): SafetyRating {
  const hard = scores
    .filter((s) => s.label === 'Porn' || s.label === 'Hentai')
    .reduce((a, s) => a + s.score, 0)
  const soft = scores.find((s) => s.label === 'Sexy')?.score ?? 0

  if (hard >= 0.6) return 'Explicit'
  if (hard + soft >= 0.6) return 'Suggestive'
  if (soft >= 0.4) return 'Suggestive'
  return 'Clean'
}

/**
 * Runs the vision stage on an already-decoded source. Hashing always runs;
 * classification depends on whether an adapter was supplied.
 */
export async function analyze(
  source: Blob | ImageBitmap,
  adapter: ClassifierAdapter | null
): Promise<VisionReport> {
  const started = Date.now()
  const image = await decode(source)

  const hashes = {
    dhash: dhash(image.gray, image.width, image.height),
    phash: phash(image.gray, image.width, image.height, 8),
    pdq: phash(image.gray, image.width, image.height, 16)
  }

  const engine = adapter ?? heuristicAdapter()
  let scores: ClassScore[] = []
  let failed = false

  try {
    const tensor = toTensor(image, engine.inputSize)
    scores = await engine.run(tensor, engine.inputSize)
  } catch {
    failed = true
  }

  const confidence = failed ? 0 : explicitConfidence(scores)

  return {
    modelAvailable: Boolean(adapter) && !failed,
    backend: failed ? 'none' : engine.backend,
    rating: failed ? 'Clean' : rate(scores),
    explicitConfidence: confidence,
    scores,
    hashes,
    width: image.naturalWidth,
    height: image.naturalHeight,
    durationMs: Date.now() - started
  }
}
