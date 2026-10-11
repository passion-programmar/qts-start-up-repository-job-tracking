# Resume template flow and PDF download fix

- **Version:** 1.2.0
- **Date:** 2026-10-11
- **Change type:** Fixed

## Changes

- Replaced fixed-height FlowCV pages and forced page breaks with content-driven
  pagination, removing large empty areas when a page has less content.
- Set summary, skills, contact details, experience, and education body text to
  a consistent 18 px, overriding smaller sizes specified by the source
  template. Kept work and education entries together when they fit on a page.
- Increased the resume name by 3 px and centered it in the header; reduced
  contact detail text by 2 px while leaving its icons and the job title intact.
- Sized the live preview from the rendered resume content rather than the
  iframe's initial viewport.
- Removed stale page-continuation bullet fragments from the source resume so
  only the user's edited content appears in the preview and download.
- Removed the original page-edge padding from the flowing content containers,
  preventing doubled top and bottom margins between experience and education.
- Included the dynamically loaded Puppeteer, Chromium, and runtime dependency
  packages in the API deployment bundle so PDF generation can launch its
  renderer in production.
