# API reference

Every package is ESM-only and ships its own `.d.ts` files.

---

## `@filestrip/core`

Zero dependencies. Safe in Workers, Node, and browsers.

### `sanitize(input)`

```ts
function sanitize(input: Uint8Array | ArrayBuffer): SanitizeResult
```

```ts
interface SanitizeResult {
  bytes: Uint8Array        // purged container
  type: string             // 'image/jpeg' | 'image/png' | 'image/webp'
  format: Format           // 'jpeg' | 'png' | 'webp' | 'gif' | 'unknown'
  changed: boolean         // true when any block was dropped
  removed: RemovedBlock[]  // { kind, label, bytes } per dropped block
  exifTags: number         // TIFF tags present before the purge
  trailingBytes: number    // bytes appended after the terminator
  summary: string[]        // sentence fragments for the UI
}
```

Unknown formats are returned unchanged with `changed: false`. Your upload
handler must reject unsupported types — the purge will not invent support.

Purging is idempotent: sanitizing an already-clean file reports
`changed: false` and returns identical bytes.

### `inspect(input)`

```ts
function inspect(input: Uint8Array | ArrayBuffer): InspectResult
```

```ts
interface InspectResult {
  format: Format
  level: 'Low' | 'Caution' | 'Critical'
  gps: { lat: number; lon: number; altitude?: number } | null
  ghostThumbnail: { width: number; height: number; bytes: number } | null
  exifTags: number
  trailingBytes: number
  vectors: TelemetryVector[]
}
```

Read-only. Never modifies the input.

### `randomName(formatOrExt, bytes?)`

```ts
randomName('jpeg')  // 'fs_9a8f12.jpg'  — format names map to canonical extensions
randomName('png')   // 'fs_4c1e08.png'
randomName('jpg')   // 'fs_bb2910.jpg'  — literal extensions pass through
```

Uses `crypto.getRandomValues`. Nothing from the input filename is reused.

### Other exports

| Export | Purpose |
| --- | --- |
| `isSupported(input)` | Accepts a MIME string or bytes |
| `sniff(bytes)` | Format from magic bytes, ignoring the declared type |
| `identifyPayload(bytes)` | Names an appended archive or executable |
| `parseExif(tiff)` | Low-level TIFF reader |
| `crc32(bytes)` | PNG chunk checksums |
| `STRIP_ENGINE_VERSION` | Engine version string |

### `@filestrip/core/browser`

```ts
function purgeFile(file: Blob, options?: PurgeOptions): Promise<PurgeResult>
function inspectFile(file: Blob): Promise<InspectResult>
```

```ts
interface PurgeOptions {
  reencode?: 'auto' | 'always' | 'never'  // default 'auto'
  quality?: number                        // default 0.92
}
```

`reencode: 'auto'` redraws PNG and WebP through a canvas — lossless, and it
discards anything hiding in non-standard blocks. JPEG is left alone to avoid
generational quality loss, since the binary purge already removes its metadata
without touching entropy-coded data.

`PurgeResult` extends `SanitizeResult` with `blob`, `name`, `reencoded`, and
`originalBytes`.

---

## `@filestrip/vision`

Browser only. Needs `OffscreenCanvas`.

### `VisionEngine`

```ts
const engine = new VisionEngine({
  workerUrl: new URL('vision.worker.js', location.href),
  modelUrl: '/models/nsfw.onnx',  // optional
  inputSize: 224
})

const report = await engine.analyze(file)
engine.terminate()
```

```ts
interface VisionReport {
  modelAvailable: boolean   // false when no classifier is configured
  backend: 'onnx' | 'tfjs' | 'heuristic' | 'none'
  rating: 'Clean' | 'Suggestive' | 'Explicit'
  explicitConfidence: number      // Porn + Hentai + Sexy, 0..1
  scores: { label: VisionClass; score: number }[]
  hashes: { dhash: string; phash: string; pdq: string }
  width: number
  height: number
  durationMs: number
}
```

Omit `workerUrl` to run inline on the main thread. If the Worker crashes mid-run
the engine retries inline once rather than losing the result.

### Perceptual hashing

```ts
dhash(gray, width, height)            // 64-bit, hex
phash(gray, width, height, 8)         // 64-bit DCT, hex
phash(gray, width, height, 16)        // 256-bit PDQ-style, hex
hamming(a, b)                         // bit distance
similarity(a, b)                      // 0..1
```

Exact, dependency-free, and model-independent. Identical results in a Worker,
Node, or the main thread.

### Classifier adapters

```ts
await onnxAdapter('/models/nsfw.onnx', 224)   // requires onnxruntime-web
await tfjsAdapter(tf, '/models/model.json')   // you pass the tf namespace
heuristicAdapter()                            // colour statistics only
```

