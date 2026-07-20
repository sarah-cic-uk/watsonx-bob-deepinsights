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
const { businessUnit, tagUsers } = require('./boards.config');

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

  // Fetch the account users once — needed to resolve names, and to attach a
  // readable display name to raw numeric IDs so the comment reads "@Brad" not "@11".
  const allUsers = users || await listUsers();

  for (const entry of entries) {
    const str = String(entry).trim();

    if (/^\d+$/.test(str)) {
      // Numeric — treat as a user ID. Attach a name if we happen to know it.
      const known = allUsers.find(u => String(u.id) === str);
      resolved.push({ id: str, name: known?.name || str });
      continue;
    }

    const hits = allUsers.filter(u => u.name && u.name.toLowerCase() === str.toLowerCase());
    if (hits.length === 1) {
      resolved.push({ id: String(hits[0].id), name: hits[0].name });
    } else if (hits.length === 0) {
      problems.push(`no Monday user named "${str}" — will not be tagged`);
    } else {
      const ids = hits.map(h => h.id).join(', ');
      problems.push(`"${str}" is ambiguous (matches user IDs ${ids}) — use the numeric ID in boards.config.js`);
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
 * @param {object} candidate           A shortlist entry (needs `name`; `role` optional).
 * @param {Array<{id,name}>} taggedUsers Resolved users to notify.
 * @param {object} [opts]
 * @param {string} [opts.businessUnit]  Overrides the config business unit.
 * @param {string} [opts.role]          Role to interview for; falls back to candidate.role.
 * @returns {{ body: string, mentions: Array<{id,type:'User'}> }}
 */
function buildComment(candidate, taggedUsers = [], opts = {}) {
  const bu = opts.businessUnit || businessUnit || 'We';
  const role = (opts.role || candidate.role || '').trim();
  const mentionText = taggedUsers.map(u => `@${u.name}`).join(' ');

  const forRole = role ? ` for ${role}` : '';
  const tail = mentionText ? ` ${mentionText}` : '';
  const body = `${bu} interested to interview ${candidate.name}${forRole}${tail}`.trim();

  const mentions = taggedUsers.map(u => ({ id: u.id, type: 'User' }));
  return { body, mentions };
}

// ---------------------------------------------------------------------------
// Post (or draft) interview-request comments for a whole shortlist
// ---------------------------------------------------------------------------

/**
 * Draft or post an interview-request comment for each shortlisted candidate.
 *
 * @param {Array} shortlist  Output of filterBySkills() — each entry needs itemId + name.
 * @param {object} [opts]
 * @param {boolean} [opts.post=false]   false = dry-run (print only); true = post to Monday.
 * @param {string}  [opts.role]         Role to interview for (defaults per-candidate).
 * @param {Array<string|number>} [opts.tagUsers]  Overrides config tagUsers.
 * @returns {Promise<Array>} One result per candidate:
 *   { candidate, body, mentions, posted, updateId?, error? }
 */
async function postInterviewRequests(shortlist, opts = {}) {
  const post = opts.post === true;
  const entries = opts.tagUsers || tagUsers || [];

  const { resolved, problems } = await resolveTagUsers(entries);
  for (const p of problems) console.warn(`  [tag] ${p}`);

  if (!shortlist.length) {
    console.log('No shortlisted candidates — nothing to comment on.');
    return [];
  }

  console.log(
    `\n${post ? 'Posting' : 'DRAFTING (dry-run — nothing will be posted)'} ` +
      `interview requests for ${shortlist.length} candidate(s).`
  );
  console.log(
    `Tagging: ${resolved.length ? resolved.map(u => `${u.name} (${u.id})`).join(', ') : '(nobody)'}\n`
  );

  const results = [];
  for (const candidate of shortlist) {
    const { body, mentions } = buildComment(candidate, resolved, { role: opts.role });
    const result = { candidate, body, mentions, posted: false };

    console.log(`  • [${candidate.boardName}] item ${candidate.itemId}`);
    console.log(`    "${body}"`);

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
