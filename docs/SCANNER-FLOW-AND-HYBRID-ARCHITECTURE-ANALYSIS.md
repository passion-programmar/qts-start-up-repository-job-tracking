# Manager Scanner Flow and Hybrid Adapter Architecture Analysis

- **Analysis date:** 2026-10-15
- **Scope:** The current extension and API source in this checkout, including
  uncommitted working-tree changes. This is a source-code analysis, not a live
  ATS or production deployment verification.
- **Change scope at analysis time:** Documentation only. The follow-up
  implementation note below records Scanner validation changes made after
  this analysis.

## Executive summary

The current Manager Scanner is a **generic, deterministic visible-form scanner
with a small template/adapter extension point**, not a collection of ATS-specific
form implementations. It detects a handful of ATS names from the page URL,
but for Greenhouse, Lever, and Workable it still uses the same generic DOM
scanner and fill routine. Workday currently falls through to `generic`. The
only real form-flow adapter/template family presently wired into discovery is
for justjoin.it (including its easy-apply modal and external-apply redirect).

The proposed hybrid architecture is directionally sound and fits what the
project already has. I recommend evolving it as:

> **One generic scanner and safety/fill core; small, capability-oriented
> platform adapters for reliable discovery and interaction where generic DOM
> behavior is demonstrably insufficient; a shared normalized field/evidence
> contract across both.**

Do not create separate end-to-end autofill flows for each ATS. Keep the
Manager-confirmation, field-policy, validation, GPT, upload-review, fill
verification, and no-navigation/no-submit behavior in the common Scanner.
Adapters should provide narrowly scoped improvements such as finding the
correct application root, handling a known custom control, exposing a
supported question label, or waiting for an SPA step to settle. If an adapter
cannot confidently identify a control, the common flow should fall back to
generic read-only discovery or leave the field unresolved.

### Follow-up implementation: field validation and reusable answers

After this analysis, the Scanner was extended to capture native input type and
mode, browser constraints (range, step, pattern, and length), and page hints.
These properties are included in saved Manager field snapshots and GPT page
context. Reusable answers are checked against known constraints before filling;
invalid or uncertain reusable answers are passed to GPT as context together
with the observed requirements, not copied blindly. GPT-generated and
Manager-reviewed answers are validated again before fill, and the content
script verifies the browser retained the value. This does not eliminate
platform-specific validation or formatting gaps; uncertain cases remain
unresolved for Manager review rather than being treated as verified.

## What the current extension actually does

### Architecture at a glance

```text
Manager
  │
  ├─ Extension popup: login, Get JD, Account selection, Manager review
  │      │
  │      ├─ QTS API: save job / claim Account-specific processing row
  │      ├─ QTS API: load Manager's saved Scanner field rules
  │      └─ Service worker: inject generic scanner into the active job tab
  │                 │
  │                 ├─ Read-only field discovery and optional second capture
  │                 ├─ Manager-approved field strategy / answer review
  │                 └─ Verified fill of the current visible step only
  │
  └─ When generated answers/documents are needed:
         Popup → QTS API task/page context → ChatGPT in a background tab
                 → parsed package → QTS API → Manager review → current page fill
```

The main implementation is in:

| Concern | Main source |
|---|---|
| Scanner entry and Manager workflow | [`extension/popup/popup.js`](../extension/popup/popup.js) |
| Script injection, tab coordination, task handoff, and fill dispatch | [`extension/background/service-worker.js`](../extension/background/service-worker.js) |
| Visible form discovery and fill verification | [`extension/content/form-scan.js`](../extension/content/form-scan.js) |
| Flow and field evidence capture/reconciliation | [`extension/content/application-discovery.js`](../extension/content/application-discovery.js), [`extension/shared/scanner-capture.js`](../extension/shared/scanner-capture.js), [`extension/shared/application-flow.js`](../extension/shared/application-flow.js) |
| JustJoin adapter and templates | [`extension/content/platforms/justjoin-apply.js`](../extension/content/platforms/justjoin-apply.js), [`extension/content/platforms/templates/`](../extension/content/platforms/templates/) |
| ChatGPT request contract and parsing | [`extension/shared/scanner-chatgpt.js`](../extension/shared/scanner-chatgpt.js), [`extension/background/service-worker.js`](../extension/background/service-worker.js) |
| Saved Manager rules | [`server/src/modules/new-schema/manager-application-profile.routes.ts`](../server/src/modules/new-schema/manager-application-profile.routes.ts) |
| Job-scoped GPT task and answer package | [`server/src/modules/new-schema/gpt-application-tasks.routes.ts`](../server/src/modules/new-schema/gpt-application-tasks.routes.ts) |
| Existing product boundaries | [`DEPLOY.md`](../DEPLOY.md), [`docs/PROJECT-FEATURES-AND-FLOW.md`](./PROJECT-FEATURES-AND-FLOW.md) |

