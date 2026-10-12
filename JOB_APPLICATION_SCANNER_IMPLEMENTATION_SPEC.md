# Self-Learning Job Application Scanner — Implementation Requirements & Plan

> **Audience:** AI coding agent and maintainers of an **existing** job-application automation project.  
> **Purpose:** Specify what to add or improve in the current browser extension and its existing backend, frontend, Neon PostgreSQL database, and Custom GPT integration.  
> **Document type:** Product requirements, technical design, incremental implementation plan, failure-mode guide, and acceptance criteria.  
> **Status:** Implementation proposal based on the supplied conversation; **not** a description of code that has already been inspected.  
> **Last updated:** 2026-10-11.

---

## 0. Instructions to the AI coding agent — read first

**Do not generate a new app from scratch.** The user already has a functioning browser extension, backend server, frontend dashboard, Neon database connection, and Custom GPT communication with the server/extension. What is missing or incomplete is the *semantic scanner, action observation, learning, answer confirmation, template recognition, and reliable assisted/automatic replay*.

Before changing code:

1. Inspect the actual repository layout, package files, extension manifest, API routes, database migrations/schema, authentication, existing PDF generation, and Custom GPT integration.
2. Document **existing features**, **missing features**, and **components that can be reused**. Do not assume a particular framework, programming language, ORM, queue, storage provider, or build tool.
3. Propose the smallest additive set of modules, routes, UI changes, and migrations. Preserve working behavior and API contracts wherever possible.
4. Implement **Learn mode first**, then template/answer memory, then Assist mode, then narrowly gated Auto Apply. Do not start by automating final submission.
5. Never pretend to have tested an external job site, integration, file upload, or submitted application when it has not actually been tested.
6. Protect the user's existing profile and document-generation pipeline. Reuse it, adding interfaces only where needed.
7. For each change, provide file paths, code, migrations, tests, setup instructions, and evidence of successful verification.
8. If information is unavailable from the repository, label it **TO VERIFY** rather than inventing names or behavior.

### Definition of done for the overall project

A user can visit a job page, extract the job, generate appropriate documents, manually demonstrate an application while the scanner learns quietly, confirm answer policies, validate a learned template on another application, and then let the scanner fill a sufficiently validated application with safe pauses and reliable outcome tracking. The extension must **not** claim success merely because it clicked Submit.

---

## 1. Project context and user intent

### 1.1 Already existing (as reported by the user)

| Component | Reported state | Required approach |
|---|---|---|
| Browser extension | Exists and works at a basic level | Add/extend scanning, observing, side-panel confirmation, and replay modules |
| Backend server | Exists and works | Add template-learning, lookup, and application-session endpoints |
| Frontend | Exists and works | Extend dashboard with learning progress, questions, templates, runs, documents, failures |
| Neon PostgreSQL | Connected and working | Add migrations/tables only where absent; preserve existing data |
| Custom GPT | Communicates with server and extension | Reuse for ambiguous questions and personalized document/answer generation |
| Resume and cover-letter generation | Described as part of intended flow; exact implementation **TO VERIFY** | Integrate with existing functionality if present, otherwise implement as a separate scoped feature |

**Unknown until repository inspection:** extension browser/MV version, frontend/backend stack, existing table names, user authentication strategy, how Custom GPT calls the backend, PDF generation implementation, storage for generated PDFs, existing permissions and supported ATS providers.

### 1.2 Main user scenario

1. User opens an unfamiliar job page.
2. Scanner detects whether it is a job listing or application page and tries to identify its ATS/platform and template variant.
3. Scanner extracts job title, company, description, URL, and application entry point. It validates that essential fields were actually found.
4. Backend combines extracted job details and confirmed profile facts; existing Custom GPT/document service generates a tailored resume and cover letter as PDFs.
5. Extension informs the user that job scan and documents are ready.
6. In **Learn — Follow Me** mode, the user manually applies. Scanner observes relevant DOM changes, text entries, option choices, uploads, navigation, validation errors, and submission outcome.
7. On completed fields/sections, a **non-intrusive confirmation queue** asks whether each field's future answer should be **Reusable** or **Generated**; it shows the detected question and the user's current answer. User can edit or reject a proposed mapping.
8. Scanner stores confirmed semantic question rules, control-specific interaction patterns, workflow transitions, and supporting evidence.
9. User performs another demonstrated application on the same family of template. The scanner makes predictions and checks how well they match.
10. Once evidence is sufficient, user may choose **Assist — Apply With Me**; recognized fields are filled, unknowns are surfaced.
11. Eventually, with permission and demonstrated reliability, **Auto Apply** can execute validated steps, but must pause on unknown requirements, restricted access, verification, or uncertainty about final submission.
12. Scanner differentiates application submitted, awaiting email/OTP verification, failed, and unknown. User can explicitly confirm an outcome when not machine-verifiable.

**Key design principle:** learn **field meaning**, **answer policy**, and **workflow behavior** separately. Do not train by blindly replaying mouse coordinates or site-specific CSS class names.

---

## 2. Scope and non-goals

### In scope

- Semantic job-page detection/extraction and per-ATS/template classification.
- Observing user actions without interrupting active typing.
- Field/question normalization, option normalization, and learned mapping storage.
- Reusable/profile-backed versus GPT-generated answer policies.
- Guided resume/cover-letter upload; cautious automation only where browser capability and site conditions permit.
- Multi-step application workflow recording and replay.
- Fallback when a page changes structure or field type.
- Mode switching: Learn, Assist, Auto Apply, Pause.
- Application tracking, progress, reconciliation, diagnostics, and safe recovery.
- Testing and template version lifecycle.

### Explicitly out of scope for initial milestones

- Rebuilding the existing extension/backend/frontend/database from scratch.
- Training a new foundation model or reinforcement-learning agent.
- Guaranteeing two demonstrations make a template safe to automate.
- Bypassing CAPTCHA, access controls, login limits, throttling, site safeguards, or anti-bot restrictions.
- Sending mass applications, evading detection, or silently submitting without explicit user authorization.
- Fabricating skills, qualifications, degrees, employment history, eligibility, or other facts.
- Circumventing browser file-picker security or assuming arbitrary local file access.
- Treating email receipt or page navigation as definitive proof of successful submission.

### Inferred engineering decisions, not claims from the chat

The conversation establishes intended *behavior* but does not specify implementation details. The example modules, API paths, database columns, confidence thresholds, timeouts, and test fixtures in this document are **proposed starting points** and must be adjusted to the existing project.

---

## 3. Operating modes and safety behavior

| Mode | Owner of actions | Scanner behavior | Submission rule |
|---|---|---|---|
| **Learn — Follow Me** | Human | Observe actions, learn field meaning and workflow, queue confirmations | Human submits manually |
| **Assist — Apply With Me** | Human with scanner help | Fill high-confidence fields, show unresolved questions, ask for correction | Human reviews/authorizes submit |
| **Auto Apply** | Scanner for a user-authorized application | Replay only validated actions; stop on unusual step, low confidence, CAPTCHA, mismatch, or user activity | Explicit per-application authorization required; safest default is user review before final submit |
| **Pause** | Human | Halt scanner actions; preserve state and observations without mutating page | No scanner submission |

Suggested run states: `idle`, `scanning`, `job_ready`, `documents_generating`, `ready_to_apply`, `learning`, `learning_review`, `assisting`, `auto_running`, `waiting_user`, `waiting_verification`, `submit_ready`, `submitting`, `outcome_unknown`, `submitted`, `failed`, `paused`, `cancelled`.

**Immediate user-takeover rule:** Any trusted user interaction in the active form during scanner execution should cause the executor to relinquish control, cancel pending write operations, and transition to `paused` or `waiting_user`. Avoid competing input from the user and executor. Programmatic events must be marked internally so they are not re-learned as human demonstrations; `Event.isTrusted` can be a useful signal but is not a complete provenance system.

