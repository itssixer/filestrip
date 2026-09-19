/**
 * Perceptual hashing. These are exact, dependency-free implementations — no
 * model weights involved — so they work identically in a Worker, Node, or the
 * main thread.
 */

/** Packs a bit array into lowercase hex, most significant bit first. */
function bitsToHex(bits: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!
    hex += nibble.toString(16)
  }
  return hex
}

/**
 * Difference hash. Compares each pixel with its right neighbour on a 9x8 grid,
 * yielding 64 bits that survive rescaling and mild recompression.
 */
export function dhash(gray: Float32Array, width: number, height: number): string {
  const w = 9
  const h = 8
  const resized = resizeGray(gray, width, height, w, h)
  const bits = new Uint8Array(64)
  let i = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      bits[i++] = resized[y * w + x]! > resized[y * w + x + 1]! ? 1 : 0
    }
  }
  return bitsToHex(bits)
}

/**
 * DCT-II based hash. Keeps the low-frequency coefficients and thresholds them
 * against their median, which tolerates gamma shifts and blur.
 *
 * @param bitsWide 8 for a 64-bit hash, 16 for a 256-bit PDQ-style hash.
 */
export function phash(gray: Float32Array, width: number, height: number, bitsWide = 8): string {
  const size = bitsWide * 4
  const resized = resizeGray(gray, width, height, size, size)
  const coeffs = dct2d(resized, size)

  // Skip the DC term at [0,0]; it only encodes average brightness.
  const values: number[] = []
  for (let y = 0; y < bitsWide; y++) {
    for (let x = 0; x < bitsWide; x++) {
      if (x === 0 && y === 0) continue
      values.push(coeffs[y * size + x]!)
    }
  }

  const median = medianOf(values)
  const bits = new Uint8Array(bitsWide * bitsWide)
  let i = 0
  for (let y = 0; y < bitsWide; y++) {
    for (let x = 0; x < bitsWide; x++) {
      if (x === 0 && y === 0) {
        bits[i++] = 0
        continue
      }
      bits[i++] = coeffs[y * size + x]! > median ? 1 : 0
    }
  }
  return bitsToHex(bits)
}

/** Hamming distance between two equal-length hex hashes. */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY
  let distance = 0
  for (let i = 0; i < a.length; i++) {
    let diff = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)
    while (diff) {
      distance += diff & 1
      diff >>= 1
    }
  }
  return distance
}

/** Fraction of matching bits, 0 to 1. */
export function similarity(a: string, b: string): number {
  const distance = hamming(a, b)
  if (!Number.isFinite(distance)) return 0
  return 1 - distance / (a.length * 4)
}

/** Box-filter downscale of a single-channel image. */
export function resizeGray(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Float32Array {
  const out = new Float32Array(dstW * dstH)
  const xRatio = srcW / dstW
  const yRatio = srcH / dstH

  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * yRatio)
    const y1 = Math.min(srcH, Math.max(y0 + 1, Math.floor((y + 1) * yRatio)))
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * xRatio)
      const x1 = Math.min(srcW, Math.max(x0 + 1, Math.floor((x + 1) * xRatio)))

      let sum = 0
      let count = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          sum += src[sy * srcW + sx]!
          count++
        }
      }
      out[y * dstW + x] = count ? sum / count : 0
    }
  }
  return out
}

/** Separable 2D DCT-II. Cosine tables are cached per size. */
const cosCache = new Map<number, Float32Array>()

function cosTable(n: number): Float32Array {
  const cached = cosCache.get(n)
  if (cached) return cached
  const table = new Float32Array(n * n)
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      table[k * n + i] = Math.cos(((2 * i + 1) * k * Math.PI) / (2 * n))
    }
  }
  cosCache.set(n, table)
  return table
}

function dct2d(input: Float32Array, n: number): Float32Array {
  const table = cosTable(n)
  const rows = new Float32Array(n * n)

  for (let y = 0; y < n; y++) {
    for (let k = 0; k < n; k++) {
      let sum = 0
      for (let x = 0; x < n; x++) sum += input[y * n + x]! * table[k * n + x]!
      rows[y * n + k] = sum
    }
  }

  const out = new Float32Array(n * n)
  for (let x = 0; x < n; x++) {
    for (let k = 0; k < n; k++) {
      let sum = 0
      for (let y = 0; y < n; y++) sum += rows[y * n + x]! * table[k * n + y]!
      out[k * n + x] = sum
    }
  }
  return out
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  if (!sorted.length) return 0
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Rec. 601 luma, matching what most perceptual-hash references use. */
export function toGrayscale(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!
  }
  return gray
}
