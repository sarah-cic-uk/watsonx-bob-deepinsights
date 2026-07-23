# DeepInsights — AI Recruiting Agent

DeepInsights automates internal candidate sourcing on Monday.com. Give it a job advert and
it scans your candidate boards, checks CVs against the required skills, and posts interview
requests to the right people — turning hours of manual board-trawling into one reviewed command.

It was built inside IBM (Monday IBM tenant + Box via w3id SSO), but it's **board- and
team-agnostic**: point it at your own boards and people through one config file (or the
setup wizard) and it's yours.

> **Safety first.** Every run is a **dry-run by default** — it prints exactly what it *would*
> post and writes nothing until you explicitly add `--post`.

---

## What it does

Given a job advert (a small text file), the pipeline:

1. **Parses** the advert into match criteria — role, band, level/clearance, location — plus required skills.
2. **Scans your Monday boards** and filters candidates on role / band / level / location.
3. **Downloads each candidate's CV from Box** and scores it against the required skills.
4. **Posts an interview request** on each matching card, @mentioning the right people (configurable per board) so they get notified.
5. **Logs each match to your tracking board** with a summary note.

Steps 4–5 only write when you pass `--post`; otherwise you get a full preview and nothing is touched.

---

## Quick start — adopting it for your team

```bash
git clone <repo-url> && cd watsonx-bob-deepinsights
npm install            # only needed for the CV/Box step — skip if you'll use --skip-cv

npm run setup          # interactive wizard: business unit, boards, per-board taggers,
                       # tracking board, skill threshold, and Monday token (verified live).
                       # Writes boards.config.js + .monday-token, then runs the health check.

npm run doctor         # read-only health check — re-run any time

# Preview against your boards — writes NOTHING:
node src/index.js 'examples/job-ad.txt' --skip-cv    # quick preview, no Box needed
node src/index.js 'examples/job-ad.txt'              # full preview incl. CV/skills (needs Box)

# Happy with the preview? Go live:
node src/index.js 'examples/job-ad.txt' --post
```

The whole loop is: **setup → doctor → preview → `--post`**.

---

## Dashboard (web UI)

Prefer a UI to the terminal? Launch the local dashboard:

```bash
npm run ui        # → http://127.0.0.1:4517
```

Either **paste a job advert** or **fill in the fields** (Role / Band / Level / Location /
Skills), hit **Find candidates**, and watch the live progress; you get a preview table of
everyone matched, each name linking straight to their Monday card. From there you can
**Download CSV** (a Monday-like export to use externally) or **Request interviews on Monday**
(posts the comments + logs to your tracking board — behind a confirmation, since it writes to
real cards). A **⚙ Settings** modal edits your boards, business unit, taggers and threshold,
saving straight to `boards.config.js`.

- Runs **locally only** (`127.0.0.1`) — it can post to Monday and edit config, so it's never network-exposed.
- The preview is **read-only**; nothing is written until you click *Request interviews* and confirm.
- CV/skills verification is an optional toggle (uses Box; off by default so previews stay fast). If the
  Box tooling isn't installed, it falls back to the board matches instead of failing.
- **Verbose** (in Settings, off by default) shows the step-by-step log and keeps it on screen after each run.
- Uses your existing `.monday-token` — set it up first with `npm run setup`.

---

## Requirements

- **Node.js 18+** (uses the built-in `fetch`).
- A **Monday.com API token** — avatar → **Developers** → **My Access Tokens**. Your account
  needs write access to post comments / create items; `npm run doctor` checks your role.
- **For the CV/skills step only:** `npm install` (Playwright + PDF tooling) and access to
  **IBM Box** via w3id SSO. Everything else runs with zero dependencies — use `--skip-cv` to
  skip Box entirely.

---

## The job advert

A plain `key: value` text file (see [examples/job-ad.txt](examples/job-ad.txt)):

```
Role: Senior Software Engineer
Band: 7
Level: L2
Location: London
Skills: AWS, JavaScript, Docker, React
```

Levels are matched generously (asking for `L2` also accepts `L3`); band letter suffixes are
ignored (`7` matches `7A`); role becomes keywords with common seniority words stripped.

---

## Configuration

All configuration lives in [`boards.config.js`](boards.config.js). Run `npm run setup` to
generate it interactively, or edit it by hand:

| Key | What it does |
|---|---|
| `sourceBoardIds` | Monday board IDs to scan for candidates — as many as you like. |
| `trackingBoardId` | Board that confirmed matches are logged to. |
| `businessUnit` | Word that leads every comment (e.g. `"MTech interested to interview …"`) — set it to your team. |
| `tagUsersByBoard` | Per-board map of who to @mention on that board's cards. Use Monday **user IDs or emails** (plain names don't resolve reliably in a large account). |
| `defaultTagUsers` | Fallback taggers for any board not listed above. |
| `skillThreshold` | Fraction of the job's required skills a CV must contain to be shortlisted (e.g. `0.7` = 70%). |

`boards.config.js` and `.monday-token` are gitignored — your config and secret are never committed.

---

## How it works

