# Direct resume PDF downloads

- **Version:** 1.2.0
- **Date:** 2026-10-10
- **Change type:** Improved

## Changes

- Updated the QTS resume template to download its generated PDF directly
  instead of opening the browser print dialog.
- Use the same download flow for every resume template and keep live-preview
  errors separate from PDF generation errors.
- Added an optional folder picker that saves PDFs under an organized
  `$_QTS_RESUME_$/Custom/...` directory inside the selected folder. Without a
  selected folder, downloads continue to use the browser's normal Downloads
  location.
- Changed QTS PDF generation to render the same self-contained FlowCV HTML,
  CSS, and fonts used by the live preview.
- Preserved the FlowCV contact rows' original flex layout when applying
  populated contact values, keeping the contact icons beside their labels in
  both the preview and generated PDF; empty contact rows remain hidden.
- Disabled print-time animations and preserved exact colors so section icons
  are fully opaque and match the live preview.
