'use strict';

// ─── Apply translations to DOM ───────────────────────────────────────────────
document.querySelectorAll('[data-i18n]').forEach(function(el) {
  var key = el.getAttribute('data-i18n');
  if (T[key] && typeof T[key] === 'string') el.textContent = T[key];
});
document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
  var key = el.getAttribute('data-i18n-placeholder');
  if (T[key] && typeof T[key] === 'string') el.placeholder = T[key];
});
document.documentElement.lang = LANG;

// ─── Theme toggle ─────────────────────────────────────────────────────────────
function setTheme(mode) {
  localStorage.setItem('mailhsc-theme', mode);
  if (mode === 'dark')  document.documentElement.setAttribute('data-theme', 'dark');
  if (mode === 'light') document.documentElement.setAttribute('data-theme', 'light');
  if (mode === 'auto')  document.documentElement.removeAttribute('data-theme');
  document.querySelectorAll('.theme-btn').forEach(function(b) { b.classList.remove('active'); });
  var btn = document.getElementById('theme' + mode.charAt(0).toUpperCase() + mode.slice(1));
  if (btn) btn.classList.add('active');
}

// Init button state from saved preference
setTheme(localStorage.getItem('mailhsc-theme') || 'auto');

document.getElementById('themeAuto').addEventListener('click',  function() { setTheme('auto'); });
document.getElementById('themeLight').addEventListener('click', function() { setTheme('light'); });
document.getElementById('themeDark').addEventListener('click',  function() { setTheme('dark'); });

// ─── Tab switching ───────────────────────────────────────────────────────────
// Safe: data-tab values come from static HTML, not user input.
// Whitelist enforced anyway to prevent any future dynamic injection.
var VALID_TABS = { paste: true, upload: true };

document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    var tabId = tab.dataset.tab;
    if (!VALID_TABS[tabId]) return; // whitelist guard
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.add('hidden'); });
    tab.classList.add('active');
    document.getElementById('tab-' + tabId).classList.remove('hidden');
  });
});

// ─── File upload ─────────────────────────────────────────────────────────────
var selectedFile = null;
var dropZone     = document.getElementById('dropZone');
var fileInput    = document.getElementById('fileInput');
var fileSelected = document.getElementById('fileSelected');
var fileNameEl   = document.getElementById('fileName');
var analyzeFileBtn = document.getElementById('analyzeFileBtn');

document.getElementById('browseBtn').addEventListener('click', function() { fileInput.click(); });
fileInput.addEventListener('change', function(e) { setFile(e.target.files[0]); });

dropZone.addEventListener('click', function(e) {
  if (e.target !== document.getElementById('browseBtn') &&
      e.target !== document.getElementById('removeFile')) {
    fileInput.click();
  }
});
dropZone.addEventListener('dragover',  function(e) { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', function()  { dropZone.classList.remove('dragover'); });
dropZone.addEventListener('drop', function(e) {
  e.preventDefault(); dropZone.classList.remove('dragover');
  setFile(e.dataTransfer.files[0]);
});
document.getElementById('removeFile').addEventListener('click', function(e) {
  e.stopPropagation(); clearFile();
});

// Allowed MIME types / extensions for .eml upload
var ALLOWED_EXT  = /\.(eml|txt|msg)$/i;
var MAX_SIZE_MB  = 5;
var MAX_SIZE_B   = MAX_SIZE_MB * 1024 * 1024;

function setFile(f) {
  if (!f) return;
  // Validate extension
  if (!ALLOWED_EXT.test(f.name)) {
    showError('File must be .eml, .txt or .msg');
    return;
  }
  // Validate size client-side (server also enforces this)
  if (f.size > MAX_SIZE_B) {
    showError('File exceeds ' + MAX_SIZE_MB + ' MB limit');
    return;
  }
  selectedFile = f;
  // textContent is safe — no innerHTML
  fileNameEl.textContent = f.name;
  fileSelected.classList.remove('hidden');
  analyzeFileBtn.disabled = false;
}
function clearFile() {
  selectedFile = null; fileInput.value = '';
  fileSelected.classList.add('hidden');
  analyzeFileBtn.disabled = true;
}

// ─── Buttons ──────────────────────────────────────────────────────────────────
document.getElementById('clearBtn').addEventListener('click', function() {
  document.getElementById('headersInput').value = '';
});
document.getElementById('analyzeBtn').addEventListener('click', function() {
  var raw = document.getElementById('headersInput').value.trim();
  if (!raw) return;
  analyzeJSON(raw);
});
document.getElementById('analyzeFileBtn').addEventListener('click', function() {
  if (!selectedFile) return;
  analyzeFile(selectedFile);
});
document.getElementById('newAnalysisBtn').addEventListener('click', function() {
  showSection('input');
  clearFile();
});

// ─── API ──────────────────────────────────────────────────────────────────────
function analyzeJSON(raw) {
  showSection('loading');
  fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest' // CSRF mitigation
    },
    body: JSON.stringify({ headers: raw })
  })
  .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
  .then(function(r) { if (!r.ok) throw new Error(r.data.error || 'Server error'); renderResults(r.data); })
  .catch(function(err) { showError(err.message); });
}

