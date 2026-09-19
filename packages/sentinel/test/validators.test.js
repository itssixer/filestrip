import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  luhn,
  cardNetwork,
  validSsn,
  mrzCheckDigit,
  parseTd3,
  redact,
  scanText,
  scanDocuments,
  scanLayout
} from '../dist/index.js'

// Standard network test numbers. These are published non-issued values.
const VISA = '4111111111111111'
const MASTERCARD = '5500005555555559'
const AMEX = '378282246310005'

test('luhn accepts published test numbers', () => {
  assert.ok(luhn(VISA))
  assert.ok(luhn(MASTERCARD))
  assert.ok(luhn(AMEX))
  assert.ok(luhn('4111 1111 1111 1111'))
})

test('luhn rejects mistyped numbers and wrong lengths', () => {
  assert.equal(luhn('4111111111111112'), false)
  assert.equal(luhn('411111111'), false)
  assert.equal(luhn('12345678901234567890'), false)
})

test('cardNetwork identifies prefixes', () => {
  assert.equal(cardNetwork(VISA), 'Visa')
  assert.equal(cardNetwork(MASTERCARD), 'Mastercard')
  assert.equal(cardNetwork(AMEX), 'American Express')
  assert.equal(cardNetwork('9999999999999999'), null)
})

test('validSsn enforces SSA structural rules', () => {
  assert.ok(validSsn('123-45-6789'))
  assert.equal(validSsn('000-45-6789'), false, 'area 000 is never issued')
  assert.equal(validSsn('666-45-6789'), false, 'area 666 is never issued')
  assert.equal(validSsn('900-45-6789'), false, 'area 900+ is never issued')
  assert.equal(validSsn('123-00-6789'), false, 'group 00 is invalid')
  assert.equal(validSsn('123-45-0000'), false, 'serial 0000 is invalid')
})

test('mrz check digit uses 7-3-1 weighting', () => {
  // ICAO specimen: 9-char document number field, published check digit 6.
  assert.equal(mrzCheckDigit('L898902C3'), 6)
  // Birth date field 74-08-12, published check digit 2.
  assert.equal(mrzCheckDigit('740812'), 2)
  // '<' contributes zero.
  assert.equal(mrzCheckDigit('<<<<<<'), 0)
})

test('parseTd3 validates a specimen passport MRZ', () => {
  const line1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<'
  const line2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'
  const match = parseTd3([line1, line2])

  assert.ok(match, 'MRZ should be recognised')
  assert.equal(match.issuer, 'UTO')
  assert.ok(match.validChecks >= 2, `expected check digits to validate, got ${match.validChecks}`)
})

test('parseTd3 ignores unrelated text', () => {
  assert.equal(parseTd3(['hello world', 'this is not an mrz line at all really']), null)
})

test('redact keeps only the tail', () => {
  assert.equal(redact('4111111111111111'), '************1111')
  assert.equal(redact('123', 4), '***')
})

test('scanText finds a card number and never echoes it', () => {
  const findings = scanText(`Cardholder: J DOE\nVALID THRU 09/29\n${VISA}`)
  const card = findings.find((f) => f.kind === 'payment-card')

  assert.ok(card)
  assert.ok(card.confidence > 0.9)
  assert.match(card.evidence, /Luhn/)
  assert.ok(!card.preview.includes('4111111111111111'), 'raw number must not leak')
  assert.ok(card.preview.endsWith('1111'))
})

test('scanText ignores numbers that fail Luhn', () => {
  const findings = scanText('Order reference 1234567890123456 shipped')
  assert.equal(findings.filter((f) => f.kind === 'payment-card').length, 0)
})

test('scanText finds SSN, address, and email', () => {
  const findings = scanText('SSN 123-45-6789\n742 Evergreen Terrace\nSpringfield 90210\nbob@example.com')

  assert.ok(findings.some((f) => f.kind === 'ssn'))
  assert.ok(findings.some((f) => f.kind === 'address'))

  const email = findings.find((f) => f.kind === 'email')
  assert.ok(email)
  assert.ok(!email.preview.includes('bob@'), 'local part must be masked')
})

test('scanDocuments classifies a licence from keywords', () => {
  const text = 'CALIFORNIA DRIVER LICENSE\nCLASS C\nRESTRICTIONS NONE'
  const docs = scanDocuments(text, scanText(text))

  assert.equal(docs[0].kind, 'drivers-licence')
  assert.ok(docs[0].confidence > 0.6)
})

test('scanLayout flags ID-1 card proportions', () => {
  const card = scanLayout(1586, 1000)
  assert.ok(card.some((d) => d.kind === 'payment-card'))

  const square = scanLayout(1000, 1000)
  assert.equal(square.length, 0)
})
