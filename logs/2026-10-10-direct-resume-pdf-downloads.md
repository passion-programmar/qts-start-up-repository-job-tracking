# Direct resume PDF downloads

- **Version:** 1.5.0
- **Date:** 2026-10-11
- **Change type:** Improved

## Changes

- Updated the QTS resume template to download its generated PDF directly
  instead of opening the browser print dialog.
- Use the same download flow for every resume template and keep live-preview
  errors separate from PDF generation errors.
- Added an optional folder picker that saves PDFs under an organized
  `$_QTS_Resume_$/...` directory inside the selected folder. Without a selected
  folder, downloads continue to use the browser's normal Downloads location.
- Let users choose any folder, with Music as the picker's starting location,
  and save the selected directory handle in IndexedDB for reuse. Request
  persistent browser storage to reduce automatic eviction risk and provide a
  reconnect action when folder permission needs renewal. Clearing site data can
  still remove the saved handle.
- Name the top-level generated folder `$_QTS_Resume_$` instead of `Custom`.
- Match pasted resume or cover-letter `candidate.fullName` values to the
  Manager's Accounts, automatically select the matching Account, and load its
  saved default resume template. Allow manual Account selection when the name
  has no unique match.
- Persist each Account's preferred resume template in its application profile.
- Add a Manager cover-letter JSON preview and PDF download using the QTS
  standard cover-letter style, saved under `$_QTS_Cover_Letter_$`.
- Changed QTS PDF generation to render the same self-contained FlowCV HTML,
  CSS, and fonts used by the live preview.
- Preserved the FlowCV contact rows' original flex layout when applying
  populated contact values, keeping the contact icons beside their labels in
  both the preview and generated PDF; empty contact rows remain hidden.
- Disabled print-time animations and preserved exact colors so section icons
  are fully opaque and match the live preview.

## Version 1.6.0 — Account application PDF bundles

- **Date:** 2026-10-11
- **Change type:** Improved

### Changes

- Assign resume and cover-letter PDF templates in Account settings; the
  generation flow uses those saved assignments without template overrides.
- Require matching Account names and generate the resume and cover letter
  together into the same timestamped Account/job folder.
- Name files from the Account: `Alex Morgan.pdf` and
  `Alex_Morgan_Cover_Letter.pdf`.
- Require access to the selected local folder and check existing job folders
  by normalized title/company before saving; refuse duplicate applications
  rather than overwrite existing documents.
- Remove a newly created job folder if either PDF write fails, avoiding a
  partial application bundle.

## Version 1.7.0 — Unified application JSON input

- **Date:** 2026-10-12
- **Change type:** Improved

### Changes

- Replace separate resume and cover-letter JSON inputs with one application
  object containing shared `candidate` and `job` details plus `resume` and
  `coverLetter` content.
- Build both renderer payloads from the shared candidate and job fields so
  names, role, and company stay consistent across the generated PDFs.
