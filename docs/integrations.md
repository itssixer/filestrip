# Framework integrations

The browser is never a trust boundary. Everything here improves user experience;
the Worker that owns your bucket must still run `sanitize()`. See
[Workers, R2, and KV](workers.md).

## Vanilla JS

```ts
import { createStrip } from '@filestrip/sdk'

const strip = createStrip({
  visionWorkerUrl: new URL('vision.worker.js', location.href)
})

input.addEventListener('change', async () => {
  const file = input.files?.[0]
  if (!file) return

  const report = await strip.inspect(file)
  if (report.level === 'Critical') {
    console.warn('exposure vectors found', report.telemetry.vectors)
  }

  const clean = await strip.sanitize(file)
  // upload clean.blob under clean.name
})
```

### Bundling the vision Worker

The Worker must be its own bundle so it can be loaded by URL. With esbuild:

```js
await esbuild.build({
  entryPoints: {
    main: 'src/main.ts',
    'vision.worker': 'src/vision.worker.ts'
  },
  bundle: true,
  format: 'esm',
  outdir: 'dist'
})
```

Where `src/vision.worker.ts` is one line:

```ts
import '@filestrip/vision/worker'
```

With Vite, use the built-in worker syntax instead:

```ts
import VisionWorker from '@filestrip/vision/worker?worker'
```

Omit `visionWorkerUrl` entirely to run inline on the main thread. Analysis still
works, it just competes with rendering.

## React on Cloudflare Pages

```tsx
import { useFilestrip } from '@filestrip/sdk/react'

export function Uploader() {
  const { sanitize, inspect, download, busy, error } = useFilestrip({
    visionWorkerUrl: new URL('vision.worker.js', location.href)
  })

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const report = await inspect(file)
    if (report.shouldBlur) {
      // Only true when a real classifier model is loaded.
    }

    const clean = await sanitize(file)
    download(clean)
  }

  return (
    <>
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPick} disabled={busy} />
      {error && <p role="alert">{error.message}</p>}
    </>
  )
}
```

The hook memoises its `Strip` instance and terminates the Worker on unmount, so
one component means one thread.

## Hono

```ts
import { Hono } from 'hono'
import { filestrip, putR2 } from '@filestrip/worker'

const app = new Hono<{ Bindings: Env }>()

app.post('/upload', filestrip({ maxBytes: 10 * 1024 * 1024 }), async (c) => {
  const files = c.get('filestrip')
  for (const file of files) {
    await putR2(c.env.MEDIA, file.name, file.bytes)
  }
  return c.json({ stored: files.length })
})
```

A complete runnable version lives in
[`examples/cloudflare-worker`](../examples/cloudflare-worker).

## Astro on Cloudflare Pages

```ts
// src/pages/api/upload.ts
import type { APIRoute } from 'astro'
import { handleUpload } from '@filestrip/sdk/astro'

export const prerender = false

export const POST: APIRoute = ({ request }) => handleUpload(request, 'file')
```

For custom handling:

```ts
import { purgeUpload } from '@filestrip/sdk/astro'

export const POST: APIRoute = async ({ request, locals }) => {
  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof Blob)) return new Response('file required', { status: 400 })

  const clean = await purgeUpload(file)
  if (clean.format === 'unknown') return new Response('unsupported', { status: 415 })

  await locals.runtime.env.MEDIA.put(clean.name, clean.bytes, {
    httpMetadata: { contentType: clean.type }
  })

  return Response.json({ key: clean.name, summary: clean.summary })
}
```

## Loading a classifier model

No weights ship with these packages. Self-host a model and point the SDK at it:

```ts
const strip = createStrip({
  visionWorkerUrl: new URL('vision.worker.js', location.href),
  modelUrl: '/models/nsfw-mobilenet.onnx',
  blurThreshold: 0.6
})
```

Requirements:

- `onnxruntime-web` installed in your app
- Output order matching `['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy']`
- Input `[1, size, size, 3]`, float32, normalised to 0..1

The model loads inside the Worker and is cached across calls. Logits or
probabilities both work — the adapter applies softmax only when the outputs do
not already sum to 1.

## Adding local OCR

```ts
import { tesseractAdapter } from '@filestrip/sentinel'

const strip = createStrip({
  ocr: await tesseractAdapter({
    lang: 'eng',
    workerPath: '/tesseract/worker.min.js',
    langPath: '/tesseract/lang',
    corePath: '/tesseract/core'
  })
})
```

Self-host the worker, core, and traineddata files. Left unset, `tesseract.js`
fetches them from a CDN, which breaks the offline guarantee.

Without an OCR adapter, sentinel still detects faces and document layout, and
the report sets `ocrAvailable: false` rather than implying the image is clean.
