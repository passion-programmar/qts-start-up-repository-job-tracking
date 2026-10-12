# Learning Layer Next-Phase Implementation Plan

## Objective

Complete the safe transition from a learning-only foundation to a guarded application-assist flow that is consistent with the project’s existing architecture and the implementation spec. The goal is to make the learning layer usable in production without enabling Auto Apply by default, without silent memory reuse, and without unreviewed form submission.

This plan intentionally preserves the repo’s conservative pattern:
- user-reviewed learning confirmations
- policy-based semantic reuse
- confidence-gated assist decisions
- no automatic final submission
- no automatic promotion of unconfirmed memory
- scanner-led template learning that remains distinct from the currently shipped read-only discovery mode

## Current State Summary

The repository already has the core building blocks for the learning layer:
- application-session tracking
- field discovery and persistence
- AI-generated answer handling
- template validation and site detection
- semantic learning storage tables and routes
- extension-side learning confirmation capture
- popup review queue for user decisions
- Manager-shared and Account-specific reusable application-answer stores

The Manager Scanner captures Manager-owned answer strategies separately from structural templates. It can resolve confirmed Profile and Reusable answers, and route Generated Answer fields plus detected resume/cover-letter uploads through the selected job's GPT task. Generated results require Manager review before filling; Scanner uses the description loaded through Get JD and requests one only if still missing. Scanner saves or updates the job, starts the selected Account's exact `todo` row, and operates only on the visible step; it does not advance pages or submit applications. First-time visible-step capture now runs twice automatically and reconciles DOM/field evidence; later scans conditionally repeat verification when evidence indicates change or uncertainty. Scanner supports Workable through Manager-confirmed capture and field filling. Legacy automatic application flows remain blocked on Workable. Remaining work includes broader browser-flow testing, improved confirmation UI, and verification of document/answer handling across real supported sites.

## Non-Goals

The following remain intentionally out of scope for this phase:
- silent Auto Apply
- automatic form submission
- full platform-wide autonomous job application execution
- broad semantic matching across completely different field taxonomies
- unreviewed memory promotion from live browsing sessions

## Guiding Principle

Every reused answer must satisfy the following condition:
- it was observed from a valid application session,
- it was tied to a semantic field identity,
- relevant context (such as destination country, employer, or job) is part of the match when it changes the answer,
- it was accepted under a learned or reviewed policy,
- it exceeds the minimum safety threshold,
- and it is still blocked when the result is uncertain, ignored, or manual-only.

## Phase 1: Safely connect the learning gate to field fill logic

### Goal

Ensure that the application flow checks whether a field can be safely assisted before reusing an answer.

### Work items

1. Review the server-side application session fill pipeline
   - Identify where field matching and answer insertion occur
   - Locate the point where a field is marked as candidate profile, AI-generated, needs review, or manual-only
   - Confirm how fill status is persisted to the session and session field records

2. Integrate the assist decision into the field fill stage
   - Use the evaluation returned by `evaluateAssistDecision(...)`
   - For each field, evaluate in this order:
     - is there a confirmed matching semantic record?
     - is the field approved and policy-compatible?
     - does the confidence exceed the safe threshold?
     - is the field blocked by `requires_review`, `manual_only`, or `ignore`?
   - If blocked, keep the field in review/manual mode and do not auto-fill it

3. Add a safe fallback path
   - If no valid assist decision is available, the system should not guess
   - It should leave the field unresolved or request a manual/user-confirmed answer
   - This keeps the current behavior conservative and aligned with the spec

4. Capture assist decisions in logs
   - Record when a field is allowed, rejected, or deferred
   - Add metadata for policy type, confidence, and reason
   - Keep event logs separated from user-submitted final application records

### Files to touch

- `server/src/services/application-learning-store.ts`
- `server/src/modules/application-sessions/application-sessions.routes.ts`
- `server/src/modules/application-sessions/application-learning.routes.ts`
- optionally `server/src/services/application-session-store.ts` if session field status needs additional metadata

### Acceptance criteria

- A field with approved reusable memory and high confidence can be reused safely
- A field with low confidence or `requires_review` policy is not auto-filled
- A field marked `manual_only` or `ignore` is blocked from assist reuse
- No assist reuse happens without a decision record written to the learning store

