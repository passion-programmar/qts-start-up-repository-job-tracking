import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let temporaryDatabasePath = '';
let sessionId = 0;
let database: typeof import('../database/connection');
let learningStore: typeof import('./application-learning-store');

before(async () => {
  temporaryDatabasePath = await mkdtemp(path.join(tmpdir(), 'qts-learning-store-test-'));
  process.env.EMBEDDED_PG = 'true';
  process.env.PGLITE_DATA_PATH = temporaryDatabasePath;
  process.env.APPLICATION_SESSION_PERSIST_DB = 'true';
  process.env.JWT_SECRET = 'learning-store-test-secret';
  process.env.NODE_ENV = 'test';

  database = await import('../database/connection');
  learningStore = await import('./application-learning-store');

  const uniqueSeed = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await database.initDb();

  const user = await database.queryOne<{ u_id: number }>(
    `INSERT INTO users (username, name, role, password_hash)
     VALUES ($1, $2, 'super', 'test-hash')
     RETURNING u_id`,
    [`learning-store-user-${uniqueSeed}`, `Learning Store User ${uniqueSeed}`]
  );
  assert.ok(user);

  const account = await database.queryOne<{ id: number }>(
    `INSERT INTO accounts (name, notes, is_active, manager_id, custom_gpt_url)
     VALUES ($1, $2, TRUE, NULL, NULL)
     RETURNING id`,
    [`Learning Account ${uniqueSeed}`, 'test account']
  );
  assert.ok(account);

  const candidate = await database.queryOne<{ id: number }>(
    `INSERT INTO candidates (name, email, phone, linkedin_url, notes, color, stack, is_active, account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8)
     RETURNING id`,
    [
      `Test Candidate ${uniqueSeed}`,
      'candidate@example.com',
      '123-456-7890',
      'https://linkedin.com/in/test',
      'test notes',
      'green',
      'full-stack',
      account.id,
    ]
  );
  assert.ok(candidate);

  const row = await database.queryOne<{ id: number }>(
    `INSERT INTO application_sessions (
      candidate_id, job_id, user_id, account_id,
      job_url, normalized_url, job_title, company,
      job_description, platform, current_step,
      discovered_pages, metadata, status
    ) VALUES (
      $1, NULL, $2, $3,
      'https://apply.example.com/jobs/test', 'https://apply.example.com/jobs/test',
      'Software Engineer', 'Example Co',
      'Role description', 'workable', 'scan',
      '[]'::jsonb, '{}'::jsonb, 'scanning'
    ) RETURNING id`,
    [candidate.id, user.u_id, account.id]
  );
  assert.ok(row);
  sessionId = row.id;
});

after(async () => {
  await database.closeDb();
  if (temporaryDatabasePath) {
    await rm(temporaryDatabasePath, { recursive: true, force: true });
  }
});

it('normalizes semantic aliases and scores field matches conservatively', () => {
  assert.equal(learningStore.normalizeQuestion('Given Name'), 'first name');
  assert.equal(learningStore.normalizeQuestion('Mobile Number'), 'phone number');
  assert.ok(learningStore.scoreSemanticMatch(
    { question: 'Given Name', fieldType: 'text', sectionHeading: 'Personal Details' },
    { question: 'First Name', fieldType: 'text', sectionHeading: 'Personal Details' }
  ) >= 0.72);
  assert.ok(learningStore.scoreSemanticMatch(
    { question: 'LinkedIn URL', fieldType: 'url', sectionHeading: 'Profile' },
    { question: 'LinkedIn', fieldType: 'url', sectionHeading: 'Profile' }
  ) >= 0.72);
});

it('allows only approved high-confidence matches and blocks review-only matches', async () => {
  const approvedSemantic = await learningStore.upsertSemanticMapping({
    stableFieldId: 'first-name-demo',
    question: 'Given Name',
    fieldType: 'text',
    sectionHeading: 'Personal Details',
    confidence: 0.92,
    sourceSessionId: sessionId,
    inferredSemanticGroup: 'candidate_profile',
  });
  assert.ok(approvedSemantic);

  await learningStore.upsertAnswerPolicy({
    semanticId: approvedSemantic.id,
    policyType: 'reusable_profile',
    confidence: 0.92,
    approvedByUser: true,
    observedAnswer: 'Alice',
    editedAnswer: 'Alice',
  });

  const approved = await learningStore.evaluateAssistDecision(sessionId, {
    stableFieldId: 'first-name-demo',
    question: 'First Name',
    fieldType: 'text',
    sectionHeading: 'Personal Details',
  });

  assert.equal(approved.allowed, true);
  assert.equal(approved.requiresReview, false);
  assert.ok(approved.confidence >= 0.75);

  const blockedSemantic = await learningStore.upsertSemanticMapping({
    stableFieldId: 'visa-status-demo',
    question: 'Visa Status',
    fieldType: 'select',
    sectionHeading: 'Authorization',
    confidence: 0.45,
    sourceSessionId: sessionId,
    inferredSemanticGroup: 'requires_review',
  });
  assert.ok(blockedSemantic);

  await learningStore.upsertAnswerPolicy({
    semanticId: blockedSemantic.id,
    policyType: 'requires_review',
    confidence: 0.45,
    approvedByUser: false,
    observedAnswer: 'Not available',
    editedAnswer: null,
  });

  const blocked = await learningStore.evaluateAssistDecision(sessionId, {
    stableFieldId: 'visa-status-demo',
    question: 'Work authorization',
    fieldType: 'select',
    sectionHeading: 'Authorization',
  });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.requiresReview, true);
  assert.equal(blocked.policyType, 'requires_review');
});

it('removes fields from the pending review queue once a policy is saved', async () => {
  await database.execute(`
    INSERT INTO application_session_fields (
      session_id, stable_field_id, label, field_type, field_fingerprint,
      category, fill_value, fill_status, section_heading, page_step
    ) VALUES
      ($1, 'pending-learning-field', 'Preferred name', 'text', 'pending-fingerprint',
       'candidate_profile', 'Alex', 'filled', 'Personal Details', 'step-1'),
      ($1, 'reviewed-learning-field', 'Work authorization', 'select', 'reviewed-fingerprint',
       'needs_review', 'Yes', 'needs_review', 'Authorization', 'step-2')
  `, [sessionId]);

  const reviewedSemantic = await learningStore.upsertSemanticMapping({
    stableFieldId: 'reviewed-learning-field',
    question: 'Work authorization',
    fieldType: 'select',
    sectionHeading: 'Authorization',
    confidence: 0.9,
    sourceSessionId: sessionId,
    inferredSemanticGroup: 'requires_review',
  });
  assert.ok(reviewedSemantic);

  await learningStore.upsertAnswerPolicy({
    semanticId: reviewedSemantic.id,
    policyType: 'requires_review',
    confidence: 0.9,
    approvedByUser: false,
    observedAnswer: 'Yes',
  });

  const queue = await learningStore.listLearningQueue(sessionId);
  assert.deepEqual(queue.map((field) => field.stableFieldId), ['pending-learning-field']);
  assert.equal(queue[0].currentAnswer, 'Alex');
  assert.equal(queue[0].sectionHeading, 'Personal Details');
});
