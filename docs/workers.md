# Workers, R2, and KV

Sanitize on the Worker that accepts the upload. Never write the bytes you were
handed.

## Why container stripping at the edge

Workers have no DOM canvas. Re-encoding pixels needs WASM or the Images binding,
both of which cost CPU time and add deploy complexity.

For GPS, serials, IPTC, XMP, ghost thumbnails, and appended archives, walking
the container is enough and it is nearly free:

| Format | Dropped |
| --- | --- |
| JPEG | APP1, APP2, APP13, APP14, APP3–APP12, COM, everything after EOI |
| PNG | `tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME`, `iCCP`, `sRGB`, `gAMA`, `cHRM`, `dSIG`, everything after IEND |
| WebP | `EXIF`, `XMP `, `ICCP`, VP8X flags, everything past the RIFF length |

`@filestrip/core` does this with zero dependencies, so it drops into a Worker
without a bundler fight.

## Raw upload to R2

```ts
import { putR2 } from '@filestrip/worker'

interface Env {
  MEDIA: R2Bucket
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method !== 'PUT') {
      return new Response('PUT an image', { status: 405 })
    }

    const type = request.headers.get('content-type') ?? ''
    if (!/^image\/(jpeg|png|webp)$/i.test(type)) {
      return Response.json({ error: 'unsupported media type' }, { status: 415 })
    }

    const stored = await putR2(env.MEDIA, '', await request.arrayBuffer(), {
      randomKey: true
    })

    return Response.json(stored, { status: 201 })
  }
}
```

```toml
# wrangler.toml
[[r2_buckets]]
binding = "MEDIA"
bucket_name = "your-bucket"
```

`randomKey: true` matters. `IMG_4401_beach-house.jpg` is a metadata problem even
after EXIF is gone.

## Multipart uploads with Hono

```ts
import { Hono } from 'hono'
import { filestrip, putR2 } from '@filestrip/worker'

const app = new Hono<{ Bindings: Env }>()

app.post('/upload', filestrip({ maxBytes: 25 * 1024 * 1024 }), async (c) => {
  const files = c.get('filestrip')
  if (!files.length) return c.json({ error: 'no image fields' }, 400)

  const stored = []
  for (const file of files) {
    stored.push(await putR2(c.env.MEDIA, file.name, file.bytes))
  }

  return c.json({ count: stored.length, objects: stored }, 201)
})

export default app
```

The middleware rewrites every image field in place. Non-image fields pass
through untouched, so mixed forms keep working.

## Without Hono

```ts
import { withFilestrip } from '@filestrip/worker'

export default {
  fetch: withFilestrip<Env>(async (request, env, files) => {
    // `request` body is already sanitized
    for (const file of files) {
      await env.MEDIA.put(file.name, file.bytes, {
        httpMetadata: { contentType: file.type }
      })
    }
    return Response.json({ scrubbed: files.length })
  })
}
```

## Audit trail in KV

The scrub summary is small and useful for support tickets:

```ts
const stored = await putR2(env.MEDIA, '', body, { randomKey: true })

await env.AUDIT.put(
  `scrub:${stored.key}`,
  JSON.stringify({ at: new Date().toISOString(), summary: stored.summary }),
  { expirationTtl: 60 * 60 * 24 * 30 }
)
```

Store the summary, not the findings. Logging extracted GPS coordinates would
recreate the problem you just solved.

## Size limits

`scrubRequest` and `filestrip()` default to 25 MB per file and return `413` past
it. The purge is a single pass over the buffer, but the whole file is held in
memory, so keep the limit well under the Worker memory ceiling.

## Rejecting unsupported types

Unknown bytes pass through unchanged by design — the engine will not silently
claim to have cleaned a format it does not parse. Gate explicitly:

```ts
import { sniff } from '@filestrip/core'

const format = sniff(bytes)
if (format === 'unknown' || format === 'gif') {
  return Response.json({ error: 'unsupported format' }, { status: 415 })
}
```

Check `sniff()` rather than `Content-Type`. The header is client-supplied.
