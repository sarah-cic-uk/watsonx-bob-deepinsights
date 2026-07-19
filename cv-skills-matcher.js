'use strict';

// cv-skills-matcher.js
// Step 2 of the pipeline: for each candidate from candidate-matcher, download
// their CV from Box, check it against the required skills, and return only
// those who match. Candidates without a CV link are skipped with a warning.

const { createScraperSession } = require('./box_scraper');

// Minimum fraction of required skills that must appear in the CV (0.0 – 1.0).
// 1.0 = all skills required. Lower to allow partial matches.
const DEFAULT_SKILL_THRESHOLD = 0.7;

/**
 * Check which required skills appear in the CV text.
 * Matching is case-insensitive substring — "AWS" matches "aws", "AWS Lambda", etc.
 *
 * @param {string} cvText         Full extracted text from the CV.
 * @param {string[]} requiredSkills
 * @returns {{ matched: string[], missing: string[], score: number }}
 */
function scoreSkills(cvText, requiredSkills) {
  const text = cvText.toLowerCase();
  const matched = [];
  const missing = [];

  for (const skill of requiredSkills) {
    if (text.includes(skill.toLowerCase())) {
      matched.push(skill);
    } else {
      missing.push(skill);
    }
  }

  const score = requiredSkills.length ? matched.length / requiredSkills.length : 1;
  return { matched, missing, score };
}

/**
 * Download CVs for each candidate and filter by required skills.
 *
 * @param {Array}    candidates      Output of findCandidates() from candidate-matcher.js
 * @param {string[]} requiredSkills  Skills list from parseJobAd()
 * @param {object}   [opts]
 * @param {number}   [opts.threshold=1.0]  Minimum fraction of skills required (0.0–1.0)
 * @returns {Promise<Array>} Candidates who passed the skill check, each with:
 *   ...original candidate fields, cvText, matchedSkills, missingSkills, skillScore
 */
async function filterBySkills(candidates, requiredSkills, opts = {}) {
  const threshold = opts.threshold ?? DEFAULT_SKILL_THRESHOLD;

  const withLinks = candidates.filter(c => {
    if (!c.cvLink) {
      console.warn(`  [SKIP] ${c.name} — no CV link on their Monday card`);
      return false;
    }
    return true;
  });

  if (!withLinks.length) {
    console.log('No candidates with CV links to process.');
    return [];
  }

  const total = withLinks.length;
  console.log(`Downloading CVs for ${total} candidate(s)...\n`);
  const session = await createScraperSession();
  const shortlist = [];

  try {
    for (let i = 0; i < withLinks.length; i++) {
      const candidate = withLinks[i];
      process.stdout.write(`  [${i + 1}/${total}] ${candidate.name} (${candidate.boardName}) ... `);
      try {
        const cvText = await session.scrapeCV(candidate.cvLink);
        const { matched, missing, score } = scoreSkills(cvText, requiredSkills);

        if (score >= threshold) {
          console.log(`MATCH (${matched.length}/${requiredSkills.length} skills)`);
          shortlist.push({
            ...candidate,
            cvText,
            matchedSkills: matched,
            missingSkills: missing,
            skillScore: score,
          });
        } else {
          console.log(`NO MATCH — missing: ${missing.join(', ')}`);
        }
      } catch (err) {
        console.log(`ERROR — ${err.message}`);
      }
    }
  } finally {
    await session.close();
  }

  return shortlist;
}

module.exports = { filterBySkills, scoreSkills };

// Smoke-test: node cv-skills-matcher.js
// Reads job ad.txt, runs full pipeline, prints shortlist.
if (require.main === module) {
  const { parseJobAd }    = require('./job-parser');
  const { findCandidates } = require('./candidate-matcher');

  (async () => {
    const jobAdPath = process.argv[2] || './job ad.txt';
    console.log(`Reading job ad: ${jobAdPath}\n`);
    const criteria = parseJobAd(jobAdPath);

    console.log('Job criteria:');
    console.log(`  Role keywords : ${criteria.roleKeywords.join(', ')}`);
    console.log(`  Bands         : ${criteria.bands.join(', ')}`);
    console.log(`  Levels        : ${criteria.levels.join(', ')}`);
    console.log(`  Locations     : ${criteria.locations.join(', ')}`);
    console.log(`  Required skills: ${criteria.skills.join(', ')}\n`);

    console.log('Step 1: Scanning Monday boards for candidates...');
    const candidates = await findCandidates(criteria);
    console.log(`  Found ${candidates.length} board match(es)\n`);

    if (!candidates.length) {
      console.log('No candidates matched the board criteria. Done.');
      process.exit(0);
    }

    console.log('Step 2: Checking CVs against required skills...');
    const shortlist = await filterBySkills(candidates, criteria.skills);

    console.log(`\n--- Final shortlist: ${shortlist.length} candidate(s) ---\n`);
    for (const c of shortlist) {
      console.log(`  ${c.name}`);
      console.log(`    Board    : ${c.boardName}`);
      console.log(`    Role     : ${c.role}  |  Band: ${c.band}  |  Level: ${c.level}`);
      console.log(`    Location : ${c.location}`);
      console.log(`    Skills   : ${c.matchedSkills.join(', ')} (${Math.round(c.skillScore * 100)}%)`);
      if (c.missingSkills.length) {
        console.log(`    Missing  : ${c.missingSkills.join(', ')}`);
      }
      console.log(`    CV link  : ${c.cvLink}`);
      console.log(`    Comments : ${c.comments.length}`);
      console.log('');
    }
  })().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
