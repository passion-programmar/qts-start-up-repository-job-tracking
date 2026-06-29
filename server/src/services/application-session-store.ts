// In-memory apply session store (server-side). Extension mirror: extension/shared/apply-session-store.js

import { createPublicTaskId } from '../modules/application-sessions/application-task-id';
import { normalizeUrl } from '../utilities/normalize-url';

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

export type ApplicationSessionStatus =
  | 'active'
  | 'scanning'
  | 'filling'
  | 'awaiting_ai'
  | 'completed'
  | 'abandoned'
  | 'error';

export interface MemorySessionField {
  id: number;
  session_id: number;
  stable_field_id: string;
  label: string | null;
  field_type: string;
  required: boolean;
  options: unknown;
  current_value: string | null;
  placeholder: string | null;
  section_heading: string | null;
  page_step: string | null;
  page_url: string | null;
  name_attr: string | null;
  autocomplete_attr: string | null;
  validation_message: string | null;
  selector_hints: Record<string, unknown>;
  field_fingerprint: string;
  category: string;
  profile_key: string | null;
  saved_answer_key: string | null;
  document_slot: string | null;
  fill_value: string | null;
  fill_status: string;
  generated_answer: string | null;
  discovered_at: string;
  updated_at: string;
}

export interface MemorySession {
  id: number;
  candidate_id: number;
  job_id: number | null;
  user_id: number;
  bidder_id: number;
  job_url: string;
  normalized_url: string;
  job_title: string | null;
  company: string | null;
  job_description: string | null;
  platform: string | null;
  current_step: string;
  discovered_pages: unknown[];
  generated_answers: Record<string, string>;
  status: ApplicationSessionStatus;
  metadata: Record<string, unknown>;
  started_at: string;
  last_activity_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  candidate_name?: string | null;
  candidate_email?: string | null;
  candidate_phone?: string | null;
  candidate_linkedin_url?: string | null;
  candidate_stack?: string | null;
}

type CreateSessionInput = {
  candidateId: number;
  jobId?: number | null;
  userId: number;
  bidderId: number;
  jobUrl: string;
  jobTitle?: string | null;
  company?: string | null;
  jobDescription?: string | null;
  platform?: string | null;
  currentStep?: string | null;
  discoveredPages?: unknown[];
  metadata?: Record<string, unknown>;
  candidate?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    linkedin_url?: string | null;
    stack?: string | null;
  };
};

export type UpsertFieldInput = {
  stableFieldId: string;
  label?: string | null;
  fieldType: string;
  required?: boolean;
  options?: unknown;
  currentValue?: string | null;
  placeholder?: string | null;
  sectionHeading?: string | null;
  pageStep?: string | null;
  pageUrl?: string | null;
  nameAttr?: string | null;
  autocompleteAttr?: string | null;
  validationMessage?: string | null;
  selectorHints?: Record<string, unknown> | null;
  fieldFingerprint: string;
  category?: string;
  profileKey?: string | null;
  savedAnswerKey?: string | null;
  documentSlot?: string | null;
  fillValue?: string | null;
  fillStatus?: string;
  generatedAnswer?: string | null;
};

let nextSessionId = 1_000_000;
let nextFieldId = 1;
const sessionsById = new Map<number, MemorySession>();
const sessionIdByTaskId = new Map<string, number>();
const fieldsBySessionId = new Map<number, Map<string, MemorySessionField>>();

function nowIso(): string {
  return new Date().toISOString();
}

function touchSession(session: MemorySession): void {
  session.last_activity_at = nowIso();
  session.updated_at = nowIso();
}

function pruneExpiredSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessionsById) {
    const last = Date.parse(session.last_activity_at || session.created_at);
    if (!Number.isFinite(last) || last < cutoff) {
      sessionsById.delete(id);
      fieldsBySessionId.delete(id);
      const taskId = readPublicTaskIdFromSession(session);
      if (taskId) sessionIdByTaskId.delete(taskId);
    }
  }
}

setInterval(pruneExpiredSessions, CLEANUP_INTERVAL_MS).unref?.();

export function readPublicTaskIdFromSession(session: MemorySession): string | null {
  const raw = session.metadata?.publicTaskId ?? session.metadata?.taskId;
  return typeof raw === 'string' && raw.startsWith('task_') ? raw : null;
}

export function createMemoryApplicationSession(input: CreateSessionInput): MemorySession {
  pruneExpiredSessions();
  const id = nextSessionId++;
  const passedRaw = input.metadata?.publicTaskId ?? input.metadata?.taskId;
  const passedTaskId = typeof passedRaw === 'string' && passedRaw.startsWith('task_') ? passedRaw : null;
  const publicTaskId = passedTaskId ?? createPublicTaskId();
  const timestamp = nowIso();
  const metadata = {
    ...(input.metadata ?? {}),
    publicTaskId,
    taskId: publicTaskId,
  };

  const session: MemorySession = {
    id,
    candidate_id: input.candidateId,
    job_id: input.jobId ?? null,
    user_id: input.userId,
    bidder_id: input.bidderId,
    job_url: input.jobUrl,
    normalized_url: normalizeUrl(input.jobUrl),
    job_title: input.jobTitle ?? null,
    company: input.company ?? null,
    job_description: input.jobDescription ?? null,
    platform: input.platform ?? null,
    current_step: input.currentStep ?? 'scan',
    discovered_pages: input.discoveredPages ?? [],
    generated_answers: {},
    status: 'scanning',
    metadata,
    started_at: timestamp,
    last_activity_at: timestamp,
    completed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    candidate_name: input.candidate?.name ?? null,
    candidate_email: input.candidate?.email ?? null,
    candidate_phone: input.candidate?.phone ?? null,
    candidate_linkedin_url: input.candidate?.linkedin_url ?? null,
    candidate_stack: input.candidate?.stack ?? null,
  };

  sessionsById.set(id, session);
  sessionIdByTaskId.set(publicTaskId, id);
  fieldsBySessionId.set(id, new Map());
  return session;
}

