// monday.js — minimal reusable client for the Monday.com GraphQL API.
//
// ibm.monday.com is a Monday.com cloud tenant. All data is read through the
// GraphQL API at https://api.monday.com/v2, authenticated with a personal API
// token (Monday avatar -> Developers -> My Access Tokens, or Admin -> API).
//
// The token is read from (in priority order):
//   1. process.env.MONDAY_API_TOKEN
//   2. .monday-token   (gitignored - never committed)
//
// Usage as a module (from elsewhere in src/):
//   const { mondayQuery } = require('./integrations/monday');
//   const data = await mondayQuery(`query { me { name email } }`);
//
// Usage as a script (connectivity check + lists your boards):
//   node src/integrations/monday.js

const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.monday.com/v2';
// .monday-token lives at the repo root (two levels up from src/integrations/).
const TOKEN_FILE = path.join(__dirname, '..', '..', '.monday-token');

function loadToken() {
  if (process.env.MONDAY_API_TOKEN && process.env.MONDAY_API_TOKEN.trim()) {
    return process.env.MONDAY_API_TOKEN.trim();
  }
  try {
    const fromFile = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (fromFile) return fromFile;
  } catch {
    /* file not present — fall through to the error below */
  }
  throw new Error(
    'No Monday.com API token found.\n' +
      '  Provide it one of two ways:\n' +
      `  1. Save the token (only the token, on one line) to: ${TOKEN_FILE}\n` +
      '  2. Or set the MONDAY_API_TOKEN environment variable.\n' +
      '  Get a token in Monday: avatar -> Developers -> My Access Tokens.'
  );
}

/**
 * Run a GraphQL query/mutation against the Monday.com API.
 * @param {string} query    GraphQL document.
 * @param {object} variables Optional GraphQL variables.
 * @returns {Promise<object>} The `data` object from the response.
 */
