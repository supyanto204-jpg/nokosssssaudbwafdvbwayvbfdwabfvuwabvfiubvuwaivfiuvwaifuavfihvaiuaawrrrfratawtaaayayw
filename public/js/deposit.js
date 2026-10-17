/* ============================================================
   DEPOSIT.JS — v6 FINAL
   - SafeStorage (Safari Private Mode)
   - Encrypted cache (AES-GCM + PBKDF2)
   - Fetch timeout
   - Sidebar toggle touch
   - pagehide iOS
   ============================================================ */
(function (global) {
  'use strict';

  /* §0 — SAFE STORAGE */
  const SafeStorage = (() => {
    let ls = null, ss = null;
    try { ls = window.localStorage; ls.setItem('__t','1'); ls.removeItem('__t'); } catch(e) { ls = null; }
    try { ss = window.sessionStorage; ss.setItem('__t','1'); ss.removeItem('__t'); } catch(e) { ss = null; }
    const mem = new Map();
    function wrap(store, prefix) {
      return {
        get(k) { try { return store ? store.getItem(prefix+k) : (mem.get(prefix+k) ?? null); } catch(e) { return mem.get(prefix+k) ?? null; } },
        set(k,v) { try { if(store) store.setItem(prefix+k,v); else mem.set(prefix+k,v); } catch(e) { mem.set(prefix+k,v); } },
        remove(k) { try { if(store) store.removeItem(prefix+k); else mem.delete(prefix+k); } catch(e) { mem.delete(prefix+k); } },
        keys() { try { return store ? Object.keys(store) : Array.from(mem.keys()); } catch(e) { return Array.from(mem.keys()); } },
      };
    }
    return { local: wrap(ls,''), session: wrap(ss,'') };
  })();

  /* §1 — CRYPTO */
  const _crypto = (() => {
    const _k = 'ZGVwb3NpdC1zZWNyZXQta2V5LTIwMjYtYXN5cm9m';
    const _s = 'c2FsdC1kZXBvc2l0LXYyMDI2LXNlY3VyZQ==';
    const _i = 100000;
    let _dk = null;
    const supported = (() => {
      try { return !!(global.crypto && global.crypto.subtle && global.crypto.getRandomValues); }
      catch(e) { return false; }
    })();

    async function _derive() {
      if (_dk) return _dk;
      const enc = new TextEncoder();
      const base = await crypto.subtle.importKey(
        'raw', enc.encode(atob(_k)), { name: 'PBKDF2' }, false, ['deriveKey']
      );
      _dk = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(atob(_s)), iterations: _i, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      return _dk;
    }
    function _b2buf(b64) {
      const bin = atob(b64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u.buffer;
    }
    function _buf2b(buf) {
      const b = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      return btoa(s);
    }
    function _fallbackSeal(obj) {
      try { return 'fb:' + btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
      catch(e) { return null; }
    }
    function _fallbackUnseal(b64) {
      try { return JSON.parse(decodeURIComponent(escape(atob(b64.slice(3))))); }
      catch(e) { return null; }
    }
    async function seal(obj) {
      if (!supported) return _fallbackSeal(obj);
      try {
        const key = await _derive();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const c = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))
        );
        const comb = new Uint8Array(iv.length + c.byteLength);
        comb.set(iv, 0);
        comb.set(new Uint8Array(c), iv.length);
        return _buf2b(comb.buffer);
      } catch(e) { return _fallbackSeal(obj); }
    }
    async function unseal(b64) {
      if (!b64) return null;
      if (b64.indexOf('fb:') === 0) return _fallbackUnseal(b64);
      if (!supported) return null;
      try {
        const key = await _derive();
        const buf = _b2buf(b64);
        const iv = buf.slice(0, 12);
        const data = buf.slice(12);
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(iv) }, key, data
        );
        return JSON.parse(new TextDecoder().decode(plain));
      } catch(e) { return null; }
    }
    return { seal, unseal, supported };
  })();

  /* §2 — CACHE (encrypted) */
  const Cache = (() => {
    const P = 'aotp_d_';
    const _mem = new Map();
    async function get(key, ttl) {
      if (_mem.has(key)) {
        const e = _mem.get(key);
        if (!ttl || Date.now() - e.t < ttl) return e.v;
        _mem.delete(key);
      }
      try {
        const raw = SafeStorage.local.get(P + key);
        if (!raw) return null;
        const e = await _crypto.unseal(raw);
        if (!e) return null;
        if (ttl && Date.now() - e.t > ttl) {
          SafeStorage.local.remove(P + key);
          return null;
        }
        _mem.set(key, e);
        return e.v;
      } catch(err) { return null; }
    }
    async function set(key, v) {
      const e = { t: Date.now(), v };
      _mem.set(key, e);
      try {
        const s = await _crypto.seal(e);
        if (s) SafeStorage.local.set(P + key, s);
      } catch(err) {}
    }
    function remove(key) {
      _mem.delete(key);
      try { SafeStorage.local.remove(P + key); } catch(e) {}
    }
    function invalidate(prefix) {
      _mem.forEach((_, k) => { if (k.startsWith(prefix)) _mem.delete(k); });
      try {
        SafeStorage.local.keys().forEach(k => {
          if (k.startsWith(P + prefix)) SafeStorage.local.remove(k);
        });
      } catch(e) {}
    }
    function clear() {
      _mem.clear();
      try {
        SafeStorage.local.keys().forEach(k => {
          if (k.startsWith(P)) SafeStorage.local.remove(k);
        });
      } catch(e) {}
    }
    return { get, set, remove, invalidate, clear };
  })();

  /* §3 — CONFIG */
  const _cfg = {
    rk: '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg',
    ep: {
      user: '/api/user',
      presets: '/api/deposit/presets',
      methods: '/api/deposit/methods',
      history: '/api/deposit/history',
      generateRef: '/api/deposit/generate-ref',
      qrispySave: '/api/deposit/qrispy-save',
      qrisDana: '/api/deposit/qris-dana',
      status: '/api/deposit',
      syncBatch: '/api/deposit/sync-batch',
      logout: '/api/auth/logout',
    },
    qrispyBase: 'https://cloudflareworkerdeploydidashcloudflarecomexportdef.rahayucahyapurwa.workers.dev',
    ttl: {
      user: 5 * 60 * 1000,
      presets: 30 * 60 * 1000,
      methods: 30 * 60 * 1000,
      history: 60 * 1000,
    },
    historyLimit: 5,
    pollInterval: 3000,
    fetchTimeout: 15000,
  };

  /* §4 — DEVICE */
  const _dev = (() => {
    const mq = (q) => { try { return window.matchMedia(q).matches; } catch(e) { return false; } };
    const hc = navigator.hardwareConcurrency || 4;
    const conn = navigator.connection || {};
    return {
      mobile: mq('(max-width: 768px)'),
      lowEnd: hc <= 4 || conn.saveData || /2g|slow-2g/.test(conn.effectiveType || ''),
      reduced: mq('(prefers-reduced-motion: reduce)'),
    };
  })();

  /* §5 — SECURITY soft */
  (function () {
    try {
      console.log('%c⚠️ STOP!', 'color:#ff3b30;font-size:20px;font-weight:900');
      console.log('%cJangan paste apapun di sini. Itu SCAM.', 'color:#8e8e93;font-size:12px');
    } catch(e) {}
    document.addEventListener('copy', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (t && t.closest && t.closest('[data-copy]')) return;
      e.preventDefault();
    });
    document.addEventListener('cut', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
    });
    try {
      const clean = location.origin + location.pathname;
      if (location.search) history.replaceState(null, '', clean);
    } catch(e) {}
  })();

  /* §6 — AUTH */
  let token = null;
  try { token = SafeStorage.local.get('access_token'); } catch(e) { token = null; }
  if (!token) {
    location.href = '/login';
    return;
  }

  /* §7 — HELPERS */
  function $(id) { return document.getElementById(id); }

  function safeJson(res) {
    return res.json().catch(() => ({}));
  }

  function fetchWithTimeout(url, opts = {}, ms = _cfg.fetchTimeout) {
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    const o = Object.assign({}, opts);
    if (ctrl) o.signal = ctrl.signal;
    return fetch(url, o).finally(() => { if (timer) clearTimeout(timer); });
  }

  function formatRupiah(n) {
    const v = Number(n) || 0;
    return 'Rp' + v.toLocaleString('id-ID');
  }
  function getInitial(name) {
    return String(name || '?').trim().charAt(0).toUpperCase() || '?';
  }

  /* §8 — ICONS */
  const ICONS = {
    qrispy: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    dana: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><circle cx="17" cy="15" r="1.5" fill="currentColor"/></svg>',
    check: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    close: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    clock: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    warning: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    arrowRight: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    arrowLeft: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    wallet: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>',
    copy: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    download: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  };

  /* §9 — RECAPTCHA */
  function waitForRecaptcha() {
    return new Promise((resolve) => {
      if (window.grecaptcha && window.grecaptcha.execute) return resolve();
      let n = 0;
      const t = setInterval(() => {
        n++;
        if (window.grecaptcha && window.grecaptcha.execute) {
          clearInterval(t); resolve();
        } else if (n >= 50) {
          clearInterval(t); resolve();
        }
      }, 100);
    });
  }
  async function getRecaptchaToken(action) {
    try {
      await waitForRecaptcha();
      if (!window.grecaptcha || !window.grecaptcha.execute) return null;
      return await new Promise((resolve) => {
        grecaptcha.ready(() => {
          grecaptcha.execute(_cfg.rk, { action }).then(resolve).catch(() => resolve(null));
        });
        setTimeout(() => resolve(null), 8000);
      });
    } catch(e) { return null; }
  }
  async function securePost(url, body = {}, action = 'deposit') {
    const rc = await getRecaptchaToken(action);
    return fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ ...body, recaptcha_token: rc }),
    });
  }

  /* §10 — CUSTOM ALERT */
  function showCustomAlert({ title, message, type = 'info', okText = 'OK', showCancel = false, cancelText = 'Batal' }) {
    return new Promise((resolve) => {
      const overlay = $('customAlert');
      if (!overlay) { resolve(window.confirm(message || title || 'OK')); return; }
      const iconEl = $('customAlertIcon');
      const titleEl = $('customAlertTitle');
      const msgEl = $('customAlertMessage');
      const actionsEl = $('customAlertActions');
      if (!iconEl || !titleEl || !msgEl || !actionsEl) { resolve(false); return; }

      iconEl.className = 'custom-alert-icon ' + type;
      const iconMap = { success: ICONS.check, warning: ICONS.warning, danger: ICONS.close, error: ICONS.close, info: ICONS.info };
      iconEl.innerHTML = iconMap[type] || ICONS.info;
      titleEl.textContent = title || 'Informasi';
      msgEl.textContent = message || '';

      actionsEl.innerHTML = '';
      if (showCancel) {
        const b = document.createElement('button');
        b.className = 'btn';
        b.type = 'button';
        b.textContent = cancelText;
        b.addEventListener('click', () => { overlay.classList.remove('active'); resolve(false); });
        actionsEl.appendChild(b);
      }
      const ok = document.createElement('button');
      ok.className = 'btn btn-primary';
      ok.type = 'button';
      ok.textContent = okText;
      ok.addEventListener('click', () => { overlay.classList.remove('active'); resolve(true); });
      actionsEl.appendChild(ok);
      overlay.classList.add('active');
    });
  }
  function customAlert(message, type = 'info', title = null) {
    const titles = { success: 'Berhasil', warning: 'Perhatian', danger: 'Error', info: 'Informasi' };
    return showCustomAlert({ title: title || titles[type] || 'Informasi', message, type });
  }
  function customConfirm(message, type = 'warning', title = 'Konfirmasi') {
    return showCustomAlert({ title, message, type, okText: 'Ya', showCancel: true, cancelText: 'Batal' });
  }

  /* §11 — THEME */
  (function () {
    const btn = $('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      const nx = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nx);
      try { SafeStorage.local.set('asyrofotp_theme', nx); } catch(e) {}
      const m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', nx === 'dark' ? '#0a0a0c' : '#0a84ff');
    });
  })();

  /* §12 — SIDEBAR (desktop collapse) */
  (function () {
    const sidebar = $('sidebar');
    const collapseBtn = $('collapseBtn');
    if (!sidebar || !collapseBtn) return;
    const isCollapsed = SafeStorage.local.get('sidebar_collapsed') === 'true';
    if (isCollapsed && window.innerWidth > 768) {
      sidebar.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    }
    collapseBtn.addEventListener('click', () => {
      if (window.innerWidth <= 768) return;
      const c = sidebar.classList.toggle('collapsed');
      document.body.classList.toggle('sidebar-collapsed', c);
      try { SafeStorage.local.set('sidebar_collapsed', c); } catch(e) {}
    });
  })();

  /* §13 — SIDEBAR (mobile toggle) */
  (function () {
    const toggle = $('mobileToggle');
    const sidebar = $('sidebar');
    const overlay = $('sidebarOverlay');
    if (!toggle || !sidebar || !overlay) return;

    let open = false;
    let lastToggle = 0;

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
      const now = Date.now();
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

    sidebar.querySelectorAll('.nav-item').forEach(l => {
      l.addEventListener('click', () => {
        if (window.innerWidth <= 768) setTimeout(closeSb, 100);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) closeSb();
    });

    let rt = null;
    window.addEventListener('resize', () => {
      if (rt) clearTimeout(rt);
      rt = setTimeout(() => {
        if (window.innerWidth > 768 && open) closeSb();
      }, 150);
    });
  })();

  /* §14 — STATE */
  const state = {
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
    historyLoaded: false,
  };

  /* §15 — LOAD USER */
  async function loadUser(force = false) {
    if (!force) {
      const cached = await Cache.get('user', _cfg.ttl.user);
      if (cached) renderUser(cached);
    }
    try {
      const res = await fetchWithTimeout(_cfg.ep.user, {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (res.status === 401 || res.status === 403) { handleLogout(); return; }
      const user = await safeJson(res);
      if (user && !user.error) {
        await Cache.set('user', user);
        renderUser(user);
      }
    } catch(e) {}
  }
  function renderUser(user) {
    if (!user) return;
    const name = user.name || user.username || '—';
    const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    set('userName', name);
    set('userBalance', formatRupiah(user.balance));
    set('userInitial', getInitial(name));
    set('balancePill', formatRupiah(user.balance));
    set('saldoSekarang', formatRupiah(user.balance));
  }

  /* §16 — LOAD PRESETS */
  async function loadPresets() {
    const cached = await Cache.get('presets', _cfg.ttl.presets);
    if (cached && cached.length > 0) {
      state.presets = cached;
      renderPresets();
    }
    try {
      const res = await fetchWithTimeout(_cfg.ep.presets, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await safeJson(res);
      state.presets = data.presets || [];
      if (state.presets.length > 0) await Cache.set('presets', state.presets);
      renderPresets();
    } catch(err) {
      if (!cached) {
        state.presets = [
          { amount: 10000, label: 'Rp10.000' },
          { amount: 20000, label: 'Rp20.000' },
          { amount: 50000, label: 'Rp50.000' },
          { amount: 100000, label: 'Rp100.000' },
          { amount: 200000, label: 'Rp200.000' },
          { amount: 500000, label: 'Rp500.000' },
        ];
        renderPresets();
      }
    }
  }
  function renderPresets() {
    const grid = $('presetGrid');
    if (!grid) return;
    grid.innerHTML = state.presets.map(p =>
      `<button class="preset-item" type="button" data-amount="${p.amount}">${p.label}</button>`
    ).join('');
    grid.querySelectorAll('.preset-item').forEach(btn => {
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.preset-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const inp = $('inputAmount');
        if (inp) { inp.value = btn.dataset.amount; }
        state.amount = Number(btn.dataset.amount);
        updateButton();
        saveState();
      });
    });
  }

  /* §17 — INPUT */
  const inputAmount = $('inputAmount');
  const btnLanjut = $('btnLanjut');

  function updateButton() {
    if (!inputAmount || !btnLanjut) return;
    const val = Number(inputAmount.value);
    if (val >= 1000 && val <= 10000000) {
      btnLanjut.disabled = false;
      state.amount = val;
    } else {
      btnLanjut.disabled = true;
      state.amount = 0;
    }
  }

  if (inputAmount) {
    inputAmount.addEventListener('input', () => {
      document.querySelectorAll('.preset-item').forEach(b => b.classList.remove('active'));
      updateButton();
      saveState();
    });
  }

  /* §18 — STATE PERSIST */
  function restoreState() {
    try {
      const saved = SafeStorage.session.get('deposit_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.amount && inputAmount) {
          state.amount = parsed.amount;
          inputAmount.value = parsed.amount;
        }
      }
    } catch(e) {}
  }
  function saveState() {
    try { SafeStorage.session.set('deposit_state', JSON.stringify({ amount: state.amount })); } catch(e) {}
  }
  function clearState() {
    try { SafeStorage.session.remove('deposit_state'); } catch(e) {}
  }

  /* §19 — STEP INDICATOR */
  function setStep(step, expired = false) {
    ['step1', 'step2', 'step3'].forEach(id => {
      const el = $(id);
      if (el) el.classList.remove('active', 'done', 'expired');
    });
    const setIcon = (id, symbol) => {
      const el = $(id);
      if (el) el.textContent = symbol;
    };
    if (step === 1) {
      const s = $('step1'); if (s) s.classList.add('active');
      setIcon('step1Icon', '●'); setIcon('step2Icon', '●'); setIcon('step3Icon', '●');
    } else if (step === 2) {
      const s1 = $('step1'); if (s1) s1.classList.add('done');
      const s2 = $('step2'); if (s2) s2.classList.add('active');
      setIcon('step1Icon', '✓'); setIcon('step2Icon', '●'); setIcon('step3Icon', '●');
    } else if (step === 3) {
      const s1 = $('step1'); if (s1) s1.classList.add('done');
      const s2 = $('step2'); if (s2) s2.classList.add('done');
      const s3 = $('step3'); if (s3) s3.classList.add(expired ? 'expired' : 'active');
      setIcon('step1Icon', '✓'); setIcon('step2Icon', '✓'); setIcon('step3Icon', expired ? '✕' : '●');
    }
  }

  /* §20 — MODAL */
  function openModal(id) {
    const m = $(id);
    if (m) {
      m.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }
  function closeModal(id) {
    const m = $(id);
    if (m) {
      m.classList.remove('active');
      if (!document.querySelector('.modal-overlay.active')) {
        document.body.style.overflow = '';
      }
    }
  }

  /* §21 — LOAD METHODS */
  async function loadMethods() {
    const grid = $('methodGrid');
    if (!grid) return;
    const cached = await Cache.get('methods', _cfg.ttl.methods);
    if (cached && cached.length > 0) renderMethods(cached);
    try {
      const res = await fetchWithTimeout(_cfg.ep.methods, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await safeJson(res);
      const list = data.methods || [];
      if (list.length > 0) await Cache.set('methods', list);
      renderMethods(list);
    } catch(err) {
      if (!cached) {
        grid.innerHTML = `<div class="empty-block"><h3>Gagal memuat</h3><p>${err.message}</p></div>`;
      }
    }
  }
  function renderMethods(list) {
    const grid = $('methodGrid');
    if (!grid) return;
    if (!list || list.length === 0) {
      grid.innerHTML = `<div class="empty-block"><h3>Belum ada metode</h3><p>Coba lagi nanti.</p></div>`;
      return;
    }
    grid.innerHTML = list.map(m => {
      const iconSvg = m.id === 'qrispy' ? ICONS.qrispy : ICONS.dana;
      const badge = m.id === 'qrispy'
        ? `<span class="method-badge">OTOMATIS</span>`
        : `<span class="method-badge warning">MANUAL</span>`;
      return `
        <button class="method-card" type="button" data-method="${m.id}" data-label="${m.label}">
          <div class="method-icon ${m.id === 'qrispy' ? 'qrispy' : 'dana'}">${iconSvg}</div>
          <div class="method-info">
            <div class="method-title">${m.label} ${badge}</div>
            <div class="method-desc">${m.desc}</div>
          </div>
        </button>
      `;
    }).join('');
    grid.querySelectorAll('.method-card').forEach(card => {
      card.addEventListener('click', () => {
        state.method = card.dataset.method;
        state.methodLabel = card.dataset.label;
        closeModal('modalMethod');
        setStep(3);
        createDeposit();
      });
    });
  }

  /* §22 — CREATE DEPOSIT */
  async function createDeposit() {
    if (state.isCreating) return;
    state.isCreating = true;
    state.expired = false;
    const btn = btnLanjut;
    const original = btn ? btn.innerHTML : '';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-sm"></span> Membuat QR...';
    }
    try {
      if (state.method === 'qrispy') {
        await createQrispyDeposit();
      } else if (state.method === 'qris_dana') {
        await createQrisDanaDeposit();
      }
    } catch(err) {
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
    const refRes = await securePost(_cfg.ep.generateRef, {}, 'deposit_ref');
    const refData = await safeJson(refRes);
    if (!refRes.ok || !refData.reference_id) throw new Error('Gagal generate reference ID');
    const referenceId = refData.reference_id;

    const qrispyRes = await fetchWithTimeout(`${_cfg.qrispyBase}/api/payment/qris/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Number(state.amount),
        payment_reference: referenceId,
      }),
    });
    const qrispyData = await safeJson(qrispyRes);
    if (!qrispyRes.ok || qrispyData.status === 'error') {
      throw new Error(qrispyData.message || 'Gagal membuat QRIS');
    }

    const saveRes = await securePost(_cfg.ep.qrispySave, {
      reference_id: referenceId,
      amount: Number(state.amount),
      qris_id: qrispyData.data.qris_id,
      qris_url: qrispyData.data.qris_image_url,
      expired_at: qrispyData.data.expired_at,
      expires_in_seconds: qrispyData.data.expires_in_seconds,
    }, 'deposit_save');
    const saveData = await safeJson(saveRes);
    if (!saveRes.ok) throw new Error(saveData.error || 'Gagal simpan deposit');
    state.deposit = saveData.deposit;
    showPaymentPanel();
  }

  async function createQrisDanaDeposit() {
    const res = await securePost(_cfg.ep.qrisDana, {
      amount: Number(state.amount)
    }, 'deposit_dana');
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Gagal membuat QRIS DANA');
    state.deposit = data.deposit;
    showPaymentPanel();
  }

  /* §23 — SHOW PAYMENT PANEL */
  function showPaymentPanel() {
    setStep(3);
    const panelNominal = $('panelNominal');
    const panelPayment = $('panelPayment');
    if (panelNominal) panelNominal.style.display = 'none';
    if (!panelPayment) return;
    panelPayment.style.display = 'block';

    const d = state.deposit;
    const isManual = state.method === 'qris_dana';
    const saldoMasuk = Number(d.amount);
    let fee, totalBayar;
    if (isManual) {
      fee = Number(d.unique_code) || Number(d.fee) || 0;
      totalBayar = Number(d.total_amount) || (saldoMasuk + fee);
    } else {
      fee = Number(d.fee) || 0;
      totalBayar = Number(d.total_amount) || saldoMasuk;
    }

    panelPayment.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
        <div class="countdown" id="countdown" style="margin-bottom:0;">
          ${ICONS.clock}
          <span id="countdownText">--:--</span>
        </div>
      </div>

      <div class="qr-display">
        <div class="qr-total">
          <div class="label">Total yang harus dibayar</div>
          <div class="amount" id="qrAmount">${formatRupiah(totalBayar)}</div>
        </div>
        <div class="qr-wrapper">
          <img src="${d.qris_url}" alt="QR Code" id="qrImage" crossorigin="anonymous">
        </div>
      </div>

      <div class="qr-info">
        <div class="qr-row">
          <span class="label">Reference ID</span>
          <span class="value">${d.reference_id}</span>
        </div>
        <div class="qr-row">
          <span class="label">Metode</span>
          <span class="value">${state.methodLabel}</span>
        </div>
        <div class="qr-row">
          <span class="label">Saldo Top Up</span>
          <span class="value">${formatRupiah(saldoMasuk)}</span>
        </div>
        ${isManual ? `
          <div class="qr-row">
            <span class="label">Kode Unik</span>
            <span class="value unique">+${d.unique_code}</span>
          </div>
        ` : ''}
        <div class="qr-row">
          <span class="label">Fee</span>
          <span class="value" id="qrFee">
            ${isManual ? formatRupiah(fee) : '<span class="inline-loader"></span>'}
          </span>
        </div>
        <div class="qr-row total-row">
          <span class="label">Total Bayar</span>
          <span class="value big" id="qrTotal">${formatRupiah(totalBayar)}</span>
        </div>
        <div class="qr-row">
          <span class="label">Saldo Diterima</span>
          <span class="value success">${formatRupiah(saldoMasuk)}</span>
        </div>
      </div>

      ${isManual ? `
        <div class="info-box">
          ${ICONS.warning}
          <span><strong>Penting:</strong> Transfer <strong>tepat ${formatRupiah(totalBayar)}</strong> (termasuk kode unik +${d.unique_code}). Kode unik dipakai buat verifikasi otomatis.</span>
        </div>
      ` : `
        <div class="polling-indicator">
          <span class="spinner-sm"></span>
          <span>Menunggu pembayaran... otomatis cek status</span>
        </div>
      `}

      <div class="payment-actions">
        <button class="btn-download-qr" id="btnDownloadQr" type="button">
          ${ICONS.download}
          Download QR
        </button>
        <button class="btn-cancel-red" id="btnCancel" type="button">
          ${ICONS.close}
          Batalkan
        </button>
      </div>
    `;

    const btnCancel = $('btnCancel'); if (btnCancel) btnCancel.addEventListener('click', cancelDeposit);
    const btnDownload = $('btnDownloadQr'); if (btnDownload) btnDownload.addEventListener('click', downloadQR);

    let countdownSeconds = d.expires_in_seconds || 1800;
    if (d.expired_at) {
      const expiresAt = new Date(d.expired_at).getTime();
      countdownSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
    }
    startCountdown(countdownSeconds);

    if (isManual) startManualExpiryCheck(d.reference_id);
    else {
      startPolling(d.reference_id);
      fetchQrispyFeeAsync(d.reference_id, d.qris_id, saldoMasuk);
    }
  }

  /* §24 — DOWNLOAD QR */
  async function downloadQR() {
    const qrImg = $('qrImage');
    if (!qrImg) return;
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const size = 600, padding = 40, topSpace = 60, bottomSpace = 60;
      canvas.width = size; canvas.height = size;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#2563eb';
      ctx.font = 'bold 24px "Inter", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('AsyrofOTP', size / 2, topSpace / 2);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve; img.onerror = reject;
        img.src = qrImg.src;
      });
      const qrSize = size - (padding * 2);
      ctx.drawImage(img, padding, topSpace, qrSize, qrSize - (bottomSpace - topSpace) / 2);
      ctx.fillStyle = '#64748b';
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(state.deposit?.reference_id || '', size / 2, size - bottomSpace / 2);
      const link = document.createElement('a');
      link.download = `AsyrofOTP-QR-${state.deposit?.reference_id || Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch(err) {
      window.open(qrImg.src, '_blank');
    }
  }

  /* §25 — FETCH QRISPY FEE */
  async function fetchQrispyFeeAsync(referenceId, qrisId, saldoMasuk) {
    try {
      let transaction = null;
      try {
        const res = await fetchWithTimeout(`${_cfg.qrispyBase}/api/payment/transactions?qris_id=${qrisId}`);
        const data = await safeJson(res);
        if (Array.isArray(data.data)) {
          transaction = data.data.find(t => t.payment_reference === referenceId || t.qris_id === qrisId);
        } else if (data.data && typeof data.data === 'object') {
          transaction = data.data;
        }
      } catch(e) {
        try {
          const res2 = await fetchWithTimeout(`${_cfg.qrispyBase}/api/payment/qris/${qrisId}/status`);
          const data2 = await safeJson(res2);
          transaction = data2.data;
        } catch(e2) {}
      }
      const feeEl = $('qrFee');
      const totalEl = $('qrTotal');
      const amountEl = $('qrAmount');
      if (transaction) {
        const totalBayar = Number(transaction.amount) || saldoMasuk;
        const fee = Math.max(0, totalBayar - saldoMasuk);
        if (feeEl) feeEl.textContent = formatRupiah(fee);
        if (totalEl) totalEl.textContent = formatRupiah(totalBayar);
        if (amountEl) amountEl.textContent = formatRupiah(totalBayar);
        state.deposit.total_amount = totalBayar;
        state.deposit.fee = fee;
        securePost(`/api/deposit/${referenceId}/update-fee`, { total_amount: totalBayar, fee }, 'deposit_fee').catch(() => {});
      } else {
        if (feeEl) feeEl.textContent = 'Rp0';
        state.deposit.fee = 0;
      }
    } catch(err) {
      const feeEl = $('qrFee'); if (feeEl) feeEl.textContent = 'Rp0';
    }
  }

  function startManualExpiryCheck(referenceId) {
    if (state._manualExpiryInterval) clearInterval(state._manualExpiryInterval);
    state._manualExpiryInterval = setInterval(async () => {
      if (state.expired) { clearInterval(state._manualExpiryInterval); return; }
      try {
        const res = await fetchWithTimeout(`${_cfg.ep.status}/${referenceId}/status`, {
          headers: { Authorization: 'Bearer ' + token }
        });
        const data = await safeJson(res);
        if (data.deposit?.status === 'expired') {
          clearInterval(state._manualExpiryInterval);
          stopCountdown();
          showExpired();
        }
      } catch(err) {}
    }, 30000);
  }

  function startPolling(referenceId) {
    stopPolling();
    state.pollingInterval = setInterval(async () => {
      try {
        const res = await fetchWithTimeout(`${_cfg.ep.status}/${referenceId}/status`, {
          headers: { Authorization: 'Bearer ' + token }
        });
        const data = await safeJson(res);
        if (data.status === 'success' || data.deposit?.status === 'success') {
          stopPolling(); stopCountdown(); showSuccess(data.deposit);
        } else if (data.deposit?.status === 'expired') {
          stopPolling(); stopCountdown(); showExpired();
        }
      } catch(err) {}
    }, _cfg.pollInterval);
  }

  function stopPolling() {
    if (state.pollingInterval) { clearInterval(state.pollingInterval); state.pollingInterval = null; }
    if (state._manualExpiryInterval) { clearInterval(state._manualExpiryInterval); state._manualExpiryInterval = null; }
  }

  function startCountdown(seconds) {
    stopCountdown();
    let remaining = seconds;
    function tick() {
      if (state.expired) return;
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      const text = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      const el = $('countdownText');
      const cd = $('countdown');
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

  /* §26 — SHOW EXPIRED */
  function showExpired() {
    state.expired = true;
    stopPolling(); stopCountdown();
    setStep(3, true);
    if (state.deposit?.reference_id) {
      securePost(`${_cfg.ep.status}/${state.deposit.reference_id}/expire`, {}, 'deposit_expire').catch(() => {});
    }
    const panelPayment = $('panelPayment');
    if (!panelPayment) return;
    panelPayment.innerHTML = `
      <div style="text-align:center;padding:32px 20px;">
        <div class="success-icon expired">${ICONS.clock}</div>
        <h2 style="font-size:1.3rem;font-weight:800;margin-bottom:8px;color:var(--txt);">QRIS Kedaluwarsa</h2>
        <p style="color:var(--txt2);font-size:0.9rem;margin-bottom:24px;">
          Waktu pembayaran habis. Status deposit ini udah <strong>EXPIRED</strong>.
        </p>
        <div class="detail-list" style="text-align:left;margin-bottom:16px;">
          <div class="detail-row">
            <span class="detail-label">Reference ID</span>
            <span class="detail-value">${state.deposit?.reference_id || '—'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Status</span>
            <span class="detail-value expired">EXPIRED</span>
          </div>
        </div>
        <button class="btn btn-primary" type="button" onclick="window.resetDepositPanel()" style="width:100%;">
          ${ICONS.arrowRight}
          Buat Deposit Baru
        </button>
      </div>
    `;
    Cache.invalidate('history_');
    loadHistory(state.historyPage);
  }

  async function cancelDeposit() {
    if (!state.deposit) return;
    const ok = await customConfirm('Yakin mau batalkan deposit ini? Saldo belum terpotong kok.', 'warning', 'Batalkan Deposit');
    if (!ok) return;
    try {
      await securePost(`${_cfg.ep.status}/${state.deposit.reference_id}/cancel`, {}, 'deposit_cancel');
    } catch(err) {}
    stopPolling(); stopCountdown();
    resetPanel();
    Cache.invalidate('history_');
    loadHistory(state.historyPage);
  }

  function resetPanel() {
    stopPolling(); stopCountdown();
    state.expired = false;
    setStep(1);
    const pn = $('panelNominal'); if (pn) pn.style.display = 'block';
    const pp = $('panelPayment'); if (pp) { pp.style.display = 'none'; pp.innerHTML = ''; }
    state.deposit = null;
    state.method = null;
    state.methodLabel = null;
    if (btnLanjut) {
      btnLanjut.disabled = !state.amount;
      btnLanjut.innerHTML = `${ICONS.arrowRight} <span>Pilih Metode Pembayaran</span>`;
    }
  }
  window.resetDepositPanel = resetPanel;

  /* §27 — SHOW SUCCESS */
  function showSuccess(deposit) {
    stopPolling(); stopCountdown();
    clearState();
    const saldoMasuk = Number(deposit.amount);
    const isManual = deposit.method === 'qris_dana';
    let totalBayar, fee;
    if (isManual) {
      fee = Number(deposit.unique_code) || Number(deposit.fee) || 0;
      totalBayar = Number(deposit.total_amount) || (saldoMasuk + fee);
    } else {
      totalBayar = Number(deposit.total_amount) || Number(state.deposit?.total_amount) || saldoMasuk;
      fee = Number(deposit.fee) || Number(state.deposit?.fee) || Math.max(0, totalBayar - saldoMasuk);
    }

    const content = $('modalPaymentContent');
    if (!content) return;
    content.innerHTML = `
      <div class="modal-header">
        <div class="modal-title">Deposit Berhasil</div>
        <button class="modal-close" type="button" data-modal-close>${ICONS.close}</button>
      </div>
      <div style="padding:20px;text-align:center;">
        <div class="success-icon">${ICONS.check}</div>
        <h2 style="font-size:1.4rem;font-weight:800;margin-bottom:8px;color:var(--txt);">Deposit Berhasil!</h2>
        <p style="color:var(--txt2);font-size:0.9rem;margin-bottom:20px;">
          Saldo <strong style="color:var(--p);">${formatRupiah(saldoMasuk)}</strong> udah masuk ke akun kamu.
        </p>
        <div class="detail-list" style="text-align:left;">
          <div class="detail-row">
            <span class="detail-label">Reference ID</span>
            <span class="detail-value">${deposit.reference_id || '—'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Metode</span>
            <span class="detail-value">${deposit.method === 'qrispy' ? 'QRIS Otomatis' : 'QRIS DANA'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Total Bayar</span>
            <span class="detail-value">${formatRupiah(totalBayar)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Fee</span>
            <span class="detail-value warning">${formatRupiah(fee)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Saldo Masuk</span>
            <span class="detail-value success">${formatRupiah(saldoMasuk)}</span>
          </div>
        </div>
        <button class="btn btn-primary" id="btnSelesai" type="button" style="margin-top:16px;width:100%;">
          ${ICONS.check} Selesai
        </button>
      </div>
    `;
    openModal('modalPayment');
    const btnSelesai = $('btnSelesai');
    if (btnSelesai) {
      btnSelesai.addEventListener('click', () => {
        closeModal('modalPayment');
        location.reload();
      });
    }
    const closeBtn = content.querySelector('[data-modal-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        closeModal('modalPayment');
        location.reload();
      });
    }

    Cache.remove('user');
    Cache.invalidate('history_');
    loadHistory(state.historyPage);
    setTimeout(() => loadUser(true), 500);
  }

  /* §28 — LOAD HISTORY */
  async function loadHistory(page = 1) {
    state.historyPage = page;
    const container = $('historyList');
    if (!container) return;
    const cacheKey = `history_p${page}`;
    const cached = await Cache.get(cacheKey, _cfg.ttl.history);
    if (cached && cached.deposits) renderHistory(cached, page);
    else renderHistorySkeleton();

    try {
      const res = await fetchWithTimeout(`${_cfg.ep.history}?page=${page}&limit=${state.historyLimit}`, {
        headers: { Authorization: 'Bearer ' + token }
      });
      const data = await safeJson(res);
      if (!data.deposits) { renderHistoryEmpty(); return; }
      await Cache.set(cacheKey, data);
      renderHistory(data, page);
      const pendingIds = data.deposits
        .filter(d => d.status === 'pending')
        .map(d => d.reference_id);
      if (pendingIds.length > 0) syncVisibleDeposits(pendingIds, page);
    } catch(err) {
      if (!cached) {
        container.innerHTML = `
          <div class="empty-inbox">
            <div class="icon-box">${ICONS.warning}</div>
            <h3>Gagal memuat riwayat</h3>
            <p>${err.message || 'Coba refresh halaman'}</p>
          </div>
        `;
      }
    }
  }

  function renderHistory(data, page) {
    const container = $('historyList');
    const paginationEl = $('pagination');
    if (!container) return;

    if (!data.deposits || data.deposits.length === 0) { renderHistoryEmpty(); return; }

    const statusMap = {
      success: { class: 'success', label: 'Berhasil', icon: ICONS.check },
      pending: { class: 'pending', label: 'Pending', icon: ICONS.clock },
      failed: { class: 'failed', label: 'Gagal', icon: ICONS.close },
      cancelled: { class: 'cancelled', label: 'Dibatalkan', icon: ICONS.close },
      expired: { class: 'expired', label: 'Expired', icon: ICONS.clock },
    };

    const now = Date.now();
    container.innerHTML = `<div class="history-list">` + data.deposits.map(d => {
      const s = statusMap[d.status] || { class: 'pending', label: d.status, icon: ICONS.clock };
      const methodLabel = d.method === 'qrispy' ? 'QRIS Otomatis' : 'QRIS DANA';
      const created = new Date(d.created_at).getTime();
      const diff = Math.floor((now - created) / 1000);
      let relativeTime = '';
      if (diff < 60) relativeTime = `${diff}s lalu`;
      else if (diff < 3600) relativeTime = `${Math.floor(diff/60)}m lalu`;
      else if (diff < 86400) relativeTime = `${Math.floor(diff/3600)}j lalu`;
      else relativeTime = `${Math.floor(diff/86400)}h lalu`;
      const badgeClass = s.class === 'success' ? 'success' : s.class === 'pending' ? 'warning' : (s.class === 'expired' ? 'gray' : 'danger');
      return `
        <button class="history-card ${s.class}" type="button" data-deposit='${JSON.stringify(d).replace(/'/g, "&apos;")}' data-ref="${d.reference_id}">
          <div class="history-icon ${s.class}">${s.icon}</div>
          <div class="history-info">
            <div class="history-title">${methodLabel}</div>
            <div class="history-meta">${relativeTime} · ${d.reference_id || '—'}</div>
          </div>
          <div class="history-right">
            <div class="history-amount">${formatRupiah(d.total_amount || d.amount)}</div>
            <span class="badge ${badgeClass}">${s.label}</span>
          </div>
        </button>
      `;
    }).join('') + `</div>`;

    if (paginationEl && data.totalPages > 1) {
      paginationEl.style.display = 'flex';
      paginationEl.innerHTML = `
        <button class="page-btn" type="button" data-page="${page - 1}" ${!data.hasPrev ? 'disabled' : ''}>${ICONS.arrowLeft} Prev</button>
        <span class="page-info">Halaman ${data.page} dari ${data.totalPages}</span>
        <button class="page-btn" type="button" data-page="${page + 1}" ${!data.hasNext ? 'disabled' : ''}>Next ${ICONS.arrowRight}</button>
      `;
      paginationEl.querySelectorAll('.page-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = Number(btn.dataset.page);
          if (p >= 1 && p <= data.totalPages) {
            loadHistory(p);
            const section = document.querySelector('.history-section');
            if (section) window.scrollTo({ top: section.offsetTop - 100, behavior: 'smooth' });
          }
        });
      });
    } else if (paginationEl) {
      paginationEl.style.display = 'none';
    }

    container.querySelectorAll('.history-card').forEach(card => {
      card.addEventListener('click', () => {
        try {
          const deposit = JSON.parse(card.dataset.deposit.replace(/&apos;/g, "'"));
          showDetailModal(deposit);
        } catch(e) {}
      });
    });
  }

  function renderHistorySkeleton() {
    const container = $('historyList');
    if (!container) return;
    container.innerHTML = `
      <div class="history-list">
        ${Array(3).fill(0).map(() => `
          <div class="history-card" style="pointer-events:none;opacity:0.6;">
            <div class="history-icon" style="background:rgba(10,132,255,0.08);"><span class="spinner-sm"></span></div>
            <div class="history-info">
              <div class="skel" style="height:14px;width:60%;margin-bottom:6px;"></div>
              <div class="skel" style="height:11px;width:80%;"></div>
            </div>
            <div class="history-right">
              <div class="skel" style="height:14px;width:70px;margin-bottom:6px;"></div>
              <div class="skel" style="height:18px;width:60px;border-radius:50px;"></div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderHistoryEmpty() {
    const container = $('historyList');
    const paginationEl = $('pagination');
    if (!container) return;
    container.innerHTML = `
      <div class="empty-inbox">
        <div class="icon-box">${ICONS.wallet}</div>
        <h3>Belum ada riwayat deposit</h3>
        <p>Deposit pertama kamu bakal muncul di sini.</p>
      </div>
    `;
    if (paginationEl) paginationEl.style.display = 'none';
  }

  async function syncVisibleDeposits(referenceIds, page) {
    if (!referenceIds || referenceIds.length === 0) return;
    try {
      const res = await securePost(_cfg.ep.syncBatch, { reference_ids: referenceIds }, 'deposit_sync');
      const data = await safeJson(res);
      if (!data.updated || data.updated.length === 0) return;
      const cacheKey = `history_p${page}`;
      const cached = await Cache.get(cacheKey);
      if (cached && cached.deposits) {
        const updatedMap = new Map(data.updated.map(d => [d.reference_id, d]));
        cached.deposits = cached.deposits.map(d => updatedMap.get(d.reference_id) || d);
        await Cache.set(cacheKey, cached);
        renderHistory(cached, page);
        const hasSuccess = data.updated.some(d => d.status === 'success');
        if (hasSuccess) {
          Cache.remove('user');
          loadUser(true);
        }
      }
    } catch(err) {}
  }

  /* §29 — DETAIL MODAL */
  async function showDetailModal(d) {
    const cacheKey = `history_p${state.historyPage}`;
    const cached = await Cache.get(cacheKey);
    if (cached && cached.deposits) {
      const fresh = cached.deposits.find(x => x.reference_id === d.reference_id);
      if (fresh) d = { ...d, ...fresh };
    }

    const statusMap = {
      success: { class: 'success', label: 'BERHASIL', icon: ICONS.check },
      pending: { class: 'pending', label: 'PENDING', icon: ICONS.clock },
      failed: { class: 'failed', label: 'GAGAL', icon: ICONS.close },
      cancelled: { class: 'cancelled', label: 'DIBATALKAN', icon: ICONS.close },
      expired: { class: 'expired', label: 'EXPIRED', icon: ICONS.clock },
    };
    const s = statusMap[d.status] || { class: 'pending', label: (d.status || '—').toUpperCase(), icon: ICONS.clock };
    const methodLabel = d.method === 'qrispy' ? 'QRIS Otomatis' : 'QRIS DANA Manual';
    const saldoMasuk = Number(d.amount);
    let fee, totalBayar;
    if (d.method === 'qris_dana') {
      fee = Number(d.unique_code) || Number(d.fee) || 0;
      totalBayar = Number(d.total_amount) || (saldoMasuk + fee);
    } else {
      totalBayar = Number(d.total_amount) || saldoMasuk;
      fee = Number(d.fee) || Math.max(0, totalBayar - saldoMasuk);
    }
    const formatDate = (date) => {
      if (!date) return '—';
      try {
        return new Date(date).toLocaleString('id-ID', {
          day: '2-digit', month: 'long', year: 'numeric',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
      } catch(e) { return '—'; }
    };
    const feeLoading = d.method === 'qrispy' && fee === 0 && d.status !== 'expired' && d.status !== 'cancelled' && d.status !== 'failed';
    const showQr = d.status === 'pending' && d.qris_url;

    const content = $('modalDetailContent');
    if (!content) return;
    content.innerHTML = `
      <div class="modal-header">
        <div class="modal-title">Detail Deposit</div>
        <button class="modal-close" type="button" data-modal-close>${ICONS.close}</button>
      </div>
      <div style="padding:20px;">
        <div class="detail-header">
          <div class="detail-icon ${s.class}">${s.icon}</div>
          <h2>${formatRupiah(saldoMasuk)}</h2>
          <p>${methodLabel}</p>
        </div>

        ${showQr ? `
          <div class="detail-qr-preview">
            <div class="qr-wrapper">
              <img src="${d.qris_url}" alt="QR Code" id="detailQrImage" crossorigin="anonymous">
            </div>
            <button class="btn-download-qr" id="btnDownloadDetailQr" type="button" style="margin-top:12px;">
              ${ICONS.download} Download QR
            </button>
          </div>
        ` : ''}

        <div class="detail-list">
          <div class="detail-row">
            <span class="detail-label">Reference ID</span>
            <span class="detail-value">${d.reference_id || '—'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Status</span>
            <span class="detail-value ${s.class}">${s.label}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Metode</span>
            <span class="detail-value">${methodLabel}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Saldo Top Up</span>
            <span class="detail-value">${formatRupiah(saldoMasuk)}</span>
          </div>
          ${d.unique_code ? `
            <div class="detail-row">
              <span class="detail-label">Kode Unik</span>
              <span class="detail-value warning">+${d.unique_code}</span>
            </div>
          ` : ''}
          <div class="detail-row">
            <span class="detail-label">Fee</span>
            <span class="detail-value warning" id="detailFee">
              ${feeLoading ? '<span class="inline-loader"></span>' : formatRupiah(fee)}
            </span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Total Bayar</span>
            <span class="detail-value highlight" id="detailTotal">${formatRupiah(totalBayar)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Saldo Diterima</span>
            <span class="detail-value success">${formatRupiah(saldoMasuk)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Dibuat</span>
            <span class="detail-value" style="font-size:0.78rem;">${formatDate(d.created_at)}</span>
          </div>
          ${d.expires_at ? `
            <div class="detail-row">
              <span class="detail-label">Kedaluwarsa</span>
              <span class="detail-value" style="font-size:0.78rem;">${formatDate(d.expires_at)}</span>
            </div>
          ` : ''}
          ${d.paid_at ? `
            <div class="detail-row">
              <span class="detail-label">Dibayar</span>
              <span class="detail-value success" style="font-size:0.78rem;">${formatDate(d.paid_at)}</span>
            </div>
          ` : ''}
        </div>

        <div class="detail-actions">
          <button class="btn btn-primary" type="button" id="btnCopyRef" style="width:100%;">
            ${ICONS.copy} Copy Reference ID
          </button>
        </div>
      </div>
    `;

    openModal('modalDetail');
    const closeBtn = content.querySelector('[data-modal-close]');
    if (closeBtn) closeBtn.addEventListener('click', () => closeModal('modalDetail'));

    const btnCopyRef = $('btnCopyRef');
    if (btnCopyRef) {
      btnCopyRef.addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(d.reference_id || '');
          } else {
            const ta = document.createElement('textarea');
            ta.value = d.reference_id || '';
            ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
          const original = btnCopyRef.innerHTML;
          btnCopyRef.innerHTML = `${ICONS.check} Copied!`;
          setTimeout(() => btnCopyRef.innerHTML = original, 1500);
        } catch(e) {}
      });
    }

    const btnDownload = $('btnDownloadDetailQr');
    if (btnDownload) btnDownload.addEventListener('click', () => downloadQRDetail());

    if (feeLoading && d.qris_id) {
      try {
        let transaction = null;
        try {
          const res = await fetchWithTimeout(`${_cfg.qrispyBase}/api/payment/transactions?qris_id=${d.qris_id}`);
          const data = await safeJson(res);
          if (Array.isArray(data.data)) {
            transaction = data.data.find(t => t.payment_reference === d.reference_id || t.qris_id === d.qris_id);
          } else if (data.data && typeof data.data === 'object') {
            transaction = data.data;
          }
        } catch(e) {
          try {
            const res2 = await fetchWithTimeout(`${_cfg.qrispyBase}/api/payment/qris/${d.qris_id}/status`);
            const data2 = await safeJson(res2);
            transaction = data2.data;
          } catch(e2) {}
        }
        const feeEl = $('detailFee');
        const totalEl = $('detailTotal');
        if (transaction) {
          const total = Number(transaction.amount) || totalBayar;
          const feeCalc = Math.max(0, total - saldoMasuk);
          if (feeEl) feeEl.textContent = formatRupiah(feeCalc);
          if (totalEl) totalEl.textContent = formatRupiah(total);
          securePost(`/api/deposit/${d.reference_id}/update-fee`, { total_amount: total, fee: feeCalc }, 'deposit_fee').catch(() => {});
        } else {
          if (feeEl) feeEl.textContent = 'Rp0';
        }
      } catch(err) {
        const feeEl = $('detailFee');
        if (feeEl) feeEl.textContent = 'Rp0';
      }
    }
  }

  async function downloadQRDetail() {
    const qrImg = $('detailQrImage');
    if (!qrImg) return;
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const size = 600, padding = 40, topSpace = 60, bottomSpace = 60;
      canvas.width = size; canvas.height = size;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#2563eb';
      ctx.font = 'bold 24px "Inter", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('AsyrofOTP', size / 2, topSpace / 2);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve; img.onerror = reject;
        img.src = qrImg.src;
      });
      const qrSize = size - (padding * 2);
      ctx.drawImage(img, padding, topSpace, qrSize, qrSize - (bottomSpace - topSpace) / 2);
      const refEl = document.querySelector('#modalDetailContent .detail-row .detail-value');
      ctx.fillStyle = '#64748b';
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(refEl?.textContent || '', size / 2, size - bottomSpace / 2);
      const link = document.createElement('a');
      link.download = `AsyrofOTP-QR-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch(err) {
      window.open(qrImg.src, '_blank');
    }
  }

  /* §30 — LOGOUT */
  async function handleLogout() {
    try {
      await fetchWithTimeout(_cfg.ep.logout, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token }
      });
    } catch(e) {}
    Cache.clear();
    try {
      SafeStorage.local.remove('access_token');
      SafeStorage.local.remove('user');
      SafeStorage.local.remove('refresh_token');
    } catch(e) {}
    location.href = '/landing';
  }

  const logoutBtn = $('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const ok = await customConfirm('Yakin mau keluar dari akun ini?', 'warning', 'Keluar Akun?');
      if (ok) handleLogout();
    });
  }

  /* §31 — EVENT BINDINGS */
  if (btnLanjut) {
    btnLanjut.addEventListener('click', () => {
      if (!state.amount || state.amount < 1000) return;
      setStep(2);
      openModal('modalMethod');
    });
  }

  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-modal-close]');
    if (closeBtn) {
      e.preventDefault(); e.stopPropagation();
      const modal = closeBtn.closest('.modal-overlay');
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

  document.addEventListener('touchstart', (e) => {
    if (e.target.classList && e.target.classList.contains('modal-overlay')) {
      e.preventDefault();
      closeModal(e.target.id);
      if (e.target.id === 'modalMethod' && !state.method) setStep(1);
    }
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const active = document.querySelector('.modal-overlay.active');
      if (active) {
        closeModal(active.id);
        if (active.id === 'modalMethod' && !state.method) setStep(1);
      }
    }
  });

  /* §32 — INIT */
  (function init() {
    restoreState();
    updateButton();
    loadUser(false);
    loadPresets();
    loadMethods();
    loadHistory(1);
  })();

  document.addEventListener('visibilitychange', () => {
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
