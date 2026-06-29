# QTS Application Workflow — Extension + Custom GPT + Server

> **Current system (June 2026):** See [docs/CURRENT-SYSTEM.md](docs/CURRENT-SYSTEM.md) � extension v1.13.25+, job sites, one-step auto-apply.

**File:** `QTS-APPLICATION-WORKFLOW.md`  
**Version:** Extension **v1.7.7** · corrected architecture and operating rules  
**Scope:** Current justjoin.it Easy Apply workflow plus the target page-by-page workflow  
**Audience:** Developers and bidders setting up, using, or debugging the application pipeline

Related guides:

- `QTS-JOB-TRACKING-EXTENSION-GUIDE.md` — extension installation and job capture
- `QTS-JOB-TRACKING-CUSTOM-GPT-GUIDE.md` — Custom GPT setup, instructions, authentication, and Actions
- `docs/JUSTJOIN-APPLY-TEMPLATES.md` — justjoin.it application templates
- `docs/openapi/custom-gpt-application-actions.yaml` — GPT Action OpenAPI definition

---

## 1. System purpose

The system helps a bidder prepare and fill a job application while keeping final submission under the bidder’s control.

The three main components are:

| Component | Responsibility |
|---|---|
| **Chrome extension** (`QTS_Startup`) | Detects the job, loads the selected candidate, scans the current application step, fills verified profile data, starts GPT processing, retrieves results, uploads generated documents, and manages page-by-page progress |
| **QTS Node API server** | Stores candidates, jobs, application sessions, discovered fields, task status, generated answers, and document files; exposes separate endpoints for the extension and Custom GPT |
| **Custom GPT** (`QTS-Job-Tracking`) | Retrieves one task through GPT Actions, generates job-specific answers and document JSON, and sends the completed package back to the server |

The Custom GPT does **not** inspect the job website, click job-site controls, upload files, or submit applications. The extension performs all job-page interaction.

```text
┌─────────────────┐    scan / fill / upload    ┌──────────────────┐
│ Chrome extension│ ◄────────────────────────► │ Job application  │
│ + content script│                             │ page             │
└────────┬────────┘                             └──────────────────┘
         │
         │ create/update task, poll result, download PDFs
         ▼
┌─────────────────┐      GPT Actions      ┌──────────────────────┐
│ QTS API server  │ ◄────────────────────►│ Custom GPT in        │
│ + database/files│                        │ ChatGPT              │
└─────────────────┘                        └──────────────────────┘
```

---

## 2. Important operating boundaries

### 2.1 A Custom GPT is not a headless API

The server cannot directly “wake up” or invoke a Custom GPT by GPT ID. A Custom GPT runs inside ChatGPT and requires a ChatGPT conversation.

This architecture therefore uses a real Custom GPT page in Chrome.

### 2.2 The pinned GPT tab is visible, but can remain inactive

The extension may reuse one pinned Custom GPT tab.

```text
[Job application tab] [GPT icon]
        active          pinned/inactive
```

The bidder normally remains on the job page. The pinned GPT tab is still visible in Chrome’s tab bar; it is not an invisible or offscreen GPT service.

### 2.3 Automatic message insertion is experimental UI automation

The extension may attempt to insert and send:

```text
PROCESS_TASK: <taskId>
```

inside the Custom GPT message composer.

This is browser-page automation, not an official Custom GPT invocation API. ChatGPT page changes, login screens, action approvals, usage limits, frozen/discarded tabs, or security checks may interrupt it.

The supported and reliable part is:

```text
Running Custom GPT conversation
        ↓
GPT Action GETs task from QTS server
        ↓
GPT Action POSTs result to QTS server
```

The extension must provide a manual fallback when automatic message insertion does not work.

### 2.4 Do not automatically approve ChatGPT Action dialogs

ChatGPT may ask the bidder to approve an Action. The extension should detect the waiting state and notify the bidder, but it must not depend on automatically clicking **Allow**.

### 2.5 Never automatically submit the job application

The extension may scan, fill, upload, validate, and navigate through intermediate steps. It must stop at **Review**, **Submit**, **Apply**, **Finish**, or an equivalent final action.

---

## 3. Current implementation versus target workflow

