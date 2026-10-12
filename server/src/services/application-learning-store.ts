import { createHash } from 'node:crypto';
import { config } from '../config/env';
import { execute, queryAll, queryOne } from '../database/connection';
import {
  getMemoryApplicationSession,
  listMemorySessionFields,
  registerMemorySessionCleanupListener,
} from './application-session-store';

export type LearningPolicyType =
  | 'reusable_profile'
  | 'generated_ai'
  | 'requires_review'
  | 'manual_only'
  | 'ignore';

type MemoryAnswerPolicy = {
  id: number;
  policyType: LearningPolicyType;
  answerSource: string | null;
  approvedByUser: boolean;
  confidence: number;
  observedAnswer: string | null;
  editedAnswer: string | null;
};

type MemorySemanticMapping = {
  id: number;
  stableFieldId: string;
  normalizedQuestion: string;
  questionHash: string;
  fieldType: string | null;
  sectionHeading: string | null;
  semanticGroup: string;
  confidence: number;
  sourceTemplateId: number | null;
  updatedAt: string;
  policy: MemoryAnswerPolicy | null;
};

const memorySemanticsBySession = new Map<number, MemorySemanticMapping[]>();
let nextMemorySemanticId = 1;
let nextMemoryPolicyId = 1;

registerMemorySessionCleanupListener((sessionId) => {
  memorySemanticsBySession.delete(sessionId);
});

function pruneExpiredMemoryLearning(): void {
  for (const sessionId of memorySemanticsBySession.keys()) {
    getMemoryApplicationSession(sessionId);
  }
}

const SEMANTIC_ALIASES: Record<string, string> = {
  firstname: 'first name',
  'first name': 'first name',
  given: 'first',
  givenname: 'first name',
  surname: 'last name',
  lastname: 'last name',
  'last name': 'last name',
  phone: 'phone number',
  'phone number': 'phone number',
  mobile: 'phone number',
  cellphone: 'phone number',
  email: 'email address',
  'email address': 'email address',
  'street address': 'address',
  address1: 'address',
  addressline1: 'address',
  'work authorization': 'work authorization',
  visa: 'work authorization',
  sponsorship: 'work authorization',
  'linkedin url': 'linkedin',
  linkedin: 'linkedin',
  'cv': 'resume',
  resume: 'resume',
  'cover letter': 'cover letter',
  coverletter: 'cover letter',
  'salary expectation': 'salary expectation',
  compensation: 'salary expectation',
  'expected salary': 'salary expectation',
};

