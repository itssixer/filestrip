<div align="center">

# FILESTRIP

High-performance, zero-trust media sanitization suite and edge SDK, powered by
the **STRIP Engine**. Deep binary telemetry purges (EXIF/GPS/serials/EOF),
browser-native vision (explicit content and deepfakes), local WASM PII
(IDs/cards/faces), and Cloudflare Worker edge enforcement.

[![License: MIT](https://img.shields.io/badge/License-MIT-orange.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Deploy to Cloudflare Pages](https://img.shields.io/badge/Deploy%20to-Cloudflare%20Pages-F38020?logo=cloudflare)](https://pages.cloudflare.com/)
[![Core](https://img.shields.io/badge/core-zero%20dependencies-f6821f.svg)](packages/core)

</div>

---

## Why

Client-side EXIF stripping is a feature, not a control. Anyone can `curl` a raw
JPEG full of home GPS coordinates straight at your upload endpoint and skip the
frontend entirely.

FILESTRIP treats the Worker as the trust boundary. The same engine runs in the
browser for instant feedback and on the edge for enforcement, so the bytes you
actually store are always clean.

## Packages

| Package | What it does |
| --- | --- |
| [`@filestrip/core`](packages/core) | Binary parser. Drops EXIF, IPTC, XMP, ICC, and trailing junk. Random filenames. |
| [`@filestrip/vision`](packages/vision) | NSFW classification and local hashes (dHash, pHash, PDQ-style) in a Worker. |
| [`@filestrip/sentinel`](packages/sentinel) | IDs, cards, SSNs, addresses, faces. Optional WASM OCR. |
| [`@filestrip/worker`](packages/worker) | Hono / Workers middleware. Scrub before the object hits R2 or KV. |
| [`@filestrip/sdk`](packages/sdk) | One client for React, Astro, and vanilla JS. |

ESM + TypeScript. `@filestrip/core` has no dependencies.

## Quick start

```sh
npm install @filestrip/core
```

```ts
import { sanitize, inspect } from '@filestrip/core'

const clean = sanitize(bytes)
const report = inspect(bytes)
```

### Browser

```ts
import { createStrip } from '@filestrip/sdk'

const strip = createStrip({
  visionWorkerUrl: new URL('vision.worker.js', location.href),
  blurThreshold: 0.6
})

const purged = await strip.sanitize(file)
const report = await strip.inspect(file)
```

### Worker, writing to R2

```ts
import { putR2 } from '@filestrip/worker'

export default {
  async fetch(request: Request, env: Env) {
    const stored = await putR2(env.MEDIA, '', await request.arrayBuffer(), { randomKey: true })
    return Response.json(stored, { status: 201 })
  }
}
```

### React

```tsx
import { useFilestrip } from '@filestrip/sdk/react'

const { sanitize, inspect, download, busy } = useFilestrip()
```

## What the purge removes

| Format | Stripped |
| --- | --- |
| **JPEG** | APP1 (EXIF/XMP), APP2 (ICC), APP13 (IPTC), APP14 (Adobe), APP3–APP12, COM comments, everything after EOI |
| **PNG** | `tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME`, `iCCP`, `sRGB`, `gAMA`, `cHRM`, `dSIG`, everything after IEND |
| **WebP** | `EXIF`, `XMP `, `ICCP` chunks, VP8X metadata flags, everything past the RIFF length |

Pixel data stays. Trailing ZIP/RAR/7z/gzip/PE/ELF/PDF is detected by signature.

## Inspect

`inspect()` scores what the file is leaking before you decide to purge.

| Vector | Exposes | Threat |
| --- | --- | --- |
| GPS | Lat/lon | **Critical** |
| Bytes after EOI / IEND | Hidden archives or executables | **Critical** |
| Body / lens serials, `ImageUniqueID` | Links photos back to a camera | **High** |
| IFD1 thumbnail | Uncropped preview still in the file | **High** |
| DateTimeOriginal + OffsetTime | Time zone and routine | **Medium** |
| Camera, OS build, Photoshop / iOS history | Device and edit trail | **Medium** |

Rolls up to `Low`, `Caution`, or `Critical`.

## Where it runs

| | Purge | Inspect | Vision | Sentinel |
| --- | --- | --- | --- | --- |
| Cloudflare Workers | yes | yes | | |
| Cloudflare Pages (SSR) | yes | yes | | |
| Browser | yes | yes | yes | yes |
| Node 20+ | yes | yes | | |

Vision and sentinel need `OffscreenCanvas` / Web Workers / FaceDetector, so they stay in the browser.

## Models

Nothing is uploaded, and no weights ship in this repo.

- **Vision** — plug in ONNX (`onnxruntime-web`) or TF.js. Labels match NSFWJS (`Porn`, `Hentai`, `Sexy`, `Drawing`, `Neutral`). Without a model you still get hashes. The colour heuristic never auto-blurs.
- **Sentinel** — optional `tesseract.js` via `tesseractAdapter()`. Layout and faces work without OCR; the report says when a backend is missing instead of pretending the image is clean.

## Layout

```
packages/     core, vision, sentinel, worker, sdk
apps/web/     demo site (Cloudflare Pages)
examples/     Worker + R2
docs/         API and guides
```

## Dev

```sh
git clone https://github.com/itssixer/filestrip.git
cd filestrip
npm install
npm test
npm run dev    # http://127.0.0.1:5173
npm run build
```

## Pages

`wrangler.toml` sets `pages_build_output_dir` to `apps/web/dist`.

```sh
npm install && npm run build
npx wrangler pages deploy apps/web/dist --project-name filestrip
```

| | |
| --- | --- |
| Build command | `npm install && npm run build` |
| Output directory | `apps/web/dist` |
| Node | 20+ |

CSP lives in [`apps/web/_headers`](apps/web/_headers). The only third-party request is an OpenStreetMap iframe, and only when a photo has GPS.

## Docs

- [API](docs/api.md)
- [Workers, R2, KV](docs/workers.md)
- [Integrations](docs/integrations.md)
- [Zero-trust sanitization at the edge](docs/zero-trust-edge.md)

## License

[MIT](LICENSE)
