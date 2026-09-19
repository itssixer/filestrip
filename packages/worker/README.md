# @filestrip/worker

Scrub uploads on Cloudflare Workers before they hit R2 or KV.

```sh
npm install @filestrip/worker
```

## Store to R2

```ts
import { putR2 } from '@filestrip/worker'

export default {
  async fetch(request: Request, env: Env) {
    const stored = await putR2(env.MEDIA, '', await request.arrayBuffer(), {
      randomKey: true
    })
    return Response.json(stored, { status: 201 })
  }
}
```

Sanitizing happens before the write, so the bucket can never hold the
GPS-bearing original. `randomKey: true` also drops the client filename —
`IMG_4401_beach-house.jpg` is a metadata problem even after EXIF is gone.

`putKV` has the same contract for Workers KV.

## Hono middleware

```ts
import { Hono } from 'hono'
import { filestrip, putR2 } from '@filestrip/worker'

const app = new Hono<{ Bindings: Env }>()

app.post('/upload', filestrip({ maxBytes: 25 * 1024 * 1024 }), async (c) => {
  const files = c.get('filestrip')
  for (const file of files) {
    await putR2(c.env.MEDIA, file.name, file.bytes)
  }
  return c.json({ stored: files.length })
})
```

| Context key | Value |
| --- | --- |
| `filestrip` | `ScrubbedFile[]` |
| `filestripForm` | Rebuilt `FormData` with sanitized blobs, or `null` |
| `filestripBody` | Sanitized bytes for a raw body, or `null` |

Non-image fields pass through untouched, so mixed forms keep working. Returns
`413` past `maxBytes` and `415` when `rejectUnsupported` is set.

## Without Hono

```ts
import { withFilestrip } from '@filestrip/worker'

export default {
  fetch: withFilestrip<Env>(async (request, env, files) => {
    // request body is already sanitized
    return Response.json({ scrubbed: files.length })
  })
}
```

## Why container stripping at the edge

Workers have no DOM canvas, and re-encoding pixels would need WASM or the Images
binding. For GPS, serials, IPTC, XMP, ghost thumbnails, and appended archives,
walking the JPEG, PNG, and WebP container structures is enough — and nearly
free. `@filestrip/core` does that with zero dependencies, so it drops into a
Worker without a bundler fight.

Runnable example:
[`examples/cloudflare-worker`](https://github.com/itssixer/filestrip/tree/main/examples/cloudflare-worker)