async function mondayQuery(query, variables = {}) {
  const token = loadToken();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      // 2024-10 was retired and predates mentions_list on create_update.
      'API-Version': '2026-07',
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Monday API returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }

  if (payload.errors) {
    throw new Error('Monday API GraphQL errors: ' + JSON.stringify(payload.errors, null, 2));
  }
  if (!res.ok) {
    throw new Error(`Monday API HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return payload.data;
}

/**
 * Fetch every board visible to the token, paging until the API runs dry.
 * @returns {Promise<Array>} All boards.
 */
async function listAllBoards() {
  const all = [];
  const limit = 100;
  for (let page = 1; ; page++) {
    const data = await mondayQuery(
      `query ($limit: Int!, $page: Int!) {
        boards(limit: $limit, page: $page, order_by: used_at) {
          id
          name
          state
          board_kind
          items_count
        }
      }`,
      { limit, page }
    );
    const batch = data.boards || [];
    all.push(...batch);
    if (batch.length < limit) break; // last page
  }
  return all;
}

/**
 * Fetch all items (with column values and latest comments) from a single board.
 * Also returns the board's column definitions so callers can look up columns by title.
 * Returns { columns, items } where columns is [{ id, title }].
 */
async function getBoardItems(boardId) {
  const items = [];
  let columns = null;
  let cursor = null;

  do {
    const data = await mondayQuery(
      `query ($boardId: ID!, $cursor: String) {
        boards(ids: [$boardId]) {
          columns { id title }
          items_page(limit: 100, cursor: $cursor) {
            cursor
            items {
              id
              name
              url
              column_values { id text value }
              updates(limit: 10) {
                id
                body
                creator { name email }
                created_at
              }
            }
          }
        }
      }`,
      { boardId: String(boardId), cursor }
    );

    const board = data.boards?.[0];
    if (!board) break;
    if (!columns) columns = board.columns || [];
    const page = board.items_page;
    if (!page) break;
    items.push(...(page.items || []));
    cursor = page.cursor || null;
  } while (cursor);

  return { columns: columns || [], items };
}

/**
 * Fetch items from all source boards defined in boards.config.js.
 * Returns { boardId, boardName, columns, items }[] — one entry per board.
 */
async function getCandidateBoardItems() {
  const { sourceBoardIds } = require('../../boards.config');

  const results = await Promise.all(
    sourceBoardIds.map(async (boardId) => {
      const meta = await mondayQuery(
        `query ($boardId: ID!) { boards(ids: [$boardId]) { id name } }`,
        { boardId: String(boardId) }
      );
      const boardName = meta.boards?.[0]?.name ?? boardId;
      const { columns, items } = await getBoardItems(boardId);
      return { boardId, boardName, columns, items };
    })
  );

  return results;
}

/**
 * Post a comment (update) on a Monday item.
 *
 * @param {string} itemId  The item's ID.
 * @param {string} body    The comment text. Include readable "@Name" text for
 *                         each mention so the update reads naturally; the actual
 *                         notification is driven by `mentions`, not the body.
 * @param {Array<{id: (string|number), type?: string}>} [mentions]
 *   People/teams/boards to notify. Each entry defaults to type "User".
 *   Monday triggers the real notification from this list, not from body markup.
 * @returns {Promise<object>} The created update ({ id }).
 */
async function addComment(itemId, body, mentions = []) {
  const mentionsList = (mentions || []).map(m => ({
    id: Number(m.id),
    type: m.type || 'User',
  }));

  return mondayQuery(
    `mutation ($itemId: ID!, $body: String!, $mentions: [UpdateMention]) {
      create_update(item_id: $itemId, body: $body, mentions_list: $mentions) { id }
    }`,
    { itemId: String(itemId), body, mentions: mentionsList.length ? mentionsList : null }
  );
}

/**
 * Look up users (to resolve people -> user IDs for @mentions).
 *
 * With no filter this returns only the FIRST PAGE of the account's users — fine
 * for small accounts, but in a large org (e.g. IBM) most people won't be in it.
 * Prefer filtering by `ids` or `emails`, which resolve exact users regardless of
 * account size.
 *
 * @param {object} [filter]
 * @param {Array<string|number>} [filter.ids]     Exact Monday user IDs.
 * @param {string[]}             [filter.emails]  Exact user emails.
 * @returns {Promise<Array<{id: string, name: string, email: string}>>}
 */
async function listUsers(filter = {}) {
  const { ids, emails } = filter;
  const args = [];       // e.g. "ids: $ids"
  const varDefs = [];    // e.g. "$ids: [ID!]"  — only declare what we use
  const vars = {};
  if (ids && ids.length)       { args.push('ids: $ids');       varDefs.push('$ids: [ID!]');        vars.ids = ids.map(Number); }
  if (emails && emails.length) { args.push('emails: $emails'); varDefs.push('$emails: [String!]'); vars.emails = emails; }

  const argStr = args.length ? `(${args.join(', ')})` : '';
  const defStr = varDefs.length ? `(${varDefs.join(', ')})` : '';

  const data = await mondayQuery(
    `query ${defStr} { users${argStr} { id name email } }`,
    vars
  );
  return data.users || [];
}

/**
 * Create a new item on the tracking board defined in boards.config.js.
 * @param {string} itemName   Display name for the new item.
 * @param {object} columnValues  Optional map of column_id -> value (JSON-stringified per Monday spec).
 * @returns {Promise<string>} The new item's ID.
 */
async function addToTrackingBoard(itemName, columnValues = {}) {
  const { trackingBoardId } = require('../../boards.config');

  const data = await mondayQuery(
    `mutation ($boardId: ID!, $itemName: String!, $colVals: JSON) {
      create_item(board_id: $boardId, item_name: $itemName, column_values: $colVals) { id }
    }`,
    {
      boardId: String(trackingBoardId),
      itemName,
      colVals: Object.keys(columnValues).length ? JSON.stringify(columnValues) : null,
    }
  );

  return data.create_item?.id;
}

module.exports = {
  mondayQuery,
  loadToken,
  listAllBoards,
  getBoardItems,
  getCandidateBoardItems,
  addComment,
  listUsers,
  addToTrackingBoard,
  API_URL,
};

// When run directly: verify the token works and print who we are + every board.
if (require.main === module) {
  (async () => {
    try {
      const who = await mondayQuery(`query { me { id name email account { name slug } } }`);
      const me = who.me;
      console.log('✓ Connected to Monday.com');
      console.log(`  User:    ${me.name} <${me.email}> (id ${me.id})`);
      console.log(`  Account: ${me.account?.name} (${me.account?.slug}.monday.com)`);
      console.log('');

      const boards = await listAllBoards();
      console.log(`All boards visible to this token (${boards.length} total):`);
      for (const b of boards) {
        console.log(
          `  [${b.id}] ${b.name}  —  ${b.items_count ?? '?'} items  (${b.state}, ${b.board_kind})`
        );
      }
    } catch (err) {
      console.error('✗ ' + err.message);
      process.exit(1);
    }
  })();
}
