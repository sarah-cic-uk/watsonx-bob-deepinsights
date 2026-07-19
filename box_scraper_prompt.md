
# IBM Box CV Scraper — Agent Prompt

## Task
Navigate to a specified IBM Box folder, download all PDF CVs found there, extract their full text, and save the results to `cv_data.csv` and `cv_data.xlsx` in the workspace.

## Execution mode
**Run silently.** Do not narrate individual steps. Only output:
1. A single confirmation when all processing is complete and the files have been written.
2. Any blocking errors that require user intervention (e.g. login required, no files found).

Use targeted DOM reads (`browser_evaluate`, `browser_run_code_unsafe`) rather than full `browser_snapshot` calls wherever possible.

## Execution discipline
- Execute browser actions **sequentially** whenever a later step depends on page state from an earlier step.
- After every navigation, explicitly wait for the required page state before reading or interacting.
- Do not stop after partial data has been collected — only stop for blocking issues such as login required or repeated tool failure after retry.

## Folder to process
The user will provide the Box folder URL (format: `https://ibm.ent.box.com/folder/{id}`).

---

## Pre-flight checks

**Step 0 — Ensure Playwright MCP is installed**
Run `claude mcp list` using `execute_command`. If `playwright` does not appear, run:
```
claude mcp add playwright -- npx @playwright/mcp@latest
```
Wait for the command to complete.

**Step 0b — Verify browser tools are available**
Confirm `browser_navigate` is accessible before proceeding.

**Step 0c — Restore saved session (if available)**
Check whether `.box_session.json` exists:
```
test -f /Users/sarahneenan/code/bob/brads/.box_session.json && echo "exists" || echo "missing"
```
If it exists, load the saved cookies using `browser_run_code_unsafe`:
```js
async (page) => {
  const fs = require('fs');
  const state = JSON.parse(fs.readFileSync('/Users/sarahneenan/code/bob/brads/.box_session.json', 'utf8'));
  await page.context().addCookies(state.cookies || []);
  for (const origin of state.origins || []) {
    for (const item of origin.localStorage || []) {
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [item.name, item.value]);
    }
  }
  return 'session restored';
}
```

**Step 0d — Navigate and check login state**
Navigate to `https://ibm.ent.box.com`. Use `browser_evaluate` to check whether Box SSO has redirected to w3id:
```js
() => window.location.hostname !== 'ibm.ent.box.com'
```
- If `true` **and** `.box_session.json` existed: delete the stale file (`rm /Users/sarahneenan/code/bob/brads/.box_session.json`), then stop and ask the user to complete the login manually and run again.
- If `true` **and** no session file: stop and ask the user to log in manually (IBM w3id + IBM Verify 2FA) and run again.
- If `false`: proceed to Step 0e.

**Step 0e — Save session for future runs**
Save the browser session using `browser_run_code_unsafe`:
```js
async (page) => {
  const state = await page.context().storageState();
  require('fs').writeFileSync('/Users/sarahneenan/code/bob/brads/.box_session.json', JSON.stringify(state));
  return 'session saved';
}
```

---

## Step 1 — Navigate to the Box folder

Navigate to the provided folder URL. Wait for the page to reach `networkidle`, then wait an additional 3 seconds for the React file list to fully render.

Scroll to the bottom to trigger lazy-loading of all files. Use `browser_run_code_unsafe`:
```js
async (page) => {
  await new Promise(resolve => {
    let prev = -1;
    const timer = setInterval(() => {
      window.scrollTo(0, document.body.scrollHeight);
      if (document.body.scrollHeight === prev) { clearInterval(timer); resolve(); }
      prev = document.body.scrollHeight;
    }, 600);
    setTimeout(() => { clearInterval(timer); resolve(); }, 12000);
  });
  return 'scrolled';
}
```

## Step 2 — List all PDF files in the folder

Use `browser_evaluate` to extract all PDF file entries. Box renders `<a href*="/file/{id}">` links for every file:
```js
() => {
  const seen = new Map();
  for (const link of document.querySelectorAll('a[href*="/file/"]')) {
    const fileId = link.href.match(/\/file\/(\d+)/)?.[1];
    if (!fileId || seen.has(fileId)) continue;
    const name = (
      link.querySelector('[class*="Name"], [class*="name"]')?.textContent
      ?? link.textContent
    ).trim();
    if (name.toLowerCase().endsWith('.pdf')) {
      seen.set(fileId, { name, fileId, href: link.href });
    }
  }
  return Array.from(seen.values());
}
```
Store the resulting array in memory. If empty, stop and report to the user.

