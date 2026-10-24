(function (global) {
'use strict';

// safe storage. fallback ke in-memory kalau localStorage diblokir (safari private)
var SafeStorage = (function () {
  var ls = null, ss = null;
  try { ls = window.localStorage; ls.setItem('__t','1'); ls.removeItem('__t'); } catch (e) { ls = null; }
  try { ss = window.sessionStorage; ss.setItem('__t','1'); ss.removeItem('__t'); } catch (e) { ss = null; }
  var mem = new Map();
  function wrap(store, prefix) {
    return {
      get: function (k) { try { return store ? store.getItem(prefix + k) : (mem.get(prefix + k) ?? null); } catch (e) { return mem.get(prefix + k) ?? null; } },
      set: function (k, v) { try { if (store) store.setItem(prefix + k, v); else mem.set(prefix + k, v); } catch (e) { mem.set(prefix + k, v); } },
      remove: function (k) { try { if (store) store.removeItem(prefix + k); else mem.delete(prefix + k); } catch (e) { mem.delete(prefix + k); } },
      keys: function () { try { return store ? Object.keys(store) : Array.from(mem.keys()); } catch (e) { return Array.from(mem.keys()); } }
    };
  }
  return { local: wrap(ls, ''), session: wrap(ss, '') };
})();

// AES-GCM wrapper. fallback ke base64 obfuscation kalau subtle crypto gak ada
var _crypto = (function () {
  var _k = 'ZGVwb3NpdC1zZWNyZXQta2V5LTIwMjYtYXN5cm9m';
  var _s = 'c2FsdC1kZXBvc2l0LXYyMDI2LXNlY3VyZQ==';
  var _i = 100000;
  var _dk = null;

  var supported = (function () {
    try { return !!(global.crypto && global.crypto.subtle && global.crypto.getRandomValues); }
    catch (e) { return false; }
  })();

  async function _derive() {
    if (_dk) return _dk;
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey('raw', enc.encode(atob(_k)), { name: 'PBKDF2' }, false, ['deriveKey']);
    _dk = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(atob(_s)), iterations: _i, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    return _dk;
  }
  function _b2buf(b64) {
    var bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function _buf2b(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function _fbSeal(obj) { try { return 'fb:' + btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); } catch (e) { return null; } }
  function _fbUnseal(b64) { try { return JSON.parse(decodeURIComponent(escape(atob(b64.slice(3))))); } catch (e) { return null; } }

  async function seal(obj) {
    if (!supported) return _fbSeal(obj);
    try {
      var key = await _derive();
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
      var comb = new Uint8Array(iv.length + c.byteLength);
      comb.set(iv, 0);
      comb.set(new Uint8Array(c), iv.length);
      return _buf2b(comb.buffer);
    } catch (e) { return _fbSeal(obj); }
  }
  async function unseal(b64) {
    if (!b64) return null;
    if (b64.indexOf('fb:') === 0) return _fbUnseal(b64);
    if (!supported) return null;
    try {
      var key = await _derive();
      var buf = _b2buf(b64);
      var iv = buf.slice(0, 12);
      var data = buf.slice(12);
      var plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, data);
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (e) { return null; }
  }
  return { seal: seal, unseal: unseal, supported: supported };
})();

// cache dua lapis: memori + storage terenkripsi
var Cache = (function () {
  var P = 'aotp_d_';
  var _mem = new Map();

  async function get(key, ttl) {
    if (_mem.has(key)) {
      var e = _mem.get(key);
      if (!ttl || Date.now() - e.t < ttl) return e.v;
      _mem.delete(key);
    }
    try {
      var raw = SafeStorage.local.get(P + key);
      if (!raw) return null;
      var e2 = await _crypto.unseal(raw);
      if (!e2) return null;
      if (ttl && Date.now() - e2.t > ttl) { SafeStorage.local.remove(P + key); return null; }
      _mem.set(key, e2);
      return e2.v;
    } catch (err) { return null; }
  }
  async function set(key, v) {
    var e = { t: Date.now(), v: v };
    _mem.set(key, e);
    try {
      var s = await _crypto.seal(e);
      if (s) SafeStorage.local.set(P + key, s);
    } catch (err) {}
  }
  function remove(key) {
    _mem.delete(key);
    try { SafeStorage.local.remove(P + key); } catch (e) {}
  }
  function invalidate(prefix) {
    _mem.forEach(function (_, k) { if (k.indexOf(prefix) === 0) _mem.delete(k); });
    try {
      SafeStorage.local.keys().forEach(function (k) {
        if (k.indexOf(P + prefix) === 0) SafeStorage.local.remove(k);
      });
    } catch (e) {}
  }
  function clear() {
    _mem.clear();
    try {
      SafeStorage.local.keys().forEach(function (k) {
        if (k.indexOf(P) === 0) SafeStorage.local.remove(k);
      });
    } catch (e) {}
  }
  return { get: get, set: set, remove: remove, invalidate: invalidate, clear: clear };
})();

var _cfg = {
  rk: '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg',
  ep: {
    user: '/api/user',
    presets: '/api/deposit/presets',
    methods: '/api/deposit/methods',
    history: '/api/deposit/history',
    generateRef: '/api/deposit/generate-ref',
    save: '/api/deposit/save',
    status: '/api/deposit',
    syncBatch: '/api/deposit/sync-batch',
    logout: '/api/auth/logout'
  },
  qrispyBase: 'https://cloudflareworkerdeploydidashcloudflarecomexportdef.rahayucahyapurwa.workers.dev',
  ttl: {
    user: 5 * 60 * 1000,
    presets: 30 * 60 * 1000,
    methods: 30 * 60 * 1000,
    history: 60 * 1000
  },
  historyLimit: 5,
  pollInterval: 3000,
  fetchTimeout: 15000
};

// deteksi device biar bisa skip animasi berat
var _dev = (function () {
  function mq(q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } }
  var hc = navigator.hardwareConcurrency || 4;
  var conn = navigator.connection || {};
  return {
    mobile: mq('(max-width: 768px)'),
    lowEnd: hc <= 4 || conn.saveData || /2g|slow-2g/.test(conn.effectiveType || ''),
    reduced: mq('(prefers-reduced-motion: reduce)')
  };
})();

// security nudge + strip query string
(function () {
  try {
    console.log('%c⚠️ STOP!', 'color:#ff3b30;font-size:20px;font-weight:900');
    console.log('%cJangan paste apapun di sini. Itu SCAM.', 'color:#8e8e93;font-size:12px');
  } catch (e) {}
  document.addEventListener('copy', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (t && t.closest && t.closest('[data-copy]')) return;
    e.preventDefault();
  });
  document.addEventListener('cut', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
  });
  try {
    var clean = location.origin + location.pathname;
    if (location.search) history.replaceState(null, '', clean);
  } catch (e) {}
})();

