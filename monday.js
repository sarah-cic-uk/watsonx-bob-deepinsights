// monday.js — minimal reusable client for the Monday.com GraphQL API.
//
// ibm.monday.com is a Monday.com cloud tenant. All data is read through the
// GraphQL API at https://api.monday.com/v2, authenticated with a personal API
// token (Monday avatar -> Developers -> My Access Tokens, or Admin -> API).
//
// The token is read from (in priority order):
//   1. process.env.MONDAY_API_TOKEN
//   2. untracked/.monday-token   (gitignored - never committed)
//
// Usage as a module:
//   const { mondayQuery } = require('./monday');
//   const data = await mondayQuery(`query { me { name email } }`);
//
// Usage as a script (connectivity check + lists your boards):
//   node monday.js

const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.monday.com/v2';
const TOKEN_FILE = path.join(__dirname, 'untracked', '.monday-token');

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
      'API-Version': '2024-10',
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

module.exports = { mondayQuery, loadToken, listAllBoards, API_URL };

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
