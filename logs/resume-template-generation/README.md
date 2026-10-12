# Generating resume templates from downloaded designs

Use this workflow when adding a resume design from a downloaded HTML export,
PDF, or other source. The goal is to preserve the design while binding it to
the project's shared resume data and download flow.

## Current implementation

- `admin-web/src/components/ManagerPdfsView.tsx` registers the template ID,
  label, sample resume data, and preview/download behavior.
- `admin-web/src/components/QtsResumePreview.tsx` adapts the FlowCV HTML to the
  shared resume document, embeds CSS and fonts, and prepares print output.
- `admin-web/src/components/QtsResume2Preview.tsx` and
  `admin-web/src/components/QtsResume3Preview.tsx` provide separate,
  self-contained renderers for QTS Resume 2 and the independently designed
  QTS Resume 3 template.
- `admin-web/public/flowcv-resume-structure.html` and
  `admin-web/public/flowcv-assets/` contain the local FlowCV structure and CSS.
- `server/src/modules/new-schema/resume-pdfs.routes.ts` validates the template
  ID and selects the HTML renderer or the PDFKit renderer.
- `server/src/services/flowcv-html-pdf.ts` renders self-contained HTML with
  Chromium. `server/src/services/application-document-pdf.ts` renders the
  classic and compact PDFKit templates.

Treat these paths as examples of the current implementation, not as a
requirement to put every future template in the FlowCV component.

## Repeatable workflow

1. **Keep the source safe.** Preserve the original download outside tracked
   source files while working. Record its provider, source format, retrieval
   date, and applicable license or permission. Do not commit source documents
   containing personal resume information or assets you are not allowed to
   redistribute.
2. **Inspect before importing.** Identify page dimensions, margins, fonts,
   colors, icons, section order, page breaks, and all referenced images,
   stylesheets, scripts, and remote resources. Prefer an HTML/design export
   with its assets when it is available. A PDF can be a visual reference, but
   it does not by itself provide clean, editable template structure.
3. **Make a local, self-contained template.** Keep only the markup, styles,
   fonts, and images the design needs. Remove scripts, tracking, forms, and
   unnecessary content. Bundle permitted assets locally; do not make PDF
   generation depend on remote fonts, images, or stylesheets.
4. **Map to the shared resume shape.** Use
   `server/src/modules/document-builder/document.schemas.ts` as the canonical
   field contract. Map candidate contact details, headline, summary, section
   headings, entries, dates, and bullets explicitly. Handle optional or
   missing fields, extra entries, and long text without leaving stale sample
   content or breaking the page layout.
5. **Choose the renderer deliberately.** Use the HTML/Chromium path when visual
   fidelity to a supplied design is important. Use PDFKit for a programmatic
   layout that should adapt naturally to content. If adding another HTML
   template, add its ID to the web and API template types, register its
   renderer, and keep its assets and preview mapping together. If using
   PDFKit, add its layout to the shared PDF service and select it in the API.
6. **Wire every UI surface.** Register the template ID and label in
   `ManagerPdfsView.tsx`, provide an independent editable sample-data copy,
   and connect preview readiness, error handling, and download behavior. Do
   not make the UI selector claim to support a template until the API accepts
   and renders that same ID.
7. **Keep editing responsive.** Update the loaded preview document in place
    when valid JSON changes; avoid reloading the iframe for each edit. Rebuild
    pagination and the downloadable HTML from the updated preview.
8. **Compare preview and output.** Check the first, middle, and last pages at
   normal zoom. Verify page size, margins, page breaks, font loading, icons and
   colors, contact alignment, long names/headlines, missing optional fields,
   and content overflow. Extract PDF text to confirm that all expected content
   appears once and in the right order. Check for blank pages and print-time
   animation or color changes.
9. **Validate and record.** Run the focused web lint and API type-check, then
   exercise the preview-to-download flow locally. Use non-personal fixture
   content in repeatable tests. Add a dated feature-log entry with the project
   version, template ID, source format/provenance, renderer, and material
   changes; add ongoing updates to this folder's history below.

## Checklist for each template

- [ ] Source provenance and reuse permission are understood.
- [ ] Only required, permitted assets are included; no source resume PII is committed.
- [ ] The template maps to the shared resume schema and has no stale sample content.
- [ ] UI selector, editable sample data, preview, API validation, and renderer agree on one template ID.
- [ ] Optional values, long text, multiple entries, and page overflow are handled.
- [ ] Preview and downloaded PDF have matching fonts, colors, icons, spacing, and page breaks.
- [ ] Focused lint/type-check and local PDF text/page checks pass.
- [ ] The dated history entry and this folder's index are updated.

## History

- [2026-10-10 — First downloaded FlowCV resume template](2026-10-10.md)
- [2026-10-11 — QTS Resume 3 template](2026-10-11-qts-resume-3-template.md)

## Reusable request

> Add a resume template using the downloaded design in my local source folder.
> Follow `logs/resume-template-generation/README.md`: inspect the source and
> its reuse rights, implement only a design whose reuse is permitted (or create
> a distinct original design when permission is unclear), use locally bundled
> permitted assets,
> map it to the shared resume schema, wire preview and PDF download under a
> new template ID, compare the preview and generated PDF, run focused checks,
> and add a dated feature log without committing source documents or personal
> resume data.
