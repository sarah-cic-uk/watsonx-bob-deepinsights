'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// Session, downloads and output files live at the repo root (two levels up from
// src/integrations/), so they sit alongside .monday-token and stay gitignored.
const DIR = path.join(__dirname, '..', '..');
const SESSION_FILE = path.join(DIR, '.box_session.json');
const DOWNLOAD_DIR = path.join(DIR, 'cv_downloads');
const OUTPUT_CSV = path.join(DIR, 'cv_data.csv');
const OUTPUT_XLSX = path.join(DIR, 'cv_data.xlsx');

// Parse args: node box_scraper.js [--folder] <url>
// Accepts a /folder/ URL (lists all PDFs) or a /file/ URL (processes that single file).
// Always quote the URL — the ?s= shared-link token contains ? which zsh treats as a glob wildcard.
//   node box_scraper.js 'https://ibm.ent.box.com/file/123?s=abc'

// --- Session / browser setup ---
// IBM Box SSO uses the same w3id identity provider as w3.ibm.com.
// Strategy: try headless with saved session first; if that fails or no session,
// do a headed login and keep that SAME browser open for scraping.

function isOnBox(page) {
  try { return new URL(page.url()).hostname === 'ibm.ent.box.com'; } catch { return false; }
}

async function createContext() {
  if (fs.existsSync(SESSION_FILE)) {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ storageState: SESSION_FILE, acceptDownloads: true, permissions: [] });
    ctx.on('page', p => p.on('dialog', d => d.dismiss()));
    const page = await ctx.newPage();
    try {
      await page.goto('https://ibm.ent.box.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
      if (isOnBox(page)) {
        await ctx.storageState({ path: SESSION_FILE });
        return { browser, context: ctx };
      }
    } finally {
      await page.close();
    }
    await browser.close();
    fs.unlinkSync(SESSION_FILE);
    console.log('Saved session expired — re-authenticating.');
  }

  // Headed login — keep this browser open for scraping (IBM auth is bound to the session)
  console.log('Opening browser for login. Complete your IBM w3id login + 2FA — the script will continue automatically once you are in.');
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ acceptDownloads: true, permissions: [] });
  ctx.on('page', p => p.on('dialog', d => d.dismiss()));
  const page = await ctx.newPage();
  await page.goto('https://ibm.ent.box.com');
  // Wait until hostname is ibm.ent.box.com — covers w3id + IBM Verify redirect chain
  await page.waitForURL(url => url.hostname === 'ibm.ent.box.com', { timeout: 300000 });
  await page.waitForLoadState('networkidle');
  await page.close();
  await ctx.storageState({ path: SESSION_FILE });
  console.log('Login successful. Session saved for future runs.');
  return { browser, context: ctx };
}

// --- Box folder listing ---

async function listPdfFiles(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });

  // Wait for Box's React file list to actually render rather than a fixed timeout.
  // If no file link appears within 20s the folder is probably empty or requires login.
  try {
    await page.waitForSelector('a[href*="/file/"]', { timeout: 20000 });
  } catch {
    // Timed out — log page state to help diagnose, then return empty
    const pageTitle = await page.title();
    const pageUrl   = page.url();
    console.warn(`\n  [Box] No file links appeared after 20s. Page: "${pageTitle}" at ${pageUrl}`);
    return [];
  }

  // Scroll to bottom to trigger lazy-loading of all files
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let prev = -1;
      const timer = setInterval(() => {
        window.scrollTo(0, document.body.scrollHeight);
        if (document.body.scrollHeight === prev) { clearInterval(timer); resolve(); }
        prev = document.body.scrollHeight;
      }, 600);
      setTimeout(() => { clearInterval(timer); resolve(); }, 12000);
    });
  });

  // Collect all file links — log any found files that were skipped so we can debug format issues
  const { files, skipped } = await page.evaluate(() => {
    const seen = new Map();
    const skipped = [];
    for (const link of document.querySelectorAll('a[href*="/file/"]')) {
      const href = link.href;
      const fileId = href.match(/\/file\/(\d+)/)?.[1];
      if (!fileId || seen.has(fileId)) continue;

      const name = (
        link.querySelector('[class*="Name"], [class*="name"], [data-testid*="name"]')?.textContent
        ?? link.textContent
      ).trim();

      const nameLower = name.toLowerCase();
      if (nameLower.endsWith('.pdf') || nameLower.endsWith('.docx') || nameLower.endsWith('.doc')) {
        seen.set(fileId, { name, fileId, href });
      } else if (name) {
        skipped.push(name);
      }
    }
    return { files: Array.from(seen.values()), skipped };
  });

  if (skipped.length) {
    console.warn(`  [Box] Skipped ${skipped.length} non-CV file(s): ${skipped.slice(0, 5).join(', ')}`);
  }

  return files;
}

