// boards.config.js — edit this file to add, remove, or rename boards.
// Board IDs come from the Monday.com URL: .../boards/{id}

module.exports = {
  // These four boards are scraped for candidate matches.
  // The agent reads items and comments from all of them.
  sourceBoardIds: [
    '10036665903', // TSC
    '10029661282', // FN
    '18397572611', // Looming Bench
    '10059728570', // Pipe
  ],

  // New candidate entries (confirmed matches) are written to this board.
  trackingBoardId: '18419952794',
};
