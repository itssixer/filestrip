import { sanitize } from './sanitize.js'
import { inspect } from './inspect.js'
import { randomName } from './name.js'
import { mimeFor } from './util.js'
import type { InspectResult, SanitizeResult } from './types.js'

/**
 * `auto` re-encodes lossless formats through canvas but leaves JPEG alone to
 * avoid generational quality loss — the binary purge already strips its
 * metadata without touching the entropy-coded data.
 */
export type ReencodeMode = 'auto' | 'always' | 'never'

export interface PurgeOptions {
  reencode?: ReencodeMode
  /** JPEG/WebP quality used only when re-encoding. */
  quality?: number
}

export interface PurgeResult extends SanitizeResult {
  blob: Blob
  /** Crypto-random filename, e.g. `fs_9a8f12.png`. */
  name: string
  /** True when pixels were redrawn through a canvas. */
  reencoded: boolean
  originalBytes: number
}

function hasCanvas(): boolean {
  return typeof document !== 'undefined' && typeof createImageBitmap === 'function'
}

function shouldReencode(mode: ReencodeMode, type: string): boolean {
  if (!hasCanvas()) return false
  if (mode === 'never') return false
  if (mode === 'always') return true
  return type === 'image/png' || type === 'image/webp'
}

/**
 * Redraws pixels into a fresh canvas. The output carries no metadata at all,
 * which also discards anything hidden in non-standard blocks.
 */
async function reencodeThroughCanvas(file: Blob, type: string, quality: number): Promise<Blob | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      return null
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) {
    bitmap.close?.()
    return null
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()

  const out = type === 'image/jpeg' || type === 'image/webp' ? type : 'image/png'
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), out, out === 'image/png' ? undefined : quality)
  })
}

/**
 * Full purge for a browser File: optional canvas pass, binary metadata purge,
 * then a crypto-random filename.
 */
export async function purgeFile(file: Blob, options: PurgeOptions = {}): Promise<PurgeResult> {
  const { reencode = 'auto', quality = 0.92 } = options
  const originalBytes = file.size
  const declared = file.type || ''

  let working = file
  let reencoded = false

  if (shouldReencode(reencode, declared)) {
    const redrawn = await reencodeThroughCanvas(file, declared, quality)
    if (redrawn) {
      working = redrawn
      reencoded = true
    }
  }

  // Purge the bytes we are actually shipping. Canvas output can still carry
  // colour-space chunks, so this runs even after a re-encode.
  const raw = new Uint8Array(await working.arrayBuffer())
  const result = sanitize(raw)

  // Telemetry counts must describe the original file, not the redrawn copy.
  let report = result
  if (reencoded) {
    const original = sanitize(new Uint8Array(await file.arrayBuffer()))
    report = {
      ...result,
      changed: result.changed || original.changed,
      removed: original.removed.length ? original.removed : result.removed,
      exifTags: original.exifTags,
      trailingBytes: original.trailingBytes,
      summary: original.changed ? original.summary : result.summary
    }
  }

  const type = report.type === 'application/octet-stream' ? declared || mimeFor(report.format) : report.type
  const blob = new Blob([report.bytes as unknown as BlobPart], { type })

  return {
    ...report,
    type,
    blob,
    name: randomName(report.format),
    reencoded,
    originalBytes
  }
}

export async function inspectFile(file: Blob): Promise<InspectResult> {
  return inspect(new Uint8Array(await file.arrayBuffer()))
}

export { sanitize, inspect, randomName }
export type { InspectResult, SanitizeResult }