// --- Per-file download ---

// Strategy: intercept the network requests Box makes when rendering its own file preview.
// Box fetches the PDF from dl.boxcloud.com to render the preview — we capture those bytes.
// As a fallback, we intercept Box's metadata API call which includes authenticated_download_url.
async function downloadPdf(context, file) {
  const dlPage = await context.newPage();
  try {
    let pdfBuffer = null;
    let authenticatedDownloadUrl = null;

    // Intercept the PDF content Box fetches for its preview renderer
    await dlPage.route(`**/files/${file.fileId}/content**`, async route => {
      const response = await route.fetch();
      const buf = await response.body();
      if (buf && buf.length > 1000) pdfBuffer = buf;
      await route.fulfill({ response, body: buf });
    });

    // Intercept Box's metadata call — captures the real filename and authenticated_download_url
    await dlPage.route(`**/api.box.com/2.0/files/${file.fileId}?*`, async route => {
      const response = await route.fetch();
      const buf = await response.body();
      try {
        const meta = JSON.parse(buf.toString());
        if (meta.name) file.name = meta.name; // update to real filename
        if (meta.authenticated_download_url) authenticatedDownloadUrl = meta.authenticated_download_url;
      } catch {}
      await route.fulfill({ response, body: buf });
    });

    await dlPage.goto(`https://ibm.ent.box.com/file/${file.fileId}`, { waitUntil: 'load', timeout: 30000 });
    // Wait for Box's async preview requests to fire
    await dlPage.waitForTimeout(6000);

    // file.name may have been updated by the metadata intercept — resolve path now
    const filePath = path.join(DOWNLOAD_DIR, file.name);

    if (pdfBuffer) {
      fs.writeFileSync(filePath, pdfBuffer);
      return filePath;
    }

    if (authenticatedDownloadUrl) {
      const resp = await dlPage.request.get(authenticatedDownloadUrl, { timeout: 60000 });
      if (!resp.ok()) throw new Error(`Signed URL returned ${resp.status()}`);
      fs.writeFileSync(filePath, await resp.body());
      return filePath;
    }

    throw new Error('No PDF content or download URL captured — Box preview may not have loaded');
  } finally {
    await dlPage.close();
  }
}

// --- PDF text extraction ---

async function extractCvText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let text;
  if (ext === '.docx' || ext === '.doc') {
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value;
  } else {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    text = data.text;
  }
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Try to detect an IBM email in the filename or CV text
function detectEmail(name, text) {
  const ibmPattern = /[a-zA-Z0-9._%+-]+@(?:[a-zA-Z0-9.-]+\.)?ibm\.com/;
  return name.match(ibmPattern)?.[0] ?? text.match(ibmPattern)?.[0] ?? '';
}

// --- Output ---

function csvCell(val) {
  if (!val && val !== 0) return '';
  return `"${String(val).replace(/"/g, '""')}"`;
}

function writeCSV(rows) {
  const header = 'Filename,Email,CVText';
  const lines = [header, ...rows.map(r =>
    [r.filename, r.email, r.cvText].map(csvCell).join(',')
  )];
  fs.writeFileSync(OUTPUT_CSV, lines.join('\n') + '\n');
}