**Mode transitions:** Show the current mode prominently. Never switch from Learn or Assist into Auto Apply automatically after two sessions. Changing to Auto Apply must be intentional and reversible.

---

## 4. Architecture — adapt to existing project

```text
Job listing or application tab
  └─ Extension content script (per permitted document/frame)
      ├─ Job page detector / extractor
      ├─ DOM semantic scanner / field inventory
      ├─ Human action recorder
      ├─ DOM change + navigation monitor
      ├─ Field-specific executor and page-state verifier
      └─ Minimal event/locator snapshots (not complete unrestricted HTML)
                    │ extension messages
  ┌─────────────────▼───────────────────────┐
  │ Existing extension UI + background       │
  │ Mode toggle, confirmation queue,          │
  │ file prompts, run checkpoint, retry UI    │
  └─────────────────┬───────────────────────┘
                    │ existing auth/API transport
  ┌─────────────────▼───────────────────────┐
  │ Existing backend server                  │
  │ Session/workflow manager                 │
  │ Template classifier and versioning       │
  │ Canonical question/answer policy service │
  │ GPT adapter + document-generation adapter│
  │ Audit and outcome tracking               │
  └─────┬─────────────────┬─────────────────┘
        │                 │
        ▼                 ▼
  Neon PostgreSQL    Existing Custom GPT / PDF service
  - templates       - classify unfamiliar semantic questions
  - fields          - job-specific answers with factual guardrails
  - questions       - tailored resume/cover-letter content
  - policies        - server-side PDF output
  - sessions        - return structured, validated results
  - steps
  - applications
  - documents
        │
        ▼
  Existing frontend dashboard
  - recognized platforms, version health, learning status
  - application history, pending reviews, documents, errors
```

### 4.1 Responsibility boundaries

**Content script:** examine the visible page's permitted DOM; collect concise semantic descriptors; observe input/change/blur/click/submission/navigation; apply verified UI actions. It should **not** hold API keys, decide sensitive factual answers, or make authoritative database writes directly.

**Extension background/service worker:** authenticate and route messages, associate tab/frame/session identities, broker API calls, preserve checkpoints, manage permission-related features. In Manifest V3, design for service-worker termination; never rely on in-memory globals as the only copy of an active run.

**Extension side panel or existing UI:** display mode, job scan readiness, current section, queued confirmations, unknown fields, generated answer preview, file chooser instructions, submit permission, errors. Prefer a persistent panel to modal popups over the application page.

**Backend:** own domain model, canonical mappings, version decisions, profile/answer permissions, GPT output validation, session status, deduplication, and persistence.

**Neon:** durable normalized data and audit trail; template memory, question memory, action memory remain distinct.

**Custom GPT:** semantic interpretation and job-specific answer generation, not low-level browser clicking. Treat page text as untrusted input. Use constrained JSON response schemas, server validation, and deliberate authorization.

### 4.2 Browser/DOM constraints

- Chrome extension details in this document assume **Manifest V3** as a design reference; verify actual target before implementation.
- Content scripts run in their own isolated environment by default. Do not depend on direct access to page JavaScript variables.
- Cross-origin iframes need relevant host permissions and per-frame injection; some frames are inaccessible. Record this as `requires_manual_action` rather than faking support.
- Open shadow roots may be traversable; closed shadow roots and some custom widgets require specialized adapters or user assistance.
- React/Vue/Angular components may ignore naive `element.value = ...` if the expected input/change interactions are not reproduced correctly; test control-specific adapters and validate rendered state.
- Native file pickers are security-sensitive. Do not claim the extension can set an arbitrary local path. Support deliberate file selection or a tested, permitted upload path using authorized document bytes.
- Respect current site rules and user permissions before interacting with an ATS.

---

## 5. Scanner requirements: job information and platform recognition

### 5.1 Job-page recognition

Scanner should answer independently:

1. Is this page a **job listing**, an **application form**, a **confirmation page**, or unrelated?
2. What is the job's reliable identity (`company`, `job_title`, `job_url`, optionally `requisition_id`, `location`)?
3. Can a sufficiently complete job description be extracted?
4. Is there a likely **Apply** entry point, and does it navigate externally, open a modal, or launch a form?
5. What application platform powers the actual apply flow?

Use a layered extractor:

1. Structured data, including `JobPosting` JSON-LD where present (treat as untrusted and verify against visible page).
2. Known ATS layout/URL patterns and stable attributes.
3. Semantic headings, article text, labeled sections, and visible Apply buttons.
4. Controlled AI extraction only when deterministic rules cannot resolve the page.
5. User correction of ambiguous or missing job details.

**Minimum usable scan:** title, company, job description, source URL, and reasonable confidence. If missing, show `scan_needs_review` and let user correct; do not generate a tailored resume from guessed details.

**Job identity:** use employer/requisition identifiers if known. Use normalized URL and content fingerprints as fallback, not as the sole cross-site identity. Track `source_url`, `application_url`, and final target URL separately.

### 5.2 Platform recognition (cross-company reuse)

Recognize at three levels:

1. **Platform family:** e.g. Greenhouse, Workday, Lever, or unknown/custom.
2. **Template variant:** e.g. single-page standard, embedded form, multi-step flow, employer-customized variation.
3. **Company/job instance:** current fields, questions, option variants, and workflow-specific requirements.

Evidence signals:

- URL hostname/path and iframe origin.
- Common ATS root nodes or data attributes.
- Semantic field inventory and field-group signatures.
- Stable step labels, Apply/Next/Review buttons, validation patterns.
- Previously verified platform/template fingerprints.

**Do not assign a platform from domain text alone.** One employer may redirect to a different provider. Return `{ platform_id, variant_id, confidence, evidence[], alternatives[] }`; ask for review if confidence is low.

Company A → Company B reuse works when both share a compatible underlying platform and semantics. When layout differs, reuse *questions and policies* independently of *actions and selectors*.

### 5.3 Selectors and template maintenance

Never store only mouse coordinates, positional selectors like `div:nth-child(7)`, random CSS classes, or hard-coded offsets.

For each field store multiple location hints:

- semantic field key (`candidate.email`, `authorization.us`, etc.);
- visible question/label text and normalized text;
- accessible role/name and label association (`label[for]`, `aria-label`, `aria-labelledby`);
- stable attributes (`name`, `id`, `data-testid`) when available, noting none is guaranteed stable;
- control type and permissible options;
- structural/form/section context and iframe identifier;
- locator candidate list and observed matching evidence;
- template version and last verified timestamp.

At replay time re-discover and **revalidate** the element by its semantic evidence and current options. Do not apply a stale selector blindly. When multiple fields appear equivalent, stop and ask rather than choosing the first.

### 5.4 DOM scan performance

- Prefer targeted scans of forms/sections; do not transmit whole pages by default.
- Use `MutationObserver` for changes; debounce bursts, inspect changed subtrees, avoid loops caused by scanner's own DOM changes.
- Re-scan after route changes, modal opens, step transitions, conditional field activation, and iframe navigation.
- Skip hidden/disabled/decorative elements unless necessary to interpret dynamic widget state.
- Exclude password, payment, one-time codes, and unrelated site data from recordings.
- Track observed page phase and frame IDs; remove stale references after navigation.

---

## 6. Semantic field model and normalization

A job application question is **not** its HTML control type. The same answer may appear as a dropdown at Company A, radio buttons at Company B, and a custom combobox at Company C.

### 6.1 Canonical field representation (example)

