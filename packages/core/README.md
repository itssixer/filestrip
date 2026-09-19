# @filestrip/core

Zero-dependency EXIF / IPTC / XMP purge and inspect for JPEG, PNG, and WebP.

Runs in browsers, Node 20+, and Cloudflare Workers. No canvas, no WASM — it
walks the container instead of decoding pixels.

```sh
npm install @filestrip/core
```

## Purge

```ts
import { sanitize } from '@filestrip/core'

const out = sanitize(bytes)
out.bytes          // cleaned container
out.changed        // true when anything was dropped
out.exifTags       // 18
out.trailingBytes  // 0
out.summary        // ['18 EXIF tags', 'GPS telemetry', 'randomized filename']
```

Idempotent: purging an already-clean file reports `changed: false` and returns
identical bytes.

## Inspect

```ts
import { inspect } from '@filestrip/core'

const report = inspect(bytes)
report.level           // 'Low' | 'Caution' | 'Critical'
report.gps             // { lat, lon } | null
report.ghostThumbnail  // { width, height, bytes } | null
report.vectors         // per-vector findings
```

Read-only. Never modifies the input.

## Browser entry

```ts
import { purgeFile } from '@filestrip/core/browser'

const clean = await purgeFile(file)
clean.blob  // ready to upload
clean.name  // 'fs_9a8f12.png'
```

`reencode` defaults to `'auto'`: PNG and WebP are redrawn through a canvas
(lossless, and it discards anything in non-standard blocks) while JPEG is left
alone to avoid generational quality loss.

## What gets removed

| Format | Stripped |
| --- | --- |
| JPEG | APP1 (EXIF/XMP), APP2 (ICC), APP13 (IPTC), APP14 (Adobe), APP3–APP12, COM, everything after EOI |
| PNG | `tEXt`, `zTXt`, `iTXt`, `eXIf`, `tIME`, `iCCP`, `sRGB`, `gAMA`, `cHRM`, `dSIG`, everything after IEND |
| WebP | `EXIF`, `XMP `, `ICCP`, VP8X metadata flags, everything past the RIFF length |

Image data is preserved. Appended ZIP, RAR, 7z, gzip, PE, ELF, and PDF payloads
are identified by signature and named in the summary.

Unsupported formats pass through unchanged with `changed: false` — the engine
will not claim to have cleaned something it cannot parse. Gate on `sniff()`.

Full reference: [docs/api.md](https://github.com/itssixer/filestrip/blob/main/docs/api.md)
