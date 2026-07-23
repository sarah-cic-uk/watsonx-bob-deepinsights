'use strict';

// interview-commenter.js
// Step 3 of the pipeline: for each shortlisted candidate, post an interview-request
// comment on their Monday card, tagging the configured people so they get notified.
//
// The comment follows the shape from the README, e.g.:
//   "watsonx interested to interview Jane Doe for Senior Software Engineer @Brad @Sian"
//
// SAFETY: dry-run by default. It prints the exact comment it *would* post (and who
// would be notified) without touching Monday. Pass { post: true } (or --post on the
// CLI) to actually write the comments. The dry-run output doubles as a "draft these
// for me to send manually" fallback.

const { addComment, listUsers } = require('./monday');
const { businessUnit, tagUsersByBoard, defaultTagUsers } = require('./boards.config');

/**
 * The candidate object this module consumes — the frozen pipeline data contract.
 * See README → "Data contract" (frozen 20 Jul). Produced by findCandidates(),
 * enriched by filterBySkills(). All IDs are strings.
 *
 * NOTE: `role` is the candidate's *own* raw board text (their current role), NOT
 * the role we're hiring for. The interview-request comment must use the JOB's role
 * (passed in via opts.role from the job ad), never this field.
 *
 * @typedef {object} Candidate
 * @property {string} boardId    Monday board ID
 * @property {string} boardName  Friendly board name (e.g. "TSC")
 * @property {string} itemId     Monday item ID — the card we comment on
 * @property {string} name       Candidate name
 * @property {string} role       Candidate's raw board role text (NOT the job role)
 * @property {string} band       Raw board text
 * @property {string} level      Raw board text
 * @property {string} location   Raw board text
 * @property {string} cvLink     Box CV link, "" if none
 * @property {Array<{id:string, body:string, creator:{name:string,email:string}}>} comments  Up to 10 updates
 */

// ---------------------------------------------------------------------------
// Resolve configured tag entries (names or numeric IDs) to { id, name }
// ---------------------------------------------------------------------------

/**
 * Resolve the config `tagUsers` entries into Monday user objects.
 * Numeric entries are treated as user IDs directly; string entries are matched
 * against account users by (case-insensitive) name. Unresolved or ambiguous
 * entries are reported and skipped so we never tag the wrong person.
 *
 * @param {Array<string|number>} entries
 * @param {Array<{id:string,name:string}>} [users]  Pre-fetched user list (optional).
 * @returns {Promise<{resolved: Array<{id:string,name:string}>, problems: string[]}>}
 */
async function resolveTagUsers(entries, users) {
  const resolved = [];
  const problems = [];
  if (!entries || !entries.length) return { resolved, problems };

  // Partition entries by how we can resolve them. IDs and emails resolve exactly
  // regardless of account size; plain names can only be matched against a single
  // page of users, which is unreliable in a large org.
  const ids = [], emails = [], names = [];
  for (const entry of entries) {
    const str = String(entry).trim();
    if (/^\d+$/.test(str)) ids.push(str);
    else if (str.includes('@')) emails.push(str);
    else names.push(str);
  }

  // Exact lookups (skip the API entirely if a user list was injected, e.g. tests).
  const byId    = users ? users : (ids.length    ? await listUsers({ ids })       : []);
  const byEmail = users ? users : (emails.length ? await listUsers({ emails })    : []);

  for (const id of ids) {
    const known = byId.find(u => String(u.id) === id);
    // An ID we can't attach a name to is still tagged fine (the mention works by
    // ID) — display name just falls back to the ID. Not a problem worth flagging.
    resolved.push({ id, name: known?.name || id });
  }
  for (const email of emails) {
    const hit = byEmail.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
    if (hit) resolved.push({ id: String(hit.id), name: hit.name });
    else problems.push(`no Monday user with email "${email}" — will not be tagged`);
  }

  // Name matching: only reliable on small accounts. Warn and recommend ID/email.
  if (names.length) {
    const page = users || await listUsers();
    for (const name of names) {
      const hits = page.filter(u => u.name && u.name.toLowerCase() === name.toLowerCase());
      if (hits.length === 1) {
        resolved.push({ id: String(hits[0].id), name: hits[0].name });
      } else if (hits.length === 0) {
        problems.push(`no match for name "${name}" in the first page of users — in a large account, use their numeric ID or email in boards.config.js`);
      } else {
        problems.push(`"${name}" is ambiguous (IDs ${hits.map(h => h.id).join(', ')}) — use the numeric ID or email`);
      }
    }
  }

  return { resolved, problems };
}

