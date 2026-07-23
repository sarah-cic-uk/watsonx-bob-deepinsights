'use strict';

// main.js — DeepInsights recruiting pipeline, end to end.
//
// Ties the stages together into one command a recruiter actually runs:
//
//   job advert → find candidates on the Monday boards → check CVs against the
//   required skills → comment an interview request on each match → add the
//   matches to your team tracking board.
//
// SAFETY: dry-run by default. It previews every step to the terminal and writes
// NOTHING (no comments, no tracking items) unless you pass --post.
//
// Usage:
//   node main.js 'examples/job-ad.txt'            # full preview, writes nothing
//   node main.js 'examples/job-ad.txt' --post     # posts comments + adds matches to tracking board
//   node main.js 'examples/job-ad.txt' --skip-cv  # preview without the Box/CV step (skills NOT verified)

const { parseJobAd }            = require('./pipeline/parse');
const { findCandidates }        = require('./pipeline/find');
const { postInterviewRequests } = require('./pipeline/comment');
const { addMatchesToTracking }  = require('./pipeline/track');
const { skillThreshold }        = require('../boards.config');
// NOTE: cv-skills-matcher is required lazily inside runPipeline (only when the CV
// step actually runs). It pulls in box_scraper → playwright, so requiring it up
// front would make --skip-cv fail on machines without those Box deps installed.

function hr(title) {
  console.log(`\n${'═'.repeat(60)}\n${title}\n${'═'.repeat(60)}`);
}

/**
 * Run the full recruiting pipeline for one job advert.
 *
 * @param {string} jobAdPath  Path to the job ad text file.
 * @param {object} [opts]
 * @param {boolean} [opts.post=false]    false = dry-run (writes nothing); true = post comments + create tracking items.
 * @param {boolean} [opts.skipCv=false]  true = skip the Box/CV skills step (skills unverified).
 * @returns {Promise<{criteria, candidates, shortlist, comments, tracked}>}
 */
async function runPipeline(jobAdPath, opts = {}) {
  const post = opts.post === true;
  const skipCv = opts.skipCv === true;

  console.log(`DeepInsights pipeline — ${post ? 'LIVE (writes enabled)' : 'DRY-RUN (no writes)'}`);
  console.log(`Job ad: ${jobAdPath}`);

  // Step 1 — parse the job advert into criteria.
  hr('Step 1/5 · Parse job ad');
  const criteria = parseJobAd(jobAdPath);
  const role = criteria.raw?.role || '';
  console.log(`  Role keywords : ${criteria.roleKeywords.join(', ') || '(none)'}`);
  console.log(`  Bands         : ${criteria.bands.join(', ') || '(any)'}`);
  console.log(`  Levels        : ${criteria.levels.join(', ') || '(any)'}`);
  console.log(`  Locations     : ${criteria.locations.join(', ') || '(any)'}`);
  console.log(`  Skills        : ${criteria.skills.join(', ') || '(none)'}`);

  // Step 2 — scan the source boards.
  hr('Step 2/5 · Find candidates on the Monday boards');
  const candidates = await findCandidates(criteria);
  console.log(`→ ${candidates.length} board match(es).`);
  if (!candidates.length) {
    console.log('\nNo candidates matched the board criteria. Done.');
    return { criteria, candidates, shortlist: [], comments: [], tracked: [] };
  }

  // Step 3 — CV / skills check (Box), unless skipped.
  hr('Step 3/5 · Check CVs against required skills');
  let shortlist;
  if (skipCv) {
    shortlist = candidates;
    console.log('  ⚠ --skip-cv: skipping the Box/CV step. Skills are NOT verified —');
    console.log('    treating all board matches as the shortlist.');
  } else {
    const { filterBySkills } = require('./pipeline/skills'); // lazy — pulls in Box/playwright
    shortlist = await filterBySkills(candidates, criteria.skills, { threshold: skillThreshold });
    const pct = Math.round((skillThreshold ?? 0.7) * 100);
    console.log(`→ ${shortlist.length} candidate(s) passed the skills check (threshold ${pct}%).`);
  }
  if (!shortlist.length) {
    console.log('\nNo candidates passed the skills check. Done.');
    return { criteria, candidates, shortlist, comments: [], tracked: [] };
  }

  // Step 4 — interview-request comments.
  hr('Step 4/5 · Interview-request comments');
  const comments = await postInterviewRequests(shortlist, { post, role });

  // Step 5 — add matches to the tracking board.
  hr('Step 5/5 · Add matches to the tracking board');
  const tracked = await addMatchesToTracking(shortlist, { post });

  // Summary.
  hr('Summary');
  const commented = comments.filter(c => c.posted).length;
  const trackedOk = tracked.filter(t => t.created).length;
  console.log(`  Board matches   : ${candidates.length}`);
  console.log(`  Passed skills   : ${shortlist.length}${skipCv ? ' (CV step skipped)' : ''}`);
  if (post) {
    console.log(`  Comments posted : ${commented}/${comments.length}`);
    console.log(`  Tracked         : ${trackedOk}/${tracked.length}`);
  } else {
    console.log(`  Would comment   : ${comments.length}`);
    console.log(`  Would track     : ${tracked.length}`);
    console.log('\n  DRY-RUN — nothing was written. Re-run with --post to publish.');
  }

  return { criteria, candidates, shortlist, comments, tracked };
}

module.exports = { runPipeline };

// CLI
if (require.main === module) {
  const argv = process.argv.slice(2);
  const post = argv.includes('--post');
  const skipCv = argv.includes('--skip-cv');
  const jobAdPath = argv.find(a => !a.startsWith('--')) || './examples/job-ad.txt';

  runPipeline(jobAdPath, { post, skipCv }).catch(err => {
    console.error('\nFatal:', err.message);
    process.exit(1);
  });
}
