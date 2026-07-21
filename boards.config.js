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

  // Business unit name that leads the comment, e.g.
  //   "watsonx interested to interview Jane Doe for Senior Software Engineer ..."
  businessUnit: 'watsonx',

  // People to tag (notify) on each interview-request comment.
  // Entries may be either a person's display name (resolved to their Monday user
  // ID at runtime) or a numeric user ID directly (more reliable — no ambiguity).
  tagUsers: ['53435570'], // TESTING: jackwadsted (own account) — prod: ['Brad', 'Sian']
};