The extension is distributed separately from the Vercel web/API deployment.
This report describes this checkout's source; it does not establish which
extension package or API version is currently installed by a Manager.

## Complete step-by-step Manager flow

### 1. Manager starts from the extension popup

The popup exposes **Scan current step**. For a Manager, this starts Scanner
preparation rather than immediately reading or filling the page.

`scanAndSaveSiteDiscoveryStep()` checks that there is an active tab, then
`prepareManagerScannerJob()`:

1. Requires Manager role and Scanner feature assignment.
2. Reads the active job page through the existing Get JD flow.
3. Asks the Manager to select one of their active Account profiles.
4. Presents job details and the selected Account for review.
5. Waits for **Save Job & Scan** before starting the application assistance.

This is intentionally separate from the non-Manager site-discovery action,
which only records a structural discovery checkpoint and does not fill a form.

### 2. The job and Account-specific row are saved and claimed

`saveJobAndStartScanner()` saves the reviewed job and confirms that the API
response includes a job row for the exact selected Account. It then:

- Creates a secure run UUID when the row is `todo`.
- For a previously `processing` row, requires a saved run identifier and asks
  the Manager to confirm scanning the currently visible step.
- Claims or resumes the Account-specific job row through the authenticated
  API.
- Stops if the row is in another state or the claim fails.

The claim is a workflow/ownership boundary; it is not a permission for the
extension to navigate or submit the job application.

### 3. The service worker injects the generic scanner

`runManagerScanner()` sends `DISCOVER_APPLICATION_FORM` with Manager access
enabled, `readOnly: true`, `openApplyForm: false`, and `expandDynamic: false`.
The service worker checks Scanner assignment and calls
`discoverApplicationFormOnTab()`. That function rejects inaccessible browser
pages, looks up any reusable structural template for the site, ensures the
scanner scripts exist, then calls the content-side discovery function.

The scanner script bundle is assembled in
`FORM_SCAN_SCRIPT_FILES`. It includes the generic form scanner, application
flow helper, discovery/checkpoint code, and JustJoin template/adapter files.
It is injected into the tab's main frame; it is not a per-ATS content-script
bundle declared in the manifest.

### 4. Site/platform and form flow are inferred

Platform identification is currently hostname-based:

- `justjoin.it` → `justjoin`
- LinkedIn → `linkedin`
- Greenhouse → `greenhouse`
- Lever → `lever`
- Workable → `workable`
- Other sites → `generic`

The content-side `application-discovery.js` has an adapter factory only for
`justjoin`. Other recognized platform names proceed through the generic
discovery code. The template registry also recognizes Greenhouse, Lever, and
Workable hostnames, but the currently registered application-flow templates
are JustJoin easy apply and external apply. Host recognition is therefore not
evidence of an ATS-specific form adapter.

Discovery scans the current visible page and waits for the field count to be
stable for a small number of passes. The generic form scanner:

- Prefers visible application dialogs/modals when present; otherwise scans the
  document.
- Considers enabled inputs, textareas, selects, contenteditable fields and a
  bounded set of ARIA textbox/combobox/listbox/radio/checkbox/switch roles.
- Infers labels from native labels, ARIA labels, legends, nearby text,
  placeholders, and upload-zone text.
- Groups native/accessibility radios into one representative question and
  extracts choices where possible.
- Infers field type, required state, current value, input mode, validation
  hints and native constraints, section/step context, options, and bounded
  selector/DOM evidence.
- Assigns an initial `matched`, `ambiguous`, or `unresolved` status using
  label/control heuristics and confidence scoring.

The scan records current values in its in-memory result for overwrite UX, but
the Scanner GPT page-field projection deliberately does **not** send
`currentValue` to ChatGPT. The structural checkpoint is intended to record
field structure rather than entered values.

