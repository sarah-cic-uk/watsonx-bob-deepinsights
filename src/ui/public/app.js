'use strict';

// app.js — DeepInsights dashboard client (vanilla JS, no build step).

const $ = (id) => document.getElementById(id);

let state = { candidates: [], role: '', verifiedCv: false };

// Verbose is a UI-only display preference (persisted in the browser, not boards.config.js).
let verbose = localStorage.getItem('di_verbose') === 'true';
let logToPersist = false; // true during a verbose run → mirror steps into the on-page log

// Prepare the loading overlay: always a progress bar; the step list only in verbose.
function prepOverlay(title) {
  $('loaderTitle').textContent = title;
  resetSteps();
  $('steps').classList.toggle('hidden', !verbose);
  $('overlay').classList.remove('hidden');
}

// --- toast -------------------------------------------------------------------
let toastTimer;
function toast(msg, kind = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 5000);
}

// --- config / settings -------------------------------------------------------
async function loadConfig() {
  const cfg = await (await fetch('/api/config')).json();
  $('tokenWarning').classList.toggle('hidden', cfg.hasToken);
  return cfg;
}

function boardRow(id = '', taggers = '') {
  const row = document.createElement('div');
  row.className = 'board-row';
  row.innerHTML = `
    <input class="id" type="text" placeholder="board ID" value="${id}" />
    <input class="tags" type="text" placeholder="taggers: 53435570, jane@ibm.com" value="${taggers}" />
    <button class="btn btn-ghost btn-sm rm" title="Remove">✕</button>`;
  row.querySelector('.rm').onclick = () => row.remove();
  return row;
}

async function openSettings() {
  const cfg = await loadConfig();
  $('businessUnit').value = cfg.businessUnit || '';
  $('trackingBoardId').value = cfg.trackingBoardId || '';
  $('defaultTagUsers').value = (cfg.defaultTagUsers || []).join(', ');
  const pct = Math.round((cfg.skillThreshold ?? 0.7) * 100);
  $('skillThreshold').value = pct;
  $('thresholdVal').textContent = pct + '%';

  const rows = $('boardRows');
  rows.innerHTML = '';
  const ids = cfg.sourceBoardIds || [];
  (ids.length ? ids : ['']).forEach((id) => {
    const taggers = (cfg.tagUsersByBoard?.[id] || []).join(', ');
    rows.appendChild(boardRow(id, taggers));
  });
  $('verbose').checked = verbose;
  $('settingsMsg').textContent = '';
  $('settingsModal').classList.remove('hidden');
}

async function saveSettings() {
  const sourceBoardIds = [];
  const tagUsersByBoard = {};
  for (const row of $('boardRows').querySelectorAll('.board-row')) {
    const id = row.querySelector('.id').value.trim();
    if (!id) continue;
    sourceBoardIds.push(id);
    const taggers = row.querySelector('.tags').value.split(',').map((s) => s.trim()).filter(Boolean);
    if (taggers.length) tagUsersByBoard[id] = taggers;
  }
  const payload = {
    businessUnit: $('businessUnit').value.trim(),
    sourceBoardIds,
    tagUsersByBoard,
    defaultTagUsers: $('defaultTagUsers').value.split(',').map((s) => s.trim()).filter(Boolean),
    trackingBoardId: $('trackingBoardId').value.trim(),
    skillThreshold: Number($('skillThreshold').value) / 100,
  };
  const res = await fetch('/api/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) { $('settingsMsg').textContent = '✗ ' + (data.error || 'failed'); return; }
  $('settingsModal').classList.add('hidden');
  toast('Settings saved to boards.config.js', 'ok');
  loadConfig();
}

// --- loading stepper ---------------------------------------------------------
function resetSteps() { $('steps').innerHTML = ''; }
function pushStep(msg) {
  const steps = $('steps');
  steps.querySelectorAll('li.active').forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
  const li = document.createElement('li');
  li.textContent = msg;
  li.className = 'active';
  steps.appendChild(li);
  if (logToPersist) {
    const p = document.createElement('li');
    p.textContent = msg;
    p.className = 'done';
    $('logList').appendChild(p);
  }
}
function finishSteps() { $('steps').querySelectorAll('li.active').forEach((li) => { li.classList.remove('active'); li.classList.add('done'); }); }

// --- run (SSE over fetch) ----------------------------------------------------
// Build the job-ad text from whichever input mode is active (paste OR fields — never both).
let inputMode = 'paste';
function getJobAdText() {
  if (inputMode === 'paste') return $('jobAd').value.trim();
  const lines = [];
  const add = (key, id) => { const v = $(id).value.trim(); if (v) lines.push(`${key}: ${v}`); };
  add('Role', 'fRole'); add('Band', 'fBand'); add('Level', 'fLevel'); add('Location', 'fLocation'); add('Skills', 'fSkills');
  return lines.join('\n');
}

async function findCandidates() {
  const jobAd = getJobAdText();
  if (!jobAd) { toast(inputMode === 'paste' ? 'Paste a job advert first.' : 'Fill in at least one field.', 'err'); return; }

  if (verbose) {
    logToPersist = true;
    $('logList').innerHTML = '';
    $('runLog').classList.remove('hidden');
  } else {
    logToPersist = false;
    $('runLog').classList.add('hidden');
  }
  prepOverlay('Finding candidates…');
  $('findBtn').disabled = true;

  try {
    const resp = await fetch('/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobAd, verifyCv: $('verifyCv').checked }),
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let errored = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /event: (.*)/.exec(frame)?.[1];
        const data = JSON.parse(/data: (.*)/.exec(frame)?.[1] || '{}');
        if (ev === 'step') pushStep(data.message);
        else if (ev === 'result') { state = { candidates: data.candidates, role: data.role, verifiedCv: data.verifiedCv, skillThreshold: data.skillThreshold, note: data.note }; }
        else if (ev === 'error') { errored = true; toast(data.message, 'err'); }
      }
    }
    finishSteps();
    if (!errored) {
      renderResults();
      if (state.note) toast(state.note, 'warn');
    }
  } catch (err) {
    toast('Run failed: ' + err.message, 'err');
  } finally {
    setTimeout(() => $('overlay').classList.add('hidden'), 350);
    $('findBtn').disabled = false;
  }
}

