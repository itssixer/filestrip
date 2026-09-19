# Contributing

## Setup

```sh
git clone https://github.com/itssixer/filestrip.git
cd filestrip
npm install
npm test
npm run dev
```

Demo is at `http://127.0.0.1:5173`. Packages build with `tsc --build`; the site is esbuild.

## Rules

1. `@filestrip/core` has zero dependencies. If you need one, it goes somewhere else.
2. No DOM in core except `src/browser.ts`. Workers have to load this package.
3. Don't break the image. Drop metadata containers, leave scan data / IDAT / VP8 alone.
4. `inspect` is for the UI. `sanitize` is what the Worker runs. Don't gate R2 writes on a client check.

## Formats

Add a module under `packages/core/src` that can sanitize and inspect the container. Hook it up in `sniff()`, `sanitize.ts`, and `inspect.ts`. Tests go in `packages/core/test` — build a tiny fixture in memory, assert the metadata is gone and the image payload is still there.

## Tests

```sh
npm test
```

Plain `node:test`. No extra runner.

## Style

Match the file you're in. Two spaces, no semicolons, single quotes. Comment only when the code doesn't already say it.

## PRs

One change per PR. Parser / sanitizer changes need a test. Call out public API changes in the description.

## Security

Don't file vulns as public issues. See [SECURITY.md](SECURITY.md).