function canonicalizeSemanticTokens(value: string): string[] {
  const normalized = String(value ?? '')
    .toLowerCase()
    .replace(/[_/\\-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(what is|what's|please enter|enter|your|the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return [];

  const tokens = normalized.split(' ')
    .flatMap((token) => {
      const alias = SEMANTIC_ALIASES[token] ?? token;
      return alias.trim().split(' ').filter(Boolean);
    })
    .filter(Boolean);

  return [...new Set(tokens)];
}

export function normalizeQuestion(question?: string | null): string {
  const tokens = canonicalizeSemanticTokens(question ?? '');
  return tokens.join(' ');
}

export function hashQuestion(question?: string | null): string {
  return createHash('sha256').update(normalizeQuestion(question)).digest('hex');
}

function normalizeSemanticFieldType(fieldType?: string | null): string {
  const normalized = String(fieldType ?? '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (/email|mail/.test(normalized)) return 'email';
  if (/phone|mobile|tel/.test(normalized)) return 'phone';
  if (/(city|state|country|zip|postal)/.test(normalized)) return 'location';
  if (/(address|street)/.test(normalized)) return 'address';
  if (/(resume|cv|cover)/.test(normalized)) return 'document';
  if (/(salary|compensation|rate)/.test(normalized)) return 'salary';
  return normalized;
}

export function scoreSemanticMatch(
  target: { question?: string | null; fieldType?: string | null; sectionHeading?: string | null },
  candidate: { question?: string | null; fieldType?: string | null; sectionHeading?: string | null }
): number {
  const targetQuestion = normalizeQuestion(target.question ?? '');
  const candidateQuestion = normalizeQuestion(candidate.question ?? '');
  const targetSection = normalizeQuestion(target.sectionHeading ?? '');
  const candidateSection = normalizeQuestion(candidate.sectionHeading ?? '');
  const targetType = normalizeSemanticFieldType(target.fieldType);
  const candidateType = normalizeSemanticFieldType(candidate.fieldType);

  if (!targetQuestion && !candidateQuestion) return 0;
  if (targetQuestion && candidateQuestion && targetQuestion === candidateQuestion) return 1;

  const targetTokens = new Set(canonicalizeSemanticTokens(targetQuestion));
  const candidateTokens = new Set(canonicalizeSemanticTokens(candidateQuestion));
  const overlap = [...targetTokens].filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...targetTokens, ...candidateTokens]);
  const tokenScore = union.size > 0 ? overlap / union.size : 0;

  const sectionOverlap = targetSection && candidateSection
    ? Math.min(1, [...new Set(canonicalizeSemanticTokens(targetSection))].filter((token) =>
        new Set(canonicalizeSemanticTokens(candidateSection)).has(token)
      ).length / Math.max(1, new Set([...canonicalizeSemanticTokens(targetSection), ...canonicalizeSemanticTokens(candidateSection)]).size))
    : 0;

  const typeScore = targetType && candidateType && targetType === candidateType ? 0.2 : 0;
  const exactQuestionHit = targetQuestion.includes(candidateQuestion) || candidateQuestion.includes(targetQuestion) ? 0.25 : 0;

  return clampConfidence(tokenScore * 0.7 + sectionOverlap * 0.15 + typeScore + exactQuestionHit);
}

export async function upsertSemanticMapping(input: {
  stableFieldId: string;
  question?: string | null;
  fieldType?: string | null;
  sectionHeading?: string | null;
  confidence?: number;
  sourceSessionId?: number | null;
  sourceTemplateId?: number | null;
  inferredSemanticGroup?: string;
}) {
  const normalizedQuestion = normalizeQuestion(input.question);
  const inferredSemanticGroup = (input.inferredSemanticGroup ?? 'unknown').trim() || 'unknown';
  const sourceSessionId = input.sourceSessionId ?? null;
  if (!config.applicationSessionPersistDb) {
    pruneExpiredMemoryLearning();
    if (sourceSessionId === null || !getMemoryApplicationSession(sourceSessionId)) return null;
    const sessionSemantics = memorySemanticsBySession.get(sourceSessionId) ?? [];
    let mapping = sessionSemantics.find((item) =>
      item.stableFieldId === input.stableFieldId && item.semanticGroup === inferredSemanticGroup
    );
    const confidence = Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0;

    if (mapping) {
      mapping.normalizedQuestion = normalizedQuestion;
      mapping.questionHash = hashQuestion(normalizedQuestion);
      mapping.fieldType = input.fieldType ?? null;
      mapping.sectionHeading = input.sectionHeading ?? null;
      mapping.confidence = confidence;
      mapping.sourceTemplateId = input.sourceTemplateId ?? null;
      mapping.updatedAt = new Date().toISOString();
    } else {
      mapping = {
        id: nextMemorySemanticId++,
        stableFieldId: input.stableFieldId,
        normalizedQuestion,
        questionHash: hashQuestion(normalizedQuestion),
        fieldType: input.fieldType ?? null,
        sectionHeading: input.sectionHeading ?? null,
        semanticGroup: inferredSemanticGroup,
        confidence,
        sourceTemplateId: input.sourceTemplateId ?? null,
        updatedAt: new Date().toISOString(),
        policy: null,
      };
      sessionSemantics.push(mapping);
      memorySemanticsBySession.set(sourceSessionId, sessionSemantics);
    }

    return {
      id: mapping.id,
      stable_field_id: mapping.stableFieldId,
      normalized_question: mapping.normalizedQuestion,
      question_hash: mapping.questionHash,
      field_type: mapping.fieldType,
      section_heading: mapping.sectionHeading,
      inferred_semantic_group: mapping.semanticGroup,
      confidence: mapping.confidence,
      source_session_id: sourceSessionId,
      source_template_id: mapping.sourceTemplateId,
    };
  }

  const row = await queryOne<{
    id: number;
    stable_field_id: string;
    normalized_question: string;
    question_hash: string;
    field_type: string | null;
    section_heading: string | null;
    inferred_semantic_group: string;
    confidence: number;
    source_session_id: number | null;
    source_template_id: number | null;
  }>(`
    INSERT INTO application_field_semantics (
      stable_field_id,
      normalized_question,
      question_hash,
      field_type,
      section_heading,
      inferred_semantic_group,
      confidence,
      source_session_id,
      source_template_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (stable_field_id, inferred_semantic_group)
    DO UPDATE SET
      normalized_question = EXCLUDED.normalized_question,
      question_hash = EXCLUDED.question_hash,
      field_type = EXCLUDED.field_type,
      section_heading = EXCLUDED.section_heading,
      confidence = EXCLUDED.confidence,
      source_session_id = EXCLUDED.source_session_id,
      source_template_id = EXCLUDED.source_template_id,
      updated_at = NOW()
    RETURNING *
  `, [
    input.stableFieldId,
    normalizedQuestion,
    hashQuestion(normalizedQuestion),
    input.fieldType ?? null,
    input.sectionHeading ?? null,
    inferredSemanticGroup,
    Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0,
    sourceSessionId,
    input.sourceTemplateId ?? null,
  ]);

  return row;
}

export async function upsertAnswerPolicy(input: {
  semanticId: number;
  policyType: LearningPolicyType;
  confidence?: number;
  answerSource?: string | null;
  approvedByUser?: boolean;
  observedAnswer?: string | null;
  editedAnswer?: string | null;
}) {
  if (!config.applicationSessionPersistDb) {
    pruneExpiredMemoryLearning();
    for (const semantics of memorySemanticsBySession.values()) {
      const mapping = semantics.find((item) => item.id === input.semanticId);
      if (!mapping) continue;
      const policy: MemoryAnswerPolicy = {
        id: mapping.policy?.id ?? nextMemoryPolicyId++,
        policyType: input.policyType,
        answerSource: input.answerSource ?? null,
        approvedByUser: Boolean(input.approvedByUser),
        confidence: Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0,
        observedAnswer: input.observedAnswer ?? null,
        editedAnswer: input.editedAnswer ?? null,
      };
      mapping.policy = policy;
      return {
        id: policy.id,
        semantic_id: mapping.id,
        policy_type: policy.policyType,
        answer_source: policy.answerSource,
        approved_by_user: policy.approvedByUser,
        confidence: policy.confidence,
        observed_answer: policy.observedAnswer,
        edited_answer: policy.editedAnswer,
      };
    }
    return null;
  }

  const row = await queryOne<{
    id: number;
    semantic_id: number;
    policy_type: LearningPolicyType;
    answer_source: string | null;
    approved_by_user: boolean;
    confidence: number;
    observed_answer: string | null;
    edited_answer: string | null;
  }>(`
    INSERT INTO application_answer_policies (
      semantic_id,
      policy_type,
      answer_source,
      approved_by_user,
      confidence,
      observed_answer,
      edited_answer
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [
    input.semanticId,
    input.policyType,
    input.answerSource ?? null,
    Boolean(input.approvedByUser),
    Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 0,
    input.observedAnswer ?? null,
    input.editedAnswer ?? null,
  ]);

  return row;
}

export async function listLearningQueue(sessionId: number) {
  if (!config.applicationSessionPersistDb) {
    pruneExpiredMemoryLearning();
    if (!getMemoryApplicationSession(sessionId)) return [];
    const reviewedFieldIds = new Set(
      (memorySemanticsBySession.get(sessionId) ?? [])
        .filter((mapping) => mapping.policy)
        .map((mapping) => mapping.stableFieldId)
    );
    return listMemorySessionFields(sessionId)
      .filter((field) => !reviewedFieldIds.has(field.stable_field_id))
      .map((field) => ({
        stableFieldId: field.stable_field_id,
        label: field.label,
        fieldType: field.field_type,
        currentAnswer: field.fill_value,
        fillStatus: field.fill_status,
        category: field.category,
        sectionHeading: field.section_heading,
        pageStep: field.page_step,
        updatedAt: field.updated_at,
      }));
  }

  return queryAll<Record<string, unknown>>(`
    SELECT
      f.stable_field_id AS "stableFieldId",
      f.label,
      f.field_type AS "fieldType",
      f.fill_value AS "currentAnswer",
      f.fill_status AS "fillStatus",
      f.category,
      f.section_heading AS "sectionHeading",
      f.page_step AS "pageStep",
      f.updated_at AS "updatedAt"
    FROM application_session_fields f
    WHERE f.session_id = $1
      AND NOT EXISTS (
        SELECT 1
        FROM application_field_semantics s
        JOIN application_answer_policies p
          ON p.semantic_id = s.id
        WHERE s.source_session_id = f.session_id
          AND s.stable_field_id = f.stable_field_id
      )
    ORDER BY f.updated_at DESC, f.id ASC
  `, [sessionId]);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function calculatePolicyConfidence(input: {
  policyType?: string | null;
  approvedByUser?: boolean | null;
  semanticConfidence?: number | null;
  evidenceCount?: number | null;
  hasEditedAnswer?: boolean | null;
}): number {
  const policyType = input.policyType ?? 'requires_review';
  const approvedByUser = Boolean(input.approvedByUser);
  const semanticConfidence = Number(input.semanticConfidence ?? 0);
  const evidenceCount = Math.max(0, Number(input.evidenceCount ?? 0));
  const hasEditedAnswer = Boolean(input.hasEditedAnswer);

  const typeWeights: Record<string, number> = {
    reusable_profile: 0.35,
    generated_ai: 0.2,
    requires_review: 0.12,
    manual_only: 0.18,
    ignore: -0.3,
  };

  const base = approvedByUser ? 0.58 : 0.2;
  const behavior = typeWeights[policyType] ?? 0.08;
  const evidenceScore = Math.min(0.18, evidenceCount * 0.06);
  const editScore = hasEditedAnswer ? 0.08 : 0;
  const historicalScore = clampConfidence((semanticConfidence || 0) * 0.45);

  return clampConfidence(base + behavior + evidenceScore + editScore + historicalScore);
}

export async function getLearningSummary(sessionId: number) {
  if (!config.applicationSessionPersistDb) {
    getMemoryApplicationSession(sessionId);
    pruneExpiredMemoryLearning();
    const fields = listMemorySessionFields(sessionId);
    const semantics = memorySemanticsBySession.get(sessionId) ?? [];
    const scores = semantics.map((mapping) => calculatePolicyConfidence({
      policyType: mapping.policy?.policyType ?? 'requires_review',
      approvedByUser: mapping.policy?.approvedByUser ?? false,
      semanticConfidence: mapping.confidence,
      evidenceCount: 0,
      hasEditedAnswer: Boolean(mapping.policy?.editedAnswer),
    }));

    return {
      totalFields: fields.length,
      reusableProfileCount: fields.filter((field) => field.category === 'candidate_profile').length,
      generatedAiCount: fields.filter((field) => field.category === 'ai_generation').length,
      reviewRequiredCount: fields.filter((field) => field.category === 'needs_review').length,
      unresolvedCount: fields.filter((field) =>
        field.fill_status === 'pending' || field.fill_status === 'awaiting_answer'
      ).length,
      confidenceAverage: scores.length
        ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(4))
        : 0,
    };
  }

  const fields = await queryAll<Record<string, unknown>>(`
    SELECT
      COUNT(*)::int AS total_fields,
      COUNT(*) FILTER (WHERE category = 'candidate_profile')::int AS reusable_profile_count,
      COUNT(*) FILTER (WHERE category = 'ai_generation')::int AS generated_ai_count,
      COUNT(*) FILTER (WHERE category = 'needs_review')::int AS review_required_count,
      COUNT(*) FILTER (WHERE fill_status IN ('pending', 'awaiting_answer'))::int AS unresolved_count
    FROM application_session_fields
    WHERE session_id = $1
  `, [sessionId]);

  const semantics = await queryAll<Record<string, unknown>>(`
    SELECT
      s.id,
      s.inferred_semantic_group,
      s.confidence,
      p.policy_type,
      p.approved_by_user,
      p.edited_answer,
      COALESCE(event_counts.event_count, 0)::int AS event_count
    FROM application_field_semantics s
    LEFT JOIN application_answer_policies p
      ON p.semantic_id = s.id
    LEFT JOIN (
      SELECT
        e.field_stable_id,
        COUNT(*)::int AS event_count
      FROM application_learning_events e
      JOIN application_learning_sessions ls
        ON ls.id = e.learning_session_id
      WHERE ls.session_id = $1
      GROUP BY e.field_stable_id
    ) event_counts
      ON event_counts.field_stable_id = s.stable_field_id
    WHERE s.source_session_id = $1
  `, [sessionId]);

  const firstRow = fields[0] as Record<string, unknown> | undefined;
  const averageConfidence = semantics.length > 0
    ? semantics.reduce((sum, row) => {
        const policyType = typeof row.policy_type === 'string' ? row.policy_type : 'requires_review';
        const score = calculatePolicyConfidence({
          policyType,
          approvedByUser: Boolean(row.approved_by_user),
          semanticConfidence: Number(row.confidence ?? 0),
          evidenceCount: Number(row.event_count ?? 0),
          hasEditedAnswer: Boolean(row.edited_answer),
        });
        return sum + score;
      }, 0) / semantics.length
    : 0;

  return {
    totalFields: Number(firstRow?.total_fields ?? 0),
    reusableProfileCount: Number(firstRow?.reusable_profile_count ?? 0),
    generatedAiCount: Number(firstRow?.generated_ai_count ?? 0),
    reviewRequiredCount: Number(firstRow?.review_required_count ?? 0),
    unresolvedCount: Number(firstRow?.unresolved_count ?? 0),
    confidenceAverage: Number(averageConfidence.toFixed(4)),
  };
}

export async function getReplayConfidence(sessionId: number) {
  if (!config.applicationSessionPersistDb) {
    getMemoryApplicationSession(sessionId);
    pruneExpiredMemoryLearning();
    return (memorySemanticsBySession.get(sessionId) ?? [])
      .sort((left, right) =>
        right.confidence - left.confidence
        || right.updatedAt.localeCompare(left.updatedAt)
      )
      .slice(0, 25)
      .map((mapping) => ({
        semanticGroup: mapping.semanticGroup,
        confidence: Number(calculatePolicyConfidence({
          policyType: mapping.policy?.policyType ?? 'requires_review',
          approvedByUser: mapping.policy?.approvedByUser ?? false,
          semanticConfidence: mapping.confidence,
          evidenceCount: 0,
          hasEditedAnswer: Boolean(mapping.policy?.editedAnswer),
        }).toFixed(4)),
        policyType: mapping.policy?.policyType ?? 'requires_review',
        lastSeenAt: mapping.updatedAt,
        evidenceCount: 0,
      }));
  }

  const rows = await queryAll<Record<string, unknown>>(`
    SELECT
      s.inferred_semantic_group AS "semanticGroup",
      s.confidence,
      p.policy_type AS "policyType",
      p.approved_by_user AS "approvedByUser",
      p.edited_answer AS "editedAnswer",
      MAX(s.updated_at) AS "lastSeenAt",
      COALESCE(event_counts.event_count, 0)::int AS "eventCount"
    FROM application_field_semantics s
    LEFT JOIN application_answer_policies p
      ON p.semantic_id = s.id
    LEFT JOIN (
      SELECT
        e.field_stable_id,
        COUNT(*)::int AS event_count
      FROM application_learning_events e
      JOIN application_learning_sessions ls
        ON ls.id = e.learning_session_id
      WHERE ls.session_id = $1
      GROUP BY e.field_stable_id
    ) event_counts
      ON event_counts.field_stable_id = s.stable_field_id
    WHERE s.source_session_id = $1
    GROUP BY
      s.inferred_semantic_group,
      s.confidence,
      p.policy_type,
      p.approved_by_user,
      p.edited_answer,
      event_counts.event_count
    ORDER BY s.confidence DESC, MAX(s.updated_at) DESC
    LIMIT 25
  `, [sessionId]);

  return rows.map((row) => {
    const confidence = calculatePolicyConfidence({
      policyType: typeof row.policyType === 'string' ? row.policyType : 'requires_review',
      approvedByUser: Boolean(row.approvedByUser),
      semanticConfidence: Number(row.confidence ?? 0),
      evidenceCount: Number(row.eventCount ?? 0),
      hasEditedAnswer: Boolean(row.editedAnswer),
    });

    return {
      semanticGroup: row.semanticGroup ?? 'unknown',
      confidence: Number(confidence.toFixed(4)),
      policyType: typeof row.policyType === 'string' ? row.policyType : 'requires_review',
      lastSeenAt: row.lastSeenAt,
      evidenceCount: Number(row.eventCount ?? 0),
    };
  });
}

export async function evaluateAssistDecision(sessionId: number, input: {
  stableFieldId?: string | null;
  question?: string | null;
  fieldType?: string | null;
  sectionHeading?: string | null;
}) {
  if (!config.applicationSessionPersistDb) {
    pruneExpiredMemoryLearning();
    if (!getMemoryApplicationSession(sessionId)) {
      return {
        allowed: false,
        reason: 'No confirmed learning signal exists for this field yet.',
        confidence: 0,
        policyType: 'requires_review',
        semanticGroup: null,
        requiresReview: true,
      };
    }
    const sessionSemantics = memorySemanticsBySession.get(sessionId) ?? [];
    const normalizedQuestion = normalizeQuestion(input.question);
    const exactMatch = sessionSemantics.find((mapping) =>
      (input.stableFieldId && mapping.stableFieldId === input.stableFieldId)
      || (normalizedQuestion && mapping.normalizedQuestion === normalizedQuestion)
    );
    let match = exactMatch;
    if (!match && normalizedQuestion) {
      let bestScore = 0;
      for (const candidate of sessionSemantics) {
        const score = scoreSemanticMatch(
          {
            question: input.question,
            fieldType: input.fieldType,
            sectionHeading: input.sectionHeading,
          },
          {
            question: candidate.normalizedQuestion,
            fieldType: candidate.fieldType,
            sectionHeading: candidate.sectionHeading,
          }
        );
        if (score > bestScore) {
          bestScore = score;
          match = candidate;
        }
      }
      if (bestScore < 0.72) match = undefined;
    }

    if (!match) {
      return {
        allowed: false,
        reason: 'No confirmed learning signal exists for this field yet.',
        confidence: 0,
        policyType: 'requires_review',
        semanticGroup: null,
        requiresReview: true,
      };
    }

    const policyType = match.policy?.policyType ?? 'requires_review';
    const confidence = calculatePolicyConfidence({
      policyType,
      approvedByUser: match.policy?.approvedByUser ?? false,
      semanticConfidence: match.confidence,
      evidenceCount: 0,
      hasEditedAnswer: Boolean(match.policy?.editedAnswer),
    });
    const isReusableOrGenerated = policyType === 'reusable_profile' || policyType === 'generated_ai';
    const isExplicitlyBlocked = policyType === 'manual_only' || policyType === 'ignore';
    const allowed = Boolean(match.policy?.approvedByUser)
      && isReusableOrGenerated
      && confidence >= 0.75;

    return {
      allowed,
      reason: allowed
        ? 'Field matches a confirmed reusable learning pattern and exceeds the safety threshold.'
        : isExplicitlyBlocked
          ? 'This field is explicitly configured as manual-only or ignored and is blocked from assist reuse.'
          : policyType === 'requires_review'
            ? 'This field needs human review before assist-mode reuse is allowed.'
            : 'The field does not meet the confidence threshold required for safe assist reuse.',
      confidence: Number(confidence.toFixed(4)),
      policyType,
      semanticGroup: match.semanticGroup,
      requiresReview: !allowed,
    };
  }

  const normalizedQuestion = normalizeQuestion(input.question);
  const stableFieldId = input.stableFieldId ?? null;
  const params: unknown[] = [sessionId];
  let filterSql = 'WHERE s.source_session_id = $1';

  if (stableFieldId && normalizedQuestion) {
    filterSql += ' AND (s.stable_field_id = $2 OR s.normalized_question = $3)';
    params.push(stableFieldId, normalizedQuestion);
  } else if (stableFieldId) {
    filterSql += ' AND s.stable_field_id = $2';
    params.push(stableFieldId);
  } else if (normalizedQuestion) {
    filterSql += ' AND s.normalized_question = $2';
    params.push(normalizedQuestion);
  }

  const rows = await queryAll<Record<string, unknown>>(`
    SELECT
      s.id,
      s.stable_field_id AS "stableFieldId",
      s.normalized_question AS "normalizedQuestion",
      s.inferred_semantic_group AS "semanticGroup",
      s.confidence AS "semanticConfidence",
      s.field_type AS "fieldType",
      s.section_heading AS "sectionHeading",
      p.policy_type AS "policyType",
      p.approved_by_user AS "approvedByUser",
      p.edited_answer AS "editedAnswer",
      COALESCE(event_counts.event_count, 0)::int AS "eventCount"
    FROM application_field_semantics s
    LEFT JOIN application_answer_policies p
      ON p.semantic_id = s.id
    LEFT JOIN (
      SELECT
        e.field_stable_id,
        COUNT(*)::int AS event_count
      FROM application_learning_events e
      JOIN application_learning_sessions ls
        ON ls.id = e.learning_session_id
      WHERE ls.session_id = $1
      GROUP BY e.field_stable_id
    ) event_counts
      ON event_counts.field_stable_id = s.stable_field_id
    ${filterSql}
    ORDER BY s.updated_at DESC, s.confidence DESC
    LIMIT 25
  `, params);

  let match = rows[0] as Record<string, unknown> | undefined;

  if (!match && normalizedQuestion) {
    const candidates = await queryAll<Record<string, unknown>>(`
      SELECT
        s.id,
        s.stable_field_id AS "stableFieldId",
        s.normalized_question AS "normalizedQuestion",
        s.inferred_semantic_group AS "semanticGroup",
        s.confidence AS "semanticConfidence",
        s.field_type AS "fieldType",
        s.section_heading AS "sectionHeading",
        p.policy_type AS "policyType",
        p.approved_by_user AS "approvedByUser",
        p.edited_answer AS "editedAnswer",
        COALESCE(event_counts.event_count, 0)::int AS "eventCount"
      FROM application_field_semantics s
      LEFT JOIN application_answer_policies p
        ON p.semantic_id = s.id
      LEFT JOIN (
        SELECT
          e.field_stable_id,
          COUNT(*)::int AS event_count
        FROM application_learning_events e
        JOIN application_learning_sessions ls
          ON ls.id = e.learning_session_id
        WHERE ls.session_id = $1
        GROUP BY e.field_stable_id
      ) event_counts
        ON event_counts.field_stable_id = s.stable_field_id
      WHERE s.source_session_id = $1
      ORDER BY s.updated_at DESC, s.confidence DESC
      LIMIT 100
    `, [sessionId]);

    let bestCandidate: Record<string, unknown> | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = scoreSemanticMatch(
        {
          question: input.question,
          fieldType: input.fieldType,
          sectionHeading: input.sectionHeading,
        },
        {
          question: typeof candidate.normalizedQuestion === 'string' ? candidate.normalizedQuestion : null,
          fieldType: typeof candidate.fieldType === 'string' ? candidate.fieldType : null,
          sectionHeading: typeof candidate.sectionHeading === 'string' ? candidate.sectionHeading : null,
        }
      );
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate && bestScore >= 0.72) {
      match = bestCandidate;
    }
  }

  if (!match) {
    return {
      allowed: false,
      reason: 'No confirmed learning signal exists for this field yet.',
      confidence: 0,
      policyType: 'requires_review',
      semanticGroup: null,
      requiresReview: true,
    };
  }

  const policyType = typeof match.policyType === 'string' ? match.policyType : 'requires_review';
  const confidence = calculatePolicyConfidence({
    policyType,
    approvedByUser: Boolean(match.approvedByUser),
    semanticConfidence: Number(match.semanticConfidence ?? 0),
    evidenceCount: Number(match.eventCount ?? 0),
    hasEditedAnswer: Boolean(match.editedAnswer),
  });

  const isReusableOrGenerated = policyType === 'reusable_profile' || policyType === 'generated_ai';
  const isExplicitlyBlocked = policyType === 'manual_only' || policyType === 'ignore';
  const allowed = Boolean(match.approvedByUser)
    && isReusableOrGenerated
    && confidence >= 0.75;

  return {
    allowed,
    reason: allowed
      ? 'Field matches a confirmed reusable learning pattern and exceeds the safety threshold.'
      : isExplicitlyBlocked
        ? 'This field is explicitly configured as manual-only or ignored and is blocked from assist reuse.'
        : policyType === 'requires_review'
          ? 'This field needs human review before assist-mode reuse is allowed.'
          : 'The field does not meet the confidence threshold required for safe assist reuse.',
    confidence: Number(confidence.toFixed(4)),
    policyType,
    semanticGroup: typeof match.semanticGroup === 'string' ? match.semanticGroup : null,
    requiresReview: !allowed,
  };
}