// --- render results ----------------------------------------------------------
function renderResults() {
  const { candidates, verifiedCv } = state;
  $('results').classList.remove('hidden');
  $('resultCount').textContent = candidates.length;
  $('postBtn').disabled = candidates.length === 0;
  $('csvBtn').disabled = candidates.length === 0;
  $('emptyResults').classList.toggle('hidden', candidates.length > 0);

  const cols = ['Name', 'Board', 'Role', 'Band', 'Level', 'Location', 'CV', 'Comments'];
  if (verifiedCv) cols.push('Match');
  $('candHead').innerHTML = cols.map((c) => `<th>${c}</th>`).join('');

  $('candBody').innerHTML = candidates.map((c) => {
    const cv = c.cvLink ? `<a class="cvlink" href="${c.cvLink}" target="_blank" rel="noopener">open ↗</a>` : '<span class="muted">—</span>';
    let match = '';
    if (verifiedCv) {
      const pct = Math.round((c.skillScore || 0) * 100);
      match = `<td><div class="matchbar"><div class="track"><div class="fill" style="width:${pct}%"></div></div><span>${pct}%</span></div></td>`;
    }
    const nameCell = c.itemUrl
      ? `<a class="cvlink" href="${esc(c.itemUrl)}" target="_blank" rel="noopener"><strong>${esc(c.name)}</strong> ↗</a>`
      : `<strong>${esc(c.name)}</strong>`;
    return `<tr>
      <td>${nameCell}</td>
      <td>${esc(c.boardName)}</td>
      <td>${esc(c.role)}</td>
      <td>${esc(c.band)}</td>
      <td>${esc(c.level)}</td>
      <td>${esc(c.location)}</td>
      <td>${cv}</td>
      <td>${c.commentsCount}</td>
      ${match}
    </tr>`;
  }).join('');
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

// --- CSV (client-side) -------------------------------------------------------
function downloadCsv() {
  const { candidates, verifiedCv } = state;
  if (!candidates.length) return;
  const head = ['Name', 'Monday Link', 'Board', 'Role', 'Band', 'Level', 'Location', 'CV Link', 'Comments'];
  if (verifiedCv) head.push('Skill Match %', 'Matched Skills');
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = candidates.map((c) => {
    const base = [c.name, c.itemUrl || '', c.boardName, c.role, c.band, c.level, c.location, c.cvLink, c.commentsCount];
    if (verifiedCv) base.push(Math.round((c.skillScore || 0) * 100), (c.matchedSkills || []).join('; '));
    return base.map(cell).join(',');
  });
  const csv = [head.map(cell).join(','), ...rows].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'deepinsights-candidates.csv'; a.click();
  URL.revokeObjectURL(url);
}

// --- post to Monday ----------------------------------------------------------
async function postToMonday() {
  const { candidates, role } = state;
  if (!candidates.length) return;
  const ok = confirm(
    `This will post interview-request comments on ${candidates.length} real Monday card(s) ` +
    `and add them to your tracking board.\n\nContinue?`
  );
  if (!ok) return;

  logToPersist = false;
  prepOverlay('Posting to Monday…');
  pushStep(`Posting interview requests for ${candidates.length} candidate(s)…`);
  $('postBtn').disabled = true;

  try {
    const res = await fetch('/api/post', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates, role }),
    });
    const data = await res.json();
    finishSteps();
    if (!res.ok) { toast(data.error || 'Posting failed', 'err'); return; }
    const errs = [...(data.comments.errors || []), ...(data.tracked.errors || [])];
    const msg = `Posted ${data.comments.posted}/${data.comments.total} comment(s), tracked ${data.tracked.created}/${data.tracked.total}.`;
    toast(errs.length ? `${msg} ${errs.length} error(s) — see terminal / error.log.` : msg, errs.length ? 'err' : 'ok');
  } catch (err) {
    toast('Posting failed: ' + err.message, 'err');
  } finally {
    setTimeout(() => $('overlay').classList.add('hidden'), 350);
    $('postBtn').disabled = false;
  }
}

// --- wire up -----------------------------------------------------------------
$('findBtn').onclick = findCandidates;
$('csvBtn').onclick = downloadCsv;
$('postBtn').onclick = postToMonday;
$('settingsBtn').onclick = openSettings;
$('closeSettings').onclick = $('cancelSettings').onclick = () => $('settingsModal').classList.add('hidden');
$('saveSettings').onclick = saveSettings;
$('addBoard').onclick = () => $('boardRows').appendChild(boardRow());
$('skillThreshold').oninput = (e) => { $('thresholdVal').textContent = e.target.value + '%'; };
$('verbose').onchange = (e) => { verbose = e.target.checked; localStorage.setItem('di_verbose', String(verbose)); };
$('clearLog').onclick = () => { $('logList').innerHTML = ''; $('runLog').classList.add('hidden'); };

// Input mode tabs — switching enforces "either/or, not both".
document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    inputMode = tab.dataset.mode;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('pasteMode').classList.toggle('hidden', inputMode !== 'paste');
    $('fieldsMode').classList.toggle('hidden', inputMode !== 'fields');
  };
});

loadConfig();
