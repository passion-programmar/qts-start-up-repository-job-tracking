# Extension and Scanner Improvement Plan

Status: Proposed implementation plan
Prepared: October 12, 2026
Scope: Manager application workflow, browser extension, Scanner, backend, and Template Review

## 1. Objective

Improve the existing Scanner so it builds trustworthy logical templates from captured evidence, binds Manager strategies to the correct Account and application context, and reliably fills supported fields on the current visible step.

The first release ends after verified visible-step filling. The Manager controls navigation, uploads, attestations, and submission. Workflow automation is a later, separately verified capability.

This plan is based on the supplied reports and conversation. The repository, original database payloads, and live application DOM have not been inspected for this document. Reported behavior is a baseline to verify; requirements below describe proposed changes, not completed work.

## 2. Reported baseline and evidence

Preserve and improve these reported existing capabilities:

- Shared structural templates and saved checkpoints.
- Template Review with static validation and reviewer attestations.
- Separate Manager strategies: Profile, Reusable, Generated, and Manual.
- Visible-step capture comparison and confirmation-based filling for supported Scanner sessions.
- Manager-controlled navigation and submission.

The supplied Workable report describes:

| Observation | Reported result | Planning implication |
| --- | --- | --- |
| Template | `workable:apply.workable.com`, `discovery-v1`, `partial` | Saved discovery evidence; Workable filling is not established |
| Saved field records | 283 | Treat as observations until logical identity is reconstructed |
| Checkpoints | 11 with 21 fields, two with 26, one empty | Repeated inventories do not establish distinct workflow steps |
| Classification | 218 matched; 65 ambiguous | Existing status does not establish semantic correctness |
| Confidence below 0.80 | 105, including all 65 ambiguous | Current reported promotion gate cannot pass |
| Contaminated labels | 51 with SVG fallback text; two cover-letter labels with `dfdfdfd` | Repair label provenance and prevent answer leakage |
| Radio records | Ten rows labeled only `NO` across two captures | Recover five question groups and their complete options from new evidence |
| Upload locators | 13 different file-input IDs | IDs are capture hints, not demonstrated stable locators |
| Validation report | None reported | Do not infer any completed validation |

These counts come from the supplied prior analysis, not a new independent audit. Missing question text, navigation order, successful writes, and outcomes cannot be reconstructed reliably from the text export alone.

## 3. Responsibilities and boundaries

| Component | Required responsibility |
| --- | --- |
| Manager | Select Account and job; review sources and answers; approve filling; take over; navigate and submit |
| Account | Supply applicant-specific facts and document references |
| Extension | Bind to the permitted tab/document/frame; collect permitted evidence; perform approved writes; report results and interruptions |
| Scanner | Group controls into questions; establish identity; compare structure; propose mappings; check execution eligibility |
| Backend | Enforce access and scope; store versioned evidence and strategies; resolve facts and generation; coordinate revisions and outcomes |
| Template Review | Review logical structure and provenance; expose blockers and capability-specific evidence |

Scanner is a capability distributed across components, not necessarily a new service. Audit existing interfaces before adding modules.

## 4. Required changes and new features

### SCN-001 — Verify implementation and integration contracts

Priority: P0. Type: Audit and clarification.

- Inspect the reported `form-scan.js`, `ApplicationTemplateReviewView.tsx`, `application-template-validation.ts`, `manager-application-profile.routes.ts`, `CURRENT-SYSTEM.md`, and `PROJECT-FEATURES-AND-FLOW.md`, if present.
- Trace capture, persistence, review, answer resolution, confirmation, write, and result paths.
- Identify supported browser versions, frames, shadow DOM, control adapters, permission boundaries, and extension lifecycle constraints.
- Document the actual GPT integration: caller, endpoint or Action direction, authentication, allowed payload, structured response, timeout, cancellation, and error handling. Do not assume a Custom GPT exposes a callable backend API.
- Produce a capability matrix showing implemented, defective, unsupported, and unverified behavior.

Acceptance: Every first-release capability has a source location, owner component, contract, and testable boundary. Existing modules are reused where suitable.

### SCN-002 — Separate captures, steps, fields, and observations

Priority: P0. Type: Data-model change.