| Capability | Status |
|---|---|
| Detect justjoin.it Easy Apply form | Implemented |
| Load a selected candidate | Implemented |
| Scan the current rendered application page | Implemented |
| Fill verified candidate fields | Implemented |
| Create an application session and GPT task | Implemented |
| Open/reuse pinned Custom GPT tab | Implemented or in active development |
| Automatically insert `PROCESS_TASK` into ChatGPT | Experimental and UI-dependent |
| GPT retrieves task through Actions | Implemented |
| GPT posts answers and document JSON to server | Implemented |
| Server renders resume and cover-letter PDFs | Implemented |
| Extension downloads and uploads generated resume | Implemented |
| Page-by-page processing for general multi-step platforms | Target architecture; implement incrementally |
| Completely invisible/headless Custom GPT invocation | Not supported |
| Automatic final job submission | Intentionally not supported |

Do not describe an experimental or planned feature as guaranteed production behavior.

---

## 4. Identity model: application ID, task ID, and conversation

The workflow uses three related but different identifiers.

### 4.1 `applicationId`

Internal database identifier for the complete application session.

Example:

```text
applicationId: 8
```

### 4.2 `taskId`

Public-facing random task identifier used between the extension, server, and Custom GPT.

Recommended format:

```text
task_7f84c21e-2f34-4fd2-96e1-1f4216f3ad92
```

Do not use predictable IDs such as `task_8` as the only authorization boundary. Existing `task_8` formatting may remain as a temporary legacy alias, but production tasks should use random, unguessable identifiers and ownership checks.

### 4.3 Conversation

Use one fresh Custom GPT conversation for each application.

```text
Application A → taskId A → fresh GPT conversation A
Application B → taskId B → fresh GPT conversation B
```

Reuse the same pinned Chrome tab, but do not reuse the same conversation for unrelated applications.

### 4.4 Task ID lifetime

One application keeps the same `taskId` across all of its pages:

```text
Page 1 ─┐
Page 2 ─┼─ task_7f84...
Page 3 ─┤
Review ─┘
```

Create a new `taskId` only when starting a new application, changing the selected candidate for a new application, or intentionally creating a separate retry.

---

## 5. Correct end-to-end sequence

```mermaid
sequenceDiagram
  participant Bidder
  participant Site as Job site
  participant Ext as Extension
  participant API as QTS Server
  participant GPTTab as Pinned GPT tab
  participant GPT as Custom GPT

  Bidder->>Site: Open job and application form
  Bidder->>Ext: Select candidate and Start Application
  Ext->>API: POST /api/application-sessions
  API-->>Ext: applicationId + random taskId

  Ext->>Site: Scan current rendered application step
  Ext->>API: PATCH session fields for current step
  Ext->>Site: Fill verified candidate-profile fields

  alt Required narrative answers or generated documents are needed
    Ext->>GPTTab: Open/reuse pinned tab and start fresh GPT conversation
    Ext->>GPTTab: Attempt to insert PROCESS_TASK: taskId
    Note over Ext,GPTTab: UI automation is experimental; manual send is fallback
    GPT->>API: GET /api/application-tasks/{taskId}/context
    API-->>GPT: Candidate + job + pending fields + document requirements
    GPT->>API: POST /api/application-tasks/{taskId}/package
    Note over Bidder,GPT: ChatGPT may require explicit Action approval
    API->>API: Validate JSON and render required PDFs
    Ext->>API: Poll /api/application-tasks/{taskId}/status
    API-->>Ext: ready + generated answers/documents
    Ext->>Site: Fill answers and upload generated files
  end

  Ext->>Site: Rescan conditional fields and validation errors

  alt Next or Continue exists
    Ext->>Site: Validate and navigate to next step
    Ext->>Site: Scan next step using same taskId
  else Review or Submit exists
    Ext->>Bidder: Stop and show Ready for review
    Bidder->>Site: Review consents, answers, documents, and submit manually
  end
```

---

## 6. Phase A — Candidate selection and current-page discovery

### 6.1 Prerequisites

- Extension loaded and bidder authenticated
- Candidate profiles available from the QTS API
- Job description captured or detectable
- Application form or modal currently rendered
- QTS API reachable by the extension
- Public HTTPS Action endpoint reachable by ChatGPT
- Paid ChatGPT account signed in to the Chrome profile containing the pinned Custom GPT tab

A local server such as `http://localhost:1028` may be used by the extension, but GPT Actions require a publicly reachable HTTPS endpoint. A proxy or tunnel must securely route the Action request to the correct backend.

### 6.2 Start Application

When the bidder selects a candidate and clicks **Start Application**, the extension should:

