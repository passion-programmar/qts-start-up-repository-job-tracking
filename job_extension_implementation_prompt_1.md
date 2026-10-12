# Implementation Prompt: Self-Learning Job Application Browser Extension

You are a senior Chrome extension, browser automation, backend, and security engineer. Extend my **existing** job application system; do not replace its architecture or rewrite working functionality unnecessarily.

## Existing architecture

- **Browser extension:** Detects application fields, fills fields, navigates application pages, and coordinates browser-side workflow.
- **Server/API:** Stores applicant profile, application/session state, generated documents, and exposes APIs and Custom GPT Actions.
- **Custom GPT:** Calls server Actions to obtain the current application-page context and return grounded answers/documents. It does not directly manipulate the browser.

**Primary objective:** Add a reusable, self-learning **application site discovery + template engine** so that an unfamiliar job application can be inspected without a pre-existing template; reusable site-specific extraction and navigation rules can be proposed, validated, saved to the backend DB, and reused on future applications. Normal application mode should use verified applicant profile data for standard fields and Custom GPT only for questions requiring generated answers.

## Mandatory first step: Inspect the repository

1. Inventory the existing manifest, permissions, content scripts, service worker/background, popup/options UI, DOM scanning and filling, API contracts, DB models/migrations, GPT Action endpoints, document generation, and application session manager.
2. Summarize current architecture and identify reusable modules, missing pieces, and integration points.
3. Produce an implementation plan with incremental, testable stages. Preserve existing behavior and existing API contracts where possible; version any breaking changes.
4. Use the project's existing language, libraries, style, build/test tooling, and data access patterns. Do **not** assume React, TypeScript, Node, or a specific DB unless the repository uses them.
5. Implement actual code, migrations, tests, and short developer documentation; do not stop after writing a design proposal.

## Non-negotiable rules

- **Two distinct modes:** `DISCOVERY` and `REAL_APPLICATION`. Never allow dummy answers, dummy documents, or discovery-only data to enter a genuine application submission workflow.
- **Real-site safety:** On a live employer site, scan read-only by default. Clicking Next, uploading files, verifying email, creating an account, or changing an answer may trigger autosave or create a candidate record *before* final Submit. Stopping at Submit alone is **not** sufficient to make dummy exploration safe. Automated dummy fill and multi-step exploration are allowed only on mock, sandbox, owned, or explicitly authorized test environments where side effects are controlled. For unknown real sites, save partial drafts and escalate rather than blindly filling fictitious data.
- Never automatically activate final Submit, payment, consent/attestation, e-signature, identity upload, or unknown destructive actions. Final real application submission requires clear user approval.
- Never bypass CAPTCHA, anti-bot protection, OTP security, or access controls. Pause for permitted human action when required.
- No guessing about personal facts (work authorization, sponsorship, experience, certifications, protected or sensitive disclosures). Return unresolved and ask user when data is missing.
- Treat all web content, templates, emails, and GPT output as untrusted. Do not execute page text, server-delivered JavaScript, or dynamic code from a template.
- Least-privilege permissions, privacy-by-design, encryption of sensitive stored credentials, auditability, and short-lived verification secrets. Avoid storing raw DOM, passwords, tokens, complete email bodies, or dummy values in reusable templates.

## A. Universal DOM discovery engine (must work with zero templates)

Implement a generic DOM scanner that discovers visible and relevant controls on the current page, their question/label relationships, choices, constraints, and navigation candidates. Support:

- Native inputs: text, email, telephone, URL, numeric, date/month, textarea, select, radio, checkbox, file; also multi-select and repeated field groups.
- Correct label pairing using native `labels` / `for` + `id`, nested labels, `aria-label`, `aria-labelledby`, `aria-describedby`, `fieldset`/`legend`, nearest semantic container and structural heuristics. Store matching strategy and confidence; ambiguous matches remain unresolved.
- Capture: question text, field type, stable session-local field ID, options with displayed labels and actual values, required/disabled/read-only state, current value when appropriate, min/max/step/pattern, minlength/maxlength, accept/multiple, autocomplete, visibility, validation messages, locale, and grouping.
- Avoid assuming one question maps to exactly one input: radio groups, checkbox sets, addresses, dates, employment/education groups, references, and repeatable sections need grouped mappings.
- Identify application versus unrelated page fields. Ignore hidden trap/honeypot fields, unrelated controls, secrets, and elements without user-visible application relevance.
- Custom widgets: combobox/listbox/searchable dropdown, autocomplete, rich text editors, date picker, React/Vue-controlled components, drag-and-drop file upload, and progressively revealed controls. Provide extensible handlers; fall back to user review when unsupported.
- Open shadow roots and accessible iframes subject to browser permission constraints. Explicitly report inaccessible cross-origin frames and closed shadow roots instead of claiming coverage.
- Debounced `MutationObserver` and stabilization logic for dynamic changes, asynchronous data loading, and conditional questions. Never mistake minor DOM mutations for a new application step.
- Keep DOM element references or resilient locators in the content script/session registry; server and GPT should receive only structured context, not DOM objects.