| Entity | Purpose |
| --- | --- |
| Capture | One observation at a time, with document context and completeness |
| Logical step | A recognized screen or form section within a scoped application |
| Logical field | A question instance, including section and repeated-record identity |
| Control reference | One or more DOM components implementing a logical field |
| Field observation | Capture-specific evidence linked to a candidate or confirmed logical field |
| Transition evidence | Observed action and before/after states; not inferred from capture order alone |

- Retain source capture IDs independently of logical step IDs.
- Match using scoped route/document context, section, question meaning, control structure, options, and repeated-record identity.
- Do not include entered answers or volatile widget IDs in canonical identity.
- Keep repeated employment/education rows distinct even when their labels or semantic keys match.
- Record loading, inaccessible, empty, and incomplete captures explicitly. An empty capture is not automatically a workflow step.
- Preserve uncertain relationships as unresolved; never merge solely by `id`, `name`, label, or semantic key.

Acceptance: Repeated unchanged captures add observations without increasing logical step or field counts. Ambiguous merges remain reviewable with provenance.

### SCN-003 — Correct question extraction and widget grouping

Priority: P0. Type: Scanner change.

- Represent each radio group as one question with group label, all observable options, option values, and option-specific locator evidence. Store selection separately under the applicable privacy policy.
- Use associated labels, legends, and accessible-name sources with provenance. Separate help text, placeholders, nearby context, and widget state.
- Exclude entered answers, selected answer text, SVG fallback text, and unrelated descendants from canonical labels. Repair source selection rather than only blacklisting phrases.
- Group combobox input, backing control, and option list only when DOM or accessibility evidence supports the relationship.
- Model phone-country selection as a widget component when appropriate.
- Distinguish upload document role from widget state such as `Replace file`. Leave unknown roles unresolved.
- Preserve requiredness separately with its evidence; a scanned asterisk alone is insufficient verification.
- Missing question labels or incomplete option sets block automatic answer binding for that field.

Acceptance: Synthetic fixtures reproduce the supplied defects and produce clean questions. A row labeled only `NO` cannot become a semantically resolved question.

### SCN-004 — Enforce platform, employer, job, and applicant scope

Priority: P0. Type: Template and strategy change.

Use explicit scope: platform family → structural variant → employer/job inventory → live field instance.

- Keep broadly reusable adapters separate from employer-specific questions.
- Treat the Workable host as a platform identifier, not the full question-inventory scope.
- Prevent Resource Innovations questions from becoming universal Workable requirements.
- Distinguish Manager ownership from Account answer subject.
- Store strategy applicability, Account scope where relevant, source revision, confirmation time, template compatibility, and reconfirmation conditions.
- Include units, currency, period, jurisdiction, and time constraints when relevant to the answer.
- A reusable writing preference may span Accounts; an applicant's eligibility or salary fact must not do so implicitly.

Acceptance: Changing Account invalidates pending answers and approvals. Incompatible employer, job, question, or unit contexts require fresh resolution.

### SCN-005 — Make Template Review evidence-based

Priority: P1. Type: Review UI and validation change. Depends on SCN-002–004.

- Show captures, logical steps, logical fields, unresolved items, and excluded controls as separate counts.
- Show each logical question once, with supporting observations expandable.
- Display question, options, scope, requiredness evidence, locator candidates, grouping evidence, and explicit blockers.
- Keep Account values and Manager-private strategies out of shared review. Show strategy details only in an authorized Manager-specific view.
- Allow supported, manual-only, excluded, and unresolved classifications without relabeling everything as matched.
- Separate **Record review attempt** from **Request capability promotion**. Permit incomplete review records; explain promotion blockers before submission and enforce them server-side.
- Replace universal two-step validation with coverage of declared supported logical steps and, where claimed, observed transitions. A single-page form can have one step.

Track capabilities independently:

| Capability | Required evidence |
| --- | --- |
| Structure reviewed | Coherent logical inventory, reviewed provenance, explicit exclusions and unresolved items |
| Live recognition verified | Correct matches on authorized live or representative test pages, with version and scope |
| Filling verified | Unique targeting, applicable approved answers, adapter tests, and committed-value checks |
| Transition verified | Action and expected next-state evidence with recovery behavior |
| Auto eligible | Validated workflow coverage, interruption recovery, authorization, and outcome evidence |