```ts
// Example contracts; adapt to existing language/types.
type ControlKind =
  | 'text' | 'textarea' | 'email' | 'tel' | 'number'
  | 'select' | 'radio_group' | 'checkbox' | 'checkbox_group'
  | 'combobox' | 'date' | 'file' | 'autocomplete'
  | 'rich_text' | 'unknown';

type AnswerPolicy = 'reusable' | 'generated' | 'ask_every_time' | 'manual_only';

type ObservedField = {
  observationId: string;
  frameId?: number;
  pageStepId?: string;
  control: ControlKind;
  visibleLabel: string;
  normalizedLabel: string;
  helpText?: string;
  placeholder?: string;
  required: boolean | 'unknown';
  options?: Array<{ value: string; label: string; disabled?: boolean }>;
  semanticKey?: string;          // e.g. candidate.email
  semanticConfidence?: number;
  locatorCandidates: Array<{ kind: string; value: string; score?: number }>;
  sectionContext?: string;
  sensitiveCategory?: string;
  visibility: 'visible' | 'hidden' | 'unknown';
};
```

**Example normalization:** `What is your email?`, `Enter your email`, `Candidate email` → `candidate.email`.

**Not equivalent:** `Are you authorized to work in the US?` and `Will you now or in the future need visa sponsorship?` Both may be Yes/No but ask different facts. Likewise, `Can you relocate?` and `Are you willing to relocate?` may require a distinction. Meaning and qualifiers must be preserved.

### 6.2 Canonical answer versus rendered option

Example answer policy:

```json
{
  "semantic_key": "candidate.willing_to_relocate",
  "canonical_answer_type": "boolean",
  "answer_source": "reusable",
  "profile_reference": "preferences.willing_to_relocate",
  "value": true,
  "display_control": "dynamic",
  "requires_reconfirmation_if_meaning_changes": true
}
```

Runtime adapter translates canonical `true` into the current page's `Yes`, `I am willing`, or another **verified equivalent** choice. If the actual options do not match, pause and request user confirmation. For multi-selects, map a *set* of canonical values rather than one free-text string. Do not infer meaning solely from stored value indices like `0`/`1`.

### 6.3 Recommended question categories

| Category | Typical policy | Notes |
|---|---|---|
| Contact name/email/phone | Reusable, profile-backed | Never synthesize unverifiable values |
| Education/employment history | Reusable facts, sometimes generated narrative | Use confirmed profile records as source |
| Work authorization/sponsorship/location eligibility | Verified reusable or ask | Never GPT-invent eligibility |
| Relocation, travel willingness, start date | Reusable preference or ask | Context may change; preserve jurisdiction/timeframe |
| Salary expectations | Ask / bounded profile preference | Currency, range, location, and time matter |
| “Why this role/company?” | Generated | Per-job contextual text; user can edit |
| Skills/technical explanations | Generated grounded in verified experience | Never add false experience |
| Demographic, disability, veteran, sensitive declarations | Manual-only or explicit per-question preference | Do not infer; respect `Prefer not to answer` where present |
| Terms, certifications, truthful declarations | Manual-only for consent/attestation | Require user's own affirmative action |
| CAPTCHA, OTP, password, identity verification | Manual-only | Never store secret values |

### 6.4 Semantic matching pipeline

1. Normalize visible text (spacing, case, punctuation, HTML entities; retain negations and qualifiers).
2. Match exact verified semantic aliases plus context/expected answer type.
3. Compare accepted values, section heading, neighboring labels, and platform.
4. Search stored canonical questions. If ambiguous, send a **minimal sanitized field descriptor** to backend/Custom GPT for **classification only**.
5. Backend validates AI output against allowed semantic keys and evidence.
6. Enforce an illustrative policy: high-confidence + matching options → automatic fill in Assist/Auto; medium → preview; low/ambiguous → user input. Calibrate numerical thresholds using actual test data rather than assuming one universal score.
7. Save corrections as versioned mappings; **never** automatically promote unconfirmed AI interpretation into trusted reusable memory.

---

## 7. Human action recorder (Learn mode)

### 7.1 Required observed events

- `focusin` / `focusout` or blur (field entry/commit boundary).
- `input`, `change` (typing and selections).
- `click` / keyboard activation for meaningful buttons, links, and custom widgets.
- Form `submit` attempts, navigation changes, inline errors, dynamic field additions/removals.
- File selection **metadata** (selected document role, validated filename/type); avoid storing raw file bytes in action logs.
- Step transitions: Next, Previous, Review, Apply, Continue, Submit.
- Human actions needed for manual verification or credential handling (**type only**, not secrets).

### 7.2 Non-interruption behavior

**Problem raised by user:** confirmations would be irritating if shown repeatedly during typing. Implement **commit detection + confirmation batching**, not one popup per keystroke.

Proposed behavior:

1. On first user input, mark field `editing` silently.
2. Update a pending value on subsequent events, with no popup.
3. After approximately **1–1.5 seconds of inactivity**, mark the value *provisional*; do not interrupt the focused field.
4. On blur/change, mark it `committed` if value passes basic checks.
5. Queue one confirmation per semantic field + value version; replace any obsolete queued item after further editing.
6. Present the queue in a side panel, ideally after section completion or when user explicitly opens Review.
7. Do not interrupt password, OTP, CAPTCHA, or the native file picker.
8. If user changes an earlier answer, invalidate the old proposed mapping and replay observation.

**Timing is for UI stability, not disguising automation.** Use state/event-based waits and page readiness checks; fixed two-second delays alone do not make a website safe or fool its anti-bot detection.

### 7.3 Recorder event example

```json
{
  "event_id": "evt_example_001",
  "session_id": "learn_example_123",
  "sequence": 27,
  "origin": "human",
  "type": "field_committed",
  "step_key": "screening_questions",
  "field": {
    "semantic_key": "candidate.willing_to_relocate",
    "observed_label": "Are you willing to relocate?",
    "control": "radio_group",
    "options": ["Yes", "No"]
  },
  "observed_value": "Yes",
  "timestamp": "2026-10-11T12:00:00Z"
}
```

This is an illustrative payload. Actual event storage should apply PII minimization; many values should be sent as redacted preview and a protected answer reference instead.

### 7.4 Recorder implementation steps

1. Create a scan-session controller keyed by tab ID, frame ID, navigation identity, and server session ID.
2. Register delegated listeners in **capture phase** where appropriate so React re-renders don't require re-attaching per-input handlers.
3. Resolve event target into a current `ObservedField` snapshot and semantic label/context.
4. Filter non-user-provided and scanner-generated actions; apply an internal `executionId`/`source` stamp for executor writes.
5. Debounce typing; treat `compositionstart`/`compositionend` (IME) correctly to avoid partial values.
6. Aggregate repeated clicks/select updates into one meaningful semantic action.
7. Store a **bounded local event queue**, flush in batches with retries/idempotency keys, and checkpoint state for worker/tab reloads.
8. On page transition, persist last step outcome and create a new `pageStepId`; retain a link to the session.
9. On submit attempt, capture a workflow event without claiming success.
10. Expose user review/undo/edit before promoting observations into trusted memory.

**Acceptance:** the user can type 100 characters without 100 popups or 100 confirmations; editing a previous value updates a single pending review item.

---

## 8. Two-option confirmation system

### 8.1 Required confirmation design

```text
┌───────────────────────────────────────────────┐
│ SCANNER — REVIEW LEARNED ANSWER               │
│ Question: Are you willing to relocate?        │
│ You selected: Yes                              │
│ Field: radio buttons                           │
│                                               │
│ How should I answer next time?                 │
│ ( ) Reusable answer — use my verified profile │
│ ( ) Generated answer — create for each job    │
│                                               │
│ [Edit question/answer] [Skip] [Save decision]  │
└───────────────────────────────────────────────┘
```

The user explicitly asked for two primary choices: **Reusable** and **Generated**. Implement these prominently. The additional **Ask every time** and **Manual only** policies are proposed necessary safety/fallback states, not replacements for the user's requested options.

### 8.2 Reusable answer

- Save normalized semantic question identity and answer source as a verified profile reference or user-confirmed value.
- Store platform-specific option mappings separately from the canonical answer.
- If the profile fact changes, refresh derived answers, not all historical submissions.
- For legally significant/time-sensitive facts, ask again if outdated or context changes.

### 8.3 Generated answer

