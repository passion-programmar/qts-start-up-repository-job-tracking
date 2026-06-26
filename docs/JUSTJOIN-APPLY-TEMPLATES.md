# justjoin.it Apply Templates

The extension uses **apply templates** on justjoin.it — one strategy per apply flow type. Templates are registered in code and selected automatically by URL + page state.

## Architecture

```
job-offer page
  → template-registry.js (match template)
  → justjoin-apply.js (platform adapter, delegates hooks)
  → application-discovery.js (click Apply, scan, preview)
  → form-scan.js (collect fields as on page)
```

## Registered templates

| Template ID | Name | When used | Guest apply |
|-------------|------|-----------|-------------|
| `justjoin_easy_apply` | justjoin Easy Apply | `justjoin.it/job-offer/*` native modal | Yes |
| `justjoin_external_apply` | justjoin External Apply | Apply `<a>` leaves justjoin.it | N/A — open external page |

**Priority:** External Apply (200) wins over Easy Apply (100) when an off-site Apply link is detected.

## justjoin Easy Apply

**Example:** [Team Connect — Senior Cloud Platform Engineer](https://justjoin.it/job-offer/team-connect-senior-cloud-platform-engineer-warszawa-devops)

- No justjoin.it login — bidder opens job page, clicks Apply
- Modal fields: name, email, CV upload, message toggle, terms, GDPR, marketing
- Preview scans form **as-is** (checkboxes unchecked, toggle off)
- Dynamic message field expands only on fill (`expandDynamicOnFill: true`)

### Expected fields

| ID | Label | Type | Required |
|----|-------|------|----------|
| `name` | First and last name | text | yes |
| `email` | Email | text/email | yes |
| `resume` | Add document | file | yes |
| `cover_toggle` | Attach a message | switch/checkbox | no |
| `terms` | Terms of Service | checkbox | yes |
| `gdpr` | GDPR consent | checkbox | yes |
| `marketing` | Marketing opt-in | checkbox | no |

### Confirm & fill policy (justjoin Easy Apply)

On **Confirm & fill form**, the extension auto-fills only verified profile fields:

| Field | Auto-fill |
|-------|-----------|
| `name` | Yes — from selected candidate |
| `email` | Yes — from selected candidate |
| `resume` | No — deferred to Custom GPT (PDF upload after package is ready) |
| `terms`, `gdpr` | No — bidder must check manually |
| `marketing` | No — bidder must decide manually (unchecked by default) |
| `cover_toggle` / message | No — human review |

Human-review fields (terms, GDPR, marketing, cover message) are never filled from GPT `remainingFields`.

When a supported job page loads, the extension inspects **URL + DOM structure** and picks a template before Start Application:

```
tab complete / SPA navigation
  → detectApplyTemplateOnTab() (service worker)
  → inject template scripts
  → __detectApplyTemplateOnPage()
      → detectExternalApplyLink? → justjoin External Apply
      → else job-offer + Apply button? → justjoin Easy Apply
  → store per tab in session storage
  → popup shows "Apply template" in job summary
```

### Detection signals (justjoin Easy Apply)

| Signal | Meaning |
|--------|---------|
| `jobOfferUrl` | URL matches `justjoin.it/job-offer/*` |
| `nativeApplyButton` | In-page Apply button (not external href) |
| `summaryApplyPanel` | Apply control in job summary sidebar |
| `modalOpen` | Application modal already visible |
| `applyModalInputs` | Modal contains file + email inputs |

External Apply wins when an off-site Apply `<a href>` is found (priority 200 vs 100).

## Adding a new justjoin template

1. Create `extension/content/platforms/templates/justjoin-<name>.js`
2. Call `__qtsTemplateRegistry.registerTemplate({ id, platform: 'justjoin', detect, discovery, hooks, ... })`
3. Add the file to `injectFormScan()` in `service-worker.js` (after registry, before `justjoin-apply.js`)
4. Set `priority` higher than templates it should win over
5. Implement `detect(context)` returning a score (0 = no match)

### Template object shape

```javascript
{
  id: 'justjoin_my_flow',
  platform: 'justjoin',
  name: 'Human-readable name',
  priority: 110,
  urlPatterns: [/^https:\/\/(www\.)?justjoin\.it\/job-offer\//i],
  detect(context) { return score; },
  discovery: {
    openApplyForm: true,
    expandDynamicOnPreview: false,
    postApplyWaitMs: 1200,
    scanPollMs: 6000,
  },
  expectedFields: [ /* optional validation */ ],
  hooks: {
    scoreApplyButton,
    getApplicationScanRoots,
    revealDynamicFields,
    buildWarnings,
  },
}
```

## Key files

| File | Role |
|------|------|
| `extension/content/platforms/templates/template-registry.js` | Registry + field validation |
| `extension/content/platforms/templates/justjoin-easy-apply.js` | Easy Apply template |
| `extension/content/platforms/templates/justjoin-external-apply.js` | External redirect template |
| `extension/content/platforms/justjoin-apply.js` | Platform adapter + template resolution |