var token = null;
try { token = SafeStorage.local.get('access_token'); } catch (e) { token = null; }
if (!token) { location.href = '/login'; return; }

function $(id) { return document.getElementById(id); }
function safeJson(res) { return res.json().catch(function () { return {}; }); }

function fetchWithTimeout(url, opts, ms) {
  opts = opts || {};
  ms = ms || _cfg.fetchTimeout;
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
  var o = Object.assign({}, opts);
  if (ctrl) o.signal = ctrl.signal;
  return fetch(url, o).finally(function () { if (timer) clearTimeout(timer); });
}

function formatRupiah(n) {
  return 'Rp' + (Number(n) || 0).toLocaleString('id-ID');
}
function getInitial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}

// icon svg inline. depo1 = qris otomatis (backend sekarang cuma ini)
var ICONS = {
  depo1: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  close: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  clock: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  warning: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  arrowRight: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  arrowLeft: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  wallet: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>',
  copy: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  download: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
};

// recaptcha v3
function waitForRecaptcha() {
  return new Promise(function (resolve) {
    if (window.grecaptcha && window.grecaptcha.execute) return resolve();
    var n = 0;
    var t = setInterval(function () {
      n++;
      if (window.grecaptcha && window.grecaptcha.execute) { clearInterval(t); resolve(); }
      else if (n >= 50) { clearInterval(t); resolve(); }
    }, 100);
  });
}
async function getRecaptchaToken(action) {
  try {
    await waitForRecaptcha();
    if (!window.grecaptcha || !window.grecaptcha.execute) return null;
    return await new Promise(function (resolve) {
      grecaptcha.ready(function () {
        grecaptcha.execute(_cfg.rk, { action: action }).then(resolve).catch(function () { resolve(null); });
      });
      setTimeout(function () { resolve(null); }, 8000);
    });
  } catch (e) { return null; }
}
async function securePost(url, body, action) {
  body = body || {};
  action = action || 'deposit';
  var rc = await getRecaptchaToken(action);
  return fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(Object.assign({}, body, { recaptcha_token: rc }))
  });
}

// custom alert. fallback ke window.confirm kalau overlay gak ada
function showCustomAlert(opts) {
  return new Promise(function (resolve) {
    var title = opts.title, message = opts.message;
    var type = opts.type || 'info';
    var okText = opts.okText || 'OK';
    var showCancel = opts.showCancel || false;
    var cancelText = opts.cancelText || 'Batal';

    var overlay = $('customAlert');
    if (!overlay) { resolve(window.confirm(message || title || 'OK')); return; }
    var iconEl = $('customAlertIcon');
    var titleEl = $('customAlertTitle');
    var msgEl = $('customAlertMessage');
    var actionsEl = $('customAlertActions');
    if (!iconEl || !titleEl || !msgEl || !actionsEl) { resolve(false); return; }

    iconEl.className = 'custom-alert-icon ' + type;
    var iconMap = { success: ICONS.check, warning: ICONS.warning, danger: ICONS.close, error: ICONS.close, info: ICONS.info };
    iconEl.innerHTML = iconMap[type] || ICONS.info;
    titleEl.textContent = title || 'Informasi';
    msgEl.textContent = message || '';

    actionsEl.innerHTML = '';
    if (showCancel) {
      var b = document.createElement('button');
      b.className = 'btn';
      b.type = 'button';
      b.textContent = cancelText;
      b.addEventListener('click', function () { overlay.classList.remove('active'); resolve(false); });
      actionsEl.appendChild(b);
    }
    var ok = document.createElement('button');
    ok.className = 'btn btn-primary';
    ok.type = 'button';
    ok.textContent = okText;
    ok.addEventListener('click', function () { overlay.classList.remove('active'); resolve(true); });
    actionsEl.appendChild(ok);
    overlay.classList.add('active');
  });
}
function customAlert(message, type, title) {
  var titles = { success: 'Berhasil', warning: 'Perhatian', danger: 'Error', info: 'Informasi' };
  return showCustomAlert({ title: title || titles[type] || 'Informasi', message: message, type: type || 'info' });
}
function customConfirm(message, type, title) {
  return showCustomAlert({ title: title || 'Konfirmasi', message: message, type: type || 'warning', okText: 'Ya', showCancel: true, cancelText: 'Batal' });
}

// theme toggle
(function () {
  var btn = $('themeToggle');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') || 'light';
    var nx = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nx);
    try { SafeStorage.local.set('asyrofotp_theme', nx); } catch (e) {}
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', nx === 'dark' ? '#0a0a0c' : '#0a84ff');
  });
})();

// sidebar collapse desktop
(function () {
  var sidebar = $('sidebar');
  var collapseBtn = $('collapseBtn');
  if (!sidebar || !collapseBtn) return;
  var isCollapsed = SafeStorage.local.get('sidebar_collapsed') === 'true';
  if (isCollapsed && window.innerWidth > 768) {
    sidebar.classList.add('collapsed');
    document.body.classList.add('sidebar-collapsed');
  }
  collapseBtn.addEventListener('click', function () {
    if (window.innerWidth <= 768) return;
    var c = sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed', c);
    try { SafeStorage.local.set('sidebar_collapsed', c); } catch (e) {}
  });
})();

// sidebar drawer mobile
(function () {
  var toggle = $('mobileToggle');
  var sidebar = $('sidebar');
  var overlay = $('sidebarOverlay');
  if (!toggle || !sidebar || !overlay) return;

  var open = false;
  var lastToggle = 0;

  function openSb() {
    if (open) return;
    open = true;
    sidebar.classList.add('open');
    overlay.classList.add('active');
    document.body.classList.add('sidebar-open');
    document.body.style.overflow = 'hidden';
  }
  function closeSb() {
    if (!open) return;
    open = false;
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    document.body.classList.remove('sidebar-open');
    document.body.style.overflow = '';
  }
  function onToggle(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    var now = Date.now();
    if (now - lastToggle < 300) return;
    lastToggle = now;
    if (open) closeSb(); else openSb();
  }
  toggle.addEventListener('click', onToggle);
  toggle.addEventListener('touchend', onToggle, { passive: false });

  function onOverlay(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    closeSb();
  }
  overlay.addEventListener('click', onOverlay);
  overlay.addEventListener('touchstart', onOverlay, { passive: false });

  sidebar.querySelectorAll('.nav-item').forEach(function (l) {
    l.addEventListener('click', function () {
      if (window.innerWidth <= 768) setTimeout(closeSb, 100);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) closeSb();
  });
  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () { if (window.innerWidth > 768 && open) closeSb(); }, 150);
  });
})();

