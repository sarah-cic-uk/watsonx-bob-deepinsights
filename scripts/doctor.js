'use strict';

// doctor.js — read-only E2E troubleshooter for DeepInsights.
//
// Starts by reviewing errors from previous pipeline runs (error.log), calling out
// permission-related failures first, then checks every precondition the pipeline
// needs and reports ✓ / ⚠ / ✗ for each.
//
// It makes ABSOLUTELY NO CHANGES: it only runs GraphQL *queries* (me, boards,
// users), reads local files (incl. error.log), and resolves module deps. No
// mutations, no writes — it never even clears the error log.
//
// Run:  node scripts/doctor.js   (or: npm run doctor)
//
// On permissions: Monday does not expose a queryable "scope list" for a personal
// API token (scopes are an OAuth-app concept). The best read-only proxies for
// "can we write?" are the account role flags (is_view_only / is_guest / is_admin)
// plus confirming we can actually see each board. Actually posting a comment or
// creating a tracking item can only be fully proven by writing — which this
// script never does — so those are reported as best-effort signals.

const fs = require('fs');
const path = require('path');
const { mondayQuery, listUsers } = require('../src/integrations/monday');

// --- tiny result tracker -----------------------------------------------------
let fails = 0;
let warns = 0;
const ok   = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = (m) => { warns++; console.log(`  \x1b[33m⚠\x1b[0m ${m}`); };
const fail = (m) => { fails++; console.log(`  \x1b[31m✗\x1b[0m ${m}`); };
const info = (m) => console.log(`    ${m}`);
const section = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

// Column-title keyword rules — must mirror candidate-matcher (src/pipeline/find.js).
const COLUMN_KEYWORDS = {
  role:     ['role'],
  band:     ['band'],
  level:    ['level', 'grade'],
  location: ['location'],
  cv:       ['cv', 'box', 'resume'],
};
const norm = (s) => (s || '').toLowerCase().trim();
const hasColumn = (columns, keywords) =>
  columns.some((c) => keywords.some((k) => norm(c.title).includes(k)));

// Signatures of a permission/authorisation failure in a logged error line.
const PERMISSION_RE = /unauthor|not authoriz|permission|forbidden|\b403\b|scopeerror/i;

// Read (never modify) error.log from previous runs; surface permission issues first.
function reviewErrorLog() {
  section('0. Recent pipeline errors (error.log)');
  const logPath = path.join(__dirname, '..', 'error.log');
  if (!fs.existsSync(logPath)) {
    ok('no error.log — no failures recorded from previous runs');
    return;
  }
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  if (!lines.length) {
    ok('error.log is present but empty');
    return;
  }

  const permLines = lines.filter((l) => PERMISSION_RE.test(l));
  if (permLines.length) {
    fail(`${permLines.length} of ${lines.length} logged error(s) look PERMISSION-related — check §2 below.`);
    info(`most recent: ${permLines[permLines.length - 1]}`);
  } else {
    warn(`${lines.length} error(s) logged from previous runs (none look permission-related)`);
  }
  info(`last ${Math.min(3, lines.length)} entr${lines.length === 1 ? 'y' : 'ies'}:`);
  for (const l of lines.slice(-3)) info(`  · ${l}`);
  info('(delete error.log yourself to reset — doctor never modifies it)');
}