- Store question intent and generation policy, **not one previously generated answer as a universal response**.
- At each job, backend provides verified profile, current job description, tailored resume data, constraints (length, style, accuracy), and question context to Custom GPT.
- GPT returns structured answer, confidence/evidence references where applicable, and an explicit `needs_user_review` marker.
- Enforce user-provided facts; do not invent factual qualifications or legal status.
- If GPT output fails validation or exceeds character limits, regenerate/trim with constraints or escalate to user.
- Store final per-application response for history, optionally redacted/secured; do not silently promote to reusable.

### 8.4 Confirmation lifecycle

`observed → committed → pending_review → corrected/rejected/approved → persisted → verified_on_future_session`.

Never save a *trusted* answer mapping just because the recorder saw a value. A final application success confirmation validates the **session outcome** and may promote complete, previously reviewed observations to training evidence; it does not excuse skipping sensitive question approvals.

---

## 9. Workflow learning: steps rather than coordinates

### 9.1 Three independent memories

1. **Template memory:** how a platform/variant is detected, its form sections, steps, and versions.
2. **Question memory:** what each question means, reusable/generated policy, canonical answer, aliases, qualifiers.
3. **Action memory:** how to locate and interact with a control and how to verify the action worked.

### 9.2 Logical workflow step representation

```json
{
  "step_key": "contact_details",
  "template_version": 3,
  "preconditions": ["job_application_form_visible"],
  "fields": ["candidate.name", "candidate.email", "candidate.phone"],
  "actions": [
    { "kind": "fill_semantic", "field": "candidate.email" },
    { "kind": "select_document", "role": "resume", "optional": false },
    { "kind": "request_human_action", "reason": "required_attestation" },
    { "kind": "click_semantic", "target": "button_next" }
  ],
  "postconditions": ["step_advanced_or_error_visible"],
  "unknown_or_failure_policy": "pause_for_user"
}
```

Store **preconditions**, **expected postconditions**, branch conditions, and stable field semantics. Exact clicks and CSS selectors are fallback evidence, not the template definition.

### 9.3 Handling branching and dynamically revealed questions

- Track choices that caused fields to appear/disappear; do not assume one linear step sequence.
- Model transitions as `current_state + observed_condition → action/next_state`.
- Re-enumerate fields after each meaningful change, with bounded retries and timeout.
- For an unknown new required field, pause, learn manually, and resume at the current state.
- For optional fields, follow user policy rather than blindly skipping all optional questions.
- Never auto-click “Agree”, attestations, consents, irreversible actions, or Submit because a similar historical step exists.

### 9.4 Outcome states and human confirmation

**Important distinction:** `submit_clicked` is not `submitted`.

Recommended result states:

- `draft` — scan exists, no completed application.
- `in_progress` — user/executor is filling.
- `submit_attempted` — a submit action occurred; outcome pending.
- `submitted_verified` — strong, page-supported success signal or verified external status.
- `pending_email_verification` — site explicitly requests email/OTP action.
- `waiting_user_confirmation` — ambiguous success page; ask human.
- `outcome_unknown` — could not determine success; do **not** retry Submit automatically.
- `failed` — clear failure/error.
- `cancelled` — user stopped.

After a human submits in Learn mode, offer: **“Did this application submit successfully?”** with **Yes / No / Needs verification / Not sure**. Store `confirmation_source = human`, timestamp, and any visible evidence. A human-confirmed success is not automatically identical to a provider-verified success; preserve evidence provenance.

---

## 10. Training progression and readiness gates

The user suggested learning a template **twice** before autonomous use. Keep this as a useful *minimum* experiment, **not** as a hard guarantee.

| Stage | Behavior | Exit criteria |
|---|---|---|
| 0. Unknown | Detect and classify, no auto input | User starts learning |
| 1. Learn / first demonstration | Record fields, policies, navigation; user manually submits | Completed reviewed session with outcome |
| 2. Validate / second demonstration | Predict mappings in shadow mode; compare to human actions | Differences reviewed; no critical mismatches |
| 3. Assisted | Fill high-confidence answers with human oversight | Repeated successful recovery and low ambiguity |
| 4. Scoped Auto Apply | Execute on compatible, validated variants with explicit authorization | Reliability/coverage meets tested project thresholds |
| 5. Degraded | Template drift or failures detected | Re-learn/revalidate before returning to higher stage |

### Proposed readiness checks

All should pass; **do not use total training count as the only condition**:

- Correct platform/template recognition on known *and* held-out company pages.
- All required visible fields mapped or intentionally escalated.
- No false semantic equivalences, especially negation, legal eligibility, consent, or date/currency questions.
- Field adapters can verify the value after writing; no stale element/duplicate event errors.
- Required uploads are appropriately handled or escalated.
- Multi-step transitions are verified, including conditional branches.
- Submission outcome accurately classified (or deliberately left unknown).
- Replay is idempotent for non-submit actions and **never** unintentionally resubmits.
- Site permission and policy allow the intended operation.
- Template version has recent successful testing on representative pages.

Suggested metrics to define/calibrate with the team: required-field coverage, false-positive match rate, value-write verification rate, human override rate, unknown-field rate, recovery rate, accidental-submit count (target **zero**), and outcome certainty. Example numerical thresholds should be set only after gathering test evidence.

**Cross-company evaluation:** use Company A examples for learning, Company B as validation when possible. Two repetitions on the exact same company's identical form provide weaker evidence of transferability.

---

## 11. Replay engine — deterministic and recoverable

### 11.1 Execution loop (conceptual)

```ts
async function executeStep(step, session) {
  assertMode(session, 'assist_or_auto');
  assertUserAuthorization(session);
  const current = await scanCurrentStep();
  await verifyPreconditions(step, current);

  for (const action of step.actions) {
    if (await hasUserTakenControl(session)) return pause('human_override');
    if (await isCaptchaOrVerificationVisible()) return pause('manual_verification');

    const target = await resolveAndValidateTarget(action, current);
    if (!target && !action.optional) return pause('unresolved_required_target');

    const answer = await resolveAnswerWithPolicy(action, session);
    if (answer?.requiresReview) return pause('answer_review');

    const result = await applyWithControlAdapter(action, target, answer);
    if (!result.verified) return pause('field_write_not_verified');

    await checkpointSession(session, action, result);
  }

  await verifyPostconditions(step);
  return 'step_verified';
}
```

This pseudocode is deliberately high-level. Actual code needs a cancellation token, navigation-safe context, retries, and typed errors. **Never let the model emit arbitrary JavaScript for execution in the page.**

### 11.2 Field-specific adapters

Implement a tested adapter interface for:

- text/email/tel/number/textarea;
- native select;
- radio group;
- checkbox and multi-checkbox;
- accessible custom combobox/autocomplete;
- date controls and locale formats;
- rich text editors (limited, tested site adapters);
- file inputs/uploaders (explicit capability checks);
- step buttons and validation errors.

Each adapter must support `discover → inspect → preconditionCheck → apply → readBack → verify → recoverOrPause`.

**Example:** `willing_to_relocate = true` is a canonical boolean. The radio adapter selects an option labeled “Yes” only after verifying context; native-select adapter picks corresponding option text/value; combobox adapter opens, waits for available choices, selects meaning-matched option, and verifies displayed selection.

### 11.3 Wait policy

Use event/state waits rather than hard-coded click timing:

- Wait for target present, visible, enabled, and stable.
- Wait for option list to render and current choices to settle.
- After an action, wait for field value, validation state, or route/step transition.
- Set explicit per-action bounded timeouts and a **limited** retry policy for safe actions.
- Use modest pacing to avoid UI racing; never market this as CAPTCHA circumvention.
- Differentiate transient timing errors from semantic mismatches. Semantic mismatches always pause.

### 11.4 Recovery, idempotency, and duplicate prevention

