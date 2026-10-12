# Universal Job Application Rules

Use this reference when creating or updating a job-application template or extension workflow. It describes a reusable process that can work across application websites, including applications with multiple pages or dynamically revealed fields. Website-specific adapters may be needed to identify and operate each site's controls.

## 1. Establish the job context

Before filling the application, identify and retain the available job context:

- Employer and job title
- Job description, responsibilities, and qualifications
- Location, work arrangement, and schedule
- Compensation range, if stated
- Any linked posting information needed to interpret application questions

Use the selected user's account profile and current resume as the factual source for candidate information.

## 2. Create job-specific application documents

For every job:

- Generate a fresh resume tailored to the job description from the user's actual experience, education, skills, and achievements.
- Generate a fresh cover letter when requested or useful; follow the form's accepted format, such as text entry or file upload.
- Tailor optional summaries, headlines, and experience descriptions to the role when requested.
- Do not reuse a prior job's generated document or response as if it were tailored to the current job.
- Never invent or exaggerate qualifications, employment history, education, dates, achievements, or other personal facts. Ask the user when necessary facts are missing.

## 3. Process every application page

Process the current page completely before advancing. Repeat these steps for every step or page, including pages revealed after an answer or action:

1. Inspect the page and identify all visible questions, fields, required indicators, existing values, choices, and file-upload controls. Include fields inside expanded sections or dialogs and fields revealed by conditional answers.
   - After a route, modal, or step transition, wait for client-rendered controls to appear and stabilize before treating the page as empty. Include accessible custom controls such as textboxes, comboboxes, and spinbuttons as well as native HTML controls.
2. For each field, record its label or question, control type, required status, current value, and relevant choices.
3. Match fields against saved account-profile information and the separate reusable question-and-answer (Q&A) table. Match by meaning and context, not label text alone.
4. Automatically fill fields with a clear, current, reliable saved answer.
5. Collect all fields without a reliable saved answer and send them to GPT together in one request for the current page. Include the job context and only the relevant profile/resume facts. Do not send one request per unanswered field.
6. Use GPT responses only when they are supported by the user's information and fit the available choices and control. Leave uncertain fields unresolved and ask the user rather than guessing.
7. Fill supported GPT-generated answers and verify that the form accepted the values.
8. Re-scan the page for newly revealed or missed fields. Resolve all required fields that can be answered reliably before moving to the next page.
9. Advance to the next page or step and repeat from step 1 until the application is complete.

Do not assume all fields are on the first page, that page order is fixed, or that a page transition means the application has been submitted.

## 4. Choose the right source for an answer

- **Account profile:** stable personal contact details and factual history the user wants reused, such as name, email, phone, address, education, and employment history.
- **Q&A table:** reusable answers to recurring application questions, saved with a question meaning or identifier and answer.
- **GPT:** fresh job-specific wording or answers derived from the current job description and the user's verified profile, resume, preferences, and other supplied facts.

Reuse saved answers only when they clearly apply and remain accurate. Confirm time-sensitive or job-dependent information, including authorization status, sponsorship needs, availability, work location, and compensation expectations. Do not infer legal eligibility or other consequential personal facts from unrelated profile information.

Candidate-specific answers such as work authorization, sponsorship, pay
expectations, education level, referrals, and schedule availability must come
from that Account's profile/Q&A or direct user confirmation. Never use a
Manager-wide answer or GPT-generated inference for these facts.

When the user has not supplied a fact needed for an answer, GPT must not fabricate it. Mark the field unresolved and ask the user.

## 5. Match the answer to the control

- **Text input or textarea:** enter an appropriate text value.
- **Dropdown or combobox:** choose a listed option that accurately represents the answer. Do not force an unsupported value.
- **Radio group:** select the option that directly matches the verified answer.
- **Checkboxes:** select only the applicable choices; do not select all by default.
- **Date, numeric, email, phone, and other typed inputs:** follow the field's format and validation constraints.
- **File upload:** attach the correct job-specific document only when the file is available and the control supports it. Otherwise, tell the user what action is needed.

Use the site's labels and associated controls to connect questions to inputs. Do not rely only on visual position, placeholder text, or a control's order on the page. After filling, verify the displayed or selected value.

## 6. Handle unknown fields and errors

- Detect unrecognized questions and include them in the page's single GPT request along with their labels, control types, choices, and required status.
- GPT should answer only from the provided job context and user facts. If the field requires a missing personal fact, leave it unresolved and ask the user.
- If a control cannot be reliably identified, a choice cannot be matched, or validation rejects an answer, do not silently skip it or insert a guessed value. Report the issue and request user input.
- Avoid sending unnecessary sensitive data to GPT. Do not collect or store government identification numbers or similarly sensitive information unless the application truly requires it and the user explicitly authorizes handling it.

## 7. Final review and submission

- Confirm all required fields across all pages are completed and accepted by the form.
- Summarize unresolved fields and any generated content that needs the user's attention.
- Give the user an opportunity to review personal declarations, generated documents, and consequential answers.
- Do not submit the application unless the user explicitly authorizes submission.
- After an authorized submission, verify the confirmation page or message and report the result. Do not claim success without confirmation.