var state = {
  amount: 0,
  method: null,
  methodLabel: null,
  deposit: null,
  pollingInterval: null,
  countdownInterval: null,
  presets: [],
  isCreating: false,
  historyPage: 1,
  historyLimit: _cfg.historyLimit,
  expired: false,
  historyLoaded: false
};

async function loadUser(force) {
  if (!force) {
    var cached = await Cache.get('user', _cfg.ttl.user);
    if (cached) renderUser(cached);
  }
  try {
    var res = await fetchWithTimeout(_cfg.ep.user, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (res.status === 401 || res.status === 403) { handleLogout(); return; }
    var user = await safeJson(res);
    if (user && !user.error) {
      await Cache.set('user', user);
      renderUser(user);
    }
  } catch (e) {}
}

function renderUser(user) {
  if (!user) return;
  var name = user.name || user.username || '—';
  var set = function (id, txt) { var el = $(id); if (el) el.textContent = txt; };
  set('userName', name);
  set('userBalance', formatRupiah(user.balance));
  set('userInitial', getInitial(name));
  set('balancePill', formatRupiah(user.balance));
  set('saldoSekarang', formatRupiah(user.balance));
}

async function loadPresets() {
  var cached = await Cache.get('presets', _cfg.ttl.presets);
  if (cached && cached.length > 0) {
    state.presets = cached;
    renderPresets();
  }
  try {
    var res = await fetchWithTimeout(_cfg.ep.presets, {
      headers: { Authorization: 'Bearer ' + token }
    });
    var data = await safeJson(res);
    state.presets = data.presets || [];
    if (state.presets.length > 0) await Cache.set('presets', state.presets);
    renderPresets();
  } catch (err) {
    if (!cached) {
      state.presets = [
        { amount: 10000, label: 'Rp10.000' },
        { amount: 20000, label: 'Rp20.000' },
        { amount: 50000, label: 'Rp50.000' },
        { amount: 100000, label: 'Rp100.000' },
        { amount: 200000, label: 'Rp200.000' },
        { amount: 500000, label: 'Rp500.000' }
      ];
      renderPresets();
    }
  }
}

function renderPresets() {
  var grid = $('presetGrid');
  if (!grid) return;
  grid.innerHTML = state.presets.map(function (p) {
    return '<button class="preset-item" type="button" data-amount="' + p.amount + '">' + p.label + '</button>';
  }).join('');
  grid.querySelectorAll('.preset-item').forEach(function (btn) {
    btn.addEventListener('click', function () {
      grid.querySelectorAll('.preset-item').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var inp = $('inputAmount');
      if (inp) inp.value = btn.dataset.amount;
      state.amount = Number(btn.dataset.amount);
      updateButton();
      saveState();
    });
  });
}

var inputAmount = $('inputAmount');
var btnLanjut = $('btnLanjut');

function updateButton() {
  if (!inputAmount || !btnLanjut) return;
  var val = Number(inputAmount.value);
  if (val >= 1000 && val <= 10000000) {
    btnLanjut.disabled = false;
    state.amount = val;
  } else {
    btnLanjut.disabled = true;
    state.amount = 0;
  }
}
if (inputAmount) {
  inputAmount.addEventListener('input', function () {
    document.querySelectorAll('.preset-item').forEach(function (b) { b.classList.remove('active'); });
    updateButton();
    saveState();
  });
}

function restoreState() {
  try {
    var saved = SafeStorage.session.get('deposit_state');
    if (saved) {
      var parsed = JSON.parse(saved);
      if (parsed.amount && inputAmount) {
        state.amount = parsed.amount;
        inputAmount.value = parsed.amount;
      }
    }
  } catch (e) {}
}
function saveState() {
  try { SafeStorage.session.set('deposit_state', JSON.stringify({ amount: state.amount })); } catch (e) {}
}
function clearState() {
  try { SafeStorage.session.remove('deposit_state'); } catch (e) {}
}

function setStep(step, expired) {
  ['step1', 'step2', 'step3'].forEach(function (id) {
    var el = $(id);
    if (el) el.classList.remove('active', 'done', 'expired');
  });
  function setIcon(id, symbol) { var el = $(id); if (el) el.textContent = symbol; }

  if (step === 1) {
    var s = $('step1'); if (s) s.classList.add('active');
    setIcon('step1Icon', '●'); setIcon('step2Icon', '●'); setIcon('step3Icon', '●');
  } else if (step === 2) {
    var s1 = $('step1'); if (s1) s1.classList.add('done');
    var s2 = $('step2'); if (s2) s2.classList.add('active');
    setIcon('step1Icon', '✓'); setIcon('step2Icon', '●'); setIcon('step3Icon', '●');
  } else if (step === 3) {
    var s3a = $('step1'); if (s3a) s3a.classList.add('done');
    var s3b = $('step2'); if (s3b) s3b.classList.add('done');
    var s3c = $('step3'); if (s3c) s3c.classList.add(expired ? 'expired' : 'active');
    setIcon('step1Icon', '✓'); setIcon('step2Icon', '✓'); setIcon('step3Icon', expired ? '✕' : '●');
  }
}

function openModal(id) {
  var m = $(id);
  if (m) {
    m.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}
function closeModal(id) {
  var m = $(id);
  if (m) {
    m.classList.remove('active');
    if (!document.querySelector('.modal-overlay.active')) document.body.style.overflow = '';
  }
}

async function loadMethods() {
  var grid = $('methodGrid');
  if (!grid) return;
  var cached = await Cache.get('methods', _cfg.ttl.methods);
  if (cached && cached.length > 0) renderMethods(cached);
  try {
    var res = await fetchWithTimeout(_cfg.ep.methods, {
      headers: { Authorization: 'Bearer ' + token }
    });
    var data = await safeJson(res);
    var list = data.methods || [];
    if (list.length > 0) await Cache.set('methods', list);
    renderMethods(list);
  } catch (err) {
    if (!cached) {
      grid.innerHTML = '<div class="empty-block"><h3>Gagal memuat</h3><p>' + err.message + '</p></div>';
    }
  }
}

function renderMethods(list) {
  var grid = $('methodGrid');
  if (!grid) return;
  if (!list || list.length === 0) {
    grid.innerHTML = '<div class="empty-block"><h3>Belum ada metode</h3><p>Coba lagi nanti.</p></div>';
    return;
  }
  grid.innerHTML = list.map(function (m) {
    var iconSvg = ICONS.depo1;
    var badge = '<span class="method-badge">OTOMATIS</span>';
    return '<button class="method-card" type="button" data-method="' + m.id + '" data-label="' + m.label + '">' +
      '<div class="method-icon qrispy">' + iconSvg + '</div>' +
      '<div class="method-info">' +
        '<div class="method-title">' + m.label + ' ' + badge + '</div>' +
        '<div class="method-desc">' + m.desc + '</div>' +
      '</div>' +
    '</button>';
  }).join('');
  grid.querySelectorAll('.method-card').forEach(function (card) {
    card.addEventListener('click', function () {
      state.method = card.dataset.method;
      state.methodLabel = card.dataset.label;
      closeModal('modalMethod');
      setStep(3);
      createDeposit();
    });
  });
}

async function createDeposit() {
  if (state.isCreating) return;
  state.isCreating = true;
  state.expired = false;
  var btn = btnLanjut;
  var original = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span> Membuat QR...';
  }
  try {
    if (state.method === 'qrispy') {
      await createQrispyDeposit();
    }
  } catch (err) {
    await customAlert('Gagal membuat deposit: ' + err.message, 'danger', 'Gagal');
    setStep(1);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  } finally {
    state.isCreating = false;
  }
}

async function createQrispyDeposit() {
  var refRes = await securePost(_cfg.ep.generateRef, {}, 'deposit_ref');
  var refData = await safeJson(refRes);
  if (!refRes.ok || !refData.reference_id) throw new Error('Gagal generate reference ID');
  var referenceId = refData.reference_id;

  var qrispyRes = await fetchWithTimeout(_cfg.qrispyBase + '/api/payment/qris/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Number(state.amount),
      payment_reference: referenceId
    })
  });
  var qrispyData = await safeJson(qrispyRes);
  if (!qrispyRes.ok || qrispyData.status === 'error') {
    throw new Error(qrispyData.message || 'Gagal membuat QRIS');
  }

  var saveRes = await securePost(_cfg.ep.save, {
    reference_id: referenceId,
    amount: Number(state.amount),
    qris_id: qrispyData.data.qris_id,
    qris_url: qrispyData.data.qris_image_url,
    expired_at: qrispyData.data.expired_at,
    expires_in_seconds: qrispyData.data.expires_in_seconds
  }, 'deposit_save');
  var saveData = await safeJson(saveRes);
  if (!saveRes.ok) throw new Error(saveData.error || 'Gagal simpan deposit');
  state.deposit = saveData.deposit;
  showPaymentPanel();
}

