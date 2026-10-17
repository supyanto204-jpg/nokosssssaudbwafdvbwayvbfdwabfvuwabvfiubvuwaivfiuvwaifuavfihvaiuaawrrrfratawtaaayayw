/* ============================================================
   INBOX.JS — v6 FINAL
   - Safe storage (Safari Private Mode)
   - Sidebar toggle dengan touch + body.sidebar-open
   - Fetch timeout (network lemot tidak hang)
   - Guard getElementById
   - pagehide untuk iOS
   ============================================================ */
(function (global) {
  'use strict';

  /* §1 — CRYPTO (AES-GCM + PBKDF2) */
  const _crypto = (() => {
    const _k = 'aW5ib3gtc2VjcmV0LWtleS0yMDI2LWFzeXJvZg==';
    const _s = 'c2FsdC1pbmJveC12MjAyNi1zZWN1cmU=';
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
    function _fallbackSeal(obj) {
      try { return 'fb:' + btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
      catch (e) { return null; }
    }
    function _fallbackUnseal(b64) {
      try { return JSON.parse(decodeURIComponent(escape(atob(b64.slice(3))))); }
      catch (e) { return null; }
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

  /* §2 — CACHE (encrypted + memory) */
  const Cache = (() => {
    const P = 'aotp_i_';
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
    function invalidate(prefix) {
      _mem.forEach((_, k) => { if (k.startsWith(prefix)) _mem.delete(k); });
      try {
        SafeStorage.local.keys().forEach(k => {
          if (k.startsWith(P + prefix)) SafeStorage.local.remove(k);
        });
      } catch (e) {}
    }
    function clear() {
      _mem.clear();
      try {
        SafeStorage.local.keys().forEach(k => {
          if (k.startsWith(P)) SafeStorage.local.remove(k);
        });
      } catch (e) {}
    }
    return { get, set, remove, invalidate, clear };
  })();

  /* §3 — CONFIG */
  const _cfg = {
    rk: '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg',
    ep: {
      user: '/api/user',
      orders: '/api/nokos/orders',
      stats: '/api/nokos/orders/stats',
      orderDetail: '/api/nokos/order',
      cekotp: '/api/cekotp',
      checkRefunds: '/api/nokos/check-refunds',
      logout: '/api/auth/logout',
    },
    ttl: {
      user: 5 * 60 * 1000,
      orders: 30 * 1000,
      counts: 60 * 1000,
    },
    autoSync: 5000,
    refundCheck: 30000,
    pageLimit: 5,
    fetchTimeout: 12000,
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
  if (_dev.reduced || _dev.lowEnd) {
    document.documentElement.setAttribute('data-perf', 'lite');
  }

  /* §5 — SECURITY soft */
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

  /* §6 — AUTH (safe localStorage) */
  let token = null;
  try {
    token = SafeStorage.local.get('access_token');
  } catch (e) {
    token = null;
  }
  if (!token) {
    location.href = '/login';
    return;
  }

  /* §7 — HELPERS */
  function safeJson(res) { return res.json().catch(() => ({})); }

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
  function formatTanggalLong(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('id-ID', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch (e) { return '—'; }
  }
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /* §8 — DYNAMIC COPY */
  const _copy = {
    pageSubtitle: [
      'Riwayat pesanan & kode OTP kamu',
      'Semua OTP masuk sini',
      'Cek pesanan & status OTP kamu',
      'Inbox kamu, semua ada di sini',
    ],
    heroTitle: ['Inbox','Pesan Kamu','Riwayat OTP','Semua Pesanan'],
    heroDesc: [
      'Semua nomor Nokos, kode OTP, dan status pesananmu tersusun rapi di satu tempat.',
      'Cek OTP masuk, status pesanan, dan riwayat transaksi. Auto-refresh tiap 5 detik.',
      'Kode OTP kamu langsung muncul di sini. Pantau status pesanan secara real-time.',
      'Semua pesanan nokos kamu, lengkap dengan kode OTP dan status terbaru.',
    ],
    sectionTag: [
      'Pesanan Nokos · Pembaruan otomatis',
      'Riwayat Nokos · Live update',
      'Data Pesanan · Auto sync',
      'Semua Pesanan · Real-time',
    ],
    syncText: [
      'Menyinkronkan status pesanan...',
      'Update data terbaru...',
      'Cek status OTP...',
      'Refresh otomatis...',
    ],
  };

  function randomizeCopy() {
    const ps = document.getElementById('pageSubtitle');
    if (ps) ps.textContent = pick(_copy.pageSubtitle);
    const ht = document.getElementById('heroTitle');
    if (ht) ht.textContent = pick(_copy.heroTitle);
    const hd = document.getElementById('heroDesc');
    if (hd) hd.textContent = pick(_copy.heroDesc);
    const st = document.getElementById('sectionTagText');
    if (st) st.textContent = pick(_copy.sectionTag);
    const stx = document.getElementById('syncText');
    if (stx) stx.textContent = pick(_copy.syncText);
  }

  /* §9 — ICONS */
  const ICONS = {
    check: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    close: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    key: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
    copy: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    refresh: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    clock: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    coin: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M15 9.5a3 3 0 0 0-3-1.5c-1.66 0-3 .67-3 1.5s1.34 1.5 3 1.5 3 .67 3 1.5-1.34 1.5-3 1.5a3 3 0 0 1-3-1.5"/></svg>',
    checkCircle: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    ban: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    inbox: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    phone: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
  };

  /* §10 — STATE */
  const state = {
    page: 1,
    limit: _cfg.pageLimit,
    totalPages: 1,
    refreshInterval: null,
    countdownIntervals: {},
    counts: { nokos: 0 },
    refundChecked: false,
  };

  let _loadOrdersAbort = null;
  let _loadOrdersInFlight = false;
  let _pollInFlight = false;
  let _lastRefundCheck = 0;

  /* §11 — SANITIZE */
  const ALLOWED_FIELDS = new Set([
    'otp_id', 'order_id', 'status', 'phone_number', 'otp_code', 'otp_code_2', 'full_sms',
    'price_idr', 'price', 'service', 'service_name',
    'country', 'country_name', 'country_flag', 'operator', 'server',
    'expires_in', 'expired_at', 'created_at', 'updated_at', 'confirmed_at',
    'received_at', 'refunded_at', 'refunded_amount',
  ]);

  function sanitizeOrder(o) {
    if (!o || typeof o !== 'object') return o;
    const clean = {};
    for (const key of Object.keys(o)) {
      if (ALLOWED_FIELDS.has(key)) clean[key] = o[key];
    }
    return clean;
  }

  /* §12 — SERVICE HELPERS */
  function getServiceDisplayName(o) {
    return String(o?.service_name || o?.service || 'Layanan OTP').trim();
  }
  function getServiceInitial(o) {
    const name = getServiceDisplayName(o);
    const first = String(name).trim().charAt(0).toUpperCase();
    return /[A-Z0-9]/.test(first) ? first : '#';
  }
  function renderServiceIcon(o) {
    return `<span class="icon-fallback">${escapeHtml(getServiceInitial(o))}</span>`;
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
  function getCountryName(o) {
    const code = String(o?.country || o?.country_name || '').trim().toLowerCase();
    const supplied = String(o?.country_name || '').trim();
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
  function getOtpId(o) {
    const id = String(o?.otp_id || '').trim();
    if (id) return id;
    const seed = [o?.order_id, o?.created_at, o?.service, o?.phone_number].join('|');
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    return 'OTP' + (hash >>> 0).toString(36).toUpperCase().slice(-8).padStart(8, '0');
  }

  /* §13 — FLAG */
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

  /* §14 — CLIPBOARD */
  function copyToClipboard(text, btnEl) {
    const onOk = () => {
      if (!btnEl) return;
      btnEl.classList.add('copied');
      const orig = btnEl.innerHTML;
      btnEl.innerHTML = ICONS.check;
      setTimeout(() => {
        btnEl.classList.remove('copied');
        btnEl.innerHTML = orig;
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onOk).catch(() => fallbackCopy(text, onOk));
    } else fallbackCopy(text, onOk);
  }
  function fallbackCopy(text, onOk) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      if (ok && typeof onOk === 'function') onOk();
      document.body.removeChild(ta);
    } catch (e) {
      try {
        const t = document.querySelector('textarea[readonly]');
        if (t) t.remove();
      } catch (_) {}
    }
  }

  /* §15 — CUSTOM ALERT */
  function showAlert({ title, message, type = 'info', okText = 'OK', showCancel = false, cancelText = 'Batal' }) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('customAlert');
      if (!overlay) { resolve(window.confirm(message || title || 'OK')); return; }
      const iconEl = document.getElementById('customAlertIcon');
      const titleEl = document.getElementById('customAlertTitle');
      const msgEl = document.getElementById('customAlertMessage');
      const actionsEl = document.getElementById('customAlertActions');
      if (!iconEl || !titleEl || !msgEl || !actionsEl) { resolve(false); return; }

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

  /* §16 — THEME */
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

  /* §17a — SIDEBAR (desktop collapse) */
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

  /* §17b — SIDEBAR (mobile toggle) — FIX: sidebar-open + touch + debounce */
  (function () {
    const toggle = document.getElementById('mobileToggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
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

  /* §18 — RECAPTCHA */
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
  async function securePost(url, body = {}, action = 'inbox') {
    const rc = await getRecaptchaToken(action);
    return fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ ...body, recaptcha_token: rc }),
    });
  }

  /* §19 — LOAD USER */
  async function loadUser(force = false) {
    if (!force) {
      const cached = await Cache.get('user', _cfg.ttl.user);
      if (cached) renderUser(cached);
    }
    try {
      const res = await fetchWithTimeout(_cfg.ep.user, {
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
    if (nameEl) nameEl.textContent = name;
    if (balEl) balEl.textContent = formatRupiah(user.balance);
    if (iniEl) iniEl.textContent = getInitial(name);
    if (pillEl) pillEl.textContent = formatRupiah(user.balance);
  }

  /* §20 — CHECK REFUNDS */
  async function checkRefunds(silent = false) {
    const indicator = document.getElementById('syncIndicator');
    if (!state.refundChecked && !silent && indicator) indicator.style.display = 'inline-flex';

    try {
      const res = await securePost(_cfg.ep.checkRefunds, {}, 'check_refunds');
      const data = await safeJson(res);
      _lastRefundCheck = Date.now();
      if (data.refunded && data.refunded.length > 0) {
        Cache.remove('user');
        loadUser(true);
        Cache.invalidate('orders_');
        Cache.remove('counts');
        const total = data.refunded.reduce((s, r) => s + (r.refunded_amount || 0), 0);
        if (total > 0) {
          await showAlert({
            title: 'Refund Otomatis',
            message: `${data.refunded.length} pesanan di-refund. Total ${formatRupiah(total)} udah masuk ke saldo kamu.`,
            type: 'success',
          });
        }
        await loadOrders(true);
        await loadCounts();
      }
    } catch (err) {
      if (!silent) console.warn('Check refunds error:', err);
    } finally {
      state.refundChecked = true;
      if (indicator) indicator.style.display = 'none';
    }
  }

  /* §21 — LOAD ORDERS */
  async function loadOrders(silent = false) {
    const container = document.getElementById('ordersContainer');
    if (!container) return;
    const cacheKey = `orders_p${state.page}`;
    const cached = await Cache.get(cacheKey, _cfg.ttl.orders);

    if (cached && cached.orders) {
      renderOrders(cached, true);
    } else if (!silent && container.querySelector('.skeleton-order')) {
      // already has skeleton, skip
    } else if (!silent) {
      container.innerHTML = `
        <div class="skeleton-order"><div class="skel skel-line" style="width:60%"></div><div class="skel skel-line" style="width:40%"></div></div>
        <div class="skeleton-order"><div class="skel skel-line" style="width:55%"></div><div class="skel skel-line" style="width:45%"></div></div>
        <div class="skeleton-order"><div class="skel skel-line" style="width:65%"></div><div class="skel skel-line" style="width:35%"></div></div>
      `;
    }

    if (_loadOrdersInFlight) return;
    _loadOrdersInFlight = true;
    if (_loadOrdersAbort) _loadOrdersAbort.abort();
    _loadOrdersAbort = new AbortController();

    try {
      const url = `${_cfg.ep.orders}?page=${state.page}&limit=${state.limit}&status=nokos`;
      const res = await fetchWithTimeout(url, {
        headers: { Authorization: 'Bearer ' + token },
        signal: _loadOrdersAbort.signal,
      });
      if (res.status === 401 || res.status === 403) {
        handleLogout();
        return;
      }
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Gagal memuat inbox');

      if (data.orders) {
        data.orders = data.orders.map(sanitizeOrder);
      }
      await Cache.set(cacheKey, data);
      renderOrders(data, false);
      loadCounts();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!cached && !silent) {
        container.innerHTML = `
          <div class="empty-inbox">
            <div class="icon-box">${ICONS.warning}</div>
            <h3>Gagal memuat pesanan</h3>
            <p>${escapeHtml(err.message || 'Coba refresh halaman')}</p>
          </div>
        `;
      }
    } finally {
      _loadOrdersAbort = null;
      _loadOrdersInFlight = false;
    }
  }

  /* §22 — LOAD COUNTS */
  async function loadCounts() {
    const cached = await Cache.get('counts', _cfg.ttl.counts);
    if (cached) applyCounts(cached);
    try {
      const res = await fetchWithTimeout(_cfg.ep.stats, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Gagal memuat stats');
      await Cache.set('counts', data);
      applyCounts(data);
    } catch (err) {}
  }
  function applyCounts(data) {
    if (!data) return;
    state.counts = { nokos: Number(data.nokos ?? data.all ?? 0) };
  }

  /* §23 — COUNTDOWN */
  function getDeadline(key, expiresIn) {
    const k = 'aotp_cd_' + key;
    const now = Date.now();
    try {
      const s = SafeStorage.session.get(k);
      if (s) {
        const d = parseInt(s, 10);
        if (Number.isFinite(d) && d > now) return d;
        SafeStorage.session.remove(k);
      }
    } catch (e) {}
    if (expiresIn > 0) {
      const d = now + expiresIn * 1000;
      try { SafeStorage.session.set(k, String(d)); } catch (e) {}
      return d;
    }
    return 0;
  }
  function clearDeadline(key) {
    try { SafeStorage.session.remove('aotp_cd_' + key); } catch (e) {}
  }

  /* §24 — BUILD CARD */
  function buildCard(o) {
    const statusMap = {
      success: { class: 'success', label: 'Berhasil', badge: 'success' },
      received: { class: 'success', label: 'Berhasil', badge: 'success' },
      confirmed: { class: 'success', label: 'Sukses', badge: 'success' },
      pending: { class: 'pending', label: 'Pending', badge: 'warning' },
      failed: { class: 'failed', label: 'Gagal', badge: 'danger' },
      cancelled: { class: 'cancelled', label: 'Dibatalkan', badge: 'danger' },
      expired: { class: 'expired', label: 'Expired', badge: 'gray' },
      refunded: { class: 'refunded', label: 'Refund', badge: 'purple' },
    };
    const s = statusMap[o.status] || { class: 'pending', label: escapeHtml(o.status), badge: 'warning' };
    const hasOtp = o.otp_code && o.otp_code.trim();
    const isPending = o.status === 'pending';
    const isRefunded = o.status === 'refunded' || (o.refunded_at && Number(o.refunded_at) > 0);
    const isConfirmed = ['confirmed', 'success', 'received'].includes(o.status);
    const otpId = getOtpId(o);
    const apiOrderId = String(o.order_id || '').trim();
    const hasApiId = Boolean(apiOrderId);
    const svcName = getServiceDisplayName(o);
    const cName = getCountryName(o);
    const expiresIn = Number(o.expires_in || 0);
    const hasValidCd = isPending && !isConfirmed && expiresIn > 0;
    const priceIdr = Number(o.price_idr ?? o.price ?? 0);
    const created = formatTanggal(o.created_at);

    const infoGrid = `
      <div class="order-body">
        <div class="order-field">
          <span class="order-field-label">Nomor</span>
          <span class="order-field-value">
            ${escapeHtml(o.phone_number || '—')}
            ${o.phone_number ? `<button class="copy-inline" type="button" data-copy="${escapeHtml(o.phone_number)}" title="Copy nomor">${ICONS.copy}</button>` : ''}
          </span>
        </div>
        <div class="order-field">
          <span class="order-field-label">Negara</span>
          <span class="order-field-value">
            <span class="country-inline">
              ${renderFlag(o.country, 'flag-img')}
              ${escapeHtml(cName)}
            </span>
          </span>
        </div>
        <div class="order-field">
          <span class="order-field-label">Harga</span>
          <span class="order-field-value price">${formatRupiah(priceIdr)}</span>
        </div>
        <div class="order-field">
          <span class="order-field-label">Dibuat</span>
          <span class="order-field-value" style="font-size:0.75rem;">${created}</span>
        </div>
      </div>
    `;

    const otpBox = hasOtp ? `
      <div class="otp-box">
        <div class="otp-icon">${ICONS.key}</div>
        <div class="otp-info">
          <div class="otp-info-label">Kode OTP</div>
          <div class="otp-info-value">${escapeHtml(o.otp_code)}</div>
        </div>
        <button class="otp-copy" type="button" data-copy="${escapeHtml(o.otp_code)}" title="Copy OTP">${ICONS.copy}</button>
      </div>
    ` : '';

    const bodyBlock = (hasOtp && isConfirmed)
      ? `<div class="order-success-layout">${otpBox}${infoGrid}</div>`
      : `${infoGrid}${otpBox}`;

    let cdHtml = '';
    if (hasValidCd && !hasOtp && hasApiId) {
      const deadline = getDeadline(apiOrderId, expiresIn);
      const rem = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      const m = Math.floor(rem / 60);
      const sc = rem % 60;
      const t = `${m.toString().padStart(2, '0')}:${sc.toString().padStart(2, '0')}`;
      cdHtml = `<div class="order-countdown" data-order-id="${escapeHtml(apiOrderId)}" data-deadline="${deadline}">${ICONS.clock}<span class="countdown-text">${t}</span> tersisa</div>`;
    }

    return `
      <div class="order-card glass-card ${s.class}"
           data-order-id="${escapeHtml(apiOrderId)}"
           data-otp-id="${escapeHtml(otpId)}"
           data-price="${priceIdr}"
           data-service="${escapeHtml(svcName)}"
           data-country="${escapeHtml(cName)}"
           data-country-code="${escapeHtml(o.country || '')}"
           data-status="${escapeHtml(o.status || '')}"
           data-phone="${escapeHtml(o.phone_number || '')}"
           data-sig="">
        <div class="order-header">
          <div class="order-app-icon" title="${escapeHtml(svcName)}">${renderServiceIcon(o)}</div>
          <div class="order-title-wrap">
            <div class="order-title">
              ${escapeHtml(svcName)}
              ${o.operator ? `<span class="badge info" style="font-size:0.6rem;">${escapeHtml(o.operator)}</span>` : ''}
            </div>
            <div class="order-ref"><span class="otp-id">${escapeHtml(otpId)}</span></div>
          </div>
          <div class="order-status-badge"><span class="badge ${s.badge}">${s.label}</span></div>
        </div>

        ${bodyBlock}
        ${cdHtml}

        ${hasOtp && o.full_sms ? `
          <div class="sms-box">
            <span class="sms-label">SMS:</span>
            <span class="sms-text">${escapeHtml(o.full_sms)}</span>
            <button class="copy-inline" type="button" data-copy="${escapeHtml(o.full_sms)}" title="Copy SMS">${ICONS.copy}</button>
          </div>
        ` : ''}

        ${isRefunded ? `
          <div class="refund-box">
            <div class="refund-icon">${ICONS.coin}</div>
            <div class="refund-info">
              <div class="refund-info-label">Refund Diterima</div>
              <div class="refund-info-value">${formatRupiah(o.refunded_amount || priceIdr)}</div>
              <div class="refund-note">Saldo udah otomatis masuk ke akun kamu</div>
            </div>
          </div>
        ` : ''}

        ${isPending && !hasOtp && !isRefunded ? `
          <div class="pending-box">
            <span class="spinner-sm"></span>
            <span>Menunggu kode OTP masuk... auto-refresh tiap 5 detik.</span>
          </div>
        ` : ''}

        ${isPending && hasOtp ? `
          <div class="pending-box" style="border-style:solid;border-color:var(--ok);background:rgba(52,199,89,0.12);color:var(--ok);">
            <span style="display:inline-flex;align-items:center;gap:6px;font-weight:700;">${ICONS.check} OTP sudah diterima. Konfirmasi atau tunggu waktu habis.</span>
          </div>
        ` : ''}

        <div class="order-actions">
          ${isPending ? `
            ${hasOtp && hasValidCd && hasApiId ? `
              <button class="btn-mini" type="button" data-resend="${escapeHtml(apiOrderId)}">${ICONS.refresh} Resend SMS</button>
            ` : ''}
            ${hasOtp && hasValidCd && hasApiId ? `
              <button class="btn-mini primary" type="button" data-confirm="${escapeHtml(apiOrderId)}">${ICONS.checkCircle} Konfirmasi</button>
            ` : ''}
            ${!hasOtp && hasApiId ? `
              <button class="btn-mini danger" type="button" data-cancel="${escapeHtml(apiOrderId)}">${ICONS.ban} Batalkan</button>
            ` : ''}
          ` : `
            <button class="btn-mini primary" type="button" data-detail="${escapeHtml(apiOrderId)}" ${hasApiId ? '' : 'disabled'}>
              ${ICONS.info} ${hasApiId ? 'Lihat Detail' : 'Detail tidak tersedia'}
            </button>
          `}
        </div>
      </div>
    `;
  }

  function attachCardHandlers(card) {
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
      btn.addEventListener('click', () => resendOrder(btn.dataset.resend, btn));
    });
    card.querySelectorAll('[data-confirm]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => confirmOrder(btn.dataset.confirm, btn));
    });
    card.querySelectorAll('[data-cancel]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => cancelOrder(btn.dataset.cancel, btn));
    });
    card.querySelectorAll('[data-detail]').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const c = btn.closest('.order-card');
        showOrderDetail(btn.dataset.detail, c);
      });
    });
    card.querySelectorAll('img[data-sources]').forEach(img => {
      if (img.dataset.bound) return;
      img.dataset.bound = '1';
      img.addEventListener('error', function () { window._handleFlagErr(this); });
    });
  }

  /* §25 — RENDER ORDERS */
  function renderOrders(data, fromCache) {
    const container = document.getElementById('ordersContainer');
    if (!container) return;
    const paginationEl = document.getElementById('pagination');

    if (!data.orders || data.orders.length === 0) {
      container.innerHTML = `
        <div class="empty-inbox">
          <div class="icon-box">${ICONS.inbox}</div>
          <h3>Belum ada pesanan Nokos</h3>
          <p>Pesanan nomor virtual dan kode OTP kamu akan muncul di sini.</p>
          <a href="/nokos" class="btn-primary" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none;padding:12px 20px;border-radius:12px;background:var(--grad);color:#fff;font-weight:700;box-shadow:0 6px 18px rgba(10,132,255,0.35);margin-top:16px;">
            <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
            Beli Nokos
          </a>
        </div>
      `;
      if (paginationEl) paginationEl.style.display = 'none';
      return;
    }

    let listWrap = container.querySelector('.orders-list');
    if (!listWrap) {
      container.innerHTML = '<div class="orders-list"></div>';
      listWrap = container.querySelector('.orders-list');
    }

    const existingCards = new Map();
    listWrap.querySelectorAll(':scope > .order-card').forEach(card => {
      const id = card.dataset.orderId || card.dataset.otpId;
      if (id) existingCards.set(id, card);
    });

    const frag = document.createDocumentFragment();
    data.orders.forEach((o, idx) => {
      const apiOrderId = String(o.order_id || '').trim();
      const cardKey = apiOrderId || o.otp_id || `fb-${idx}`;

      const tmp = document.createElement('div');
      tmp.innerHTML = buildCard(o).trim();
      const newCard = tmp.firstElementChild;

      const newSig = [
        o.status || '',
        (o.otp_code || '').trim(),
        (o.phone_number || '').trim(),
        (o.service || '').trim(),
        (o.refunded_at || ''),
        Number(o.refunded_amount || 0),
      ].join('|');

      const existing = existingCards.get(cardKey);
      const oldSig = existing ? existing.dataset.sig || '' : null;

      if (existing && oldSig === newSig) {
        frag.appendChild(existing);
        existingCards.delete(cardKey);
        return;
      }

      if (existing) {
        existing.remove();
        if (state.countdownIntervals[cardKey]) {
          clearInterval(state.countdownIntervals[cardKey]);
          delete state.countdownIntervals[cardKey];
        }
        clearDeadline(cardKey);
        existingCards.delete(cardKey);
      }

      newCard.dataset.sig = newSig;
      attachCardHandlers(newCard);
      frag.appendChild(newCard);
    });

    existingCards.forEach((card, id) => {
      card.remove();
      if (state.countdownIntervals[id]) {
        clearInterval(state.countdownIntervals[id]);
        delete state.countdownIntervals[id];
      }
      clearDeadline(id);
    });

    listWrap.appendChild(frag);

    state.totalPages = Math.ceil((data.total || 0) / state.limit);
    if (paginationEl) {
      if (state.totalPages > 1) {
        paginationEl.style.display = 'flex';
        paginationEl.innerHTML = `
          <button class="page-btn" type="button" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>Prev</button>
          <span class="page-info">Halaman ${state.page} dari ${state.totalPages}</span>
          <button class="page-btn" type="button" data-page="${state.page + 1}" ${state.page >= state.totalPages ? 'disabled' : ''}>Next</button>
        `;
        paginationEl.querySelectorAll('.page-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const p = Number(btn.dataset.page);
            if (p >= 1 && p <= state.totalPages) {
              state.page = p;
              loadOrders();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          });
        });
      } else {
        paginationEl.style.display = 'none';
      }
    }

    startCountdowns();
  }

  function startCountdowns() {
    Object.values(state.countdownIntervals).forEach(clearInterval);
    state.countdownIntervals = {};

    document.querySelectorAll('.order-countdown').forEach(el => {
      const orderId = el.dataset.orderId;
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
          if (state.countdownIntervals[orderId]) clearInterval(state.countdownIntervals[orderId]);
          clearDeadline(orderId);
          setTimeout(() => {
            Cache.invalidate('orders_');
            loadOrders(true);
          }, 500);
          return;
        }
        const m = Math.floor(rem / 60);
        const s = rem % 60;
        if (textEl) textEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      }
      tick();
      state.countdownIntervals[orderId] = setInterval(tick, 1000);
    });
  }

  /* §26 — POLL PENDING */
  async function pollPendingOrders(orders) {
    if (orders.length === 0 || _pollInFlight) return;
    _pollInFlight = true;

    try {
      const results = await Promise.allSettled(
        orders.map(o => fetchWithTimeout(_cfg.ep.cekotp, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify({ order_id: o.order_id, otp_id: o.otp_id }),
        }).then(r => safeJson(r)))
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
            loadUser(true);
          }
        }
      }

      if (hasUpdate) {
        Cache.invalidate('orders_');
        loadOrders(true);
        loadCounts();
      }
    } finally {
      _pollInFlight = false;
    }
  }

  /* §27 — ACTIONS */
  async function resendOrder(orderId, btn) {
    const ok = await showAlert({
      title: 'Resend SMS',
      message: 'Yakin mau kirim ulang SMS? Pastikan waktu masih berjalan.',
      type: 'warning',
      okText: 'Ya, Resend',
      showCancel: true,
    });
    if (!ok) return;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span>';
    try {
      const res = await securePost(_cfg.ep.orderDetail + '/' + encodeURIComponent(orderId) + '/resend', {}, 'resend');
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Gagal resend');
      await showAlert({ title: 'Resend Berhasil', message: 'SMS resend berhasil dikirim. Tunggu kode OTP masuk.', type: 'success' });
      Cache.invalidate('orders_');
      loadOrders(true);
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
      const res = await securePost(_cfg.ep.orderDetail + '/' + encodeURIComponent(orderId) + '/confirm', {}, 'confirm');
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Gagal konfirmasi');
      await showAlert({ title: 'Order Sukses', message: 'Order berhasil dikonfirmasi sukses. Terima kasih!', type: 'success' });
      Cache.invalidate('orders_');
      loadOrders(true);
      loadCounts();
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
      const res = await securePost(_cfg.ep.orderDetail + '/' + encodeURIComponent(orderId) + '/cancel', {}, 'cancel');
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || 'Gagal batalkan');
      await showAlert({ title: 'Dibatalkan', message: 'Pesanan berhasil dibatalkan. Saldo sudah dikembalikan.', type: 'success' });
      Cache.remove('user');
      loadUser(true);
      Cache.invalidate('orders_');
      loadOrders(true);
      loadCounts();
    } catch (err) {
      await showAlert({ title: 'Gagal', message: err.message, type: 'danger' });
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  }

  /* §28 — DETAIL MODAL */
  function openDetailModal() {
    const el = document.getElementById('detailModal');
    if (el) el.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function closeDetailModal() {
    const el = document.getElementById('detailModal');
    if (el) el.classList.remove('active');
    document.body.style.overflow = '';
  }

  function bindDetailImages(root) {
    if (!root) return;
    root.querySelectorAll('img[data-sources]').forEach(img => {
      if (img.dataset.bound) return;
      img.dataset.bound = '1';
      img.addEventListener('error', function () { window._handleFlagErr(this); });
    });
  }

  function renderDetailSkeleton(card) {
    const mc = document.getElementById('detailModalContent');
    if (!mc) return;
    const otpId = card?.dataset.otpId || '';
    const priceIdr = Number(card?.dataset.price || 0);
    const svcName = card?.dataset.service || '';
    const cName = card?.dataset.country || '';
    const cCode = card?.dataset.countryCode || '';
    const phone = card?.dataset.phone || '';
    mc.innerHTML = `
      <div class="detail-modal-header">
        <div class="detail-modal-app" title="${escapeHtml(svcName)}">${renderServiceIcon({ service_name: svcName })}</div>
        <div class="detail-modal-title-wrap">
          <div class="detail-modal-title">${escapeHtml(svcName || 'Layanan OTP')}</div>
          <div class="detail-modal-subtitle">OTP ID · ${escapeHtml(otpId)}</div>
        </div>
        <button class="detail-modal-close" type="button" id="detailModalClose">${ICONS.close}</button>
      </div>
      <div class="detail-modal-body">
        <div class="detail-status-badge gray">${ICONS.info} Memuat...</div>
        <div class="detail-grid">
          <div class="detail-item full">
            <span class="detail-item-label">OTP ID</span>
            <span class="detail-item-value primary">${escapeHtml(otpId)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-item-label">Harga</span>
            <span class="detail-item-value primary">${formatRupiah(priceIdr)}</span>
          </div>
          ${phone ? `<div class="detail-item"><span class="detail-item-label">Nomor</span><span class="detail-item-value">${escapeHtml(phone)}</span></div>` : ''}
          <div class="detail-item full">
            <span class="detail-item-label">Negara</span>
            <span class="detail-item-value"><span class="country-inline">${renderFlag(cCode, 'flag-img')} ${escapeHtml(cName)}</span></span>
          </div>
        </div>
        <div class="detail-skeleton-row" style="width:100%"></div>
        <div class="detail-skeleton-row" style="width:80%"></div>
        <div class="detail-actions">
          <button class="btn-primary" type="button" id="detailModalCloseBtn">Tutup</button>
        </div>
      </div>
    `;
    const close1 = document.getElementById('detailModalClose');
    if (close1) close1.addEventListener('click', closeDetailModal);
    const close2 = document.getElementById('detailModalCloseBtn');
    if (close2) close2.addEventListener('click', closeDetailModal);
    bindDetailImages(mc);
  }

  function renderDetailFull(o) {
    const statusMap = {
      success: { label: 'Berhasil', cls: 'success' },
      received: { label: 'Berhasil', cls: 'success' },
      confirmed: { label: 'Sukses', cls: 'success' },
      pending: { label: 'Pending', cls: 'pending' },
      failed: { label: 'Gagal', cls: 'danger' },
      cancelled: { label: 'Dibatalkan', cls: 'danger' },
      expired: { label: 'Expired', cls: 'gray' },
      refunded: { label: 'Refund', cls: 'purple' },
    };
    const s = statusMap[o.status] || { label: escapeHtml(o.status || '—'), cls: 'gray' };
    const statusIcon = {
      success: ICONS.checkCircle, pending: ICONS.clock, danger: ICONS.close,
      gray: ICONS.clock, purple: ICONS.coin,
    }[s.cls] || ICONS.info;

    const isRefunded = o.refunded_at && Number(o.refunded_at) > 0;
    const hasOtp = o.otp_code && o.otp_code.trim();
    const hasPhone = o.phone_number && o.phone_number.trim();
    const hasSms = o.full_sms && o.full_sms.trim();
    const svcName = getServiceDisplayName(o);
    const cName = getCountryName(o);
    const otpId = getOtpId(o);
    const priceIdr = Number(o.price_idr ?? o.price ?? 0);

    const mc = document.getElementById('detailModalContent');
    if (!mc) return;
    mc.innerHTML = `
      <div class="detail-modal-header">
        <div class="detail-modal-app" title="${escapeHtml(svcName)}">${renderServiceIcon(o)}</div>
        <div class="detail-modal-title-wrap">
          <div class="detail-modal-title">${escapeHtml(svcName)}</div>
          <div class="detail-modal-subtitle">OTP ID · ${escapeHtml(otpId)}</div>
        </div>
        <button class="detail-modal-close" type="button" id="detailModalClose">${ICONS.close}</button>
      </div>
      <div class="detail-modal-body">
        <div class="detail-status-badge ${s.cls}">${statusIcon} ${s.label}</div>

        ${hasOtp ? `
          <div class="detail-otp-highlight">
            <div class="label">Kode OTP</div>
            <div class="value">${escapeHtml(o.otp_code)}</div>
            <button class="copy-btn" type="button" data-copy="${escapeHtml(o.otp_code)}">${ICONS.copy} Copy OTP</button>
          </div>
        ` : ''}

        <div class="detail-grid">
          <div class="detail-item full">
            <span class="detail-item-label">OTP ID</span>
            <span class="detail-item-value primary">
              ${escapeHtml(otpId)}
              <button class="copy-inline" type="button" data-copy="${escapeHtml(otpId)}" title="Copy OTP ID">${ICONS.copy}</button>
            </span>
          </div>
          ${hasPhone ? `
            <div class="detail-item full">
              <span class="detail-item-label">Nomor</span>
              <span class="detail-item-value">
                ${escapeHtml(o.phone_number)}
                <button class="copy-inline" type="button" data-copy="${escapeHtml(o.phone_number)}" title="Copy nomor">${ICONS.copy}</button>
              </span>
            </div>
          ` : ''}
          <div class="detail-item">
            <span class="detail-item-label">Negara</span>
            <span class="detail-item-value">
              <span class="country-inline">${renderFlag(o.country, 'flag-img')} ${escapeHtml(cName)}</span>
            </span>
          </div>
          ${o.operator ? `<div class="detail-item"><span class="detail-item-label">Operator</span><span class="detail-item-value">${escapeHtml(o.operator)}</span></div>` : ''}
          <div class="detail-item">
            <span class="detail-item-label">Harga</span>
            <span class="detail-item-value primary">${formatRupiah(priceIdr)}</span>
          </div>
          ${isRefunded ? `
            <div class="detail-item">
              <span class="detail-item-label">Refund</span>
              <span class="detail-item-value purple">${formatRupiah(o.refunded_amount || priceIdr)}</span>
            </div>
          ` : ''}
          <div class="detail-item">
            <span class="detail-item-label">Dibuat</span>
            <span class="detail-item-value" style="font-size:0.75rem;">${formatTanggalLong(o.created_at)}</span>
          </div>
          ${o.updated_at ? `
            <div class="detail-item">
              <span class="detail-item-label">Diupdate</span>
              <span class="detail-item-value" style="font-size:0.75rem;">${formatTanggalLong(o.updated_at)}</span>
            </div>
          ` : ''}
        </div>

        ${hasSms ? `
          <div class="detail-sms-box">
            <span class="sms-label">SMS</span>
            <span class="sms-text">
              ${escapeHtml(o.full_sms)}
              <button class="copy-inline" type="button" data-copy="${escapeHtml(o.full_sms)}" title="Copy SMS">${ICONS.copy}</button>
            </span>
          </div>
        ` : ''}

        <div class="detail-actions">
          <button class="btn-primary" type="button" id="detailModalCloseBtn">Tutup</button>
        </div>
      </div>
    `;
    mc.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(btn.dataset.copy, btn);
      });
    });
    const close1 = document.getElementById('detailModalClose');
    if (close1) close1.addEventListener('click', closeDetailModal);
    const close2 = document.getElementById('detailModalCloseBtn');
    if (close2) close2.addEventListener('click', closeDetailModal);
    bindDetailImages(mc);
  }

  async function showOrderDetail(orderId, card) {
    renderDetailSkeleton(card);
    openDetailModal();
    try {
      const res = await fetchWithTimeout(_cfg.ep.orderDetail + '/' + encodeURIComponent(orderId), {
        headers: { Authorization: 'Bearer ' + token },
      });
      const o = await safeJson(res);
      if (!o || o.error) throw new Error(o.error || 'Order tidak ditemukan');
      renderDetailFull(o);
    } catch (err) {
      const mb = document.querySelector('#detailModalContent .detail-modal-body');
      if (mb) {
        const badge = mb.querySelector('.detail-status-badge');
        if (badge) {
          badge.className = 'detail-status-badge danger';
          badge.innerHTML = `${ICONS.warning} Gagal memuat detail`;
        }
        mb.querySelectorAll('.detail-skeleton-row').forEach(el => el.remove());
        const p = document.createElement('p');
        p.className = 'detail-error-msg';
        p.textContent = err.message || 'Coba lagi nanti.';
        const actions = mb.querySelector('.detail-actions');
        if (actions) mb.insertBefore(p, actions);
      }
    }
  }

  /* §28b — Detail modal close (guard) */
  (function () {
    const el = document.getElementById('detailModal');
    if (!el) return;
    el.addEventListener('click', (e) => {
      if (e.target.id === 'detailModal') closeDetailModal();
    });
    el.addEventListener('touchstart', (e) => {
      if (e.target.id === 'detailModal') {
        e.preventDefault();
        closeDetailModal();
      }
    }, { passive: false });
  })();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const overlay = document.getElementById('detailModal');
      if (overlay && overlay.classList.contains('active')) closeDetailModal();
    }
  });

  /* §29 — REFRESH (guard) */
  (function () {
    const btn = document.getElementById('refreshBtn');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      btn.classList.add('spinning');
      Cache.invalidate('orders_');
      Cache.remove('counts');
      await Promise.allSettled([
        checkRefunds(true),
        loadOrders(true),
        loadCounts(),
      ]);
      setTimeout(() => btn.classList.remove('spinning'), 500);
    });
  })();

  /* §30 — AUTO SYNC */
  function startAutoSync() {
    if (state.refreshInterval) clearInterval(state.refreshInterval);
    state.refreshInterval = setInterval(async () => {
      if (document.hidden) return;
      const cards = document.querySelectorAll('.order-card.pending');
      const pending = Array.from(cards).map(c => ({
        order_id: c.dataset.orderId,
        otp_id: c.dataset.otpId,
      }));

      if (pending.length > 0) {
        await pollPendingOrders(pending);
      }

      if (state.refundChecked && Date.now() - _lastRefundCheck > _cfg.refundCheck) {
        await checkRefunds(true);
      }
    }, _cfg.autoSync);
  }

  function stopAutoSync() {
    if (state.refreshInterval) {
      clearInterval(state.refreshInterval);
      state.refreshInterval = null;
    }
  }

  /* §31 — LOGOUT (guard) */
  async function handleLogout() {
    try {
      await fetchWithTimeout(_cfg.ep.logout, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
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

  (function () {
    const btn = document.getElementById('logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
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
  })();

  /* §32 — INIT */
  (async function init() {
    randomizeCopy();
    await Promise.allSettled([
      loadUser(false),
      loadOrders(true),
      loadCounts(),
    ]);
    await checkRefunds(false);
    await loadOrders(true);
    startAutoSync();
  })();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoSync();
    } else {
      loadUser(false);
      loadOrders(true);
      if (state.refundChecked && Date.now() - _lastRefundCheck > _cfg.refundCheck) {
        checkRefunds(true);
      }
      startAutoSync();
    }
  });

  function _cleanup() {
    stopAutoSync();
    Object.values(state.countdownIntervals).forEach(clearInterval);
    if (_loadOrdersAbort) _loadOrdersAbort.abort();
  }
  window.addEventListener('pagehide', _cleanup);
  window.addEventListener('beforeunload', _cleanup);

})(window);
