# watsonx-bob-deepinsights

*Note: A lot of these docs are assumptions - exact features are NOT final and somewhat placeholder-y!*

An AI agent that finds the top 5 best-fit candidates for an open Monday.com seat and writes them to a shortlist board — ranking by CV, travel restrictions, and whether another recruiter has already selected them.

## Planned features

- Ask which Monday.com seat (open role) to recruit for.
- Score candidates on CV fit, travel restrictions, and whether they're already selected by another recruiter.
- Write the top 5 candidates to a separate shortlist board.

## Setup

1. **Requirements:** Node.js 18+ (uses built-in `fetch`).

2. **Get an API token:** in Monday.com, click your avatar → **Developers** → **My Access Tokens** → copy.

3. **Save the token** (only the token, one line) to a gitignored file:

   ```
   .monday-token
   ```

   Or set the `MONDAY_API_TOKEN` environment variable instead.

4. **Verify the connection** (prints your account + all visible boards):

   ```bash
   node monday.js
   ```

## Usage

```js
const { mondayQuery } = require('./monday');

const data = await mondayQuery(`query { me { name email } }`);
```

`monday.js` also exports `listAllBoards()`.

> **Note:** `api.monday.com/v2` is one shared endpoint for all customers; the token pins each request to the IBM account. Never use `ibm.monday.com` as an API URL.
