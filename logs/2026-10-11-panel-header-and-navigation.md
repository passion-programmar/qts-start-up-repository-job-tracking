# Ant Design-style panel header and navigation

- **Version:** 1.2.0
- **Date:** 2026-10-11
- **Change type:** Improved

## Changes

- Restyled the shared panel header and menu button with an Ant Design-inspired
  white surface, subtle border and shadow, and blue interaction states.
- Moved the mode-specific QTS logo into the header beside the menu toggle and
  removed the duplicate logo from the navigation drawer.
- Removed the redundant resume-download helper sentence from the Manager PDFs
  page.
- Keep the navigation drawer hidden when a user opens a page at every viewport
  size; the header toggle opens and closes it on demand.
- Keep the header toggle accessible while the drawer is open, and preserve
  backdrop and close-button dismissal.
