# QTS Resume 2 template

- **Version:** 1.2.0
- **Date:** 2026-10-11
- **Change type:** Added

## Changes

- Added a separate live QTS Resume 2 template based on the supplied Template 2
  reference, keeping the existing QTS Resume 1 structure unchanged.
- Matched the reference's 215.9 × 279.4 mm letter page and measured typography:
  13 pt body, 15 pt subtitle, 16 pt section headings, and 30 pt name.
- Kept preview and PDF output aligned by sending the rendered Template 2 HTML
  through the existing PDF renderer.

## Pagination correction

- **Version:** 1.2.0
- **Date:** 2026-10-11
- **Change type:** Fixed

### Changes

- Fixed long resumes moving the first content block off the header page by
  counting only blocks already placed on the current page.

## Contact details and live editing

- **Version:** 1.2.0
- **Date:** 2026-10-11
- **Change type:** Improved

### Changes

- Removed contact icons and added FlowCV-style bullet separators between
  location, email, and phone details for consistent preview and PDF output.
- Clarified that valid JSON changes update the live resume immediately and that
  skills and experience entries are arrays under each section's `items`.
- Added a second sample experience entry to demonstrate rendering multiple
  items from an array.

## Live JSON preview updates

- **Version:** 1.2.0
- **Date:** 2026-10-11
- **Change type:** Improved

### Changes

- Kept the preview iframe loaded while valid JSON edits update and repaginate
  its resume content in place, matching QTS Resume 1's editing behavior.
- Browser-verified long-to-short edits refresh all content and pagination
  without navigating the preview iframe.
