import { sanitize, randomName } from '@filestrip/core'
import { headline } from './summary.js'

export interface AstroPurge {
  bytes: Uint8Array
  blob: Blob
  name: string
  type: string
  format: string
  changed: boolean
  summary: string[]
  headline: string
}

/**
 * Server-side purge for Astro endpoints. Runs on the Cloudflare Pages adapter
 * without a DOM, since the STRIP Engine core never touches canvas.
 */
export async function purgeUpload(file: Blob): Promise<AstroPurge> {
  const result = sanitize(new Uint8Array(await file.arrayBuffer()))
  const name = randomName(result.format)

  return {
    bytes: result.bytes,
    blob: new Blob([result.bytes as unknown as BlobPart], { type: result.type }),
    name,
    type: result.type,
    format: result.format,
    changed: result.changed,
    summary: result.summary,
    headline: headline(result.summary)
  }
}

/**
 * Handler for an Astro form POST. Returns the sanitized image directly, with
 * the scrub summary exposed as response headers for logging.
 */
export async function handleUpload(request: Request, field = 'file'): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return new Response('expected multipart/form-data', { status: 415 })
  }

  const form = await request.formData()
  const file = form.get(field)
  if (!file || typeof (file as Blob).arrayBuffer !== 'function') {
    return new Response(`missing form field "${field}"`, { status: 400 })
  }

  const purged = await purgeUpload(file as Blob)
  if (purged.format === 'unknown') {
    return new Response('unsupported image format', { status: 415 })
  }

  return new Response(purged.bytes as unknown as BodyInit, {
    headers: {
      'content-type': purged.type,
      'content-disposition': `attachment; filename="${purged.name}"`,
      'x-filestrip-scrubbed': String(purged.changed),
      'x-filestrip-summary': purged.summary.join('; ')
    }
  })
}
