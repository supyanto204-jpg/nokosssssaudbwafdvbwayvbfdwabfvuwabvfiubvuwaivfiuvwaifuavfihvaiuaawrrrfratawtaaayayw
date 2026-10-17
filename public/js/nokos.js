/* ============================================================
   NOKOS.JS — Beli Nokos + Encrypted Cache + Dynamic Copy
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     §1 — CRYPTO (AES-GCM + PBKDF2)
     ============================================================ */
  const _crypto = (() => {
    const _k = 'bm9rb3Mtc2VjcmV0LWtleS0yMDI2LWFzeXJvZg==';
    const _s = 'c2FsdC1ub2tvcy12MjAyNi1zZWN1cmU=';
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
     §2 — ENCRYPTED CACHE
     ============================================================ */
  const Cache = (() => {
    const P = 'aotp_n_';
    const _mem = new Map();

    async function get(key, ttl) {
      if (_mem.has(key)) {
        const e = _mem.get(key);
        if (!ttl || Date.now() - e.t < ttl) return e.v;
        _mem.delete(key);
      }
      try {
        const raw = localStorage.getItem(P + key);
        if (!raw) return null;
        const e = await _crypto.unseal(raw);
        if (!e) return null;
        if (ttl && Date.now() - e.t > ttl) {
          localStorage.removeItem(P + key);
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
        if (s) localStorage.setItem(P + key, s);
      } catch (err) {}
    }

    function remove(key) {
      _mem.delete(key);
      try { localStorage.removeItem(P + key); } catch (e) {}
    }

    function clear() {
      _mem.clear();
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith(P)) localStorage.removeItem(k);
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
      servers: '/api/nokos/servers',
      services: '/api/nokos/services',
      countries: '/api/nokos/countries',
      prices: '/api/nokos/prices',
      orders: '/api/nokos/orders',
      order: '/api/nokos/order',
      cekotp: '/api/cekotp',
      logout: '/api/auth/logout',
    },
    ttl: {
      user: 5 * 60 * 1000,
      servers: 10 * 60 * 1000,
      services: 10 * 60 * 1000,
      countries: 10 * 60 * 1000,
      prices: 2 * 60 * 1000,
      orders: 30 * 1000,
    },
    autoSync: 5000,
    otpCheck: 10000,
    profileSync: 30000,
    activeLimit: 2,
  };

  /* ============================================================
     §4 — DEVICE DETECTION
     ============================================================ */
  const _dev = (() => {
    const mq = (q) => window.matchMedia(q).matches;
    const hc = navigator.hardwareConcurrency || 4;
    const conn = navigator.connection || {};
    return {
      mobile: mq('(max-width: 768px)'),
      lowEnd: hc <= 4 || conn.saveData || /2g|slow-2g/.test(conn.effectiveType || ''),
      reduced: mq('(prefers-reduced-motion: reduce)'),
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
  const token = localStorage.getItem('access_token');
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

  /* ============================================================
     §8 — DYNAMIC COPY
     ============================================================ */
  const _copy = {
    pageSubtitle: [
      'Nomor OTP langsung, kode OTP muncul sendiri',
      'Verifikasi akun tanpa ribet, OTP masuk otomatis',
      'Nokos ready 24 jam, refund otomatis kalau gagal',
      'Beli nomor, tunggu OTP, selesai. Gampang kan?',
      'Pilih server, aplikasi, negara. OTP langsung nongol',
    ],
    heroTitle: [
      'Beli Nokos',
      'Gas Order Nokos',
      'Pilih Nomor Kamu',
      'Mulai Beli Nokos',
      'Nokos Ready 24 Jam',
    ],
    heroDesc: [
      'Pilih server, aplikasi, lalu negara. Nomor langsung tampil, kode OTP muncul sendiri. Expired 15 menit, auto refund kalau kode ga masuk.',
      'Dapetin nomor virtual buat verifikasi akun. Cepet, murah, otomatis. Kalau gagal, saldo balik penuh.',
      'Verifikasi akun tanpa ribet. Nokos ready 24 jam, refund otomatis kalau kode ga masuk dalam 15 menit.',
      'Beli nomor OTP dalam hitungan detik. OTP langsung masuk inbox kamu. Auto refund kalau gagal.',
      'Butuh nomor buat verifikasi? Semua ada di sini. Pilih server, aplikasi, negara — langsung order.',
    ],
    sectionActive: [
      'Pesanan Aktif',
      'Order Kamu Sekarang',
      'Aktivitas Terkini',
      'Pesanan Berjalan',
    ],
    ctaText: [
      'Pesan Nomor Sekarang',
      'Beli Nokos Sekarang',
      'Gas Order',
      'Mulai Beli',
      'Pilih Nomor',
    ],
    sheetStep1: ['Mau pakai server yang mana?', 'Pilih server dulu ya', 'Server mana yang cocok?'],
    sheetStep2: ['Mau beli nomor untuk aplikasi apa?', 'Pilih aplikasi target', 'Aplikasi apa nih?'],
    sheetStep3: ['Mau nomor dari negara mana?', 'Pilih negara', 'Negara mana yang kamu mau?'],
    sheetStep4: ['Pilih harga yang sesuai', 'Pilih opsi harga', 'Harga mana yang cocok?'],
  };

  function randomizeCopy() {
    const ps = document.getElementById('pageSubtitle');
    if (ps) ps.textContent = pick(_copy.pageSubtitle);
    const ht = document.getElementById('heroTitle');
    if (ht) ht.textContent = pick(_copy.heroTitle);
    const hd = document.getElementById('heroDesc');
    if (hd) hd.textContent = pick(_copy.heroDesc);
    const sat = document.getElementById('sectionActiveTitle');
    if (sat) sat.textContent = pick(_copy.sectionActive);
    const ct = document.getElementById('ctaText');
    if (ct) ct.textContent = pick(_copy.ctaText);
  }

  /* ============================================================
     §9 — ICONS
     ============================================================ */
  const ICONS = {
    check: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    close: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    server: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    copy: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    clock: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    refresh: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    key: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
    checkCircle: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    ban: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  };

  /* ============================================================
     §10 — STATE
     ============================================================ */
  const state = {
    step: 1,
    server: null,
    serverLabel: null,
    requiresOperator: false,
    service: null,
    serviceName: null,
    country: null,
    countryName: null,
    operator: 'any',
    providers: [],
    filter: 'sukses',
  };

  const activeState = {
    page: 1,
    limit: _cfg.activeLimit,
    totalPages: 1,
    allOrders: [],
    countdownIntervals: {},
    hasRenderedOnce: false,
    initialLoadDone: false,
  };

  const ORDER_ID_MAP = new Map();
  const PROVIDER_RAW_MAP = new Map();

  let servicesCache = [];
  let autoSyncInterval = null;
  let otpCheckInterval = null;
  let profileSyncInterval = null;
  let _loadActiveAbort = null;
  let _loadActiveInFlight = false;

  /* ============================================================
     §11 — SANITIZE
     ============================================================ */
  const ALLOWED_ORDER_FIELDS = new Set([
    'otp_id', 'status', 'phone_number', 'otp_code', 'otp_code_2', 'full_sms',
    'price_idr', 'price', 'service', 'service_name',
    'country', 'country_name', 'country_flag', 'operator', 'server',
    'expires_in', 'expired_at', 'created_at', 'updated_at',
    'received_at', 'refunded_at', 'refunded_amount', '_bucket',
  ]);

  const ALLOWED_PROVIDER_FIELDS = new Set([
    'id', 'provider_id', 'provider_price', 'price_idr', 'price',
    'stock', 'available', 'active', 'name', 'operator',
    'product_id', 'catalog_product_id', 'operator_id', 'operator_name',
  ]);

  function sanitizeOrder(order) {
    if (!order || typeof order !== 'object') return order;
    const clean = {};
    for (const key of Object.keys(order)) {
      if (ALLOWED_ORDER_FIELDS.has(key)) clean[key] = order[key];
    }
    return clean;
  }

  function sanitizeProvider(provider) {
    if (!provider || typeof provider !== 'object') return provider;
    const clean = {};
    for (const key of Object.keys(provider)) {
      if (ALLOWED_PROVIDER_FIELDS.has(key)) clean[key] = provider[key];
    }
    return clean;
  }

  /* ============================================================
     §12 — SERVICE HELPERS
     ============================================================ */
  function getServiceDisplayName(order) {
    return String(order?.service_name || order?.service || 'Layanan OTP').trim();
  }

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

  function getCountryName(order) {
    const code = String(order?.country || order?.country_name || '').trim().toLowerCase();
    const supplied = String(order?.country_name || '').trim();
    if (supplied && supplied.toLowerCase() !== code) return supplied;
    if (COUNTRY_NAMES[code]) return COUNTRY_NAMES[code];
    if (/^[a-z]{2}$/i.test(code)) {
      try {
        const loc = new Intl.DisplayNames(['id'], { type: 'region' }).of(code.toUpperCase());
        return loc && loc.toLowerCase() !== code ? loc : 'Negara tidak diketahui';
      } catch (_) { return 'Negara tidak diketahui'; }
    }
    return supplied || 'Negara tidak diketahui';
  }

  function getOtpId(order) {
    const id = String(order?.otp_id || '').trim();
    if (id) return id;
    const seed = [order?.created_at, order?.service, order?.phone_number].join('|');
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    }
    return 'OTP' + (hash >>> 0).toString(36).toUpperCase().slice(-8).padStart(8, '0');
  }

  /* ============================================================
     §13 — FLAG
     ============================================================ */
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

  function renderFlag(code, cls = 'flag-img') {
    const sources = getFlagSources(code);
    if (sources.length === 0) {
      return `<div class="${cls}" style="display:flex;align-items:center;justify-content:center;background:var(--gl-bd2);color:var(--txt3);font-size:0.55rem;font-weight:800;">${escapeHtml((code || '??').toUpperCase())}</div>`;
    }
    const attr = JSON.stringify(sources).replace(/"/g, '&quot;');
    return `<img class="${cls}" src="${sources[0]}" alt="${escapeHtml(code)}" loading="lazy" data-sources="${attr}" data-idx="0">`;
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

  /* ============================================================
     §14 — CLIPBOARD
     ============================================================ */
  function copyToClipboard(text, btnEl) {
    const onOk = () => {
      if (!btnEl) return;
      const orig = btnEl.innerHTML;
      btnEl.innerHTML = ICONS.check;
      setTimeout(() => btnEl.innerHTML = orig, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onOk).catch(() => fallbackCopy(text, onOk));
    } else fallbackCopy(text, onOk);
  }

  function fallbackCopy(text, onOk) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    try {
      const ok = document.execCommand('copy');
      if (ok && typeof onOk === 'function') onOk();
    } catch (e) {}
    document.body.removeChild(ta);
  }

  /* ============================================================
     §15 — CUSTOM ALERT
     ============================================================ */
  function showAlert({ title, message, type = 'info', okText = 'OK', showCancel = false, cancelText = 'Batal' }) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('customAlert');
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
     §16 — THEME
     ============================================================ */
  (function () {
    const btn = document.getElementById('themeBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      const nx = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nx);
      try { localStorage.setItem('asyrofotp_theme', nx); } catch (e) {}
      const m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', nx === 'dark' ? '#0a0a0c' : '#eef2f7');
    });
  })();

  /* ============================================================
     §17 — SIDEBAR
     ============================================================ */
  (function () {
    const sidebar = document.getElementById('sidebar');
    const collapseBtn = document.getElementById('collapseBtn');
    if (!sidebar || !collapseBtn) return;

    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
    if (isCollapsed && window.innerWidth > 768) {
      sidebar.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    }

    collapseBtn.addEventListener('click', () => {
      if (window.innerWidth <= 768) return;
      const c = sidebar.classList.toggle('collapsed');
      document.body.classList.toggle('sidebar-collapsed', c);
      try { localStorage.setItem('sidebar_collapsed', c); } catch (e) {}
    });
  })();

  (function () {
    const toggle = document.getElementById('mobileToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (!toggle || !sidebar || !overlay) return;

    let open = false;
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
    toggle.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (open) closeSb(); else openSb();
    });
    overlay.addEventListener('click', closeSb);
    sidebar.querySelectorAll('.nav-item').forEach(l => {
      l.addEventListener('click', () => {
        if (window.innerWidth <= 768) setTimeout(closeSb, 100);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) closeSb();
    });
  })();

  /* ============================================================
     §18 — RECAPTCHA
     ============================================================ */
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
          grecaptcha.execute(_cfg.rk, { action })
            .then(resolve)
            .catch(() => resolve(null));
        });
        setTimeout(() => resolve(null), 8000);
      });
    } catch (e) { return null; }
  }

  async function securePost(url, body = {}, action = 'nokos') {
    const rc = await getRecaptchaToken(action);
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ ...body, recaptcha_token: rc }),
    });
  }

  /* ============================================================
     §19 — LOAD PROFILE
     ============================================================ */
  async function loadProfile(force = false) {
    if (!force) {
      const cached = await Cache.get('user', _cfg.ttl.user);
      if (cached) renderUser(cached);
    }
    try {
      const res = await fetch(_cfg.ep.user, {
        headers: { Authorization: 'Bearer ' + token },
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
    const nameEl = document.getElementById('userName');
    const balEl = document.getElementById('userBalance');
    const iniEl = document.getElementById('userInitial');
    const pillEl = document.getElementById('balancePill');
    const sheetEl = document.getElementById('sheetBalance');
    if (nameEl) nameEl.textContent = name;
    if (balEl) balEl.textContent = formatRupiah(user.balance);
    if (iniEl) iniEl.textContent = getInitial(name);
    if (pillEl) pillEl.textContent = formatRupiah(user.balance);
    if (sheetEl) sheetEl.textContent = formatRupiah(user.balance);
  }

  /* ============================================================
     §20 — FETCH ACTIVE ORDERS
     ============================================================ */
  async function fetchActiveOrders() {
    const [pRes, sRes] = await Promise.all([
      fetch(_cfg.ep.orders + '?status=pending&limit=50', {
        headers: { Authorization: 'Bearer ' + token },
      }),
      fetch(_cfg.ep.orders + '?status=success&limit=20', {
        headers: { Authorization: 'Bearer ' + token },
      }),
    ]);

    const pRaw = await safeJson(pRes);
    const sRaw = await safeJson(sRes);
    const pData = pRaw?.data || pRaw || {};
    const sData = sRaw?.data || sRaw || {};

    const now = Date.now();
    const FIVE_MIN = 5 * 60 * 1000;

    const pending = (pData.orders || []).map(o => ({ ...sanitizeOrder(o), _bucket: 'pending' }));
    const recent = (sData.orders || [])
      .filter(o => {
        const t = o.updated_at || o.created_at || o.confirmed_at;
        if (!t) return false;
        const ts = new Date(t).getTime();
        return Number.isFinite(ts) && (now - ts) <= FIVE_MIN;
      })
      .map(o => ({ ...sanitizeOrder(o), _bucket: 'success' }));

    const merged = [...pending, ...recent];
    merged.sort((a, b) => {
      if (a._bucket !== b._bucket) return a._bucket === 'pending' ? -1 : 1;
      const ta = new Date(a.updated_at || a.created_at || 0).getTime();
      const tb = new Date(b.updated_at || b.created_at || 0).getTime();
      return tb - ta;
    });
    return merged;
  }

  async function loadActiveOrders() {
    const cached = await Cache.get('orders', _cfg.ttl.orders);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      activeState.allOrders = cached;
      renderActiveOrders(cached);
    }

    if (_loadActiveInFlight) return;
    _loadActiveInFlight = true;
    if (_loadActiveAbort) _loadActiveAbort.abort();
    _loadActiveAbort = new AbortController();

    try {
      const merged = await fetchActiveOrders();

      merged.forEach(o => {
        const otpId = String(o.otp_id || '').trim();
        const realId = String(o.raw_id || o.order_id || '').trim();
        if (otpId && realId) ORDER_ID_MAP.set(otpId, realId);
      });

      activeState.allOrders = merged;

      const safe = merged.map(o => {
        const { raw_id, order_id, ...rest } = o;
        return rest;
      });
      if (safe.length > 0) await Cache.set('orders', safe);
      else Cache.remove('orders');

      renderActiveOrders(merged);
      activeState.initialLoadDone = true;
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (activeState.allOrders.length === 0) {
        const c = document.getElementById('activeOrders');
        if (c) {
          c.className = '';
          c.innerHTML = `
            <div class="empty-orders">
              <div class="icon-box">${ICONS.warning}</div>
              <h3>Gagal memuat pesanan</h3>
              <p>${escapeHtml(err.message || 'Coba refresh halaman')}</p>
            </div>
          `;
        }
      }
    } finally {
      _loadActiveAbort = null;
      _loadActiveInFlight = false;
    }
  }

  /* ============================================================
     §21 — COUNTDOWN
     ============================================================ */
  function getDeadline(key, expiresIn) {
    const k = 'aotp_cd_' + key;
    const now = Date.now();
    try {
      const s = sessionStorage.getItem(k);
      if (s) {
        const d = parseInt(s, 10);
        if (Number.isFinite(d) && d > now) return d;
        sessionStorage.removeItem(k);
      }
    } catch (e) {}
    if (expiresIn > 0) {
      const d = now + expiresIn * 1000;
      try { sessionStorage.setItem(k, String(d)); } catch (e) {}
      return d;
    }
    return 0;
  }

  function clearDeadline(key) {
    try { sessionStorage.removeItem('aotp_cd_' + key); } catch (e) {}
  }

  /* ============================================================
     §22 — BUILD CARD
     ============================================================ */
  function buildCard(o, idx) {
    const isSuccess = o._bucket === 'success' || o.status === 'success' || o.status === 'received' || o.status === 'confirmed';
    const isPending = o.status === 'pending' && !isSuccess;
    const hasOtp = o.otp_code && o.otp_code.trim();
    const otpId = getOtpId(o);
    const hasApiId = Boolean(o.order_id || o.raw_id);
    const svcName = getServiceDisplayName(o);
    const cName = getCountryName(o);
    const expiresIn = Number(o.expires_in || 0);
    const hasValidCd = isPending && !hasOtp && expiresIn > 0;
    const priceIdr = Number(o.price_idr ?? o.price ?? 0);
    const created = formatTanggal(o.created_at);

    if ((o.order_id || o.raw_id) && otpId) ORDER_ID_MAP.set(otpId, o.order_id || o.raw_id);

    const cardClass = isSuccess ? 'is-success' : (isPending ? 'is-pending' : 'is-expired');
    const badgeClass = isSuccess ? 'success' : (isPending ? 'warning' : 'gray');
    const badgeLabel = isSuccess ? 'Berhasil' : (isPending ? (hasOtp ? 'OTP Masuk' : 'Pending') : 'Expired');
    const displayInitial = getInitial(svcName);

    let cdHtml = '';
    if (hasValidCd) {
      const deadline = getDeadline(otpId, expiresIn);
      const rem = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      const m = Math.floor(rem / 60);
      const s = rem % 60;
      const t = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      cdHtml = `<div class="aoc-countdown" data-ref="${escapeHtml(otpId)}" data-deadline="${deadline}">${ICONS.clock}<span class="countdown-text">${t}</span> tersisa</div>`;
    }

    return `
      <div class="aoc-card glass-card ${cardClass}"
           data-ref="${escapeHtml(otpId)}"
           data-bucket="${escapeHtml(o._bucket || '')}"
           data-status="${escapeHtml(o.status || '')}"
           data-has-id="${hasApiId ? '1' : '0'}"
           data-sig="">
        <div class="aoc-header">
          <div class="aoc-card-number">${escapeHtml(displayInitial)}</div>
          <div class="aoc-title-wrap">
            <div class="aoc-title">
              ${escapeHtml(svcName)}
              ${o.operator ? `<span class="badge info" style="font-size:0.58rem;">${escapeHtml(o.operator)}</span>` : ''}
            </div>
            <div class="aoc-ref"><span class="otp-id">${escapeHtml(otpId)}</span></div>
          </div>
          <span class="badge ${badgeClass}">${badgeLabel}</span>
        </div>

        ${hasOtp ? `
          <div class="aoc-otp">
            <div class="aoc-otp-icon">${ICONS.key}</div>
            <div class="aoc-otp-info">
              <div class="aoc-otp-label">Kode OTP</div>
              <div class="aoc-otp-value">${escapeHtml(o.otp_code)}</div>
            </div>
            <button class="aoc-otp-copy" type="button" data-copy="${escapeHtml(o.otp_code)}" title="Copy OTP">${ICONS.copy}</button>
          </div>
        ` : ''}

        <div class="aoc-body">
          <div class="aoc-field">
            <span class="aoc-field-label">Nomor</span>
            <span class="aoc-field-value">
              ${escapeHtml(o.phone_number || '—')}
              ${o.phone_number ? `<button class="aoc-otp-copy" style="width:22px;height:22px;" type="button" data-copy="${escapeHtml(o.phone_number)}" title="Copy">${ICONS.copy}</button>` : ''}
            </span>
          </div>
          <div class="aoc-field">
            <span class="aoc-field-label">Negara</span>
            <span class="aoc-field-value">
              <span class="country-inline">
                ${renderFlag(o.country, 'flag-img')}
                ${escapeHtml(cName)}
              </span>
            </span>
          </div>
          <div class="aoc-field">
            <span class="aoc-field-label">Harga</span>
            <span class="aoc-field-value price">${formatRupiah(priceIdr)}</span>
          </div>
          <div class="aoc-field">
            <span class="aoc-field-label">Dibuat</span>
            <span class="aoc-field-value" style="font-size:0.7rem;">${created}</span>
          </div>
        </div>

        ${cdHtml}

        <div class="aoc-actions">
          ${isPending && hasApiId ? `
            ${hasOtp ? `
              <button class="btn-mini" type="button" data-resend="${escapeHtml(otpId)}">${ICONS.refresh} Resend</button>
              <button class="btn-mini primary" type="button" data-confirm="${escapeHtml(otpId)}">${ICONS.checkCircle} Konfirmasi</button>
            ` : `
              <button class="btn-mini danger" type="button" data-cancel="${escapeHtml(otpId)}">${ICONS.ban} Batalkan</button>
            `}
          ` : `
            <a href="/inbox" class="btn-mini primary" style="text-decoration:none;">${ICONS.info} Lihat Detail</a>
          `}
        </div>
      </div>
    `;
  }

  function bindCard(card) {
    card.querySelectorAll('[data-copy]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(btn.dataset.copy, btn);
      });
    });
    card.querySelectorAll('[data-resend]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const id = ORDER_ID_MAP.get(btn.dataset.resend) || btn.dataset.resend;
        resendOrder(id, btn);
      });
    });
    card.querySelectorAll('[data-confirm]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const id = ORDER_ID_MAP.get(btn.dataset.confirm) || btn.dataset.confirm;
        confirmOrder(id, btn);
      });
    });
    card.querySelectorAll('[data-cancel]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const id = ORDER_ID_MAP.get(btn.dataset.cancel) || btn.dataset.cancel;
        cancelOrder(id, btn);
      });
    });
    card.querySelectorAll('img[data-sources]').forEach(img => {
      if (img.dataset.bound) return;
      img.dataset.bound = '1';
      img.addEventListener('error', function () { window._handleFlagErr(this); });
    });
  }

  /* ============================================================
     §23 — RENDER ACTIVE
     ============================================================ */
  function renderActiveOrders(orders) {
    const container = document.getElementById('activeOrders');
    const countEl = document.getElementById('activeCount');
    const pagEl = document.getElementById('activeOrdersPagination');
    if (!container) return;

    const hasOrders = Array.isArray(orders) && orders.length > 0;

    if (!hasOrders) {
      if (activeState.allOrders.length > 0) return;
      container.className = '';
      container.innerHTML = `
        <div class="empty-orders">
          <div class="icon-box">
            <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
          </div>
          <h3>Belum ada pesanan aktif</h3>
          <p>Nomor yang kamu beli bakal muncul di sini beserta kode OTP-nya.</p>
        </div>
      `;
      if (countEl) countEl.style.display = 'none';
      if (pagEl) pagEl.style.display = 'none';
      return;
    }

    activeState.hasRenderedOnce = true;
    if (countEl) {
      countEl.textContent = orders.length;
      countEl.style.display = 'inline-flex';
    }

    const total = orders.length;
    activeState.totalPages = Math.max(1, Math.ceil(total / activeState.limit));
    if (activeState.page > activeState.totalPages) activeState.page = activeState.totalPages;
    const start = (activeState.page - 1) * activeState.limit;
    const pageOrders = orders.slice(start, start + activeState.limit);

    if (!container.classList.contains('active-orders')) {
      container.className = 'active-orders';
    }
    const emptyEl = container.querySelector('.empty-orders');
    if (emptyEl) emptyEl.remove();

    const existing = new Map();
    container.querySelectorAll(':scope > .aoc-card').forEach(card => {
      const id = card.dataset.ref;
      if (id) existing.set(id, card);
    });

    const frag = document.createDocumentFragment();

    pageOrders.forEach((o, idx) => {
      const otpId = getOtpId(o);
      const key = otpId || `fb-${idx}`;
      const tmp = document.createElement('div');
      tmp.innerHTML = buildCard(o, start + idx).trim();
      const newCard = tmp.firstElementChild;

      const newSig = [
        o.status || '',
        (o.otp_code || '').trim(),
        (o.phone_number || '').trim(),
        (o.service || '').trim(),
        o._bucket || '',
      ].join('|');

      const old = existing.get(key);
      const oldSig = old ? old.dataset.sig || '' : null;

      if (old && oldSig === newSig) {
        frag.appendChild(old);
        existing.delete(key);
        return;
      }

      if (old) {
        old.remove();
        if (activeState.countdownIntervals[key]) {
          clearInterval(activeState.countdownIntervals[key]);
          delete activeState.countdownIntervals[key];
        }
        clearDeadline(key);
        existing.delete(key);
      }

      newCard.dataset.sig = newSig;
      bindCard(newCard);
      frag.appendChild(newCard);
    });

    existing.forEach((card, id) => {
      card.remove();
      if (activeState.countdownIntervals[id]) {
        clearInterval(activeState.countdownIntervals[id]);
        delete activeState.countdownIntervals[id];
      }
      clearDeadline(id);
    });

    container.appendChild(frag);

    if (activeState.totalPages > 1) {
      pagEl.style.display = 'flex';
      pagEl.innerHTML = `
        <button class="page-btn" type="button" data-page="${activeState.page - 1}" ${activeState.page <= 1 ? 'disabled' : ''}>Prev</button>
        <span class="page-info">Halaman ${activeState.page} dari ${activeState.totalPages}</span>
        <button class="page-btn" type="button" data-page="${activeState.page + 1}" ${activeState.page >= activeState.totalPages ? 'disabled' : ''}>Next</button>
      `;
      pagEl.querySelectorAll('.page-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = Number(btn.dataset.page);
          if (p >= 1 && p <= activeState.totalPages) {
            activeState.page = p;
            renderActiveOrders(activeState.allOrders);
          }
        });
      });
    } else {
      pagEl.style.display = 'none';
    }

    startCountdowns();
  }

  function startCountdowns() {
    Object.values(activeState.countdownIntervals).forEach(clearInterval);
    activeState.countdownIntervals = {};

    document.querySelectorAll('.aoc-countdown').forEach(el => {
      const ref = el.dataset.ref;
      const deadline = parseInt(el.dataset.deadline || '0', 10);
      const textEl = el.querySelector('.countdown-text');

      if (!deadline) {
        if (textEl) textEl.textContent = 'EXPIRED';
        el.classList.add('expired');
        return;
      }

      function tick() {
        const rem = Math.floor((deadline - Date.now()) / 1000);
        if (rem <= 0) {
          el.classList.add('expired');
          if (textEl) textEl.textContent = 'EXPIRED';
          if (activeState.countdownIntervals[ref]) clearInterval(activeState.countdownIntervals[ref]);
          clearDeadline(ref);
          setTimeout(() => {
            Cache.remove('orders');
            loadActiveOrders();
          }, 500);
          return;
        }
        const m = Math.floor(rem / 60);
        const s = rem % 60;
        if (textEl) textEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      }

      tick();
      activeState.countdownIntervals[ref] = setInterval(tick, 1000);
    });
  }

  /* ============================================================
     §24 — SYNC PENDING OTP
     ============================================================ */
  async function syncPendingOrders() {
    const pending = activeState.allOrders.filter(o =>
      o._bucket === 'pending' && o.status === 'pending' && !(o.otp_code && o.otp_code.trim())
    );
    if (pending.length === 0) return;

    const results = await Promise.allSettled(
      pending.map(o => {
        const otpId = String(o.otp_id || '').trim();
        const realId = ORDER_ID_MAP.get(otpId) || o.order_id || o.raw_id;
        return securePost(_cfg.ep.cekotp, { order_id: realId, otp_id: otpId }, 'cekotp').then(r => safeJson(r));
      })
    );

    let hasUpdate = false;
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const data = r.value;
      if (!data) continue;
      if (data.updated || data.otp_code || data.status !== 'pending') {
        hasUpdate = true;
        if (data.otp_code) {
          Cache.remove('user');
          loadProfile(true);
        }
      }
    }

    if (hasUpdate) {
      Cache.remove('orders');
      loadActiveOrders();
    }
  }

  /* ============================================================
     §25 — AUTO SYNC
     ============================================================ */
  function startAutoSync() {
    if (autoSyncInterval) clearInterval(autoSyncInterval);
    autoSyncInterval = setInterval(() => {
      if (!document.hidden) loadActiveOrders();
    }, _cfg.autoSync);

    if (otpCheckInterval) clearInterval(otpCheckInterval);
    otpCheckInterval = setInterval(() => {
      if (!document.hidden) syncPendingOrders();
    }, _cfg.otpCheck);

    if (profileSyncInterval) clearInterval(profileSyncInterval);
    profileSyncInterval = setInterval(() => {
      if (!document.hidden) loadProfile(false);
    }, _cfg.profileSync);
  }

  function stopAutoSync() {
    if (autoSyncInterval) { clearInterval(autoSyncInterval); autoSyncInterval = null; }
    if (otpCheckInterval) { clearInterval(otpCheckInterval); otpCheckInterval = null; }
    if (profileSyncInterval) { clearInterval(profileSyncInterval); profileSyncInterval = null; }
  }

  /* ============================================================
     §26 — ACTION HANDLERS
     ============================================================ */
  async function resendOrder(orderId, btn) {
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span>';
    try {
      const res = await securePost(_cfg.ep.order + '/' + encodeURIComponent(orderId) + '/resend', {}, 'resend');
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Gagal resend');
      await showAlert({ title: 'Resend Berhasil', message: 'SMS resend berhasil dikirim. Tunggu kode OTP masuk.', type: 'success' });
      Cache.remove('orders');
      loadActiveOrders();
    } catch (err) {
      await showAlert({ title: 'Gagal Resend', message: err.message, type: 'danger' });
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  async function confirmOrder(orderId, btn) {
    const ok = await showAlert({
      title: 'Konfirmasi Sukses',
      message: 'Yakin order ini sudah sukses? Setelah dikonfirmasi, order akan dianggap selesai dan tidak bisa dibatalkan.',
      type: 'success',
      okText: 'Ya, Konfirmasi',
      showCancel: true,
    });
    if (!ok) return;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span>';
    try {
      const res = await securePost(_cfg.ep.order + '/' + encodeURIComponent(orderId) + '/confirm', {}, 'confirm');
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Gagal konfirmasi');
      await showAlert({ title: 'Order Sukses', message: 'Order berhasil dikonfirmasi sukses. Terima kasih!', type: 'success' });
      Cache.remove('orders');
      loadActiveOrders();
    } catch (err) {
      await showAlert({ title: 'Gagal Konfirmasi', message: err.message, type: 'danger' });
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  async function cancelOrder(orderId, btn) {
    const ok = await showAlert({
      title: 'Batalkan Pesanan',
      message: 'Yakin mau batalkan pesanan ini? Saldo akan dikembalikan sesuai kebijakan.',
      type: 'warning',
      okText: 'Ya, Batalkan',
      showCancel: true,
    });
    if (!ok) return;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span>';
    try {
      const res = await securePost(_cfg.ep.order + '/' + encodeURIComponent(orderId) + '/cancel', {}, 'cancel');
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Gagal batalkan');
      await showAlert({ title: 'Dibatalkan', message: 'Pesanan berhasil dibatalkan. Saldo sudah dikembalikan.', type: 'success' });
      Cache.remove('user');
      Cache.remove('orders');
      loadProfile(true);
      loadActiveOrders();
    } catch (err) {
      await showAlert({ title: 'Gagal', message: err.message, type: 'danger' });
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  /* ============================================================
     §27 — BOTTOM SHEET
     ============================================================ */
  function openSheet() {
    document.getElementById('sheetOverlay').classList.add('active');
    document.body.classList.add('sheet-open');
  }
  function closeSheet() {
    document.getElementById('sheetOverlay').classList.remove('active');
    document.body.classList.remove('sheet-open');
  }

  document.getElementById('btnOrder').addEventListener('click', () => {
    openSheet();
    goToStep(1);
  });
  document.getElementById('sheetOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'sheetOverlay') closeSheet();
  });

  function goToStep(step) {
    state.step = step;
    const body = document.getElementById('sheetBody');
    const stepEl = document.getElementById('sheetStep');
    const titleEl = document.getElementById('sheetTitle');
    if (body) body.scrollTop = 0;
    if (step === 1) {
      stepEl.textContent = 'Langkah 1 · Pilih Server';
      titleEl.textContent = pick(_copy.sheetStep1);
      renderServerStep();
    } else if (step === 2) {
      stepEl.textContent = 'Langkah 2 · Pilih Aplikasi';
      titleEl.textContent = pick(_copy.sheetStep2);
      renderAppStep();
    } else if (step === 3) {
      stepEl.textContent = 'Langkah 3 · Pilih Negara';
      titleEl.textContent = pick(_copy.sheetStep3);
      renderCountryStep();
    } else if (step === 4) {
      stepEl.textContent = 'Langkah 4 · Pilih Harga';
      titleEl.textContent = pick(_copy.sheetStep4);
      renderPriceStep();
    }
  }

  async function renderServerStep() {
    const body = document.getElementById('sheetBody');
    body.innerHTML = `<div class="loading-block"><span class="spinner"></span><span>Memuat server...</span></div>`;

    const cached = await Cache.get('servers', _cfg.ttl.servers);
    if (cached && cached.length > 0) renderServers(cached);

    try {
      const res = await fetch(_cfg.ep.servers, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await safeJson(res);
      const servers = data.servers || [];
      if (servers.length > 0) await Cache.set('servers', servers);
      renderServers(servers);
    } catch (err) {
      if (!cached) {
        body.innerHTML = `<div class="empty-block"><h3>Gagal memuat server</h3><p>${escapeHtml(err.message)}</p></div>`;
      }
    }
  }

  function renderServers(servers) {
    const body = document.getElementById('sheetBody');
    if (!servers || servers.length === 0) {
      body.innerHTML = `<div class="empty-block"><h3>Belum ada server</h3><p>Coba lagi nanti.</p></div>`;
      return;
    }
    body.innerHTML = `
      <div class="server-list">
        ${servers.map(s => `
          <button class="server-card" type="button" data-server="${escapeHtml(s.id)}" data-label="${escapeHtml(s.label)}" data-operator="${s.requiresOperator}">
            <div class="server-icon">${ICONS.server}</div>
            <div class="server-info">
              <div class="server-title">
                ${escapeHtml(s.label)}
                ${s.badge ? `<span class="server-badge">${escapeHtml(s.badge)}</span>` : ''}
              </div>
              <div class="server-desc">${escapeHtml(s.desc || '')}</div>
            </div>
            <div class="server-arrow"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>
          </button>
        `).join('')}
      </div>
    `;
    body.querySelectorAll('.server-card').forEach(card => {
      card.addEventListener('click', () => {
        state.server = card.dataset.server;
        state.serverLabel = card.dataset.label;
        state.requiresOperator = card.dataset.operator === 'true';
        state.service = null;
        state.country = null;
        goToStep(2);
      });
    });
  }

  async function renderAppStep() {
    const body = document.getElementById('sheetBody');
    body.innerHTML = `
      <button class="sheet-back" type="button" id="backBtn">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Ganti Server
      </button>
      <div class="sheet-search">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="form-control" id="appSearch" placeholder="Cari nama aplikasi...">
      </div>
      <div id="appContent"><div class="loading-block"><span class="spinner"></span><span>Memuat aplikasi...</span></div></div>
    `;
    document.getElementById('backBtn').addEventListener('click', () => goToStep(1));

    const ck = `services_${state.server}`;
    const cached = await Cache.get(ck, _cfg.ttl.services);
    if (cached && cached.length > 0) {
      servicesCache = cached;
      renderApps(servicesCache);
    }

    try {
      const res = await fetch(_cfg.ep.services + '?server=' + encodeURIComponent(state.server), {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await safeJson(res);
      servicesCache = data.services || [];
      if (servicesCache.length > 0) await Cache.set(ck, servicesCache);
      renderApps(servicesCache);
      const search = document.getElementById('appSearch');
      if (search) {
        search.addEventListener('input', (e) => {
          const q = e.target.value.toLowerCase().trim();
          const f = servicesCache.filter(s =>
            (s.name || '').toLowerCase().includes(q) || (s.code || '').toLowerCase().includes(q)
          );
          renderApps(f);
        });
      }
    } catch (err) {
      if (!cached) {
        const c = document.getElementById('appContent');
        if (c) c.innerHTML = `<div class="empty-block"><h3>Gagal memuat aplikasi</h3><p>${escapeHtml(err.message)}</p></div>`;
      }
    }
  }

  function renderApps(services) {
    const c = document.getElementById('appContent');
    if (!c) return;
    if (!services || services.length === 0) {
      c.innerHTML = `<div class="empty-block"><h3>Belum ada aplikasi</h3><p>Server ini belum punya aplikasi tersedia.</p></div>`;
      return;
    }
    c.innerHTML = `
      <div class="app-grid">
        ${services.map(s => {
          const ini = getInitial(s.name);
          return `
            <button class="app-card" type="button" data-service="${escapeHtml(s.code)}" data-name="${escapeHtml(s.name)}">
              <div class="app-list-number">${escapeHtml(ini)}</div>
              <div class="name">${escapeHtml(s.name)}</div>
            </button>
          `;
        }).join('')}
      </div>
    `;
    c.querySelectorAll('.app-card').forEach(btn => {
      btn.addEventListener('click', () => {
        state.service = btn.dataset.service;
        state.serviceName = btn.dataset.name;
        state.country = null;
        state.operator = 'any';
        goToStep(3);
      });
    });
  }

  async function renderCountryStep() {
    const body = document.getElementById('sheetBody');
    body.innerHTML = `
      <button class="sheet-back" type="button" id="backBtn">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Ganti Aplikasi
      </button>
      <div class="app-selected-card">
        <div class="app-list-number">${escapeHtml(getInitial(state.serviceName))}</div>
        <div class="info">
          <div class="name">${escapeHtml(state.serviceName || '')}</div>
          <div class="sub">Aplikasi yang dipilih</div>
        </div>
      </div>
      <div class="sheet-search">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" class="form-control" id="countrySearch" placeholder="Cari nama negara...">
      </div>
      <div id="countryContent"><div class="loading-block"><span class="spinner"></span><span>Memuat negara...</span></div></div>
    `;
    document.getElementById('backBtn').addEventListener('click', () => goToStep(2));

    const ck = `countries_${state.server}_${state.service}`;
    const cached = await Cache.get(ck, _cfg.ttl.countries);
    if (cached && cached.length > 0) renderCountries(cached);

    try {
      const res = await fetch(
        _cfg.ep.countries + '?server=' + encodeURIComponent(state.server) + '&service=' + encodeURIComponent(state.service),
        { headers: { Authorization: 'Bearer ' + token } }
      );
      const data = await safeJson(res);
      const countries = data.countries || [];
      if (countries.length > 0) await Cache.set(ck, countries);
      renderCountries(countries);
      const search = document.getElementById('countrySearch');
      if (search) {
        search.addEventListener('input', (e) => {
          const q = e.target.value.toLowerCase().trim();
          const f = countries.filter(c =>
            (c.name || '').toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q)
          );
          renderCountries(f);
        });
      }
    } catch (err) {
      if (!cached) {
        const c = document.getElementById('countryContent');
        if (c) c.innerHTML = `<div class="empty-block"><h3>Gagal memuat negara</h3><p>${escapeHtml(err.message)}</p></div>`;
      }
    }
  }

  function renderCountries(countries) {
    const c = document.getElementById('countryContent');
    if (!c) return;
    if (!countries || countries.length === 0) {
      c.innerHTML = `<div class="empty-block"><h3>Belum ada negara</h3><p>Server ini belum punya negara tersedia.</p></div>`;
      return;
    }
    c.innerHTML = `
      <div class="country-list">
        ${countries.map(co => `
          <button class="country-item" type="button" data-country="${escapeHtml(co.code)}" data-name="${escapeHtml(co.name)}">
            <div class="country-flag">${renderFlag(co.code)}</div>
            <div class="country-info">
              <div class="country-name">${escapeHtml(co.name)}</div>
              <div class="country-meta">Kode: ${escapeHtml((co.code || '').toUpperCase())}</div>
            </div>
            <div class="country-arrow"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>
          </button>
        `).join('')}
      </div>
    `;
    c.querySelectorAll('.country-item').forEach(item => {
      item.addEventListener('click', () => {
        state.country = item.dataset.country;
        state.countryName = item.dataset.name;
        state.operator = 'any';
        goToStep(4);
      });
    });
    c.querySelectorAll('img[data-sources]').forEach(img => {
      img.addEventListener('error', function () { window._handleFlagErr(this); });
    });
  }

  async function renderPriceStep() {
    const body = document.getElementById('sheetBody');
    body.innerHTML = `
      <button class="sheet-back" type="button" id="backBtn">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Ganti Negara
      </button>
      <div class="app-selected-card">
        <div class="app-list-number">${escapeHtml(getInitial(state.serviceName))}</div>
        <div class="info">
          <div class="name">${escapeHtml(state.serviceName || '')}</div>
          <div class="sub">
            <span class="country-inline">${renderFlag(state.country)} ${escapeHtml(state.countryName || '')}</span>
          </div>
        </div>
      </div>
      <div class="sheet-tabs">
        <button class="sheet-tab active" type="button" data-filter="sukses">Paling Sukses</button>
        <button class="sheet-tab" type="button" data-filter="murah">Termurah</button>
      </div>
      <div id="priceContent"><div class="loading-block"><span class="spinner"></span><span>Memuat harga...</span></div></div>
    `;
    document.getElementById('backBtn').addEventListener('click', () => goToStep(3));

    document.querySelectorAll('.sheet-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.sheet-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.filter = tab.dataset.filter;
        renderPrices(state.providers);
      });
    });

    const ck = `prices_${state.server}_${state.service}_${state.country}`;
    const cached = await Cache.get(ck, _cfg.ttl.prices);
    if (cached && cached.length > 0) {
      state.providers = cached;
      renderPrices(state.providers);
    }

    try {
      const res = await fetch(
        _cfg.ep.prices + '?server=' + encodeURIComponent(state.server) +
        '&service=' + encodeURIComponent(state.service) +
        '&country=' + encodeURIComponent(state.country),
        { headers: { Authorization: 'Bearer ' + token } }
      );
      const data = await safeJson(res);
      const raw = data.providers || [];

      PROVIDER_RAW_MAP.clear();
      raw.forEach(p => {
        const pid = String(p.id || p.provider_id || '').trim();
        if (pid) {
          PROVIDER_RAW_MAP.set(pid, {
            id: p.id,
            provider_id: p.provider_id,
            provider_price: p.provider_price,
            price: p.price,
          });
        }
      });

      const providers = raw.map(p => ({
        ...sanitizeProvider(p),
        _pid: String(p.id || p.provider_id || '').trim(),
      }));

      state.providers = providers;
      if (providers.length > 0) await Cache.set(ck, providers);
      renderPrices(providers);
    } catch (err) {
      if (!cached) {
        const c = document.getElementById('priceContent');
        if (c) c.innerHTML = `<div class="empty-block"><h3>Gagal memuat harga</h3><p>${escapeHtml(err.message)}</p></div>`;
      }
    }
  }

  function renderPrices(providers) {
    const c = document.getElementById('priceContent');
    if (!c) return;

    const list = (providers || []).filter(p => p.active !== false);
    if (list.length === 0) {
      c.innerHTML = `<div class="empty-block"><h3>Stok habis</h3><p>Belum ada stok tersedia untuk kombinasi ini.</p></div>`;
      return;
    }

    const sorted = [...list];
    if (state.filter === 'murah') sorted.sort((a, b) => a.price_idr - b.price_idr);
    else sorted.sort((a, b) => (b.stock || 0) - (a.stock || 0));

    const svcIni = getInitial(state.serviceName);

    c.innerHTML = `
      <div class="price-list">
        ${sorted.map((p, i) => {
          const stock = Number(p.stock) || Number(p.available) || 0;
          const sc = stock === 0 ? 'out' : (stock < 50 ? 'low' : '');
          return `
            <div class="price-item">
              <div class="app-list-number">${escapeHtml(svcIni)}</div>
              <div class="price-info">
                <div class="price-title">
                  Opsi ${i + 1}
                  <span class="price-stock ${sc}">${stock} stok</span>
                </div>
                <div class="price-meta">${escapeHtml(state.countryName || '')}</div>
              </div>
              <div class="price-right">
                <div class="price-amount">${formatRupiah(p.price_idr)}</div>
                <button class="btn-primary" type="button" data-buy-pid="${escapeHtml(p._pid || '')}" ${stock === 0 ? 'disabled' : ''}>
                  <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
                  ORDER
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    c.querySelectorAll('[data-buy-pid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.buyPid;
        const p = sorted.find(x => String(x._pid) === String(pid));
        if (p) confirmOrder(pid, p, btn);
      });
    });
  }

  async function confirmOrder(pid, priceData, btn) {
    const price = Number(priceData.price_idr || priceData.price || 0);
    const ok = await showAlert({
      title: 'Konfirmasi Pembelian',
      message: `Beli nomor ${state.serviceName} dari ${state.countryName} dengan harga ${formatRupiah(price)}? Saldo akan langsung terpotong.`,
      type: 'warning',
      okText: 'Ya, Beli',
      showCancel: true,
      cancelText: 'Batal',
    });
    if (!ok) return;
    placeOrder(pid, priceData, btn);
  }

  async function placeOrder(pid, priceData, btn) {
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span>';
    try {
      const raw = PROVIDER_RAW_MAP.get(pid) || {};
      const expected = Number(priceData.price_idr || priceData.price || 0);
      const body = {
        server: state.server,
        service: state.service,
        country: state.country,
        service_name: state.serviceName,
        country_flag: state.country,
        expected_price: expected,
      };
      if (state.requiresOperator) {
        body.provider_id = raw.provider_id || raw.id;
        body.provider_price = raw.provider_price || raw.price;
        body.operator = state.operator || 'any';
      } else {
        body.id = raw.id || pid;
      }
      const res = await securePost(_cfg.ep.order, body, 'order');
      const data = await safeJson(res);
      if (!res.ok) {
        const code = data.code || '';
        if (code === 'PRICE_CHANGED') throw new Error(`Harga berubah jadi ${formatRupiah(data.actual)}. Silakan pilih ulang.`);
        if (code === 'INSUFFICIENT_USER_BALANCE') throw new Error('Saldo kamu tidak cukup. Silakan deposit dulu.');
        if (code === 'INSUFFICIENT_BALANCE' || code === 'INSUFFICIENT_PROVIDER_BALANCE') throw new Error('Server sedang sibuk, coba lagi nanti.');
        throw new Error(data.error || 'Order gagal');
      }
      closeSheet();
      PROVIDER_RAW_MAP.clear();
      Cache.remove('user');
      Cache.remove('orders');
      document.getElementById('modalSuccess').classList.add('active');
      setTimeout(() => {
        loadProfile(true);
        loadActiveOrders();
      }, 500);
    } catch (err) {
      await showAlert({ title: 'Order Gagal', message: err.message || 'Terjadi kesalahan', type: 'danger' });
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  /* ============================================================
     §28 — MODAL CLOSE
     ============================================================ */
  document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('modal-overlay')) {
      e.target.classList.remove('active');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const m = document.querySelector('.modal-overlay.active');
      if (m) m.classList.remove('active');
      const s = document.getElementById('sheetOverlay');
      if (s && s.classList.contains('active')) closeSheet();
    }
  });

  /* ============================================================
     §29 — LOGOUT
     ============================================================ */
  async function handleLogout() {
    try {
      await fetch(_cfg.ep.logout, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      });
    } catch (e) {}
    Cache.clear();
    ORDER_ID_MAP.clear();
    PROVIDER_RAW_MAP.clear();
    try {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      localStorage.removeItem('refresh_token');
    } catch (e) {}
    location.href = '/landing';
  }

  document.getElementById('logoutBtn').addEventListener('click', async () => {
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

  /* ============================================================
     §30 — INIT
     ============================================================ */
  (function initEmptyState() {
    const c = document.getElementById('activeOrders');
    if (!c) return;
    c.className = '';
    c.innerHTML = `
      <div class="empty-orders">
        <div class="icon-box">
          <span class="spinner" style="width:24px;height:24px;border-width:2.5px;"></span>
        </div>
        <h3>Memuat pesanan...</h3>
        <p>Sedang mengambil data pesanan aktif kamu.</p>
      </div>
    `;
  })();

  (async () => {
    randomizeCopy();
    await Promise.allSettled([
      loadProfile(false),
      loadActiveOrders(),
    ]);
    startAutoSync();
  })();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadProfile(false);
      loadActiveOrders();
      syncPendingOrders();
    }
  });

  window.addEventListener('beforeunload', () => {
    stopAutoSync();
    Object.values(activeState.countdownIntervals).forEach(clearInterval);
    if (_loadActiveAbort) _loadActiveAbort.abort();
  });

})(window);
