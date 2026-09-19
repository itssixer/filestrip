import type { DocumentFinding, DocumentKind } from './types.js'

/** ISO/IEC 7810 physical card and passport proportions. */
const RATIOS: Array<{ kind: DocumentKind; ratio: number; label: string }> = [
  { kind: 'payment-card', ratio: 85.6 / 53.98, label: 'ID-1 card ratio' },
  { kind: 'drivers-licence', ratio: 85.6 / 53.98, label: 'ID-1 card ratio' },
  { kind: 'passport', ratio: 125 / 88, label: 'ID-3 passport ratio' }
]

/**
 * Weak structural signal from frame proportions. A cropped card photo lands
 * close to 1.586:1, which raises suspicion but cannot confirm a document on its
 * own — that is why confidence is capped low and OCR evidence dominates.
 */
export function scanLayout(width: number, height: number): DocumentFinding[] {
  if (!width || !height) return []

  const ratio = Math.max(width, height) / Math.min(width, height)
  const findings: DocumentFinding[] = []
  const seen = new Set<DocumentKind>()

  for (const candidate of RATIOS) {
    if (seen.has(candidate.kind)) continue
    const delta = Math.abs(ratio - candidate.ratio)
    if (delta > 0.06) continue
    seen.add(candidate.kind)
    findings.push({
      kind: candidate.kind,
      confidence: Math.max(0.2, 0.45 - delta * 4),
      evidence: [`${candidate.label} (${ratio.toFixed(3)}:1)`]
    })
  }

  return findings
}

/** Merges layout guesses into OCR findings, summing corroborating evidence. */
export function mergeDocuments(fromText: DocumentFinding[], fromLayout: DocumentFinding[]): DocumentFinding[] {
  const merged = new Map<DocumentKind, DocumentFinding>()

  for (const doc of [...fromText, ...fromLayout]) {
    const existing = merged.get(doc.kind)
    if (!existing) {
      merged.set(doc.kind, { ...doc, evidence: [...doc.evidence] })
      continue
    }
    // Independent signals agreeing should raise confidence, never lower it.
    existing.confidence = Math.min(0.99, existing.confidence + doc.confidence * 0.35)
    existing.evidence.push(...doc.evidence)
  }

  return [...merged.values()].sort((a, b) => b.confidence - a.confidence)
}
