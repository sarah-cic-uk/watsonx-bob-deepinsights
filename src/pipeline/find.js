'use strict';

// candidate-matcher.js
// Step 1 of the pipeline: scan all source Monday boards and return candidates
// that match the given job criteria. Each match includes the CV link for step 2.

const { getCandidateBoardItems } = require('../integrations/monday');

// ---------------------------------------------------------------------------
// Column lookup helpers
// ---------------------------------------------------------------------------

function norm(str) {
  return (str || '').toLowerCase().trim();
}

/**
 * Find the text value of the first column whose title contains `titleKeyword`.
 * Falls back through `fallbacks` if the primary keyword finds nothing.
 */
function getColumnValue(columns, columnValues, titleKeyword, ...fallbacks) {
  const keywords = [titleKeyword, ...fallbacks];
  for (const kw of keywords) {
    const col = columns.find(c => norm(c.title).includes(norm(kw)));
    if (col) {
      const val = columnValues.find(v => v.id === col.id);
      if (val?.text) return val.text;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Match predicates
// ---------------------------------------------------------------------------

/**
 * Role type: any keyword is found anywhere in the candidate's role column (case-insensitive).
 */
function matchesRole(text, keywords) {
  const haystack = norm(text);
  return keywords.some(kw => haystack.includes(norm(kw)));
}

/**
 * Band: strip trailing letters from the candidate's value, compare numeric part only.
 * e.g. criteria band '7' matches candidate values '7', '7A', '7B'.
 */
function matchesBand(text, bands) {
  const candidateNum = norm(text).replace(/[a-z]+$/, '').trim();
  return bands.some(b => candidateNum === norm(String(b)).replace(/[a-z]+$/, '').trim());
}

/**
 * Expected level: the candidate's field must contain the requested level string anywhere.
 * e.g. criteria level 'L2' matches 'L2', 'Band L2', 'Grade L2 Engineer'.
 */
function matchesLevel(text, levels) {
  const haystack = norm(text);
  return levels.some(l => haystack.includes(norm(l)));
}

/**
 * Location: the candidate's field must contain one of the requested locations.
 */
function matchesLocation(text, locations) {
  const haystack = norm(text);
  return locations.some(loc => haystack.includes(norm(loc)));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Scan all source boards and return candidates matching the given criteria.
 *
 * @param {object} criteria
 * @param {string[]} criteria.roleKeywords  Keywords to match against the role type column (OR logic)
 * @param {string[]} criteria.bands         Band numbers to match (letter suffix ignored), e.g. ['7']
 * @param {string[]} criteria.levels        Level strings to find anywhere in the level column, e.g. ['L2']
 * @param {string[]} criteria.locations     Locations to match, e.g. ['London', 'Hursley']
 *
 * @returns {Promise<Array>} Matched candidates, each with:
 *   boardId, boardName, itemId, name, role, band, level, location, cvLink, comments
 */
async function findCandidates(criteria) {
  const { roleKeywords = [], bands = [], levels = [], locations = [] } = criteria;

  if (!roleKeywords.length && !bands.length && !levels.length && !locations.length) {
    throw new Error('findCandidates: at least one criteria field must be non-empty');
  }

  const boards = await getCandidateBoardItems();
  const matches = [];

  for (const { boardId, boardName, columns, items } of boards) {
    // Show which columns were resolved for this board (helps diagnose name mismatches)
    const colNames = columns.map(c => c.title);
    const roleCol  = columns.find(c => norm(c.title).includes('role'))?.title  ?? '(not found)';
    const bandCol  = columns.find(c => norm(c.title).includes('band'))?.title  ?? '(not found)';
    const levelCol = columns.find(c => norm(c.title).includes('level') || norm(c.title).includes('grade'))?.title ?? '(not found)';
    const locCol   = columns.find(c => norm(c.title).includes('location'))?.title ?? '(not found)';
    const cvCol    = columns.find(c => norm(c.title).includes('cv') || norm(c.title).includes('box') || norm(c.title).includes('resume'))?.title ?? '(not found)';

    console.log(`\n[${boardName}] ${items.length} items — columns mapped:`);
    console.log(`  role→"${roleCol}"  band→"${bandCol}"  level→"${levelCol}"  location→"${locCol}"  cv→"${cvCol}"`);

    let boardMatches = 0;
    const failReasons = { role: 0, band: 0, level: 0, location: 0 };

    for (const item of items) {
      const cv = item.column_values;

      const roleText  = getColumnValue(columns, cv, 'role');
      const bandText  = getColumnValue(columns, cv, 'band');
      const levelText = getColumnValue(columns, cv, 'level', 'grade');
      const locText   = getColumnValue(columns, cv, 'location');
      const cvLink    = getColumnValue(columns, cv, 'cv', 'box', 'resume');

      const roleMatch  = !roleKeywords.length || matchesRole(roleText, roleKeywords);
      const bandMatch  = !bands.length        || matchesBand(bandText, bands);
      const levelMatch = !levels.length       || matchesLevel(levelText, levels);
      const locMatch   = !locations.length    || matchesLocation(locText, locations);

      if (!roleMatch)  failReasons.role++;
      if (!bandMatch)  failReasons.band++;
      if (!levelMatch) failReasons.level++;
      if (!locMatch)   failReasons.location++;

      if (roleMatch && bandMatch && levelMatch && locMatch) {
        boardMatches++;
        matches.push({
          boardId,
          boardName,
          itemId:   item.id,
          name:     item.name,
          role:     roleText,
          band:     bandText,
          level:    levelText,
          location: locText,
          cvLink,
          comments: item.updates || [],
        });
      }
    }

    console.log(`  → ${boardMatches} match(es). Filtered out: role(${failReasons.role}) band(${failReasons.band}) level(${failReasons.level}) location(${failReasons.location})`);
  }

  console.log('');
  return matches;
}

module.exports = { findCandidates };

// When run directly: quick smoke-test with broad criteria so you can see what comes back.
// Usage: node candidate-matcher.js [roleKeyword] [band] [level] [location]
// Example: node candidate-matcher.js engineer 7 L2 London
if (require.main === module) {
  const [, , roleKw = 'engineer', band = '7', level = 'L2', location = 'London'] = process.argv;
  const criteria = {
    roleKeywords: [roleKw],
    bands: [band],
    levels: [level],
    locations: [location],
  };
  console.log('Searching with criteria:', criteria);
  findCandidates(criteria)
    .then(results => {
      console.log(`\n${results.length} match(es) found:\n`);
      for (const c of results) {
        console.log(`  [${c.boardName}] ${c.name}`);
        console.log(`    Role: ${c.role}  Band: ${c.band}  Level: ${c.level}  Location: ${c.location}`);
        console.log(`    CV:   ${c.cvLink || '(no link)'}`);
        console.log(`    Comments: ${c.comments.length}`);
      }
    })
    .catch(err => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}
