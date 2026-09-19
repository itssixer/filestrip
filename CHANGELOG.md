# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org).

## [Unreleased]

## [1.0.0]

TypeScript monorepo. Browser demo plus Workers / R2 helpers.

### Added

- `@filestrip/vision` — off-thread explicit-content classification and local
  perceptual hashing (dHash, 64-bit pHash, 256-bit PDQ-style) using
  `OffscreenCanvas` in a Web Worker. Pluggable ONNX and TensorFlow.js adapters;
  no model weights are bundled.
- `@filestrip/sentinel` — identity-document, payment-card, SSN, address, and
  face detection. Every numeric finding is checksum-validated (Luhn, SSA
  structural rules, TD3 MRZ check digits) and all previews are redacted.
  Optional WASM OCR through `tesseract.js`.
- `@filestrip/sdk` — unified client for React, Astro, and vanilla JS, with a
  `useFilestrip()` hook and Astro request handlers.
- `@filestrip/core`: appended EOF payload detection that identifies ZIP, RAR,
  7z, gzip, PE, ELF, and PDF signatures by name; ICC and colour-space marker
  stripping; itemized scrub summaries; `crypto`-random `fs_` filenames.
- `@filestrip/worker`: `putKV`, `withFilestrip` for plain Workers handlers,
  request size limits with `413`, and `415` rejection for unsupported media.
- Demo app rebuilt with an instant Sanitize flow and a deep Inspect panel
  covering content safety, exposure index, telemetry, and ghost thumbnails.
- Cloudflare Worker + R2 example with an optional KV audit trail.
- Cloudflare Pages `wrangler.toml` with `pages_build_output_dir = "apps/web/dist"`.
- Vision and SDK unit tests for perceptual hashes, safety ratings, and scrub headlines.
- CI now enforces architectural constraints: core stays dependency-free, core
  stays free of DOM globals outside `browser.ts`, and the vision Worker bundle
  cannot be silently tree-shaken away.

### Changed

- Entire codebase migrated to strict TypeScript with project references.
- `randomName()` now maps format names to canonical extensions, so `jpeg`
  produces `.jpg` rather than `.jpeg`.
- Auto-blur requires a loaded classifier model. The colour heuristic
  false-positives on warm-toned photos, so it no longer triggers a blur.
- The demo app moved to `apps/web` and builds with esbuild for Cloudflare Pages.

### Removed

- `@filestrip/react` and `@filestrip/astro`, both superseded by
  `@filestrip/sdk` subpath exports.

## [0.1.0]

Initial release.

### Added

- `@filestrip/core` — dependency-free `sanitize()` and `inspect()` for JPEG,
  PNG, and WebP, plus a browser entry point with canvas re-encoding.
- `@filestrip/worker` — `putR2()` and Hono middleware.
- `@filestrip/react` and `@filestrip/astro` framework bindings.
- Demo app with Sanitize and Inspect modes.
- Documentation: API reference, Workers guide, integrations, and a zero-trust
  edge write-up.

[Unreleased]: https://github.com/itssixer/filestrip/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/itssixer/filestrip/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/itssixer/filestrip/releases/tag/v0.1.0
