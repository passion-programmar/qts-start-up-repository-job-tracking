# Direct resume PDF downloads

- **Version:** 1.3.0
- **Date:** 2026-10-11
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
- Let users choose any folder, with Music as the picker's starting location,
  and save the selected directory handle in IndexedDB for reuse. Request
  persistent browser storage to reduce automatic eviction risk and provide a
  reconnect action when folder permission needs renewal. Clearing site data can
  still remove the saved handle.
- Changed QTS PDF generation to render the same self-contained FlowCV HTML,
  CSS, and fonts used by the live preview.
- Preserved the FlowCV contact rows' original flex layout when applying
  populated contact values, keeping the contact icons beside their labels in
  both the preview and generated PDF; empty contact rows remain hidden.
- Disabled print-time animations and preserved exact colors so section icons
  are fully opaque and match the live preview.
