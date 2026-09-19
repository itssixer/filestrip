import { scanText, scanDocuments } from './patterns.js'
import { scanLayout, mergeDocuments } from './layout.js'
import { nativeFaceAdapter, padBoxes } from './faces.js'
import type { SentinelLevel, SentinelOptions, SentinelReport } from './types.js'

function score(report: Omit<SentinelReport, 'level' | 'durationMs'>): SentinelLevel {
  const critical = report.pii.some(
    (p) => (p.kind === 'payment-card' || p.kind === 'ssn' || p.kind === 'passport-mrz') && p.confidence >= 0.85
  )
  if (critical) return 'Critical'

  const strongDoc = report.documents.some((d) => d.confidence >= 0.8)
  if (strongDoc) return 'Critical'

  if (report.pii.length > 0 || report.documents.length > 0) return 'Caution'
  if (report.faces.length > 0) return 'Caution'
  return 'Low'
}

/**
 * Runs the sentinel stage. OCR and face detection are both optional: when a
 * backend is missing the report says so rather than silently returning "clean".
 */
export async function scan(source: Blob | ImageBitmap, options: SentinelOptions = {}): Promise<SentinelReport> {
  const started = Date.now()

  const faceAdapter = options.faces ?? nativeFaceAdapter()
  const dimensions = options.dimensions ?? (source instanceof ImageBitmap
    ? { width: source.width, height: source.height }
    : null)

  // OCR is the slow stage; run it alongside face detection rather than after.
  const [text, faces] = await Promise.all([
    options.ocr ? options.ocr.recognize(source).catch(() => '') : Promise.resolve(''),
    faceAdapter ? faceAdapter.detect(source).catch(() => []) : Promise.resolve([])
  ])

  const pii = scanText(text)
  const fromText = scanDocuments(text, pii)
  const fromLayout = dimensions ? scanLayout(dimensions.width, dimensions.height) : []
  const documents = mergeDocuments(fromText, fromLayout)

  const partial = {
    ocrAvailable: Boolean(options.ocr),
    documents,
    pii,
    faces: padBoxes(faces),
    faceDetectionUnavailable: !faceAdapter
  }

  return {
    ...partial,
    level: score(partial),
    durationMs: Date.now() - started
  }
}