// ---------------------------------------------------------------------------
// Build the comment body + mentions payload for one candidate
// ---------------------------------------------------------------------------

/**
 * Build the interview-request comment for a candidate.
 *
 * @param {Candidate} candidate         A shortlist entry (needs `name` + `itemId`).
 * @param {Array<{id,name}>} taggedUsers Resolved users to notify.
 * @param {object} [opts]
 * @param {string} [opts.businessUnit]  Overrides the config business unit.
 * @param {string} [opts.role]          The JOB's role we're hiring for (from the job ad).
 *                                      If omitted, the "for {role}" clause is dropped —
 *                                      we never fall back to the candidate's board role.
 * @returns {{ body: string, mentions: Array<{id,type:'User'}>, mentionNames: string[] }}
 *
 * NOTE: the body deliberately contains NO "@Name" text. When mentions_list is set,
 * Monday appends the clickable mention (e.g. "@Brad") to the update itself — adding
 * it to the body too would double it up.
 */
function buildComment(candidate, taggedUsers = [], opts = {}) {
  const bu = opts.businessUnit || businessUnit || 'We';
  const role = (opts.role || '').trim();
  const forRole = role ? ` for ${role}` : '';
  const body = `${bu} interested to interview ${candidate.name}${forRole}`.trim();

  const mentions = taggedUsers.map(u => ({ id: u.id, type: 'User' }));
  const mentionNames = taggedUsers.map(u => `@${u.name}`);
  return { body, mentions, mentionNames };
}

// ---------------------------------------------------------------------------
// Post (or draft) interview-request comments for a whole shortlist
// ---------------------------------------------------------------------------

/**
 * Draft or post an interview-request comment for each shortlisted candidate.
 *
 * @param {Candidate[]} shortlist  Contract objects from filterBySkills() (needs itemId + name).
 * @param {object} [opts]
 * @param {boolean} [opts.post=false]   false = dry-run (print only); true = post to Monday.
 * @param {string}  [opts.role]         The JOB's role we're hiring for (from the job ad).
 * @param {Object<string, Array>} [opts.tagUsersByBoard]  Per-board tag lists (defaults to config).
 * @param {Array}   [opts.defaultTagUsers]  Fallback taggers for unlisted boards (defaults to config).
 * @param {Array}   [opts.tagUsers]     Flat list applied to EVERY candidate; overrides the per-board maps.
 * @param {Array<string|number>} [opts.tagUsers]  Overrides config tagUsers.
 * @returns {Promise<Array>} One result per candidate:
 *   { candidate, body, mentions, posted, updateId?, error? }
 */
