# Scanner validation evidence persistence

- **Version:** 1.2.0
- **Date:** 2026-10-16
- **Change type:** Fixed

## Changes

- Accepted captured input-validation constraints in saved Scanner evidence so
  the second-capture checkpoint is not rejected by the strict template API
  schema.
- Raised the accepted native length-constraint range to match browser input
  limits, and included safe field-path details in template validation errors
  instead of returning only a generic message.
- Accepted and regression-tested the Manager-confirmed field-identity flag in
  strict Scanner rule snapshots.
- Aligned saved Manager-rule and GPT page-context validation schemas with the
  browser's supported maximum-length range and tested a native `maxLength` of
  524288 through both API paths.