Replace or precisely constrain legacy `active`. During migration, `active` must not silently grant capabilities stronger than its evidence supports.

Acceptance: Static attestations cannot enable verified filling or automatic execution. Manual-only fields remain visible and are never silently written.

### SCN-006 — Separate extraction, meaning, locator, and answer assessments

Priority: P1. Type: Matching and readiness change.

- Replace overloaded readiness based on `matched` and one confidence score with explicit assessments: extraction quality, semantic resolution, locator uniqueness, cross-capture stability, adapter verification, and answer applicability.
- Record assessed scope, evidence reference, version, result, and blocker for each assessment.
- Label heuristic scores as heuristics rather than probabilities.
- Treat `id`, `name`, and `data-testid` as candidate hints until tested. Scope runtime lookup to the correct document, frame, section, and field instance.
- Rediscover immediately before each write; zero or multiple valid matches require abstention.

Acceptance: Changing upload IDs do not create extra logical questions. A high extraction score cannot override missing question meaning or ambiguous targeting.

### SCN-007 — Add versioned answer resolution and approval

Priority: P0 before field writes. Type: Manager and backend change.

- Profile resolves a current fact from the selected Account.
- Reusable resolves an approved response only within its declared subject and context.
- Generated creates a reviewable draft from permitted, supported facts and job context; missing personal facts remain unresolved.
- Manual produces no automatic write.
- Show the question, available options, proposed answer, source, scope, and readiness together.
- Bind approval to Manager, Account, application, tab/document, field instance and revision, answer revision, and template compatibility.
- Invalidate affected approvals when inputs, question/options, Account, job, or document change.
- Saving a strategy does not authorize all future writes; approval is a distinct action.

Acceptance: A late generation response or obsolete approval cannot replace a newer answer or authorize a changed question.

### SCN-008 — Guarantee controlled execution and cancellation

Priority: P0 before field writes. Type: Extension execution change.

- Allow one active writer per bound application document and coordinate conflicts across tabs or sessions.
- Before every write, check session identity, cancellation epoch, document/frame identity, field revision, approval, answer revision, and current field state.
- If the Manager edited a field after preview or takes over during execution, pause and preserve their work.
- Cancellation blocks all subsequent page writes, including writes triggered by late asynchronous responses. Cancellation does not claim to undo a write already committed.
- Use tested adapters for text, native select, radio groups, and supported comboboxes. Unsupported controls remain manual.
- Verify observable committed state and associated validation errors after each write and relevant rerender. Distinguish displayed value from server acceptance.
- Reconcile after restart, disconnect, or navigation. Never blindly replay uncertain operations.

Acceptance: Tests prove no post-cancellation writes, no overwriting newer user edits, no cross-document writes, and no automatic replay after an uncertain result.

### SCN-009 — Filter data before collection and persist reliably

Priority: P0 at the first collection path. Type: Privacy and recording change.

- Classify sensitivity before reading or queuing values. Never collect passwords, OTPs, authentication tokens, or CAPTCHA responses.
- Keep structural evidence separate from private answers. Avoid raw DOM snapshots and full URLs containing tokens or identifying query values.
- Permit only approved minimum context in model requests. Keep private answers in authorized application storage and document content behind protected references where possible.
- Persist an event schema with session, capture/action ID, monotonic sequence, revisions, result, and recording completeness. Handle duplicate delivery idempotently.
- Specify configurable queue count/byte limits, retention periods, deletion behavior, encryption/access policy, and logout behavior before enabling collection. Select concrete defaults in Phase 0; these are release blockers, not deferred hardening.
- On queue saturation or storage failure, pause collection/execution as needed and visibly mark evidence incomplete. Do not silently drop events or promote incomplete evidence.
- On logout, revoke execution, invalidate approvals, clear transient values, and apply the documented retained-record policy.
- Existing contaminated evidence must be access-restricted and handled under the applicable retention/deletion policy; preserve structural provenance without indefinitely retaining leaked personal values.

Acceptance: Forbidden values never enter queues, logs, shared templates, or model payloads. Simulated data loss marks the affected session incomplete and blocks its promotion.

### SCN-010 — Handle drift and application outcomes

Priority: P1 before Assist release. Type: Lifecycle change.

