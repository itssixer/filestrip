import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitize, inspect, randomName, sniff, crc32 } from '../dist/index.js'
import { jpegWithExif, pngWithText, webpWithExif } from './fixtures.js'

test('sniff identifies supported containers', () => {
  assert.equal(sniff(jpegWithExif()), 'jpeg')
  assert.equal(sniff(pngWithText()), 'png')
  assert.equal(sniff(webpWithExif()), 'webp')
  assert.equal(sniff(new Uint8Array([1, 2, 3, 4])), 'unknown')
})

test('jpeg purge drops EXIF, comments, and keeps scan data', () => {
  const input = jpegWithExif()
  const out = sanitize(input)

  assert.equal(out.format, 'jpeg')
  assert.ok(out.changed)
  assert.ok(out.bytes.length < input.length)
  assert.equal(out.bytes[0], 0xff)
  assert.equal(out.bytes[1], 0xd8)
  assert.equal(out.bytes.at(-2), 0xff)
  assert.equal(out.bytes.at(-1), 0xd9)

  const text = Buffer.from(out.bytes).toString('latin1')
  assert.ok(!text.includes('Exif'), 'EXIF header removed')
  assert.ok(!text.includes('hidden note'), 'comment removed')
  assert.ok(text.includes('SCANDATA'), 'entropy-coded data preserved')
})

test('jpeg inspect surfaces gps, serial, and ghost thumbnail', () => {
  const report = inspect(jpegWithExif())

  assert.equal(report.level, 'Critical')
  assert.ok(report.gps)
  assert.equal(Math.round(report.gps.lat), 37)
  assert.equal(Math.round(report.gps.lon), -122)

  const serial = report.vectors.find((v) => v.id === 'serial')
  assert.ok(serial.hits.some((h) => h.value === 'SN-12345'))

  const device = report.vectors.find((v) => v.id === 'device')
  assert.ok(device.hits.some((h) => h.value === 'ACME'))

  assert.ok(report.exifTags > 0)
})

test('purge summary itemizes what was removed', () => {
  const out = sanitize(jpegWithExif())
  const line = out.summary.join(', ')

  assert.match(line, /EXIF tag/)
  assert.match(line, /GPS telemetry/)
  assert.match(line, /serial numbers/)
  assert.match(line, /randomized filename/)
})

test('appended EOF payload is detected and stripped', () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa, 0xbb, 0xcc, 0xdd])
  const base = jpegWithExif()
  const polyglot = new Uint8Array(base.length + zip.length)
  polyglot.set(base, 0)
  polyglot.set(zip, base.length)

  const report = inspect(polyglot)
  const payload = report.vectors.find((v) => v.id === 'payload')
  assert.equal(payload.hits.length, 1)
  assert.match(payload.hits[0].key, /ZIP archive/)

  const out = sanitize(polyglot)
  assert.equal(out.trailingBytes, zip.length)
  assert.equal(out.bytes.at(-2), 0xff)
  assert.equal(out.bytes.at(-1), 0xd9)
  assert.ok(out.summary.some((s) => s.includes('ZIP archive')))
})

test('png purge drops text, timestamp, and colour chunks', () => {
  const input = pngWithText()
  const out = sanitize(input)

  assert.equal(out.format, 'png')
  assert.ok(out.changed)

  const text = Buffer.from(out.bytes).toString('latin1')
  assert.ok(!text.includes('tEXt'))
  assert.ok(!text.includes('tIME'))
  assert.ok(!text.includes('iCCP'))
  assert.ok(text.includes('IHDR'), 'header preserved')
  assert.ok(text.includes('IDAT'), 'pixel data preserved')
  assert.ok(text.includes('IEND'), 'terminator preserved')
})

test('png inspect reports embedded text records', () => {
  const report = inspect(pngWithText())
  const device = report.vectors.find((v) => v.id === 'device')
  assert.ok(device.hits.some((h) => h.key === 'Software'))
})

test('webp purge removes EXIF chunk and rewrites RIFF size', () => {
  const input = webpWithExif()
  const out = sanitize(input)

  assert.equal(out.format, 'webp')
  assert.ok(out.changed)

  const text = Buffer.from(out.bytes).toString('latin1')
  assert.ok(!text.includes('EXIF'))
  assert.ok(text.startsWith('RIFF'))
  assert.ok(text.includes('WEBP'))

  const declared = out.bytes[4] | (out.bytes[5] << 8) | (out.bytes[6] << 16) | (out.bytes[7] << 24)
  assert.equal(declared, out.bytes.length - 8, 'RIFF size matches payload')
})

test('purging twice is stable', () => {
  const once = sanitize(jpegWithExif())
  const twice = sanitize(once.bytes)

  assert.equal(twice.changed, false)
  assert.deepEqual([...twice.bytes], [...once.bytes])
})

test('unknown formats pass through untouched', () => {
  const input = new Uint8Array([0x00, 0x01, 0x02, 0x03])
  const out = sanitize(input)

  assert.equal(out.format, 'unknown')
  assert.equal(out.changed, false)
  assert.deepEqual([...out.bytes], [...input])
})

test('random names are prefixed, hex, and unique', () => {
  assert.match(randomName('png'), /^fs_[0-9a-f]{6}\.png$/)
  assert.match(randomName('webp'), /^fs_[0-9a-f]{6}\.webp$/)

  // `jpeg` is a format name; the file extension must be the canonical `.jpg`.
  assert.match(randomName('jpeg'), /^fs_[0-9a-f]{6}\.jpg$/)
  assert.match(randomName('jpg'), /^fs_[0-9a-f]{6}\.jpg$/)

  const seen = new Set()
  for (let i = 0; i < 200; i++) seen.add(randomName('jpeg'))
  assert.ok(seen.size > 190, 'names should not collide')
})

test('crc32 matches known value', () => {
  assert.equal(crc32(new TextEncoder().encode('IEND')), 0xae426082)
})