function showPaymentPanel() {
  setStep(3);
  var panelNominal = $('panelNominal');
  var panelPayment = $('panelPayment');
  if (panelNominal) panelNominal.style.display = 'none';
  if (!panelPayment) return;
  panelPayment.style.display = 'block';

  var d = state.deposit;
  var saldoMasuk = Number(d.amount);
  var fee = Number(d.fee) || 0;
  var totalBayar = Number(d.total_amount) || saldoMasuk;

  panelPayment.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">' +
      '<div class="countdown" id="countdown" style="margin-bottom:0;">' + ICONS.clock + '<span id="countdownText">--:--</span></div>' +
    '</div>' +
    '<div class="qr-display">' +
      '<div class="qr-total">' +
        '<div class="label">Total yang harus dibayar</div>' +
        '<div class="amount" id="qrAmount">' + formatRupiah(totalBayar) + '</div>' +
      '</div>' +
      '<div class="qr-wrapper"><img src="' + d.qris_url + '" alt="QR Code" id="qrImage" crossorigin="anonymous"></div>' +
    '</div>' +
    '<div class="qr-info">' +
      '<div class="qr-row"><span class="label">Reference ID</span><span class="value">' + d.reference_id + '</span></div>' +
      '<div class="qr-row"><span class="label">Metode</span><span class="value">' + state.methodLabel + '</span></div>' +
      '<div class="qr-row"><span class="label">Saldo Top Up</span><span class="value">' + formatRupiah(saldoMasuk) + '</span></div>' +
      '<div class="qr-row"><span class="label">Fee</span><span class="value" id="qrFee"><span class="inline-loader"></span></span></div>' +
      '<div class="qr-row total-row"><span class="label">Total Bayar</span><span class="value big" id="qrTotal">' + formatRupiah(totalBayar) + '</span></div>' +
      '<div class="qr-row"><span class="label">Saldo Diterima</span><span class="value success">' + formatRupiah(saldoMasuk) + '</span></div>' +
    '</div>' +
    '<div class="polling-indicator"><span class="spinner-sm"></span><span>Menunggu pembayaran... otomatis cek status</span></div>' +
    '<div class="payment-actions">' +
      '<button class="btn-download-qr" id="btnDownloadQr" type="button">' + ICONS.download + ' Download QR</button>' +
      '<button class="btn-cancel-red" id="btnCancel" type="button">' + ICONS.close + ' Batalkan</button>' +
    '</div>';

  var btnCancel = $('btnCancel'); if (btnCancel) btnCancel.addEventListener('click', cancelDeposit);
  var btnDownload = $('btnDownloadQr'); if (btnDownload) btnDownload.addEventListener('click', downloadQR);

  var countdownSeconds = d.expires_in_seconds || 1800;
  if (d.expired_at) {
    var expiresAt = new Date(d.expired_at).getTime();
    countdownSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  }
  startCountdown(countdownSeconds);

  startPolling(d.reference_id);
  fetchQrispyFeeAsync(d.reference_id, d.qris_id, saldoMasuk);
}

