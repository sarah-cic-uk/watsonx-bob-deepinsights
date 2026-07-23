'use strict';

// test/test_interview_commenter.js
// Tests for the interview-commenting functionality (interview-commenter.js):
//   - buildComment()          : comment body + mentions payload
//   - resolveTagUsers()       : config tag entries -> Monday users
//   - postInterviewRequests() : dry-run vs --post, error handling
//
// Runs fully offline: the two network functions in monday.js (addComment,
// listUsers) are stubbed BEFORE the commenter is required, so its destructured
// references pick up the stubs instead of hitting the Monday API.
//
// Run: node test/test_interview_commenter.js

const assert = require('node:assert/strict');

// --- Stub monday.js network calls before the commenter captures them ---------
const monday = require('../src/integrations/monday');

let addCommentCalls = [];
let addCommentImpl = async () => ({ create_update: { id: 'upd_1' } });
monday.addComment = (...args) => {
  addCommentCalls.push(args);
  return addCommentImpl(...args);
};
// Two known account users, ids as numbers (as the real API returns them).
monday.listUsers = async () => [
  { id: 101, name: 'Brad', email: 'brad@example.com' },
  { id: 202, name: 'Sian', email: 'sian@example.com' },
];

const { businessUnit } = require('../boards.config');
const {
  buildComment,
  resolveTagUsers,
  postInterviewRequests,
} = require('../src/pipeline/comment');

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

// Silence the commenter's own console output while exercising it, so the test
// report stays readable. Restores the originals even if the fn throws.
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

// A contract-shaped candidate (README -> "Data contract"). IDs are strings.
function candidate(overrides = {}) {
  return {
    boardId: '10036665903',
    boardName: 'TSC',
    itemId: '1234567890',
    name: 'Jane Doe',
    role: 'Data Analyst', // candidate's OWN board role — must never leak into the comment
    band: '7A',
    level: 'L2',
    location: 'London',
    cvLink: '',
    comments: [],
    ...overrides,
  };
}

