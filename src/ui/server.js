'use strict';

// server.js — local web dashboard for DeepInsights.
//
// A tiny built-in-http server (NO framework, NO build step) that serves the
// static dashboard and exposes a small API which reuses the existing pipeline.
//
// SAFETY: binds to 127.0.0.1 only — it can post to Monday and rewrite config, so
// it must never be network-exposed. The preview (/api/run) is strictly read-only;
// the only write path is /api/post, triggered by an explicit button + confirm.
//
// Run:  npm run ui   (or: node src/ui/server.js)

const http = require('http');
const fs = require('fs');
const path = require('path');

const { parseJobAdText }        = require('../pipeline/parse');
const { findCandidates }        = require('../pipeline/find');
const { postInterviewRequests } = require('../pipeline/comment');
const { addMatchesToTracking }  = require('../pipeline/track');
const { loadToken }             = require('../integrations/monday');
const { generateConfig }        = require('../../scripts/setup');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4517;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_PATH = path.join(__dirname, '..', '..', 'boards.config.js');

// --- helpers -----------------------------------------------------------------

// Read boards.config.js fresh from disk (busting the require cache) so edits made
// via the settings modal take effect without restarting the server.
function freshConfig() {
  delete require.cache[require.resolve('../../boards.config')];
  return require('../../boards.config');
}

function hasToken() {
  try { loadToken(); return true; } catch { return false; }
}

// Are the (heavy, optional) Box/CV dependencies installed?
function boxDepsInstalled() {
  try { require.resolve('playwright'); require.resolve('pdf-parse'); return true; }
  catch { return false; }
}