1. Load the complete selected candidate profile.
2. Create one application session.
3. Receive an `applicationId` and random `taskId`.
4. Detect the application platform/template.
5. Scan the currently rendered form step.
6. Extract every visible field and file requirement.
7. Classify each field.
8. Save the discovered field metadata to the server.
9. Fill only verified candidate-profile values.
10. Determine whether GPT generation or human review is required.

### 6.3 Field data to collect

Each discovered field should include, where available:

```json
{
  "stableFieldId": "name:email:text",
  "label": "Email address",
  "fieldType": "email",
  "required": true,
  "options": [],
  "currentValue": "",
  "pageStep": "1",
  "section": "Personal information",
  "name": "email",
  "autocomplete": "email",
  "category": "candidate_profile",
  "status": "ready_to_fill"
}
```

Stable matching should use a fingerprint derived from the label, type, options, section, name, and platform—not only a volatile CSS selector.

---

## 7. Correct field classification and fill policy

### 7.1 Candidate-profile fields

Fill these only when the selected candidate contains a verified value:

- First name, last name, and full name
- Email
- Phone
- City, country, postal code, and address
- LinkedIn and portfolio URL
- Date of birth, only when explicitly stored
- Current and previous employers
- Job titles
- Employment start and end dates
- University, degree, and education dates
- Saved factual work-authorization or availability values
- Existing candidate document, when the workflow intentionally uses it

Safe normalization is permitted, such as date formatting, phone formatting, and country-name formatting.

Missing factual information must not be invented.

### 7.2 Saved approved answers

Reusable answers may be filled when the candidate explicitly approved them:

- Notice period
- Relocation preference
- Remote-work preference
- Salary expectation
- Work authorization
- Sponsorship requirement

### 7.3 GPT-generated fields

Send job-specific narrative questions to the Custom GPT:

- Why are you interested in this role?
- Why do you want to join this company?
- Describe your relevant experience.
- Explain your experience with a technology.
- Describe a challenging project.
- Why should we hire you?

### 7.4 Human-review fields

Do not guess or automatically consent to:

- Terms and conditions
- GDPR or privacy consent
- Marketing opt-in
- Electronic signatures
- Accuracy certifications
- Criminal-history declarations
- Disability, demographic, or voluntary self-identification fields
- Unknown work authorization or sponsorship status
- Unknown salary information
- Any unsupported legal declaration

### 7.5 Correct justjoin.it Easy Apply policy

| Field | Correct behavior |
|---|---|
| First and last name | Fill from selected candidate |
| Email | Fill from selected candidate |
| CV / Add document | Generate or select document, then extension uploads it |
| Attach a message | Fill only when the bidder enabled it or a dedicated answer exists |
| Terms / account checkbox | Manual |
| GDPR consent | Manual |
| Marketing opt-in | **Manual and unchecked by default** |

The previous rule that automatically checked the marketing checkbox should be removed.

---

## 8. Phase B — Pinned Custom GPT handoff

### 8.1 Tab strategy

Use:

```text
One paid ChatGPT account
One private Custom GPT
One reusable pinned inactive tab
One application task at a time
One fresh conversation per application
```

The extension should verify that the GPT tab is:

- Present
- Loaded
- Signed in
- On the correct Custom GPT URL
- Not discarded
- Not blocked by login, security, or usage-limit screens

### 8.2 Starting a new application conversation

For every new application:

1. Wait for the previous GPT task to finish or fail.
2. Navigate the pinned tab to the Custom GPT base URL to start a fresh conversation.
3. Wait for the Custom GPT page to load.
4. Insert the dynamic command:

```text
PROCESS_TASK: task_7f84c21e-2f34-4fd2-96e1-1f4216f3ad92
```

5. Attempt to send the message.
6. If the automatic handoff fails, notify the bidder and provide a one-click/manual fallback.

Do not place changing task IDs in Conversation Starters. Conversation Starters are static examples and are optional.

### 8.3 Action approval

If ChatGPT displays **Allow**, the extension should:

- Mark the task as `waiting_for_action_approval`
- Notify the bidder
- Keep polling the server
- Continue when the bidder approves the Action

Do not claim that approval can always be completed automatically.

---

## 9. Phase C — GPT Actions

The Custom GPT needs two essential Actions.

### 9.1 Retrieve task context

```http
GET /api/application-tasks/{taskId}/context
```

The response should include only the data required for this task:

- `applicationId`
- `taskId`
- Selected candidate profile
- Job title, company, URL, and description
- Pending narrative fields
- File-upload requirements
- Output requirements
- Existing approved answers
- Any human-review restrictions

### 9.2 Submit generated package

```http
POST /api/application-tasks/{taskId}/package
```

Example package:

```json
{
  "answers": [
    {
      "stableFieldId": "question:motivation:textarea",
      "answer": "I am interested in this role because...",
      "requiresHumanReview": false
    }
  ],
  "resume": {
    "candidate": {},
    "targetRole": "Senior Backend Engineer",
    "sections": []
  },
  "coverLetter": {
    "candidate": {},
    "bodyParagraphs": []
  },
  "warnings": [],
  "notes": "Generated for this specific application."
}
```

The extension, not the GPT, should normally poll task status. A separate GPT `getTaskStatus` Action is optional and not required after a successful package response.

### 9.3 File-field contract

For each file field, the server may provide:

```json
{
  "stableFieldId": "name:cv:file",
  "label": "Add document",
  "fieldType": "file",
  "documentSlot": "resume",
  "acceptedExtensions": ["pdf", "doc", "docx"],
  "required": true,
  "generateFromJobDescription": true,
  "outputSchema": {
    "schemaId": "resume-document.schema.json",
    "packageKey": "resume"
  }
}
```

When a required `resume` slot exists, the server may reject a package that omits the required resume JSON.

### 9.4 Custom GPT instructions

The GPT instructions should clearly require:

1. Exact extraction of `taskId`
2. `getTaskContext`
3. Candidate profile as the source of factual truth
4. No invented personal, employment, education, authorization, or salary data
5. Exact `stableFieldId` mapping
6. Human-review flags for unsupported or sensitive fields
7. `submitTaskPackage`
8. No success claim until the server confirms receipt
9. No job-site submission

---

## 10. Action and extension authentication

Use separate credentials for separate trust boundaries.

### 10.1 GPT Action authentication

```text
Custom GPT Action
→ Authorization: Bearer <GPT_ACTION_SECRET>
→ QTS Action endpoint
```

The GPT Action secret is created by QTS and stored:

- In the Custom GPT Action authentication configuration
- In server environment variables

It is **not**:

- An OpenAI API key
- A ChatGPT access token
- A bidder login token
- A short-lived browser session token

### 10.2 Extension authentication

```text
Chrome extension
→ User/session authorization
→ QTS extension API
```

The extension should use a user-scoped token. Do not embed a server-wide secret in extension source code.

### 10.3 Never use captured ChatGPT access tokens

Do not use browser-captured ChatGPT access tokens as an unofficial Custom GPT API. Rotate or allow any exposed token to expire.

### 10.4 Ownership checks

The server must verify that:

- The extension user owns the application session
- The `taskId` maps to the correct `applicationId`
- The task belongs to the selected candidate/job combination
- A GPT package cannot overwrite another application
- Repeated submissions are idempotent or versioned

---

## 11. Phase D — Server validation and document rendering

When the server receives the GPT package:

1. Authenticate the GPT Action.
2. Resolve `taskId` to one application session.
3. Validate the package using server-side schemas.
4. Reject missing required documents or malformed answers.
5. Save generated answers by `stableFieldId`.
6. Render required resume and cover-letter PDFs.
7. Store JSON and document files.
8. Update task and session statuses.
9. Return a clear success response.

Suggested state progression:

```text
created
→ fields_discovered
→ waiting_for_gpt
→ gpt_processing
→ waiting_for_action_approval
→ package_received
→ rendering_documents
→ ready
```

Failure states:

```text
blocked
failed
expired
human_review_required
```

Example output directory:

```text
server/data/application-documents/{applicationId}/
  resume.json
  resume.pdf
  cover-letter.json
  cover-letter.pdf
  manifest.json
```

The server-side schemas are the source of truth. Uploading schema files to Custom GPT Knowledge is optional reference material; it does not replace server validation or the OpenAPI Action schema.

---

## 12. Key API routes

