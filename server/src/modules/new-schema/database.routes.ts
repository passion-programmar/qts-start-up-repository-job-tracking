import { NextFunction, Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { execute, queryAll, queryOne, withTransaction } from '../../database/connection';
import {
  NewSchemaAuthRequest,
  requireNewSchemaAuth,
} from '../../middleware/new-schema-auth';

const router = Router();
router.use(requireNewSchemaAuth);

type FieldType = 'text' | 'password' | 'integer' | 'boolean' | 'date' | 'datetime'
  | 'time' | 'url' | 'integer-array' | 'enum' | 'numeric' | 'json' | 'uuid' | 'binary';

interface FieldDefinition {
  type: FieldType;
  nullable?: boolean;
  required?: boolean;
  options?: readonly string[];
  maxLength?: number;
  min?: number;
  primaryKey?: boolean;
}

const TABLES = {
  categories: {
    label: 'Categories',
    description: 'Job categories used by Manager job listings.',
    columns: ['category_id', 'category_title', 'created_date'],
    searchColumns: ['category_title'],
    orderBy: 'category_id',
    primaryKey: 'category_id',
    fields: {
      category_title: { type: 'text', required: true, maxLength: 200 },
      created_date: { type: 'datetime' },
    },
  },
  users: {
    label: 'New-schema users',
    description: 'Super, Admin, Manager, Caller, and Account profiles. Password hashes are excluded.',
    columns: [
      'u_id', 'username', 'name', 'role', 'must_change_password', 'parent_user_id',
      'email', 'address', 'sex', 'birthday', 'phone', 'country', 'city',
      'blocked_date', 'category_id',
    ],
    searchColumns: ['username', 'name', 'role', 'email', 'phone', 'city'],
    orderBy: 'u_id',
    primaryKey: 'u_id',
    fields: {
      username: { type: 'text', required: true, maxLength: 100 },
      name: { type: 'text', required: true, maxLength: 200 },
      role: { type: 'enum', required: true, options: ['super', 'admin', 'manager', 'caller', 'account'] },
      password: { type: 'password', maxLength: 200 },
      must_change_password: { type: 'boolean' },
      parent_user_id: { type: 'integer', nullable: true, required: true },
      email: { type: 'text', nullable: true, maxLength: 320 },
      address: { type: 'text', nullable: true, maxLength: 500 },
      sex: { type: 'text', nullable: true, maxLength: 50 },
      birthday: { type: 'date', nullable: true },
      phone: { type: 'text', nullable: true, maxLength: 50 },
      country: { type: 'text', nullable: true, maxLength: 100 },
      city: { type: 'text', nullable: true, maxLength: 100 },
      blocked_date: { type: 'datetime', nullable: true },
      category_id: { type: 'integer', nullable: true },
    },
  },
  job_list: {
    label: 'Jobs (new schema)',
    description: 'Manager-owned job rows with the detected application type; Account assignments are stored separately.',
    columns: [
      'j_id', 'u_id', 'url', 'application_type', 'company', 'title', 'category_ids', 'status', 'get_date',
    ],
    searchColumns: ['url', 'application_type', 'company', 'title', 'status'],
    orderBy: 'j_id',
    primaryKey: 'j_id',
    fields: {
      u_id: { type: 'integer', required: true },
      url: { type: 'url', required: true, maxLength: 2000 },
      application_type: { type: 'text', required: true, maxLength: 253 },
      company: { type: 'text', required: true, maxLength: 300 },
      title: { type: 'text', required: true, maxLength: 300 },
      category_ids: { type: 'integer-array' },
      status: { type: 'enum', required: true, options: ['processing', 'todo', 'did', 'failed'] },
      get_date: { type: 'datetime' },
    },
  },
  job_account_assignments: {
    label: 'Job–Account assignments',
    description: 'Ordered Account assignments for each Manager-owned job.',
    columns: ['job_account_assignment_id', 'j_id', 'account_user_id', 'position'],
    searchColumns: ['j_id', 'account_user_id'],
    orderBy: 'job_account_assignment_id',
    primaryKey: 'job_account_assignment_id',
    fields: {
      j_id: { type: 'integer', required: true },
      account_user_id: { type: 'integer', required: true },
      position: { type: 'integer', required: true },
    },
  },
  bids: {
    label: 'Bids',
    description: 'Successfully submitted Account applications retained independently of the active job list.',
    columns: [
      'b_id', 'u_id', 'j_id', 'manager_user_id', 'job_title', 'company',
      'job_url', 'resume_path', 'applied_date',
    ],
    searchColumns: ['job_title', 'company', 'job_url', 'resume_path'],
    orderBy: 'b_id',
    primaryKey: 'b_id',
    fields: {
      u_id: { type: 'integer', required: true },
      j_id: { type: 'integer', required: true },
      manager_user_id: { type: 'integer', required: true },
      job_title: { type: 'text', required: true, maxLength: 300 },
      company: { type: 'text', required: true, maxLength: 300 },
      job_url: { type: 'url', required: true, maxLength: 2000 },
      resume_path: { type: 'text', required: true, maxLength: 2000 },
      applied_date: { type: 'datetime' },
    },
  },
  interviews: {
    label: 'Interviews (new schema)',
    description: 'Interview schedule, assignment, status, outcome, and comments.',
    columns: [
      'i_id', 'b_id', 'interview_time', 'interview_date', 'caller_user_id',
      'interviewer', 'step', 'status', 'outcome', 'created_date', 'comment',
    ],
    searchColumns: ['interviewer', 'step', 'status', 'outcome', 'comment'],
    orderBy: 'i_id',
    primaryKey: 'i_id',
    fields: {
      b_id: { type: 'integer', required: true },
      interview_time: { type: 'time', required: true },
      interview_date: { type: 'date', required: true },
      caller_user_id: { type: 'integer', required: true },
      interviewer: { type: 'text', required: true, maxLength: 200 },
      step: { type: 'enum', required: true, options: ['intro', 'tech-1', 'tech-2', 'final'] },
      status: { type: 'enum', required: true, options: ['todo', 'did', 'failed', 'respond_waiting'] },
      outcome: { type: 'enum', nullable: true, options: ['good', 'bad', 'normal'] },
      created_date: { type: 'datetime' },
      comment: { type: 'text', nullable: true, maxLength: 5000 },
    },
  },
  app_settings: {
    label: 'Application settings',
    description: 'Application-wide settings.',
    columns: ['setting_name', 'setting_value', 'updated_by', 'created_date', 'updated_date'],
    searchColumns: ['setting_name', 'setting_value'],
    orderBy: 'setting_name',
    primaryKey: 'setting_name',
    fields: {
      setting_name: { type: 'text', required: true, maxLength: 200 },
      setting_value: { type: 'text', required: true, maxLength: 10000 },
      updated_by: { type: 'integer', nullable: true },
      created_date: { type: 'datetime' },
      updated_date: { type: 'datetime' },
    },
  },
  prompts: {
    label: 'Prompts',
    description: 'Reusable prompt templates managed by Super users.',
    columns: [
      'prompt_id', 'prompt_name', 'prompt_content', 'created_by', 'updated_by',
      'created_date', 'updated_date',
    ],
    searchColumns: ['prompt_name', 'prompt_content'],
    orderBy: 'prompt_id',
    primaryKey: 'prompt_id',
    fields: {
      prompt_name: { type: 'text', required: true, maxLength: 200 },
      prompt_content: { type: 'text', required: true, maxLength: 50000 },
    },
  },
  custom_gpts: {
    label: 'Custom GPTs',
    description: 'Custom GPT references configured for Manager assignments.',
    columns: ['custom_gpt_id', 'name', 'url', 'gpt_id', 'created_by', 'created_date', 'updated_date'],
    searchColumns: ['name', 'url', 'gpt_id'],
    orderBy: 'custom_gpt_id',
    primaryKey: 'custom_gpt_id',
    fields: {
      name: { type: 'text', required: true, maxLength: 200 },
      url: { type: 'url', required: true, maxLength: 2000 },
      gpt_id: { type: 'text', required: true, maxLength: 500 },
      created_by: { type: 'integer', nullable: true },
    },
  },
  manager_custom_gpt_assignments: {
    label: 'Manager GPT assignments',
    description: 'The assigned Custom GPT for each Manager.',
    columns: ['manager_user_id', 'custom_gpt_id', 'assigned_by', 'assigned_date'],
    searchColumns: ['manager_user_id', 'custom_gpt_id'],
    orderBy: 'manager_user_id',
    primaryKey: 'manager_user_id',
    fields: {
      manager_user_id: { type: 'integer', required: true, primaryKey: true },
      custom_gpt_id: { type: 'integer', required: true },
      assigned_by: { type: 'integer', nullable: true },
    },
  },
  manager_scanner_prompt_assignments: {
    label: 'Manager Scanner prompt assignments',
    description: 'One optional shared Scanner prompt assigned to each Manager.',
    columns: ['manager_user_id', 'prompt_id', 'assigned_by', 'assigned_date'],
    searchColumns: ['manager_user_id', 'prompt_id'],
    orderBy: 'manager_user_id',
    primaryKey: 'manager_user_id',
    fields: {
      manager_user_id: { type: 'integer', required: true, primaryKey: true },
      prompt_id: { type: 'integer', required: true },
      assigned_by: { type: 'integer', nullable: true },
    },
  },
  account_apply_runs: {
    label: 'Active Apply runs',
    description: 'Account-level run locks used while applications are processing.',
    columns: ['account_user_id', 'manager_user_id', 'run_id', 'last_activity_at'],
    searchColumns: ['account_user_id', 'manager_user_id', 'run_id'],
    orderBy: 'last_activity_at',
    primaryKey: 'account_user_id',
    fields: {
      account_user_id: { type: 'integer', required: true, primaryKey: true },
      manager_user_id: { type: 'integer', required: true },
      run_id: { type: 'uuid', required: true },
      last_activity_at: { type: 'datetime' },
    },
  },
  manager_application_profiles: {
    label: 'Manager application profiles',
    description: 'Manager-level defaults used by application workflows.',
    columns: [
      'manager_user_id', 'authorized_to_work', 'authorization_status', 'sponsorship_required',
      'authorization_expires_on', 'relocation_willing', 'relocation_details',
      'notice_period_value', 'notice_period_unit', 'notice_period_text', 'updated_date',
    ],
    searchColumns: ['manager_user_id', 'authorization_status', 'relocation_details', 'notice_period_text'],
    orderBy: 'manager_user_id',
    primaryKey: 'manager_user_id',
    fields: {
      manager_user_id: { type: 'integer', required: true, primaryKey: true },
      authorized_to_work: { type: 'boolean', nullable: true },
      authorization_status: { type: 'text', nullable: true, maxLength: 500 },
      sponsorship_required: { type: 'boolean', nullable: true },
      authorization_expires_on: { type: 'date', nullable: true },
      relocation_willing: { type: 'boolean', nullable: true },
      relocation_details: { type: 'text', nullable: true, maxLength: 5000 },
      notice_period_value: { type: 'integer', nullable: true, min: 0 },
      notice_period_unit: { type: 'enum', nullable: true, options: ['days', 'weeks', 'months'] },
      notice_period_text: { type: 'text', nullable: true, maxLength: 1000 },
    },
  },
  manager_salary_answers: {
    label: 'Manager salary answers',
    description: 'Reusable salary expectations shared by a Manager.',
    columns: [
      'salary_answer_id', 'manager_user_id', 'currency', 'minimum_amount',
      'maximum_amount', 'pay_period', 'answer_text',
    ],
    searchColumns: ['manager_user_id', 'currency', 'pay_period', 'answer_text'],
    orderBy: 'salary_answer_id',
    primaryKey: 'salary_answer_id',
    fields: {
      manager_user_id: { type: 'integer', required: true },
      currency: { type: 'text', required: true, maxLength: 3 },
      minimum_amount: { type: 'numeric', nullable: true },
      maximum_amount: { type: 'numeric', nullable: true },
      pay_period: { type: 'enum', required: true, options: ['hour', 'day', 'week', 'month', 'year'] },
      answer_text: { type: 'text', nullable: true, maxLength: 2000 },
    },
  },
  manager_custom_application_answers: {
    label: 'Manager application Q&A',
    description: 'Reusable Manager-wide application questions and answers.',
    columns: ['custom_answer_id', 'manager_user_id', 'topic', 'question', 'answer'],
    searchColumns: ['manager_user_id', 'topic', 'question', 'answer'],
    orderBy: 'custom_answer_id',
    primaryKey: 'custom_answer_id',
    fields: {
      manager_user_id: { type: 'integer', required: true },
      topic: { type: 'text', required: true, maxLength: 200 },
      question: { type: 'text', required: true, maxLength: 1000 },
      answer: { type: 'text', required: true, maxLength: 5000 },
    },
  },
  account_application_profiles: {
    label: 'Account application profiles',
    description: 'Account resume and structured education, experience, and profile facts. Resume bytes are protected from direct editing here.',
    columns: [
      'account_user_id', 'first_name', 'last_name', 'resume_file_name', 'resume_content',
      'education', 'work_experience', 'custom_fields', 'updated_date',
    ],
    searchColumns: ['account_user_id', 'first_name', 'last_name', 'resume_file_name'],
    orderBy: 'account_user_id',
    primaryKey: 'account_user_id',
    fields: {
      account_user_id: { type: 'integer', required: true, primaryKey: true },
      first_name: { type: 'text', required: true, maxLength: 100 },
      last_name: { type: 'text', required: true, maxLength: 100 },
      resume_file_name: { type: 'text', nullable: true, maxLength: 500 },
      resume_content: { type: 'binary', nullable: true },
      education: { type: 'json', required: true },
      work_experience: { type: 'json', required: true },
      custom_fields: { type: 'json', required: true },
    },
  },
  account_custom_application_answers: {
    label: 'Account application Q&A',
    description: 'Reusable questions and answers belonging to an individual Account.',
    columns: ['custom_answer_id', 'account_user_id', 'topic', 'question', 'answer'],
    searchColumns: ['account_user_id', 'topic', 'question', 'answer'],
    orderBy: 'custom_answer_id',
    primaryKey: 'custom_answer_id',
    fields: {
      account_user_id: { type: 'integer', required: true },
      topic: { type: 'text', required: true, maxLength: 200 },
      question: { type: 'text', required: true, maxLength: 1000 },
      answer: { type: 'text', required: true, maxLength: 5000 },
    },
  },
  gpt_application_tasks: {
    label: 'GPT application tasks',
    description: 'Current application page context, GPT responses, and task state. Contains candidate information.',
    columns: [
      'task_id', 'job_id', 'status', 'page_number', 'task_context', 'package',
      'answers', 'resume_text', 'resume_text_expires_at', 'created_at',
      'last_activity_at', 'updated_at',
    ],
    searchColumns: ['task_id', 'job_id', 'status', 'task_context', 'package', 'answers'],
    orderBy: 'updated_at',
    primaryKey: 'task_id',
    fields: {
      task_id: { type: 'text', required: true, maxLength: 100, primaryKey: true },
      job_id: { type: 'integer', nullable: true },
      status: { type: 'enum', required: true, options: ['waiting_for_page', 'waiting_for_gpt', 'ready', 'failed', 'completed'] },
      page_number: { type: 'integer', required: true },
      task_context: { type: 'json', required: true },
      package: { type: 'json', required: true },
      answers: { type: 'json', required: true },
      resume_text: { type: 'text', nullable: true, maxLength: 500000 },
      resume_text_expires_at: { type: 'datetime', nullable: true },
    },
  },
  gpt_application_task_documents: {
    label: 'GPT application documents',
    description: 'Legacy generated resume and cover-letter PDF files. New Scanner documents are rendered on demand and are not stored here.',
    columns: ['task_id', 'document_type', 'file_name', 'content', 'updated_at'],
    searchColumns: ['task_id', 'document_type', 'file_name'],
    orderBy: 'updated_at',
    primaryKey: ['task_id', 'document_type'],
    fields: {
      task_id: { type: 'text', required: true, primaryKey: true, maxLength: 100 },
      document_type: { type: 'enum', required: true, primaryKey: true, options: ['resume', 'cover_letter'] },
      file_name: { type: 'text', required: true, maxLength: 500 },
      content: { type: 'binary', required: true },
    },
  },
  gpt_application_task_document_downloads: {
    label: 'Scanner document download paths',
    description: 'Local file paths reported by the Manager extension after downloading generated documents. Paths refer to that Manager’s computer.',
    columns: ['task_id', 'document_type', 'file_name', 'local_path', 'downloaded_at'],
    searchColumns: ['task_id', 'document_type', 'file_name', 'local_path'],
    orderBy: 'downloaded_at',
    primaryKey: ['task_id', 'document_type'],
    fields: {
      task_id: { type: 'text', required: true, primaryKey: true, maxLength: 100 },
      document_type: { type: 'enum', required: true, primaryKey: true, options: ['resume', 'cover_letter'] },
      file_name: { type: 'text', required: true, maxLength: 500 },
      local_path: { type: 'text', required: true, maxLength: 2048 },
      downloaded_at: { type: 'datetime', required: true },
    },
  },
} as const;

type TableName = keyof typeof TABLES;
type TableDefinition = {
  label: string;
  description: string;
  columns: readonly string[];
  searchColumns: readonly string[];
  orderBy: string;
  primaryKey: string | readonly string[];
  fields: Record<string, FieldDefinition>;
};

const EXCLUDED_TABLES = new Set<string>(['qts_schema_migrations']);

function isTableName(value: string): value is TableName {
  return Object.prototype.hasOwnProperty.call(TABLES, value);
}

function tableDefinition(table: TableName): TableDefinition {
  return TABLES[table] as TableDefinition;
}

function primaryKeyColumns(definition: TableDefinition): string[] {
  return Array.isArray(definition.primaryKey)
    ? [...definition.primaryKey]
    : [definition.primaryKey as string];
}

function selectedColumn(table: TableName, column: string): string {
  if (tableDefinition(table).fields[column]?.type === 'binary') {
    return `CASE WHEN "${column}" IS NULL THEN NULL ELSE jsonb_build_object('bytes', octet_length("${column}")) END AS "${column}"`;
  }
  return `"${column}"`;
}

function parseRecordId(
  table: TableName,
  rawId: string
): unknown[] | null {
  const definition = tableDefinition(table);
  const keys = primaryKeyColumns(definition);
  let rawValues: unknown[];
  if (keys.length > 1) {
    try {
      const parsed: unknown = JSON.parse(rawId);
      if (!Array.isArray(parsed) || parsed.length !== keys.length) return null;
      rawValues = parsed;
    } catch {
      return null;
    }
  } else {
    rawValues = [rawId];
  }

  const values: unknown[] = [];
  for (const key of keys) {
    const value = rawValues[values.length];
    const field = definition.fields[key];
    if (field?.type === 'integer') {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
      values.push(parsed);
    } else if (field?.type === 'uuid') {
      const parsed = z.string().uuid().safeParse(value);
      if (!parsed.success) return null;
      values.push(parsed.data);
    } else if (typeof value === 'string' && value.length > 0 && value.length <= 500) {
      values.push(value);
    } else {
      return null;
    }
  }
  return values;
}

function primaryKeyWhere(definition: TableDefinition, values: unknown[], startAt = 1): string {
  return primaryKeyColumns(definition)
    .map((column, index) => `"${column}" = $${startAt + index}`)
    .join(' AND ');
}

function requireSuper(req: NewSchemaAuthRequest, res: Response): boolean {
  if (req.newSchemaUser?.role === 'super') return true;
  res.status(403).json({ success: false, message: 'Only Super users can manage database records.' });
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFieldValue(
  name: string,
  definition: FieldDefinition,
  value: unknown
): { success: true; value: unknown } | { success: false; message: string } {
  if ((value === null || value === '') && definition.nullable) {
    return { success: true, value: null };
  }
  if (definition.type === 'password') {
    if (typeof value !== 'string' || value.length > (definition.maxLength ?? 200)) {
      return { success: false, message: `${name} must be a valid password.` };
    }
    return { success: true, value };
  }
  if (value === null || value === undefined || value === '') {
    return { success: false, message: `${name} is required.` };
  }
  if (definition.type === 'text') {
    if (typeof value !== 'string' || value.length > (definition.maxLength ?? 5000)) {
      return { success: false, message: `${name} must be text of at most ${definition.maxLength ?? 5000} characters.` };
    }
    return { success: true, value };
  }
  if (definition.type === 'enum') {
    if (typeof value !== 'string' || !definition.options?.includes(value)) {
      return { success: false, message: `${name} has an unsupported value.` };
    }
    return { success: true, value };
  }
  if (definition.type === 'integer') {
    const parsed = typeof value === 'number' ? value : Number(value);
    const minimum = definition.min ?? 1;
    if (!Number.isSafeInteger(parsed) || parsed < minimum) {
      return { success: false, message: `${name} must be an integer greater than or equal to ${minimum}.` };
    }
    return { success: true, value: parsed };
  }
  if (definition.type === 'numeric') {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return { success: false, message: `${name} must be a valid number.` };
    return { success: true, value: parsed };
  }
  if (definition.type === 'json') {
    if (typeof value !== 'string') return { success: true, value };
    try {
      return { success: true, value: JSON.parse(value) as unknown };
    } catch {
      return { success: false, message: `${name} must contain valid JSON.` };
    }
  }
  if (definition.type === 'uuid') {
    const parsed = z.string().uuid().safeParse(value);
    return parsed.success
      ? { success: true, value: parsed.data }
      : { success: false, message: `${name} must be a valid UUID.` };
  }
  if (definition.type === 'binary') {
    return { success: false, message: `${name} is managed through the profile or document workflow.` };
  }
  if (definition.type === 'integer-array') {
    if (!Array.isArray(value) || value.some((item) => !Number.isSafeInteger(item) || Number(item) <= 0)) {
      return { success: false, message: `${name} must be an array of positive integers.` };
    }
    return { success: true, value };
  }
  if (definition.type === 'boolean') {
    if (typeof value !== 'boolean') return { success: false, message: `${name} must be true or false.` };
    return { success: true, value };
  }
  if (definition.type === 'url') {
    const parsed = z.string().url().max(definition.maxLength ?? 2000).safeParse(value);
    return parsed.success
      ? { success: true, value: parsed.data }
      : { success: false, message: `${name} must be a valid URL.` };
  }
  if (definition.type === 'date') {
    const parsed = z.string().date().safeParse(value);
    return parsed.success
      ? { success: true, value: parsed.data }
      : { success: false, message: `${name} must be a valid date.` };
  }
  if (definition.type === 'time') {
    const parsed = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).safeParse(value);
    return parsed.success
      ? { success: true, value: parsed.data }
      : { success: false, message: `${name} must be a valid time.` };
  }
  if (definition.type === 'datetime') {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
      return { success: false, message: `${name} must be a valid date and time.` };
    }
    return { success: true, value };
  }
  return { success: false, message: `${name} has an unsupported field type.` };
}

