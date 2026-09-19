import { scrubRequest, PayloadTooLarge, UnsupportedMedia } from './scrub.js'
import type { MiddlewareOptions, ScrubbedFile } from './types.js'

/** Structural Hono context so the package does not depend on Hono at build time. */
interface Honoish {
  req: { raw: Request; method: string; header(name: string): string | undefined }
  set(key: string, value: unknown): void
  json(body: unknown, status?: number): Response
}

const SKIP = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Hono middleware. Sanitized files land on `c.get('filestrip')` and a rebuilt
 * multipart body on `c.get('filestripForm')`.
 *
 * ```ts
 * app.post('/upload', filestrip(), async (c) => {
 *   const files = c.get('filestrip')
 *   return c.json({ scrubbed: files.length })
 * })
 * ```
 */
export function filestrip(options: MiddlewareOptions = {}) {
  return async function filestripMiddleware(c: Honoish, next: () => Promise<void>): Promise<Response | void> {
    if (SKIP.has(c.req.method.toUpperCase())) return next()

    try {
      const result = await scrubRequest(c.req.raw, options)
      c.set('filestrip', result.files)
      c.set('filestripForm', result.form)
      c.set('filestripBody', result.body)
    } catch (err) {
      if (err instanceof PayloadTooLarge) {
        return c.json({ error: 'payload too large', bytes: err.bytes }, 413)
      }
      if (err instanceof UnsupportedMedia) {
        return c.json({ error: err.message }, 415)
      }
      throw err
    }

    return next()
  }
}

/**
 * Wraps a plain Workers fetch handler. The downstream handler receives a
 * request whose body is already sanitized.
 */
export function withFilestrip<Env>(
  handler: (request: Request, env: Env, files: ScrubbedFile[]) => Promise<Response> | Response,
  options: MiddlewareOptions = {}
): (request: Request, env: Env) => Promise<Response> {
  return async (request: Request, env: Env) => {
    if (SKIP.has(request.method.toUpperCase())) return handler(request, env, [])

    let scrubbed
    try {
      scrubbed = await scrubRequest(request, options)
    } catch (err) {
      if (err instanceof PayloadTooLarge) {
        return Response.json({ error: 'payload too large', bytes: err.bytes }, { status: 413 })
      }
      if (err instanceof UnsupportedMedia) {
        return Response.json({ error: err.message }, { status: 415 })
      }
      throw err
    }

    let forwarded = request
    if (scrubbed.form) {
      forwarded = new Request(request.url, {
        method: request.method,
        headers: stripContentType(request.headers),
        body: scrubbed.form
      })
    } else if (scrubbed.body) {
      forwarded = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: scrubbed.body as unknown as BodyInit
      })
    }

    return handler(forwarded, env, scrubbed.files)
  }
}

/** FormData sets its own multipart boundary, so the old header must go. */
function stripContentType(headers: Headers): Headers {
  const next = new Headers(headers)
  next.delete('content-type')
  return next
}
