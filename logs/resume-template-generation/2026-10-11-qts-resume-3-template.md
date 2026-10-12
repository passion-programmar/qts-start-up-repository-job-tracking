# QTS Resume 3 template

- **Version:** 1.2.0
- **Date:** 2026-10-11
- **Change type:** Added

## Template record

- **Template ID:** `qts_resume_3`
- **Reference:** User-provided FlowCV HTML export in the local `QTS_Resume_3`
  folder, used only to understand the requested page size and resume content.
  FlowCV's [terms of service](https://flowcv.com/terms-of-service) identify its
  content as its intellectual property; permission to reproduce the template
  was not established.
- **Design:** Independently authored QTS layout. No FlowCV markup, styles,
  images, scripts, or personal resume data are copied into the project.
- **Renderer:** Self-contained HTML rendered to PDF with Chromium; preview and
  PDF use the same rendered document.
- **Assets:** System fonts and CSS only; no external or bundled third-party
  design assets.

## Changes

- Added a distinct QTS Resume 3 option and fictional editable sample mapped to
  the shared resume data, including multiple experience, education, project,
  and skill entries.
- Added an original US Letter design with a left-aligned navy header, teal
  accents, clean system sans-serif typography, shaded section labels, and
  structured entry/date styling.
- Added a compact running header to continuation pages. No external fonts or
  remote resources are needed at runtime.
- Wired the live preview, API validation, and PDF download to the QTS Resume 3
  template ID while leaving existing template IDs and renderers separate.
- Kept the preview frame loaded while JSON edits update the resume content and
  pagination in place, matching QTS Resume 1's live editing behavior.
- Browser-verified long-to-short edits refresh all content and pagination
  without navigating the preview iframe.

## Independent design update

- **Version:** 1.2.0
- **Date:** 2026-10-11
- **Change type:** Modified

### Changes

- Replaced the close FlowCV-style recreation with an independently authored
  layout after confirming that permission to reproduce FlowCV's template was
  not established by its terms.
- Removed the unused Crimson Text font files and license copy; Template 3 now
  uses only system fonts and original CSS.
- Retained the supplied export only as a local reference; it is not included in
  the project.

### Validation

- [x] Focused web lint and production build pass.
- [x] API type-check passes.
- [x] Preview and generated PDF match across first, middle, and last pages.
- [x] Multi-page fictional content appears in the PDF without blank pages.
- Repository-wide lint still reports 13 errors in files outside the changed
  resume preview components.
- The four-page fictional preview and PDF use US Letter dimensions; expected
  text is present, with no overflow or blank pages.
