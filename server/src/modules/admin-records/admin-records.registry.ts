export type RecordCategoryId =
  | 'accounts'
  | 'bidders'
  | 'candidates'
  | 'jobs'
  | 'candidate_jobs'
  | 'interviews'
  | 'application_sessions'
  | 'application_session_fields'
  | 'candidate_saved_answers'
  | 'settings';

export type ColumnType = 'text' | 'number' | 'boolean' | 'json' | 'readonly';

export interface RecordColumnDef {
  key: string;
  label: string;
  type: ColumnType;
  editable?: boolean;
  list?: boolean;
}

export interface RecordCategoryDef {
  id: RecordCategoryId;
  label: string;
  description: string;
  table: string;
  primaryKey: string;
  orderBy: string;
  searchColumns: string[];
  columns: RecordColumnDef[];
}

const READONLY = { editable: false as const };

export const RECORD_CATEGORIES: RecordCategoryDef[] = [
  {
    id: 'accounts',
    label: 'Accounts',
    description: 'Admin, manager, bidder, and caller login accounts.',
    table: 'admins',
    primaryKey: 'id',
    orderBy: 'username ASC',
    searchColumns: ['username', 'role'],
    columns: [
      { key: 'id', label: 'ID', type: 'number', list: true, ...READONLY },
      { key: 'username', label: 'Username', type: 'text', list: true, editable: true },
      { key: 'role', label: 'Role', type: 'text', list: true, editable: true },
      { key: 'bidder_id', label: 'Bidder ID', type: 'number', list: true, editable: true },
      { key: 'is_active', label: 'Active', type: 'boolean', list: true, editable: true },
      { key: 'created_at', label: 'Created', type: 'readonly', list: true, ...READONLY },
      { key: 'updated_at', label: 'Updated', type: 'readonly', ...READONLY },
    ],
  },
  {
    id: 'bidders',
    label: 'Bidders',
    description: 'Bidder organizations.',
    table: 'bidders',
    primaryKey: 'id',
    orderBy: 'name ASC',
    searchColumns: ['name', 'notes'],
    columns: [
      { key: 'id', label: 'ID', type: 'number', list: true, ...READONLY },
      { key: 'name', label: 'Name', type: 'text', list: true, editable: true },
      { key: 'notes', label: 'Notes', type: 'text', editable: true },
      { key: 'is_active', label: 'Active', type: 'boolean', list: true, editable: true },
      { key: 'manager_id', label: 'Manager ID', type: 'number', list: true, editable: true },
      { key: 'custom_gpt_url', label: 'Custom GPT URL', type: 'text', editable: true },
      { key: 'created_at', label: 'Created', type: 'readonly', list: true, ...READONLY },
      { key: 'updated_at', label: 'Updated', type: 'readonly', ...READONLY },
    ],
  },
  {
    id: 'candidates',
    label: 'Candidates',
    description: 'Candidate profiles linked to bidder teams.',
    table: 'candidates',
    primaryKey: 'id',
    orderBy: 'name ASC',
    searchColumns: ['name', 'email', 'stack'],
    columns: [
      { key: 'id', label: 'ID', type: 'number', list: true, ...READONLY },
      { key: 'name', label: 'Name', type: 'text', list: true, editable: true },
      { key: 'email', label: 'Email', type: 'text', list: true, editable: true },
      { key: 'phone', label: 'Phone', type: 'text', editable: true },
      { key: 'linkedin_url', label: 'LinkedIn URL', type: 'text', editable: true },
      { key: 'stack', label: 'Stack', type: 'text', list: true, editable: true },
      { key: 'color', label: 'Color', type: 'text', editable: true },
      { key: 'notes', label: 'Notes', type: 'text', editable: true },
      { key: 'is_active', label: 'Active', type: 'boolean', list: true, editable: true },
      { key: 'bidder_id', label: 'Bidder ID', type: 'number', list: true, editable: true },
      { key: 'created_at', label: 'Created', type: 'readonly', list: true, ...READONLY },
      { key: 'updated_at', label: 'Updated', type: 'readonly', ...READONLY },
    ],
  },
  {
    id: 'jobs',
    label: 'Jobs',
    description: 'Captured job postings.',
    table: 'jobs',
    primaryKey: 'id',
    orderBy: 'created_at DESC',
    searchColumns: ['title', 'company', 'url', 'source'],
    columns: [
      { key: 'id', label: 'ID', type: 'number', list: true, ...READONLY },
      { key: 'title', label: 'Title', type: 'text', list: true, editable: true },
      { key: 'company', label: 'Company', type: 'text', list: true, editable: true },
      { key: 'url', label: 'URL', type: 'text', list: true, editable: true },
      { key: 'normalized_url', label: 'Normalized URL', type: 'text', editable: true },
      { key: 'source', label: 'Source', type: 'text', list: true, editable: true },
      { key: 'description', label: 'Description', type: 'text', editable: true },
      { key: 'bidder_id', label: 'Bidder ID', type: 'number', editable: true },
      { key: 'created_by_user_id', label: 'Created By User ID', type: 'number', editable: true },
      { key: 'created_at', label: 'Created', type: 'readonly', list: true, ...READONLY },
      { key: 'updated_at', label: 'Updated', type: 'readonly', ...READONLY },
    ],
  },
  {
    id: 'candidate_jobs',
    label: 'Candidate Jobs',
    description: 'Candidate-to-job application links.',
    table: 'candidate_jobs',
    primaryKey: 'id',
    orderBy: 'updated_at DESC',
    searchColumns: ['status'],
    columns: [
      { key: 'id', label: 'ID', type: 'number', list: true, ...READONLY },
      { key: 'candidate_id', label: 'Candidate ID', type: 'number', list: true, editable: true },
      { key: 'job_id', label: 'Job ID', type: 'number', list: true, editable: true },
      { key: 'status', label: 'Status', type: 'text', list: true, editable: true },
      { key: 'applied_at', label: 'Applied At', type: 'text', editable: true },
      { key: 'created_at', label: 'Created', type: 'readonly', list: true, ...READONLY },
      { key: 'updated_at', label: 'Updated', type: 'readonly', ...READONLY },
    ],
  },
  {
    id: 'interviews',
    label: 'Interviews',
    description: 'Interview process records.',
    table: 'interview_processes',
    primaryKey: 'id',
    orderBy: 'created_at DESC',
    searchColumns: ['candidate_name', 'company', 'position', 'stage'],
    columns: [
      { key: 'id', label: 'ID', type: 'number', list: true, ...READONLY },
      { key: 'candidate_name', label: 'Candidate Name', type: 'text', list: true, editable: true },
      { key: 'candidate_id', label: 'Candidate ID', type: 'number', editable: true },
      { key: 'caller_user_id', label: 'Caller User ID', type: 'number', editable: true },
      { key: 'bidder_id', label: 'Bidder ID', type: 'number', list: true, editable: true },
      { key: 'scheduled_date', label: 'Scheduled Date', type: 'text', list: true, editable: true },
      { key: 'attend_date', label: 'Attend Date', type: 'text', editable: true },
      { key: 'interview_time', label: 'Interview Time', type: 'text', editable: true },
      { key: 'timezone', label: 'Timezone', type: 'text', editable: true },
      { key: 'position', label: 'Position', type: 'text', list: true, editable: true },
      { key: 'company', label: 'Company', type: 'text', list: true, editable: true },
      { key: 'job_url', label: 'Job URL', type: 'text', editable: true },
      { key: 'resume', label: 'Resume', type: 'text', editable: true },
      { key: 'meeting_url', label: 'Meeting URL', type: 'text', editable: true },
      { key: 'salary', label: 'Salary', type: 'text', editable: true },
      { key: 'stage', label: 'Stage', type: 'text', list: true, editable: true },
      { key: 'created_by_user_id', label: 'Created By User ID', type: 'number', editable: true },
      { key: 'created_at', label: 'Created', type: 'readonly', list: true, ...READONLY },
      { key: 'updated_at', label: 'Updated', type: 'readonly', ...READONLY },
    ],
  },
  {
    id: 'application_sessions',
    label: 'Application Sessions',
    description: 'Auto-apply pipeline sessions.',
    table: 'application_sessions',
    primaryKey: 'id',
    orderBy: 'last_activity_at DESC',
    searchColumns: ['job_url', 'job_title', 'company', 'platform', 'status', 'current_step'],
    columns: [
      { key: 'id', label: 'ID', type: 'number', list: true, ...READONLY },
      { key: 'candidate_id', label: 'Candidate ID', type: 'number', list: true, editable: true },
      { key: 'job_id', label: 'Job ID', type: 'number', editable: true },
      { key: 'user_id', label: 'User ID', type: 'number', editable: true },
      { key: 'bidder_id', label: 'Bidder ID', type: 'number', list: true, editable: true },
      { key: 'job_url', label: 'Job URL', type: 'text', list: true, editable: true },
      { key: 'job_title', label: 'Job Title', type: 'text', list: true, editable: true },
      { key: 'company', label: 'Company', type: 'text', list: true, editable: true },
      { key: 'platform', label: 'Platform', type: 'text', list: true, editable: true },
      { key: 'current_step', label: 'Current Step', type: 'text', list: true, editable: true },
      { key: 'status', label: 'Status', type: 'text', list: true, editable: true },
      { key: 'discovered_pages', label: 'Discovered Pages', type: 'json', editable: true },
      { key: 'generated_answers', label: 'Generated Answers', type: 'json', editable: true },
      { key: 'metadata', label: 'Metadata', type: 'json', editable: true },
      { key: 'started_at', label: 'Started At', type: 'readonly', list: true, ...READONLY },
      { key: 'last_activity_at', label: 'Last Activity', type: 'readonly', list: true, ...READONLY },
      { key: 'completed_at', label: 'Completed At', type: 'text', editable: true },
      { key: 'created_at', label: 'Created', type: 'readonly', ...READONLY },
      { key: 'updated_at', label: 'Updated', type: 'readonly', ...READONLY },
    ],
  },
  {
    id: 'application_session_fields',
    label: 'Session Fields',
    description: 'Discovered form fields per application session.',
    table: 'application_session_fields',
    primaryKey: 'id',
    orderBy: 'updated_at DESC',
    searchColumns: ['label', 'field_type', 'category', 'fill_status', 'stable_field_id'],
    columns: [
      { key: 'id', label: 'ID', type: 'number', list: true, ...READONLY },
      { key: 'session_id', label: 'Session ID', type: 'number', list: true, editable: true },
      { key: 'stable_field_id', label: 'Stable Field ID', type: 'text', list: true, editable: true },
      { key: 'label', label: 'Label', type: 'text', list: true, editable: true },
      { key: 'field_type', label: 'Field Type', type: 'text', list: true, editable: true },
      { key: 'required', label: 'Required', type: 'boolean', editable: true },
      { key: 'category', label: 'Category', type: 'text', list: true, editable: true },
      { key: 'fill_status', label: 'Fill Status', type: 'text', list: true, editable: true },
      { key: 'generated_answer', label: 'Generated Answer', type: 'text', editable: true },
      { key: 'options', label: 'Options', type: 'json', editable: true },
      { key: 'selector_hints', label: 'Selector Hints', type: 'json', editable: true },
      { key: 'created_at', label: 'Discovered At', type: 'readonly', list: true, ...READONLY },
      { key: 'updated_at', label: 'Updated', type: 'readonly', ...READONLY },
    ],
  },
  {
    id: 'candidate_saved_answers',
    label: 'Saved Answers',
    description: 'Reusable candidate answers for application forms.',
    table: 'candidate_saved_answers',
    primaryKey: 'id',
    orderBy: 'updated_at DESC',
    searchColumns: ['answer_key', 'answer_value'],
    columns: [
      { key: 'id', label: 'ID', type: 'number', list: true, ...READONLY },
      { key: 'candidate_id', label: 'Candidate ID', type: 'number', list: true, editable: true },
      { key: 'answer_key', label: 'Answer Key', type: 'text', list: true, editable: true },
      { key: 'answer_value', label: 'Answer Value', type: 'text', list: true, editable: true },
      { key: 'approved', label: 'Approved', type: 'boolean', list: true, editable: true },
      { key: 'created_at', label: 'Created', type: 'readonly', list: true, ...READONLY },
      { key: 'updated_at', label: 'Updated', type: 'readonly', ...READONLY },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Key-value application settings.',
    table: 'settings',
    primaryKey: 'key',
    orderBy: 'key ASC',
    searchColumns: ['key', 'value'],
    columns: [
      { key: 'key', label: 'Key', type: 'text', list: true, ...READONLY },
      { key: 'value', label: 'Value', type: 'text', list: true, editable: true },
      { key: 'updated_at', label: 'Updated', type: 'readonly', list: true, ...READONLY },
    ],
  },
];

const CATEGORY_MAP = new Map(RECORD_CATEGORIES.map((category) => [category.id, category]));

export function getRecordCategory(id: string): RecordCategoryDef | null {
  return CATEGORY_MAP.get(id as RecordCategoryId) ?? null;
}

export function listRecordCategoryIds(): RecordCategoryId[] {
  return RECORD_CATEGORIES.map((category) => category.id);
}