(async () => {
  console.log('Testing interview-commenter.js\n');

  // -------------------------------------------------------------------------
  console.log('buildComment()');
  // -------------------------------------------------------------------------

  await test('builds body with business unit, name, job role; mentions in payload not body', () => {
    const tagged = [
      { id: '101', name: 'Brad' },
      { id: '202', name: 'Sian' },
    ];
    const { body, mentions, mentionNames } = buildComment(candidate(), tagged, {
      businessUnit: 'watsonx',
      role: 'Senior Software Engineer',
    });
    // Body must NOT contain the @mentions — Monday appends them itself from
    // mentions_list; duplicating them in the body double-tags (verified live).
    assert.equal(
      body,
      'watsonx interested to interview Jane Doe for Senior Software Engineer'
    );
    assert.deepEqual(mentions, [
      { id: '101', type: 'User' },
      { id: '202', type: 'User' },
    ]);
    assert.deepEqual(mentionNames, ['@Brad', '@Sian']);
  });

  await test('omits the "for {role}" clause when no job role is supplied', () => {
    const { body } = buildComment(candidate(), [], { businessUnit: 'watsonx' });
    assert.equal(body, 'watsonx interested to interview Jane Doe');
    assert.ok(!body.includes(' for '));
  });

  await test('never falls back to the candidate\'s own board role', () => {
    // candidate.role is "Data Analyst"; with no opts.role it must NOT appear.
    const { body } = buildComment(candidate(), [], { businessUnit: 'watsonx' });
    assert.ok(!body.includes('Data Analyst'), `leaked candidate role: "${body}"`);
    assert.ok(!body.includes(' for '));
  });

  await test('defaults the business unit from boards.config when not overridden', () => {
    const { body } = buildComment(candidate(), [], { role: 'SRE' });
    assert.ok(
      body.startsWith(`${businessUnit} `),
      `expected body to start with configured BU "${businessUnit}", got "${body}"`
    );
  });

  await test('produces no mentions and no trailing tag when nobody is tagged', () => {
    const { body, mentions } = buildComment(candidate(), [], {
      businessUnit: 'watsonx',
      role: 'SRE',
    });
    assert.equal(body, 'watsonx interested to interview Jane Doe for SRE');
    assert.deepEqual(mentions, []);
  });

  // -------------------------------------------------------------------------
  console.log('\nresolveTagUsers()');
  // -------------------------------------------------------------------------

  await test('resolves a name to its user id (case-insensitive)', async () => {
    const users = [{ id: 101, name: 'Brad' }];
    const { resolved, problems } = await resolveTagUsers(['brad'], users);
    assert.deepEqual(resolved, [{ id: '101', name: 'Brad' }]);
    assert.equal(problems.length, 0);
  });

  await test('passes a numeric id through and attaches a known name', async () => {
    const users = [{ id: 101, name: 'Brad' }];
    const { resolved } = await resolveTagUsers(['101'], users);
    assert.deepEqual(resolved, [{ id: '101', name: 'Brad' }]);
  });

  await test('keeps an unknown numeric id, falling back to the id as its name', async () => {
    const { resolved, problems } = await resolveTagUsers(['999'], [{ id: 101, name: 'Brad' }]);
    assert.deepEqual(resolved, [{ id: '999', name: '999' }]);
    assert.equal(problems.length, 0);
  });

  await test('reports an unknown name and skips it (never tags the wrong person)', async () => {
    const { resolved, problems } = await resolveTagUsers(['Nobody'], [{ id: 101, name: 'Brad' }]);
    assert.deepEqual(resolved, []);
    assert.equal(problems.length, 1);
  });

  await test('reports an ambiguous name and skips it', async () => {
    const users = [
      { id: 101, name: 'Brad' },
      { id: 102, name: 'brad' }, // same name, different id
    ];
    const { resolved, problems } = await resolveTagUsers(['Brad'], users);
    assert.deepEqual(resolved, []);
    assert.equal(problems.length, 1);
  });

  await test('returns empty for empty entries without touching the network', async () => {
    const { resolved, problems } = await resolveTagUsers([]);
    assert.deepEqual(resolved, []);
    assert.deepEqual(problems, []);
  });

  // -------------------------------------------------------------------------
  console.log('\npostInterviewRequests()');
  // -------------------------------------------------------------------------

  await test('dry-run does not post and returns one result per candidate', async () => {
    addCommentCalls = [];
    const results = await quiet(() =>
      postInterviewRequests([candidate()], { post: false, tagUsers: [], role: 'SRE' })
    );
    assert.equal(addCommentCalls.length, 0, 'dry-run must not call addComment');
    assert.equal(results.length, 1);
    assert.equal(results[0].posted, false);
    assert.ok(results[0].body.includes('Jane Doe'));
    assert.ok(results[0].body.includes('SRE'));
  });

  await test('post:true calls addComment with the string itemId, body and mentions', async () => {
    addCommentCalls = [];
    addCommentImpl = async () => ({ create_update: { id: 'upd_1' } });
    const results = await quiet(() =>
      postInterviewRequests([candidate()], { post: true, tagUsers: ['Brad'], role: 'SRE' })
    );

    assert.equal(addCommentCalls.length, 1);
    const [itemIdArg, bodyArg, mentionsArg] = addCommentCalls[0];
    assert.equal(typeof itemIdArg, 'string', 'itemId must be passed as a string');
    assert.equal(itemIdArg, '1234567890');
    // Body carries the sentence; the tag is delivered via the mentions payload
    // (Monday renders it), so @Brad must NOT be in the body text.
    assert.ok(bodyArg.includes('Jane Doe') && bodyArg.includes('SRE'));
    assert.ok(!bodyArg.includes('@Brad'), `mention leaked into body: "${bodyArg}"`);
    assert.deepEqual(mentionsArg, [{ id: '101', type: 'User' }]);

    assert.equal(results[0].posted, true);
    assert.equal(results[0].updateId, 'upd_1');
  });

  await test('records an error per candidate when addComment throws, without aborting the run', async () => {
    addCommentCalls = [];
    addCommentImpl = async () => {
      throw new Error('Monday API HTTP 500');
    };
    const shortlist = [candidate({ itemId: '111' }), candidate({ itemId: '222' })];
    const results = await quiet(() =>
      postInterviewRequests(shortlist, { post: true, tagUsers: [], role: 'SRE' })
    );

    assert.equal(results.length, 2, 'both candidates should still be processed');
    for (const r of results) {
      assert.equal(r.posted, false);
      assert.match(r.error, /500/);
    }
    // reset for any later tests
    addCommentImpl = async () => ({ create_update: { id: 'upd_1' } });
  });

  await test('tags per board from tagUsersByBoard (different people per board)', async () => {
    addCommentCalls = [];
    addCommentImpl = async () => ({ create_update: { id: 'upd_x' } });
    const shortlist = [
      candidate({ itemId: 'A1', boardId: 'boardA' }),
      candidate({ itemId: 'B1', boardId: 'boardB' }),
    ];
    await quiet(() =>
      postInterviewRequests(shortlist, {
        post: true,
        role: 'SRE',
        tagUsersByBoard: { boardA: ['Brad'], boardB: ['Sian'] },
      })
    );
    assert.equal(addCommentCalls.length, 2);
    const mentionsByItem = Object.fromEntries(
      addCommentCalls.map(([itemId, , mentions]) => [itemId, mentions])
    );
    assert.deepEqual(mentionsByItem['A1'], [{ id: '101', type: 'User' }]); // Brad
    assert.deepEqual(mentionsByItem['B1'], [{ id: '202', type: 'User' }]); // Sian
  });

  await test('falls back to defaultTagUsers for a board not in the map', async () => {
    addCommentCalls = [];
    addCommentImpl = async () => ({ create_update: { id: 'upd_x' } });
    await quiet(() =>
      postInterviewRequests([candidate({ itemId: 'Z1', boardId: 'unlisted' })], {
        post: true,
        role: 'SRE',
        tagUsersByBoard: { boardA: ['Brad'] },
        defaultTagUsers: ['Sian'],
      })
    );
    assert.equal(addCommentCalls.length, 1);
    assert.deepEqual(addCommentCalls[0][2], [{ id: '202', type: 'User' }]); // Sian (fallback)
  });

  await test('returns [] for an empty shortlist and never posts', async () => {
    addCommentCalls = [];
    const results = await quiet(() => postInterviewRequests([], { post: true, tagUsers: [] }));
    assert.deepEqual(results, []);
    assert.equal(addCommentCalls.length, 0);
  });

  // -------------------------------------------------------------------------
  console.log(`\n${failed ? '✗' : '✓'} ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