## Phase 2: Strengthen semantic matching beyond the current normalization layer

### Goal

Improve matching quality without widening the automation risk.

### Work items

1. Expand label normalization
   - Normalize punctuation, spacing, abbreviations, and common field aliases
   - Build a small canonical vocabulary for common terms such as:
     - `first name` / `given name`
     - `last name` / `surname`
     - `phone number` / `mobile`
     - `visa status` / `work authorization`
     - `address line 1` / `street address`

2. Add semantic grouping heuristics
   - Group related fields by behavioral meaning instead of only literal label text
   - Example groups:
     - candidate_profile
     - work_authorization
     - contact_details
     - employment_history
     - education
     - salary_expectations

3. Create a “match score” model
   - Combine label similarity, section heading similarity, field type compatibility, and past approval history
   - Keep a moderate threshold so that only confident matches become eligible for assist reuse

4. Make the matching model conservative by default
   - Only high-confidence matches should pass the assist gate
   - Ambiguous matches stay in review mode, not auto-fill mode

### Files to touch

- `server/src/services/application-learning-store.ts`
- `server/src/database/connection.ts` (if new indexes or additional semantic metadata are needed)

### Acceptance criteria

- repeated field labels across sessions are mapped to the same semantic identity reliably
- ambiguous cases fall back to review instead of auto-fill
- the confidence calculation remains explainable and auditable

## Phase 3: Improve the review UX and policy decision flow

### Goal

Make the popup review queue behave like a true decision tool, not just a placeholder panel.

### Work items

1. Add explicit review states to the panel
   - `Reusable`
   - `Generated`
   - `Manual`
   - `Ignore`
   - `Ask me again`

2. Improve the answer editor flow
   - Show original answer and edited answer side by side
   - Include labels, field type, section heading, and session context
   - Save a review event whenever a user makes a decision

3. Add a queue summary component
   - show counts by state
   - show average confidence
   - show fields requiring human approval

4. Add user confirmation and audit note support
   - each decision should store who approved it and why, if available
   - allow future review of historical decisions without re-triggering the same question

### Files to touch

- `extension/popup/learning-review-panel.js`
- `extension/popup/popup.html`
- `extension/assets/popup.css`
- `extension/popup/api-client.js`

### Acceptance criteria

- a user can review a field, edit the answer, and persist a learned policy
- the UI clearly distinguishes between `reusable`, `generated`, `manual`, and `ignore`
- the queue reflects actual updated server state after submission

## Phase 4: Teach and update site templates through Scanner confirmation

### Goal

Let a Manager teach Scanner how each site-template field should be answered, then recognize known fields on later applications and pause for confirmation when a field is new, changed, or uncertain. This workflow is implemented as an explicit Manager action; the remaining work is real-site verification and usability hardening, not silent automation.

### Scanner lifecycle

