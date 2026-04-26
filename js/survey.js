'use strict';

// ============================================================
// CONFIG — update ENDPOINT and COMPLETION_URL after deployment
// ============================================================
const SURVEY_CONFIG = {
  SALT:           '3d7fa8b2e4c961f05a3d7b8e2c9f4a1d',
  SECRET:         'Xm9Kp4nL7qR2wT5s',
  ENDPOINT:       'https://script.google.com/macros/s/AKfycbzAck9icLtNvRyMI6XoS8BzTHMF_aP1r9dWE7-rI_cg2wjoNNw2HOAljuqDGP5xEUBLoA/exec',
  COMPLETION_URL: 'https://app.prolific.com/submissions/complete?cc=FCZG2NYU',  // PILOT3 (main study: D6LFYZJ0)
  STUDY_ID:       'MAS-MISINFO-2026-CONF'
};

// ============================================================
// CLAIM CONTENT
// Three UK misinformation claims used in the study.
// ============================================================
const CLAIMS = {
  A: {
    topic: 'UK science and research spending',
    claim: 'The UK government spends about 5% of its annual budget on scientific research and development.',
    correction_headline: 'Fact check: This statement is inaccurate.',
    correction_body: 'According to the Office for National Statistics, UK government net expenditure on research and development was £17.4 billion in 2023 — approximately 1.3% of total government managed expenditure of approximately £1.33 trillion. This is considerably less than the 5% stated in the claim.',
    correction_source: 'Source: Office for National Statistics (2023). Research and development expenditure by the UK government.'
  },
  B: {
    topic: 'UK overseas foreign aid spending',
    claim: 'The UK government currently spends around 10% of its annual budget on overseas foreign aid.',
    correction_headline: 'Fact check: This statement is inaccurate.',
    correction_body: 'According to the Foreign, Commonwealth and Development Office, the UK spent £15.4 billion on official development assistance in 2023 — equivalent to 0.58% of gross national income and approximately 1.2% of total government expenditure. The claim overstates the actual figure by approximately eightfold.',
    correction_source: 'Source: FCDO (2024). Statistics on International Development: Final UK ODA Spend 2023.'
  },
  C: {
    topic: 'Sugar and children\'s behaviour',
    claim: 'Scientific studies have shown that eating sugary foods causes children to become hyperactive and difficult to manage.',
    correction_headline: 'Fact check: This statement is inaccurate.',
    correction_body: 'A meta-analysis of 23 controlled trials published in the Journal of the American Medical Association found that sugar does not affect the behaviour or cognitive performance of children. The parental belief in this effect is likely due to expectancy, not a causal effect of sugar.',
    correction_source: 'Source: Wolraich, Wilson & White (1995). The effect of sugar on behavior or cognition in children: A meta-analysis. JAMA, 274(20), 1617–1621.'
  }
};

// 6 claim orders × 2 conditions = 12 cells
const ORDERS = ['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA'];
// Cells 0–5: Treatment (T); Cells 6–11: Control (C)

// Column header list (must match Code.gs HEADERS)
const HEADERS = [
  'prolific_pid', 'study_id', 'session_id', 'cell', 'condition', 'claim_order',
  'ts_arrived', 'ts_submitted', 'duration_sec',
  'q01_age', 'q02_gender', 'q03_education', 'q04_region', 'q05_income',
  'q06_lr', 'q07_party', 'q08_polint', 'q09_newsfreq', 'q10_newssrc',
  'q11_trust_gov', 'q12_trust_sci', 'q13_budgknow', 'q14_sceptic',
  'q15_attn1', 'q16_children', 'q17_num1', 'q18_num2',
  'cred_pre_a', 'share_pre_a', 'cred_post_a', 'share_post_a',
  'cred_pre_b', 'share_pre_b', 'cred_post_b', 'share_post_b',
  'cred_pre_c', 'share_pre_c', 'cred_post_c', 'share_post_c',
  'attn2', 'user_agent', 'screen_width'
];

// ============================================================
// STATE
// ============================================================
const state = {
  pid:            '',
  sessionId:      '',
  cell:           null,
  condition:      '',
  claimOrder:     '',
  claimsSeq:      [],   // e.g. ['A','B','C']
  tsArrived:      null,
  tsSubmitted:    null,
  currentSection: 0,
  responses:      {}
};

// ============================================================
// SHA-256 CELL RANDOMISER (SubtleCrypto / Web Crypto API)
// cell = parseInt(sha256(pid + SALT).slice(0,8), 16) % 12
// ============================================================
async function assignCell(pid) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pid + SURVEY_CONFIG.SALT);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hashBuf))
                   .map(b => b.toString(16).padStart(2, '0')).join('');
  return parseInt(hex.slice(0, 8), 16) % 12;
}

