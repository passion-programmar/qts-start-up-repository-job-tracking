# Application template discovery and review

- **Version:** 1.2.0
- **Date:** 2026-10-10
- **Change type:** Added

## Changes

- Added bounded, read-only multi-step discovery checkpoints that retain
  structural field and observed-transition metadata without capturing entered
  field values or activating detected controls.
- Added persisted site-template drafts, discovery save/reuse APIs, validation
  reports, and a Super-only review screen. Promotion requires distinct observed
  steps, reviewed stable field mappings, and explicit safety attestations.
- Added API integration and validation tests for template persistence and
  promotion rules. Saved evidence does not independently verify a live site or
  authorize form filling; see [the current system guide](../docs/CURRENT-SYSTEM.md).
