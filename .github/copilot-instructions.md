# QTS Feature Completion Workflow

When implementing or changing a feature, treat it as complete only after the
relevant checks pass and the change is safely saved for review. Follow
`docs/DEPLOY.md` for deployment boundaries and
`docs/PROJECT-FEATURES-AND-FLOW.md` for the current product workflow.

## Required order

1. Inspect `git status`, the current branch, and its relationship to the
   deployment branch before editing or publishing. Identify pre-existing work
   and keep it separate.
2. Implement the requested feature and update directly related tests and
   documentation.
3. Run the smallest relevant tests, type-checks, and builds. If a check fails,
   fix issues caused by the change; report unrelated baseline failures.
4. Review the final diff and run `git diff --check`. Stage only files or hunks
   belonging to this feature. Never use `git add .` or include unrelated,
   generated, local-data, secret, or reference files.
5. When the feature is verified and can be isolated safely, save it in a
   descriptive commit on a feature branch. Include the repository's required
   Copilot co-author trailer.
6. Push the feature branch for a Vercel Preview deployment when the Git
   remote and Vercel integration support it. Verify the Preview deployment
   when deployment status is available; otherwise report the exact verification
   still needed. Do not claim that a push alone proves a successful deployment.
7. Report the commit, branch, checks, and Preview result. Clearly distinguish
   web/API deployment from the separately distributed Chrome extension.

## Safety boundaries

- Do not rewrite history, force-push, deploy with the Vercel CLI, or promote a
  Preview to Production unless the user explicitly requests that operation.
- A push to the configured production branch can deploy to Production. Do not
  push there as a shortcut for Preview.
- If the current branch contains unreviewed commits ahead of its remote, or
  the worktree has unrelated changes that cannot be cleanly excluded, do not
  publish that branch. Isolate the feature on a safe branch if it does not
  depend on pending work; otherwise stop before commit/push and explain the
  conflict.
- Do not discard, reset, clean, or overwrite unrelated work. Never commit local
  databases, secrets, downloaded references, or generated output unless the
  feature explicitly requires a reviewed runtime asset.
- If a relevant check fails or deployment cannot be verified, do not present
  the feature as successfully deployed. State what passed, what failed, and
  what remains.
- If the user says not to commit, push, deploy, or otherwise publish, follow
  that instruction for the task.