async function main() {
  console.log('\nDeepInsights — doctor  (read-only; makes no changes)');
  console.log('====================================================');

  // ---------------------------------------------------------------------------
  reviewErrorLog();

  // ---------------------------------------------------------------------------
  section('1. Config (boards.config.js)');
  let cfg;
  try {
    cfg = require('../boards.config');
    ok('boards.config.js loads');
  } catch (err) {
    fail(`could not load boards.config.js — ${err.message}`);
    info('Run `npm run setup` to create it.');
    return finish();
  }

  const need = ['sourceBoardIds', 'trackingBoardId', 'businessUnit', 'tagUsersByBoard', 'defaultTagUsers', 'skillThreshold'];
  for (const key of need) {
    if (cfg[key] === undefined) fail(`missing config key: ${key}`);
  }
  if (Array.isArray(cfg.sourceBoardIds) && cfg.sourceBoardIds.length) ok(`${cfg.sourceBoardIds.length} source board(s) configured`);
  else fail('sourceBoardIds is empty — nothing to scan');
  if (cfg.trackingBoardId) ok(`tracking board configured (${cfg.trackingBoardId})`); else fail('trackingBoardId not set');
  if (cfg.businessUnit) ok(`business unit: "${cfg.businessUnit}"`); else warn('businessUnit is blank');
  if (typeof cfg.skillThreshold === 'number' && cfg.skillThreshold >= 0 && cfg.skillThreshold <= 1) {
    ok(`skill threshold: ${cfg.skillThreshold} (${Math.round(cfg.skillThreshold * 100)}%)`);
  } else {
    fail(`skillThreshold must be a number 0.0–1.0 (got ${cfg.skillThreshold})`);
  }

  // ---------------------------------------------------------------------------
  section('2. Monday token & permissions');
  let me;
  try {
    const d = await mondayQuery('query { me { id name is_admin is_guest is_view_only enabled account { name slug } } }');
    me = d.me;
    ok(`token valid — connected as ${me.name} (account: ${me.account?.name})`);
  } catch (err) {
    fail(`token check failed — ${err.message}`);
    info('Provide a token via .monday-token or MONDAY_API_TOKEN, then re-run.');
    return finish();
  }

  if (!me.enabled) fail('your Monday user is disabled');
  if (me.is_view_only) {
    fail('your account is VIEW-ONLY — posting comments and creating tracking items will fail');
  } else if (me.is_guest) {
    warn('your account is a GUEST — write access may be restricted on some boards');
  } else {
    ok(`account role OK for writing (admin: ${me.is_admin})`);
  }
  info('Note: Monday exposes no scope list for personal tokens; actual write permission');
  info('is only proven by writing (which doctor never does). The above is a best-effort proxy.');

  // ---------------------------------------------------------------------------
  section('3. Source boards (visibility + required columns)');
  const ids = (cfg.sourceBoardIds || []).map(String);
  if (ids.length) {
    const d = await mondayQuery(
      `query ($ids: [ID!]) { boards(ids: $ids) { id name state columns { id title } } }`,
      { ids }
    );
    const found = new Map((d.boards || []).map((b) => [String(b.id), b]));
    for (const id of ids) {
      const b = found.get(id);
      if (!b) { fail(`board ${id} — not visible to this token (wrong ID or no access)`); continue; }
      const stateNote = b.state === 'active' ? '' : ` [state: ${b.state}]`;
      const missing = Object.entries(COLUMN_KEYWORDS)
        .filter(([, kws]) => !hasColumn(b.columns, kws))
        .map(([field]) => field);
      if (missing.length) {
        warn(`"${b.name}" (${id})${stateNote} — no column matches: ${missing.join(', ')} → those filters will read blank`);
      } else {
        ok(`"${b.name}" (${id})${stateNote} — all matcher columns present`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  section('4. Tracking board (visibility)');
  try {
    const d = await mondayQuery(`query ($id: [ID!]) { boards(ids: $id) { id name state } }`, { id: [String(cfg.trackingBoardId)] });
    const b = d.boards?.[0];
    if (!b) fail(`tracking board ${cfg.trackingBoardId} — not visible to this token`);
    else if (b.state !== 'active') warn(`tracking board "${b.name}" is ${b.state}`);
    else ok(`tracking board "${b.name}" is visible`);
  } catch (err) {
    fail(`tracking board check failed — ${err.message}`);
  }

  // ---------------------------------------------------------------------------
  section('5. Tag users resolve to real accounts');
  const allEntries = [
    ...Object.values(cfg.tagUsersByBoard || {}).flat(),
    ...(cfg.defaultTagUsers || []),
  ].map(String);
  const unique = [...new Set(allEntries)];
  if (!unique.length) {
    warn('no taggers configured on any board — comments will notify nobody');
  } else {
    const idEntries = unique.filter((e) => /^\d+$/.test(e));
    const emailEntries = unique.filter((e) => e.includes('@'));
    const nameEntries = unique.filter((e) => !/^\d+$/.test(e) && !e.includes('@'));

    let resolvedUsers = [];
    if (idEntries.length) resolvedUsers = resolvedUsers.concat(await listUsers({ ids: idEntries }));
    if (emailEntries.length) resolvedUsers = resolvedUsers.concat(await listUsers({ emails: emailEntries }));

    for (const id of idEntries) {
      const u = resolvedUsers.find((x) => String(x.id) === id);
      u ? ok(`user ID ${id} → ${u.name}`) : warn(`user ID ${id} — not found (mention may silently fail)`);
    }
    for (const email of emailEntries) {
      const u = resolvedUsers.find((x) => x.email && x.email.toLowerCase() === email.toLowerCase());
      u ? ok(`${email} → ${u.name} (id ${u.id})`) : warn(`${email} — no Monday user with that email`);
    }
    if (nameEntries.length) {
      warn(`plain names won't resolve reliably at scale: ${nameEntries.join(', ')} — use IDs or emails`);
    }
  }

  // ---------------------------------------------------------------------------
  section('6. Box / CV step readiness (static — no login attempted)');
  for (const dep of ['playwright', 'pdf-parse']) {
    try { require.resolve(dep); ok(`dependency "${dep}" installed`); }
    catch { warn(`"${dep}" not installed — run \`npm install\` before the CV step, or use --skip-cv`); }
  }
  const sessionFile = path.join(__dirname, '..', '.box_session.json');
  if (fs.existsSync(sessionFile)) ok('saved Box session found (.box_session.json) — no login prompt expected');
  else info('no saved Box session — first CV run will open a browser for IBM w3id login');

  finish();
}

function finish() {
  console.log('\n────────────────────────────────────────────────────');
  if (fails) console.log(`\x1b[31m✗ ${fails} problem(s)\x1b[0m, ${warns} warning(s) — fix the ✗ items before a live run.`);
  else if (warns) console.log(`\x1b[33m⚠ ${warns} warning(s)\x1b[0m, no blocking problems — review the ⚠ items.`);
  else console.log('\x1b[32m✓ All checks passed — the pipeline is ready.\x1b[0m');
  process.exit(fails ? 1 : 0);
}

main().catch((err) => {
  console.error('\ndoctor crashed:', err.message);
  process.exit(1);
});
