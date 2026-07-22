# DeepInsights — Manual Testing Guide

A step-by-step guide for manually testing the DeepInsights recruiting agent end to end.
No prior knowledge of the code is assumed — follow the sections in order.

The app scans Monday.com boards for candidates matching a job ad, checks their CVs
against required skills, comments an interview request on each match, and adds the
matches to a tracking board.

> **The single most important safety fact:** every stage that writes to Monday is
> **dry-run by default**. Nothing is posted or created unless you add the `--post`
> flag. You can run almost everything in this guide safely without touching real data.

---

## 1. Before you start — prerequisites

You need:

| Requirement | How to check |
|---|---|
| **Node.js 18 or newer** | `node --version` |
| **A Monday.com API token** | See step 2 below |
| **(Optional) Access to IBM Box via w3id SSO** | Only needed for the CV/skills stage (§7) |

Install dependencies once, from the project root (`watsonx-bob-deepinsights/`):

```bash
npm install
```

If you plan to test the Box CV stage, also install the Playwright browser:

```bash
npx playwright install chromium
```

---

## 2. Set up your Monday API token

The token is read from either an environment variable or a file — either works.

**Option A — file (simplest):** create a file named `.monday-token` in the project
root containing only the token on one line (no quotes, no spaces).

**Option B — environment variable:**

```bash
export MONDAY_API_TOKEN='your-token-here'
```

**Where to get the token:** in Monday.com, click your avatar → **Developers** →
**My Access Tokens** → copy. For the write tests (seeding, `--post`) the token must
belong to an account with **write access**.

> `.monday-token` is gitignored and will never be committed.

---

## 3. Smoke test: verify the Monday connection

This is the fastest way to confirm your token works before doing anything else.

```bash
node monday.js
```

**Expected result:** it prints `✓ Connected to Monday.com`, your user name/email, your
account, and a list of every board visible to your token.

**If it fails:** you'll see `✗` and a message. The most common cause is a missing or
invalid token — recheck step 2.

---

## 4. Seed a safe dummy board (recommended first step)

Rather than test against real candidate boards, create throwaway dummy boards. This
gives you a predictable set of candidates whose expected match/skip outcome is known.

```bash
# Into a workspace you own (enterprise accounts often block the main workspace):
node seed-dummy-board.js --workspace=<your-workspace-id>

# Or, if your account allows it, just:
node seed-dummy-board.js
```

**What it creates:**
- A **source board** ("DeepInsights — Source (dummy)") with 7 candidates
- A **tracking board** ("DeepInsights — My Shortlist (dummy)")

The 7 seeded candidates are tuned to the sample `job ad.txt` (Senior Software Engineer /
Band 7 / L2 / London). Their expected outcomes:

| Candidate | Expected | Why |
|---|---|---|
| Jane Doe | ✅ MATCH | meets all criteria (has an "available soon" comment) |
| Ravi Patel | ✅ MATCH | Band 7, L3 (overqualified is fine) |
| Sam Taken | ✅ MATCH on board | but has a "claimed by another recruiter" comment |
| Tom Bench | ❌ skip | band 6 ≠ 7 |
| Alex Green | ❌ skip | level L1 too junior |
| Sara Hill | ❌ skip | wrong location (Cheltenham) + travel restriction |
| Priya Shah | ❌ skip | role has no software/engineer keyword |

**After it runs**, it prints the two new board IDs. Paste them into
[`boards.config.js`](boards.config.js):

```js
sourceBoardIds: ['<printed-source-board-id>'],
trackingBoardId: '<printed-tracking-board-id>',
```

Then update `tagUsersByBoard` in the same file so the source board ID maps to a real
user (your own numeric Monday user ID or email is fine for testing):

```js
tagUsersByBoard: {
  '<printed-source-board-id>': ['<your-user-id-or-email>'],
},
```

> **Note:** the repo already ships pointing at a pre-seeded dummy board. If that board
> still exists in your account you can skip seeding and go straight to §5. If not,
> seed your own.

---

## 5. Test each stage individually

Each stage can be run on its own. These are all **read-only or dry-run** — safe to run
repeatedly.

### 5a. Job ad parser

```bash
node job-parser.js 'job ad.txt'
```

**Expected:** prints parsed JSON — `roleKeywords`, `bands`, `levels` (note L2 expands to
`["L2","L3"]`), `locations`, and `skills`.

**Try tweaking** `job ad.txt` (change the band or add a skill) and re-run to see the
criteria change.

### 5b. Candidate matcher (board filtering only, no CVs)

```bash
node candidate-matcher.js engineer 7 L2 London
```

Arguments are `[roleKeyword] [band] [level] [location]`.

**Expected against the dummy board:** 3 matches (Jane, Ravi, Sam). The output also shows,
per board, which columns it mapped (`role→… band→… level→…`) and a breakdown of how many
candidates each filter rejected — useful for diagnosing a board whose column titles don't
match.

### 5c. Interview commenter (dry-run)

```bash
node interview-commenter.js 'job ad.txt'
```

**Expected:** for each shortlisted candidate it prints the exact comment it *would* post,
e.g. `MTech interested to interview Jane Doe for Senior Software Engineer @YourName`, plus
which users would be tagged. It writes **nothing**. This stage runs the CV step first, so
without CV links it will report candidates skipped at the skills step — that's expected
(see §7 to add CVs).