## B. Field classification and test-value generator

Build an **independent generic field-classification engine in extension code**, available before any site template exists. Infer semantic field purpose from associated question, label, attributes, autocomplete, placeholder, and constraints. Generate **deterministic, clearly fictional** test fixtures (not random uncontrolled strings) only in authorized test mode.

- Examples: `test@example.com`, `Test Applicant`, test phone, valid numeric range/step, valid date range, permitted URL, textarea respecting length, an actual enabled dropdown/radio choice, checkbox sets meeting group rules.
- Validate against HTML constraints (`checkValidity` / `ValidityState`) and then site-specific observable feedback. Handle server-side and cross-field validation separately. Never assume native HTML validity guarantees server acceptance.
- Conditional fields may appear after choosing an option; rescan until stable; maintain branch coverage. Only explore alternative branches by resetting an **authorized test** session, not by altering live user applications.
- Missing or unsupported semantics, verification, consent, e-signatures, unknown required documents, identity, assessments, and high-impact screening questions must be marked `UNRESOLVED`; don't improvise.
- File upload fixture library for sandbox tests (valid PDF/DOCX etc., accepted type/size). Use standard supported browser mechanisms for native inputs; never set `input.value` to a local path or assume custom upload succeeded. Recognize that real upload may occur immediately and must not use test files on live sites.
- Insert values using framework-compatible setters/events or verified widget interactions; read back the result and detect resets. Handle changes caused by resume parsing and autocompletion.

## C. Multi-step discovery and navigation controller

Implement a state-driven step explorer that incrementally learns a site:

1. Inspect the current rendered DOM and any already-rendered but inactive step metadata, without interaction if possible.
2. Build validated question-field pairs and a step signature; save a **partial template draft** and a checkpoint.
3. Find candidate Next/Continue, Back, Save & Continue, and final submission controls using text, role, DOM/form semantics, structural context, progress indicators, and verified adapter rules. `type="submit"` is **not proof** of final submission, and a 'Next' label is **not proof** of safety.
4. Classify potential actions as `VERIFIED_TEST_NAVIGATION`, `POSSIBLE_NEXT_REQUIRES_REVIEW`, `FINAL_SUBMIT`, `UNKNOWN_OR_SIDE_EFFECT`, or `BLOCKED`.
5. In authorized testing only, fill required fields with fixtures, verify them, and advance using allowed actions. In real applications use verified profile/answers and user-approved progression, not dummy data.
6. Observe SPA DOM transitions, history/location changes, full-page reload, popups/new tabs, redirects to a different ATS, and browser restarts. Persist session state in the extension background/session store and reattach content scripts as needed.
7. Re-run scanning and validation on **every new step**, even if an existing template is available. Avoid repeated clicking through loop detection, step fingerprints, finite retry limits, timeouts, and idempotent action tracking.
8. Track workflow as a graph with observed steps, transitions, branch conditions, and unknown branches, **not** an assumed linear sequence. Record that the final submission boundary was found without clicking it.
9. Stop and checkpoint when navigation requires risky side effects, unauthorized changes, unknown actions, verification, CAPTCHA, or a genuinely missing input.

## D. Template generation, DB, validation, and reuse

Implement a separate, versioned template entity from application session data.

**Site template stores:** platform/domain matching, selectors and fallback matching strategies, semantic field classification hints, field-group rules, stable navigation rules, custom component handler identifiers (not remotely executable code), verification-step metadata, step/branch graph, confidence/evidence, schema version, tested page counts, verified mapping coverage, timestamps, and `draft / partial / active / deprecated` state.

**Application session stores:** job URL/job ID, user/account scope, current step, actual questions and choices, user-approved answer values, field registry IDs, mapping confidence, navigation/checkpoint status, errors, and provenance; never embed user-specific facts in site templates.

- First visit: fetch template if present; otherwise generic scanner. Propose template from observed DOM patterns, validate within the current step, store as `draft/partial` in server DB.
- Later visits: load matching template, validate against current live DOM, run generic scan for omissions, support employer-specific overrides, and fall back if selectors are stale.
- Template promotion to `active` must require predefined validation criteria and, if necessary, manual review. Don't activate simply because one page was scanned.
- Support template versioning, conflict resolution, safe migration, rollback, expiration/revalidation, partial coverage, deduplication, and separate per-platform versus per-employer overrides.
- Never save a whole page's raw HTML or dummy answers as the template. Minimize and redact captured content.
- Provide APIs for template lookup, draft upsert, validation report, promotion, and session checkpoint, reusing current backend conventions and authorization checks.