async function postInterviewRequests(shortlist, opts = {}) {
  const post = opts.post === true;

  // Tag source, in priority order:
  //   1. opts.tagUsers      — a flat list applied to EVERY candidate (one-off / tests)
  //   2. tagUsersByBoard    — per-board lists keyed by candidate.boardId (config default)
  //      falling back to defaultTagUsers for any board not listed.
  const overrideEntries = opts.tagUsers;                     // undefined unless explicitly passed
  const byBoard = opts.tagUsersByBoard || tagUsersByBoard || {};
  const fallback = opts.defaultTagUsers || defaultTagUsers || [];

  if (!shortlist.length) {
    console.log('No shortlisted candidates — nothing to comment on.');
    return [];
  }

  // Resolve each board's tag list once and cache it (avoids re-hitting the API
  // for every candidate on the same board).
  const cache = new Map();
  async function resolveForBoard(boardId) {
    const key = overrideEntries !== undefined ? '__override__' : (boardId || '__none__');
    if (cache.has(key)) return cache.get(key);

    const entries = overrideEntries !== undefined ? overrideEntries : (byBoard[boardId] || fallback);
    const { resolved, problems } = await resolveTagUsers(entries);
    for (const p of problems) console.warn(`  [tag] board ${boardId}: ${p}`);
    if (!entries.length) {
      console.warn(`  [tag] board ${boardId}: no tag users configured — nobody will be notified`);
    } else {
      console.log(`  [tag] board ${boardId} → ${resolved.map(u => `${u.name} (${u.id})`).join(', ') || '(none resolved)'}`);
    }
    cache.set(key, resolved);
    return resolved;
  }

  console.log(
    `\n${post ? 'Posting' : 'DRAFTING (dry-run — nothing will be posted)'} ` +
      `interview requests for ${shortlist.length} candidate(s).\n`
  );

  const results = [];
  for (const candidate of shortlist) {
    const resolved = await resolveForBoard(candidate.boardId);
    const { body, mentions, mentionNames } = buildComment(candidate, resolved, { role: opts.role });
    const result = { candidate, body, mentions, posted: false };

    // Monday appends the mentions to the update; show them in the preview so the
    // dry-run reflects what the posted comment will actually read.
    const preview = mentionNames.length ? `${body} ${mentionNames.join(' ')}` : body;
    console.log(`  • [${candidate.boardName}] item ${candidate.itemId}`);
    console.log(`    "${preview}"`);

    if (post) {
      try {
        const res = await addComment(candidate.itemId, body, mentions);
        result.posted = true;
        result.updateId = res?.create_update?.id;
        console.log(`    ✓ posted (update ${result.updateId})`);
      } catch (err) {
        result.error = err.message;
        console.log(`    ✗ failed — ${err.message}`);
      }
    }
    console.log('');
    results.push(result);
  }

  if (!post) {
    console.log('Dry-run complete. Re-run with --post to publish these comments.');
  } else {
    const ok = results.filter(r => r.posted).length;
    console.log(`Done: ${ok}/${results.length} comment(s) posted.`);
  }

  return results;
}

module.exports = { postInterviewRequests, buildComment, resolveTagUsers };

// ---------------------------------------------------------------------------
// CLI: run the full pipeline end-to-end, then draft/post interview requests.
//   node interview-commenter.js [path-to-job-ad] [--post]
// Dry-run unless --post is passed.
// ---------------------------------------------------------------------------
if (require.main === module) {
  const { parseJobAd }     = require('./job-parser');
  const { findCandidates } = require('./candidate-matcher');
  const { filterBySkills } = require('./cv-skills-matcher');

  const argv = process.argv.slice(2);
  const post = argv.includes('--post');
  const jobAdPath = argv.find(a => !a.startsWith('--')) || './job ad.txt';

  (async () => {
    console.log(`Reading job ad: ${jobAdPath}\n`);
    const criteria = parseJobAd(jobAdPath);
    const role = criteria.raw?.role || '';

    console.log('Step 1: Scanning Monday boards for candidates...');
    const candidates = await findCandidates(criteria);
    console.log(`  Found ${candidates.length} board match(es)\n`);
    if (!candidates.length) { console.log('No candidates matched. Done.'); return; }

    console.log('Step 2: Checking CVs against required skills...');
    const shortlist = await filterBySkills(candidates, criteria.skills);
    console.log(`  Shortlist: ${shortlist.length} candidate(s)`);

    console.log('\nStep 3: Interview-request comments');
    await postInterviewRequests(shortlist, { post, role });
  })().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
