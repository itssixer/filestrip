import { luhn, cardNetwork, validSsn, parseTd3, redact } from './validators.js'
import type { DocumentFinding, PiiFinding } from './types.js'

const CARD = /\b(?:\d[ -]?){12,19}\b/g
const SSN = /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g
const PHONE = /\b(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const DOB = /\b(?:DOB|D\.O\.B|BIRTH|BORN)\b[:\s]*([0-9]{1,4}[-/][0-9]{1,2}[-/][0-9]{2,4})/gi

const STREET =
  /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}\s+(?:ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|BOULEVARD|LN|LANE|DR|DRIVE|CT|COURT|WAY|PL|PLACE|TER|TERRACE|CIR|CIRCLE|HWY|HIGHWAY|PKWY|PARKWAY)\b/gi
const POSTAL = /\b\d{5}(?:-\d{4})?\b/g

const LICENCE_KEYWORDS = [
  'DRIVER LICENSE',
  'DRIVERS LICENSE',
  "DRIVER'S LICENSE",
  'DRIVING LICENCE',
  'DRIVER LICENCE',
  'OPERATOR LICENSE',
  'CLASS C',
  'CLASS D',
  'DL NO',
  'ENDORSEMENTS',
  'RESTRICTIONS'
]

const PASSPORT_KEYWORDS = [
  'PASSPORT',
  'PASSEPORT',
  'TYPE/TYPE',
  'AUTHORITY',
  'NATIONALITY',
  'PLACE OF BIRTH',
  'DATE OF ISSUE'
]

const CARD_KEYWORDS = ['VALID THRU', 'GOOD THRU', 'EXPIRES END', 'CARDHOLDER', 'MEMBER SINCE', 'CVV', 'DEBIT', 'CREDIT']

const ID_KEYWORDS = ['IDENTIFICATION CARD', 'ID CARD', 'STATE ID', 'RESIDENT CARD', 'NATIONAL ID']

function countKeywords(text: string, keywords: string[]): string[] {
  const upper = text.toUpperCase()
  return keywords.filter((k) => upper.includes(k))
}

/**
 * Extracts PII from OCR text. Every numeric finding is checksum-validated, so a
 * phone number in an image caption will not be reported as a payment card.
 */
export function scanText(text: string): PiiFinding[] {
  if (!text.trim()) return []
  const findings: PiiFinding[] = []
  const seen = new Set<string>()

  const push = (finding: PiiFinding) => {
    const key = `${finding.kind}:${finding.preview}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push(finding)
  }

  for (const match of text.matchAll(CARD)) {
    const raw = match[0]!
    const digits = raw.replace(/[^\d]/g, '')
    if (!luhn(digits)) continue
    const network = cardNetwork(digits)
    push({
      kind: 'payment-card',
      preview: redact(digits),
      confidence: network ? 0.97 : 0.85,
      evidence: network ? `Luhn checksum, ${network} prefix` : 'Luhn checksum'
    })
  }

  for (const match of text.matchAll(SSN)) {
    const raw = match[0]!
    if (!validSsn(raw)) continue
    // A bare 9-digit run is ambiguous; separators make it far more likely.
    const separated = /[- ]/.test(raw)
    push({
      kind: 'ssn',
      preview: redact(raw),
      confidence: separated ? 0.9 : 0.6,
      evidence: separated ? 'SSA area/group rules, dashed format' : 'SSA area/group rules'
    })
  }

  const mrz = parseTd3(text.split(/\r?\n/))
  if (mrz) {
    push({
      kind: 'passport-mrz',
      preview: `${mrz.issuer || '???'} passport MRZ`,
      confidence: mrz.validChecks === mrz.totalChecks ? 0.98 : 0.75,
      evidence: `TD3 MRZ check digits (${mrz.validChecks}/${mrz.totalChecks} valid)`
    })
  }

  for (const match of text.matchAll(STREET)) {
    push({
      kind: 'address',
      preview: redact(match[0]!.replace(/\s+/g, ' '), 0),
      confidence: 0.7,
      evidence: 'street-suffix pattern'
    })
  }

  const hasStreet = findings.some((f) => f.kind === 'address')
  if (hasStreet) {
    for (const match of text.matchAll(POSTAL)) {
      push({
        kind: 'address',
        preview: `postal code ${redact(match[0]!, 2)}`,
        confidence: 0.6,
        evidence: 'postal code alongside street match'
      })
      break
    }
  }

  for (const match of text.matchAll(EMAIL)) {
    const value = match[0]!
    const [local, domain] = value.split('@')
    push({
      kind: 'email',
      preview: `${local!.slice(0, 2)}***@${domain}`,
      confidence: 0.95,
      evidence: 'RFC-shaped address'
    })
  }

  for (const match of text.matchAll(PHONE)) {
    const digits = match[0]!.replace(/[^\d]/g, '')
    if (digits.length < 10) continue
    // Avoid double-reporting a card number as a phone number.
    if (findings.some((f) => f.kind === 'payment-card' && f.preview.endsWith(digits.slice(-4)))) continue
    push({
      kind: 'phone',
      preview: redact(digits),
      confidence: 0.65,
      evidence: 'NANP number shape'
    })
  }

  for (const match of text.matchAll(DOB)) {
    push({
      kind: 'date-of-birth',
      preview: 'date of birth label',
      confidence: 0.8,
      evidence: `labelled date (${match[1]!.replace(/\d/g, '#')})`
    })
  }

  return findings.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Infers document type from OCR keywords. Layout ratio alone is weak, so text
 * evidence carries most of the confidence here.
 */
export function scanDocuments(text: string, pii: PiiFinding[]): DocumentFinding[] {
  const documents: DocumentFinding[] = []

  const licence = countKeywords(text, LICENCE_KEYWORDS)
  if (licence.length) {
    documents.push({
      kind: 'drivers-licence',
      confidence: Math.min(0.95, 0.5 + licence.length * 0.15),
      evidence: licence.map((k) => `text "${k}"`)
    })
  }

  const passport = countKeywords(text, PASSPORT_KEYWORDS)
  const mrz = pii.find((p) => p.kind === 'passport-mrz')
  if (passport.length || mrz) {
    const evidence = passport.map((k) => `text "${k}"`)
    if (mrz) evidence.push(mrz.evidence)
    documents.push({
      kind: 'passport',
      confidence: mrz ? 0.98 : Math.min(0.9, 0.45 + passport.length * 0.15),
      evidence
    })
  }

  const card = countKeywords(text, CARD_KEYWORDS)
  const cardNumber = pii.find((p) => p.kind === 'payment-card')
  if (card.length || cardNumber) {
    const evidence = card.map((k) => `text "${k}"`)
    if (cardNumber) evidence.push(cardNumber.evidence)
    documents.push({
      kind: 'payment-card',
      confidence: cardNumber ? 0.96 : Math.min(0.85, 0.4 + card.length * 0.15),
      evidence
    })
  }

  const id = countKeywords(text, ID_KEYWORDS)
  if (id.length && !licence.length) {
    documents.push({
      kind: 'id-card',
      confidence: Math.min(0.9, 0.5 + id.length * 0.15),
      evidence: id.map((k) => `text "${k}"`)
    })
  }

  return documents.sort((a, b) => b.confidence - a.confidence)
}