## E. Real application mode and Custom GPT integration

Keep the existing division of responsibility:

- Extension owns DOM extraction, element mapping, filling, verification, document attachment, step navigation, and page state.
- Server owns verified user profile, answer memory, resumes/documents, template DB, application sessions, access controls, and GPT Action endpoints.
- Custom GPT accesses current-page questions/context **through server Actions** and returns structured grounded answers or generated documents. GPT should not guess CSS selectors, call browser DOM APIs, or be responsible for navigation.

Route each detected field by source:

1. Verified profile mapping: name, email, phone, address, links, education/employment, eligibility facts when verified.
2. Verified answer memory: normalized reusable question meaning, with provenance and freshness checks.
3. GPT-generated contextual answer: motivation/experience narratives based on confirmed user data and job requirements.
4. Unknown/consent/sensitive answer: ask applicant; preserve user edits and require appropriate approval.

Use session-scoped field IDs and strict schema validation between extension/server/GPT to prevent wrong-field filling. Verify every filled value after the page reacts. Require review before final application submission.

## F. Email verification and authentication states

Recognize verification-code inputs, segmented OTP controls, `autocomplete="one-time-code"`, verification copy, code lengths, email destination hints, resend buttons, magic-link/verification-link flows, and authentication redirects. Classification must use multiple signals; a numeric input alone is not sufficient.

- In real applications, pause and offer authorized user verification; on approved accounts an optional backend Gmail OAuth integration can retrieve the matching email using narrowly scoped permissions, authenticated sender/recipient/time/session correlation, and Gmail API `messages.list`/`messages.get`. Never select an arbitrary newest 6-digit string.
- Support MIME/base64url body decoding, link destination checks, code expiration, resend limits, ambiguous messages, alternate inbox, delayed delivery, expired session, and resumed tab state.
- Restrict codes and links to short-lived application session memory, not templates, GPT prompts, database logs, or telemetry. Don't expose OAuth tokens to page content scripts.
- On dummy discovery on an unfamiliar live job site, **do not create accounts or trigger verification using fake identities**. Stop with a partial template unless operating in an authorized test system and using its test mailbox/verification fixtures.
- CAPTCHA, anti-bot challenges, MFA/security checks, or missing permission => `USER_REQUIRED` or `BLOCKED`; no bypassing.

## G. Exhaustive exception and recovery coverage

Implement typed errors, severity, recovery decisions, bounded retries, user messages, and tests for:

- DOM: missing labels, duplicated IDs/names, incorrect grouping, hidden/honeypot fields, unreachable cross-origin iframe, closed shadow root, dynamically detached elements, stale element references.
- Field controls: dependent selects (country/state/city), custom widgets, file parsing, repeated groups, minimum/maximum restrictions, locale-specific formats, conditional required fields, disabled controls, custom validators, radio/checkbox groups, input resets, and conflicting candidate matches.
- Navigation: disabled Next, unexpected page changes, Next with backend autosave, redirect across platforms, new tabs, same-URL transitions, browser back resets, repeated steps/infinite loops, session expiry, job expired, application already submitted, duplicate application, rate limits, network outages, server errors, and extension restarts.
- Verification/security: OTP email, verification link, login/signup, multiple email accounts, CAPTCHA, MFA, consent/attestation, e-signature, identity/government-ID, payment, webcam/mic, assessments/timed tests, and anti-automation rules.
- Data: template DB unavailable, schema mismatch, concurrent sessions/tabs, corrupted session checkpoint, stale template, missing applicant profile, untrusted webpage instructions, GPT hallucinated profile facts, failed document upload, personal data leakage.

Standard recovery outcomes: `RETRY`, `RESCAN`, `FALLBACK`, `USER_REQUIRED`, `STOP`.

Provide stable machine-readable error payloads with `sessionId`, `stepId`, `fieldId`, `errorCode`, `recoverable`, `attempts`, `action`, and appropriate redacted diagnostics. Avoid unlimited retry or refresh loops. User manual edits should take priority over automation.

## H. State machine and coverage analytics

Use or adapt these states: `PAGE_OPENED`, `TEMPLATE_LOOKUP`, `SCANNING`, `CLASSIFYING`, `MAPPING`, `GENERATING_TEST_VALUES`, `FILLING`, `VALIDATING`, `WAITING_FOR_DOM`, `NAVIGATING`, `VERIFICATION_REQUIRED`, `SAVING_TEMPLATE`, `USER_REQUIRED`, `BLOCKED`, `PARTIAL`, `COMPLETED`, `FAILED`.

