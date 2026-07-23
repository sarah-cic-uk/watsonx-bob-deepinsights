'use strict';

// src/pipeline/track.js
// Pipeline step 7: add each confirmed-match candidate to your own team tracking
// board (boards.config.js -> trackingBoardId) so you can track their progress
// independently of the source boards.
//
// Each candidate becomes a new item named after them, plus a summary update
// capturing where they came from and why they matched. Writing name + summary
// (rather than typed columns) means we don't need to know the tracking board's
// column schema — populating typed columns is a future enhancement.
//
// SAFETY: dry-run by default. Prints what it *would* create without writing.
// Pass { post: true } to actually create the items.

const { addToTrackingBoard, addComment } = require('../integrations/monday');
const { trackingBoardId } = require('../../boards.config');

/**
 * Build the summary note attached to a candidate's tracking item.
 * @param {object} c  A shortlist entry (see interview-commenter's Candidate typedef).
 * @returns {string}
 */
function buildSummary(c) {
  const lines = [
    `Source board: ${c.boardName || '(unknown)'}`,
    `Role: ${c.role || '-'}  |  Band: ${c.band || '-'}  |  Level: ${c.level || '-'}  |  Location: ${c.location || '-'}`,
  ];
  if (c.matchedSkills && c.matchedSkills.length) {
    const pct = typeof c.skillScore === 'number' ? ` (${Math.round(c.skillScore * 100)}%)` : '';
    lines.push(`Matched skills${pct}: ${c.matchedSkills.join(', ')}`);
  }
  if (c.cvLink) lines.push(`CV: ${c.cvLink}`);
  return lines.join('\n');
}

/**
 * Add each shortlisted candidate to the tracking board.
 *
 * @param {Array}  shortlist  Confirmed matches (each needs `name`; other fields enrich the summary).
 * @param {object} [opts]
 * @param {boolean} [opts.post=false]  false = dry-run (print only); true = create items.
 * @returns {Promise<Array>} One result per candidate:
 *   { candidate, itemName, summary, created, itemId?, error? }
 */
async function addMatchesToTracking(shortlist, opts = {}) {
  const post = opts.post === true;

  if (!shortlist.length) {
    console.log('No matched candidates — nothing to add to the tracking board.');
    return [];
  }

  console.log(
    `\n${post ? 'Adding' : 'DRAFTING (dry-run — nothing will be created)'} ` +
      `${shortlist.length} candidate(s) to tracking board ${trackingBoardId}.\n`
  );

  const results = [];
  for (const candidate of shortlist) {
    const itemName = candidate.name;
    const summary = buildSummary(candidate);
    const result = { candidate, itemName, summary, created: false };

    console.log(`  • ${itemName}`);
    for (const line of summary.split('\n')) console.log(`      ${line}`);

    if (post) {
      try {
        const itemId = await addToTrackingBoard(itemName);
        result.itemId = itemId;
        // Attach the match context as an update (no mentions).
        if (itemId) await addComment(itemId, summary);
        result.created = true;
        console.log(`      ✓ created (item ${itemId})`);
      } catch (err) {
        result.error = err.message;
        console.log(`      ✗ failed — ${err.message}`);
      }
    }
    console.log('');
    results.push(result);
  }

  if (!post) {
    console.log('Dry-run complete. Re-run with --post to create these tracking items.');
  } else {
    const ok = results.filter(r => r.created).length;
    console.log(`Done: ${ok}/${results.length} tracking item(s) created.`);
  }

  return results;
}

module.exports = { addMatchesToTracking, buildSummary };
