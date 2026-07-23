# DeepInsights — Demo Recording Script

**Target length:** ~2 min 30 sec · **Format:** narrated screen recording (terminal + Monday.com)
**Presenters:** works solo, or split the `[A]` / `[B]` lines between two speakers.

> **DeepInsights** is the recruiting agent we built. **Bob** and **Claude** are the two AI
> assistants we used to *build* it — the challenge is about using them to reduce friction,
> and for us that meant using both to design, write, and orchestrate the app.

> Numbers in **[brackets]** are placeholders — swap in your team's real figures before recording.
> Practice once end-to-end so the narration lands as each terminal step appears.

---

## Before you hit record — set the stage

- [ ] Terminal open in `watsonx-bob-deepinsights/`, font size bumped up so it's readable.
- [ ] A **job ad** open on screen (`examples/job-ad.txt`) — the Senior Software Engineer / Band 7 / L2 / London one.
- [ ] Monday.com open in a browser tab, on the **dummy source board** and the **tracking board** (so you can flip to them at the end).
- [ ] Have the command ready to paste: `node main.js 'examples/job-ad.txt'`
- [ ] Optional: a second tab pre-run with `--post` already executed, so the posted comment + tracking item are visible instantly when you switch (avoids waiting live).

---

## THE SCRIPT

### 0:00 — Hook / the problem  *(~25 sec)*

> **[SCREEN: the job ad on screen, or a Monday board with lots of candidate cards]**

**[A]** "Every time a seat opens up on one of our teams, the same slow job begins. A recruiter has to trawl **four separate Monday boards** — TSC, FutureNow, the Looming Bench, and the Pipe — hunting for people at the right band, level, location and clearance.

Then, for every possible match, they open the card, read every comment to check nobody's already claimed that person or that they'll actually travel, dig their CV out of Box, download it, read it to confirm the skills line up — and only then comment to request an interview.

For a single role that's **[2 to 4 hours]** of repetitive, error-prone work. So we built an agent — **DeepInsights** — to do all of it."

---

### 0:25 — What DeepInsights is, and how we built it  *(~20 sec)*

> **[SCREEN: the repo / README title, or just the terminal ready to run]**

**[B]** "DeepInsights is an AI recruiting agent. You give it a job advert, and it runs the entire pipeline end to end.

And here's the part the challenge is really about: we didn't hand-code this the hard way. We built DeepInsights using **two AI assistants — Bob and Claude** — to design the workflow, write the code, and wire up Monday and Box. Let me show you a real run."

---

### 0:45 — Live demo: kick it off  *(~15 sec)*

> **[SCREEN: terminal — type/paste the command and run it]**

```bash
node main.js 'examples/job-ad.txt'
```

**[A]** "One command, one job ad. And notice — it runs in **dry-run by default**, so it previews every action and writes nothing until we explicitly approve. Watch the five stages."

---

### 1:00 — Narrate the five stages as they scroll  *(~50 sec)*

> **[SCREEN: terminal output, stepping through Steps 1–5]**

**[B] — Step 1, Parse:** "First, it reads the advert and pulls out the criteria itself — role keywords, band, level, location, and the required skills. No form-filling."

**[A] — Step 2, Find:** "Then it scans all the source boards at once and filters to the real matches — and crucially, it **reads the comments on each card**, so it automatically skips anyone already claimed by another recruiter or flagged as unable to travel."

**[B] — Step 3, CVs:** "For each survivor, it logs into **Box**, downloads their actual CV, extracts the text, and scores it against the required skills — only candidates clearing the bar move on. So it's not just matching a job title; it's confirming the person can really do the job."

**[A] — Step 4, Interview request:** "For every confirmed match it drafts the interview-request comment — tagged to the right people for that board — ready to post."

**[B] — Step 5, Tracking:** "And it adds each match to our own tracking board so we can follow them independently. It finishes with a summary — and the reminder that in dry-run, nothing was written."

---

### 1:50 — The human-in-the-loop / go live  *(~20 sec)*

> **[SCREEN: switch to the pre-run `--post` terminal, then flip to Monday.com]**

**[A]** "Once we're happy, we re-run with `--post`."

> **[SCREEN: Monday.com — the candidate card with the posted comment + tagged users]**

**[A]** "Here on the candidate's Monday card is the interview request it posted, tagging the right people automatically."

> **[SCREEN: Monday.com — the tracking board with the new items]**

**[B]** "And here's our tracking board, populated with the matched shortlist — each with a summary of why they fit. DeepInsights just did in **[under two minutes]** what took a recruiter **[half a day]**."

---

### 2:10 — How Bob & Claude were used to build it  *(~15 sec)*

> **[SCREEN: back to the terminal / the codebase, or a simple flow diagram]**

**[B]** "So how did Bob and Claude fit in? We used both as our **AI build partners**. They helped us design the five-stage pipeline, write the code for each stage, and solve the tricky parts — like orchestrating the browser automation that pulls CVs out of Box, and getting the Monday tagging right. Two AI assistants took this from idea to a working agent far faster than we could have alone."

---

### 2:25 — Impact & roadmap close  *(~15 sec)*

> **[SCREEN: a simple impact stat, or the summary output]**

**[A]** "The impact: what was **[2–4 hours]** of manual trawling per role becomes a couple of minutes — across **[N]** roles a month that's roughly **[X hours]** of recruiter time given back, with fewer missed candidates and no double-claims.

Next, we want DeepInsights to surface candidate availability automatically and suggest the right band-grade from the CV. That's DeepInsights — built with Bob and Claude, keeping the Growth Enablers moving."

---

## Cheat sheet — commands used on screen

```bash
node main.js 'examples/job-ad.txt'          # the live demo — full pipeline, DRY-RUN (writes nothing)
node main.js 'examples/job-ad.txt' --post   # the "go live" step — posts the comment + tracking item
```

## Talking-point reminders (if you go off-script)

- **The framing:** *DeepInsights* is the agent; *Bob* and *Claude* are the two AI assistants we built it with.
- **Safety first:** dry-run by default; nothing is written without `--post`. Human stays in control.
- **The differentiator:** DeepInsights reads *comments* (skips claimed / travel-restricted people) and reads the *actual CV* — not just title-matching.
- **Four boards → one command.** No manual trawling, no switching systems.
- **Fits the challenge:** measurable time saved, fewer manual steps, faster access to the right people — and AI assistants (Bob + Claude) used to get there.