Discovery can identify a JustJoin external-apply URL and report that the
Manager should open the external site. That is not an external-site form
adapter: scanning should be started on the actual application tab.

### 5. A site template/checkpoint is found or persisted

The service worker forms a `siteKey` from detected platform and hostname and
asks the API whether a reusable application template is safe to reuse. The
generic scanner still runs: template reuse is a source of structural evidence,
not a switch to a separate ATS autofill implementation.

In `DISCOVERY` mode, the service worker also builds and persists a structural
discovery checkpoint. It stores observations such as page/step identity,
field IDs, labels, types, options, and locator evidence, and returns the
created/reused template ID. Scanner requires that save to succeed before it
loads or changes Manager answer rules.

There are two related but distinct persistence layers:

1. **Site template/checkpoint:** site/host-level structural evidence and
   observed steps.
2. **Manager Scanner rules:** one Manager's decision for a field in that
   template: profile mapping, reusable answer, generated answer, or manual.

They should not be mistaken for one shared global set of autofill decisions.

### 6. Saved Manager rules are matched to this capture

The popup fetches rules scoped to the returned template ID and current
Manager. A step key is derived from the visible step text, if available, or
the set of section headings. The rule field ID combines that step key with
the scanner's stable field ID when a step key exists.

The current matching path is deliberately conservative: `findMatchingRule()`
matches a saved `field_id` and checks saved page-step/step-key context. It
does not silently equate two fields just because their labels look similar.
When a field is genuinely new, the Manager can explicitly associate it with
an existing semantic question or declare a new meaning.

### 7. First capture and reverification are decided

`requiresSecondCapture()` checks each visible field against saved rule or
checkpoint evidence. In broad terms:

- A field with no previously accepted two-observation baseline needs a second
  read-only capture.
- A field with a verified or Manager-reviewed baseline can use one capture if
  the current label, type, required state, validation, options, section,
  stable locator hints, and meaningful DOM structure still agree.
- Material changes or uncertain evidence require another capture.

The second capture is reconciled by stable field ID/locator evidence and then a
label + type + section fallback key. Matching observations are compared for
meaningful changes. Missing-on-second, new-on-second, or changed observations
are surfaced to the Manager. Fields that remain inconsistent or are rejected
are left untouched. Confirmed observations can be saved back into the
checkpoint and a rule's field snapshot.

Class names are treated as weak evidence. A stale fill locator is reacquired
only when a visible field with the captured label, type, and options is a
unique match; ambiguity does not authorize a fill.

### 8. Each field receives a handling strategy

Before using a new rule, the Manager can select one of:

| Strategy | Current behavior |
|---|---|
| **Profile** | Map the question to a selected Account profile/custom-answer value. If absent, a one-time Manager-entered value can be used without saving it into the profile. |
| **Reusable** | Confirm or enter a Manager-owned reusable answer. The answer and its field rule are saved for that Manager/template. |
| **Generated** | Request a job-specific answer from ChatGPT; it is not saved as candidate profile data or a reusable answer. |
| **Manual** | Leave the field for the Manager, except a required captured choice can be selected in the review UI. |

The Manager confirms when an existing page value would be overwritten. If
field identity is uncertain, Scanner does not fill. Certain dropdown controls
with stable IDs can be explicitly confirmed before a saved strategy is used.
That identity confirmation is stored with the field evidence and is revoked
when material field evidence changes.

### 9. Validation is checked before and after GPT

The capture helper normalizes validation metadata such as input type/mode,
numeric-only hints, range, step, pattern, and min/max length. Its
`validateAnswerForField()` checks supported constraints and returns `valid`,
`invalid`, or `unknown`.

- A valid reusable answer may be used directly, subject to Manager review for
  choice fields and field/value confirmation rules.
- An invalid or unknown reusable answer is attached as
  `reusableAnswerContext` to that exact field and sent for GPT assistance; it is
  not copied into unrelated context.
- The ChatGPT instruction contract says to obey the captured constraints, not
  guess conversions, and leave unsupported/uncertain answers unresolved.
- Returned answers are validated again before Manager review. Known-invalid
  output is not queued for fill.
- The page's native validity behavior is the final check during fill. If the
  browser rejects a proposed value, the scanner restores the previous value
  and reports failure.

