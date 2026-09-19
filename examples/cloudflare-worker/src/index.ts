import { Hono } from 'hono'
import { filestrip, putR2 } from '@filestrip/worker'
import type { ScrubbedFile } from '@filestrip/worker'
import { inspect } from '@filestrip/core'

interface Env {
  MEDIA: R2Bucket
  AUDIT?: KVNamespace
}

type Variables = {
  filestrip: ScrubbedFile[]
  filestripForm: FormData | null
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>()

app.get('/', (c) =>
  c.text(
    [
      'FILESTRIP edge example',
      '',
      '  PUT  /upload          raw image body  → sanitized object in R2',
      '  POST /upload-form     multipart form  → sanitized objects in R2',
      '  POST /inspect         raw image body  → telemetry report, nothing stored',
      '  GET  /object/:key     fetch a stored object',
      ''
    ].join('\n')
  )
)

/**
 * Raw upload. `putR2` sanitizes before writing, so the bucket can never hold
 * the GPS-bearing original even if this handler is called directly.
 */
app.put('/upload', async (c) => {
  const type = c.req.header('content-type') ?? ''
  if (!/^image\/(jpeg|png|webp)$/i.test(type)) {
    return c.json({ error: 'send image/jpeg, image/png, or image/webp' }, 415)
  }

  const body = await c.req.arrayBuffer()
  if (body.byteLength > 25 * 1024 * 1024) {
    return c.json({ error: 'payload too large' }, 413)
  }

  // randomKey avoids leaking anything through the object name.
  const stored = await putR2(c.env.MEDIA, '', body, { randomKey: true })

  if (c.env.AUDIT) {
    await c.env.AUDIT.put(
      `scrub:${stored.key}`,
      JSON.stringify({ at: new Date().toISOString(), summary: stored.summary }),
      { expirationTtl: 60 * 60 * 24 * 30 }
    )
  }

  return c.json(stored, 201)
})

/**
 * Multipart upload. The middleware replaces every image field with sanitized
 * bytes, so downstream code only ever sees clean files.
 */
app.post('/upload-form', filestrip({ maxBytes: 25 * 1024 * 1024 }), async (c) => {
  const files = c.get('filestrip')
  if (!files.length) return c.json({ error: 'no image fields found' }, 400)

  const stored = []
  for (const file of files) {
    stored.push(await putR2(c.env.MEDIA, file.name, file.bytes))
  }

  return c.json({ count: stored.length, objects: stored }, 201)
})

/** Read-only telemetry. Useful for showing users their exposure pre-upload. */
app.post('/inspect', async (c) => {
  const body = new Uint8Array(await c.req.arrayBuffer())
  const report = inspect(body)
  return c.json({
    format: report.format,
    level: report.level,
    exifTags: report.exifTags,
    trailingBytes: report.trailingBytes,
    hasGps: Boolean(report.gps),
    ghostThumbnail: report.ghostThumbnail,
    vectors: report.vectors
      .filter((v) => v.hits.length > 0)
      .map((v) => ({ id: v.id, threat: v.threat, count: v.hits.length }))
  })
})

app.get('/object/:key', async (c) => {
  const object = await c.env.MEDIA.get(c.req.param('key'))
  if (!object) return c.notFound()

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable'
    }
  })
})

export default app
