const assert = require('node:assert/strict');
const test = require('node:test');
const scannerChatGpt = require('./scanner-chatgpt');

test('prompt includes scoped task context and strict output instructions', () => {
  const prompt = scannerChatGpt.buildPrompt({
    jobContext: { jobTitle: 'Software Engineer' },
    candidate: { fullName: 'Taylor Candidate' },
    page: { fields: [{ stableFieldId: 'field:email', label: 'Email' }] },
  });

  assert.match(prompt, /Software Engineer/);
  assert.match(prompt, /Taylor Candidate/);
  assert.match(prompt, /field:email/);
  assert.match(prompt, /Return exactly one valid JSON object/);
  assert.match(prompt, /Never invent or infer personal facts/);
});

test('extracts raw and fenced JSON packages, including braces inside strings', () => {
  const raw = scannerChatGpt.extractPackage(
    '{"answers":[{"stableFieldId":"field-1","answer":"Use { braces } safely"}]}'
  );
  const fenced = scannerChatGpt.extractPackage(
    '```json\n{"answers":[],"unresolvedFields":[{"stableFieldId":"field-2","question":"Q","reason":"Unknown"}]}\n```'
  );

  assert.equal(raw.answers[0].answer, 'Use { braces } safely');
  assert.equal(fenced.unresolvedFields[0].stableFieldId, 'field-2');
});

test('rejects responses without a valid answers array', () => {
  assert.throws(() => scannerChatGpt.extractPackage('not JSON'), /valid JSON answer package/);
  assert.throws(() => scannerChatGpt.extractPackage('{"unresolvedFields":[]}'), /answers array/);
});