1. The Manager opens the application page and explicitly clicks **Scanner**. Scanner enters the **Get JD** flow to load/extract job details, then asks the Manager to select an Account. The Manager reviews the details and chooses **Save Job & Scan**; this creates or updates the Manager's job and selected Account assignment. Scanner claims that Account's exact `todo` row through the existing Apply-run lock, then uses the row's job-scoped GPT task. Later scans of additional steps resume that same run using its saved run ID; they cannot claim a different processing row. Visiting a job site by itself does not start scanning or filling.
2. Scanner identifies the site template using the normalized site key/host and scans only the currently rendered step. On first-time template setup, each newly encountered visible step is captured twice automatically, without requiring a second Manager click. The second capture runs after the page settles and records the field inventory plus DOM structure and locator evidence, including observed class names. The Manager advances the application manually and clicks **Scan** again on each step they want included; unseen steps are never scanned automatically.
3. Scanner reconciles the two first-time captures before saving or acting on their findings. Fields and locator evidence that agree are treated as stable candidates. Added, missing, or materially changed fields/evidence are marked uncertain and shown to the Manager for review; Scanner must not silently persist or act on a one-pass-only finding as confirmed. The reconciliation must distinguish harmless dynamic attributes from meaningful field/control changes.
4. Class names are captured as supporting locator evidence, not as field identity or a durable locator by themselves. Prefer stable labels, `name`/`id`, ARIA attributes, control type, options, and nearby DOM relationships. Treat generated, hashed, volatile, or contradictory classes as weak evidence; do not reject a field solely because its classes changed, and do not trust a class-only match for filling.
5. On later visits/scans of an established step, take one fresh capture and compare it with the saved template. Run a second verification capture when the initial comparison detects new/missing/changed fields, conflicting locator evidence, or another low-confidence condition. If verification remains inconsistent, pause the affected field for Manager review and leave it untouched; otherwise continue the existing safe-match and confirmation behavior. Do not double-scan every routine repeat scan without a concrete uncertainty signal.
6. For each newly observed field, Scanner presents the question/label, section and step, control type, required state, available options, existing field value, and detected context (for example a country or employer). It proposes a semantic meaning/profile mapping but does not silently make a new answer policy.
7. The Manager selects one of **Profile Answer**, **Reusable Answer**, or **Generated Answer**, reviews the proposed interpretation, and confirms. For Profile Answer, the Manager also chooses the Account if one is not already selected. Cancel leaves the field unresolved and writes no answer/policy.
8. Scanner saves the field structure, stable field identifier, semantic group, context, selected strategy, confirmation/audit information, and references to answer sources in the site-specific template. The template is the central site-specific map/rulebook, not a vault containing copied Account values or generated application prose.
9. For a later application, the Manager again clicks **Scanner**. Scanner loads the confirmed template, compares the currently rendered fields, and applies the stored strategy to confident matches without asking the Manager to teach unchanged fields again. It does not scan future steps until the Manager opens them and scans.
10. Scanner tells the Manager about a new, changed, or uncertain field before changing the template. Once the Manager confirms the interpretation/strategy, Scanner performs that confirmed action, saves the template update as a new revision, and then continues with other safe matches. If the Manager declines or defers, it leaves that field untouched and unresolved.
11. For a field value sourced from a profile or reusable answer, Scanner may fill only under the approved assist gate and should report success/failure per field. Generated Answer is sent through the current job’s GPT task and is applied only after a result is returned and checked against the control.
12. The Manager reviews the completed visible step and decides when to advance. Scanner never clicks a final Submit, Apply, Finish, or equivalent submission control. Read-only discovery remains distinct and must never fill or navigate.

### Two-pass capture and reconciliation requirements

- The two first-time captures are automatic, consecutive observations of the same currently visible step; this is not two Manager actions, a navigation, or a scan of the entire site.
- Capture the DOM structure needed to identify each control and its surrounding label/section relationships, as well as the current supported locator signals. Include class names in the evidence record, retaining their role as weak hints.
- Compare normalized field identity and structure rather than raw DOM serialization. Ignore known volatile values (for example generated IDs/classes or transient state) where they do not alter control identity; never silently erase genuine field changes as noise.
- Merge corroborated observations. Keep disagreements as explicit uncertainty with both observations/evidence available to the Manager; do not pick whichever pass appears more convenient.
- First-time confirmed template records must indicate that the field was observed consistently across both captures, or that the Manager reviewed and resolved a discrepancy. A single-pass observation is not a confirmed stable field.
- A later conditional verification is triggered by field-set differences, meaningful structure/control changes, locator conflicts, or low match confidence. If the second observation still disagrees, stop automated handling for those affected fields and request Manager review.
- Locator selection and fill-time validation must prefer stable, semantically meaningful evidence. Class names can contribute to confidence when stable across captures, but cannot alone establish semantic identity or authorize filling.
- Preserve current safeguards: only the visible step is inspected, no answer policy is silently created, existing per-field Manager confirmations remain required, and Scanner never advances or submits.

### Implementation and verification checklist

**Status:** Items 1–8 are implemented with focused automated coverage. Real-site
browser verification remains outstanding; see the dated implementation entry in
`DEVELOPMENT_LOG.md`.