function parseRecord(
  table: TableName,
  value: unknown,
  creating: boolean
): { success: true; values: Record<string, unknown> } | { success: false; message: string } {
  if (!isRecord(value)) return { success: false, message: 'Provide a record object.' };
  const fields = TABLES[table].fields as Record<string, FieldDefinition>;
  const primaryKeyFields = new Set(
    (Array.isArray(TABLES[table].primaryKey)
      ? TABLES[table].primaryKey
      : [TABLES[table].primaryKey]) as readonly string[]
  );
  const unknownField = Object.keys(value).find((name) => !Object.prototype.hasOwnProperty.call(fields, name));
  if (unknownField) return { success: false, message: `Field ${unknownField} cannot be changed.` };

  const values: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (field.type === 'binary') {
      if (creating && field.required) {
        return { success: false, message: `${name} can only be created through the profile or document workflow.` };
      }
      continue;
    }
    if (!creating && primaryKeyFields.has(name)) continue;
    if (!Object.prototype.hasOwnProperty.call(value, name)) {
      if (creating && field.required) {
        if (table === 'users' && name === 'username' && value.role === 'account') continue;
        if (table === 'users' && name === 'parent_user_id' && value.role === 'super') continue;
        return { success: false, message: `${name} is required.` };
      }
      continue;
    }
    if (
      creating
      && table === 'users'
      && name === 'username'
      && value.role === 'account'
      && value[name] === ''
    ) continue;
    if (table === 'users' && name === 'password' && value[name] === '' && !creating) continue;
    if (value[name] === '' && !field.required && !field.nullable && field.type !== 'password') continue;
    const parsed = parseFieldValue(name, field, value[name]);
    if (!parsed.success) {
      if (name === 'password' && creating && parsed.message.endsWith('is required.')) continue;
      return parsed;
    }
    values[name] = parsed.value;
  }

  if (table === 'users') {
    const role = values.role;
    const effectiveRole = role ?? (creating ? null : undefined);
    if (effectiveRole === 'super') {
      values.parent_user_id = null;
      values.category_id = null;
      values.password = values.password || undefined;
    } else if (effectiveRole === 'account') {
      values.password = null;
      values.must_change_password = false;
    } else if (effectiveRole) {
      values.category_id = null;
      if (creating && (typeof values.password !== 'string' || values.password.length < 4)) {
        return { success: false, message: 'A staff password must contain at least 4 characters.' };
      }
    }
    if (creating && effectiveRole === 'account') {
      const requiredAccountFields = ['parent_user_id', 'email', 'address', 'sex', 'birthday', 'phone', 'country', 'city', 'category_id'];
      const missing = requiredAccountFields.find((name) => values[name] === undefined || values[name] === null);
      if (missing) return { success: false, message: `${missing} is required for an Account profile.` };
    }
    if (creating && effectiveRole === 'super' &&
        (typeof values.password !== 'string' || values.password.length < 4)) {
      return { success: false, message: 'A Super user password must contain at least 4 characters.' };
    }
    if (creating && effectiveRole !== 'super' && effectiveRole !== 'account' &&
        (values.parent_user_id === undefined || values.parent_user_id === null)) {
      return { success: false, message: 'parent_user_id is required for staff users.' };
    }
  }
  if (table === 'app_settings' && creating) {
    values.updated_by ??= null;
  }
  return { success: true, values };
}

const ListSchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
});

router.get('/tables', async (req: NewSchemaAuthRequest, res: Response, next: NextFunction) => {
  if (!requireSuper(req, res)) return;
  try {
    const tables = await Promise.all(
      (Object.keys(TABLES) as TableName[]).filter((key) => !EXCLUDED_TABLES.has(key)).map(async (key) => {
        const definition = tableDefinition(key);
        const result = await queryOne<{ count: number | string }>(
          `SELECT count(*)::int AS count FROM "${key}"`
        );
        return {
          id: key,
          label: definition.label,
          description: definition.description,
          count: Number(result?.count ?? 0),
        };
      })
    );
    res.json({ success: true, tables });
  } catch (error) {
    next(error);
  }
});

router.get('/tables/:table', async (req: NewSchemaAuthRequest, res: Response, next: NextFunction) => {
  if (!requireSuper(req, res)) return;
  if (!isTableName(req.params.table)) {
    res.status(404).json({ success: false, message: 'That database table is not available for browsing.' });
    return;
  }
  const parsed = ListSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: 'Search text or pagination values are invalid.' });
    return;
  }

  const { q, limit, offset } = parsed.data;
  const table = req.params.table;
  const definition = tableDefinition(table);
  try {
    const searchCondition = q
      ? `WHERE ${definition.searchColumns
        .map((column) => `position(lower($1) in lower(COALESCE("${column}"::text, ''))) > 0`)
        .join(' OR ')}`
      : '';
    const params = q ? [q] : [];
    const count = await queryOne<{ count: number | string }>(
      `SELECT count(*)::int AS count FROM "${req.params.table}" ${searchCondition}`,
      params
    );
    const records = await queryAll<Record<string, unknown>>(
      `SELECT ${definition.columns.map((column) => selectedColumn(table, column)).join(', ')}
       FROM "${req.params.table}" ${searchCondition}
       ORDER BY "${definition.orderBy}" DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      table: {
        id: req.params.table,
        label: definition.label,
        description: definition.description,
        columns: definition.columns,
        primaryKey: definition.primaryKey,
        fields: Object.entries(definition.fields).map(([name, field]) => ({
          name,
          ...field,
        })),
      },
      records,
      total: Number(count?.count ?? 0),
      limit,
      offset,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/tables/:table', async (req: NewSchemaAuthRequest, res: Response, next: NextFunction) => {
  if (!requireSuper(req, res)) return;
  if (!isTableName(req.params.table)) {
    res.status(404).json({ success: false, message: 'That database table is not available for editing.' });
    return;
  }
  const table = req.params.table;
  const parsed = parseRecord(table, req.body, true);
  if (!parsed.success) {
    res.status(400).json({ success: false, message: parsed.message });
    return;
  }
  try {
    const values = { ...parsed.values };
    if (table === 'users') {
      if (values.role === 'account' && !values.username) values.username = `account-${randomUUID()}`;
      values.password_hash = typeof values.password === 'string'
        ? await bcrypt.hash(values.password, 12)
        : null;
      delete values.password;
    }
    if (table === 'app_settings') values.updated_by = req.newSchemaUser!.id;
    if (table === 'prompts') {
      values.created_by = req.newSchemaUser!.id;
      values.updated_by = req.newSchemaUser!.id;
    }

    const columns = Object.keys(values);
    const placeholders = columns.map((_column, index) => `$${index + 1}`);
    const definition = tableDefinition(table);
    const returnColumns = definition.columns.map((column) => selectedColumn(table, column)).join(', ');
    const record = await queryOne(
      `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(', ')})
       VALUES (${placeholders.join(', ')})
       RETURNING ${returnColumns}`,
      columns.map((column) => values[column])
    );
    res.status(201).json({ success: true, record });
  } catch (error) {
    next(error);
  }
});

router.put('/tables/:table/:id', async (req: NewSchemaAuthRequest, res: Response, next: NextFunction) => {
  if (!requireSuper(req, res)) return;
  if (!isTableName(req.params.table)) {
    res.status(404).json({ success: false, message: 'That database table is not available for editing.' });
    return;
  }
  const table = req.params.table;
  const definition = tableDefinition(table);
  const recordIdValues = parseRecordId(table, req.params.id);
  if (!recordIdValues) {
    res.status(400).json({ success: false, message: 'Invalid record ID.' });
    return;
  }
  const parsed = parseRecord(table, req.body, false);
  if (!parsed.success || Object.keys(parsed.values).length === 0) {
    res.status(400).json({
      success: false,
      message: parsed.success ? 'Provide at least one field to update.' : parsed.message,
    });
    return;
  }
  try {
    const values = { ...parsed.values };
    if (table === 'users') {
      const current = values.role
        ? await queryOne<{ role: string }>('SELECT role FROM users WHERE u_id = $1', recordIdValues)
        : undefined;
      if (current?.role === 'super' && values.role !== 'super') {
        if (Number(recordIdValues[0]) === req.newSchemaUser!.id) {
          res.status(400).json({ success: false, message: 'You cannot change the role of the Super account you are using.' });
          return;
        }
        const count = await queryOne<{ count: number | string }>(
          "SELECT count(*)::int AS count FROM users WHERE role = 'super'"
        );
        if (Number(count?.count ?? 0) <= 1) {
          res.status(400).json({ success: false, message: 'The last Super account cannot be demoted.' });
          return;
        }
      }
      if (values.role === 'account') {
        values.password_hash = null;
        values.must_change_password = false;
      } else if (typeof values.password === 'string' && values.password.length > 0) {
        if (values.password.length < 4) {
          res.status(400).json({ success: false, message: 'A password must contain at least 4 characters.' });
          return;
        }
        values.password_hash = await bcrypt.hash(values.password, 12);
      } else if (values.role && values.role !== 'account') {
        if (current?.role === 'account') {
          res.status(400).json({ success: false, message: 'Enter a password when changing an Account profile to a staff role.' });
          return;
        }
      }
      delete values.password;
    }
    if (table === 'app_settings') {
      values.updated_by = req.newSchemaUser!.id;
      values.updated_date = new Date().toISOString();
    }
    if (table === 'prompts') {
      values.updated_by = req.newSchemaUser!.id;
      values.updated_date = new Date().toISOString();
    }

    const columns = Object.keys(values);
    const params = columns.map((column) => values[column]);
    const assignments = columns.map((column, index) => `"${column}" = $${index + 1}`);
    params.push(...recordIdValues);
    const returnColumns = definition.columns.map((column) => selectedColumn(table, column)).join(', ');
    const record = await queryOne(
      `UPDATE "${table}" SET ${assignments.join(', ')}
       WHERE ${primaryKeyWhere(definition, recordIdValues, columns.length + 1)}
       RETURNING ${returnColumns}`,
      params
    );
    if (!record) {
      res.status(404).json({ success: false, message: 'Record not found.' });
      return;
    }
    res.json({ success: true, record });
  } catch (error) {
    next(error);
  }
});

router.delete('/tables/:table/:id', async (req: NewSchemaAuthRequest, res: Response, next: NextFunction) => {
  if (!requireSuper(req, res)) return;
  if (!isTableName(req.params.table)) {
    res.status(404).json({ success: false, message: 'That database table is not available for editing.' });
    return;
  }
  const table = req.params.table;
  const definition = tableDefinition(table);
  const recordIdValues = parseRecordId(table, req.params.id);
  if (!recordIdValues) {
    res.status(400).json({ success: false, message: 'Invalid record ID.' });
    return;
  }
  if (table === 'users' && Number(recordIdValues[0]) === req.newSchemaUser!.id) {
    res.status(400).json({ success: false, message: 'You cannot delete the Super account you are using.' });
    return;
  }

  try {
    if (table === 'users') {
      const target = await queryOne<{ role: string }>(
        'SELECT role FROM users WHERE u_id = $1',
        recordIdValues
      );
      if (target?.role === 'super') {
        const count = await queryOne<{ count: number | string }>(
          "SELECT count(*)::int AS count FROM users WHERE role = 'super'"
        );
        if (Number(count?.count ?? 0) <= 1) {
          res.status(400).json({ success: false, message: 'The last Super account cannot be deleted.' });
          return;
        }
      }
    }
    if (table === 'job_list') {
      const deleted = await withTransaction(async (tx) => {
        const lockedJob = await tx.query(
          'SELECT j_id FROM job_list WHERE j_id = $1 FOR UPDATE',
          recordIdValues
        );
        if (!lockedJob.rows.length) return null;

        const bids = await tx.query(
          'DELETE FROM bids WHERE j_id = $1 RETURNING b_id',
          recordIdValues
        );
        await tx.query('DELETE FROM job_list WHERE j_id = $1', recordIdValues);
        return {
          bidsDeleted: bids.rowCount ?? bids.rows.length,
        };
      });
      if (!deleted) {
        res.status(404).json({ success: false, message: 'Record not found.' });
        return;
      }
      res.json({
        success: true,
        message: `Account-specific job row deleted with ${deleted.bidsDeleted} Bid record(s). Related interview records were deleted with their Bids.`,
        ...deleted,
      });
      return;
    }

    const result = await execute(
      `DELETE FROM "${table}" WHERE ${primaryKeyWhere(definition, recordIdValues)}`,
      recordIdValues
    );
    if (!result.rowCount) {
      res.status(404).json({ success: false, message: 'Record not found.' });
      return;
    }
    res.json({ success: true, message: 'Record deleted.' });
  } catch (error) {
    if (table === 'job_list'
      && typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === '23503') {
      res.status(409).json({
        success: false,
        message: 'This job has related application history and cannot be deleted.',
      });
      return;
    }
    next(error);
  }
});

export default router;
