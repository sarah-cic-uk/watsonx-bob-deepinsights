'use strict';

// seed-dummy-board.js
// Creates a representative DUMMY source board + tracking board in Monday so you
// can test the pipeline (and especially interview-commenter.js) end-to-end.
//
// It builds columns whose titles match the keyword rules in candidate-matcher.js
// (role / band / level / location / cv), seeds seven candidates tuned to the
// existing "job ad.txt" (Senior Software Engineer / Band 7 / L2 / London), and
// posts the scenario comments (already-claimed, travel restriction).
//
// Requires a Monday token WITH WRITE ACCESS (same .monday-token / MONDAY_API_TOKEN
// used everywhere else).
//
// Usage:
//   node seed-dummy-board.js                     # boards in the default workspace
//   node seed-dummy-board.js --workspace=16618647 # into a specific workspace
//   node seed-dummy-board.js --public            # public (else private)
//
// Enterprise accounts often forbid creating boards in the main workspace; pass
// --workspace=<id> for one you own (e.g. a "dummy" workspace).
//
// It never edits boards.config.js — it prints a paste-ready snippet at the end.

const { mondayQuery, addComment } = require('./monday');

const boardKind = process.argv.includes('--public') ? 'public' : 'private';
const wsArg = process.argv.find((a) => a.startsWith('--workspace='));
const workspaceId = wsArg ? wsArg.split('=')[1] : null;

// Columns to create. `key` is our internal handle; `title` is what Monday shows
// (and what candidate-matcher.js keyword-matches on). All plain text so the
// matcher reads the value back verbatim.
const COLUMNS = [
  { key: 'role',     title: 'Role' },
  { key: 'band',     title: 'Band' },
  { key: 'level',    title: 'Level' },
  { key: 'location', title: 'Location' },
  { key: 'cv',       title: 'CV Link' },
];

// Seven candidates: 3 that match the job ad, plus one per filter to prove
// filtering works. `comments` become Monday updates on the card.
// CV is intentionally left blank — for a full-pipeline (Box) test, paste a real
// Box CV URL into the matching cards afterwards. The commenter test doesn't need it.
const CANDIDATES = [
  {
    name: 'Jane Doe', match: true,
    role: 'Senior Software Engineer', band: '7A', level: 'L2', location: 'London', cv: '',
    comments: ['Rolling off her current project end of the month — available soon.'],
  },
  {
    name: 'Ravi Patel', match: true,
    role: 'Software Engineer', band: '7', level: 'L3', location: 'London, Hursley', cv: '',
    comments: [],
  },
  {
    name: 'Sam Taken', match: true,
    role: 'Software Engineer', band: '7', level: 'L2', location: 'London', cv: '',
    comments: ['Selected by another recruiter for Project Atlas — do not contact.'],
  },
  {
    name: 'Tom Bench', match: false,
    role: 'Software Engineer', band: '6', level: 'L2', location: 'London', cv: '',
    comments: [], reason: 'band 6 ≠ 7',
  },
  {
    name: 'Alex Green', match: false,
    role: 'Software Engineer', band: '7', level: 'L1', location: 'London', cv: '',
    comments: [], reason: 'level L1 too junior (job wants L2+)',
  },
  {
    name: 'Sara Hill', match: false,
    role: 'Software Engineer', band: '7', level: 'L2', location: 'Cheltenham', cv: '',
    comments: ['Will not travel out of Cheltenham.'], reason: 'wrong location',
  },
  {
    name: 'Priya Shah', match: false,
    role: 'Sales Manager', band: '7', level: 'L2', location: 'London', cv: '',
    comments: [], reason: 'role has no software/engineer keyword',
  },
];

async function createBoard(name) {
  const data = await mondayQuery(
    `mutation ($name: String!, $kind: BoardKind!, $ws: ID) {
      create_board(board_name: $name, board_kind: $kind, workspace_id: $ws) { id name }
    }`,
    { name, kind: boardKind, ws: workspaceId }
  );
  const board = data.create_board;
  console.log(`  ✓ board "${board.name}" (id ${board.id})`);
  return board.id;
}

async function createColumn(boardId, title) {
  const data = await mondayQuery(
    `mutation ($boardId: ID!, $title: String!, $type: ColumnType!) {
      create_column(board_id: $boardId, title: $title, column_type: $type) { id title }
    }`,
    { boardId: String(boardId), title, type: 'text' }
  );
  return data.create_column.id;
}

async function createItem(boardId, name, columnValues) {
  const data = await mondayQuery(
    `mutation ($boardId: ID!, $name: String!, $cols: JSON) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cols) { id }
    }`,
    {
      boardId: String(boardId),
      name,
      cols: Object.keys(columnValues).length ? JSON.stringify(columnValues) : null,
    }
  );
  return data.create_item.id;
}

async function main() {
  console.log(`Seeding dummy boards (${boardKind})...\n`);

  console.log('Source board:');
  const sourceBoardId = await createBoard('DeepInsights — Source (dummy)');

  // Create columns, capturing Monday's generated column IDs so we can set values.
  const colId = {};
  for (const col of COLUMNS) {
    colId[col.key] = await createColumn(sourceBoardId, col.title);
    console.log(`    · column "${col.title}" → ${colId[col.key]}`);
  }

  console.log('\n  Candidates:');
  for (const c of CANDIDATES) {
    const values = {
      [colId.role]:     c.role,
      [colId.band]:     c.band,
      [colId.level]:    c.level,
      [colId.location]: c.location,
      [colId.cv]:       c.cv,
    };
    const itemId = await createItem(sourceBoardId, c.name, values);

    for (const body of c.comments) {
      await addComment(itemId, body); // plain update, no mentions
    }

    const tag = c.match ? 'MATCH' : `skip (${c.reason})`;
    const note = c.comments.length ? ` +${c.comments.length} comment(s)` : '';
    console.log(`    ✓ ${c.name.padEnd(12)} item ${itemId}  [${tag}]${note}`);
  }

  console.log('\nTracking board:');
  const trackingBoardId = await createBoard('DeepInsights — My Shortlist (dummy)');

  console.log('\n────────────────────────────────────────────────────────');
  console.log('Done. Paste these IDs into boards.config.js:\n');
  console.log(`  sourceBoardIds: ['${sourceBoardId}'],`);
  console.log(`  trackingBoardId: '${trackingBoardId}',\n`);
  console.log('Then test the commenter (dry-run) with a matching card, e.g.:');
  console.log(`  node interview-commenter.js 'job ad.txt'\n`);
  console.log('Reminders:');
  console.log('  • Set tagUsers in boards.config.js to real account users (yourself is fine).');
  console.log('  • For a full Box CV test, paste real Box CV URLs into the matching cards\'');
  console.log('    "CV Link" column (Jane / Ravi / Sam) — otherwise they\'re skipped at the skills step.');
}

main().catch((err) => {
  console.error('\n✗ Seeding failed:', err.message);
  process.exit(1);
});
