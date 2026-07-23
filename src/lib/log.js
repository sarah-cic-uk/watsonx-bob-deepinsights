'use strict';

// log.js — append-only error log for pipeline runs.
//
// Real runs (via src/index.js) record failures here so they leave a breadcrumb;
// `npm run doctor` reads this file back and surfaces recent errors (permission
// issues first). Logging must NEVER break a run, so all writes are best-effort.
//
// Set DEEPINSIGHTS_NO_ERROR_LOG=1 to disable writing (used by unit tests).

const fs = require('fs');
const path = require('path');

// error.log lives at the repo root (two levels up from src/lib/).
const ERROR_LOG = path.join(__dirname, '..', '..', 'error.log');

/**
 * Append a timestamped error entry: "<ISO ts>\t<context>\t<message>".
 * @param {string} context  Where it happened, e.g. "comment item=123".
 * @param {string|Error} message  The error (or its message).
 */
function logError(context, message) {
  if (process.env.DEEPINSIGHTS_NO_ERROR_LOG) return;
  const msg = message && message.message ? message.message : String(message);
  const line = `${new Date().toISOString()}\t${context}\t${msg.replace(/\s+/g, ' ').trim()}\n`;
  try {
    fs.appendFileSync(ERROR_LOG, line);
  } catch {
    /* logging is best-effort — never let it throw into the pipeline */
  }
}

module.exports = { logError, ERROR_LOG };