| Method | Path | Caller | Purpose |
|---|---|---|---|
| `POST` | `/api/application-sessions` | Extension | Create one application and random task ID |
| `PATCH` | `/api/application-sessions/{applicationId}/fields` | Extension | Add or update fields discovered on the current page |
| `GET` | `/api/application-sessions/{applicationId}/result` | Extension | Retrieve saved/generated field values |
| `GET` | `/api/application-sessions/{applicationId}/documents/resume` | Extension | Download generated resume |
| `GET` | `/api/application-sessions/{applicationId}/documents/cover-letter` | Extension | Download generated cover letter |
| `POST` | `/api/application-tasks/{taskId}/dispatch` | Extension | Mark a task ready for GPT processing |
| `GET` | `/api/application-tasks/{taskId}/context` | Custom GPT Action | Retrieve scoped candidate/job/pending-field context |
| `POST` | `/api/application-tasks/{taskId}/package` | Custom GPT Action | Save answers and document JSON |
| `GET` | `/api/application-tasks/{taskId}/status` | Extension | Poll until result is ready |

The route naming may remain compatible with the existing project, but callers and authentication must stay separated.

---

## 13. Phase E — Apply generated package to the current form

When the task status becomes `ready`, the background service worker should:

1. Load generated field results.
2. Download required documents.
3. Confirm that the original job tab still exists.
4. Reopen the application modal only when necessary.
5. Match generated answers using `stableFieldId`.
6. Fill narrative fields.
7. Upload resume/cover-letter files through supported page controls.
8. Dispatch the input/change events required by the site framework.
9. Verify that the page accepted each value.
10. Rescan for conditional fields and validation errors.
11. Show warnings for any unresolved or human-review fields.

Do not overwrite a verified candidate-profile value with a conflicting GPT value.

---

## 14. Page-by-page multi-step workflow

The extension should not attempt to scrape all future pages at once. Later pages may not exist in the DOM and may depend on earlier answers.

Use this loop:

```text
Scan current step
        ↓
Save discovered fields under the same taskId
        ↓
Fill verified candidate-profile values
        ↓
Generate required narrative answers/documents
        ↓
Fill generated values
        ↓
Rescan conditional fields
        ↓
Check validation errors
        ↓
Next / Continue?
  Yes → click and wait for a real step change
  No  → Review / Submit?
           Yes → stop for bidder review
           No  → mark blocked
```

### 14.1 Navigation detection

Recognize labels such as:

- Next
- Continue
- Save and Continue
- Proceed
- Review
- Review Application
- Submit
- Submit Application
- Finish
- Complete Application

Classify final actions before generic navigation actions.

### 14.2 Waiting for the next step

Do not rely only on a fixed delay. Detect one or more of:

- URL change
- Step heading change
- Progress indicator change
- Previous form removal
- New field fingerprint
- Loading spinner completion
- DOM mutation

### 14.3 Conditional fields

After a radio, checkbox, or select value changes, wait for DOM stabilization and rescan. Newly revealed questions remain part of the same `taskId`.

### 14.4 Final boundary

When a final submit control appears:

```text
Stop automation
→ save current state
→ show Ready for review
→ bidder reviews documents, answers, consent, and legal declarations
→ bidder submits manually
```

---

## 15. Extension internals

| Area | Key files |
|---|---|
| Popup / UI | `extension/popup/popup.js` |
| Background orchestration | `extension/background/service-worker.js` |
| Current-page scan and fill | `extension/content/form-scan.js` |
| Form discovery | `extension/content/application-discovery.js` |
| justjoin template | `extension/content/platforms/templates/justjoin-easy-apply.js` |
| Fill policy | `extension/shared/fill-policy.js` |
| ChatGPT tab handoff | `extension/content/chatgpt-handoff.js` |
| GPT polling and package application | `extension/shared/api-worker.js` + service worker |
| Field classification | `extension/shared/field-classifier.js` |

Recommended responsibility split:

```text
Popup / side panel
→ user controls and progress display

Service worker
→ application state, task queue, GPT tab lifecycle, polling

Job-site content scripts
→ scan, fill, upload, validation, navigation

ChatGPT content script
→ experimental task-message handoff only

Server
→ source of truth for application state and generated results
```

Do not store critical workflow state only inside the popup because the popup closes when focus changes.

---

## 16. Bidder workflow

1. Start the local/backend services.
2. Confirm the public Action endpoint is healthy.
3. Confirm the extension is loaded.
4. Confirm the paid ChatGPT account is signed in.
5. Confirm the private Custom GPT is available.
6. Open the job and application form.
7. Select the candidate.
8. Click **Start Application**.
9. Review any missing or sensitive candidate information.
10. Allow the extension to fill verified profile fields.
11. Wait for GPT generation.
12. If ChatGPT requests Action approval, open the pinned tab and approve it.
13. Return to the job page if needed.
14. Review generated answers and documents.
15. Complete terms, GDPR, marketing choice, declarations, and signatures manually.
16. Submit manually.