export function getMemoryApplicationSession(sessionId: number): MemorySession | null {
  return sessionsById.get(sessionId) ?? null;
}

export function resolveMemorySessionIdFromTaskId(taskIdParam: string): number | null {
  const trimmed = String(taskIdParam || '').trim();
  if (!trimmed) return null;
  const byTask = sessionIdByTaskId.get(trimmed);
  if (byTask) return byTask;
  for (const session of sessionsById.values()) {
    if (readPublicTaskIdFromSession(session) === trimmed) return session.id;
  }
  const legacy = trimmed.match(/^task_(\d+)$/i);
  if (legacy) {
    const id = parseInt(legacy[1], 10);
    return sessionsById.has(id) ? id : null;
  }
  if (/^\d+$/.test(trimmed)) {
    const id = parseInt(trimmed, 10);
    return sessionsById.has(id) ? id : null;
  }
  return null;
}

export function upsertMemorySessionFields(
  sessionId: number,
  fields: UpsertFieldInput[],
  updates?: {
    currentStep?: string | null;
    discoveredPages?: unknown[];
    status?: ApplicationSessionStatus;
  }
): MemorySessionField[] {
  const session = sessionsById.get(sessionId);
  if (!session) return [];

  const fieldMap = fieldsBySessionId.get(sessionId) ?? new Map<string, MemorySessionField>();
  const timestamp = nowIso();

  for (const field of fields) {
    const existing = fieldMap.get(field.stableFieldId);
    const next: MemorySessionField = {
      id: existing?.id ?? nextFieldId++,
      session_id: sessionId,
      stable_field_id: field.stableFieldId,
      label: field.label ?? null,
      field_type: field.fieldType,
      required: field.required ?? false,
      options: field.options ?? [],
      current_value: field.currentValue ?? null,
      placeholder: field.placeholder ?? null,
      section_heading: field.sectionHeading ?? null,
      page_step: field.pageStep ?? null,
      page_url: field.pageUrl ?? null,
      name_attr: field.nameAttr ?? null,
      autocomplete_attr: field.autocompleteAttr ?? null,
      validation_message: field.validationMessage ?? null,
      selector_hints: field.selectorHints ?? {},
      field_fingerprint: field.fieldFingerprint,
      category: field.category ?? 'unknown',
      profile_key: field.profileKey ?? null,
      saved_answer_key: field.savedAnswerKey ?? null,
      document_slot: field.documentSlot ?? null,
      fill_value: field.fillValue ?? null,
      fill_status: field.fillStatus ?? 'pending',
      generated_answer: field.generatedAnswer ?? null,
      discovered_at: existing?.discovered_at ?? timestamp,
      updated_at: timestamp,
    };
    fieldMap.set(field.stableFieldId, next);
  }

  fieldsBySessionId.set(sessionId, fieldMap);
  if (updates?.currentStep) session.current_step = updates.currentStep;
  if (updates?.discoveredPages) session.discovered_pages = updates.discoveredPages;
  if (updates?.status) session.status = updates.status;
  touchSession(session);
  return listMemorySessionFields(sessionId);
}

export function listMemorySessionFields(sessionId: number): MemorySessionField[] {
  const fieldMap = fieldsBySessionId.get(sessionId);
  if (!fieldMap) return [];
  return [...fieldMap.values()].sort((a, b) => a.id - b.id);
}

export function updateMemorySession(
  sessionId: number,
  patch: Partial<Pick<MemorySession, 'status' | 'current_step' | 'discovered_pages' | 'generated_answers' | 'metadata' | 'completed_at'>>
): MemorySession | null {
  const session = sessionsById.get(sessionId);
  if (!session) return null;
  if (patch.status !== undefined) session.status = patch.status;
  if (patch.current_step !== undefined) session.current_step = patch.current_step;
  if (patch.discovered_pages !== undefined) session.discovered_pages = patch.discovered_pages;
  if (patch.generated_answers !== undefined) session.generated_answers = patch.generated_answers;
  if (patch.metadata !== undefined) session.metadata = patch.metadata;
  if (patch.completed_at !== undefined) session.completed_at = patch.completed_at;
  touchSession(session);
  return session;
}

export function updateMemorySessionField(
  sessionId: number,
  stableFieldId: string,
  patch: Partial<Pick<MemorySessionField, 'generated_answer' | 'fill_value' | 'fill_status'>>
): void {
  const fieldMap = fieldsBySessionId.get(sessionId);
  if (!fieldMap) return;
  const field = fieldMap.get(stableFieldId);
  if (!field) return;
  if (patch.generated_answer !== undefined) field.generated_answer = patch.generated_answer;
  if (patch.fill_value !== undefined) field.fill_value = patch.fill_value;
  if (patch.fill_status !== undefined) field.fill_status = patch.fill_status;
  field.updated_at = nowIso();
  const session = sessionsById.get(sessionId);
  if (session) touchSession(session);
}

export function countMemoryPendingAiFields(sessionId: number): number {
  return listMemorySessionFields(sessionId).filter(
    (field) =>
      field.category === 'ai_generation'
      && (field.fill_status === 'pending' || field.fill_status === 'awaiting_answer')
  ).length;
}