async function downloadQR() {
  var qrImg = $('qrImage');
  if (!qrImg) return;
  try {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var size = 600, padding = 40, topSpace = 60, bottomSpace = 60;
    canvas.width = size; canvas.height = size;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#2563eb';
    ctx.font = 'bold 24px "Inter", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('AsyrofOTP', size / 2, topSpace / 2);
    var img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise(function (resolve, reject) {
      img.onload = resolve; img.onerror = reject;
      img.src = qrImg.src;
    });
    var qrSize = size - (padding * 2);
    ctx.drawImage(img, padding, topSpace, qrSize, qrSize - (bottomSpace - topSpace) / 2);
    ctx.fillStyle = '#64748b';
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText((state.deposit && state.deposit.reference_id) || '', size / 2, size - bottomSpace / 2);
    var link = document.createElement('a');
    link.download = 'AsyrofOTP-QR-' + ((state.deposit && state.deposit.reference_id) || Date.now()) + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    window.open(qrImg.src, '_blank');
  }
}

async function fetchQrispyFeeAsync(referenceId, qrisId, saldoMasuk) {
  try {
    var transaction = null;
    try {
      var res = await fetchWithTimeout(_cfg.qrispyBase + '/api/payment/transactions?qris_id=' + qrisId);
      var data = await safeJson(res);
      if (Array.isArray(data.data)) {
        transaction = data.data.find(function (t) { return t.payment_reference === referenceId || t.qris_id === qrisId; });
      } else if (data.data && typeof data.data === 'object') {
        transaction = data.data;
      }
    } catch (e) {
      try {
        var res2 = await fetchWithTimeout(_cfg.qrispyBase + '/api/payment/qris/' + qrisId + '/status');
        var data2 = await safeJson(res2);
        transaction = data2.data;
      } catch (e2) {}
    }
    var feeEl = $('qrFee');
    var totalEl = $('qrTotal');
    var amountEl = $('qrAmount');
    if (transaction) {
      var totalBayar = Number(transaction.amount) || saldoMasuk;
      var fee = Math.max(0, totalBayar - saldoMasuk);
      if (feeEl) feeEl.textContent = formatRupiah(fee);
      if (totalEl) totalEl.textContent = formatRupiah(totalBayar);
      if (amountEl) amountEl.textContent = formatRupiah(totalBayar);
      state.deposit.total_amount = totalBayar;
      state.deposit.fee = fee;
      securePost('/api/deposit/' + referenceId + '/update-fee', { total_amount: totalBayar, fee: fee }, 'deposit_fee').catch(function () {});
    } else {
      if (feeEl) feeEl.textContent = 'Rp0';
      state.deposit.fee = 0;
    }
  } catch (err) {
    var fEl = $('qrFee'); if (fEl) fEl.textContent = 'Rp0';
  }
}

function startPolling(referenceId) {
  stopPolling();
  state.pollingInterval = setInterval(async function () {
    try {
      var res = await fetchWithTimeout(_cfg.ep.status + '/' + referenceId + '/status', {
        headers: { Authorization: 'Bearer ' + token }
      });
      var data = await safeJson(res);
      if (data.status === 'success' || (data.deposit && data.deposit.status === 'success')) {
        stopPolling(); stopCountdown(); showSuccess(data.deposit);
      } else if (data.deposit && data.deposit.status === 'expired') {
        stopPolling(); stopCountdown(); showExpired();
      }
    } catch (err) {}
  }, _cfg.pollInterval);
}
function stopPolling() {
  if (state.pollingInterval) { clearInterval(state.pollingInterval); state.pollingInterval = null; }
}

function startCountdown(seconds) {
  stopCountdown();
  var remaining = seconds;
  function tick() {
    if (state.expired) return;
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    var text = (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
    var el = $('countdownText');
    var cd = $('countdown');
    if (el) el.textContent = text;
    if (remaining <= 0) {
      if (cd) cd.classList.add('expired');
      if (el) el.textContent = 'EXPIRED';
      stopCountdown(); stopPolling(); showExpired();
      return;
    }
    remaining--;
  }
  tick();
  state.countdownInterval = setInterval(tick, 1000);
}
function stopCountdown() {
  if (state.countdownInterval) { clearInterval(state.countdownInterval); state.countdownInterval = null; }
}

function showExpired() {
  state.expired = true;
  stopPolling(); stopCountdown();
  setStep(3, true);
  if (state.deposit && state.deposit.reference_id) {
    securePost(_cfg.ep.status + '/' + state.deposit.reference_id + '/expire', {}, 'deposit_expire').catch(function () {});
  }
  var panelPayment = $('panelPayment');
  if (!panelPayment) return;
  panelPayment.innerHTML =
    '<div style="text-align:center;padding:32px 20px;">' +
      '<div class="success-icon expired">' + ICONS.clock + '</div>' +
      '<h2 style="font-size:1.3rem;font-weight:800;margin-bottom:8px;color:var(--txt);">QRIS Kedaluwarsa</h2>' +
      '<p style="color:var(--txt2);font-size:0.9rem;margin-bottom:24px;">Waktu pembayaran habis. Status deposit ini udah <strong>EXPIRED</strong>.</p>' +
      '<div class="detail-list" style="text-align:left;margin-bottom:16px;">' +
        '<div class="detail-row"><span class="detail-label">Reference ID</span><span class="detail-value">' + ((state.deposit && state.deposit.reference_id) || '—') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Status</span><span class="detail-value expired">EXPIRED</span></div>' +
      '</div>' +
      '<button class="btn btn-primary" type="button" onclick="window.resetDepositPanel()" style="width:100%;">' + ICONS.arrowRight + ' Buat Deposit Baru</button>' +
    '</div>';
  Cache.invalidate('history_');
  loadHistory(state.historyPage);
}

async function cancelDeposit() {
  if (!state.deposit) return;
  var ok = await customConfirm('Yakin mau batalkan deposit ini? Saldo belum terpotong kok.', 'warning', 'Batalkan Deposit');
  if (!ok) return;
  try {
    await securePost(_cfg.ep.status + '/' + state.deposit.reference_id + '/cancel', {}, 'deposit_cancel');
  } catch (err) {}
  stopPolling(); stopCountdown();
  resetPanel();
  Cache.invalidate('history_');
  loadHistory(state.historyPage);
}

function resetPanel() {
  stopPolling(); stopCountdown();
  state.expired = false;
  setStep(1);
  var pn = $('panelNominal'); if (pn) pn.style.display = 'block';
  var pp = $('panelPayment'); if (pp) { pp.style.display = 'none'; pp.innerHTML = ''; }
  state.deposit = null;
  state.method = null;
  state.methodLabel = null;
  if (btnLanjut) {
    btnLanjut.disabled = !state.amount;
    btnLanjut.innerHTML = ICONS.arrowRight + ' <span>Pilih Metode Pembayaran</span>';
  }
}
window.resetDepositPanel = resetPanel;

function showSuccess(deposit) {
  stopPolling(); stopCountdown();
  clearState();
  var saldoMasuk = Number(deposit.amount);
  var totalBayar = Number(deposit.total_amount) || Number(state.deposit && state.deposit.total_amount) || saldoMasuk;
  var fee = Number(deposit.fee) || Number(state.deposit && state.deposit.fee) || Math.max(0, totalBayar - saldoMasuk);

  var content = $('modalPaymentContent');
  if (!content) return;
  content.innerHTML =
    '<div class="modal-header">' +
      '<div class="modal-title">Deposit Berhasil</div>' +
      '<button class="modal-close" type="button" data-modal-close>' + ICONS.close + '</button>' +
    '</div>' +
    '<div style="padding:20px;text-align:center;">' +
      '<div class="success-icon">' + ICONS.check + '</div>' +
      '<h2 style="font-size:1.4rem;font-weight:800;margin-bottom:8px;color:var(--txt);">Deposit Berhasil!</h2>' +
      '<p style="color:var(--txt2);font-size:0.9rem;margin-bottom:20px;">Saldo <strong style="color:var(--p);">' + formatRupiah(saldoMasuk) + '</strong> udah masuk ke akun kamu.</p>' +
      '<div class="detail-list" style="text-align:left;">' +
        '<div class="detail-row"><span class="detail-label">Reference ID</span><span class="detail-value">' + (deposit.reference_id || '—') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Metode</span><span class="detail-value">QRIS Otomatis</span></div>' +
        '<div class="detail-row"><span class="detail-label">Total Bayar</span><span class="detail-value">' + formatRupiah(totalBayar) + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Fee</span><span class="detail-value warning">' + formatRupiah(fee) + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Saldo Masuk</span><span class="detail-value success">' + formatRupiah(saldoMasuk) + '</span></div>' +
      '</div>' +
      '<button class="btn btn-primary" id="btnSelesai" type="button" style="margin-top:16px;width:100%;">' + ICONS.check + ' Selesai</button>' +
    '</div>';
  openModal('modalPayment');
  var btnSelesai = $('btnSelesai');
  if (btnSelesai) {
    btnSelesai.addEventListener('click', function () {
      closeModal('modalPayment');
      location.reload();
    });
  }
  var closeBtn = content.querySelector('[data-modal-close]');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      closeModal('modalPayment');
      location.reload();
    });
  }

  Cache.remove('user');
  Cache.invalidate('history_');
  loadHistory(state.historyPage);
  setTimeout(function () { loadUser(true); }, 500);
}