### 5d. Tracking-board writer

The tracking writer is exercised through the full pipeline (§6). It is also dry-run by
default and prints the item name + summary note it would create per candidate.

---

## 6. Test the full pipeline (dry-run)

This is the main end-to-end test. It runs all five stages in order.

```bash
node main.js 'job ad.txt'
```

**Expected output — five clearly-labelled steps:**

1. **Parse job ad** — the criteria
2. **Find candidates** — board matches (3 against the dummy board)
3. **Check CVs against skills** — will process CVs (or report none if no CV links)
4. **Interview-request comments** — the drafted comments
5. **Add matches to tracking board** — the tracking items it would create

It finishes with a **Summary** and the reminder: `DRY-RUN — nothing was written.`

### Skip the CV step

If you haven't set up Box, skip the CV/skills stage so the pipeline runs on board matches
alone:

```bash
node main.js 'job ad.txt' --skip-cv
```

**Expected:** step 3 prints a `⚠ --skip-cv` warning and treats all board matches as the
shortlist (skills **not** verified).

---

## 7. Test the CV / skills stage (requires Box)

This stage downloads real CVs from IBM Box, so it needs Box access and Playwright.

**Prep:** in your dummy source board, paste real Box CV URLs into the **"CV Link"**
column for the matching candidates (Jane / Ravi / Sam). Without a link, a candidate is
skipped at this stage.

```bash
node cv-skills-matcher.js 'job ad.txt'
```

**First run:** a browser window opens for IBM w3id login + 2FA. Complete it; the session
is saved to `.box_session.json` for future runs (no login needed next time).

**Expected:** for each candidate with a CV link, it downloads the CV, extracts the text,
and prints `MATCH` or `NO MATCH — missing: …`. The default threshold is 70% of required
skills. A final shortlist is printed with matched-skill percentages.

You can also test the scraper against a single Box file directly:

```bash
node box_scraper.js 'https://ibm.ent.box.com/file/<file-id>'
```

> Always quote Box URLs — the `?s=` share token contains `?`, which the shell would
> otherwise treat as a wildcard.

---

## 8. The real write test (`--post`) — do this deliberately

Once the dry-runs look correct, test that writes actually work. **This posts real
comments and creates real tracking items**, so do it against the **dummy** boards only.

```bash
node main.js 'job ad.txt' --post
```

**Expected:**
- **In the terminal:** `✓ posted (update …)` for each comment and `✓ created (item …)`
  for each tracking item; the summary shows `Comments posted: N/N` and `Tracked: N/N`.
- **In Monday.com — the dummy source board:** each matched candidate's card now has an
  interview-request comment that tags your configured user (check you got a notification).
- **In Monday.com — the dummy tracking board:** a new item per matched candidate, each
  with a summary note (source board, role/band/level/location, matched skills, CV link).

**Verify the tagging worked:** the tagged user should receive a Monday notification. If
the terminal warned `no Monday user with email …` or `nobody will be notified`, fix
`tagUsersByBoard` in [`boards.config.js`](boards.config.js) — prefer numeric user IDs or
emails over plain names (names only resolve reliably on small accounts).

> **Re-running `--post` posts again** — it does not deduplicate. Delete the test comments/
> items between runs, or just expect duplicates on the dummy board.

---

## 9. Run the automated tests

The repo ships unit tests for the skills matcher, commenter, and tracking writer. These
use fixtures and need **no** Monday token or network access.

```bash
npm test
```

**Expected:** all three suites run and report passing. This is a good final check that
nothing is broken before or after any changes.

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `No Monday.com API token found` | Token missing — see §2 |
| `Monday API GraphQL errors` | Token invalid, expired, or lacks permission for the operation |
| Board seeding fails with a workspace error | Enterprise accounts block the main workspace — pass `--workspace=<id>` for one you own |
| Candidate matcher finds 0 matches | Check the "columns mapped" output — the board's column titles may not contain `role`/`band`/`level`/`location`/`cv`. The seeded dummy board uses the right titles |
| Everyone skipped at the CV step | No CV links on the cards, or Box login/session issue — see §7 |
| `no Monday user with email …` / nobody tagged | Fix `tagUsersByBoard` in `boards.config.js`; use numeric IDs or emails |
| Box browser login loops | Delete `.box_session.json` and re-run to force a fresh login |

---

## Quick reference — all test commands

```bash
node monday.js                                    # 1. verify Monday connection
node seed-dummy-board.js --workspace=<id>         # 2. create safe dummy boards
node job-parser.js 'job ad.txt'                   # 3. inspect parsed criteria
node candidate-matcher.js engineer 7 L2 London    # 4. board matching only
node interview-commenter.js 'job ad.txt'          # 5. commenter (dry-run)
node cv-skills-matcher.js 'job ad.txt'            # 6. CV + skills (needs Box)
node main.js 'job ad.txt'                         # 7. full pipeline (dry-run)
node main.js 'job ad.txt' --skip-cv               #    full pipeline, no Box
node main.js 'job ad.txt' --post                  # 8. full pipeline, REAL writes
npm test                                          # 9. automated unit tests
```