---

## 17. Troubleshooting

| Symptom | Likely cause | Correct response |
|---|---|---|
| Form discovery failed | Apply form not rendered or scripts not injected | Open the application modal, reload extension/job tab, retry |
| GPT tab exists but task was not sent | ChatGPT composer selectors changed, tab not loaded, or login expired | Open pinned tab, verify login, send `PROCESS_TASK` manually, update handoff logic |
| Previous job context appears | Same GPT conversation was reused | Start a fresh Custom GPT conversation and use the current task ID |
| Action waits indefinitely | ChatGPT is showing an approval dialog | Bidder opens pinned tab and clicks **Allow** |
| `401` on GPT Actions | Wrong or rotated `GPT_ACTION_SECRET`, wrong header format, or endpoint mismatch | Update Action authentication and server environment secret; do not re-login using a browser token |
| GPT cannot reach server | Action URL is localhost, proxy/tunnel is unavailable, or HTTPS/TLS fails | Use a working public HTTPS endpoint |
| `resume JSON is required` | Required resume slot exists but GPT omitted the resume object | Check context/fileFields and GPT instructions |
| Package saved but PDF missing | Rendering or filesystem failure | Check server logs, schema validation, output directory, and permissions |
| PDF ready but upload failed | Job modal closed, file control changed, or site blocked programmatic assignment | Reopen form, rescan field, retry manual package application |
| Popup closed and progress disappeared | Workflow state was stored only in popup | Move orchestration to service worker/server and show state again when popup opens |
| GPT tab became inactive and stopped | Chrome froze/discarded tab or ChatGPT session expired | Reload pinned tab and resume task |
| Marketing box remains unchecked | Correct consent behavior | Bidder chooses manually |
| Final submit was not clicked | Correct safety behavior | Bidder reviews and submits manually |

---

## 18. Intentionally manual actions

The following remain manual:

- Final **Apply/Submit/Finish** action
- Terms and conditions
- GDPR/privacy consent
- Marketing opt-in
- Electronic signature
- Legal declarations
- Voluntary demographic/disability questions
- CAPTCHA, MFA, email verification, or security challenges
- Action approval when ChatGPT requests it
- Final review of generated resume, cover letter, and answers

---

## 19. Quick links

| Resource | Location |
|---|---|
| Custom GPT | `https://chatgpt.com/g/g-6a3dc5525fac819198dccf1c216e3fc0-qts-job-tracking` |
| Health check | `https://qts-job-tracking.vercel.app/api/health` |
| OpenAPI Actions | `docs/openapi/custom-gpt-application-actions.yaml` |
| justjoin templates | `docs/JUSTJOIN-APPLY-TEMPLATES.md` |

Keep the Custom GPT private or restricted to the intended ChatGPT account/workspace. A copied link does not transfer the owner’s paid-plan benefits to another account.

---

## 20. Architecture summary

```text
ONE APPLICATION
    │
    ├── one applicationId
    ├── one random taskId
    ├── one selected candidate
    ├── one job
    ├── one or more application pages
    └── one fresh Custom GPT conversation

EXTENSION
    │ scans and fills current page
    │
    ▼
SERVER
    │ stores task and returns taskId
    │
    ▼
PINNED CUSTOM GPT TAB
    │ receives PROCESS_TASK: taskId
    │
    ▼
GPT ACTIONS
    │ retrieve task and post generated package
    │
    ▼
SERVER
    │ validates, stores, renders PDFs
    │
    ▼
EXTENSION
    │ fills answers, uploads files, navigates intermediate steps
    │
    ▼
BIDDER
    └── reviews consent/legal fields and submits manually
```

The dependable separation of responsibility is:

```text
Extension = browser and form automation
Server = state, security, validation, and documents
Custom GPT = reasoning and writing
Bidder = approvals, consent, review, and final submission
```

---

## Official platform references

- OpenAI — Creating and editing GPTs: https://help.openai.com/en/articles/8554397-creating-and-editing-gpts
- OpenAI — GPTs in ChatGPT: https://help.openai.com/en/articles/8554407-gpts-in-chatgpt
- OpenAI — Configuring Actions in GPTs: https://help.openai.com/en/articles/9442513-configuring-actions-in-gpts
- Chrome — Content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome — Tabs API: https://developer.chrome.com/docs/extensions/reference/api/tabs