---

## Step 3 — For EACH PDF file

**Step 3a — Download the PDF**
Open a new browser tab. Trigger the download using Box's direct download endpoint. Use `browser_run_code_unsafe` on the new tab:
```js
async (page) => {
  const fileId = '<FILE_ID>';
  const filename = '<FILENAME>';
  const dlUrl = `https://ibm.ent.box.com/index.php?rm=box_v2_download&file_id=${fileId}`;
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.goto(dlUrl, { waitUntil: 'commit', timeout: 30000 }).catch(() => {})
  ]);
  const savePath = `/Users/sarahneenan/code/bob/brads/cv_downloads/${filename}`;
  await download.saveAs(savePath);
  return savePath;
}
```
Replace `<FILE_ID>` and `<FILENAME>` with the values from Step 2. Close the tab after the download completes.

> ⚠️ If the direct download URL fails (no download event fires within 60 s), fallback: navigate to the file's `/file/{id}` URL, wait for the preview to load, then click the Download button and capture the download event.

**Step 3b — Extract text from the PDF**
Use `execute_command` to extract text from the downloaded PDF using `pdf-parse`:
```
node -e "
const pdfParse = require('pdf-parse');
const fs = require('fs');
const buf = fs.readFileSync('/Users/sarahneenan/code/bob/brads/cv_downloads/<FILENAME>');
pdfParse(buf).then(d => console.log(d.text)).catch(e => console.error('ERROR: ' + e.message));
"
```
Replace `<FILENAME>` with the actual filename. Capture the output as the CV text for this file.

If `pdf-parse` is not installed, run `npm install pdf-parse` in the workspace directory first.

> ⚠️ If the output is mostly whitespace or looks like garbled characters, the PDF may be image-based (scanned). Record the text as `[IMAGE PDF — text extraction not possible]` for that file.

**Step 3c — Extract email from CV text or filename**
Search the filename and CV text for an IBM email address pattern `@ibm.com` or `@uk.ibm.com`. Record the first match found. If none, leave blank.

**Step 3d — Store the file's data in memory**
Store: `filename`, `email` (if found), `cvText` (full extracted text). Do **not** write the CSV yet.

**Step 3e — Repeat for all remaining files**

---

## Step 4 — Write cv_data.csv

Write `cv_data.csv` once, after all files are processed.

Format:
```
Filename,Email,CVText
"cv_john_doe.pdf","john.doe@ibm.com","Full text of CV here..."
"cv_jane_smith.pdf","","Full text of CV here..."
```
- Header: `Filename,Email,CVText`
- All cells must be double-quoted.
- Replace any double-quotes inside cell values with two double-quotes (`""`).

## Step 5 — Convert CSV to Excel

After writing `cv_data.csv`, run the following via `execute_command` to produce `cv_data.xlsx`:

```
node -e "
const XLSX = require('xlsx');
const path = require('path');
const dir = '/Users/sarahneenan/code/bob/brads';
const wb = XLSX.readFile(path.join(dir, 'cv_data.csv'));
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
ws['!cols'] = data[0].map((_, col) => ({
  wch: Math.min(120, Math.max(...data.map(row => String(row[col] ?? '').length)))
}));
XLSX.writeFile(wb, path.join(dir, 'cv_data.xlsx'));
console.log('cv_data.xlsx written');
"
```

---

## Output format

`cv_data.csv` columns:
- `Filename` — the PDF filename as found in Box
- `Email` — IBM email detected in the filename or CV text (blank if not found)
- `CVText` — full extracted text from the PDF

`cv_data.xlsx` — same columns, auto-sized, ready for review.

---

## Notes
- Create `cv_downloads/` in the workspace if it does not exist before downloading any files.
- If a PDF fails to download or parse, record the error message in the CVText column and continue to the next file.
- Collect all rows in memory; write the CSV once at the end.
- Box is a React SPA — always wait for the file list to render before reading file entries.
- The Box download endpoint (`box_v2_download`) requires valid session cookies; it will redirect to a login page if the session has expired. If this happens, delete `.box_session.json` and ask the user to re-authenticate.
