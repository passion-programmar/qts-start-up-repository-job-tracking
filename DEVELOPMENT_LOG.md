# Development Log

This file records significant implementation milestones, validation, and the next
actionable work item. Add new entries at the top with the date, changed behavior,
files, and verification result.

## 2026-10-11 — Scanner capture reliability implementation

- Implemented automatic settled two-pass capture for newly encountered visible
  steps, field reconciliation, and Manager review of missing, new, or changed
  observations. Unresolved fields are left untouched.
- Later unchanged scans use one capture; a bounded second capture is requested
  only when the saved evidence indicates change or uncertainty. Capture
  failures are surfaced rather than silently accepted as verified.
- Added bounded DOM/ancestor and class-name evidence. Classes remain weak
  locator hints and cannot identify a field or authorize filling. Structural
  checkpoints exclude entered field values; verified evidence is saved without
  changing answer-policy history.
- Updated `LEARNING_LAYER_NEXT_PLAN.md`, `docs/CURRENT-SYSTEM.md`, and the
  Scanner popup description to reflect implemented behavior.
- Validation: focused Scanner reconciliation and application-flow unit tests
  passed (12 tests); Scanner and application-template API integration tests
  passed (4 tests); server build, changed-script syntax checks, Problems check,
  and `git diff --check` passed.
- Remaining: verify behavior against representative live ATS forms, especially
  delayed rendering and real-world discrepancy review.

## 2026-10-11 — In-memory learning expiry and deployment guidance

- Added process-local semantic mappings and answer policies for the default
  in-memory application-session mode.
- Wired learning summary, queue, replay-confidence, confirmation, and assist
  decisions to the in-memory learning store when database persistence is off.
- Applied the same account ownership checks to learning routes for in-memory
  sessions; the assist gate now sees confirmed memory policies during session
  field patches.
- Expire process-local learning state alongside the four-hour session lifetime.
- Added isolated API coverage for in-memory queue/confirmation lifecycle,
  summary, replay confidence, allowed assist reuse, cross-account denial, and
  expiration alongside the application session.
- Registered learning-state cleanup with expired memory-session removal and made
  retrieval paths prune expired sessions before returning them.
- Documented `APPLICATION_SESSION_PERSIST_DB=true` for serverless or
  restart-safe application sessions and learning policies.
- Validation: server TypeScript build passed; focused DB-backed and in-memory
  learning suites passed (7 tests, 0 failures), including expiry cleanup.
- Next: review bounded retention and cleanup for persistent learning policies.

## 2026-10-11 — Learning review lifecycle hardening

- Made the review queue omit fields with a saved learning policy so a completed
  decision no longer reappears as pending.
- Quoted PostgreSQL aliases used by the learning queue; unquoted camel-case
  aliases are folded to lowercase by PostgreSQL and did not match the API's
  expected property names.
- Added focused coverage for approved/blocked assist decisions and queue removal
  after a policy is recorded.
- Changed the learning-store test to import database modules only after setting
  the temporary PGlite path, matching the isolation pattern used by the existing
  integration tests.
- Removed the identifiable fixture rows left by earlier non-isolated test
  attempts from the configured local PGlite database.
- Made popup queue-load and save failures visible to the user, and disabled the
  selected decision button while saving.
- Validation: server TypeScript build passed; popup script syntax passed; isolated
  learning-store tests passed (3 tests, 0 failures).

## 2026-10-11 — Learning review API regression coverage

- Added an isolated PGlite API integration test for learning queue retrieval and
  confirmation routes.
- Verified a saved reusable decision disappears from the pending queue.
- Verified approved reusable values pass the session field gate, while a
  manual-only policy remains `needs_review` when fields are patched.
- Verified learning queue requests require authentication.
- Validation: server build passed; learning-store and learning API suites passed
  together (4 tests, 0 failures).
- Expanded API coverage to verify account-scoped access to an owned session and
  reject reads, assist decisions, and learning confirmations for another
  account's session. The test also verifies denied confirmation writes no
  semantic mapping.
- Validation: server build passed; learning API integration suite passed
  (2 tests, 0 failures).
- Next: review persistence and authorization parity for learning routes when
  application sessions use the in-memory store.
- Keep automatic application/submission disabled while this gate is validated.

## Prior milestones — Learning and assist foundation

- Added persistent semantic mappings, answer policies, learning events, and
  learning API routes.
- Added browser-side learning evidence capture and a popup review queue.
- Added conservative semantic matching and an assist gate that only permits
  user-approved reusable/generated policies above the confidence threshold.
- Kept auto-apply and final submission automation disabled.
- Created `LEARNING_LAYER_NEXT_PLAN.md` as the phased implementation roadmap.