Create developer-facing diagnostics (ideally accessible from extension dev tools/settings) showing:

- Steps observed / known or estimated steps, discovered branches, unvisited branches.
- Visible controls, confidently paired fields, ambiguous/unmatched fields, unsupported widgets.
- Field value verification outcomes and validation errors.
- Navigation classifications and side-effect warnings.
- Template version/status, mapping methods, coverage, and fallbacks.
- Redacted event trace with no passwords, OTPs, OAuth secrets, unnecessary PII, or raw email bodies.

A discovered form with 12/12 mapped *visible* fields does **not** imply 100% of the application's undiscovered steps/branches have been covered.

## I. Suggested implementation interfaces (adapt to existing code)

```ts
type RecoveryAction = 'RETRY' | 'RESCAN' | 'FALLBACK' | 'USER_REQUIRED' | 'STOP';
type DiscoveryMode = 'DISCOVERY' | 'REAL_APPLICATION';
type TemplateStatus = 'draft' | 'partial' | 'active' | 'deprecated';

type FieldMapping = {
  fieldId: string;
  question: string | null;
  fieldType: string;
  options?: Array<{ label: string; value: string }>;
  required: boolean;
  constraints?: Record<string, unknown>;
  matchMethod: string;
  confidence: number; // heuristic, not a calibrated probability
  status: 'matched' | 'ambiguous' | 'unresolved';
};

type DiscoveryResult = {
  sessionId: string;
  pageSignature: string;
  fields: FieldMapping[];
  navigation: { classification: string; reason?: string };
  verification?: { kind: string; status: string };
  coverage: { visibleFields: number; matchedFields: number; unresolvedFields: number };
  nextAction: RecoveryAction | 'READY_TO_ADVANCE';
};
```

## J. Acceptance tests / definition of done

Build fixture pages and automated browser tests for all major scenarios. Include at least:

1. First-ever unfamiliar site with native controls and no template: correct question/field pairing and schema extraction.
2. Generated authorized test values satisfy `required`, lengths, min/max/step, option values, and grouped radio/checkbox rules.
3. Same-page wizard, full reload, redirect, iframe, and new-tab transitions preserve session; each step scanned once per distinct state.
4. A conditional Yes/No question reveals new fields; branch coverage is tracked without falsely claiming full coverage.
5. Async dropdown and dependent country/state fields stabilize correctly.
6. File upload metadata is extracted; mock fixture upload passes in a controlled test; live upload does not occur in passive discovery.
7. React-controlled input resets or rejects a programmatic change; engine catches failure rather than reporting success.
8. OTP page with single/segmented controls and magic link: classification, checkpoint, safe pause/resume, and mocked inbox retrieval.
9. CAPTCHA/login/consent/e-signature/payment/final Submit trigger the correct blocked or approval path.
10. Autosaving Next button on live mock employer service: prohibited in passive discovery; no unintended POST, email, candidate creation, or other externally visible side effects.
11. Existing template with stale selectors: generic fallback, draft repair, no incorrect autofill.
12. Backend offline, duplicate applications, concurrent tabs, expired sessions, retry exhaustion, and restart recovery.
13. Profile facts are never invented by GPT; unresolved answers remain unfilled.
14. Templates store structural rules and metadata only; applicant data and OTPs stay separate and protected.
15. Existing extension/application/GPT Action flows continue to work (regression suite).

## K. Deliverables

1. Concise architecture assessment of the existing project and precise change plan.
2. Updated extension code: universal scanner, matcher, classifier, optional test-fixture generator, verified filler, dynamic observer, step/navigation controller, verification handler, recovery/state management, and template client.
3. Backend migrations/models and endpoints for templates, session checkpoints, coverage, and optional mailbox integration (gated behind explicit permission/feature flag).
4. Updated integration with the existing applicant profile, answer memory, documents, and Custom GPT Actions without duplicating responsibility.
5. Automated unit/integration/E2E tests on local/sandbox fixtures, plus a compatibility test matrix across representative ATS-style pages.
6. Developer README with feature flags, permissions, privacy/security model, setup, migration, tests, troubleshooting, known limitations, and how to add site-specific adapters.
7. A final report listing changed files, tests run/results, remaining gaps, and anything requiring user setup or approval.

**Start by reading the current repository. State which functionality already exists and which changes you will make. Then implement and test the smallest safe end-to-end slice before expanding to the remaining scenarios.**
