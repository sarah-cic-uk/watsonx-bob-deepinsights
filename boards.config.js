// boards.config.js — edit this file to add, remove, or rename boards.
// Board IDs come from the Monday.com URL: .../boards/{id}

module.exports = {
  // These four boards are scraped for candidate matches.
  // The agent reads items and comments from all of them.
  sourceBoardIds: [
    '18423031147', // DeepInsights — Source (dummy), MTech Dummy workspace — TESTING
    // --- real boards (restore for production) ---
    // '10036665903', // TSC
    // '10029661282', // FN
    // '18397572611', // Looming Bench
    // '10059728570', // Pipe
  ],

  // New candidate entries (confirmed matches) are written to this board.
  trackingBoardId: '18423031181', // DeepInsights — My Shortlist (dummy) — TESTING (prod: '18419952794')

  // --- Interview-request comment settings (used by interview-commenter.js) ---

  // Single business unit name that leads every comment, e.g.
  //   "MTech interested to interview Jane Doe for Senior Software Engineer ..."
  // Change this so another team can reuse the bot.
  businessUnit: 'MTech',

  // Who to tag (notify) on interview-request comments, PER BOARD.
  // Key   = board ID (string, matches an entry in sourceBoardIds).
  // Value = array of people to tag on that board's cards — unlimited per board.
  // Entries are Monday user IDs or emails (recommended — resolve reliably at any
  // account size); plain display names work only on small accounts.
  //
  // Example: board 12345 tags three people, board 67890 tags a different two.
  tagUsersByBoard: {
    '18423031147': ['53435570'], // dummy board — TESTING (jackwadsted)
    // '10036665903': ['id-a', 'id-b', 'id-c'], // TSC — three taggers
    // '10029661282': ['id-d', 'id-e'],         // FN  — two taggers
  },

  // Optional: users tagged on any board not listed in tagUsersByBoard above.
  // Leave as [] to tag nobody on unlisted boards.
  defaultTagUsers: [],
};
