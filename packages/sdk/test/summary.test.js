import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headline } from '../dist/index.js'

test('headline formats zero, one, two, and many fragments', () => {
  assert.equal(headline([]), 'Nothing to scrub.')
  assert.equal(headline(['18 EXIF tags']), 'Scrubbed 18 EXIF tags.')
  assert.equal(headline(['18 EXIF tags', 'GPS telemetry']), 'Scrubbed 18 EXIF tags and GPS telemetry.')
  assert.equal(
    headline(['18 EXIF tags', 'GPS telemetry', 'lens serial number', 'randomized filename']),
    'Scrubbed 18 EXIF tags, GPS telemetry, lens serial number, and randomized filename.'
  )
})
