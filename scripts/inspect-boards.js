'use strict';

// inspect-boards.js
// Diagnostic tool — shows every column name on each source board,
// plus a sample item with its values, so you can verify the column
// name matching in candidate-matcher.js is finding the right fields.
//
// Usage: node inspect-boards.js

const { mondayQuery } = require('../src/integrations/monday');
const { sourceBoardIds } = require('../boards.config');

(async () => {
  for (const boardId of sourceBoardIds) {
    const data = await mondayQuery(
      `query ($boardId: ID!) {
        boards(ids: [$boardId]) {
          id
          name
          columns { id title type }
          items_page(limit: 1) {
            items {
              id
              name
              column_values { id text }
            }
          }
        }
      }`,
      { boardId: String(boardId) }
    );

    const board = data.boards?.[0];
    if (!board) {
      console.log(`Board ${boardId}: NOT FOUND or no access\n`);
      continue;
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Board: ${board.name}  (id: ${board.id})`);
    console.log(`${'─'.repeat(60)}`);
    console.log('Columns:');
    for (const col of board.columns || []) {
      console.log(`  [${col.id.padEnd(20)}]  ${col.title}  (${col.type})`);
    }

    const sample = board.items_page?.items?.[0];
    if (sample) {
      console.log(`\nSample item: "${sample.name}"`);
      for (const cv of sample.column_values || []) {
        if (cv.text) console.log(`  ${cv.id.padEnd(20)}  →  ${cv.text}`);
      }
    } else {
      console.log('\n(no items on this board)');
    }
  }

  console.log('\n');
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
