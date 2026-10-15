const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getPageStorageKey,
  normalizeRule,
  normalizeRules,
} = require('./text-highlighting');

test('rules are trimmed and keep their selected colors', () => {
  assert.deepEqual(normalizeRule({
    id: 'rule-1',
    text: '  JavaScript  ',
    textColor: '#112233',
    backgroundColor: '#aabbcc',
  }), {
    id: 'rule-1',
    text: 'JavaScript',
    textColor: '#112233',
    backgroundColor: '#aabbcc',
  });
});

test('rules require text and valid six-digit colors', () => {
  assert.throws(() => normalizeRule({
    id: 'rule-1',
    text: ' ',
    textColor: '#112233',
    backgroundColor: '#aabbcc',
  }), /Enter text or characters/);
  assert.throws(() => normalizeRule({
    id: 'rule-1',
    text: 'term',
    textColor: 'red',
    backgroundColor: '#aabbcc',
  }), /valid text and background colors/);
});

test('rule lists reject malformed data and duplicate IDs', () => {
  assert.throws(() => normalizeRules({}), /must be a list/);
  assert.throws(() => normalizeRules([
    { id: 'same', text: 'one', textColor: '#112233', backgroundColor: '#aabbcc' },
    { id: 'same', text: 'two', textColor: '#112233', backgroundColor: '#aabbcc' },
  ]), /duplicate ID/);
});

test('storage keys are page-specific and ignore URL fragments', () => {
  assert.equal(
    getPageStorageKey('https://example.com/jobs/1?source=mail#details'),
    getPageStorageKey('https://example.com/jobs/1?source=mail#apply')
  );
  assert.notEqual(
    getPageStorageKey('https://example.com/jobs/1'),
    getPageStorageKey('https://example.com/jobs/2')
  );
});

test('storage keys reject non-web pages', () => {
  assert.throws(() => getPageStorageKey('chrome://extensions'), /HTTP and HTTPS/);
  assert.throws(() => getPageStorageKey('not a URL'), /Open a supported web page/);
});
