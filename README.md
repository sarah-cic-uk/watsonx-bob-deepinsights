# DeepInsights — AI Recruiting Agent

## The problem

We have four Monday.com boards (TSC, FN, Looming Bench, Pipe) containing hundreds of candidates. Finding the right person for an open seat means:

1. Manually trawling all four boards for candidates in the right location, at the right band, with the right clearance
2. Opening each match and reading through all the comments to check whether someone else has already claimed them, or whether they have travel restrictions (e.g. "will not travel out of Cheltenham")
3. Tracking down their CV in Box, downloading it, and reading it to check their skills actually match
4. Manually commenting on their Monday card to request an interview

This is slow, repetitive, and easy to get wrong. DeepInsights automates the whole pipeline.

---

## What it does

You paste in a job advert (or describe the open seat). The agent does the rest:

1. **Scrapes the four Monday boards** — TSC, FN, Looming Bench, Pipe
2. **Filters candidates** by base location, band level, and security clearance
3. **Reads each candidate's comments** to skip anyone already claimed or with blocking travel restrictions
4. **Downloads their CV from Box** and extracts the full text
5. **Matches CV skills against the job description** to confirm a genuine fit
6. **Comments on their Monday card** to request an interview, tagging the right people — e.g. `{Business Unit} interested to interview @ Brad @ Sian`
7. **Adds matched candidates to your own team Monday board** so you can track their progress independently

---

## Nice to haves (future)

- **Availability notifications** — if a candidate comments back with availability, surface that to you automatically
- **Band-grade inference** — score the CV to suggest which band level it maps to, so you make the right salary offer from the start

---

## Architecture

```
Job advert (examples/job-ad.txt)
       │
       ▼
┌──────────────────────┐
│  Job ad parser        │  → role / band / level / location / skills criteria
│  (job-parser.js)      │
└────────┬─────────────┘
         │  criteria
         ▼
┌──────────────────────┐
│  Monday board scraper │  ◄── source boards (TSC, FN, Looming Bench, Pipe, …)
│  (candidate-matcher   │       filters: role / band / level / location
│   + monday.js)        │
└────────┬─────────────┘
         │  candidate shortlist
         ▼
┌──────────────────────┐
│  Box CV + skills      │  ◄── IBM Box (ibm.ent.box.com)
│  (box_scraper.js +    │       downloads PDFs, extracts text, scores skills
│   cv-skills-matcher)  │
└────────┬─────────────┘
         │  confirmed matches
         ▼
┌──────────────────────┐
│  Monday commenter     │  posts interview request, tags people per board
│  (interview-commenter)│
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│  Tracking-board writer│  adds each match to your team tracking board
│  (tracking-writer.js) │
└──────────────────────┘

  Orchestrated end to end by main.js — dry-run by default, --post to write.
```

---

## Current state

The full pipeline runs end to end. Component status:

| Component | Status |
|---|---|
| Monday.com GraphQL client | Working — reads boards, items, comments |
| Job ad parser | Working — `job-parser.js` turns a job ad into match criteria + skills |
| Box CV scraper | Working — authenticates via IBM SSO, downloads PDFs, extracts text |
| Skills matching | Working — `cv-skills-matcher.js` scores CVs against required skills |
| Monday commenter | Working — `interview-commenter.js` drafts/posts interview requests with real @mentions, tagging people per board (dry-run by default) |
| Tracking-board writer | Working — `tracking-writer.js` adds each match to the tracking board with a summary note (dry-run by default) |
| End-to-end agent orchestration | Working — `main.js` runs the full pipeline (parse → find → CV/skills → comment → tracking board); dry-run by default, `--post` to write, `--skip-cv` to skip Box |

See [Monday_scraper_prompt.md](docs/prompts/Monday_scraper_prompt.md) and [box_scraper_prompt.md](docs/prompts/box_scraper_prompt.md) for the proof-of-concept implementation details.

---

## Setup

## Data contract

**Frozen 20 Jul.** The candidate object that flows through the pipeline has this shape. Don't rename or remove fields without posting in the team channel first. Adding new fields is always fine.

```js
{
  boardId:   "10036665903",       // string — Monday board ID
  boardName: "TSC",               // string — friendly name
  itemId:    "1234567890",        // string — Monday item ID
  name:      "Jane Doe",          // string — candidate name
  role:      "Software Engineer", // string — raw board text
  band:      "7A",                // string — raw board text
  level:     "L2",                // string — raw board text
  location:  "London",            // string — raw board text
  cvLink:    "https://ibm.ent.box.com/file/…",  // string, "" if no CV
  comments:  [                    // array of Monday updates (max 10)
    { id: "111", body: "<p>text</p>", creator: { name: "…", email: "…" } }
  ]
}
```

Produced by: `findCandidates()` in `candidate-matcher.js`  
Consumed by: `filterBySkills()` in `cv-skills-matcher.js`, the Monday commenter (`interview-commenter.js`), and the tracking-board writer (`tracking-writer.js`)

---

### Prerequisites

- Node.js 18+
- Access to IBM Monday.com and IBM Box (w3id SSO)

### Monday API token

1. In Monday.com: avatar → **Developers** → **My Access Tokens** → copy
2. Save it (one line, no quotes) to:
   ```
   .monday-token
   ```
   Or export as `MONDAY_API_TOKEN` in your environment.

### Verify connections

```bash
# Test Monday connection
node monday.js

# Test Box scraper (requires Playwright MCP)
# See docs/prompts/box_scraper_prompt.md for full setup
```

---

## The four Monday boards

| Board | Description |
|---|---|
| **TSC** | Technical and specialist consultants |
| **FN** | FutureNow external hires |
| **Looming Bench** | People rolling off projects soon |
| **Pipe** | Pipeline — candidates in process |


## Configuration

All board and tagging config lives in [`boards.config.js`](boards.config.js):

| Key | What it does |
|---|---|
| `sourceBoardIds` | Array of Monday board IDs to scan for candidates. Add as many as you like. |
| `trackingBoardId` | Board that confirmed matches are written to. |
| `businessUnit` | Single word that leads every comment (e.g. `"MTech interested to interview …"`). Change it so another team can reuse the bot. |
| `tagUsersByBoard` | Per-board map of who to @mention on that board's cards — unlimited people per board. Use Monday **user IDs or emails** (plain names only resolve reliably on small accounts). |
| `defaultTagUsers` | Fallback taggers for any board not listed in `tagUsersByBoard`. |
| `skillThreshold` | Minimum fraction (0.0–1.0) of the job's required skills a CV must contain to be shortlisted. e.g. `0.7` = at least 70%. |

**New here?** Run the setup wizard instead of editing the file by hand — it captures all
of the above (and your Monday token, which it verifies live):

```bash
npm run setup     # or: node setup.js
```


## Commands

**Run the whole pipeline** (dry-run — previews everything, writes nothing):

```bash
node main.js 'examples/job-ad.txt'
```

Post for real (comments + tracking board):

```bash
node main.js 'examples/job-ad.txt' --post
```

Skip the Box/CV step (preview without Box setup; skills NOT verified):

```bash
node main.js 'examples/job-ad.txt' --skip-cv
```

**Run or test individual stages:**

```bash
node monday.js                                    # verify Monday connection + list boards
node job-parser.js 'examples/job-ad.txt'                   # inspect parsed criteria
node candidate-matcher.js engineer 7 L2 London    # board matching only (no Box)
node box_scraper.js 'https://ibm.ent.box.com/file/2222222222'  # test a single CV fetch
node seed-dummy-board.js --workspace=<id>         # create a dummy test board
npm test                                          # run the test suites
```