1. Extend the Scanner capture contract to return the control's relevant DOM/ancestor structure and class-name evidence without persisting full page markup or unrelated sensitive data.
2. Add a bounded page-settle wait and automatic second capture for first-time step/template observations; avoid indefinite polling and surface capture failures instead of falling back to a success-shaped single scan.
3. Add normalized reconciliation for field-set, question/label, control type, required/options, context, and locator evidence; identify field-level discrepancies and preserve evidence for Manager review.
4. Persist evidence and confirmation state in the appropriate structural template/version record without copying profile values or generated application content.
5. Add one-pass later-scan comparison plus conditional second verification for meaningful differences/uncertainty. Ensure unchanged later scans remain a single capture.
6. Harden locator matching so generated/volatile classes do not become stable identity, and class-only evidence cannot authorize a fill.
7. Test first-pass agreement, one-pass-only appearance/disappearance, class-only changes, stable classes plus changed label/control, volatile class changes with stable semantic locators, later unchanged one-pass behavior, conditional verification, repeated disagreement, and capture errors.
8. Validate that discrepancies are visible to the Manager, unresolved fields remain untouched, and existing profile/reusable/generated answer and manual-submission behavior is unchanged.

### What belongs in the site template

Store per site/step/field:

- stable field and step identifiers plus locator evidence needed to rediscover the live control, including relevant DOM/ancestor structure and class names as weak supporting hints;
- question wording and normalized semantic identity/group;
- control type, required state, option signature, and section;
- answer-changing context dimensions and extracted values, without collapsing them into the semantic group;
- the Manager-confirmed answer strategy (`profile`, `reusable`, `generated`, or explicit manual handling);
- for Profile Answer, the profile-field key to look up (not the Account’s value);
- for Reusable Answer, a reference to the confirmed reusable Q&A record (not a second copy of its answer);
- for Generated Answer, the field/task contract (not the future generated answer);
- template revision, confirmation actor/time, change reason, and prior revision reference.

Do not store private profile values or per-job generated answer text in a site template. Resolve Profile Answer against the selected Account at application time; load Reusable Answer from its existing owner-scoped Q&A store; keep Generated Answer on its specific task/application. This gives the Manager one central site-template rulebook while preserving answer ownership and lifetime.

### First-time setup versus a later application

**First time (teach and confirm):**

1. Manager clicks Scanner and selects/identifies the site template.
2. Scanner takes two automatic captures of the open step, including its relevant DOM and locator evidence, then reconciles the results and shows corroborated fields plus any disagreements. Manager review is required to resolve uncertain discrepancies; a field seen in only one pass is not marked confirmed by default.
3. For each field, Manager confirms its meaning and chooses Profile, Reusable, Generated, or manual handling.
4. For Profile, Manager maps to a specific Account profile key. If its value is missing, Manager may type an answer for this application only; it is not persisted to the profile or reusable Q&A.
5. For Reusable, Manager types/edits the answer and confirms that it should be reusable. Save the question and answer to Manager Q&A, then store the Q&A record reference and strategy in the template. A failed save means the choice is not committed and Scanner must show the error.
6. For Generated, associate the field with the active job/task. GPT uses the current question/job context and only necessary verified Account facts; the result is stored with that task, never implicitly made reusable.
7. Manager manually advances to each additional desired step and clicks Scan. Each newly encountered step receives the same two-pass capture/reconciliation during initial setup. Rescanning an established step uses one capture unless a difference or uncertainty triggers a second verification; each distinct step is recorded once.

**Later application (recognize and assist):**

1. Manager explicitly clicks Scanner and selects the Account/application context.
2. Scanner loads the active confirmed site-template revision and takes one capture of the visible step. If that capture reveals meaningful differences, conflicting locator evidence, or low confidence, Scanner takes a second verification capture before deciding which fields can proceed.
3. Confident unchanged fields use their saved strategy: Profile reads the selected Account’s current value, Reusable loads the explicitly confirmed Q&A answer for the same semantic meaning, and Generated requests a fresh GPT answer for this job.
4. A semantic-equivalent field with changed context (for example relocation to Japan versus Canada) still matches a Manager-confirmed Reusable Answer. Context is retained for display/audit and passed to Generated Answer; Profile Answer still reads the selected Account. The explicit Reusable choice means the Manager accepts the same answer for future variants of that semantic field.
5. Scanner presents differences/new fields for Manager decision. After confirmation it applies the selected strategy, records a new template revision, and continues; decline/skip leaves the field unresolved.
6. Scanner reports what it filled, generated, skipped, or could not match. Manager reviews all values and manually controls navigation/final submission.

### Confirmation choices and data ownership

The confirmation UI must distinguish these three answer strategies:

