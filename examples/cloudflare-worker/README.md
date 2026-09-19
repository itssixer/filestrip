# Cloudflare Worker + R2 example

Sanitizes image uploads at the edge, then stores only the cleaned bytes in R2.

## Why this shape

The Worker is the trust boundary. A browser can be bypassed with a single
`curl`, so `putR2` sanitizes on every write. Original bytes are never stored.
Object keys are random.

Workers have no DOM canvas, and the core purge does not need one: it walks the
JPEG, PNG, and WebP container structures and drops the metadata segments.

## Setup

```sh
npm install
npx wrangler r2 bucket create filestrip-media
```

Optionally create the audit namespace and paste its id into `wrangler.toml`:

```sh
npx wrangler kv namespace create AUDIT
```

If you skip it, delete the `kv_namespaces` block — the audit write is optional.

## Run

```sh
npm run dev
```

## Try it

```sh
# Raw upload, returns the random key and what was scrubbed
curl -X PUT --data-binary @photo.jpg \
  -H 'content-type: image/jpeg' \
  http://localhost:8787/upload

# Multipart upload
curl -F 'file=@photo.jpg' http://localhost:8787/upload-form

# Telemetry only, stores nothing
curl -X POST --data-binary @photo.jpg http://localhost:8787/inspect
```

A response from `/upload` looks like:

```json
{
  "key": "fs_9a8f12.jpg",
  "type": "image/jpeg",
  "format": "jpeg",
  "changed": true,
  "bytes": 184320,
  "exifTags": 18,
  "trailingBytes": 0,
  "summary": ["18 EXIF tags", "GPS telemetry", "camera and lens serial numbers", "randomized filename"]
}
```

## Deploy

```sh
npm run deploy
```