- Maintain a checkpoint before and after every significant action; store navigation epoch and unique action ID.
- Retrying “fill email” is usually safe if read-back shows correct value; retrying “Submit application” is **not** safe unless a reliable transaction/outcome check proves it was not submitted.
- On background worker reload, rehydrate from durable state and **re-scan** current page; do not continue using stale DOM object references.
- On tab closure, app redirect, or unsupported frame, record a resumable or terminal state.
- Before opening a new application, check for existing same user + job key + employer/requisition + submission state.
- On low-confidence or contradictory signals: stop, explain the uncertainty, and request user action.

---

## 12. Resume/cover-letter generation and upload

### 12.1 Pipeline

```text
Job scan → job details validation → profile fact lookup
    → existing GPT/server integration → tailored document content
    → PDF render/store (existing service, if present)
    → generated_documents references (resume, cover letter)
    → extension notification + user preview/approval
    → application upload field detection
    → choose document role/type → user-assisted or verified upload
    → verify selected filename/status/error
```

### 12.2 Requirements

- Preserve original verified profile facts; no fabricated experience.
- Track job/document linkage and document version/hash.
- Show exact document to be attached to the current job, allow user replacement.
- Detect `resume/CV`, `cover letter`, `portfolio`, and unknown attachment fields separately. Do not upload a resume into an unrelated field merely because it is a file input.
- Check accepted MIME/extensions, size limits, number of files, and upload success indicators.
- If an uploader uses operating-system dialogs or unsupported drop zones, prompt the user to upload manually and then verify the resulting page state.
- Do not store local file system paths in the backend and do not claim to infer them from browser file inputs.
- Store PDF objects in existing secured document storage if available; store **references**, not raw PDF binary, in Neon (unless current architecture deliberately uses DB blobs).
- Have the user authorize uploading personal documents to a site and respect that site's permitted interactions.

### 12.3 GPT answer service contract (proposal)

```json
{
  "semantic_key": "motivation.why_this_company",
  "question": "Why are you interested in this role?",
  "job_id": "internal_job_id",
  "profile_id": "current_user_profile",
  "document_version_id": "tailored_resume_version",
  "constraints": { "max_chars": 500, "answer_type": "paragraph" }
}
```

Suggested response:

```json
{
  "answer": "Example job-specific response for user review.",
  "source": "generated",
  "needs_user_review": true,
  "warnings": [],
  "evidence_profile_fields": ["experience.project_example"]
}
```

Backend must validate schema, size, allowed sources, tenant identity, and provenance. Handle GPT timeout, malformed output, or hallucinated facts by pausing/asking, not by typing unverified text.

---

## 13. Persistence model — proposed Neon extensions

**Do not blindly run this as a replacement schema.** Compare to existing tables, retain existing IDs/auth relations, add non-destructive migrations, and plan data retention. A pragmatic design separates platform/template objects from per-user answers and application sessions.

### 13.1 Recommended entities

| Entity/table | Key fields and role |
|---|---|
| `site_platforms` | Known ATS family, fingerprint rules, metadata |
| `site_templates` | Platform FK, variant name, status, match rules, organization scope |
| `template_versions` | Immutable-ish revision, evidence, health, active/degraded/retired |
| `template_fields` | Version FK, semantic key, control hints, selectors, requiredness, aliases, option signatures |
| `workflow_steps` | Version FK, step key, preconditions/actions/transitions/postconditions |
| `canonical_questions` | Semantic key, normalized intent, data type, qualifiers, sensitivity |
| `question_aliases` | Question text variants, canonical key, scoped platform/language evidence |
| `answer_policies` | Owner/user FK, canonical question FK, reusable/generated/manual policy, verified profile path, constraints |
| `option_mappings` | Template field/control option ↔ canonical value, approval and version |
| `training_sessions` | User, job, template/version, learn/validate, completion and outcome evidence |
| `training_observations` | Step/action observations, field signature, anonymized metadata, confirmation status |
| `application_runs` | User/job, mode, run state, checkpoints, submission outcome, permissions |
| `application_events` | Ordered typed progress/error/audit events, redacted payloads |
| `generated_documents` | Job, document role, version, storage reference, metadata |
| `jobs` / `applications` | Reuse existing tables if present; canonical job identity and application status |

### 13.2 Proposed constraints and indexes

- All user-owned rows tenant-scoped; backend authorizes **every** query/mutation.
- Unique `(user_id, semantic_key)` for user-specific answer policies where appropriate.
- Unique event `(session_id, event_id)` or similar idempotency key to handle retries.
- Index `(platform_id, active_version)`, `(normalized_question_hash)`, `(user_id, status, updated_at)`, and `(user_id, normalized_job_identity)`.
- Store question/field snapshots as bounded JSONB for flexibility, **not** everything in an unsearchable JSONB monolith.
- Add `created_at`, `updated_at`, `confirmed_at`, `confirmed_by`, `source`, and version columns where relevant.
- Encrypt or otherwise adequately protect sensitive user answers; restrict audit-log exposure and set retention limits.
- Never insert browser-originated user IDs as trusted authorization identities; determine user context server-side.

### 13.3 Example SQL migration skeleton — illustrative only

```sql
-- Adapt names/foreign keys to existing schema. Do not execute unreviewed.
CREATE TABLE IF NOT EXISTS scanner_templates (
  id UUID PRIMARY KEY,
  platform_key TEXT NOT NULL,
  variant_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'learning',
  fingerprint JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform_key, variant_key, version)
);

CREATE TABLE IF NOT EXISTS scanner_answer_policies (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL, -- FK depends on existing auth schema
  semantic_key TEXT NOT NULL,
  policy TEXT NOT NULL CHECK (policy IN
    ('reusable', 'generated', 'ask_every_time', 'manual_only')),
  profile_reference TEXT,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, semantic_key)
);

CREATE TABLE IF NOT EXISTS scanner_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  template_id UUID REFERENCES scanner_templates(id),
  job_identity TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('learn', 'validate', 'assist', 'auto')),
  status TEXT NOT NULL,
  checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_outcome TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS scanner_events (
  session_id UUID NOT NULL REFERENCES scanner_sessions(id),
  event_id TEXT NOT NULL,
  event_seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  redacted_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_scanner_events_order
  ON scanner_events (session_id, event_seq);
```

This is a **minimal example**, not the full schema. Additional tables can be introduced after repository review to avoid duplicating existing job, application, profile, and document tables.

### 13.4 Template lifecycle and drift tracking

`learning → validating → assisted_ready → auto_eligible → degraded → retired`.

When selectors break but semantic mapping still works, record a candidate locator recovery, revalidate, then issue a new mapping/version. Never silently modify a published template in place without traceability. Repeated failure/ambiguity causes automatic downgrade to Assist/Learn.

---

## 14. Proposed backend and extension contracts

**Names below are examples.** Map them to actual existing routes/service conventions before implementing.

| Endpoint/message | Direction | Responsibility |
|---|---|---|
| `POST /scanner/sessions` | Extension → backend | Start/rehydrate a run for job, tab, mode |
| `POST /scanner/jobs/inspect` | Extension → backend | Validate extracted job, deduplicate, connect documents |
| `POST /scanner/templates/match` | Extension → backend | Return candidate platform/variant/version + evidence |
| `POST /scanner/questions/resolve` | Extension → backend | Canonical question lookup, approved policy, confidence |
| `POST /scanner/answers/generate` | Extension → backend → GPT | Generate constrained answer from trusted facts/job context |
| `POST /scanner/sessions/{id}/events` | Extension → backend | Append idempotent, redacted events |
| `POST /scanner/sessions/{id}/confirmations` | UI → backend | Approve/edit/reject mapping + policy |
| `POST /scanner/sessions/{id}/checkpoint` | Extension → backend | Persist recoverable state |
| `POST /scanner/sessions/{id}/outcome` | Extension/UI → backend | Store success/failure/verification with evidence provenance |
| `GET /scanner/templates/{id}/readiness` | Dashboard/UI → backend | Report training coverage, risk blockers, allowed modes |
| `POST /documents/generate` | Existing route preferred | Generate resume/cover-letter for verified job/profile |