- **Profile Answer:** read the selected Account’s existing profile or Account-specific Q&A. This is a source mapping, not a duplicate profile write. Require an explicitly selected Account. If a needed value is absent or ambiguous, pause for Manager input; the Manager-provided fallback is for this application only and must not be written to the Account profile or reusable Q&A. Keep it with the current job/application field only. Do not silently use a Manager-wide answer for candidate-specific facts.
- **Reusable Answer:** let the Manager enter or edit the answer and explicitly confirm reuse. On confirmation, persist both the question and answer in the Manager’s existing reusable custom-Q&A store (`manager_custom_application_answers`) and bind the site-template field rule to that confirmed reusable entry. Do not report success unless the answer was saved. Do not save on cancel, dismiss, or any non-reusable choice.
- **Generated Answer:** send the current field question, relevant job context, and only the necessary confirmed Account/profile facts to the assigned GPT task. Store the returned answer against that job/task and field; never promote the generated text to reusable memory implicitly. If there is no matching active task/GPT assignment, report that generation did not occur and leave the field unresolved.

The site template is the authoritative location for site-specific field identity, semantic mapping, and the selected answer strategy. Keep actual reusable answers in the existing reusable Q&A store, profile values in the selected Account’s existing data, and job-specific generated answers with the GPT task. Link these stores by stable IDs/keys where available rather than copying answer text into templates. This preserves the user’s “one template per site” workflow without mixing ownership or answer lifetimes.

### Matching and changed-field handling

Do not use a DOM selector, raw label, or semantic category alone as the identity of a field. Compare a combination of normalized question meaning, field/control type, answer choices, section/step, stable field fingerprint, and meaningful context entities. Context entities (for example a country, employer, or job) must be retained in the field rule and in answer matching whenever they can change the correct answer.

For each later scan:

1. **Confident semantic match:** keep the confirmed template strategy. Profile Answer resolves against the selected Account and its relevant context. Generated Answer is freshly requested for the current job. A Manager-confirmed **Reusable Answer** is intentionally reusable for future fields with the same semantic meaning even when contextual details in the question change (for example, “relocate to Japan” → “relocate to Canada”). The confirmation means the Manager approves that answer for the semantic field, not only the exact original wording/context. Do not reuse it if the field's semantic meaning is different or its control cannot accept the answer.
2. **Same meaning, changed wording or technical locator:** show old and new representations to the Manager. After confirmation, update the current template version and retain the previous confirmed revision for audit/rollback. Refresh locator metadata when needed. Do not overwrite history.
3. **Changed choices, field type, required status, or section/context:** tell the Manager what changed and ask them to confirm the semantic mapping/strategy before updating the template. If they confirm the same semantic field and the answer is a Manager-confirmed Reusable Answer, apply that saved answer even when contextual details changed, provided the control accepts it. Never force an answer into an unavailable choice or an incompatible control.
4. **Different meaning:** create a separate field rule; do not replace the old rule or inherit its answer. Preserve old rules as history/orphaned mappings until explicitly retired.
5. **Unclear match:** treat it as new and pause. Do not silently reuse an answer or mutate the active template.

Semantic groups may be shared while context remains recorded separately. For example, “Are you willing to relocate to Japan?” and “Are you willing to relocate to Canada?” can share the semantic group `relocation_willingness` while retaining the destination as field context. If the Manager marked the answer reusable, that explicit choice authorizes reusing the same answer across those destination variants after the Manager confirms a newly detected template variation. Profile Answer matching remains Account/context-aware, and Generated Answer always receives the current context. Different semantic meanings are never treated as equivalent.

### Detailed implementation work items

1. **Keep current behavior accurately labeled**
   - Preserve **Get JD** as job-detail capture.
   - Keep current read-only **Site template discovery** separate from the planned teaching/assist Scanner.
   - Do not enable any Manager fill path until the dedicated confirmation and safety implementation is complete.

2. **Define and persist template identity/revisions**
   - Normalize site key/host consistently; do not merge different sites/platforms accidentally.
   - Give each field a stable template identity independent of volatile CSS selectors.
   - Persist step membership, semantic group, question, control metadata, answer-changing context, and confirmation state.
   - Keep current and prior confirmed revisions. A repeated scan of one step updates its current observation; it does not append duplicate steps.
   - Avoid adding a parallel answer table if current template metadata can hold the rule and references safely. Add schema only for missing revision/strategy/reference data.