This gives the example “5000 EUR per month” → numeric-only field a cautious
path: the reusable answer is not pasted verbatim; GPT receives it with that
field's type/validation and must return a supported value such as `5000`, or
mark it unresolved when the meaning/units cannot safely be inferred.

### 10. Generated fields go through a job-scoped ChatGPT task

`runManagerScannerGptTask()` projects only selected generated-answer fields
and requested document upload fields into a page context. Each field includes
its stable ID, question, type, options, validation, and any exact-field
reusable-answer context. The projection excludes the field's current entered
value.

The extension:

1. Creates or resumes a task for the exact Manager-owned, processing
   Account-specific job row.
2. Saves the current page URL/title/number and requested fields to the API.
3. Fetches task context: job details, candidate profile/resume, scoped Manager
   answers, prompt configuration, prior task answers, and current page fields.
4. Builds a strict JSON-only request with stable field IDs and the answer
   validation contract.
5. Opens regular ChatGPT in a background tab and uses the composer helper to
   send the prompt; the service worker watches progress and parses the response.
6. Submits the answer/document package to the QTS API, which validates its
   schema and task/page ownership.
7. Retrieves generated resume and cover-letter PDFs as needed, saves them
   locally, and lets the Manager review them before any upload.

The extension guards against ambiguous resend state and against applying a
package for a different page. A Manager must explicitly acknowledge/skip a
previous page before continuing in those cases.

### 11. Answers and documents are reviewed, then filled

Generated text is shown in the Scanner review dialog with captured input
requirements. Choice review is restricted to the choices captured from the
page. The Manager can approve, edit, or leave an answer unresolved. Documents
also have a separate review/approval path before upload.

Only Manager-approved, confidently identified fields are sent to
`FILL_APPLICATION_FORM`. The content-side fill code reacquires the control,
sets native inputs with page-compatible events, chooses only a unique enabled
option for supported selects/custom dropdowns, and verifies that the page
retained the value. Native browser constraints are checked before success is
reported; rejection restores the prior value. Uploads use generated bytes
cached by the extension rather than relying on a server-side local path.

### 12. Status and report are shown; the Manager advances manually

Progress is shown in the popup and mirrored as notices on the job page. The
final popup status includes the selected job and Account, a filled/failed
count, and per-field outcomes such as:

- Filled from Account profile.
- Queued from reusable answer.
- Manager-reviewed GPT answer filled.
- Kept existing value.
- Left unresolved or manual.
- Could not be filled because the locator/value/constraint/choice was not
  confirmed.

Fill results are joined back to the original outcome by stable field ID rather
than question text, so repeated question text does not by itself redirect a
fill result to a different report entry.

Scanner does not click Next/Continue, navigate the job application, or submit
it. The Manager advances manually and explicitly starts the next visible-step
scan.

## Current platform coverage: detected name versus adapter behavior

| Site/platform | Name detection in Scanner | Dedicated form adapter/template in this checkout | Current implication |
|---|---|---|---|
| Greenhouse | Yes | No | Generic scanner and fill path |
| Lever | Yes | No | Generic scanner and fill path |
| Workable | Yes | No | Generic scanner and fill path |
| Workday | No explicit platform label | No | Generic fallback; generic DOM scan may still work |
| JustJoin | Yes | Yes | Adapter/template can refine external redirect, modal roots, dynamic fields, warnings, and flow type |
| Other supported web pages | Generic | No | Generic scanner, subject to browser access and DOM semantics |

The existing registration model in
`extension/content/platforms/templates/template-registry.js` can resolve
platform templates, but registry availability is not equivalent to production
coverage. The service worker currently injects the JustJoin files alongside
the generic scanner. A new ATS-specific adapter would need to be added to
injection/initialization and tested on that ATS; adding its hostname to a
detection list alone does not add specialized behavior.

## Technical opinion on the proposed hybrid design

### Advantages

1. **Better scaling than full per-site duplication.** Shared field semantics,
   validation, rule matching, Manager review, GPT contract, and fill reporting
   remain one implementation.
2. **Practical middle ground.** Generic DOM discovery covers common native
   controls and accessibility semantics; an adapter can address a platform's
   SPA timing, modal boundary, custom dropdown, unusual label relationship, or
   step indicator without replacing the full workflow.
3. **Improved reliability where the DOM is known.** A focused adapter can use
   documented or stable `data-*`/ARIA markers and known root boundaries instead
   of over-broad global heuristics.