async function loadHistory(page) {
  page = page || 1;
  state.historyPage = page;
  var container = $('historyList');
  if (!container) return;
  var cacheKey = 'history_p' + page;
  var cached = await Cache.get(cacheKey, _cfg.ttl.history);
  if (cached && cached.deposits) renderHistory(cached, page);
  else renderHistorySkeleton();

  try {
    var res = await fetchWithTimeout(_cfg.ep.history + '?page=' + page + '&limit=' + state.historyLimit, {
      headers: { Authorization: 'Bearer ' + token }
    });
    var data = await safeJson(res);
    if (!data.deposits) { renderHistoryEmpty(); return; }
    await Cache.set(cacheKey, data);
    renderHistory(data, page);
    var pendingIds = data.deposits
      .filter(function (d) { return d.status === 'pending'; })
      .map(function (d) { return d.reference_id; });
    if (pendingIds.length > 0) syncVisibleDeposits(pendingIds, page);
  } catch (err) {
    if (!cached) {
      container.innerHTML =
        '<div class="empty-inbox">' +
          '<div class="icon-box">' + ICONS.warning + '</div>' +
          '<h3>Gagal memuat riwayat</h3>' +
          '<p>' + (err.message || 'Coba refresh halaman') + '</p>' +
        '</div>';
    }
  }
}

function renderHistory(data, page) {
  var container = $('historyList');
  var paginationEl = $('pagination');
  if (!container) return;
  if (!data.deposits || data.deposits.length === 0) { renderHistoryEmpty(); return; }

  var statusMap = {
    success: { class: 'success', label: 'Berhasil', icon: ICONS.check },
    pending: { class: 'pending', label: 'Pending', icon: ICONS.clock },
    failed: { class: 'failed', label: 'Gagal', icon: ICONS.close },
    cancelled: { class: 'cancelled', label: 'Dibatalkan', icon: ICONS.close },
    expired: { class: 'expired', label: 'Expired', icon: ICONS.clock }
  };

  var now = Date.now();
  container.innerHTML = '<div class="history-list">' + data.deposits.map(function (d) {
    var s = statusMap[d.status] || { class: 'pending', label: d.status, icon: ICONS.clock };
    var methodLabel = 'QRIS Otomatis';
    var created = new Date(d.created_at).getTime();
    var diff = Math.floor((now - created) / 1000);
    var relativeTime = '';
    if (diff < 60) relativeTime = diff + 's lalu';
    else if (diff < 3600) relativeTime = Math.floor(diff / 60) + 'm lalu';
    else if (diff < 86400) relativeTime = Math.floor(diff / 3600) + 'j lalu';
    else relativeTime = Math.floor(diff / 86400) + 'h lalu';
    var badgeClass = s.class === 'success' ? 'success' : s.class === 'pending' ? 'warning' : (s.class === 'expired' ? 'gray' : 'danger');
    return '<button class="history-card ' + s.class + '" type="button" data-deposit=\'' + JSON.stringify(d).replace(/'/g, '&apos;') + '\' data-ref="' + d.reference_id + '">' +
      '<div class="history-icon ' + s.class + '">' + s.icon + '</div>' +
      '<div class="history-info">' +
        '<div class="history-title">' + methodLabel + '</div>' +
        '<div class="history-meta">' + relativeTime + ' · ' + (d.reference_id || '—') + '</div>' +
      '</div>' +
      '<div class="history-right">' +
        '<div class="history-amount">' + formatRupiah(d.total_amount || d.amount) + '</div>' +
        '<span class="badge ' + badgeClass + '">' + s.label + '</span>' +
      '</div>' +
    '</button>';
  }).join('') + '</div>';

  if (paginationEl && data.totalPages > 1) {
    paginationEl.style.display = 'flex';
    paginationEl.innerHTML =
      '<button class="page-btn" type="button" data-page="' + (page - 1) + '" ' + (!data.hasPrev ? 'disabled' : '') + '>' + ICONS.arrowLeft + ' Prev</button>' +
      '<span class="page-info">Halaman ' + data.page + ' dari ' + data.totalPages + '</span>' +
      '<button class="page-btn" type="button" data-page="' + (page + 1) + '" ' + (!data.hasNext ? 'disabled' : '') + '>Next ' + ICONS.arrowRight + '</button>';
    paginationEl.querySelectorAll('.page-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = Number(btn.dataset.page);
        if (p >= 1 && p <= data.totalPages) {
          loadHistory(p);
          var section = document.querySelector('.history-section');
          if (section) window.scrollTo({ top: section.offsetTop - 100, behavior: 'smooth' });
        }
      });
    });
  } else if (paginationEl) {
    paginationEl.style.display = 'none';
  }

  container.querySelectorAll('.history-card').forEach(function (card) {
    card.addEventListener('click', function () {
      try {
        var deposit = JSON.parse(card.dataset.deposit.replace(/&apos;/g, "'"));
        showDetailModal(deposit);
      } catch (e) {}
    });
  });
}