3. **Build the explicit Scanner entry point**
   - Add a clearly named **Scanner** control that the Manager must click.
   - Require a valid Manager session and an extractable page; explain when the page is unsupported or not an application form.
   - Scan only the currently visible step. Do not click navigation or final controls.
   - Show per-field scan state and distinguish read-only structural discovery from confirmed Scanner setup/assist.

4. **Create the field interpretation/confirmation UI**
   - Show label/question, normalized meaning, field type, required status, section/step, choices, current value, and meaningful context.
   - Let the Manager correct the proposed meaning/context and choose **Profile Answer**, **Reusable Answer**, **Generated Answer**, or manual/skip handling.
   - Do not commit a new strategy or answer on modal close, cancel, network error, or failed validation.

5. **Implement Profile Answer resolution**
   - Require an explicitly selected Account for profile-backed values.
   - Map the site field to an existing structured profile key or Account-specific Q&A entry; do not copy the value into the template.
   - Resolve current value at application time and enforce Manager-to-Account authorization on the server.
   - If no profile value exists, ask Manager for a one-time answer scoped to this application field/task. Never persist that fallback to Account profile or Manager reusable Q&A.
   - If multiple profile keys could match, the Account changes, or the value is context-sensitive/ambiguous, pause rather than choose automatically.

6. **Implement confirmed Reusable Answer persistence**
   - Let the Manager type or edit the answer and explicitly choose **Reusable Answer**.
   - Persist question + answer in the existing Manager custom-Q&A store and return its record identifier.
   - Link the site-template rule to that answer record and semantic group; avoid duplicating answer text in the template.
   - Define deterministic duplicate behavior: same Manager + normalized semantic question updates/reuses the existing record only after confirmation; otherwise create a separate entry. Preserve ownership boundaries.
   - Show success only after durable persistence. On failure, retain the entered text in the UI for retry but leave the template strategy uncommitted and show an explicit error.

7. **Implement Generated Answer routing**
   - Require a current job/task and assigned GPT before choosing this strategy.
   - Send the field question, relevant current job description/context, answer choices, and only necessary verified Account facts.
   - Receive and validate the answer against the live control; leave unresolved if GPT fails, lacks evidence, or proposes an unavailable option.
   - Store returned answer only on the specific GPT task/application field. Never store generated prose as reusable Q&A without a separate explicit Manager action.

8. **Implement semantic matching with separate context**
   - Match by normalized question meaning, control compatibility, options, step/section, stable fingerprint, and prior Manager confirmation.
   - Extract and persist meaningful dimensions (country, employer, role, job, etc.) separately from semantic group.
   - For Manager-confirmed **Reusable Answer**, reuse the saved answer for later fields with the same semantic meaning even if the contextual wording/value differs (including Japan/Canada or other context changes). This is the Manager’s explicit broad semantic reuse decision.
   - Do not require context equality for a confirmed Reusable Answer, but retain context in the UI/audit record. For Profile Answer, resolve the selected Account’s field; for Generated Answer, always send current context to GPT.
   - Never equate different semantic meanings. Confirm semantic match and ensure the answer is structurally accepted by the control (including available select/radio choices); otherwise pause.

9. **Build new/changed field review**
   - Compare old/new question wording, semantic suggestion, context, control type, required state, choices, step/section, and locator.
   - For same meaning with wording/locator changes: ask Manager to confirm continuity, update active rule after confirmation, and keep prior revision.
   - For same meaning with context changes: explicitly show the changed context; after Manager confirms the semantic match, apply a confirmed Reusable Answer across the context change.
   - For changed choices/type/required state: require Manager confirmation and validate answer compatibility before applying.
   - For a different meaning: add a separate field rule; do not replace or inherit the old answer.
   - For uncertain matches: treat as new and pause. Offer confirm existing, edit/remap, add as new, leave manual, and cancel.
   - Apply the confirmed Manager choice to the current field only after the decision is saved successfully.

