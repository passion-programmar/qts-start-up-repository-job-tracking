# Resume template flow and PDF download fix

- **Version:** 1.2.0
- **Date:** 2026-10-11
- **Change type:** Fixed

## Changes

- Replaced fixed-height FlowCV pages and forced page breaks with content-driven
  pagination, removing large empty areas when a page has less content.
- Increased the template body text slightly to 11 pt and kept work and education
  entries together when they fit on a page.
- Sized the live preview from the rendered resume content rather than the
  iframe's initial viewport.
- Removed stale page-continuation bullet fragments from the source resume so
  only the user's edited content appears in the preview and download.
- Included the dynamically loaded Puppeteer, Chromium, and runtime dependency
  packages in the API deployment bundle so PDF generation can launch its
  renderer in production.
