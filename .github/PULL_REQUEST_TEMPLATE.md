## What this changes

<!-- Behavior, not a file list. -->

## Why

<!-- Bug or upload-safety gap. Link the issue if there is one. -->

## Checklist

- [ ] `npm test` passes
- [ ] `@filestrip/core` still has no runtime dependencies
- [ ] No DOM in `packages/core/src` outside `browser.ts`
- [ ] Sanitizer / parser changes have an in-memory fixture test
- [ ] Public API changes are in `docs/api.md`