- Detect changed question meaning, options, grouping, requiredness, and locator behavior.
- Invalidate affected field capabilities and approvals; do not discard unrelated verified evidence automatically.
- Version templates and check strategy compatibility explicitly when versions change.
- Record field results such as verified, rejected, changed, manual required, and unknown.
- For Manager-driven submission, distinguish attempted, success observed, human-confirmed, failure observed, verification required, and unknown. Retain the evidence source.
- A page disappearance or redirect alone is not proof of submission success.
- Unknown submission outcomes require reconciliation, never automatic resubmission.

Acceptance: Drift produces a specific review requirement. Restart after a submission attempt preserves uncertainty until supported evidence resolves it.

## 5. Intended step-by-step product behavior

1. Manager selects the Account, job, and permitted application tab.
2. Backend authorizes access and creates a session bound to those identities.
3. Extension checks document/frame access and reports ready, missing access, or unsupported state.
4. Scanner filters collection, captures the visible step, and records completeness.
5. Scanner constructs logical questions and links observations without duplicating the inventory.
6. Scanner compares scoped template evidence. Unknown or changed fields remain review items.
7. First-time or uncertain steps receive a second capture for consistency checking. Compatible verified steps may use one capture under an explicit policy. Agreement does not prove extraction correctness.
8. Manager reviews unresolved questions and chooses Profile, Reusable, Generated, or Manual handling.
9. Backend resolves scoped proposed answers; generation produces drafts for review.
10. Manager approves specific eligible answers for current field instances.
11. Extension rechecks identity, revisions, cancellation, and locator uniqueness before each write.
12. Scanner verifies committed values and reports field-level results. Takeover pauses execution.
13. Manager handles manual fields, uploads, and attestations, then chooses whether to advance.
14. On a new screen, Scanner reconciles document/step identity and repeats the process. Returning to a prior screen does not imply approval to refill it.
15. Manager reviews and submits; the system records observable outcome evidence and any uncertainty.

Suggested session states: connecting, capturing, needs review, resolving answers, ready for approval, filling, verifying, paused, step complete, outcome pending, closed. Persist state transitions with revision checks; distinguish successful completion from cancellation or unknown outcome.

## 6. Migration of the existing Workable record

1. Preserve an access-controlled source export and schema/version metadata under the retention policy.
2. Mark the record as legacy discovery evidence. Do not promote or automatically grant filling capabilities.
3. Reconstruct candidate capture/step/field relationships using available metadata; record missing evidence explicitly.
4. Propose consolidation groups with provenance. A reviewer must resolve uncertain merges and repeated-section identity.
5. Quarantine polluted labels from canonical matching and shared display; rebuild clean label evidence where possible.
6. Recover missing radio question text, complete options, widget relationships, and upload roles through authorized fresh capture or source payloads.
7. Assign employer/job scope to custom questions.
8. Map old observation IDs to new logical entities without deleting provenance. Migrate strategies only when subject, scope, and field compatibility are established; otherwise require reconfirmation.
9. Produce a migration report: observations processed, logical entities created, uncertain merges, unmapped strategies, redactions, and capabilities withheld.
10. Run migration in a dry-run mode first; make reruns idempotent and support rollback without promoting migrated records automatically.

Do not promise a specific final logical field count or infer genuine transitions from the supplied export.

## 7. Delivery sequence

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| 0 — Audit | Verified capability matrix, integration contracts, data/privacy defaults, supported browser/control scope | First-release scope and concrete constraints documented |
| 1 — Discovery integrity | Identity model, extraction fixes, scoped evidence, persistence, fixtures, migration dry run | Repeated captures remain coherent; no forbidden collection |
| 2 — Review | Logical question UI, evidence assessments, capability gates, blocker explanations | Static review cannot unlock unverified execution |
| 3 — Answer binding | Scoped strategies, Account isolation, versioned generation and approval | Cross-Account and stale-answer tests pass |
| 4 — Visible-step Assist | Narrow tested adapters, cancellation, takeover, read-back, drift and restart handling | Supported fields verified; unsupported cases abstain explicitly |
| 5 — Broader recognition | Held-out employers, conditional fields, repeated sections, more adapters | Scope-specific evaluation passes before expanding support |
| 6 — Transitions | Separately enabled navigation adapters and interruption recovery | Each supported transition has action/outcome evidence |
| 7 — Optional Auto | Explicit workflow authorization and separate submission capability | Coverage, recovery, authorization, and outcomes independently verified |