function analyzeFile(file) {
  showSection('loading');
  var fd = new FormData();
  fd.append('file', file);
  fetch('/api/analyze', {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }, // CSRF mitigation
    body: fd
  })
  .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
  .then(function(r) { if (!r.ok) throw new Error(r.data.error || 'Server error'); renderResults(r.data); })
  .catch(function(err) { showError(err.message); });
}

// ─── Sections ─────────────────────────────────────────────────────────────────
function showSection(name) {
  document.getElementById('inputSection').classList.toggle('hidden', name !== 'input');
  document.getElementById('loading').classList.toggle('hidden', name !== 'loading');
  document.getElementById('errorBox').classList.toggle('hidden', name !== 'error');
  document.getElementById('results').classList.toggle('hidden', name !== 'results');
}
function showError(msg) {
  // textContent — safe, no XSS risk
  document.getElementById('errorMsg').textContent = msg;
  showSection('error');
  setTimeout(function() { showSection('input'); }, 4000);
}

// ─── Render ───────────────────────────────────────────────────────────────────
var allHeaders    = [];
var showAllHeaders = false;

function renderResults(d) {
  renderScore(d.security, d.auth);
  renderSummary(d.summary);
  renderHops(d.hops);
  renderAuth(d.auth);
  allHeaders = d.headers || [];
  showAllHeaders = false;
  renderHeaders(allHeaders, false);
  // textContent — safe
  document.getElementById('headersCount').textContent = allHeaders.length;
  document.getElementById('toggleHeaders').textContent = T.showAll;
  showSection('results');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Score ────────────────────────────────────────────────────────────────────
function renderScore(sec, auth) {
  var score = Math.max(0, Math.min(100, sec.score | 0)); // clamp integer
  var arc   = document.getElementById('scoreArc');
  arc.style.strokeDashoffset = 326.7 - (score / 100) * 326.7;
  var color = score >= 75 ? 'var(--success)' : score >= 45 ? 'var(--warn)' : 'var(--danger)';
  arc.style.stroke = color;

  var numEl = document.getElementById('scoreNum');
  numEl.style.color = color;
  var cur = 0, step = Math.max(1, Math.ceil(score / 30));
  var timer = setInterval(function() {
    cur = Math.min(cur + step, score);
    numEl.textContent = cur; // safe — integer
    if (cur >= score) clearInterval(timer);
  }, 20);

  // Auth pills — resultClass() whitelists CSS class names
  var pills = document.getElementById('authPills');
  pills.innerHTML = '';
  [['SPF', auth.spf], ['DKIM', auth.dkim], ['DMARC', auth.dmarc]].forEach(function(entry) {
    var proto = entry[0], e = entry[1];
    var cls   = resultClass(e.result);           // whitelisted CSS class
    var span  = document.createElement('span');
    span.className = 'pill ' + cls;
    span.textContent = proto + ' · ' + (e.result || 'none'); // textContent — safe
    pills.appendChild(span);
  });

  // Issues — use translateIssue() then textContent
  var issuesEl = document.getElementById('issuesList');
  issuesEl.innerHTML = '';
  sec.issues.forEach(function(issue) {
    var row  = document.createElement('div');  row.className = 'issue-item';
    var dot  = document.createElement('div');  dot.className = 'issue-dot ' + sanitizeSeverity(issue.severity);
    var text = document.createElement('span'); text.textContent = translateIssue(issue.code, issue.params);
    row.appendChild(dot); row.appendChild(text);
    issuesEl.appendChild(row);
  });

  // Passed
  var passedEl = document.getElementById('passedList');
  passedEl.innerHTML = '';
  sec.passed.forEach(function(p) {
    var row = document.createElement('div'); row.className = 'pass-item';
    row.textContent = typeof T[p.code] === 'string' ? T[p.code] : p.code;
    passedEl.appendChild(row);
  });
}

// Whitelist severity values used as CSS class names
function sanitizeSeverity(s) {
  var allowed = { high: 'high', medium: 'medium', low: 'low' };
  return allowed[s] || 'low';
}

// Whitelist auth result values used as CSS class names
function resultClass(r) {
  if (!r) return 'none';
  var map = { pass: 'pass', fail: 'fail', none: 'none', present: 'present',
              softfail: 'neutral', neutral: 'neutral' };
  return map[r.toLowerCase()] || 'none';
}

// ── Summary ──────────────────────────────────────────────────────────────────
function renderSummary(s) {
  var grid   = document.getElementById('summaryGrid');
  grid.innerHTML = '';
  var fields = [
    ['From', s.from], ['To', s.to], ['Subject', s.subject], ['Date', s.date],
    ['Message-ID', s.message_id], ['Reply-To', s.reply_to],
    ['X-Mailer', s.x_mailer], ['MIME-Version', s.mime_version],
  ];
  fields.forEach(function(f) {
    var item = document.createElement('div'); item.className = 'summary-item';
    var key  = document.createElement('div'); key.className  = 'summary-key';
    var val  = document.createElement('div'); val.className  = 'summary-val' + (f[1] ? '' : ' empty');
    key.textContent = f[0];       // static string — safe
    val.textContent = f[1] || '—'; // textContent — safe, no XSS possible
    item.appendChild(key); item.appendChild(val);
    grid.appendChild(item);
  });
}

// ── Hops ─────────────────────────────────────────────────────────────────────
function renderHops(hops) {
  var el = document.getElementById('hopsTimeline');
  // textContent — safe
  document.getElementById('hopsCount').textContent = (hops ? hops.length : 0) + ' ' + T.hops;

  el.innerHTML = '';
  if (!hops || hops.length === 0) {
    var empty = document.createElement('div');
    empty.style.cssText = 'padding:1rem;color:var(--muted);font-size:.82rem';
    empty.textContent = T.noHops;
    el.appendChild(empty);
    return;
  }

  hops.forEach(function(hop, i) {
    var isOrigin = i === 0, isLast = i === hops.length - 1;

    var wrapper    = document.createElement('div'); wrapper.className = 'hop-item';
    var connector  = document.createElement('div'); connector.className = 'hop-connector';
    var dot        = document.createElement('div');
    dot.className  = 'hop-dot' + (isOrigin ? ' origin' : isLast ? ' destination' : '');
    connector.appendChild(dot);
    if (!isLast) {
      var line = document.createElement('div'); line.className = 'hop-line';
      connector.appendChild(line);
    }

    var body   = document.createElement('div'); body.className = 'hop-body';
    var header = document.createElement('div'); header.className = 'hop-header';

    var idx = document.createElement('span'); idx.className = 'hop-index';
    idx.textContent = 'HOP ' + (hop.index + 1); // integer — safe
    header.appendChild(idx);
    header.appendChild(makeDelayBadge(hop.delay, i));
    body.appendChild(header);

    var fields = document.createElement('div'); fields.className = 'hop-fields';
    [['from', hop.from], ['by', hop.by], ['with', hop.with]].forEach(function(f) {
      if (!f[1]) return;
      var row = document.createElement('div'); row.className = 'hop-field';
      var k   = document.createElement('span'); k.className = 'hop-field-key'; k.textContent = f[0];
      var v   = document.createElement('span'); v.className = 'hop-field-val'; v.textContent = f[1];
      row.appendChild(k); row.appendChild(v);
      fields.appendChild(row);
    });
    body.appendChild(fields);

    if (hop.ip) {
      var ipBadge = document.createElement('div'); ipBadge.className = 'hop-ip-badge';
      // SVG is static markup, not from user data — safe to use innerHTML here
      ipBadge.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" stroke="var(--accent2)" stroke-width="1" fill="none"/></svg>';
      var ipText = document.createTextNode(hop.ip); // safe
      ipBadge.appendChild(ipText);
      body.appendChild(ipBadge);
    }
    if (hop.timestamp) {
      var ts = document.createElement('div'); ts.className = 'hop-ts';
      ts.textContent = hop.timestamp; // textContent — safe
      body.appendChild(ts);
    }

    wrapper.appendChild(connector);
    wrapper.appendChild(body);
    el.appendChild(wrapper);
  });
}

function makeDelayBadge(delay, index) {
  var span = document.createElement('span');
  if (index === 0) {
    span.className = 'hop-delay first';
    span.textContent = T.origin;
    return span;
  }
  if (!delay && delay !== 0) return span; // empty node
  var cls = 'fast';
  var label;
  var d = delay | 0; // coerce to integer
  if (d < 0)        { label = '~0s'; }
  else if (d > 3600){ cls = 'veryslow'; label = Math.round(d / 3600) + 'h'; }
  else if (d > 300) { cls = 'slow';    label = Math.round(d / 60) + 'm'; }
  else              { label = d + 's'; }
  span.className = 'hop-delay ' + cls;
  span.textContent = '+' + label; // safe — computed from integer
  return span;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
function renderAuth(auth) {
  var grid = document.getElementById('authGrid');
  grid.innerHTML = '';
  [['SPF', auth.spf], ['DKIM', auth.dkim], ['DMARC', auth.dmarc], ['ARC', auth.arc]].forEach(function(e) {
    var proto = e[0], entry = e[1];
    var item  = document.createElement('div'); item.className = 'auth-item';

    var protoEl = document.createElement('div'); protoEl.className = 'auth-proto';
    protoEl.textContent = proto; // static — safe

    var badge = document.createElement('div');
    badge.className = 'auth-result-badge ' + resultClass(entry.result); // whitelisted class
    badge.textContent = entry.result || 'none'; // textContent — safe

    item.appendChild(protoEl);
    item.appendChild(badge);

    if (entry.details) {
      var det = document.createElement('div'); det.className = 'auth-details';
      det.textContent = entry.details; // textContent — safe
      item.appendChild(det);
    }
    grid.appendChild(item);
  });
}

// ── Headers table ─────────────────────────────────────────────────────────────
var HEADERS_PREVIEW = 20;

function renderHeaders(headers, showAll) {
  var container = document.getElementById('headersTable');
  container.innerHTML = '';
  var visible = showAll ? headers : headers.slice(0, HEADERS_PREVIEW);

  visible.forEach(function(h) {
    var row   = document.createElement('div');
    // Whitelist flag values used as CSS class suffixes
    var flag  = sanitizeFlag(h.flag);
    row.className = 'header-row' + (flag ? ' flag-' + flag : '');

    var name  = document.createElement('div'); name.className = 'h-name';
    var val   = document.createElement('div'); val.className  = 'h-val';
    var dot   = document.createElement('div'); dot.className  = 'h-flag-dot ' + (flag || 'empty');

    name.textContent = h.name;  // textContent — safe
    val.textContent  = h.value; // textContent — safe
    row.appendChild(name); row.appendChild(val); row.appendChild(dot);
    container.appendChild(row);
  });

  if (!showAll && headers.length > HEADERS_PREVIEW) {
    var fade = document.createElement('button'); fade.className = 'headers-fade headers-fade-btn';
    fade.textContent = T.moreHeadersHidden(headers.length - HEADERS_PREVIEW);
    fade.addEventListener('click', function() {
      showAllHeaders = true;
      renderHeaders(allHeaders, true);
      document.getElementById('toggleHeaders').textContent = T.showLess;
    });
    container.appendChild(fade);
  }
}

function sanitizeFlag(f) {
  var allowed = { warn: 'warn', danger: 'danger', info: 'info' };
  return allowed[f] || '';
}

document.getElementById('toggleHeaders').addEventListener('click', function() {
  showAllHeaders = !showAllHeaders;
  renderHeaders(allHeaders, showAllHeaders);
  document.getElementById('toggleHeaders').textContent = showAllHeaders ? T.showLess : T.showAll;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function translateIssue(code, params) {
  var fn = T[code];
  if (!fn) return code;
  if (typeof fn === 'string') return fn;
  if (typeof fn === 'function') return fn.apply(null, params || []);
  return code;
}
