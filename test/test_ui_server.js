'use strict';

// test/test_ui_server.js
// Tests for the dashboard server's pure helpers (src/ui/server.js):
//   - validateConfigPayload() : rejects bad /api/config payloads before any write
//   - publicCandidate()       : trims a candidate to the UI-safe shape
//
// Requiring the server module does NOT start a listening port (its server.listen
// is guarded by require.main), so this runs fully offline.
//
// Run: node test/test_ui_server.js

const assert = require('node:assert/strict');
const { validateConfigPayload, publicCandidate } = require('../src/ui/server');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n      ${err.message}`); failed++; }
}

const validPayload = () => ({
  businessUnit: 'MTech',
  sourceBoardIds: ['12345', '67890'],
  trackingBoardId: '111',
  skillThreshold: 0.7,
  tagUsersByBoard: { '12345': ['53435570'] },
  defaultTagUsers: [],
});

console.log('Testing src/ui/server.js helpers\n');

console.log('validateConfigPayload()');

test('accepts a valid payload (no errors)', () => {
  assert.deepEqual(validateConfigPayload(validPayload()), []);
});

test('rejects a missing payload', () => {
  assert.ok(validateConfigPayload(undefined).length >= 1);
});

test('requires a business unit', () => {
  const p = validPayload(); p.businessUnit = '   ';
  assert.ok(validateConfigPayload(p).some((e) => /businessUnit/.test(e)));
});

test('requires at least one source board', () => {
  const p = validPayload(); p.sourceBoardIds = [];
  assert.ok(validateConfigPayload(p).some((e) => /source board/.test(e)));
});

test('rejects non-digit source board IDs', () => {
  const p = validPayload(); p.sourceBoardIds = ['12345', 'not-digits'];
  assert.ok(validateConfigPayload(p).some((e) => /digits/.test(e)));
});

test('rejects a non-digit tracking board ID', () => {
  const p = validPayload(); p.trackingBoardId = 'abc';
  assert.ok(validateConfigPayload(p).some((e) => /tracking board/.test(e)));
});

test('rejects a threshold outside 0–1', () => {
  const p = validPayload(); p.skillThreshold = 1.5;
  assert.ok(validateConfigPayload(p).some((e) => /skillThreshold/.test(e)));
});

test('rejects a non-numeric threshold', () => {
  const p = validPayload(); p.skillThreshold = 'high';
  assert.ok(validateConfigPayload(p).some((e) => /skillThreshold/.test(e)));
});

console.log('\npublicCandidate()');

const fullCandidate = () => ({
  boardId: '12345', boardName: 'TSC', itemId: '999', name: 'Jane Doe',
  role: 'Software Engineer', band: '7A', level: 'L2', location: 'London',
  cvLink: 'https://ibm.ent.box.com/file/1', cvText: 'x'.repeat(10000),
  comments: [{ id: '1' }, { id: '2' }],
  matchedSkills: ['AWS'], missingSkills: ['React'], skillScore: 0.5,
});

test('drops cvText and collapses comments to a count', () => {
  const p = publicCandidate(fullCandidate());
  assert.equal(p.cvText, undefined, 'cvText must not be exposed');
  assert.equal(p.commentsCount, 2);
  assert.equal(Array.isArray(p.comments), false);
});

test('passes through the table/CSV fields', () => {
  const p = publicCandidate(fullCandidate());
  assert.equal(p.name, 'Jane Doe');
  assert.equal(p.boardName, 'TSC');
  assert.equal(p.itemId, '999');
  assert.equal(p.cvLink, 'https://ibm.ent.box.com/file/1');
  assert.deepEqual(p.matchedSkills, ['AWS']);
  assert.equal(p.skillScore, 0.5);
});

test('defaults cvLink to "" and skill fields to null when absent', () => {
  const bare = { boardId: '1', boardName: 'B', itemId: '2', name: 'No CV', role: '', band: '', level: '', location: '' };
  const p = publicCandidate(bare);
  assert.equal(p.cvLink, '');
  assert.equal(p.commentsCount, 0);
  assert.equal(p.skillScore, null);
  assert.equal(p.matchedSkills, null);
});

console.log(`\n${failed ? '✗' : '✓'} ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
