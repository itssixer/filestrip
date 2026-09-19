import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dhash, phash, hamming, similarity } from '../dist/index.js'
import { explicitConfidence, rate } from '../dist/analyze.js'

function checkerboard(size, cell) {
  const gray = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      gray[y * size + x] = ((Math.floor(x / cell) + Math.floor(y / cell)) % 2) * 255
    }
  }
  return gray
}

function solid(size, value) {
  return new Float32Array(size * size).fill(value)
}

test('dhash is 64 bits and stable for the same image', () => {
  const gray = checkerboard(64, 8)
  const a = dhash(gray, 64, 64)
  const b = dhash(gray, 64, 64)
  assert.equal(a.length, 16)
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]+$/)
})

test('phash 8 and 16 produce 64-bit and 256-bit hex', () => {
  const gray = checkerboard(64, 4)
  const p64 = phash(gray, 64, 64, 8)
  const pdq = phash(gray, 64, 64, 16)
  assert.equal(p64.length, 16)
  assert.equal(pdq.length, 64)
})

test('similar images score high; inverted images score low', () => {
  const a = checkerboard(32, 4)
  const b = a.map((v) => 255 - v)
  const ha = dhash(a, 32, 32)
  const hb = dhash(b, 32, 32)
  assert.ok(similarity(ha, ha) === 1)
  assert.ok(hamming(ha, hb) > 16)
  assert.ok(similarity(ha, hb) < 0.75)
})

test('solid fields still produce a hash without throwing', () => {
  const gray = solid(16, 128)
  assert.equal(dhash(gray, 16, 16).length, 16)
  assert.equal(phash(gray, 16, 16, 8).length, 16)
})

test('rate maps NSFWJS classes onto Clean / Suggestive / Explicit', () => {
  assert.equal(rate([{ label: 'Neutral', score: 0.9 }]), 'Clean')
  assert.equal(rate([{ label: 'Sexy', score: 0.5 }]), 'Suggestive')
  assert.equal(
    rate([
      { label: 'Porn', score: 0.4 },
      { label: 'Hentai', score: 0.3 }
    ]),
    'Explicit'
  )
})

test('explicitConfidence sums Porn, Hentai, and Sexy', () => {
  const n = explicitConfidence([
    { label: 'Porn', score: 0.2 },
    { label: 'Hentai', score: 0.1 },
    { label: 'Sexy', score: 0.3 },
    { label: 'Neutral', score: 0.4 }
  ])
  assert.ok(Math.abs(n - 0.6) < 1e-9)
})