### 14.1 Contract requirements

- Authenticated endpoint, tenant-scoped data, input schema validation.
- Use versioned payload schemas; return typed errors and retryability.
- Include `session_id`, `job_id`, `tab/frame_id` where applicable, `template_version`, `request_id`, and `idempotency_key`.
- Backend does not trust the browser's asserted identity, outcome, or answer semantics without appropriate verification.
- Define request size and rate limits; redact sensitive data in logs.
- Inflight generation and PDF operations need cancellation/timeouts and a status endpoint if current infrastructure supports asynchronous jobs.
- Keep Custom GPT access server-side and separate from deterministic replay commands.

### 14.2 Example typed result

```json
{
  "request_id": "req_123",
  "matched": true,
  "template": {
    "platform_key": "example_ats",
    "variant_key": "single_page_v1",
    "version": 2,
    "confidence": 0.91,
    "state": "assisted_ready"
  },
  "evidence": ["iframe_origin", "semantic_field_signature"],
  "unresolved_fields": [],
  "allowed_modes": ["learn", "assist"]
}
```

The confidence number is illustrative only; actual probability calibration must be measured.

### 14.3 Extension message events (suggestion)

`SCAN_JOB_REQUESTED`, `JOB_SCAN_READY`, `FORM_FIELDS_CHANGED`, `USER_FIELD_COMMITTED`, `CONFIRMATION_QUEUED`, `CONFIRMATION_SAVED`, `MODE_CHANGED`, `DOCUMENT_READY`, `REPLAY_ACTION_REQUESTED`, `REPLAY_ACTION_VERIFIED`, `USER_TAKEOVER`, `HUMAN_VERIFICATION_REQUIRED`, `SUBMIT_ATTEMPTED`, `SUBMISSION_OUTCOME_RECORDED`.

Validate message origin and route by current tab/frame/session. Ignore unknown commands; never expose a generic “execute arbitrary JavaScript” endpoint to GPT or webpages.

---

## 15. UI and dashboard requirements

### 15.1 Extension interface

At minimum show:

- **Mode selector:** Learn / Assist / Auto / Pause (with availability and explicit eligibility reasons).
- **Job scan card:** title, company, job source, scan confidence/problems, Edit details.
- **Documents:** resume and cover-letter generation status, previews, file upload role.
- **Active application:** current step, recognized fields, completed count, unknown/required fields.
- **Learned answer queue:** question, detected answer, semantic key, **Reusable / Generated**, edit, skip, save.
- **Human action request:** “Choose your resume”, “Answer this field”, “Complete verification”, “Review before submit”.
- **Outcome prompt:** Yes / No / Needs verification / Not sure after apparent submission.
- **Pause / Stop:** immediately accessible, especially during automatic actions.
- **Why paused?** plain-language explanation and possible next action.

**UX principle:** side panel or existing popup should not steal focus on each keystroke. Use a badge/count and review queue; do not overlay blocking confirmation popups while user is actively typing.

### 15.2 Existing frontend dashboard additions

- Job/application history by company, role, status, latest evidence.
- Learned platforms and template variants with versions and health/readiness.
- Training sessions, predicted-vs-observed matches, unresolved differences.
- Approved canonical questions and answer policies, edit/delete/disable controls.
- Generated documents linked to job and version.
- Errors, user interventions, pending email verification, uncertain outcomes.
- Ability to reset a bad template mapping or revoke Auto mode eligibility.

---

## 16. Problems likely to occur — detection and solutions

| Problem | Detection/symptom | Recommended resolution / fallback |
|---|---|---|
| **CSS classes/IDs change** | Locator no longer finds one unique field | Re-scan semantic label/role/context/options; verify and version recovered locator; escalate if ambiguous |
| **Different ATS used by companies** | Domain, iframe origin, form fingerprint differ | Match platform family first, variant second; share question memory separately from workflow memory |
| **Dropdown vs radio vs combobox** | Same semantic question with different control | Normalize to canonical answer; use control-specific adapters; verify option meaning and read-back |
| **Opposite wording / negation** | “Require sponsorship?” vs “Authorized?” | Keep separate keys, qualifiers, and truth conditions; ask when unsure |
| **Dynamic fields** | New required field appears after choice | MutationObserver + re-scan; learn branch; pause for new required fields |
| **SPA navigation** | URL/DOM changes without full reload | Observe route/DOM, refresh step context; cancel stale operations |
| **Iframe or shadow DOM** | Form not visible to top-level content script | Per-frame permissions/injection where supported; adapter for open shadow root; manual fallback for inaccessible frames |
| **React-controlled inputs** | Text appears but validation/state resets | Use framework-compatible adapter and `input/change`; verify stored/rendered value, not merely assigned DOM property |
| **Autocomplete** | Typed selection not actually chosen | Wait for options, choose semantically matching item, confirm committed selection |
| **User typing interrupted** | Confirmation opens mid-input | Debounce + commit on blur/change + batch review; never steal focus |
| **Duplicate confirmations** | Same field repeatedly queued | Dedup by session/field/value version; update pending review after edit |
| **Scanner learns its own actions** | Auto-fill appears as human training | Tag executor-originated actions, use session mode/source, filter programmatic events |
| **Multi-step form loops** | Click Next but same step/error | Check postcondition and inline validation; bounded retries, explain failing fields |
| **Back button/edit previous step** | Earlier values differ from learning log | Revisioned observations; invalidate obsolete snapshots |
| **File field mismatch** | CV uploaded to cover-letter field | Semantic document-role detection + preview + confirmation; fallback to manual picker |
| **File upload rejected** | MIME/size/server error | Validate format/size, regenerate compliant file when permitted, or ask user |
| **CAPTCHA/OTP/SSO** | Verification challenge appears | Pause and let user handle; no bypass or spoofing; resume after user confirmation |
| **Too many requests/rate limit** | 429, blocked interaction, warning | Respect platform rules and back off/stop; do not attempt evasion |
| **Network/server failure** | API requests time out | Local bounded queue, idempotent replay, checkpoint and resume; never duplicate submit |
| **MV3 service worker suspends** | Global run state disappears | Persist checkpoints to suitable extension storage/server; rehydrate and re-scan |
| **GPT returns invalid/false facts** | Unsupported claim or malformed answer | Constrained JSON, server validation vs verified facts, human review |
| **Malicious job-page instructions** | Job description contains “ignore previous instructions” | Treat all page text as untrusted data; strip irrelevant instructions; enforce fixed server policy |
| **Sensitive question** | Demographic/medical/attestation | Manual-only/explicit preference; never infer or auto-accept |
| **Different requiredness or option wording** | Field map applies but semantics differ | Verify labels/choices each run; restrict mapping scope and downgrade confidence |
| **Duplicate applications** | Same job identity already submitted/uncertain | Dedup preflight check; require deliberate override, never auto-retry uncertain submission |
| **Success toast disappears** | Signal missed | Record navigations, stable success markers, screenshots only with privacy controls; human outcome confirmation |
| **Email check required** | “Verify your email” after submit | `pending_email_verification`; prompt user, reconcile status later; not verified submitted |
| **False success after Submit click** | No actual confirmation | `submit_attempted` then `outcome_unknown`; do not promote to submitted automatically |
| **Two sessions insufficient** | Errors on second company/variant | Keep Learn/Assist; collect more evidence; require cross-company validations |
| **Template degraded after redesign** | Rising mismatch/override rates | Mark degraded, disable Auto, create new version, solicit new demonstration |
| **Performance problems** | Site becomes sluggish from observation | Scope queries, debounce mutations, batch events, cap snapshots, avoid full-page polling |
| **Privacy or tenant leak** | Another user's answers or docs surfaced | Server-side tenant filtering, encryption where needed, least privilege, redacted logging, security tests |

---

## 17. Security, privacy, user authorization, and site compliance

These are **requirements**, not optional polish:

1. Scan/interact only on sites the user has enabled and where the intended automation is permitted. Respect website terms and limitations.
2. Request narrow extension/host permissions; prefer runtime optional host permissions where compatible with the current extension architecture.
3. Do not attempt CAPTCHA evasion, bot fingerprint spoofing, account/access bypass, or deliberate anti-detection behavior. Human pacing is for UI stability.
4. **Protect credentials and secrets:** no GPT keys in the extension, no stored passwords, no OTP capture, no cookie exfiltration, no generalized arbitrary browser execution endpoint.
5. **Keep trust boundaries:** browser page and content-script data are untrusted. Validate messages and data server-side; sanitize displayed HTML/text and AI prompts.
6. **Use user-confirmed facts** for qualifications, dates, licensing, legal eligibility, pay expectations, and other factual statements. Never silently invent answers.
7. Sensitive or optional self-identification questions require explicit user control. Provide `ask_every_time` and `manual_only` even if UI emphasizes the two requested primary choices.
8. Minimize recorded PII, raw HTML, screenshots, and document contents. Encrypt/protect stored personal data as appropriate; define retention, deletion, and access audit processes.
9. Enforce authorization on all backend operations. Use current logged-in identity; never trust profile/user IDs from client messages alone.
10. User has a one-action **Pause/Stop**; executor halts on takeover, unexpected state, and permission loss.
11. Submit is irreversible. Auto mode requires informed **per-application authorization**; safer default is stop for review at submit. Support clearly bounded opt-in only for workflows permitted by the site and verified safe.
12. Maintain an auditable distinction among human-typed, reused, generated, and scanner-executed answers, as well as human-confirmed versus site-evidenced outcomes.

---

## 18. Incremental implementation roadmap with deliverables

Use these phases against the **existing** project. Each phase should be an independent, reviewable PR or commit series with tests.

### Phase 0 — Repository assessment and compatibility map

**Tasks**

- Inspect extension manifest, content scripts, background scripts, messaging, and existing UI.
- Inspect server routes, profile shape, GPT/document/PDF services, file storage, and authentication.
- Inspect Neon schema and existing migrations for jobs, applications, answers, profiles, and docs.
- Map actual call flows: page → extension → server → GPT/PDF → database → dashboard.
- Create `docs/scanner-current-state.md` with actual file paths, what exists, blockers, migration impact, and prioritized TODO list.

**Acceptance:** no implementation plan references guessed files or routes; no working integration is replaced unnecessarily.

### Phase 1 — Semantic job and form scanner (**P0**)

**Tasks**

- Implement job page type/metadata extraction with validation and manual correction.
- Implement observed field inventory with labels, roles, types, options, requiredness, frame/section context.
- Implement ATS platform/variant fingerprints and candidate matching.
- Implement mutation/route monitoring and bounded rescans.
- Integrate compact scan results with existing server.

**Acceptance:** on test pages, shows accurate job metadata, distinct form fields, options, and template candidates; handles renamed CSS classes and common dynamic changes.

### Phase 2 — Learn-mode action recorder (**P0**)

**Tasks**

- Wire input/change/focus/click/navigation listeners and action provenance.
- Add local queue, deduplication, checkpoints, idempotent sync, privacy filters.
- Implement typing debounce, committed-field lifecycle, batch review trigger.
- Include manual upload selection and step transitions in the recorded workflow.

**Acceptance:** user can fill a multi-field form with no typing interruptions; playback shows one coherent observation per committed field and correct step order.

### Phase 3 — Answer confirmation & canonical question memory (**P0**)

**Tasks**

- Add Reusable/Generated confirmation queue with edit/skip/save.
- Implement canonical question normalization, alias comparison, context/negation checks.
- Persist approved policy, profile reference, value mapping, and evidence.
- Route generated questions through existing GPT backend with schema/fact validation.

**Acceptance:** same question phrased differently maps correctly; contradictory questions do not; the scanner uses reusable facts or generates a new job-specific answer according to policy.

### Phase 4 — Workflow learner and second-session validation (**P1**)

**Tasks**

- Persist workflow states, transitions, preconditions, postconditions, and control patterns.
- During a second Learn/Validate session, generate shadow predictions for field/action matches; compare to human demonstration.
- Log differences and require review; calculate readiness blockers.
- Store platform/variant/template versions, deprecate drifted mappings.

**Acceptance:** two sessions produce a report explaining which fields and steps transferred, which failed, and whether Assist mode may be enabled. No automatic promotion based on count alone.

### Phase 5 — Assist replay and safe recovery (**P1**)

**Tasks**

- Implement field adapters and read-back verification.
- Resolve known answers by semantic key; generate unfamiliar job-specific narratives when allowed.
- Pause on required unknown, inaccessible frame, CAPTCHA, attestation, upload issue, or validation error.
- Integrate document upload prompts and checkpoint resume.
- Show user takeover/Stop and per-step progress.

**Acceptance:** known fields are filled correctly across differing control types; the system yields immediately when user takes control; there are no unverified field writes.

### Phase 6 — Outcome tracking and template health (**P1**)

**Tasks**

- Record submit attempts separately from result classification.
- Add Yes/No/Needs verification/Not sure post-submit prompt in Learn mode.
- Add explicit statuses for pending email verification, unknown, failed, and confirmed success.
- Add dashboard history and template health metrics; safeguard duplicate submissions.

**Acceptance:** no uncertain application is marked verified submitted or blindly resubmitted.

### Phase 7 — Controlled Auto Apply (**P2**, only after evidence)

**Tasks**

- Add eligibility gate per platform/template version/site/user, backed by tests.
- Require explicit user permission for each application; define submit-review policy.
- Run deterministic workflow with checkpoints, mutation detection, bounded waits, and hard safety stops.
- Automatically downgrade failing templates to Assist and request new demonstrations.

**Acceptance:** no unintended submits, no unresolved-required-field continuation, no CAPTCHA bypass, and all unexpected states stop with actionable diagnostics.

### Phase 8 — Hardening and ongoing maintenance (**P2**)

**Tasks**

- Build fixtures from **consented, redacted** form examples or synthetic ATS-like forms.
- Add regression suites for changed CSS classes, option formats, conditional questions, navigation, failures, and persistence.
- Add telemetry on confidence calibration, override rate, field failures, and template drift (with PII minimization).
- Define data deletion/retention and operational incident handling.

**Acceptance:** regressions are detected before enabling a modified template; degradation gates work.

---

## 19. Test plan and acceptance scenarios

### 19.1 Synthetic test fixture matrix

| Test | Expected result |
|---|---|
| Job page with JSON-LD + visible job description | Correct validated title/company/description |
| Page missing title or company | `needs_review`, no hallucinated output |
| Company A has `select` for relocation; B has radio group | Same canonical answer rendered by different adapters |
| Company B labels email “Candidate Email Address” | Recognized as `candidate.email` |
| “Authorized to work?” vs “Need sponsorship?” | Separate semantic keys; no unsafe Yes/No equivalence |
| Random CSS class changes | Semantic field still located and verified, or safe pause |
| User types rapidly, then edits before blur | No popup during typing; single latest pending confirmation |
| React controlled form re-renders | Filled value read back and remains committed |
| Select reveals extra required input | Recorder learns branch; executor pauses on unknown field |
| Step Next shows validation error | Stop/ask; do not assume transition succeeded |
| Form inside inaccessible cross-origin iframe | Explain limitation; manual step, no false completion |
| Resume/cover-letter fields both exist | Correct document-role matching; no swapped uploads |
| Unsupported native file picker | Ask user to select file; verify selected/uploaded state |
| CAPTCHA/OTP appears | Auto stops; user completes manually |
| User begins typing in Auto mode | Immediate takeover; no competing writes |
| Worker restarts in mid-session | Rehydrate checkpoint and re-scan; no duplicate actions |
| GPT output invents degree/experience | Validation blocks and requests review |
| Submit clicked but no success page | `outcome_unknown`, no automatic retry |
| Page says “Check your email to finish” | `pending_email_verification` |
| Duplicate job previously submitted | Warning and no automatic second submit |
| Session 2 contradicts Session 1 workflow | Template remains learning/assisted; no auto unlock |
| Major template redesign | Version marked degraded; auto disabled |