4. **Graceful fallback.** Unknown sites remain usable through generic
   read-only discovery, while low-confidence cases remain Manager-reviewed.
5. **Consistent safety posture.** One common fill gate can enforce explicit
   approval, constraint validation, current-page-only scope, and no automatic
   submit across all ATSs.
6. **Testable evolution.** Adapter contracts allow per-site DOM fixtures and
   behavior tests while preserving shared tests for answer validation,
   reconciliation, and fill-result reporting.

### Disadvantages and engineering costs

1. **Adapter drift.** ATS interfaces change. A narrowly scoped adapter still
   needs maintenance and regression fixtures after platform releases.
2. **False platform detection.** Hostname-only detection can identify a
   familiar ATS even when a page is a marketing page, embedded vendor page, or
   custom employer wrapper. Adapter selection should verify DOM signals too.
3. **More test combinations.** Generic versus adapter behavior, supported ATS
   versions, iframe placement, modal state, and multi-step transitions
   multiply the state space.
4. **Potentially conflicting heuristics.** If adapters and generic code both
   independently infer labels, field IDs, or fill values, they can disagree
   and silently weaken identity confidence.
5. **Frame and SPA complexity.** Cross-origin frames cannot be inspected
   freely; same-origin frame support also requires explicit script injection
   and frame-scoped element targeting. SPA transitions can replace nodes
   between scan, review, and fill.
6. **Browser constraints remain.** An adapter cannot bypass extension
   permissions, restricted browser pages, cross-origin restrictions, or
   inaccessible custom controls.
7. **Privacy and vendor-policy concerns.** More aggressive DOM extraction or
   remote-assisted classification increases the amount of personal/application
   data potentially processed. Keep page values minimized and do not transmit
   current field contents unless necessary and explicitly governed.

### Better implementation shape

Use a layered contract rather than “generic scanner plus a second independent
scanner”:

1. **Platform resolver:** combine normalized hostname with a small set of
   observed DOM signals; return platform identity and confidence. Unknown or
   low-confidence pages use generic mode.
2. **Adapter capabilities:** optional functions for locating application
   roots, identifying supported custom controls, exposing field/step
   observations, and waiting for a stable transition. Avoid an adapter hook
   for every generic operation.
3. **Normalized observation:** all adapters return the same field model
   (stable per-page ID, human-readable label, control kind, required/options,
   native validation, locator evidence, visibility, and confidence). Preserve
   the common evidence and validation semantics.
4. **Shared policy/review pipeline:** Manager rules, semantic decisions,
   GPT task creation, answer/document review, constraint validation, and
   reporting remain site-agnostic.
5. **Shared fill interface:** use adapter fill hooks only for custom controls
   the common driver cannot reliably fill. The common layer still requires
   fresh unique re-identification, explicit approval, post-fill verification,
   and failure reporting.
6. **Safe fallback:** adapter failure must never imply a successful generic
   match. Fall back to generic read-only capture, lower confidence, or report
   unsupported and leave the field untouched.
7. **Bundled, versioned code:** keep adapter code packaged with the extension
   and covered by tests. Do not download and execute adapter code dynamically.

The generic path should remain the default and the common source of truth.
Platform adapters should be **capability plugins**, not parallel workflows or
site-specific policy engines.

## Reliability and design issues visible in the current source

These are observations from this checkout, not claims about how frequently
they occur in production.

### High-priority architectural gaps

1. **ATS name detection overstates actual integration.** Greenhouse, Lever,
   and Workable are named, but no dedicated form adapter is wired for them;
   Workday is not explicitly recognized. Product/UI labels should distinguish
   generic support from adapter-tested support.
2. **Generic confidence is heuristic, not semantic proof.** A field can be
   labeled `matched` based on accessible-label/nearby-text and control
   confidence. That helps triage but does not prove that the nearby text
   describes the control, especially in dense grids or repeated-question
   pages. Manager confirmation and unique target checks remain important.
3. **Stable IDs can be volatile or collide across steps.** IDs prefer DOM
   `id`, then `name`, then a hash of type/role/label/section/pathname. Generated
   IDs can change across page renders; missing page-step/section evidence can
   make the same semantic field on different steps share an ID. Step identity
   should be a first-class source-provided value where possible, not inferred
   solely from headings.