```
Job advert (examples/job-ad.txt)
       │
       ▼
┌──────────────────────┐
│  Job ad parser        │  src/pipeline/parse.js — role / band / level / location / skills
└────────┬─────────────┘
         │  criteria
         ▼
┌──────────────────────┐
│  Monday board scraper │  src/pipeline/find.js (+ integrations/monday.js)
│                       │  scans your boards; filters role / band / level / location
└────────┬─────────────┘
         │  candidate shortlist
         ▼
┌──────────────────────┐
│  Box CV + skills      │  src/pipeline/skills.js (+ integrations/box.js)
│                       │  IBM Box: downloads PDFs, extracts text, scores skills
└────────┬─────────────┘
         │  confirmed matches
         ▼
┌──────────────────────┐
│  Monday commenter     │  src/pipeline/comment.js — interview request, @mentions per board
└────────┬─────────────┘
         │
         ▼
┌──────────────────────┐
│  Tracking-board writer│  src/pipeline/track.js — logs each match to your board
└──────────────────────┘

  Orchestrated by src/index.js — dry-run by default, --post to write, --skip-cv to skip Box.
```

Each stage is an independent module that reads and writes a shared candidate object (the
[data contract](#data-contract)), so stages can be tested or swapped in isolation.

---

## Usage

```bash
node src/index.js '<job-ad>'            # full pipeline, DRY-RUN (writes nothing)
node src/index.js '<job-ad>' --post     # post comments + log matches for real
node src/index.js '<job-ad>' --skip-cv  # skip the Box/CV step (skills NOT verified)
```

Individual stages / tools (handy for debugging):

```bash
npm run doctor                                        # read-only health check (see below)
node src/integrations/monday.js                       # verify Monday connection + list boards
node src/pipeline/parse.js '<job-ad>'                 # inspect parsed criteria
node src/pipeline/find.js engineer 7 L2 London        # board matching only (no Box)
node src/integrations/box.js '<box-file-url>'         # test a single CV fetch
node scripts/seed-dummy-board.js --workspace=<id>     # create a safe dummy board to test against
npm test                                              # run the unit tests (offline)
```

---

## Troubleshooting

**Run `npm run doctor` first.** It's read-only (changes nothing) and diagnoses the usual issues:

- **Permissions** — it reviews `error.log` from previous runs (permission failures highlighted
  first) and checks your Monday account role. If a live run couldn't post, this is where you'll see why.
- **"No candidates matched"** — doctor confirms each board is visible to your token *and* that its
  column titles match what the matcher looks for (`role` / `band` / `level` / `location` / `cv`).
  Mismatched column names are the most common cause.
- **Tag users don't get notified** — doctor resolves every configured tagger; use IDs or emails, not names.
- **Box login** — the first CV run opens a browser for w3id login + 2FA; the session is cached for next time.

Failed live runs append to `error.log` (gitignored). Delete it yourself to reset — nothing else writes to it.

---

## Project structure

```
src/
  index.js            orchestrator — the entry point
  pipeline/           parse.js → find.js → skills.js → comment.js → track.js
  integrations/       monday.js (GraphQL client), box.js (Box CV scraper)
  lib/                shared helpers (error logging)
  ui/                 local web dashboard — server.js + public/ (npm run ui)
scripts/              setup.js, doctor.js, seed-dummy-board.js, inspect-boards.js
test/                 unit tests + fixtures  (npm test)
examples/             sample job advert
docs/                 TESTING_GUIDE, ROADMAP, DEMO_SCRIPT, prompts/
boards.config.js      your config (gitignored)   .monday-token  your token (gitignored)
```

---

## Development

- `npm test` runs the unit suites offline — no Monday token or network needed (the client is stubbed).
- Pipeline stages are pure modules under `src/pipeline/`; `src/index.js` is the only orchestrator.
- `scripts/seed-dummy-board.js` stands up a representative dummy board (matching + non-matching
  candidates, plus scenario comments) so you can exercise the full pipeline against real Monday
  without touching production data.
- See [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) for a full manual test walkthrough, and
  [docs/prompts/](docs/prompts/) for the original Monday/Box proof-of-concept notes.

### Data contract

The candidate object passed between every stage. It's a stable contract — add fields freely,
but coordinate before renaming or removing one.

```js
{
  boardId:   "10036665903",       // string — Monday board ID
  boardName: "TSC",               // string — friendly name
  itemId:    "1234567890",        // string — Monday item ID
  itemUrl:   "https://ibm.monday.com/boards/…/pulses/1234567890",  // string — deep link to the card
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

Produced by `findCandidates()` in `src/pipeline/find.js`; consumed by `filterBySkills()`
(`src/pipeline/skills.js`), the commenter (`src/pipeline/comment.js`), and the tracking-board
writer (`src/pipeline/track.js`).

---

## Not yet built

- **Comment-aware filtering** — skipping candidates already claimed by another recruiter or with
  travel restrictions. Their comments are already fetched into the data contract, but aren't yet
  used to filter. (The dummy board seeds test cases for this.)
- **Availability notifications** and **band-grade inference** — see [docs/ROADMAP.md](docs/ROADMAP.md).

The longer-term roadmap is still open — see [docs/ROADMAP.md](docs/ROADMAP.md).
