# @filestrip/vision

NSFW classification and local hashes in a Web Worker. Browser only (`OffscreenCanvas`).

No uploads, no bundled model weights.

```sh
npm install @filestrip/vision
```

## Analyze

```ts
import { VisionEngine } from '@filestrip/vision'

const engine = new VisionEngine({
  workerUrl: new URL('vision.worker.js', location.href),
  modelUrl: '/models/nsfw.onnx'
})

const report = await engine.analyze(file)
report.rating              // 'Clean' | 'Suggestive' | 'Explicit'
report.explicitConfidence  // 0..1
report.hashes              // { dhash, phash, pdq }
```

Omit `workerUrl` to run inline on the main thread. If the Worker crashes the
engine retries inline once rather than losing the result.

## Perceptual hashing

Exact, dependency-free, and model-independent. These always work:

```ts
import { dhash, phash, hamming, similarity } from '@filestrip/vision'

dhash(gray, w, h)         // 64-bit gradient hash
phash(gray, w, h, 8)      // 64-bit DCT hash
phash(gray, w, h, 16)     // 256-bit PDQ-style hash
similarity(a, b)          // 0..1
```

Useful for deduplication and for matching against a local blocklist without
sending anything to an API.

## Bring your own model

```ts
import { onnxAdapter, tfjsAdapter } from '@filestrip/vision'

await onnxAdapter('/models/nsfw.onnx', 224)   // needs onnxruntime-web
await tfjsAdapter(tf, '/models/model.json')   // you pass the tf namespace
```

Class order follows the NSFWJS convention — `['Drawing', 'Hentai', 'Neutral',
'Porn', 'Sexy']` — so community models drop in unchanged. Input is
`[1, size, size, 3]` float32 normalised to 0..1. Logits and probabilities both
work; softmax is applied only when the outputs do not already sum to 1.

## Without a model

You still get all three hashes plus `heuristicAdapter()`, which measures
skin-tone coverage and saturation.

Read this carefully: that heuristic is a colour statistic, not a classifier. It
never reports `Porn` or `Hentai`, its confidence is capped at 0.5, and
`@filestrip/sdk` will not auto-blur from it — warm-toned photos and sunsets
false-positive, and blurring those would be worse than doing nothing. Use it as
a hint that a file deserves review, never as moderation ground truth.

`report.modelAvailable` tells you which situation you are in.