// Trim a candidate down to what the UI table / CSV / post actions need — notably
// dropping the (potentially huge) cvText and the full comments array.
function publicCandidate(c) {
  return {
    boardId: c.boardId,
    boardName: c.boardName,
    itemId: c.itemId,
    itemUrl: c.itemUrl || null,
    name: c.name,
    role: c.role,
    band: c.band,
    level: c.level,
    location: c.location,
    cvLink: c.cvLink || '',
    commentsCount: Array.isArray(c.comments) ? c.comments.length : 0,
    matchedSkills: c.matchedSkills || null,
    missingSkills: c.missingSkills || null,
    skillScore: typeof c.skillScore === 'number' ? c.skillScore : null,
  };
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > limit) { reject(new Error('request body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
function serveStatic(res, name) {
  const file = path.join(PUBLIC_DIR, name);
  // Never serve outside public/.
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// --- config validation (mirrors setup.js's rules) ----------------------------
function validateConfigPayload(b) {
  const errors = [];
  if (!b || typeof b !== 'object') return ['no config payload'];
  if (!b.businessUnit || !String(b.businessUnit).trim()) errors.push('businessUnit is required');
  const ids = Array.isArray(b.sourceBoardIds) ? b.sourceBoardIds.map(String) : [];
  if (!ids.length) errors.push('at least one source board ID is required');
  if (ids.some((id) => !/^\d+$/.test(id))) errors.push('source board IDs must be all digits');
  if (!/^\d+$/.test(String(b.trackingBoardId || ''))) errors.push('tracking board ID must be all digits');
  const t = Number(b.skillThreshold);
  if (Number.isNaN(t) || t < 0 || t > 1) errors.push('skillThreshold must be a number between 0 and 1');
  return errors;
}

// --- API handlers ------------------------------------------------------------

async function handleGetConfig(res) {
  const cfg = freshConfig();
  sendJson(res, 200, {
    businessUnit: cfg.businessUnit || '',
    sourceBoardIds: cfg.sourceBoardIds || [],
    trackingBoardId: cfg.trackingBoardId || '',
    skillThreshold: cfg.skillThreshold ?? 0.7,
    tagUsersByBoard: cfg.tagUsersByBoard || {},
    defaultTagUsers: cfg.defaultTagUsers || [],
    hasToken: hasToken(),
  });
}

async function handlePostConfig(req, res) {
  const body = await readBody(req);
  const errors = validateConfigPayload(body);
  if (errors.length) return sendJson(res, 400, { error: errors.join('; ') });

  const configText = generateConfig({
    businessUnit: String(body.businessUnit).trim(),
    sourceBoardIds: body.sourceBoardIds.map(String),
    tagUsersByBoard: body.tagUsersByBoard || {},
    defaultTagUsers: body.defaultTagUsers || [],
    trackingBoardId: String(body.trackingBoardId),
    skillThreshold: Number(body.skillThreshold),
  });
  fs.writeFileSync(CONFIG_PATH, configText);
  freshConfig(); // refresh cache immediately
  sendJson(res, 200, { ok: true });
}

async function handleRun(req, res) {
  const body = await readBody(req);
  const jobAd = String(body.jobAd || '').trim();
  const verifyCv = body.verifyCv === true;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    if (!jobAd) throw new Error('Paste a job advert first.');

    sse('step', { message: 'Parsing job advert…' });
    const criteria = parseJobAdText(jobAd);
    const cfg = freshConfig();

    const boardCount = (cfg.sourceBoardIds || []).length;
    sse('step', { message: `Scanning ${boardCount} board${boardCount === 1 ? '' : 's'} on Monday…` });
    const candidates = await findCandidates(criteria);
    sse('step', { message: `Found ${candidates.length} candidate${candidates.length === 1 ? '' : 's'} matching role / band / level / location` });

    let shortlist = candidates;
    let cvVerified = false;
    let note = '';
    if (verifyCv) {
      if (!boxDepsInstalled()) {
        note = 'CV verification skipped — Box tooling isn’t installed (run `npm install`). Showing board matches; skills not verified.';
        sse('step', { message: note });
      } else {
        sse('step', { message: 'Downloading & scoring CVs from Box… (a browser may open for w3id login)' });
        try {
          const { filterBySkills } = require('../pipeline/skills');
          const verified = await filterBySkills(candidates, criteria.skills, { threshold: cfg.skillThreshold });
          if (verified.length) {
            shortlist = verified;
            cvVerified = true;
            sse('step', { message: `${verified.length} candidate${verified.length === 1 ? '' : 's'} passed the skills check` });
          } else {
            note = 'No CVs could be scored (missing or unreachable CV links). Showing board matches; skills not verified.';
            sse('step', { message: note });
          }
        } catch (err) {
          note = `CV step couldn’t run (${err.message}). Showing board matches; skills not verified.`;
          sse('step', { message: note });
        }
      }
    }

    sse('result', {
      role: criteria.raw?.role || '',
      verifiedCv: cvVerified,
      note,
      skillThreshold: cfg.skillThreshold ?? 0.7,
      candidates: shortlist.map(publicCandidate),
    });
    sse('done', {});
  } catch (err) {
    sse('error', { message: err.message });
  } finally {
    res.end();
  }
}

async function handlePost(req, res) {
  const body = await readBody(req);
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  const role = String(body.role || '');
  if (!candidates.length) return sendJson(res, 400, { error: 'no candidates to post' });

  const cfg = freshConfig();
  const comments = await postInterviewRequests(candidates, {
    post: true,
    role,
    businessUnit: cfg.businessUnit,
    tagUsersByBoard: cfg.tagUsersByBoard,
    defaultTagUsers: cfg.defaultTagUsers,
  });
  const tracked = await addMatchesToTracking(candidates, { post: true });

  sendJson(res, 200, {
    comments: {
      posted: comments.filter((c) => c.posted).length,
      total: comments.length,
      errors: comments.filter((c) => c.error).map((c) => `${c.candidate.name}: ${c.error}`),
    },
    tracked: {
      created: tracked.filter((t) => t.created).length,
      total: tracked.length,
      errors: tracked.filter((t) => t.error).map((t) => `${t.itemName}: ${t.error}`),
    },
  });
}

// --- router ------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const pathname = req.url.split('?')[0];
  try {
    if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) return serveStatic(res, 'index.html');
    if (method === 'GET' && pathname === '/styles.css') return serveStatic(res, 'styles.css');
    if (method === 'GET' && pathname === '/app.js') return serveStatic(res, 'app.js');

    if (method === 'GET'  && pathname === '/api/config') return handleGetConfig(res);
    if (method === 'POST' && pathname === '/api/config') return handlePostConfig(req, res);
    if (method === 'POST' && pathname === '/api/run')     return handleRun(req, res);
    if (method === 'POST' && pathname === '/api/post')    return handlePost(req, res);

    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  }
});

// Only bind a port when run directly — requiring this module (e.g. from tests)
// must not start a listening server.
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`\nDeepInsights dashboard → http://${HOST}:${PORT}`);
    console.log('(local only; preview is read-only, posting needs an explicit click)\n');
    if (!hasToken()) console.log('⚠ No Monday token found — run `npm run setup` first.\n');
  });
}

// Exported for unit testing (pure helpers — no network, no side effects).
module.exports = { validateConfigPayload, publicCandidate };
