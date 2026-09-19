# How to build zero-trust image sanitization at the edge

Client-side EXIF stripping is a feature, not a control. Anyone can `curl` a
raw JPEG full of home GPS coordinates straight at your upload endpoint.

Treat the Worker as the trust boundary.

## 1. Never store the bytes you were given

Read the body, run `sanitize` from `@filestrip/core`, put the returned `bytes` in R2. Drop the original buffer. If you need a checksum, hash the sanitized object.

## 2. Prefer container stripping on Workers

Workers have no DOM canvas. Re-encoding pixels means WASM or the Images API. For GPS, serials, IPTC, XMP, and thumbnails, walking the container is enough:

- JPEG: drop APP1 / APP13 / COM
- PNG: drop tEXt / eXIf / tIME
- WebP: drop EXIF / XMP chunks

`@filestrip/core` does this with no dependencies.

## 3. Inspect is for people; sanitize is for storage

`inspect` is how you show someone their file still has a home coordinate. `sanitize` is what the PUT handler runs. Don't gate R2 writes on the inspect UI.

## 4. Randomize object keys

`IMG_4401_beach-house.jpg` still leaks after EXIF is gone. `putR2(env.MEDIA, '', body, { randomKey: true })` is the default.

## 5. Do it twice

Optional: `sanitize` in the browser so the user downloads a clean copy. Required: `sanitize` again in the Worker that owns the bucket.

That's the whole design. Libraries, not a hosted filter.