10. **Handle disappearing/repeated/conditional fields**
    - Rescan after Manager-driven changes reveal conditional controls; newly revealed fields enter the same matching/review process.
    - Do not delete a template rule because it was absent from one scan; mark it not observed and retain history.
    - Match repeated labels using step/section/context and stable semantic identity; do not merge unrelated fields that happen to have identical text.
    - Report duplicate/ambiguous matches and require Manager mapping.

11. **Integrate guarded assist**
    - Only after Scanner confirmation and storage work, connect confirmed strategies to the fill pipeline.
    - Run the learning/assist gate before every fill; blocked, missing, low-confidence, incompatible, or failed answers remain unresolved.
    - Never overwrite a non-empty live value without explicit Manager approval.
    - Require Manager review before advancing and keep final Submit/Apply/Finish manual.
    - Keep unsupported platforms and legacy automatic application flows blocked; allow Workable only through Manager-confirmed Scanner captures and field fills. Never advance or submit.

12. **Add observability and rollback**
    - Record who confirmed a strategy/change, when, before/after field metadata, template revision, answer strategy, and outcome.
    - Provide rollback to a prior confirmed template revision.
    - Keep cleanup limited to stale unconfirmed evidence; never expire confirmed reusable Q&A, active template rules, or job/task answers under an unrelated cleanup policy.
    - Surface API, GPT, matching, and persistence failures in the extension; do not silently fall back to a success-shaped result.

13. **Roll out in safe stages**
    - Stage A: read-only scan and diff display, no fill.
    - Stage B: Manager confirms and saves template rules/Reusable Answers; no automatic fill.
    - Stage C: opt-in assist for low-risk, confidently matched fields with a visible review log.
    - Stage D: expand strategies only after regression tests and Manager feedback; final submission remains manual in every stage.

### Acceptance criteria

- Scanner starts only on an explicit Manager click; it is not automatically triggered by visiting a site. The first confirmed scan records one site template with observed steps and per-field answer strategies; repeat scans of the same step update it rather than creating duplicate steps.
- A manually typed answer is saved as reusable question/answer data only after the Manager explicitly confirms **Reusable Answer**; cancel/error does not create or update a reusable entry. That explicit decision authorizes reuse for later fields with the same semantic meaning despite changed contextual wording/value.
- Profile Answer reads only the selected Account’s existing profile/Q&A and does not create a duplicate profile entry through Scanner.
- When a Profile Answer is missing, a Manager-entered fallback is stored only with the current job/application and is not persisted to the Account profile or reusable Q&A.
- Generated Answer is requested from GPT with current job context and stored only with that job/task; no GPT assignment/task produces a visible unresolved state.
- A same-meaning edit updates the current template version only after Manager confirmation and preserves the prior revision.
- A different-meaning field becomes a separate rule and does not inherit the old answer.
- Matching records answer-changing context. A Manager-confirmed Reusable Answer is reused across context variants (including the Japan/Canada relocation example) when the semantic meaning matches; the Manager confirms a newly detected template variation before the template is updated. Profile Answer remains Account/profile-key based, and Generated Answer receives the current context.
- New, materially changed, or uncertain fields pause for a Manager decision; no silent template mutation or answer reuse occurs.
- Template promotion/activation and any field filling remain separately gated. Final submission stays manual.

### Validation requirements

- Unit tests for semantic identity versus context extraction and exact context-aware answer matching.
- API tests for authenticated Manager scope, cross-Manager/Account denial, reusable Q&A persistence, duplicate handling, and failed writes.
- Scanner/template tests for first scan, repeated same-step scan, multi-step checkpoints, confirmed same-meaning updates, different-meaning additions, changed options/types, revision rollback, and unresolved cases.
- GPT task tests proving generated answers remain job/task-scoped and are not promoted to reusable answers.
- Extension tests proving no final-submit action is triggered and no application fill occurs from read-only discovery mode.

## Phase 5: Build validation and test coverage around the learning gate

### Goal

Prove the behavior works safely and predictably before enabling stronger automation paths.

### Work items

1. Add integration tests for learning confirmations
   - confirm that a valid policy is stored
   - confirm that a blocked policy does not allow assist reuse
   - confirm that repeated low-confidence fields are rejected

2. Add session-level tests for auto-assist safety
   - create a fake application session
   - add one approved field and one blocked field
   - assert that the assist decision only allows the approved one