The current generic Manager Scanner is enabled on supported Workable application pages for explicit, confirmation-gated filling on the visible step. This does not establish Workable-wide recognition or authorize site-specific adapters, navigation, or submission; broader capabilities remain gated on the evidence below. Do not lower confidence thresholds to bypass extraction defects.

## 8. Required acceptance suite

Use synthetic DOM fixtures with explicit expected logical questions and permitted actions, supplemented by authorized representative pages. The supplied text export is diagnostic input; it is not a substitute for missing DOM evidence. Keep a held-out form set separate from development fixtures.

| ID | Scenario | Required result |
| --- | --- | --- |
| A01 | Capture unchanged form 13 times | One logical step and unchanged logical field inventory; 13 separate capture records |
| A02 | Generated upload and listbox IDs change | Same logical widget when contextual evidence agrees |
| A03 | Two employment rows use the same labels/names | Separate instances and approvals; no cross-row fill |
| A04 | Five radio groups contain Yes/No controls | Five correctly labeled questions with complete observable options; missing evidence blocks resolution |
| A05 | Label subtree contains SVG text or entered `dfdfdfd` | Neither becomes canonical label content or shared answer data |
| A06 | Compound widget has visible and backing controls | One logical field only when supported by relationship evidence |
| A07 | Capture occurs while loading or empty | Explicit capture condition; no invented workflow step |
| A08 | Employer-specific question appears on another platform-host page | No unsupported employer-question inheritance |
| A09 | Account changes during resolution/filling | Pending work invalidated; no old Account answer written |
| A10 | Annual salary answer meets hourly question | No silent reuse or conversion without approved applicable input |
| A11 | Cancel while generation is in flight | Late response causes zero subsequent page writes |
| A12 | Manager edits an approved field before its write | Edit preserved; action pauses or requires renewed approval |
| A13 | Locator resolves to zero, multiple, hidden, or wrong-frame targets | No write; specific blocker returned |
| A14 | Widget displays text but has not committed an option | No verified-success claim; manual handling or supported recovery |
| A15 | Queue overflows, storage fails, or event sequence has gaps | Incomplete status visible; affected evidence cannot be promoted |
| A16 | Valid single-page template is reviewed | No artificial two-step requirement |
| A17 | Static review passes with manual-only fields | Structure may be reviewed; no unauthorized field-write capability |
| A18 | Options change or template version becomes incompatible | Affected approvals and capabilities invalidated |
| A19 | Restart follows uncertain submission attempt | Reconciliation or unknown outcome; never automatic resubmission |
| A20 | Password/OTP fields or identifying URL parameters are present | Forbidden values absent from captured payloads, logs, and generation |

All applicable deterministic cases must pass before the corresponding capability ships. For the held-out set, report question extraction accuracy, false merges, target selection correctness, answer-scope correctness, write verification, and abstention rates separately. Zero wrong-person writes, wrong-field writes, post-cancellation writes, or forbidden-value collection are release requirements; report sample sizes rather than implying universal proof.

Phase 0 must set the supported performance envelope: maximum controls, frames, repeated records, mutation frequency, queue size, scan/write timeout, and latency target on a specified test machine. Evaluate within that envelope and publish unsupported cases. Do not use undefined gates such as “robust” or “sufficiently accurate.”

## 9. First-release exclusions

- Automatic Next, Continue, or Submit actions.
- Automatic file uploads, personal attestations, or security challenges.
- Universal support across Workable employers or all ATS platforms.
- Inferring unknown personal facts or missing question meaning.
- Template promotion based solely on checkboxes, repeated IDs, or heuristic confidence.
- Automatic replay after uncertain side effects.

These exclusions describe the proposed first-release scope. Reintroduce capabilities individually only after their evidence and authorization contracts are satisfied.

## 10. Implementation handoff

Start with SCN-001. Then implement the data and extraction foundation before updating review and filling behavior. Each implementation change should include its acceptance cases, migration impact, unsupported cases, and affected capability gates.

Definition of done for the first release: a Manager can select an Account and job, obtain a coherent scoped question inventory, review applicable answers, approve supported visible-step filling, interrupt safely, and see verified results without duplicate observations, leaked personal values, or unsupported readiness claims.
