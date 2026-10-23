(function (global) {
  'use strict';

  /* ============================================================
     §1 — CRYPTO (AES-GCM + PBKDF2)
     ============================================================ */
  const _crypto = (() => {
    const _k = 'dGhpcy1pcy1hLXNlY3JldC1rZXktZm9yLWNhY2hlLTIwMjY=';
    const _s = 'c2FsdC1hc3lyb2Ytb3RwLXYyMDI2LXNlY3VyZQ==';
    const _i = 100000;
    let _dk = null;

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

    async function seal(obj) {
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
      } catch (e) { return null; }
    }

    async function unseal(b64) {
      try {
        const key = await _derive();
        const buf = _b2buf(b64);
        const iv = buf.slice(0, 12);
        const data = buf.slice(12);
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(iv) }, key, data
        );
        return JSON.parse(new TextDecoder().decode(plain));
      } catch (e) { return null; }
    }

    return { seal, unseal };
  })();

  /* ============================================================
     §2 — API CACHE
     ============================================================ */
  const _api = (() => {
    const P = 'aotp_c_';
    const TTL = 5 * 60 * 1000;
    const NEG_TTL = 30 * 1000;
    const _inflight = new Map();
    const _mem = new Map();
    const _neg = new Map();

    async function _read(key) {
      if (_mem.has(key)) {
        const e = _mem.get(key);
        if (Date.now() - e.t < TTL) return e.v;
        _mem.delete(key);
      }
      try {
        const raw = localStorage.getItem(P + key);
        if (!raw) return null;
        const e = await _crypto.unseal(raw);
        if (!e || Date.now() - e.t > TTL) {
          localStorage.removeItem(P + key);
          return null;
        }
        _mem.set(key, e);
        return e.v;
      } catch (e) { return null; }
    }

    async function _write(key, v) {
      const e = { t: Date.now(), v };
      _mem.set(key, e);
      try {
        const s = await _crypto.seal(e);
        if (s) localStorage.setItem(P + key, s);
      } catch (e) {}
    }

    async function fetchCached(url, opts = {}, cfg = {}) {
      const key = cfg.key || (opts.method || 'GET') + ':' + url;
      const force = cfg.force === true;

      if (!force && _neg.has(key)) {
        const n = _neg.get(key);
        if (Date.now() - n.t < (cfg.negTtl || NEG_TTL)) return n.r.clone();
        _neg.delete(key);
      }

      if (!force && (opts.method || 'GET') === 'GET') {
        const c = await _read(key);
        if (c) {
          return new Response(JSON.stringify(c), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-From-Cache': '1' },
          });
        }
      }

      if (_inflight.has(key)) return _inflight.get(key);

      const p = (async () => {
        try {
          const res = await fetch(url, opts);
          if (res.ok && (opts.method || 'GET') === 'GET') {
            const d = await res.clone().json().catch(() => null);
            if (d) await _write(key, d);
          } else if (res.status >= 400 && res.status < 500) {
            _neg.set(key, { t: Date.now(), r: res.clone() });
          }
          return res;
        } finally {
          _inflight.delete(key);
        }
      })();

      _inflight.set(key, p);
      return p;
    }

    function invalidate(prefix) {
      _mem.forEach((_, k) => { if (k.startsWith(prefix)) _mem.delete(k); });
      try {
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith(P + prefix)) localStorage.removeItem(k);
        });
      } catch (e) {}
    }

    return { fetchCached, invalidate };
  })();

  /* ============================================================
     §3 — CONFIG
     ============================================================ */
  const _cfg = {
    rk: '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg',
    ep: {
      check: '/api/auth/check-username',
      reg: '/api/auth/register',
      me: '/api/user',
    },
    userRe: /^[a-zA-Z0-9_]{3,20}$/,
    minPass: 6,
  };

  /* ============================================================
     §4 — DEVICE
     ============================================================ */
  const _dev = (() => {
    const mq = (q) => window.matchMedia(q).matches;
    const hc = navigator.hardwareConcurrency || 4;
    const conn = navigator.connection || {};
    return {
      mobile: mq('(max-width: 700px)'),
      lowEnd: hc <= 4 || conn.saveData || /2g|slow-2g/.test(conn.effectiveType || ''),
      reduced: mq('(prefers-reduced-motion: reduce)'),
    };
  })();

  if (_dev.reduced || _dev.lowEnd) {
    document.documentElement.setAttribute('data-perf', 'lite');
  }

  /* ============================================================
     §5 — CONSOLE WARNING
     ============================================================ */
  (function () {
    try {
      console.log('%c⚠️ STOP!', 'color:#ff3b30;font-size:20px;font-weight:900');
      console.log('%cJangan paste apapun di sini. Itu SCAM.', 'color:#8e8e93;font-size:12px');
    } catch (e) {}

    document.addEventListener('copy', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
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
    } catch (e) {}
  })();

  /* ============================================================
     §6 — AUTO REDIRECT kalau sudah login
     ============================================================ */
  (async function () {
    let tk = null;
    try { tk = localStorage.getItem('access_token'); } catch (e) {}
    if (!tk) return;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(_cfg.ep.me, {
        headers: { Authorization: 'Bearer ' + tk },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) { location.replace('/dashboard'); return; }
      if (res.status === 401 || res.status === 403) {
        try {
          localStorage.removeItem('access_token');
          localStorage.removeItem('user');
          localStorage.removeItem('refresh_token');
        } catch (e) {}
      }
    } catch (e) {}
  })();

  /* ============================================================
     §7 — THEME (light -> dark -> system)
     ============================================================ */
  (function () {
    const btn = document.getElementById('themeBtn');
    if (!btn) return;

    const root = document.documentElement;
    const mq = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

    const resolve = (p) => p === 'system' ? (mq && mq.matches ? 'dark' : 'light') : p;
    const paintMeta = (t) => {
      const m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', t === 'dark' ? '#0a0b0d' : '#0a84ff');
    };
    const setPref = (p, save) => {
      root.setAttribute('data-theme-pref', p);
      const r = resolve(p);
      root.setAttribute('data-theme', r);
      paintMeta(r);
      if (save) { try { localStorage.setItem('asyrofotp_theme_pref', p); } catch (e) {} }
    };

    btn.addEventListener('click', () => {
      const cur = root.getAttribute('data-theme-pref') || 'system';
      const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
      setPref(next, true);
    });

    if (mq) {
      const onChange = () => {
        if (root.getAttribute('data-theme-pref') === 'system') setPref('system', false);
      };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  })();

  /* ============================================================
     §8 — RECAPTCHA WAIT
     ============================================================ */
  function _waitRecap() {
    return new Promise((resolve) => {
      if (global.grecaptcha && global.grecaptcha.execute) return resolve();
      let n = 0;
      const t = setInterval(() => {
        n++;
        if (global.grecaptcha && global.grecaptcha.execute) {
          clearInterval(t); resolve();
        } else if (n >= 50) {
          clearInterval(t); resolve();
        }
      }, 100);
    });
  }

  /* ============================================================
     §9 — ELEMENTS
     ============================================================ */
  const form = document.getElementById('registerForm');
  if (!form) return;

  const el = (id) => document.getElementById(id);

  const alertEl = el('alert');
  const alertText = el('alert-text');
  const alertIcon = el('alertIcon');
  const statusRow = el('statusRow');
  const statusLabel = el('statusLabel');
  const submitBtn = el('submitBtn');
  const btnText = el('btnText');
  const btnIcon = el('btnIcon');

  const userIn = el('username');
  const nameIn = el('name');
  const passIn = el('password');
  const pass2In = el('password2');
  const agreeIn = el('agree');

  const hintUser = el('hint-username');
  const hintPass = el('hint-password');
  const hintPass2 = el('hint-password2');
  const statusUser = el('status-username');

  const grpName = el('group-name');
  const grpPass = el('group-password');
  const grpPass2 = el('group-password2');
  const grpTerms = el('group-terms');

  const dots = document.querySelectorAll('.step-dot');
  const lines = document.querySelectorAll('.step-line');

  /* ============================================================
     §10 — STATE
     ============================================================ */
  const userState = {
    checking: false,
    available: false,
    last: '',
    ac: null,
  };

  /* ============================================================
     §11 — ALERT
     ============================================================ */
  const _ai = {
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    error: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    success: '<polyline points="20 6 9 17 4 12"/>',
  };

  function showAlert(msg, type) {
    type = type || 'error';
    alertEl.className = 'alert show ' + type;
    alertText.textContent = msg;
    if (alertIcon) alertIcon.innerHTML = _ai[type] || _ai.info;
  }
  function hideAlert() { alertEl.className = 'alert'; }

  /* ============================================================
     §12 — STATUS
     ============================================================ */
  function setStatus(state, label) {
    if (!statusRow) return;
    statusRow.dataset.state = state;
    if (statusLabel && label) statusLabel.textContent = label;
    if (state === 'pending') {
      statusRow.classList.remove('visible');
      statusRow.setAttribute('aria-hidden', 'true');
    } else {
      statusRow.classList.add('visible');
      statusRow.setAttribute('aria-hidden', 'false');
    }
  }

  /* ============================================================
     §13 — EYE TOGGLE
     ============================================================ */
  const EYE_OPEN = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const EYE_CLOSED = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';

  function setupEye(btnId, iconId, input) {
    const b = el(btnId), ic = el(iconId);
    if (!b || !ic || !input) return;
    let v = false;
    b.addEventListener('click', () => {
      v = !v;
      input.type = v ? 'text' : 'password';
      ic.innerHTML = v ? EYE_CLOSED : EYE_OPEN;
    });
  }
  setupEye('togglePassword', 'eyeIcon', passIn);
  setupEye('togglePassword2', 'eyeIcon2', pass2In);

  /* ============================================================
     §14 — VALIDATORS
     ============================================================ */
  function validateUserFormat() {
    const v = userIn.value.trim();
    if (!v) {
      userIn.classList.remove('valid', 'invalid');
      hintUser.className = 'form-hint';
      hintUser.textContent = 'Huruf, angka, underscore. 3-20 karakter.';
      return false;
    }
    if (!_cfg.userRe.test(v)) {
      userIn.classList.add('invalid');
      userIn.classList.remove('valid');
      hintUser.className = 'form-hint error';
      hintUser.textContent = 'Username hanya boleh huruf, angka, underscore (3-20 karakter).';
      return false;
    }
    return true;
  }

  function setUserStatus(state, msg) {
    statusUser.className = 'input-status';
    if (state === 'loading') {
      statusUser.innerHTML = '<div class="loading-spinner-sm"></div>';
      statusUser.classList.add('show');
      hintUser.className = 'form-hint';
      hintUser.textContent = 'Mengecek ketersediaan username...';
      userIn.classList.remove('valid', 'invalid');
    } else if (state === 'success') {
      statusUser.innerHTML = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      statusUser.classList.add('show', 'success');
      hintUser.className = 'form-hint success';
      hintUser.textContent = msg || '✓ Username tersedia';
      userIn.classList.add('valid');
      userIn.classList.remove('invalid');
    } else if (state === 'error') {
      statusUser.innerHTML = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      statusUser.classList.add('show', 'error');
      hintUser.className = 'form-hint error';
      hintUser.textContent = msg || '✕ Username tidak tersedia';
      userIn.classList.add('invalid');
      userIn.classList.remove('valid');
    } else {
      statusUser.innerHTML = '';
      statusUser.classList.remove('show', 'success', 'error');
    }
  }

  function validatePass() {
    const v = passIn.value;
    if (!v) {
      passIn.classList.remove('valid', 'invalid');
      hintPass.className = 'form-hint';
      hintPass.textContent = 'Minimal 6 karakter.';
      return false;
    }
    if (v.length < _cfg.minPass) {
      passIn.classList.add('invalid');
      passIn.classList.remove('valid');
      hintPass.className = 'form-hint error';
      hintPass.textContent = 'Password minimal 6 karakter.';
      return false;
    }
    passIn.classList.add('valid');
    passIn.classList.remove('invalid');
    hintPass.className = 'form-hint success';
    hintPass.textContent = '✓ Password cukup kuat';
    return true;
  }

  function validatePass2() {
    const v = pass2In.value;
    if (!v) {
      pass2In.classList.remove('valid', 'invalid');
      hintPass2.className = 'form-hint';
      hintPass2.textContent = 'Ulangi password yang sama.';
      return false;
    }
    if (v !== passIn.value) {
      pass2In.classList.add('invalid');
      pass2In.classList.remove('valid');
      hintPass2.className = 'form-hint error';
      hintPass2.textContent = 'Password tidak cocok.';
      return false;
    }
    pass2In.classList.add('valid');
    pass2In.classList.remove('invalid');
    hintPass2.className = 'form-hint success';
    hintPass2.textContent = '✓ Password cocok';
    return true;
  }

  /* ============================================================
     §15 — CHECK USERNAME
     ============================================================ */
  async function checkUser(name) {
    if (userState.ac) userState.ac.abort();
    const ac = new AbortController();
    userState.ac = ac;
    userState.checking = true;
    userState.available = false;
    userState.last = name;
    setUserStatus('loading');

    try {
      const res = await _api.fetchCached(_cfg.ep.check, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name }),
        signal: ac.signal,
      }, { key: 'chk:' + name.toLowerCase() });

      if (userState.last !== name) return;
      userState.checking = false;

      const data = await res.json();
      if (!res.ok) {
        setUserStatus('error', data.error || 'Gagal cek username');
        return;
      }
      if (data.available) {
        userState.available = true;
        setUserStatus('success', '✓ Username tersedia');
        revealNext();
      } else {
        userState.available = false;
        setUserStatus('error', '✕ Username sudah dipakai. Coba yang lain.');
      }
      checkReady();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (userState.last !== name) return;
      userState.checking = false;
      setUserStatus('error', 'Gagal cek username. Coba lagi.');
    }
  }

  let userDebounce = null;
  function scheduleCheck(name) {
    clearTimeout(userDebounce);
    userDebounce = setTimeout(() => checkUser(name), 400);
  }

  /* ============================================================
     §16 — REVEAL + STEPS
     ============================================================ */
  function revealNext() {
    if (validateUserFormat() && userState.available && !grpName.classList.contains('visible')) {
      grpName.classList.add('visible');
      updateSteps(2);
      return;
    }
    if (grpName.classList.contains('visible') && !grpPass.classList.contains('visible') && userState.available) {
      grpPass.classList.add('visible');
      updateSteps(3);
      return;
    }
    if (grpPass.classList.contains('visible') && !grpPass2.classList.contains('visible') && validatePass()) {
      grpPass2.classList.add('visible');
      updateSteps(4);
      return;
    }
    if (grpPass2.classList.contains('visible') && !grpTerms.classList.contains('visible') && validatePass2()) {
      grpTerms.classList.add('visible');
      updateSteps(5);
    }
    checkReady();
  }

  function checkReady() {
    const ok =
      validateUserFormat() &&
      userState.available &&
      validatePass() &&
      validatePass2() &&
      agreeIn.checked;
    submitBtn.disabled = !ok;
  }

  function updateSteps(active) {
    dots.forEach((d) => {
      const s = Number(d.dataset.step);
      d.classList.toggle('active', s === active);
      d.classList.toggle('done', s < active);
      d.textContent = s < active ? '✓' : String(s);
    });
    lines.forEach((l) => {
      const lv = Number(l.dataset.line);
      l.classList.toggle('done', lv < active);
    });
  }

  /* ============================================================
     §17 — INPUT EVENTS
     ============================================================ */
  userIn.addEventListener('input', () => {
    userState.available = false;
    if (!validateUserFormat()) {
      setUserStatus('idle');
      checkReady();
      return;
    }
    scheduleCheck(userIn.value.trim());
    checkReady();
  });

  userIn.addEventListener('blur', () => {
    const v = userIn.value.trim();
    if (validateUserFormat()) {
      if (userState.last !== v || !userState.available) {
        clearTimeout(userDebounce);
        checkUser(v);
      }
    }
  });

  nameIn.addEventListener('blur', () => { if (grpName.classList.contains('visible')) revealNext(); });
  nameIn.addEventListener('input', () => { if (grpName.classList.contains('visible')) revealNext(); });

  passIn.addEventListener('input', () => {
    validatePass();
    if (validatePass()) revealNext();
    if (pass2In.value) validatePass2();
    checkReady();
  });
  passIn.addEventListener('blur', () => { if (validatePass()) revealNext(); });

  pass2In.addEventListener('input', () => {
    validatePass2();
    if (validatePass2()) revealNext();
    checkReady();
  });
  pass2In.addEventListener('blur', () => { if (validatePass2()) revealNext(); });

  agreeIn.addEventListener('change', () => {
    checkReady();
    if (agreeIn.checked && validateUserFormat() && userState.available && validatePass() && validatePass2()) {
      updateSteps(5);
    }
  });

  /* ============================================================
     §18 — SUBMIT
     ============================================================ */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    if (!validateUserFormat()) { showAlert('Username tidak valid', 'error'); return; }
    if (!userState.available) { showAlert('Username belum tersedia atau belum dicek', 'error'); return; }
    if (!validatePass()) { showAlert('Password minimal 6 karakter', 'error'); return; }
    if (!validatePass2()) { showAlert('Konfirmasi password tidak cocok', 'error'); return; }
    if (!agreeIn.checked) { showAlert('Kamu harus menyetujui Syarat & Ketentuan', 'error'); return; }

    const username = userIn.value.trim();
    const name = nameIn.value.trim();
    const password = passIn.value;

    submitBtn.disabled = true;
    btnText.textContent = 'Memproses...';
    const origIcon = btnIcon ? btnIcon.outerHTML : '';
    if (btnIcon && btnIcon.parentNode) {
      btnIcon.outerHTML = '<span class="spinner" id="btnIcon"></span>';
    }
    setStatus('running', 'Memverifikasi keamanan...');

    try {
      await _waitRecap();
      if (!global.grecaptcha || !global.grecaptcha.execute) {
        throw new Error('Verifikasi keamanan gagal dimuat. Refresh halaman.');
      }

      const token = await new Promise((resolve, reject) => {
        global.grecaptcha.ready(() => {
          global.grecaptcha.execute(_cfg.rk, { action: 'register' })
            .then(resolve)
            .catch(reject);
        });
        setTimeout(() => reject(new Error('Timeout verifikasi keamanan')), 10000);
      });

      setStatus('running', 'Mendaftarkan akun...');

      const res = await fetch(_cfg.ep.reg, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          name: name || undefined,
          recaptcha_token: token,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registrasi gagal');

      _api.invalidate('chk:' + username.toLowerCase());

      updateSteps(6);
      setStatus('done', 'Registrasi berhasil!');
      showAlert('Registrasi berhasil! Mengalihkan ke login...', 'success');

      setTimeout(() => { location.replace('/login'); }, 1200);
    } catch (err) {
      setStatus('failed', 'Gagal daftar');
      showAlert(err && err.message ? err.message : 'Terjadi kesalahan', 'error');
      submitBtn.disabled = false;
      btnText.textContent = 'Daftar';
      const old = el('btnIcon');
      if (old && origIcon) old.outerHTML = origIcon;
      if (err.message && err.message.toLowerCase().includes('username')) {
        userState.available = false;
        setUserStatus('error', '✕ ' + err.message);
      }
      setTimeout(() => setStatus('pending', 'Menunggu'), 3000);
    }
  });

  checkReady();
})(window);