3. Add regression tests around confidence scoring
   - ensure edited answers increase/modify the confidence path correctly
   - ensure manual-only and ignore policies stay blocked even if semantic similarity is high

4. Validate API contracts
   - ensure return payloads from `learning-summary`, `learning-queue`, `replay-confidence`, and `assist-decision` are stable and predictable

### Files to touch

- `server/src/modules/application-sessions/application-templates.routes.integration.test.ts`
- potentially new targeted test files under `server/src` if needed

### Acceptance criteria

- all assist-gate tests pass under both approved and blocked conditions
- no unreviewed field becomes eligible for auto-fill
- learning-policy decisions remain deterministic and explainable

## Phase 6: Prepare for a controlled Assist path, not full Auto Apply

### Goal

Only after all safety checks pass, start exposing a limited assist feature behind review and configuration flags.

### Work items

1. Add a feature flag for assist reuse
   - default to off
   - allow opt-in for testing environments or trusted accounts

2. Require explicit review for any new learned policy
   - no policy is accepted silently
   - no policy is promoted automatically to active assist memory

3. Restrict assist fill to non-sensitive fields first
   - start with simple profile fields, not compensation, document uploads, or sensitive issue responses

4. Add telemetry and review logs for mistakes
   - track accepted vs rejected assist fills
   - allow rollback of policy decisions if a bad pattern is discovered

### Acceptance criteria

- assist mode is not enabled by default
- every assist fill is either user-confirmed or explicitly permitted in a restricted, audited flow
- unsafe or ambiguous field categories remain non-autonomous

## Phase 7: Future expansion after safety is proven

### Goal

Only after the above phases stabilize, consider the next wave of enhancements.

### Candidate additions

- more advanced semantic graphs and cross-session matching
- learning from successful manual edits and rejections
- user-tunable confidence thresholds and per-field safety profiles
- stronger event records for chronology and action reasoning
- richer replay-confidence scoring using actual answer consistency over time

These should remain opt-in and reviewable, not default behavior.

## Detailed Execution Order

1. Keep the current Manager scanner read-only until an explicitly separate, confirmed Scanner workflow is implemented.
2. Implement the Scanner confirmation flow and per-template semantic/context mappings.
3. Save confirmed manually entered reusable question/answer pairs to the existing Manager Q&A store.
4. Resolve Profile Answer from the selected Account’s existing profile/Q&A, and keep Generated Answer job/task-scoped through GPT.
5. Implement changed-field comparison, Manager confirmation, template revision history, and rollback.
6. Integrate the assist decision into the application fill pipeline and block unsafe fields before fill.
7. Add focused tests for answer ownership, context matching, safe reuse, and rejection.
8. Add feature flags and controlled Assist rollout; keep final submission manual.
9. Only then consider broader automation features.

## Risk Controls

The project should not advance beyond this phase until all of the following are true:
- assist decisions are deterministic and auditable
- matching remains conservative and explainable
- field identity retains answer-changing context; cross-context reuse is allowed only when the Manager explicitly confirmed the answer as reusable for that semantic group
- user confirmation is required before a policy becomes active
- unsafe or ambiguous results remain in review/manual mode
- a changed template is never overwritten without confirmation and revision history
- confirmed reusable answers are not subject to stale unconfirmed-evidence cleanup
- the system continues to reject silent Auto Apply

## Definition of Done for this Next Phase

The next implementation phase is complete when:
- the learning gate is integrated into the real application fill path,
- Scanner can capture confirmed per-field strategies and handle new/changed fields through Manager review,
- reusable/profile/generated answers are stored and scoped according to their distinct ownership and lifetime,
- assist decisions are based on policy + confidence + evidence,
- low-confidence or blocked fields remain manual/review-only,
- the review queue is accurate and usable,
- targeted tests verify the safety gate works as intended,
- and no default automation path is enabled.

## Recommended Immediate Next Action

Keep Scanner opt-in and final submission manual. Implement and test the two-pass initial visible-step capture, evidence reconciliation, volatile-class handling, and conditional verification on later scans. Then exercise the complete flow on supported sites, replace prompt-based decisions with accessible in-popup UI, and add focused tests for generated-answer review, generated document uploads, and field-locator failures. Scanner must claim only the selected Account's exact saved `todo` row and must not overwrite an active/closed GPT task.
