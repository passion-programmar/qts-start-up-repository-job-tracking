# Retiring Workable application automation

- **Version:** 1.2.0
- **Date:** 2026-10-10
- **Change type:** Modified

## Changes

- Removed the Workable application handler, injected form script, and Manager
  Apply queue while retaining Workable job-posting capture, manual tracking,
  and read-only discovery.
- Blocked Workable application claims, application context, and GPT tasks in
  the API, and guarded extension form-fill and GPT-package entry points.
- Added integration coverage confirming Workable rows stay unclaimed and
  supported non-Workable jobs can still be claimed. See
  [the current system guide](../docs/CURRENT-SYSTEM.md).

## Verification

- **Verified:** 2026-10-12
- `node --test extension/shared/application-flow.test.js` — 5 tests passed,
  including the Workable autofill guard.
- `node --test server/dist/modules/new-schema/jobs.routes.workable-disabled.integration.test.js`
  — API integration test passed.
- `npm run check --prefix server` — TypeScript check passed.
