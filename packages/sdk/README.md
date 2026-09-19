# @filestrip/sdk

One client for purge + vision + sentinel. React, Astro, or vanilla JS.

```sh
npm install @filestrip/sdk
```

## Vanilla

```ts
import { createStrip } from '@filestrip/sdk'

const strip = createStrip({
  visionWorkerUrl: new URL('vision.worker.js', location.href),
  blurThreshold: 0.6
})

const purged = await strip.sanitize(file)
purged.blob      // upload this
purged.name      // 'fs_9a8f12.png'
purged.headline  // 'Scrubbed 18 EXIF tags, GPS telemetry, and randomized filename.'

const report = await strip.inspect(file)
report.level       // 'Low' | 'Caution' | 'Critical'
report.telemetry   // core inspect result
report.vision      // classification + hashes, or null
report.sentinel    // documents, PII, faces, or null
report.shouldBlur  // only true when a real classifier model is loaded
```

`inspect()` runs vision and sentinel concurrently, and a failure in either
degrades to `null` instead of rejecting the whole report.

Call `strip.dispose()` to terminate the vision Worker.

## React

```tsx
import { useFilestrip } from '@filestrip/sdk/react'

const { sanitize, inspect, download, busy, error } = useFilestrip({
  visionWorkerUrl: new URL('vision.worker.js', location.href)
})
```

The `Strip` instance is memoised, so one component means one Worker, disposed on
unmount.

## Astro

```ts
import type { APIRoute } from 'astro'
import { handleUpload } from '@filestrip/sdk/astro'

export const prerender = false
export const POST: APIRoute = ({ request }) => handleUpload(request, 'file')
```

Runs on the Cloudflare Pages adapter without a DOM, since the purge never
touches canvas.

## Bundling the vision Worker

The Worker needs its own bundle so it can be loaded by URL. With esbuild, add a
second entry point containing one line:

```ts
import '@filestrip/vision/worker'
```

With Vite, use `import VisionWorker from '@filestrip/vision/worker?worker'`.

Omit `visionWorkerUrl` to run inline on the main thread instead.

## Remember the trust boundary

Everything here runs in the browser, which the user controls. Run
[`@filestrip/worker`](https://github.com/itssixer/filestrip/tree/main/packages/worker)
on the Worker that owns your storage bucket too — otherwise a plain `curl` walks
straight past all of it.
