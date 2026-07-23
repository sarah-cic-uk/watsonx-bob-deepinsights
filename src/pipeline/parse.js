'use strict';

// src/pipeline/parse.js
// Parses a structured job ad text file into criteria for candidate-matcher
// and skills for cv-skills-matcher.
//
// Expected format (key: value, one per line):
//   Role: Senior Software Engineer
//   Band: 7
//   Level: L2
//   Location: London, Hursley
//   Skills: AWS, javascript, docker, react

const fs = require('fs');

// Ordered lowest → highest. If a job asks for L2, also accept L3 (overqualified is fine).
const LEVEL_HIERARCHY = ['L1', 'L2', 'L3'];

function expandLevels(requestedLevels) {
  const expanded = new Set();
  for (const level of requestedLevels) {
    const idx = LEVEL_HIERARCHY.findIndex(l => l.toLowerCase() === level.toLowerCase());
    if (idx === -1) {
      expanded.add(level); // unrecognised level — keep as-is
    } else {
      for (let i = idx; i < LEVEL_HIERARCHY.length; i++) {
        expanded.add(LEVEL_HIERARCHY[i]);
      }
    }
  }
  return Array.from(expanded);
}

// Words stripped from role titles before building keyword list.
// These words alone are too generic to be useful Monday search terms.
const ROLE_STOP_WORDS = new Set([
  'senior', 'junior', 'lead', 'principal', 'staff', 'associate',
  'mid', 'graduate', 'experienced', 'head', 'chief',
]);

/**
 * Parse a job ad file and return structured criteria.
 *
 * @param {string} filePath  Path to the job ad text file.
 * @returns {{
 *   roleKeywords: string[],
 *   bands: string[],
 *   levels: string[],
 *   locations: string[],
 *   skills: string[],
 *   raw: object,
 * }}
 */
function parseJobAd(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const raw = {};

  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const val = line.slice(colon + 1).trim();
    if (key && val) raw[key] = val;
  }

  // Role → keyword list (split on spaces, remove stop words and short tokens)
  const roleStr = raw['role'] || '';
  const roleKeywords = roleStr
    .split(/[\s,/]+/)
    .map(w => w.trim())
    .filter(w => w.length >= 4 && !ROLE_STOP_WORDS.has(w.toLowerCase()));

  // Band → array of numeric strings (strip letters so '7A' and '7' both normalise to '7')
  const bandStr = raw['band'] || '';
  const bands = bandStr
    .split(',')
    .map(b => b.trim().replace(/[a-zA-Z]+$/, ''))
    .filter(Boolean);

  // Level → expand upwards: L1 → [L1,L2,L3], L2 → [L2,L3], L3 → [L3]
  const levelStr = raw['level'] || '';
  const levels = expandLevels(
    levelStr.split(',').map(l => l.trim()).filter(Boolean)
  );

  // Location → array (may be comma-separated list of sites)
  const locationStr = raw['location'] || '';
  const locations = locationStr
    .split(',')
    .map(l => l.trim())
    .filter(Boolean);

  // Skills → array (comma-separated)
  const skillsStr = raw['skills'] || '';
  const skills = skillsStr
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  return { roleKeywords, bands, levels, locations, skills, raw };
}

module.exports = { parseJobAd };

// Quick smoke-test: node src/pipeline/parse.js [path-to-job-ad]
if (require.main === module) {
  const filePath = process.argv[2] || './examples/job-ad.txt';
  try {
    const criteria = parseJobAd(filePath);
    console.log('Parsed job ad:');
    console.log(JSON.stringify(criteria, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}
