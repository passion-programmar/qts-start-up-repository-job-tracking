# Feature logs

This directory is the project’s feature-level change history. Keep entries
concise and focused on user-visible behavior or meaningful maintenance changes.

## Finding and adding entries

- Use `YYYY-MM-DD-feature-slug.md` for a small or one-off feature.
- For a feature with multiple substantial updates, use
  `logs/<feature-slug>/YYYY-MM-DD.md` to keep its history together.
- Link each new entry here so the index remains the starting point for browsing
  the logs.
- Record the project version from the root `package.json`. Use the version
  number as written there; feature logs do not change release versions.
- Use one change type per entry: **Added**, **Modified**, **Improved**, or
  **Fixed**. Split unrelated changes into separate entries.
- Do not repeat implementation details already maintained in guides or
  reference documentation; link to those documents when useful.

## When code changes

After a meaningful feature, fix, improvement, or other user-visible change:

1. Review the changes and group related work by feature.
2. Choose **Added**, **Modified**, **Improved**, or **Fixed** for each entry.
3. Read the current version from the root `package.json` and use the change
   date. Do not invent or increment a version for the log.
4. Create a dated entry using the naming convention above. For a substantial
   feature with ongoing updates, add the entry to that feature's subfolder.
5. Summarize the outcome and important behavior; link to existing documentation
   instead of repeating it.
6. Add the entry to **Entries** below. For an existing feature subfolder, add
   the dated entry to that feature's index.

You can ask for this directly after making a code change:

> Update the feature logs for the code changes in this work. Review the diff,
> group related changes by feature, use the root package version and today's
> date, create or update the appropriate Markdown entries and index, and do
> not change the project version.

## Entries

- [Scanner prompt management — 2026-10-15](2026-10-15-scanner-prompt-management.md)
- [Scanner capture reliability — 2026-10-11](2026-10-11-scanner-capture-reliability.md)
- [QTS Resume 2 template — 2026-10-11](2026-10-11-qts-resume-2-template.md)
- [QTS Resume 3 template — 2026-10-11](resume-template-generation/2026-10-11-qts-resume-3-template.md)
- [Modern sidebar navigation — 2026-10-11](2026-10-11-modern-sidebar-navigation.md)
- [Generating resume templates from downloaded designs](resume-template-generation/README.md)
- [Application template discovery and review — 2026-10-10](2026-10-10-application-template-discovery.md)
- [Retiring Workable application automation — 2026-10-10](2026-10-10-workable-application-removal.md)
- [Application profiles and resume PDFs — 2026-10-10](2026-10-10-application-profiles-and-resume-pdfs.md)
- [Direct resume PDF downloads — 2026-10-10](2026-10-10-direct-resume-pdf-downloads.md)
- [Super database browser — 2026-10-10](2026-10-10-super-database-browser.md)
- [Feature logging system — 2026-10-10](2026-10-10-feature-logging-system.md)
- [Collapsible desktop sidebar — 2026-10-10](2026-10-10-collapsible-desktop-sidebar.md)

## Entry format

```markdown
# <Feature name>

- **Version:** <root package version>
- **Date:** YYYY-MM-DD
- **Change type:** Added | Modified | Improved | Fixed

## Changes

- <Concise description of what changed and its user-visible effect>
```