4. **Iframe behavior needs explicit end-to-end support.** Discovery attempts
   to inspect same-origin iframes only if a scanner function is already present
   in that frame. The service-worker injection targets the tab's main frame,
   and fill target resolution runs against that document. Cross-origin frames
   are not directly readable. Forms inside frames therefore need an explicit
   frame-aware injection, evidence, and fill plan or a clear manual fallback.
5. **Dynamic reveal is not active in the Manager run.** The generic discovery
   path can call an adapter reveal hook when requested, but Manager Scanner
   explicitly passes `expandDynamic: false`. Hidden/conditional fields need
   the Manager to reveal them manually and scan again; the existing JustJoin
   dynamic reveal hook is not being used by this path.

### Capture and fill details to harden

6. **“Stable scan” is currently a limited signal.** The first discovery's
   polling watches field count stability. The second-capture settling
   signature includes field labels/types/required/options/section and locator
   structure, but does not include captured validation constraints. A changing
   min/max/pattern can therefore fail to keep the settling loop open even
   though validation is compared later between the two observations.
7. **Constraint coverage is intentionally partial.** The helper handles
   common numeric, pattern, length, email, URL, and required checks; several
   browser validity cases (for example locale-dependent formats, date/time
   formats, custom validity, and framework-specific validation) still depend
   on native browser rejection or Manager review. `unknown` must remain a
   conservative path, not be treated as proof of validity.
8. **Custom controls are only covered when their semantics are exposed.**
   The generic scanner supports native controls and selected ARIA roles. A
   visually interactive `div` without reliable ARIA/label semantics may not be
   discovered at all. Adapters should target evidenced patterns rather than
   adding broad selectors that produce false positives.
9. **Fill happens after asynchronous review and GPT work.** The page can
   re-render or change step while the Manager reviews. Fresh locator resolution
   mitigates stale elements, but a stronger final guard should also verify the
   origin/path/step identity and field evidence immediately before the fill
   batch, and abort the batch if the form has changed.
10. **Template and Manager rule semantics are easy to confuse.** A reusable
    structural template is looked up by site key/host and still runs generic
    scanning. Manager answer rules are scoped by Manager/template/field. The
    UI and operational docs should continue to make this distinction explicit.
11. **No live ATS fixture validates the full browser behavior here.** Unit and
    API tests protect helper logic and schema contracts, but a captured DOM
    fixture or controlled browser test for each supported platform is needed
    to prove that labels/options/validation/SPA timing and fill verification
    match the real ATS.

## Recommended sequencing

1. **Make the support contract explicit first.** Publish which ATSs are
   generic-scannable, adapter-assisted, tested, or unsupported; do not equate
   URL detection with verified integration.
2. **Stabilize the shared observation contract.** Include source frame,
   step identity, validation, locator evidence, and confidence consistently.
   Ensure first/second capture settling compares all material observation
   attributes, including validation.
3. **Add representative browser/DOM fixtures.** Test native fields, ARIA
   comboboxes, radios, repeated labels, SPA rerender, dynamic field insertion,
   file inputs, and frame boundaries in generic mode.
4. **Choose one ATS at a time based on observed failures and user volume.**
   Start with the platform where generic capture has the most measured
   unresolved/failed fields. Build a narrow adapter and fixtures against
   real-but-sanitized DOM evidence.
5. **Retain deterministic gates.** Do not use an LLM to choose DOM elements or
   perform clicks. GPT can suggest answer text using task context; the
   extension must retain deterministic field identity, validation, review,
   and fill verification.
6. **Add regression/operational signals.** Record privacy-minimized outcomes
   (adapter selected, field type, confidence band, reason for unresolved or
   failed fill, extension version) with consent and without field values. Use
   this evidence to justify adapter work and spot ATS drift.

## Bottom line

The proposed hybrid design is a good direction and is more maintainable than
hardcoding complete application flows for every site. It is also a natural
extension of the current code, which already has a generic scanner plus a
limited adapter/template mechanism. The key correction is that today's
Greenhouse/Lever/Workable labels are platform detection, not dedicated
platform integrations.

Keep the generic scanner as the reliable baseline, then add narrowly scoped
adapters only for proven site-specific gaps. Share one field/evidence model
and one safety/review/fill pipeline. Prefer unresolved/manual handling over a
confident-looking but wrong answer or field match.
