'use strict';

// cv-skills-matcher.js
// Step 2 of the pipeline: for each candidate from candidate-matcher, download
// their CV from Box, check it against the required skills, and return only
// those who match. Candidates without a CV link are skipped with a warning.

// box_scraper (→ playwright) is required lazily inside filterBySkills so that
// importing this module for its pure scoreSkills() doesn't pull in heavy Box deps.

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
/**
 * Map skill aliases to a canonical form.
 * e.g. "JS", "JavaScript" both → "javascript"
 */
const SKILL_ALIASES = {
    js: 'javascript',
    javascript: 'javascript',
    ts: 'typescript',
    typescript: 'typescript',
    py: 'python',
    python: 'python',
    cf: 'cloudformation',
    cloudformation: 'cloudformation',
    tf: 'terraform',
    terraform: 'terraform',
    k8s: 'kubernetes',
    kubernetes: 'kubernetes',
    react: 'react',
    reactjs: 'react',
    vue: 'vue',
    vuejs: 'vue',
    docker: 'docker',
    aws: 'aws',
    azure: 'azure',
    gcp: 'gcp',
    node: 'nodejs',
    nodejs: 'nodejs',
    sql: 'sql',
    postgres: 'postgresql',
    postgresql: 'postgresql',
    mongo: 'mongodb',
    mongodb: 'mongodb',
    java: 'java',
    spring: 'spring',
    springboot: 'spring',
};

/**
 * Normalize a skill name to its canonical form using aliases.
 * Falls back to the original lowercased name if no alias exists.
 */
function normalizeSkill(skill) {
    const lower = skill.toLowerCase().trim();
    return SKILL_ALIASES[lower] || lower;
}

/**
 * Check if a skill appears in CV text using word boundaries.
 * e.g. "java" matches "Java" but NOT "JavaScript"
 */
function skillAppearsInText(cvText, skill) {
    const normalized = normalizeSkill(skill);
    const text = cvText.toLowerCase();

    // Word boundary regex: skill must be surrounded by non-word characters
    // \b matches word boundaries (space, punctuation, start/end of string)
    const regex = new RegExp(`\\b${normalized}\\b`, 'gi');
    return regex.test(text);
}

/**
 * Check which required skills appear in the CV text.
 * Uses word boundaries + aliases for smarter matching.
 *
 * @param {string} cvText         Full extracted text from the CV.
 * @param {string[]} requiredSkills
 * @returns {{ matched: string[], missing: string[], score: number }}
 */
function scoreSkills(cvText, requiredSkills) {
    const matched = [];
    const missing = [];

    for (const skill of requiredSkills) {
        if (skillAppearsInText(cvText, skill)) {
            matched.push(skill);
        } else {
            missing.push(skill);
        }
    }

    const score = requiredSkills.length
        ? matched.length / requiredSkills.length
        : 1;
    return {matched, missing, score};
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

    const withLinks = candidates.filter((c) => {
        if (!c.cvLink) {
            console.warn(
                `  [SKIP] ${c.name} — no CV link on their Monday card`,
            );
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
    const {createScraperSession} = require('../integrations/box'); // lazy — pulls in playwright
    const session = await createScraperSession();
    const shortlist = [];

    try {
        for (let i = 0; i < withLinks.length; i++) {
            const candidate = withLinks[i];
            process.stdout.write(
                `  [${i + 1}/${total}] ${candidate.name} (${candidate.boardName}) ... `,
            );
            try {
                const cvText = await session.scrapeCV(candidate.cvLink);
                const {matched, missing, score} = scoreSkills(
                    cvText,
                    requiredSkills,
                );

                if (score >= threshold) {
                    console.log(
                        `MATCH (${matched.length}/${requiredSkills.length} skills)`,
                    );
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

module.exports = {filterBySkills, scoreSkills};

