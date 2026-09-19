/**
 * Exact validators. Regex alone produces heavy false positives on photos, so
 * every numeric finding here must also pass a checksum or structural rule.
 */

/** Luhn mod-10, the checksum every major card network uses. */
export function luhn(digits: string): boolean {
  const clean = digits.replace(/[^\d]/g, '')
  if (clean.length < 12 || clean.length > 19) return false

  let sum = 0
  let double = false
  for (let i = clean.length - 1; i >= 0; i--) {
    let d = clean.charCodeAt(i) - 48
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

/** Maps a card number to its network, used as corroborating evidence. */
export function cardNetwork(digits: string): string | null {
  const n = digits.replace(/[^\d]/g, '')
  if (/^4\d{12}(\d{3})?(\d{3})?$/.test(n)) return 'Visa'
  if (/^(5[1-5]\d{4}|222[1-9]\d{2}|22[3-9]\d{3}|2[3-6]\d{4}|27[01]\d{3}|2720\d{2})\d{10}$/.test(n)) return 'Mastercard'
  if (/^3[47]\d{13}$/.test(n)) return 'American Express'
  if (/^(6011\d{12}|65\d{14}|64[4-9]\d{13})$/.test(n)) return 'Discover'
  if (/^3(0[0-5]|[68]\d)\d{11}$/.test(n)) return 'Diners Club'
  if (/^(352[89]|35[3-8]\d)\d{12}$/.test(n)) return 'JCB'
  return null
}

/**
 * US SSN structural rules. The SSA never issues area 000, 666, or 900-999, nor
 * a zero group or serial, which removes most random 9-digit matches.
 */
export function validSsn(value: string): boolean {
  const m = value.replace(/[^\d]/g, '')
  if (m.length !== 9) return false

  const area = Number(m.slice(0, 3))
  const group = Number(m.slice(3, 5))
  const serial = Number(m.slice(5))

  if (area === 0 || area === 666 || area >= 900) return false
  if (group === 0 || serial === 0) return false
  return true
}

const MRZ_WEIGHTS = [7, 3, 1]

function mrzCharValue(ch: string): number {
  if (ch === '<') return 0
  const code = ch.charCodeAt(0)
  if (code >= 48 && code <= 57) return code - 48
  if (code >= 65 && code <= 90) return code - 55
  return -1
}

/** MRZ check digit: weighted 7-3-1 sum, mod 10. */
export function mrzCheckDigit(field: string): number {
  let sum = 0
  for (let i = 0; i < field.length; i++) {
    const value = mrzCharValue(field[i]!)
    if (value < 0) return -1
    sum += value * MRZ_WEIGHTS[i % 3]!
  }
  return sum % 10
}

export interface MrzMatch {
  /** Number of individual check digits that validated. */
  validChecks: number
  totalChecks: number
  issuer: string
}

/**
 * Validates a TD3 passport MRZ: two 44-character lines where line two carries
 * check digits over the document number, birth date, and expiry.
 */
export function parseTd3(lines: string[]): MrzMatch | null {
  const candidates = lines
    .map((l) => l.replace(/\s+/g, '').toUpperCase())
    .filter((l) => l.length >= 43 && l.length <= 45)

  const first = candidates.find((l) => /^P[<A-Z0-9]/.test(l))
  const second = candidates.find((l) => l !== first && /^[A-Z0-9<]{20,}/.test(l))
  if (!first || !second) return null

  const line2 = second.padEnd(44, '<')
  const checks: Array<[string, string]> = [
    [line2.slice(0, 9), line2[9]!],
    [line2.slice(13, 19), line2[19]!],
    [line2.slice(21, 27), line2[27]!]
  ]

  let valid = 0
  for (const [field, expected] of checks) {
    const digit = mrzCheckDigit(field)
    if (digit >= 0 && String(digit) === expected) valid++
  }

  if (valid === 0) return null
  return {
    validChecks: valid,
    totalChecks: checks.length,
    issuer: first.slice(2, 5).replace(/</g, '')
  }
}

/** Keeps only the last four digits so findings never echo full numbers. */
export function redact(value: string, keep = 4): string {
  const clean = value.replace(/\s+/g, '')
  if (clean.length <= keep) return '*'.repeat(clean.length)
  return `${'*'.repeat(Math.max(4, clean.length - keep))}${clean.slice(-keep)}`
}
