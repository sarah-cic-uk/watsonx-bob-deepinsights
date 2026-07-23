'use strict';

// test/test_skills_matcher.js
// Simple test runner for scoreSkills() using fixture CVs.
// Run: node test/test_skills_matcher.js

const fs = require('fs');
const path = require('path');
const {scoreSkills} = require('../src/pipeline/skills');

// Job requirements (from examples/job-ad.txt)
const requiredSkills = [
    'AWS',
    'javascript',
    'cloudformation',
    'terraform',
    'docker',
    'react',
    'vue',
];

console.log('Testing scoreSkills() with fixture CVs\n');
console.log(`Required skills: ${requiredSkills.join(', ')}\n`);
console.log('---\n');

// Test each fixture
const fixtures = [
    {name: 'Strong Match', file: 'cv_strong_match.txt', expectScore: 0.8},
    {name: 'Partial Match', file: 'cv_partial_match.txt', expectScore: 0.4},
    {name: 'Poor Match', file: 'cv_poor_match.txt', expectScore: 0.1},
];

for (const fixture of fixtures) {
    const filePath = path.join(__dirname, 'fixtures', fixture.file);
    const cvText = fs.readFileSync(filePath, 'utf8');

    const result = scoreSkills(cvText, requiredSkills);

    console.log(`📄 ${fixture.name}`);
    console.log(`   Matched: ${result.matched.join(', ') || '(none)'}`);
    console.log(`   Missing: ${result.missing.join(', ') || '(none)'}`);
    console.log(
        `   Score:   ${(result.score * 100).toFixed(0)}% (expected ~${(fixture.expectScore * 100).toFixed(0)}%)`,
    );

    if (Math.abs(result.score - fixture.expectScore) > 0.2) {
        console.log(`   ⚠️  UNEXPECTED — check the logic above`);
    }
    console.log('');
}

console.log('---\n');
console.log(
    'Run this as you update scoreSkills() to see if your changes work correctly.',
);
