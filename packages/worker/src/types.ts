import type { SanitizeResult } from '@filestrip/core'

/** Minimal R2 surface so the package needs no `@cloudflare/workers-types` dependency. */
export interface R2Like {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string | null,
    options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }
  ): Promise<unknown>
}

export interface KVLike {
  put(key: string, value: ArrayBuffer | ArrayBufferView | string, options?: { metadata?: unknown }): Promise<void>
}

export interface ScrubbedFile extends SanitizeResult {
  /** Form field the file arrived on, or `body` for a raw upload. */
  field: string
  /** Name supplied by the client, kept only for logging. */
  originalName: string
  /** Crypto-random replacement name. */
  name: string
}

export interface MiddlewareOptions {
  /**
   * Reject the request when a non-image or unsupported type is uploaded.
   * Defaults to false so mixed forms pass through untouched.
   */
  rejectUnsupported?: boolean
  /** Maximum bytes to accept per file. Defaults to 25 MB. */
  maxBytes?: number
}