function renderHistorySkeleton() {
  var container = $('historyList');
  if (!container) return;
  container.innerHTML =
    '<div class="history-list">' +
      Array(3).fill(0).map(function () {
        return '<div class="history-card" style="pointer-events:none;opacity:0.6;">' +
          '<div class="history-icon" style="background:rgba(10,132,255,0.08);"><span class="spinner-sm"></span></div>' +
          '<div class="history-info">' +
            '<div class="skel" style="height:14px;width:60%;margin-bottom:6px;"></div>' +
            '<div class="skel" style="height:11px;width:80%;"></div>' +
          '</div>' +
          '<div class="history-right">' +
            '<div class="skel" style="height:14px;width:70px;margin-bottom:6px;"></div>' +
            '<div class="skel" style="height:18px;width:60px;border-radius:50px;"></div>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
}

function renderHistoryEmpty() {
  var container = $('historyList');
  var paginationEl = $('pagination');
  if (!container) return;
  container.innerHTML =
    '<div class="empty-inbox">' +
      '<div class="icon-box">' + ICONS.wallet + '</div>' +
      '<h3>Belum ada riwayat deposit</h3>' +
      '<p>Deposit pertama kamu bakal muncul di sini.</p>' +
    '</div>';
  if (paginationEl) paginationEl.style.display = 'none';
}

async function syncVisibleDeposits(referenceIds, page) {
  if (!referenceIds || referenceIds.length === 0) return;
  try {
    var res = await securePost(_cfg.ep.syncBatch, { reference_ids: referenceIds }, 'deposit_sync');
    var data = await safeJson(res);
    if (!data.updated || data.updated.length === 0) return;
    var cacheKey = 'history_p' + page;
    var cached = await Cache.get(cacheKey);
    if (cached && cached.deposits) {
      var updatedMap = new Map(data.updated.map(function (d) { return [d.reference_id, d]; }));
      cached.deposits = cached.deposits.map(function (d) { return updatedMap.get(d.reference_id) || d; });
      await Cache.set(cacheKey, cached);
      renderHistory(cached, page);
      var hasSuccess = data.updated.some(function (d) { return d.status === 'success'; });
      if (hasSuccess) {
        Cache.remove('user');
        loadUser(true);
      }
    }
  } catch (err) {}
}

async function showDetailModal(d) {
  var cacheKey = 'history_p' + state.historyPage;
  var cached = await Cache.get(cacheKey);
  if (cached && cached.deposits) {
    var fresh = cached.deposits.find(function (x) { return x.reference_id === d.reference_id; });
    if (fresh) d = Object.assign({}, d, fresh);
  }

  var statusMap = {
    success: { class: 'success', label: 'BERHASIL', icon: ICONS.check },
    pending: { class: 'pending', label: 'PENDING', icon: ICONS.clock },
    failed: { class: 'failed', label: 'GAGAL', icon: ICONS.close },
    cancelled: { class: 'cancelled', label: 'DIBATALKAN', icon: ICONS.close },
    expired: { class: 'expired', label: 'EXPIRED', icon: ICONS.clock }
  };
  var s = statusMap[d.status] || { class: 'pending', label: (d.status || '—').toUpperCase(), icon: ICONS.clock };
  var methodLabel = 'QRIS Otomatis';
  var saldoMasuk = Number(d.amount);
  var totalBayar = Number(d.total_amount) || saldoMasuk;
  var fee = Number(d.fee) || Math.max(0, totalBayar - saldoMasuk);

  function formatDate(date) {
    if (!date) return '—';
    try {
      return new Date(date).toLocaleString('id-ID', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch (e) { return '—'; }
  }

  var feeLoading = fee === 0 && d.status !== 'expired' && d.status !== 'cancelled' && d.status !== 'failed';
  var showQr = d.status === 'pending' && d.qris_url;

  var content = $('modalDetailContent');
  if (!content) return;
  content.innerHTML =
    '<div class="modal-header">' +
      '<div class="modal-title">Detail Deposit</div>' +
      '<button class="modal-close" type="button" data-modal-close>' + ICONS.close + '</button>' +
    '</div>' +
    '<div style="padding:20px;">' +
      '<div class="detail-header">' +
        '<div class="detail-icon ' + s.class + '">' + s.icon + '</div>' +
        '<h2>' + formatRupiah(saldoMasuk) + '</h2>' +
        '<p>' + methodLabel + '</p>' +
      '</div>' +
      (showQr ?
        '<div class="detail-qr-preview">' +
          '<div class="qr-wrapper"><img src="' + d.qris_url + '" alt="QR Code" id="detailQrImage" crossorigin="anonymous"></div>' +
          '<button class="btn-download-qr" id="btnDownloadDetailQr" type="button" style="margin-top:12px;">' + ICONS.download + ' Download QR</button>' +
        '</div>' : '') +
      '<div class="detail-list">' +
        '<div class="detail-row"><span class="detail-label">Reference ID</span><span class="detail-value">' + (d.reference_id || '—') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Status</span><span class="detail-value ' + s.class + '">' + s.label + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Metode</span><span class="detail-value">' + methodLabel + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Saldo Top Up</span><span class="detail-value">' + formatRupiah(saldoMasuk) + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Fee</span><span class="detail-value warning" id="detailFee">' + (feeLoading ? '<span class="inline-loader"></span>' : formatRupiah(fee)) + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Total Bayar</span><span class="detail-value highlight" id="detailTotal">' + formatRupiah(totalBayar) + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Saldo Diterima</span><span class="detail-value success">' + formatRupiah(saldoMasuk) + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Dibuat</span><span class="detail-value" style="font-size:0.78rem;">' + formatDate(d.created_at) + '</span></div>' +
        (d.expires_at ? '<div class="detail-row"><span class="detail-label">Kedaluwarsa</span><span class="detail-value" style="font-size:0.78rem;">' + formatDate(d.expires_at) + '</span></div>' : '') +
        (d.paid_at ? '<div class="detail-row"><span class="detail-label">Dibayar</span><span class="detail-value success" style="font-size:0.78rem;">' + formatDate(d.paid_at) + '</span></div>' : '') +
      '</div>' +
      '<div class="detail-actions">' +
        '<button class="btn btn-primary" type="button" id="btnCopyRef" style="width:100%;">' + ICONS.copy + ' Copy Reference ID</button>' +
      '</div>' +
    '</div>';

  openModal('modalDetail');
  var closeBtn = content.querySelector('[data-modal-close]');
  if (closeBtn) closeBtn.addEventListener('click', function () { closeModal('modalDetail'); });

  var btnCopyRef = $('btnCopyRef');
  if (btnCopyRef) {
    btnCopyRef.addEventListener('click', async function () {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(d.reference_id || '');
        } else {
          var ta = document.createElement('textarea');
          ta.value = d.reference_id || '';
          ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        var original = btnCopyRef.innerHTML;
        btnCopyRef.innerHTML = ICONS.check + ' Copied!';
        setTimeout(function () { btnCopyRef.innerHTML = original; }, 1500);
      } catch (e) {}
    });
  }

  var btnDownload = $('btnDownloadDetailQr');
  if (btnDownload) btnDownload.addEventListener('click', function () { downloadQRDetail(); });

  if (feeLoading && d.qris_id) {
    try {
      var transaction = null;
      try {
        var res = await fetchWithTimeout(_cfg.qrispyBase + '/api/payment/transactions?qris_id=' + d.qris_id);
        var data = await safeJson(res);
        if (Array.isArray(data.data)) {
          transaction = data.data.find(function (t) { return t.payment_reference === d.reference_id || t.qris_id === d.qris_id; });
        } else if (data.data && typeof data.data === 'object') {
          transaction = data.data;
        }
      } catch (e) {
        try {
          var res2 = await fetchWithTimeout(_cfg.qrispyBase + '/api/payment/qris/' + d.qris_id + '/status');
          var data2 = await safeJson(res2);
          transaction = data2.data;
        } catch (e2) {}
      }
      var feeEl = $('detailFee');
      var totalEl = $('detailTotal');
      if (transaction) {
        var total = Number(transaction.amount) || totalBayar;
        var feeCalc = Math.max(0, total - saldoMasuk);
        if (feeEl) feeEl.textContent = formatRupiah(feeCalc);
        if (totalEl) totalEl.textContent = formatRupiah(total);
        securePost('/api/deposit/' + d.reference_id + '/update-fee', { total_amount: total, fee: feeCalc }, 'deposit_fee').catch(function () {});
      } else {
        if (feeEl) feeEl.textContent = 'Rp0';
      }
    } catch (err) {
      var fEl = $('detailFee');
      if (fEl) fEl.textContent = 'Rp0';
    }
  }
}

async function downloadQRDetail() {
  var qrImg = $('detailQrImage');
  if (!qrImg) return;
  try {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var size = 600, padding = 40, topSpace = 60, bottomSpace = 60;
    canvas.width = size; canvas.height = size;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#2563eb';
    ctx.font = 'bold 24px "Inter", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('AsyrofOTP', size / 2, topSpace / 2);
    var img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise(function (resolve, reject) {
      img.onload = resolve; img.onerror = reject;
      img.src = qrImg.src;
    });
    var qrSize = size - (padding * 2);
    ctx.drawImage(img, padding, topSpace, qrSize, qrSize - (bottomSpace - topSpace) / 2);
    var refEl = document.querySelector('#modalDetailContent .detail-row .detail-value');
    ctx.fillStyle = '#64748b';
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText((refEl && refEl.textContent) || '', size / 2, size - bottomSpace / 2);
    var link = document.createElement('a');
    link.download = 'AsyrofOTP-QR-' + Date.now() + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    window.open(qrImg.src, '_blank');
  }
}

async function handleLogout() {
  try {
    await fetchWithTimeout(_cfg.ep.logout, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    });
  } catch (e) {}
  Cache.clear();
  try {
    SafeStorage.local.remove('access_token');
    SafeStorage.local.remove('user');
    SafeStorage.local.remove('refresh_token');
  } catch (e) {}
  location.href = '/landing';
}

var logoutBtn = $('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async function () {
    var ok = await customConfirm('Yakin mau keluar dari akun ini?', 'warning', 'Keluar Akun?');
    if (ok) handleLogout();
  });
}

