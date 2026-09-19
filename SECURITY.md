# Security Policy

## Supported versions

Fixes go to the latest `1.x` of each package.

| Package | Supported |
| --- | --- |
| `@filestrip/core` | latest `1.x` |
| `@filestrip/worker` | latest `1.x` |
| `@filestrip/sdk` | latest `1.x` |
| `@filestrip/vision` | latest `1.x` |
| `@filestrip/sentinel` | latest `1.x` |

## Reporting

Use [GitHub Security Advisories](https://github.com/itssixer/filestrip/security/advisories/new). Don't open a public issue.

Include:

- Package and version
- A small file or request that reproduces it
- What survived `sanitize()`, or what the parser did

We'll reply within 72 hours.

## In scope

- GPS, serials, or IFD1 thumbnails left behind by `sanitize()` on a supported format
- A crafted image that hangs, crashes, or blows memory
- `inspect()` returning `Low` when the file still has severe identifiers
- Worker middleware forwarding the original body instead of the scrubbed one

## Out of scope

- Formats we don't claim to support. Unknown bytes pass through; reject them in your handler.
- Steganography, watermarks, sensor noise. This project strips metadata, not pixels.
- Filenames and URLs in *your* app. Use `randomName()` or random object keys.

## Threat model

`@filestrip/core` walks the container. It does not decode pixels or execute anything in the file. The browser is not the trust boundary — run `sanitize()` again in the Worker that owns the bucket.
