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
  `Custom/...` directory inside the user-selected folder.
  Without a selected folder, downloads continue to use the browser's normal
  Downloads location.
- Open the folder picker in Music by default, while allowing users to choose
  any local folder as the download destination.
- Save the chosen directory handle in IndexedDB so it can be restored when the
  browser still grants access. Show a reconnect action when permission must be
  renewed.
- Request persistent browser storage after folder selection to reduce automatic
  eviction risk, while making clear that manually clearing site data can still
  remove the saved handle.
- Changed QTS PDF generation to render the same self-contained FlowCV HTML,
  CSS, and fonts used by the live preview.
- Preserved the FlowCV contact rows' original flex layout when applying
  populated contact values, keeping the contact icons beside their labels in
  both the preview and generated PDF; empty contact rows remain hidden.
- Disabled print-time animations and preserved exact colors so section icons
  are fully opaque and match the live preview.
