'use strict';

// test/test_tracking_writer.js
// Tests for tracking-writer.js (pipeline step 7):
//   - buildSummary()          : the note attached to a tracking item
//   - addMatchesToTracking()  : dry-run vs --post, error handling
//
// Runs fully offline: monday.js's network calls (addToTrackingBoard, addComment)
// are stubbed BEFORE the module is required, so its destructured references pick
// up the stubs instead of hitting the Monday API.
//
// Run: node test/test_tracking_writer.js

const assert = require('node:assert/strict');

// --- Stub monday.js network calls before the writer captures them ------------
const monday = require('../monday');

let trackingCalls = [];   // [itemName, columnValues]
let commentCalls = [];    // [itemId, body, mentions]
let nextItemId = 'item_1';
let trackingImpl = async () => nextItemId;

monday.addToTrackingBoard = (...args) => {
  trackingCalls.push(args);
  return trackingImpl(...args);
};
monday.addComment = (...args) => {
  commentCalls.push(args);
  return { create_update: { id: 'upd_1' } };
};

const { addMatchesToTracking, buildSummary } = require('../tracking-writer');

// --- Tiny async test harness -------------------------------------------------
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err.message}`);
    failed++;
  }
}

async function quiet(fn) {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

function candidate(overrides = {}) {
  return {
    boardId: '10036665903',
    boardName: 'TSC',
    itemId: '1234567890',
    name: 'Jane Doe',
    role: 'Senior Software Engineer',
    band: '7A',
    level: 'L2',
    location: 'London',
    cvLink: 'https://ibm.ent.box.com/file/999',
    matchedSkills: ['AWS', 'docker'],
    skillScore: 0.5,
    comments: [],
    ...overrides,
  };
}

(async () => {
  console.log('Testing tracking-writer.js\n');

  // -------------------------------------------------------------------------
  console.log('buildSummary()');
  // -------------------------------------------------------------------------

  await test('includes source board, role/band/level/location, skills% and CV', () => {
    const s = buildSummary(candidate());
    assert.ok(s.includes('TSC'), 'source board');
    assert.ok(s.includes('Senior Software Engineer') && s.includes('7A') && s.includes('L2') && s.includes('London'));
    assert.ok(s.includes('AWS') && s.includes('docker'));
    assert.ok(s.includes('50%'), 'skill score percent');
    assert.ok(s.includes('ibm.ent.box.com'), 'CV link');
  });

  await test('omits skills and CV lines gracefully when absent', () => {
    const s = buildSummary(candidate({ matchedSkills: [], skillScore: undefined, cvLink: '' }));
    assert.ok(!s.includes('Matched skills'));
    assert.ok(!s.includes('CV:'));
    assert.ok(s.includes('TSC'));
  });

  // -------------------------------------------------------------------------
  console.log('\naddMatchesToTracking()');
  // -------------------------------------------------------------------------

  await test('dry-run creates nothing and returns one result per candidate', async () => {
    trackingCalls = [];
    commentCalls = [];
    const results = await quiet(() => addMatchesToTracking([candidate(), candidate({ name: 'Ravi' })], { post: false }));
    assert.equal(trackingCalls.length, 0, 'dry-run must not create items');
    assert.equal(commentCalls.length, 0, 'dry-run must not post updates');
    assert.equal(results.length, 2);
    assert.equal(results[0].created, false);
    assert.equal(results[0].itemName, 'Jane Doe');
  });

  await test('post:true creates the item by name and attaches a summary update', async () => {
    trackingCalls = [];
    commentCalls = [];
    nextItemId = 'item_42';
    trackingImpl = async () => nextItemId;
    const results = await quiet(() => addMatchesToTracking([candidate()], { post: true }));

    assert.equal(trackingCalls.length, 1);
    assert.equal(trackingCalls[0][0], 'Jane Doe', 'creates item named after candidate');

    assert.equal(commentCalls.length, 1);
    assert.equal(commentCalls[0][0], 'item_42', 'summary update goes on the new item');
    assert.ok(commentCalls[0][1].includes('TSC'), 'summary update carries match context');

    assert.equal(results[0].created, true);
    assert.equal(results[0].itemId, 'item_42');
  });

  await test('records an error per candidate when creation throws, without aborting', async () => {
    trackingCalls = [];
    commentCalls = [];
    trackingImpl = async () => { throw new Error('Monday API HTTP 500'); };
    const results = await quiet(() =>
      addMatchesToTracking([candidate({ name: 'A' }), candidate({ name: 'B' })], { post: true })
    );
    assert.equal(results.length, 2, 'both candidates still processed');
    for (const r of results) {
      assert.equal(r.created, false);
      assert.match(r.error, /500/);
    }
    assert.equal(commentCalls.length, 0, 'no summary update when item creation fails');
    trackingImpl = async () => nextItemId; // reset
  });

  await test('returns [] for an empty shortlist and never writes', async () => {
    trackingCalls = [];
    commentCalls = [];
    const results = await quiet(() => addMatchesToTracking([], { post: true }));
    assert.deepEqual(results, []);
    assert.equal(trackingCalls.length, 0);
  });

  // -------------------------------------------------------------------------
  console.log(`\n${failed ? '✗' : '✓'} ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
