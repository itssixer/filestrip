import { sanitize, randomName } from '@filestrip/core'
import type { R2Like, KVLike } from './types.js'

export interface StoredObject {
  key: string
  type: string
  format: string
  changed: boolean
  bytes: number
  exifTags: number
  trailingBytes: number
  summary: string[]
}

export interface PutOptions {
  /** Use a crypto-random key instead of the supplied one. */
  randomKey?: boolean
  httpMetadata?: Record<string, string>
  customMetadata?: Record<string, string>
}

/**
 * Sanitizes then writes to R2. The original buffer is never persisted, so a
 * bucket can never end up holding the GPS-bearing original.
 */
export async function putR2(
  bucket: R2Like,
  key: string,
  input: Uint8Array | ArrayBuffer,
  options: PutOptions = {}
): Promise<StoredObject> {
  const result = sanitize(input)
  const finalKey = options.randomKey ? randomName(result.format) : key

  await bucket.put(finalKey, result.bytes as unknown as ArrayBufferView, {
    httpMetadata: { contentType: result.type, ...options.httpMetadata },
    ...(options.customMetadata ? { customMetadata: options.customMetadata } : {})
  })

  return {
    key: finalKey,
    type: result.type,
    format: result.format,
    changed: result.changed,
    bytes: result.bytes.byteLength,
    exifTags: result.exifTags,
    trailingBytes: result.trailingBytes,
    summary: result.summary
  }
}

/** Sanitizes then writes to Workers KV. */
export async function putKV(
  namespace: KVLike,
  key: string,
  input: Uint8Array | ArrayBuffer,
  options: PutOptions = {}
): Promise<StoredObject> {
  const result = sanitize(input)
  const finalKey = options.randomKey ? randomName(result.format) : key

  await namespace.put(finalKey, result.bytes as unknown as ArrayBufferView, {
    metadata: { contentType: result.type, format: result.format }
  })

  return {
    key: finalKey,
    type: result.type,
    format: result.format,
    changed: result.changed,
    bytes: result.bytes.byteLength,
    exifTags: result.exifTags,
    trailingBytes: result.trailingBytes,
    summary: result.summary
  }
}