### 19.2 Testing levels

- **Unit:** normalization, confidence evidence, negation handling, policy resolution, adapter read-back, dedup and state reducers.
- **Integration:** content script ↔ extension UI/worker ↔ backend ↔ Neon; mocked GPT/PDF; permissions/auth checks.
- **End-to-end:** locally hosted synthetic application forms and approved test sites, multi-step/iframe/custom widgets where feasible.
- **Manual exploratory:** real sites **only when authorized and permitted**, with dry-run or no-submit testing to avoid accidental applications.
- **Security:** prompt injection in job text; malicious message spoofing; cross-account data access; redacted logs; consent/attestation behavior.
- **Regression:** version upgrades; browser/manifest changes; worker suspension; network loss; multiple concurrent tabs.

### 19.3 Release gates

1. **Learn enabled:** page scan + recording + reviewed/persisted answers validated.
2. **Assist enabled:** field adapters demonstrate robust value verification; safe fallback works.
3. **Auto enabled:** enough recent varied evidence + documented site permission + safety/duplicate/outcome tests pass + explicit opt-in.

---

## 20. Suggested module boundaries (illustrative, not actual file paths)

```text
existing-extension/
  scanner/
    jobExtractor.*          # listing detection, job details
    domFieldScanner.*       # semantic field descriptors
    platformDetector.*      # ATS family and variant evidence
    mutationTracker.*       # scoped DOM/route monitoring
    actionRecorder.*        # human action observation + debounce
    confirmationQueue.*     # pending user approvals
    fieldAdapters/          # text/select/radio/checkbox/combobox/file
    replayEngine.*          # deterministic action executor
    scannerState.*          # mode/state machine/checkpoint
    messageContracts.*      # typed transport events
  ui/
    ScannerPanel.*          # extend existing UI, not mandatory folder

existing-server/
  scanner/
    sessionService.*
    templateMatchingService.*
    questionResolutionService.*
    answerPolicyService.*
    workflowLearningService.*
    readinessService.*
    outcomeService.*
    gptAdapter.*            # reuse existing Custom GPT integration
    documentAdapter.*       # reuse existing PDF generation
  migrations/               # only additive migrations as needed

existing-frontend/
  scanner/                  # extend existing dashboard/routes
    templates.*
    sessions.*
    answers.*
    applicationHistory.*
```

No framework is mandated. Prefer internal interfaces and tests over introducing a large new dependency chain.

---

## 21. Priority backlog — ready for issue tracker

| ID | Priority | Task | Dependency |
|---|---|---|---|
| SCN-001 | P0 | Audit existing extension/backend/frontend/Neon/GPT/PDF contracts | None |
| SCN-002 | P0 | Extract job data and validate scan result | SCN-001 |
| SCN-003 | P0 | Inventory visible semantic fields + options/labels | SCN-001 |
| SCN-004 | P0 | Detect platform/variant by multiple signals | SCN-003 |
| SCN-005 | P0 | Build non-intrusive recorder with field commits | SCN-003 |
| SCN-006 | P0 | Add confirmation queue with Reusable/Generated | SCN-005 |
| SCN-007 | P0 | Persist user-approved canonical question/policy | SCN-006 |
| SCN-008 | P0 | Hook generated answers into existing GPT server | SCN-007 |
| SCN-009 | P1 | Model workflow states/transitions/conditional fields | SCN-005 |
| SCN-010 | P1 | Validate predictions on second training session | SCN-004, SCN-009 |
| SCN-011 | P1 | Implement adapter-based Assist mode | SCN-007, SCN-009 |
| SCN-012 | P1 | Add document-role detection/upload review | SCN-002, SCN-011 |
| SCN-013 | P1 | Implement outcome classification/user confirmation | SCN-009 |
| SCN-014 | P1 | Add dashboard readiness/health/audit UI | SCN-010, SCN-013 |
| SCN-015 | P1 | Resume safely after worker/network/tab interruptions | SCN-005, SCN-011 |
| SCN-016 | P2 | Add tightly gated Auto Apply with explicit authorization | SCN-010–SCN-015 |
| SCN-017 | P2 | Drift detection/version rollback and regression fixtures | SCN-016 |

---

## 22. Required deliverables from the implementation AI

On the **first pass**, produce:

1. Repository architecture map with existing file paths and current scanner features.
2. Gap analysis: existing code to keep, new modules to add, integration points, risk list.
3. Exact phase-1 implementation proposal tied to real files and routes, including migration impact.
4. Tests and acceptance cases for the first phase.

For **each feature/PR**, produce:

- Changed file list with rationale.
- DB migration and rollback/compatibility notes if applicable.
- API/message contract changes.
- UI behavior and empty/error states.
- Security/privacy impact and any added permissions.
- Unit/integration/e2e test results and scenarios not yet verified.
- Manual QA steps and what is still unsupported.

**Never answer “completed” solely because code compiles.** Show that it meets its phase acceptance scenarios.

### Initial prompt to give a coding AI along with this Markdown

> I already have a working browser extension, backend, frontend, Neon PostgreSQL integration, and Custom GPT communication. Do **not** rebuild the project. Read this specification and inspect my repository first. Identify what already exists, what is missing, and the minimal code/migration changes needed. Implement **Phase 1: semantic job/form scanner** and **Phase 2: non-interrupting Learn-mode action recorder** before building Auto Apply. Preserve existing APIs and PDF functionality. Add tests, validation, safe fallbacks, and a clear list of changed files. If something in the repo contradicts this proposal, explain the discrepancy and adapt the design. Do not bypass CAPTCHA or silently submit job applications.

---

## 23. External technical references (supplementary)

These support browser-API implementation details and are **not** evidence that the user's project already uses Chrome MV3 or any particular architecture.

- Chrome Extensions — [Content scripts and execution worlds](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
- Chrome Extensions — [Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- Chrome Extensions — [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- Chrome Extensions — [Service-worker lifecycle and persistence](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- Chrome Extensions — [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- MDN — [MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver)
- MDN — [File input behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file)

---

## 24. One-page summary of decisions from the conversation

- **Existing project first:** improve extension/server/frontend/Neon/Custom GPT, do not recreate them.
- **Primary objective:** self-learning scanner that observes actual human applications and later reuses the knowledge.
- **Recognition:** platform family → template variant → company/job instance; reuse semantic question memory across organizations.
- **Matching:** meaning + context + labels + options + DOM evidence, not CSS selectors alone.
- **Form types:** the same logical answer may be a dropdown, radio, checkbox, or custom combobox; use the proper adapter.
- **Learning UX:** do not interrupt while typing; debounce, commit on blur/change, and batch confirmations.
- **Two choices:** each reviewed field explicitly supports **Reusable** and **Generated**.
- **Mode choices:** **Learn**, **Assist**, **Auto Apply**, and **Pause**.
- **Two demonstrations:** a useful initial goal; never a guarantee of automation readiness.
- **Custom GPT role:** unfamiliar semantic questions, job-specific answers, resume and cover-letter content—not mouse clicking.
- **Documents:** job-specific PDFs should be available before applying and mapped to correct upload fields.
- **CAPTCHA / human verification:** stop and let user complete; timing is for stability, not evasion.
- **Submission:** `submit_clicked ≠ submitted`; detect success/verification/failure/unknown and ask user when ambiguous.
- **Safety:** always preserve human control, profile factual accuracy, server-side secret management, site rules, and data privacy.
- **Best development order:** semantic scanner → silent recorder → answer confirmation/memory → workflow validation → Assist → outcome tracking → gated Auto.

**Bottom line:** the scanner should become a reliable *semantic workflow learner with user supervision*, not a fragile click-replay macro.