// ============================================================
// INITIALISE — runs on DOMContentLoaded, after randomisation
// ============================================================
async function init() {
  const params = new URLSearchParams(window.location.search);

  // Prolific passes these in the URL
  state.pid       = params.get('PROLIFIC_PID') || params.get('prolific_pid') || '';
  state.sessionId = params.get('SESSION_ID')   || params.get('session_id')   || '';

  // Allow local testing with a fake PID
  if (!state.pid) {
    state.pid = 'TEST_' + Math.random().toString(36).slice(2, 10).toUpperCase();
  }

  state.tsArrived = new Date().toISOString();
  state.responses.user_agent   = navigator.userAgent;
  state.responses.screen_width = screen.width;

  // Cell assignment via SHA-256
  const cellIdx    = await assignCell(state.pid);  // numeric index 0–11
  state.condition  = cellIdx < 6 ? 'T' : 'C';
  state.claimOrder = ORDERS[cellIdx % 6];
  state.cell       = state.condition + '_' + state.claimOrder;  // e.g. "T_ABC"
  state.claimsSeq  = state.claimOrder.split('');

  // Backup to localStorage immediately
  saveToLocalStorage();

  // Reveal consent section
  showSection(1);
}

// ============================================================
// SECTION NAVIGATION
// ============================================================
function showSection(n) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('section-' + n);
  if (el) el.classList.add('active');
  state.currentSection = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateProgress(n);
}

function updateProgress(n) {
  const total = 19; // sections 1–19 shown to participant
  const pct = Math.min(100, Math.round(((n - 1) / (total - 1)) * 100));
  const bar   = document.getElementById('progress-bar');
  const label = document.getElementById('progress-label');
  if (bar)   bar.style.width = Math.max(2, pct) + '%';
  if (label) label.textContent = pct + '%';
}

// ============================================================
// CLAIM BLOCK POPULATION (called before showing sections 8,11,14)
// Updates data-key and name attributes in the block's three sections.
// ============================================================
function populateClaimBlock(blockIdx) {
  const letter   = state.claimsSeq[blockIdx];           // 'A', 'B', or 'C'
  const lc       = letter.toLowerCase();                 // 'a', 'b', or 'c'
  const claim    = CLAIMS[letter];
  const base     = 8 + blockIdx * 3;                    // 8, 11, or 14

  // ---- PRE section ----
  const preSec = document.getElementById('section-' + base);
  if (preSec) {
    preSec.querySelectorAll('.claim-topic').forEach(el => el.textContent = claim.topic);
    preSec.querySelectorAll('.claim-text').forEach(el  => el.textContent = claim.claim);
    // Update radio names/data-keys for credibility
    preSec.querySelectorAll('.cred-radio input[type="radio"]').forEach(inp => {
      inp.name         = 'cred_pre_' + lc;
      inp.dataset.key  = 'cred_pre_' + lc;
    });
    // Sync the hidden validator group's data-name
    const hiddenPre = preSec.querySelector('.radio-group[data-required="true"]');
    if (hiddenPre) hiddenPre.dataset.name = 'cred_pre_' + lc;
    // Update range data-key for sharing
    const shareRange = preSec.querySelector('.share-range');
    if (shareRange) shareRange.dataset.key = 'share_pre_' + lc;
    const shareVal = preSec.querySelector('.share-val');
    if (shareVal) shareVal.id = 'share_pre_' + lc + '_val';
    if (shareRange) shareRange.id = 'share_pre_' + lc;
  }

  // ---- STIM section ----
  const stimSec = document.getElementById('section-' + (base + 1));
  if (stimSec) {
    stimSec.querySelectorAll('.claim-topic').forEach(el => el.textContent = claim.topic);
    stimSec.querySelectorAll('.claim-text').forEach(el  => el.textContent = claim.claim);
    const corrBox  = stimSec.querySelector('.correction-box');
    const ctrlBox  = stimSec.querySelector('.control-placeholder');
    if (state.condition === 'T') {
      stimSec.querySelector('.correction-headline').textContent = claim.correction_headline;
      stimSec.querySelector('.correction-body').textContent     = claim.correction_body;
      stimSec.querySelector('.correction-source').textContent   = claim.correction_source;
      if (corrBox) corrBox.style.display = 'block';
      if (ctrlBox) ctrlBox.style.display = 'none';
    } else {
      if (corrBox) corrBox.style.display = 'none';
      if (ctrlBox) ctrlBox.style.display = 'block';
    }
  }

  // ---- POST section ----
  const postSec = document.getElementById('section-' + (base + 2));
  if (postSec) {
    postSec.querySelectorAll('.claim-topic').forEach(el => el.textContent = claim.topic);
    postSec.querySelectorAll('.claim-text').forEach(el  => el.textContent = claim.claim);
    postSec.querySelectorAll('.cred-radio input[type="radio"]').forEach(inp => {
      inp.name        = 'cred_post_' + lc;
      inp.dataset.key = 'cred_post_' + lc;
    });
    // Sync the hidden validator group's data-name
    const hiddenPost = postSec.querySelector('.radio-group[data-required="true"]');
    if (hiddenPost) hiddenPost.dataset.name = 'cred_post_' + lc;
    const shareRange = postSec.querySelector('.share-range');
    if (shareRange) shareRange.dataset.key = 'share_post_' + lc;
    const shareVal = postSec.querySelector('.share-val');
    if (shareVal) shareVal.id = 'share_post_' + lc + '_val';
    if (shareRange) shareRange.id = 'share_post_' + lc;
  }

  // Wire up slider display after populating
  [base, base + 2].forEach(secN => {
    const sec = document.getElementById('section-' + secN);
    if (!sec) return;
    const slider = sec.querySelector('.share-range');
    if (!slider) return;
    const display = document.getElementById(slider.id + '_val');
    if (display) {
      // Reset to untouched state
      display.textContent = '\u2014';
      display.classList.add('untouched');
      // Remove old listeners by cloning, resetting touch state
      const newSlider = slider.cloneNode(true);
      newSlider.dataset.touched = '';
      slider.parentNode.replaceChild(newSlider, slider);
      newSlider.addEventListener('input', () => {
        const d = document.getElementById(newSlider.id + '_val');
        if (d) {
          d.textContent = newSlider.value;
          d.classList.remove('untouched');
        }
        newSlider.dataset.touched = 'true';
      });
    }
  });
}