if (btnLanjut) {
  btnLanjut.addEventListener('click', function () {
    if (!state.amount || state.amount < 1000) return;
    setStep(2);
    openModal('modalMethod');
  });
}

document.addEventListener('click', function (e) {
  var closeBtn = e.target.closest('[data-modal-close]');
  if (closeBtn) {
    e.preventDefault(); e.stopPropagation();
    var modal = closeBtn.closest('.modal-overlay');
    if (modal) {
      closeModal(modal.id);
      if (modal.id === 'modalMethod' && !state.method) setStep(1);
    }
    return;
  }
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    closeModal(e.target.id);
    if (e.target.id === 'modalMethod' && !state.method) setStep(1);
  }
});

document.addEventListener('touchstart', function (e) {
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    e.preventDefault();
    closeModal(e.target.id);
    if (e.target.id === 'modalMethod' && !state.method) setStep(1);
  }
}, { passive: false });

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    var active = document.querySelector('.modal-overlay.active');
    if (active) {
      closeModal(active.id);
      if (active.id === 'modalMethod' && !state.method) setStep(1);
    }
  }
});

(function init() {
  restoreState();
  updateButton();
  loadUser(false);
  loadPresets();
  loadMethods();
  loadHistory(1);
})();

document.addEventListener('visibilitychange', function () {
  if (!document.hidden) {
    loadUser(false);
    loadHistory(state.historyPage);
  }
});

function _cleanup() {
  stopPolling(); stopCountdown();
}
window.addEventListener('pagehide', _cleanup);
window.addEventListener('beforeunload', _cleanup);

})(window);
