/* ============================================================
   DASHBOARD.JS — iOS Liquid Glass + Encrypted Cache + Dynamic Copy
   FIXED: Full touch/click support, browser fallbacks, safe storage
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     §0 — SAFE STORAGE (Safari Private Mode safe)
     ============================================================ */
  const SafeStorage = (() => {
    let ls = null, ss = null;
    try { ls = window.localStorage; ls.setItem('__t', '1'); ls.removeItem('__t'); } catch (e) { ls = null; }
    try { ss = window.sessionStorage; ss.setItem('__t', '1'); ss.removeItem('__t'); } catch (e) { ss = null; }
    const mem = new Map();
    function wrap(store, prefix) {
      return {
        get(k) {
          try { return store ? store.getItem(prefix + k) : (mem.get(prefix + k) ?? null); }
          catch (e) { return mem.get(prefix + k) ?? null; }
        },
        set(k, v) {
          try { if (store) store.setItem(prefix + k, v); else mem.set(prefix + k, v); }
          catch (e) { mem.set(prefix + k, v); }
        },
        remove(k) {
          try { if (store) store.removeItem(prefix + k); else mem.delete(prefix + k); }
          catch (e) { mem.delete(prefix + k); }
        },
        keys() {
          try { return store ? Object.keys(store) : Array.from(mem.keys()); }
          catch (e) { return Array.from(mem.keys()); }
        },
      };
    }
    return {
      local: wrap(ls, ''),
      session: wrap(ss, ''),
      hasLocal: !!ls,
      hasSession: !!ss,
    };
  })();

  /* ============================================================
     §1 — CRYPTO (AES-GCM + PBKDF2) — dengan fallback non-secure
     ============================================================ */
  const _crypto = (() => {
    const _k = 'ZGFzaGJvYXJkLXNlY3JldC1rZXktMjAyNg==';
    const _s = 'c2FsdC1kYXNoYm9hcmQtdjIwMjYtc2VjdXJl';
    const _i = 100000;
    let _dk = null;
    const supported = (() => {
      try { return !!(global.crypto && global.crypto.subtle && global.crypto.getRandomValues); }
      catch (e) { return false; }
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

    // Fallback: base64 obfuscation (bukan enkripsi, hanya untuk kompatibilitas)
    function _fallbackSeal(obj) {
      try { return 'fb:' + btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
      catch (e) { return null; }
    }
    function _fallbackUnseal(b64) {
      try {
        const raw = b64.slice(3);
        return JSON.parse(decodeURIComponent(escape(atob(raw))));
      } catch (e) { return null; }
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
      } catch (e) { return _fallbackSeal(obj); }
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
      } catch (e) { return null; }
    }

    return { seal, unseal, supported };
  })();

  /* ============================================================
     §2 — ENCRYPTED CACHE
     ============================================================ */
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
      } catch (err) { return null; }
    }

    async function set(key, v) {
      const e = { t: Date.now(), v };
      _mem.set(key, e);
      try {
        const s = await _crypto.seal(e);
        if (s) SafeStorage.local.set(P + key, s);
      } catch (err) {}
    }

    function remove(key) {
      _mem.delete(key);
      try { SafeStorage.local.remove(P + key); } catch (e) {}
    }

    function clear() {
      _mem.clear();
      try {
        SafeStorage.local.keys().forEach(k => {
          if (k.startsWith(P)) SafeStorage.local.remove(k);
        });
      } catch (e) {}
    }

    return { get, set, remove, clear };
  })();

  /* ============================================================
     §3 — CONFIG
     ============================================================ */
  const _cfg = {
    rk: '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg',
    ep: {
      user: '/api/user',
      dashboard: '/api/dashboard',
      refunds: '/api/nokos/check-refunds',
      logout: '/api/auth/logout',
    },
    ttl: {
      user: 5 * 60 * 1000,
      dashboard: 2 * 60 * 1000,
    },
    refreshInterval: 15000,
    refundInterval: 30000,
    fetchTimeout: 12000,
  };

  /* ============================================================
     §4 — DEVICE DETECTION
     ============================================================ */
  const _dev = (() => {
    const mq = (q) => { try { return window.matchMedia(q).matches; } catch (e) { return false; } };
    const hc = navigator.hardwareConcurrency || 4;
    const conn = navigator.connection || {};
    return {
      mobile: mq('(max-width: 768px)'),
      lowEnd: hc <= 4 || conn.saveData || /2g|slow-2g/.test(conn.effectiveType || ''),
      reduced: mq('(prefers-reduced-motion: reduce)'),
      touch: ('ontouchstart' in window) || (navigator.maxTouchPoints > 0),
    };
  })();

  if (_dev.reduced || _dev.lowEnd) {
    document.documentElement.setAttribute('data-perf', 'lite');
  }

  /* ============================================================
     §5 — SECURITY (soft, F12 allowed)
     ============================================================ */
  (function () {
    try {
      console.log('%c⚠️ STOP!', 'color:#ff3b30;font-size:20px;font-weight:900');
      console.log('%cJangan paste apapun di sini. Itu SCAM.', 'color:#8e8e93;font-size:12px');
    } catch (e) {}

    document.addEventListener('copy', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (t && t.closest && t.closest('[data-copy]')) return;
      // Izinkan copy di elemen kode / user-code
      if (t && t.closest && t.closest('.user-code-display, code, pre')) return;
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
     §6 — AUTH
     ============================================================ */
  const token = SafeStorage.local.get('access_token');
  if (!token) {
    location.href = '/login';
    return;
  }

  /* ============================================================
     §7 — HELPERS
     ============================================================ */
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

  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function formatTanggal(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return '—'; }
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  async function copyToClipboard(text) {
    // Modern API (butuh secure context)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
    }
    // Fallback: execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ============================================================
     §8 — DYNAMIC COPY (random per refresh)
     ============================================================ */
  const _copy = {
    greeting: [
      'Halo, {name} 👋',
      'Selamat datang, {name}',
      'Hai {name}, apa kabar?',
      'Yo {name}! Siap order?',
      'Halo {name}, semangat hari ini!',
      '{name}, ada yang bisa dibantu?',
    ],
    heroTitle: [
      'Selamat Datang',
      'Halo Lagi',
      'Siap Order?',
      'Gas Nokos!',
      'Mulai Hari Ini',
      'Semangat!',
    ],
    heroDesc: [
      'Nokos OTP 24 jam, proses instan, refund otomatis. Beli nomor & terima OTP langsung di inbox.',
      'Dapetin nomor virtual buat verifikasi akun. Cepet, murah, otomatis.',
      'Verifikasi akun tanpa ribet. Nokos ready 24 jam, refund otomatis kalau gagal.',
      'Beli nomor OTP dalam hitungan detik. OTP langsung masuk inbox kamu.',
      'Nokos berkualitas, harga bersahabat. Proses otomatis 24/7.',
      'Butuh nomor buat verifikasi? Semua ada di sini, tinggal pilih.',
    ],
    sectionStats: ['Statistik Pesanan', 'Ringkasan Order', 'Data Pesanan', 'Aktivitas Kamu'],
    sectionQuick: ['Aksi Cepat', 'Menu Favorit', 'Shortcut', 'Mulai Dari Sini'],
    sectionTx: ['Transaksi Terakhir', 'Riwayat Order', 'Pesanan Terbaru', 'Aktivitas Terkini'],
    userCodeHint: [
      'Bagikan ID ini kalau butuh bantuan support',
      'Simpen baik-baik, ini ID unik kamu',
      'Kasih ID ini ke admin kalau ada kendala',
      'ID ini buat verifikasi kalau butuh bantuan',
    ],
    qaDesc: {
      nokos: ['Order nomor OTP', 'Beli nomor virtual', 'Pilih nomor', 'Cari nomor'],
      deposit: ['Top-up saldo', 'Isi saldo', 'Tambah saldo', 'Deposit dana'],
      inbox: ['Lihat pesan', 'Cek OTP masuk', 'Baca inbox', 'Lihat notifikasi'],
      profile: ['Atur akun', 'Edit profil', 'Pengaturan', 'Info akun'],
    },
    txCardDesc: [
      'Klik baris buat lihat detail di Inbox',
      'Tap buat buka detail pesanan',
      'Klik buat lihat OTP di Inbox',
      'Ketuk baris buat detail lengkap',
    ],
  };

  function fillGreeting(name) {
    const tpl = pick(_copy.greeting);
    return tpl.replace('{name}', escapeHtml(name || '—'));
  }

  function randomizeCopy() {
    const gn = document.getElementById('greetingLine');
    const hn = document.getElementById('greetingName');
    if (gn && hn) gn.innerHTML = fillGreeting(hn.textContent);

    const heroT = document.getElementById('heroTitle');
    if (heroT) heroT.textContent = pick(_copy.heroTitle);

    const heroD = document.getElementById('heroDesc');
    if (heroD) heroD.textContent = pick(_copy.heroDesc);

    const qaDescNokos = document.getElementById('qaDescNokos');
    if (qaDescNokos) qaDescNokos.textContent = pick(_copy.qaDesc.nokos);
    const qaDescDeposit = document.getElementById('qaDescDeposit');
    if (qaDescDeposit) qaDescDeposit.textContent = pick(_copy.qaDesc.deposit);
    const qaDescInbox = document.getElementById('qaDescInbox');
    if (qaDescInbox) qaDescInbox.textContent = pick(_copy.qaDesc.inbox);
    const qaDescProfile = document.getElementById('qaDescProfile');
    if (qaDescProfile) qaDescProfile.textContent = pick(_copy.qaDesc.profile);

    const txCardDesc = document.getElementById('txCardDesc');
    if (txCardDesc) txCardDesc.textContent = pick(_copy.txCardDesc);

    const userCodeHint = document.getElementById('userCodeHint');
    if (userCodeHint) userCodeHint.textContent = pick(_copy.userCodeHint);
  }

  /* ============================================================
     §9 — ICONS
     ============================================================ */
  const ICONS = {
    check: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    close: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    coin: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M15 9.5a3 3 0 0 0-3-1.5c-1.66 0-3 .67-3 1.5s1.34 1.5 3 1.5 3 .67 3 1.5-1.34 1.5-3 1.5a3 3 0 0 1-3-1.5"/></svg>',
  };

  /* ============================================================
     §10 — COUNTER ANIMATION
     ============================================================ */
  function animateCounter(el, target) {
    if (!el) return;
    const start = Number(el.dataset.value || 0);
    const end = Number(target) || 0;
    if (start === end) { el.textContent = end; el.dataset.value = end; return; }
    const duration = _dev.reduced ? 0 : 800;
    const t0 = performance.now();
    function step(now) {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = Math.round(start + (end - start) * eased);
      el.textContent = val;
      if (p < 1) requestAnimationFrame(step);
      else { el.textContent = end; el.dataset.value = end; }
    }
    if (duration === 0) { el.textContent = end; el.dataset.value = end; }
    else requestAnimationFrame(step);
  }

  /* ============================================================
     §11 — REFUND TOAST
     ============================================================ */
  function showRefundToast(totalRefund, count) {
    const old = document.getElementById('refundToast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.id = 'refundToast';
    toast.className = 'refund-toast';
    toast.innerHTML = `
      <div class="icon-box">${ICONS.coin}</div>
      <div class="content">
        <div class="title">Refund Diterima</div>
        <div class="message">
          ${count} pesanan di-refund. Total <strong>${formatRupiah(totalRefund)}</strong> masuk ke saldo.
        </div>
      </div>
      <button class="close-btn" type="button" aria-label="Tutup">${ICONS.close}</button>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('show'));
    });

    const timer = setTimeout(() => dismissToast(toast), 8000);
    toast.querySelector('.close-btn').addEventListener('click', () => {
      clearTimeout(timer);
      dismissToast(toast);
    });
  }

  function dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }

  /* ============================================================
     §12 — CUSTOM ALERT
     ============================================================ */
  function showAlert({ title, message, type = 'info', okText = 'OK', showCancel = false, cancelText = 'Batal' }) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('customAlert');
      if (!overlay) { resolve(window.confirm(message || title || 'OK')); return; }

      const iconEl = document.getElementById('customAlertIcon');
      const titleEl = document.getElementById('customAlertTitle');
      const msgEl = document.getElementById('customAlertMessage');
      const actionsEl = document.getElementById('customAlertActions');

      iconEl.className = 'custom-alert-icon ' + type;
      iconEl.innerHTML = ICONS[type] || ICONS.info;
      titleEl.textContent = title || 'Informasi';
      msgEl.textContent = message || '';

      actionsEl.innerHTML = '';
      if (showCancel) {
        const b = document.createElement('button');
        b.className = 'btn';
        b.type = 'button';
        b.textContent = cancelText;
        b.addEventListener('click', () => {
          overlay.classList.remove('active');
          resolve(false);
        });
        actionsEl.appendChild(b);
      }
      const ok = document.createElement('button');
      ok.className = 'btn-primary';
      ok.type = 'button';
      ok.textContent = okText;
      ok.addEventListener('click', () => {
        overlay.classList.remove('active');
        resolve(true);
      });
      actionsEl.appendChild(ok);
      overlay.classList.add('active');
    });
  }

  /* ============================================================
     §13 — THEME
     ============================================================ */
  (function () {
    const btn = document.getElementById('themeBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      const nx = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nx);
      try { SafeStorage.local.set('asyrofotp_theme', nx); } catch (e) {}
      const m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', nx === 'dark' ? '#0a0a0c' : '#eef2f7');
    });
  })();

  /* ============================================================
     §14 — SIDEBAR (desktop collapse)
     ============================================================ */
  (function () {
    const sidebar = document.getElementById('sidebar');
    const collapseBtn = document.getElementById('collapseBtn');
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
      try { SafeStorage.local.set('sidebar_collapsed', c); } catch (e) {}
    });
  })();

  /* ============================================================
     §14b — SIDEBAR (mobile toggle) — FULL TOUCH SUPPORT
     ============================================================ */
  (function () {
    const toggle = document.getElementById('mobileToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!toggle || !sidebar || !overlay) return;

    let open = false;
    let touchMoved = false;

    function openSb() {
      if (open) return;
      open = true;
      sidebar.classList.add('open');
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    function closeSb() {
      if (!open) return;
      open = false;
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }

    // Tap/click pada toggle — support both click & touchend
    let lastToggleTime = 0;
    function onToggle(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const now = Date.now();
      if (now - lastToggleTime < 300) return; // debounce double-fire
      lastToggleTime = now;
      if (open) closeSb(); else openSb();
    }
    toggle.addEventListener('click', onToggle);
    toggle.addEventListener('touchend', onToggle, { passive: false });

    // Overlay tap
    function onOverlay(e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      closeSb();
    }
    overlay.addEventListener('click', onOverlay);
    overlay.addEventListener('touchstart', onOverlay, { passive: false });

    // Auto-close saat nav diklik di mobile
    sidebar.querySelectorAll('.nav-item').forEach(l => {
      l.addEventListener('click', () => {
        if (window.innerWidth <= 768) setTimeout(closeSb, 100);
      });
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) closeSb();
    });

    // Close on resize to desktop
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth > 768 && open) closeSb();
      }, 150);
    });
  })();

  /* ============================================================
     §15 — SERVICE HELPERS
     ============================================================ */
  function getServiceDisplayName(tx) {
    const name = String(tx?.service_name || '').trim();
    if (name) return name;
    const svc = String(tx?.service || '').trim();
    if (svc) return svc;
    return 'Layanan OTP';
  }

  function getServiceInitial(tx) {
    const name = getServiceDisplayName(tx);
    const first = String(name).trim().charAt(0).toUpperCase();
    return /[A-Z0-9]/.test(first) ? first : '#';
  }

  function renderServiceIcon(tx) {
    return `<span>${escapeHtml(getServiceInitial(tx))}</span>`;
  }

  function countryCodeToTwemoji(code) {
    const c = (code || '').toUpperCase();
    if (c.length !== 2) return null;
    return c.split('').map(ch => (0x1F1E6 + ch.charCodeAt(0) - 65).toString(16)).join('-');
  }

  function getFlagSources(code) {
    const c = (code || '').toLowerCase();
    if (!/^[a-z]{2}$/.test(c)) return [];
    const tw = countryCodeToTwemoji(code);
    return [
      tw ? `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/${tw}.svg` : null,
      `https://flagcdn.com/w40/${c}.png`,
    ].filter(Boolean);
  }

  function renderFlag(code, cls = 'tx-flag') {
    const sources = getFlagSources(code);
    if (sources.length === 0) {
      return `<div class="${cls}" style="display:flex;align-items:center;justify-content:center;background:var(--gl-bd2);color:var(--txt3);font-size:0.55rem;font-weight:800;">${escapeHtml((code || '??').toUpperCase())}</div>`;
    }
    const attr = JSON.stringify(sources).replace(/"/g, '&quot;');
    return `<img class="${cls}" src="${sources[0]}" alt="${code}" loading="lazy" data-sources="${attr}" data-idx="0">`;
  }

  window._handleFlagErr = function (img) {
    try {
      const sources = JSON.parse(img.dataset.sources || '[]');
      const idx = parseInt(img.dataset.idx || '0', 10);
      const next = idx + 1;
      if (next < sources.length) {
        img.dataset.idx = next.toString();
        img.src = sources[next];
      } else {
        const code = (img.alt || '??').toUpperCase();
        const ph = document.createElement('div');
        ph.className = img.className;
        ph.style.cssText = 'display:flex;align-items:center;justify-content:center;background:var(--gl-bd2);color:var(--txt3);font-size:0.55rem;font-weight:800;';
        ph.textContent = code;
        img.replaceWith(ph);
      }
    } catch (e) { img.style.display = 'none'; }
  };

  const COUNTRY_NAMES = {
    id: 'Indonesia', ru: 'Rusia', us: 'Amerika Serikat', my: 'Malaysia', vn: 'Vietnam',
    ph: 'Filipina', th: 'Thailand', sg: 'Singapura', in: 'India', cn: 'Tiongkok',
    jp: 'Jepang', kr: 'Korea Selatan', uk: 'Britania Raya', gb: 'Britania Raya',
    de: 'Jerman', fr: 'Prancis', br: 'Brasil', ng: 'Nigeria', pk: 'Pakistan',
    bd: 'Bangladesh', tr: 'Turki', es: 'Spanyol', it: 'Italia', nl: 'Belanda',
    au: 'Australia', ca: 'Kanada', mx: 'Meksiko', ar: 'Argentina', za: 'Afrika Selatan',
    sa: 'Arab Saudi', ae: 'Uni Emirat Arab', pl: 'Polandia', ua: 'Ukraina',
    ro: 'Rumania', kh: 'Kamboja', la: 'Laos', mm: 'Myanmar', tw: 'Taiwan',
    hk: 'Hong Kong', nz: 'Selandia Baru', ch: 'Swiss', se: 'Swedia', no: 'Norwegia',
    fi: 'Finlandia', be: 'Belgia', pt: 'Portugal', eg: 'Mesir', ke: 'Kenya', gh: 'Ghana',
  };

  function getCountryName(tx) {
    const code = String(tx?.country || tx?.country_name || '').trim().toLowerCase();
    const supplied = String(tx?.country_name || '').trim();
    if (supplied && supplied.toLowerCase() !== code) return supplied;
    if (COUNTRY_NAMES[code]) return COUNTRY_NAMES[code];
    if (/^[a-z]{2}$/i.test(code)) {
      try {
        const loc = new Intl.DisplayNames(['id'], { type: 'region' }).of(code.toUpperCase());
        return loc && loc.toLowerCase() !== code ? loc : '—';
      } catch (_) { return '—'; }
    }
    return supplied || '—';
  }

  /* ============================================================
     §16 — LOAD USER (encrypted cache + SWR)
     ============================================================ */
  async function loadUser(force = false) {
    const cached = !force ? await Cache.get('user', _cfg.ttl.user) : null;
    if (cached) renderUser(cached);

    try {
      const res = await fetchWithTimeout(_cfg.ep.user, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      const user = await safeJson(res);
      if (user && !user.error) {
        await Cache.set('user', user);
        renderUser(user);
      }
    } catch (e) {}
  }

  function renderUser(user) {
    if (!user) return;
    const name = user.name || user.username || '—';
    const un = document.getElementById('userName');
    const gn = document.getElementById('greetingName');
    const ub = document.getElementById('userBalance');
    const bp = document.getElementById('balancePill');
    const ui = document.getElementById('userInitial');

    if (un) un.textContent = name;
    if (gn) gn.textContent = name;
    if (ub) ub.textContent = formatRupiah(user.balance);
    if (bp) bp.textContent = formatRupiah(user.balance);
    if (ui) ui.textContent = getInitial(name);

    const gl = document.getElementById('greetingLine');
    if (gl) gl.innerHTML = fillGreeting(name);

    if (user.user_code) {
      const uc = document.getElementById('userCode');
      const cc = document.getElementById('copyUserCode');
      if (uc) uc.textContent = user.user_code;
      if (cc) cc.style.display = 'inline-flex';
    }
  }

  /* ============================================================
     §17 — RENDER DASHBOARD
     ============================================================ */
  let lastTxSig = '';

  function bindTxRows(tbody) {
    // Gunakan event delegation untuk performa & kompatibilitas
    if (tbody.dataset.bound) return;
    tbody.dataset.bound = '1';

    function navigate(row) {
      const oid = row.dataset.orderId;
      if (oid) try { SafeStorage.session.set('highlight_order_id', oid); } catch (_) {}
      location.href = '/inbox';
    }

    tbody.addEventListener('click', (e) => {
      const row = e.target.closest('.tx-row');
      if (row) navigate(row);
    });
    // Fallback untuk browser lama / gesture
    tbody.addEventListener('touchend', (e) => {
      const row = e.target.closest('.tx-row');
      if (!row) return;
      // Hanya navigate kalau tap singkat (bukan scroll)
      if (e.changedTouches && e.changedTouches[0]) {
        const t = e.changedTouches[0];
        if (row._txStartX == null) return;
        const dx = Math.abs(t.clientX - row._txStartX);
        const dy = Math.abs(t.clientY - row._txStartY);
        if (dx < 10 && dy < 10) {
          e.preventDefault();
          navigate(row);
        }
      }
    }, { passive: false });
    tbody.addEventListener('touchstart', (e) => {
      const row = e.target.closest('.tx-row');
      if (!row) return;
      const t = e.changedTouches && e.changedTouches[0];
      if (t) { row._txStartX = t.clientX; row._txStartY = t.clientY; }
    }, { passive: true });
  }

  function renderDashboard(data) {
    if (!data) return;

    animateCounter(document.getElementById('statTotal'), data.stats?.total ?? 0);
    animateCounter(document.getElementById('statSuccess'), data.stats?.success ?? 0);
    animateCounter(document.getElementById('statPending'), data.stats?.pending ?? 0);
    animateCounter(document.getElementById('statFailed'), data.stats?.failed ?? 0);

    const tbody = document.getElementById('transactionsTable');
    if (!tbody) return;

    if (!data.transactions || data.transactions.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center;padding:40px 20px;color:var(--txt2);">
            <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:56px;height:56px;margin:0 auto 12px;display:block;color:var(--txt3);"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
            <strong style="display:block;margin-bottom:6px;color:var(--txt);font-size:0.95rem;">Belum ada transaksi</strong>
            <span style="font-size:0.82rem;">Mulai beli nokos buat lihat riwayat</span>
          </td>
        </tr>
      `;
      lastTxSig = '';
      return;
    }

    const newSig = data.transactions.map(t => [
      t.order_id || '', t.status || '', t.service_name || '',
      t.country || '', t.price || '',
    ].join(':')).join('|');

    if (newSig === lastTxSig) return;
    lastTxSig = newSig;

    const statusMap = {
      success: { class: 'success', label: 'Berhasil' },
      received: { class: 'success', label: 'Berhasil' },
      pending: { class: 'warning', label: 'Pending' },
      failed: { class: 'danger', label: 'Gagal' },
      cancelled: { class: 'danger', label: 'Dibatalkan' },
      expired: { class: 'gray', label: 'Expired' },
      refunded: { class: 'purple', label: 'Refund' },
      confirmed: { class: 'success', label: 'Sukses' },
    };

    tbody.innerHTML = data.transactions.map(t => {
      const s = statusMap[t.status] || { class: 'gray', label: escapeHtml(t.status || '—') };
      const cName = getCountryName(t);
      const oid = String(t.order_id || '').trim();
      return `
        <tr class="tx-row" data-order-id="${escapeHtml(oid)}" role="button" tabindex="0">
          <td>${formatTanggal(t.created_at)}</td>
          <td>
            <div class="tx-service-cell">
              <div class="tx-app-icon">${renderServiceIcon(t)}</div>
              <strong>${escapeHtml(getServiceDisplayName(t))}</strong>
            </div>
          </td>
          <td>
            <div class="tx-country-cell">
              ${renderFlag(t.country, 'tx-flag')}
              <span>${escapeHtml(cName)}</span>
            </div>
          </td>
          <td>${formatRupiah(t.price)}</td>
          <td><span class="badge ${s.class}">${s.label}</span></td>
        </tr>
      `;
    }).join('');

    bindTxRows(tbody);

    tbody.querySelectorAll('img[data-sources]').forEach(img => {
      if (img.dataset.bound) return;
      img.dataset.bound = '1';
      img.addEventListener('error', function () { window._handleFlagErr(this); });
    });
  }

  /* ============================================================
     §18 — LOAD DASHBOARD (encrypted cache + SWR)
     ============================================================ */
  async function loadDashboard(force = false) {
    const cached = !force ? await Cache.get('dash', _cfg.ttl.dashboard) : null;
    if (cached) renderDashboard(cached);

    try {
      const res = await fetchWithTimeout(_cfg.ep.dashboard, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      const data = await safeJson(res);
      if (data && !data.error) {
        await Cache.set('dash', data);
        renderDashboard(data);
      }
    } catch (e) {}
  }

  /* ============================================================
     §19 — CHECK REFUNDS
     ============================================================ */
  let lastRefundCheck = 0;

  async function checkRefunds(silent = false) {
    try {
      const res = await fetchWithTimeout(_cfg.ep.refunds, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
      });
      if (!res.ok) return;
      const data = await safeJson(res);
      lastRefundCheck = Date.now();

      if (data.refunded && data.refunded.length > 0) {
        const total = data.refunded.reduce((s, r) => s + (r.refunded_amount || 0), 0);
        const count = data.refunded.length;
        if (!silent) showRefundToast(total, count);

        if (data.new_balance != null) {
          const ub = document.getElementById('userBalance');
          const bp = document.getElementById('balancePill');
          if (ub) ub.textContent = formatRupiah(data.new_balance);
          if (bp) bp.textContent = formatRupiah(data.new_balance);
        } else {
          Cache.remove('user');
          loadUser(true);
        }

        lastTxSig = '';
        await loadDashboard(true);
      }
    } catch (e) {}
  }

  /* ============================================================
     §20 — LOGOUT
     ============================================================ */
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

  /* ============================================================
     §21 — EVENT BINDINGS (dipindah ke init setelah DOM ready)
     ============================================================ */
  function bindEvents() {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async function () {
        this.classList.add('spinning');
        lastTxSig = '';
        randomizeCopy();
        await Promise.all([
          checkRefunds(false),
          loadUser(true),
          loadDashboard(true),
        ]);
        setTimeout(() => this.classList.remove('spinning'), 500);
      });
    }

    const copyBtn = document.getElementById('copyUserCode');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const codeEl = document.getElementById('userCode');
        const code = codeEl ? codeEl.textContent : '';
        if (!code || code === '—') return;
        const ok = await copyToClipboard(code);
        if (!ok) return;
        const orig = copyBtn.innerHTML;
        copyBtn.innerHTML = ICONS.check + ' Copied!';
        setTimeout(() => copyBtn.innerHTML = orig, 1500);
      });
    }

    const userCodeEl = document.getElementById('userCode');
    if (userCodeEl) {
      userCodeEl.setAttribute('data-copy', '');
      userCodeEl.addEventListener('click', async () => {
        const code = userCodeEl.textContent;
        if (!code || code === '—') return;
        const ok = await copyToClipboard(code);
        if (!ok) return;
        const orig = userCodeEl.textContent;
        userCodeEl.textContent = '✓ Tersalin!';
        setTimeout(() => userCodeEl.textContent = orig, 1200);
      });
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        const ok = await showAlert({
          title: 'Keluar Akun?',
          message: 'Kamu yakin mau keluar dari akun ini?',
          type: 'warning',
          okText: 'Ya, Keluar',
          cancelText: 'Batal',
          showCancel: true,
        });
        if (ok) handleLogout();
      });
    }
  }

  /* ============================================================
     §22 — AUTO REFRESH
     ============================================================ */
  let dashInterval = null;
  let refundInterval = null;

  function startAutoRefresh() {
    if (dashInterval) clearInterval(dashInterval);
    dashInterval = setInterval(() => {
      if (!document.hidden) loadDashboard(false);
    }, _cfg.refreshInterval);

    if (refundInterval) clearInterval(refundInterval);
    refundInterval = setInterval(() => {
      if (!document.hidden) checkRefunds(true);
    }, _cfg.refundInterval);
  }

  function stopAutoRefresh() {
    if (dashInterval) { clearInterval(dashInterval); dashInterval = null; }
    if (refundInterval) { clearInterval(refundInterval); refundInterval = null; }
  }

  /* ============================================================
     §23 — INIT (DOM ready safe)
     ============================================================ */
  async function init() {
    randomizeCopy();
    bindEvents();
    await Promise.all([
      loadUser(false),
      loadDashboard(false),
      checkRefunds(false),
    ]);
    startAutoRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoRefresh();
    } else {
      loadDashboard(false);
      if (Date.now() - lastRefundCheck > _cfg.refundInterval) checkRefunds(true);
      startAutoRefresh();
    }
  });

  // iOS Safari tidak fire beforeunload — pakai pagehide
  window.addEventListener('pagehide', stopAutoRefresh);
  window.addEventListener('beforeunload', stopAutoRefresh);

})(window);
