# Configure the assigned Custom GPT

The active Manager → Apply workflow sends a task ID to the Custom GPT assigned
to that Manager. The GPT Action reads the current application page from the QTS
API and returns grounded answers. The extension, not the GPT, fills the page;
the final job-site Submit action stays manual.

## Configure the Action

1. Deploy the API with `GPT_ACTION_API_KEY` set to a strong random value. Set
   `CRON_SECRET` separately so Vercel can run the daily task-context cleanup.
2. In the Custom GPT editor, add an Action by importing
   [the QTS OpenAPI contract](./openapi/custom-gpt-application-actions.yaml).
   The production server is `https://qts-job-tracking.vercel.app`; change the
   server URL in the contract only if deploying to a different API origin.
3. Set Action authentication to **API Key**, **Bearer**, and enter the same
   `GPT_ACTION_API_KEY` value configured on the API deployment. Never paste the
   key into GPT instructions, source code, or a conversation.
4. Save the GPT and assign it to the Manager in QTS. Reload the unpacked
   extension after installing an extension update.

## Add these GPT instructions

```text
QTS APPLICATION TASK PROTOCOL

When a message is exactly in the form `PROCESS_TASK: task_<uuid>`, use the QTS
Actions for that task. Call getTaskContext first. Handle only the current page
returned by that Action. Return each answer with the exact stableFieldId from
the page, then call submitTaskPackage once for that page.

Use only facts present in jobContext, candidate, managerAnswers, resumeText, or
previousAnswers. Do not invent, infer, or embellish personal facts. If a field
requires information that is missing, ambiguous, or uncertain, do not answer it;
include it in unresolvedFields with its stableFieldId, question, and reason.
Never answer consent, legal certification, equal-opportunity, or security
verification fields on the applicant's behalf; report them as unresolved.

Include resume JSON only when the current page has a resume file field, and
coverLetter JSON only when it has a cover-letter file field. Tailor generated
documents to the supplied job description while keeping all candidate history
grounded in the supplied profile and resume text. Do not include document JSON
for a file field that is not on the current page.

Do not click, trigger, or claim to complete the job site's final Submit action.
The Manager must review the completed application and submit it manually.
For messages that are not a PROCESS_TASK command, follow the GPT's normal
purpose and instructions.
```

## Verify the connection

1. Confirm the API deployment is healthy and the Custom GPT Action saves without
   an authentication or schema error.
2. In the QTS extension, sign in as a Manager who has this GPT assigned. Use
   **Apply** on a supported Workable job in that Manager's job list.
3. Confirm the extension opens the assigned GPT and sends a `PROCESS_TASK:
   task_<uuid>` message. Allow the GPT Action call if ChatGPT asks for approval.
4. Confirm the extension receives a ready package and fills the current page.
   For missing facts, consent, CAPTCHA, or other review conditions, verify it
   pauses rather than guessing or bypassing the check.
5. Review the final application page and click the job site's Submit button
   yourself. Confirm the resulting status in QTS.

The Action key is a shared server-to-GPT credential, not a user login. If an
Action returns 401 or 503, check the Vercel environment variable and Action
Bearer configuration privately, then redeploy the API.