function writeXLSX(rows) {
  const XLSX = require('xlsx');
  // Build directly from data to avoid CSV encoding issues with Unicode characters
  const data = [
    ['Filename', 'Email', 'CVText'],
    ...rows.map(r => [r.filename, r.email, r.cvText])
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = data[0].map((_, col) => ({
    wch: Math.min(120, Math.max(...data.map(row => String(row[col] ?? '').length)))
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CVs');
  XLSX.writeFile(wb, OUTPUT_XLSX);
}

// Derive a file entry from a /file/ URL (single-file mode)
function fileEntryFromUrl(url) {
  const parsed = new URL(url);
  const fileId = parsed.pathname.match(/\/file\/(\d+)/)?.[1] ?? null;
  // Use the shared-link token if present so the download endpoint can resolve it
  const sharedLink = parsed.searchParams.get('s');
  return { name: `${fileId}.pdf`, fileId, href: url, sharedLink };
}

// ---------------------------------------------------------------------------
// Programmatic API — used by cv-skills-matcher.js
// ---------------------------------------------------------------------------

/**
 * Open a Box scraper session (one browser, reused across all CV downloads).
 * Call close() when done to shut the browser.
 *
 * @returns {Promise<{ scrapeCV: (url: string) => Promise<string>, close: () => Promise<void> }>}
 */
async function createScraperSession() {
  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  const { browser, context } = await createContext();

  return {
    /**
     * Download all PDFs at `url` (file or folder) and return the extracted text.
     * For folder URLs the text from every PDF is concatenated.
     */
    async scrapeCV(url) {
      const isSingle = new URL(url).pathname.startsWith('/file/');
      let pdfFiles;

      if (isSingle) {
        pdfFiles = [fileEntryFromUrl(url)];
      } else {
        const listPage = await context.newPage();
        try {
          pdfFiles = await listPdfFiles(listPage, url);
        } finally {
          await listPage.close();
        }
        if (!pdfFiles.length) throw new Error('No PDF files found in Box folder: ' + url);
      }

      const texts = [];
      for (const file of pdfFiles) {
        const filePath = await downloadPdf(context, file);
        texts.push(await extractCvText(filePath));
      }
      return texts.join('\n\n---\n\n');
    },

    async close() {
      await browser.close();
    },
  };
}

module.exports = { createScraperSession };

// ---------------------------------------------------------------------------
// CLI — node box_scraper.js '<url>'
// ---------------------------------------------------------------------------

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const inputUrl = args[0] === '--folder' ? args[1] : args[0];
    if (!inputUrl) {
      console.error('Usage: node box_scraper.js \'<box_folder_or_file_url>\'');
      process.exit(1);
    }
    const isSingleFile = new URL(inputUrl).pathname.startsWith('/file/');

    if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

    const { browser, context } = await createContext();

    let pdfFiles;

    if (isSingleFile) {
      console.log(`Single file mode: ${inputUrl}`);
      pdfFiles = [fileEntryFromUrl(inputUrl)];
    } else {
      console.log(`Scanning folder: ${inputUrl}`);
      const listPage = await context.newPage();
      try {
        pdfFiles = await listPdfFiles(listPage, inputUrl);
      } finally {
        await listPage.close();
      }
      if (!pdfFiles.length) {
        console.log('No PDF files found. Check the folder URL and try again.');
        await browser.close();
        process.exit(1);
      }
      console.log(`Found ${pdfFiles.length} PDF file(s). Downloading and parsing...`);
    }

    const results = [];
    for (const file of pdfFiles) {
      process.stdout.write(`  ${file.name} ... `);
      try {
        const filePath = await downloadPdf(context, file);
        const cvText = await extractCvText(filePath);
        const email = detectEmail(file.name, cvText);
        results.push({ filename: file.name, email, cvText });
        console.log('done');
      } catch (err) {
        console.log(`ERROR: ${err.message}`);
        results.push({ filename: file.name, email: '', cvText: `ERROR: ${err.message}` });
      }
    }

    await browser.close();

    writeCSV(results);
    writeXLSX(results);
    console.log(`\nWritten: cv_data.csv + cv_data.xlsx  (${results.length} files)`);
  })();
}