// ============================================================
// DEBRIEF — always show all three corrections regardless of condition
// ============================================================
function populateDebrief() {
  const container = document.getElementById('debrief-corrections');
  if (!container) return;
  container.innerHTML = '';
  ['A', 'B', 'C'].forEach(letter => {
    const c = CLAIMS[letter];
    const div = document.createElement('div');
    div.className = 'debrief-claim';
    div.innerHTML =
      '<h3>Claim ' + letter + ': ' + c.topic + '</h3>' +
      '<p class="original-claim">\u201c' + c.claim + '\u201d</p>' +
      '<p class="correction-headline">' + c.correction_headline + '</p>' +
      '<p class="correction-body">'     + c.correction_body     + '</p>' +
      '<p class="correction-source">'   + c.correction_source   + '</p>';
    container.appendChild(div);
  });
}

// ============================================================
// VALIDATION — check all required fields in a section
// ============================================================
function validateSection(secId) {
  const sec = document.getElementById(secId);
  if (!sec) return true;

  // Clear old error messages and highlights
  sec.querySelectorAll('.error-msg').forEach(e => e.remove());
  sec.querySelectorAll('.input-error').forEach(e => e.classList.remove('input-error'));
  sec.querySelectorAll('.has-error').forEach(e => e.classList.remove('has-error'));

  let valid = true;

  // Check radio groups
  sec.querySelectorAll('.radio-group[data-required="true"]').forEach(group => {
    const name  = group.dataset.name;
    const checked = name ? sec.querySelector('input[name="' + name + '"]:checked') : null;
    if (!checked) {
      valid = false;
      appendError(group, 'Please select an option.');
    }
  });

  // Check checkbox groups (at least one required)
  sec.querySelectorAll('.checkbox-group[data-required="true"]').forEach(group => {
    const name = group.dataset.name;
    const anyChecked = name ? sec.querySelector('input[name="' + name + '"]:checked') : null;
    if (!anyChecked) {
      valid = false;
      appendError(group, 'Please select at least one option.');
    }
  });

  // Check select elements
  sec.querySelectorAll('select[required]').forEach(sel => {
    if (!sel.value) {
      valid = false;
      sel.classList.add('input-error');
      appendError(sel.parentNode, 'Please make a selection.');
    }
  });

  // Check required-touch range sliders
  sec.querySelectorAll('input[type="range"][data-required-touch="true"]').forEach(slider => {
    if (slider.dataset.touched !== 'true') {
      valid = false;
      const block = slider.closest('.q-block');
      appendError(block || slider.parentNode, 'Please move the slider to indicate your response.');
    }
  });

  // Check text/number inputs
  sec.querySelectorAll('input[required][type="text"], input[required][type="number"]').forEach(inp => {
    if (!inp.value.trim()) {
      valid = false;
      inp.classList.add('input-error');
      appendError(inp.parentNode, 'This field is required.');
    }
  });

  if (!valid) {
    const firstErr = sec.querySelector('.error-msg');
    if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return valid;
}

function appendError(parent, msg) {
  if (parent.querySelector('.error-msg')) return; // avoid duplicate
  const p = document.createElement('p');
  p.className = 'error-msg';
  p.textContent = msg;
  parent.appendChild(p);
  const qBlock = parent.closest('.q-block');
  if (qBlock) qBlock.classList.add('has-error');
}

// ============================================================
// COLLECT — gather all data-keyed inputs in a section
// ============================================================
function collectSection(secId) {
  const sec = document.getElementById(secId);
  if (!sec) return;

  sec.querySelectorAll('input, select, textarea').forEach(el => {
    const key = el.dataset.key;
    if (!key) return;

    if (el.type === 'radio') {
      if (el.checked) state.responses[key] = el.value;
    } else if (el.type === 'checkbox') {
      if (!Array.isArray(state.responses[key])) state.responses[key] = [];
      if (el.checked && !state.responses[key].includes(el.value)) {
        state.responses[key].push(el.value);
      }
    } else {
      state.responses[key] = el.value;
    }
  });
}

// ============================================================
// PREV — go back one section (no back buttons on stimulus sections 9, 12, 15)
// ============================================================
function prevSection(from) {
  showSection(from - 1);
}

// ============================================================
// NEXT — validate → collect → advance section
// ============================================================
function nextSection(from) {
  const secId = 'section-' + from;
  if (!validateSection(secId)) return;
  collectSection(secId);
  saveToLocalStorage();

  const next = from + 1;

  // Populate claim blocks just before showing them
  if (next === 8)  populateClaimBlock(0);
  if (next === 11) populateClaimBlock(1);
  if (next === 14) populateClaimBlock(2);
  if (next === 18) populateDebrief();

  showSection(next);
}

// ============================================================
// SUBMIT — fires when participant clicks Complete on section 18
// ============================================================
async function submitSurvey() {
  // Collect debrief section (no questions, but record timing)
  collectSection('section-18');

  state.tsSubmitted = new Date().toISOString();
  const durationSec = Math.round(
    (new Date(state.tsSubmitted) - new Date(state.tsArrived)) / 1000
  );

  // Flatten checkbox arrays to comma-separated strings
  const flatResponses = {};
  Object.entries(state.responses).forEach(([k, v]) => {
    flatResponses[k] = Array.isArray(v) ? v.join(',') : v;
  });

  const payload = {
    secret:       SURVEY_CONFIG.SECRET,
    prolific_pid: state.pid,
    study_id:     SURVEY_CONFIG.STUDY_ID,
    session_id:   state.sessionId,
    cell:         state.cell,
    condition:    state.condition,
    claim_order:  state.claimOrder,
    ts_arrived:   state.tsArrived,
    ts_submitted: state.tsSubmitted,
    duration_sec: durationSec,
    ...flatResponses
  };

  // Save final payload to localStorage as insurance
  localStorage.setItem('mas_misinfo_final', JSON.stringify(payload));

  // Show completing screen immediately
  showSection(19);

  // POST to Apps Script (mode: no-cors — server writes but we can't read the response)
  try {
    await fetch(SURVEY_CONFIG.ENDPOINT, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
  } catch (err) {
    console.warn('POST failed (data in localStorage):', err);
  }

  // Redirect to Prolific after 3 seconds
  setTimeout(() => {
    window.location.href = SURVEY_CONFIG.COMPLETION_URL;
  }, 3000);
}

// ============================================================
// HELPERS
// ============================================================
function saveToLocalStorage() {
  try {
    localStorage.setItem('mas_misinfo_state', JSON.stringify({
      pid:         state.pid,
      cell:        state.cell,
      condition:   state.condition,
      claimOrder:  state.claimOrder,
      tsArrived:   state.tsArrived,
      section:     state.currentSection,
      responses:   state.responses
    }));
  } catch (e) { /* ignore quota errors */ }
}

// ============================================================
// DOM READY
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // Wire up all static range sliders (Q06 LR scale handled separately)
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    const valEl = document.getElementById(slider.id + '_val');
    if (valEl) {
      valEl.textContent = slider.value;
      slider.addEventListener('input', () => {
        valEl.textContent   = slider.value;
        slider.dataset.touched = 'true';
      });
    }
  });

  // Start initialisation
  init().catch(err => {
    console.error('Init failed:', err);
    // Still show consent so participant is not blocked
    showSection(1);
  });
});
