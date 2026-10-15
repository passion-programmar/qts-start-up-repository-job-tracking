# Scanner prompt management

- **Version:** 1.2.0
- **Date:** 2026-10-15
- **Change type:** Added

## Changes

- Added a Super-only prompt library and per-Manager Scanner prompt assignments.
  Prompts can be shared; Managers without an assignment use the built-in
  ChatGPT instructions.
- Super can edit the global default Scanner instructions used by Managers who
  do not have an assigned prompt. Manager-specific assignments still take
  precedence.
- The extension includes the assigned prompt with the QTS task package
  contract. Resume experience keyword emphasis is rendered in generated PDFs.
- See [deployment guidance](../DEPLOY.md) and the
  [end-to-end workflow](../docs/PROJECT-FEATURES-AND-FLOW.md).
