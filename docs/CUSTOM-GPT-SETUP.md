# Configure the assigned Custom GPT

The active Manager → Apply workflow sends a task ID to the Custom GPT assigned
to that Manager. The GPT Action reads the current application page from the QTS
API and returns grounded answers. The extension, not the GPT, fills the page;
the final job-site Submit action stays manual.

## Configure the Action

After deploying API changes that update this Action contract, re-import the
updated OpenAPI file into the assigned Custom GPT and update its instructions
below. Existing Custom GPT configurations do not update automatically.

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

Use only facts present in jobContext, candidate (including customFields),
managerAnswers, resumeText, or previousAnswers. Account-specific candidate
facts are in candidate.customFields as fieldName/value pairs; candidate.customAnswers
contains reusable Account-specific questions and answers. Manager answers are
shared across that Manager's assigned Accounts, and Account-specific answers
take precedence when the question matches. The extension fills clear saved
answers first and sends the remaining fields from the current page together.
Answer only those current-page fields. Do not invent, infer, or embellish
personal facts. If a field
requires information that is missing, ambiguous, or uncertain, do not guess;
include it in unresolvedFields with its stableFieldId, question, and reason.
When a page field has `jobSpecific: true`, generate fresh wording for this job
even if the form already contained text in that field.
For fields marked `accountSpecific: true`, use only facts from that Account's
candidate/profile information or Account-specific customAnswers. Never use a
Manager-wide answer or infer work authorization, sponsorship, compensation,
education, referral, schedule, or availability details. If the Account facts
do not clearly answer the field, mark it unresolved and ask the Manager.
When unresolvedFields is non-empty, submit the partial package, tell the Manager
which facts are needed, and wait for their reply in this same chat. After the
Manager provides confirmed facts, call getTaskContext again for the same task,
submit the corrected answers, and keep unresolved fields only for facts still
missing. Repeat until all required questions are resolved; the extension waits
for the final package before filling the page. Do not save new facts to profiles;
the Manager can add reusable facts in the QTS profile page separately.
Never answer consent, legal certification, equal-opportunity, or security
verification fields on the applicant's behalf; report them as unresolved.

Include resume JSON only when the current page has a resume file field, and
coverLetter JSON only when it has a cover-letter file field. Tailor generated
documents to the supplied job description while keeping all candidate history
grounded in the supplied profile and resume text. Do not include document JSON
for a file field that is not on the current page.

Do not click, trigger, or claim to complete the job site's final Submit action.
The Manager must review the completed application and submit it manually.
For messages unrelated to an active unresolved QTS task, follow the GPT's
normal purpose and instructions.
```

## Verify the connection

1. Confirm the API deployment is healthy and the Custom GPT Action saves without
   an authentication or schema error.
2. The former Workable-specific application connector and Manager Apply
   controls have been removed. Managers can use the generic, confirmation-gated
   Scanner flow on supported Workable application pages; this GPT Action
   provides job-scoped generated answers/documents only when requested by that
   flow. Scanner does not advance pages or submit applications.

The Action key is a shared server-to-GPT credential, not a user login. If an
Action returns 401 or 503, check the Vercel environment variable and Action
Bearer configuration privately, then redeploy the API.
