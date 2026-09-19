// Minimal, hand-built image containers. Real photos cannot be committed here
// (they would carry real GPS), so every fixture is assembled byte by byte.

const ASCII = 2
const SHORT = 3
const LONG = 4
const RATIONAL = 5

function asciiValue(s) {
  const b = new Uint8Array(s.length + 1)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i)
  return { type: ASCII, count: b.length, bytes: b }
}

function shortValue(n) {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n, true)
  return { type: SHORT, count: 1, bytes: b }
}

function longValue(n) {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return { type: LONG, count: 1, bytes: b }
}

function rationalTriple(triples) {
  const b = new Uint8Array(24)
  const dv = new DataView(b.buffer)
  triples.forEach(([num, den], i) => {
    dv.setUint32(i * 8, num, true)
    dv.setUint32(i * 8 + 4, den, true)
  })
  return { type: RATIONAL, count: 3, bytes: b }
}

function ifdSize(entries) {
  return 2 + entries.length * 12 + 4
}

/**
 * Writes one IFD. Values longer than 4 bytes go on a shared heap and the entry
 * stores the heap offset instead, exactly as the TIFF spec requires.
 */
function writeIfd(buf, dv, at, entries, heap, nextIfd = 0) {
  dv.setUint16(at, entries.length, true)
  let p = at + 2

  for (const entry of entries) {
    dv.setUint16(p, entry.tag, true)
    dv.setUint16(p + 2, entry.value.type, true)
    dv.setUint32(p + 4, entry.value.count, true)

    const bytes = entry.value.bytes
    if (bytes.length <= 4) {
      buf.set(bytes, p + 8)
    } else {
      dv.setUint32(p + 8, heap.offset, true)
      buf.set(bytes, heap.offset)
      heap.offset += bytes.length
      if (heap.offset & 1) heap.offset++
    }
    p += 12
  }

  dv.setUint32(p, nextIfd, true)
}

/** Little-endian TIFF block with IFD0, ExifIFD, GPS IFD, and an IFD1 thumbnail. */
function buildTiff() {
  const gpsEntries = [
    { tag: 0x0001, value: asciiValue('N') },
    { tag: 0x0002, value: rationalTriple([[37, 1], [26, 1], [0, 1]]) },
    { tag: 0x0003, value: asciiValue('W') },
    { tag: 0x0004, value: rationalTriple([[122, 1], [5, 1], [0, 1]]) },
    { tag: 0x001d, value: asciiValue('2026:01:01') }
  ]

  const exifEntries = [
    { tag: 0x9003, value: asciiValue('2026:01:01 10:00:00') },
    { tag: 0x9011, value: asciiValue('+02:00') },
    { tag: 0xa431, value: asciiValue('SN-12345') },
    { tag: 0xa434, value: asciiValue('50mm f/1.8') },
    { tag: 0xa435, value: asciiValue('LENS-998877') }
  ]

  const thumbEntries = [
    { tag: 0x0100, value: shortValue(160) },
    { tag: 0x0101, value: shortValue(120) },
    { tag: 0x0201, value: longValue(4) },
    { tag: 0x0202, value: longValue(1024) }
  ]

  // Offsets must be known before writing, so lay the IFDs out first.
  const ifd0Off = 8
  const ifd0Placeholder = 5
  const ifd0Size = 2 + ifd0Placeholder * 12 + 4
  const exifOff = ifd0Off + ifd0Size
  const gpsOff = exifOff + ifdSize(exifEntries)
  const ifd1Off = gpsOff + ifdSize(gpsEntries)
  const heapStart = ifd1Off + ifdSize(thumbEntries)

  const ifd0Entries = [
    { tag: 0x010f, value: asciiValue('ACME') },
    { tag: 0x0110, value: asciiValue('CoolPix 9000') },
    { tag: 0x0131, value: asciiValue('Adobe Photoshop 26.0') },
    { tag: 0x8769, value: longValue(exifOff) },
    { tag: 0x8825, value: longValue(gpsOff) }
  ]

  let heapBytes = 0
  for (const list of [ifd0Entries, exifEntries, gpsEntries, thumbEntries]) {
    for (const e of list) {
      if (e.value.bytes.length > 4) heapBytes += e.value.bytes.length + (e.value.bytes.length & 1)
    }
  }

  const total = heapStart + heapBytes + 16
  const buf = new Uint8Array(total)
  const dv = new DataView(buf.buffer)
  const heap = { offset: heapStart }

  buf[0] = 0x49
  buf[1] = 0x49
  dv.setUint16(2, 0x2a, true)
  dv.setUint32(4, ifd0Off, true)

  writeIfd(buf, dv, ifd0Off, ifd0Entries, heap, ifd1Off)
  writeIfd(buf, dv, exifOff, exifEntries, heap)
  writeIfd(buf, dv, gpsOff, gpsEntries, heap)
  writeIfd(buf, dv, ifd1Off, thumbEntries, heap)

  return buf
}