The heuristic measures skin-tone coverage and saturation. It is a colour
statistic, not a classifier: it never reports `Porn` or `Hentai`, its confidence
is capped at 0.5, and it must not gate moderation decisions.

---

## `@filestrip/sentinel`

Browser only for face detection; text scanning is pure.

### `scan(source, options?)`

```ts
const report = await scan(file, {
  ocr: await tesseractAdapter({ lang: 'eng' }),
  faces: nativeFaceAdapter() ?? undefined,
  dimensions: { width, height }
})
```

```ts
interface SentinelReport {
  level: 'Low' | 'Caution' | 'Critical'
  ocrAvailable: boolean
  documents: { kind: DocumentKind; confidence: number; evidence: string[] }[]
  pii: { kind: PiiKind; preview: string; confidence: number; evidence: string }[]
  faces: { x: number; y: number; width: number; height: number }[]
  faceDetectionUnavailable: boolean
  durationMs: number
}
```

`preview` is always redacted — findings never echo a full card number or SSN.

### Validators

Exported standalone because they are useful on their own:

```ts
luhn('4111111111111111')     // true
cardNetwork('378282246310005') // 'American Express'
validSsn('123-45-6789')      // true  — enforces SSA area/group rules
mrzCheckDigit('L898902C3')   // 6     — 7-3-1 weighting
parseTd3([line1, line2])     // { validChecks, totalChecks, issuer } | null
redact('4111111111111111')   // '************1111'
```

Regex alone false-positives heavily on photos, so every numeric finding must
also pass a checksum or structural rule.

### Adapters

| Function | Backend |
| --- | --- |
| `tesseractAdapter(opts)` | `tesseract.js` WASM OCR, fully local |
| `customOcrAdapter(fn)` | Any OCR you supply |
| `nativeFaceAdapter()` | Platform `FaceDetector`; returns `null` when absent |
| `customFaceAdapter(fn)` | MediaPipe, ONNX, or your own detector |

---

## `@filestrip/worker`

### `putR2(bucket, key, input, options?)`

Sanitizes, then writes. Pass `{ randomKey: true }` to ignore `key` and use a
crypto-random name.

```ts
interface StoredObject {
  key: string
  type: string
  format: string
  changed: boolean
  bytes: number
  exifTags: number
  trailingBytes: number
  summary: string[]
}
```

### `putKV(namespace, key, input, options?)`

Same contract, backed by Workers KV.

### `filestrip(options?)`

Hono middleware. Sets three context values:

| Key | Value |
| --- | --- |
| `filestrip` | `ScrubbedFile[]` |
| `filestripForm` | Rebuilt `FormData` with sanitized blobs, or `null` |
| `filestripBody` | Sanitized bytes for a raw body, or `null` |

Returns `413` past `maxBytes` (default 25 MB) and `415` when
`rejectUnsupported` is set and a non-image arrives.

### `withFilestrip(handler, options?)`

Wraps a plain Workers `fetch` handler; the handler receives an already-sanitized
request plus the scrubbed file list.

### `scrubRequest(request, options?)`

The primitive both wrappers use. Handles raw bodies and `multipart/form-data`,
leaving non-image fields untouched.

---

## `@filestrip/sdk`

### `createStrip(config)`

```ts
interface StripConfig {
  visionWorkerUrl?: string | URL
  modelUrl?: string
  blurThreshold?: number   // default 0.6
  ocr?: OcrAdapter
  faces?: FaceAdapter
  skipVision?: boolean
  skipSentinel?: boolean
}
```

| Method | Returns |
| --- | --- |
| `sanitize(file)` | `PurgeOutcome` — a `PurgeResult` plus a `headline` sentence |
| `inspect(file)` | `InspectOutcome` — telemetry, vision, sentinel, combined `level`, `shouldBlur` |
| `inspectAndPurge(file)` | Both, in one call |
| `dispose()` | Terminates the vision Worker |

`inspect()` runs vision and sentinel concurrently, and a failure in either
degrades to `null` instead of rejecting the whole report.

`shouldBlur` is only ever true when a real classifier model is loaded. The
colour heuristic false-positives on warm-toned photos, so it never triggers a
blur on its own.

### `@filestrip/sdk/react`

```ts
const { sanitize, inspect, download, busy, error, lastPurge, lastReport, reset } =
  useFilestrip(config)
```

The `Strip` instance is memoised, so one vision Worker is created per component
and disposed on unmount.

### `@filestrip/sdk/astro`

```ts
purgeUpload(file): Promise<AstroPurge>
handleUpload(request, field?): Promise<Response>
```

Runs on the Cloudflare Pages adapter without a DOM.
