# Scanner capture reliability

- **Version:** 1.2.0
- **Date:** 2026-10-11
- **Change type:** Modified

## Implemented

- Newly encountered visible steps are automatically captured twice after the
  page settles. The captures are reconciled before fields can be treated as
  verified. Missing, newly appearing, or materially changed observations are
  surfaced for Manager review; unresolved fields remain untouched.
- Later unchanged steps use one capture. A second verification capture is
  conditional on meaningful differences or uncertainty in saved evidence.
- Bounded DOM/ancestor structure and class-name evidence are retained. Class
  names are weak locator hints, not field identity or a durable locator by
  themselves; stable labels, `name`/`id`, ARIA attributes, control type,
  options, and nearby DOM structure take priority.
- Structural evidence does not persist entered field values. Reviewed capture
  evidence can be updated independently of answer-policy history.
- Workable is enabled for the Manager-reviewed Scanner flow: Managers may
  claim its Account row, capture/review visible fields, and apply explicitly
  confirmed fills. Legacy automatic application flows remain blocked, and
  Scanner does not navigate or submit.
- 12 focused unit tests and 7 Scanner/template/learning/safety API integration
  tests passed, as did the server build and changed-script
  syntax checks, Problems check, and `git diff --check` passed. Live ATS
  verification remains outstanding. See the
  [learning-layer implementation plan](../LEARNING_LAYER_NEXT_PLAN.md#two-pass-capture-and-reconciliation-requirements)
  for the behavior contract and verification cases.
