# @filestrip/sentinel

IDs, cards, SSNs, addresses, faces. Runs locally — no API.

```sh
npm install @filestrip/sentinel
```

## Scan

```ts
import { scan, tesseractAdapter, nativeFaceAdapter } from '@filestrip/sentinel'

const report = await scan(file, {
  ocr: await tesseractAdapter({ lang: 'eng' }),
  faces: nativeFaceAdapter() ?? undefined,
  dimensions: { width, height }
})

report.level      // 'Low' | 'Caution' | 'Critical'
report.documents  // [{ kind: 'drivers-licence', confidence: 0.8, evidence: [...] }]
report.pii        // [{ kind: 'payment-card', preview: '************1111', ... }]
report.faces      // [{ x, y, width, height }]
```

Findings are always redacted. `preview` never contains a full card number or
SSN.

## Validators

Regex alone false-positives heavily on photo text, so every numeric finding must
also pass a checksum or structural rule. They are exported standalone because
they are useful on their own:

```ts
import { luhn, cardNetwork, validSsn, parseTd3, mrzCheckDigit } from '@filestrip/sentinel'

luhn('4111111111111111')       // true  — mod-10
cardNetwork('378282246310005') // 'American Express'
validSsn('666-45-6789')        // false — area 666 is never issued
mrzCheckDigit('L898902C3')     // 6     — 7-3-1 weighting
parseTd3([line1, line2])       // TD3 passport MRZ with check digits
```

`validSsn` enforces the real SSA rules: area cannot be 000, 666, or 900+, and
neither the group nor the serial can be zero. That removes most random 9-digit
matches.

## Layout inference

```ts
import { scanLayout } from '@filestrip/sentinel'

scanLayout(1586, 1000)  // ID-1 card proportions, ~1.586:1
```

This is a weak signal by design and capped low in confidence. A cropped card
photo lands near the ISO/IEC 7810 ratio, which is worth flagging but cannot
confirm a document. OCR evidence dominates the final score, and independent
signals agreeing raise confidence rather than replacing it.

## Optional backends

| Function | Backend |
| --- | --- |
| `tesseractAdapter(opts)` | `tesseract.js` WASM OCR |
| `customOcrAdapter(fn)` | Any OCR you supply |
| `nativeFaceAdapter()` | Platform `FaceDetector`; `null` when unavailable |
| `customFaceAdapter(fn)` | MediaPipe, ONNX, or your own detector |

Self-host the tesseract worker, core, and traineddata files; left unset,
`tesseract.js` fetches them from a CDN and breaks the offline guarantee.

Without OCR, layout and face detection still run and the report sets
`ocrAvailable: false` rather than implying the image is clean. Same for
`faceDetectionUnavailable` — the Shape Detection API is gated in some browsers.
