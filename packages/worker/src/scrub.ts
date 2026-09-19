import { sanitize, isSupported, randomName } from '@filestrip/core'
import type { ScrubbedFile, MiddlewareOptions } from './types.js'

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024
const IMAGE_TYPE = /^image\/(jpeg|jpg|png|webp)$/i

function isBlob(value: unknown): value is Blob {
  return typeof value === 'object' && value !== null && typeof (value as Blob).arrayBuffer === 'function'
}

export class PayloadTooLarge extends Error {
  readonly bytes: number
  constructor(bytes: number, limit: number) {
    super(`upload is ${bytes} bytes, limit is ${limit}`)
    this.name = 'PayloadTooLarge'
    this.bytes = bytes
  }
}

export class UnsupportedMedia extends Error {
  constructor(type: string) {
    super(`unsupported media type: ${type || 'unknown'}`)
    this.name = 'UnsupportedMedia'
  }
}

function scrubBytes(raw: Uint8Array, field: string, originalName: string): ScrubbedFile {
  const result = sanitize(raw)
  return {
    ...result,
    field,
    originalName,
    name: randomName(result.format)
  }
}

export interface ScrubbedRequest {
  files: ScrubbedFile[]
  /** Rebuilt multipart body with sanitized blobs, when the upload was a form. */
  form: FormData | null
  /** Sanitized bytes for a raw single-image body. */
  body: Uint8Array | null
}

/**
 * Reads an upload and returns sanitized bytes. Handles both raw image bodies
 * and `multipart/form-data`, leaving non-image fields untouched.
 */
export async function scrubRequest(request: Request, options: MiddlewareOptions = {}): Promise<ScrubbedRequest> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    const form = await request.formData()
    const next = new FormData()
    const files: ScrubbedFile[] = []

    for (const [key, value] of form.entries()) {
      if (!isBlob(value)) {
        next.append(key, value)
        continue
      }

      const type = value.type || ''
      if (!IMAGE_TYPE.test(type)) {
        if (options.rejectUnsupported) throw new UnsupportedMedia(type)
        next.append(key, value, (value as File).name)
        continue
      }
      if (value.size > maxBytes) throw new PayloadTooLarge(value.size, maxBytes)

      const raw = new Uint8Array(await value.arrayBuffer())
      const scrubbed = scrubBytes(raw, key, (value as File).name ?? 'upload')
      files.push(scrubbed)
      next.append(key, new Blob([scrubbed.bytes as unknown as BlobPart], { type: scrubbed.type }), scrubbed.name)
    }

    return { files, form: next, body: null }
  }

  if (IMAGE_TYPE.test(contentType) || isSupported(contentType)) {
    const raw = new Uint8Array(await request.arrayBuffer())
    if (raw.byteLength > maxBytes) throw new PayloadTooLarge(raw.byteLength, maxBytes)
    const scrubbed = scrubBytes(raw, 'body', 'upload')
    return { files: [scrubbed], form: null, body: scrubbed.bytes }
  }

  if (options.rejectUnsupported) throw new UnsupportedMedia(contentType)
  return { files: [], form: null, body: null }
}