function jpegSegment(marker, payload) {
  const len = payload.length + 2
  const out = new Uint8Array(payload.length + 4)
  out[0] = 0xff
  out[1] = marker
  out[2] = (len >> 8) & 0xff
  out[3] = len & 0xff
  out.set(payload, 4)
  return out
}

function bytes(...parts) {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function latin1(s) {
  const b = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i)
  return b
}

/** JPEG carrying EXIF (GPS + serials + thumbnail), a comment, and scan data. */
export function jpegWithExif() {
  const exifPayload = bytes(latin1('Exif'), new Uint8Array([0, 0]), buildTiff())

  return bytes(
    new Uint8Array([0xff, 0xd8]),
    jpegSegment(0xe1, exifPayload),
    jpegSegment(0xfe, latin1('hidden note')),
    jpegSegment(0xdb, new Uint8Array(65)),
    new Uint8Array([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    latin1('SCANDATA'),
    new Uint8Array([0xff, 0xd9])
  )
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length, false)
  out.set(latin1(type), 4)
  out.set(data, 8)
  const body = bytes(latin1(type), data)
  dv.setUint32(8 + data.length, crc(body), false)
  return out
}

/** PNG with a text record, timestamp, and ICC profile alongside real pixel data. */
export function pngWithText() {
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, 2, false)
  dv.setUint32(4, 2, false)
  ihdr[8] = 8
  ihdr[9] = 6

  const time = new Uint8Array(7)
  new DataView(time.buffer).setUint16(0, 2026, false)
  time[2] = 1
  time[3] = 1

  return bytes(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', bytes(latin1('Software'), new Uint8Array([0]), latin1('Adobe Photoshop'))),
    pngChunk('tIME', time),
    pngChunk('iCCP', bytes(latin1('sRGB'), new Uint8Array([0, 0]), latin1('PROFILEDATA'))),
    pngChunk('IDAT', latin1('FAKEIDATPIXELS')),
    pngChunk('IEND', new Uint8Array(0))
  )
}

function riffChunk(type, data) {
  const padded = data.length + (data.length & 1)
  const out = new Uint8Array(8 + padded)
  out.set(latin1(type), 0)
  new DataView(out.buffer).setUint32(4, data.length, true)
  out.set(data, 8)
  return out
}

/** WebP whose VP8X flags advertise the EXIF chunk that follows. */
export function webpWithExif() {
  const vp8x = new Uint8Array(10)
  vp8x[0] = 0x08
  const body = bytes(
    latin1('WEBP'),
    riffChunk('VP8X', vp8x),
    riffChunk('VP8 ', latin1('FAKEVP8BITSTREAM')),
    riffChunk('EXIF', buildTiff())
  )

  const out = new Uint8Array(8 + body.length)
  out.set(latin1('RIFF'), 0)
  new DataView(out.buffer).setUint32(4, body.length, true)
  out.set(body, 8)
  return out
}
