(function (global) {
'use strict';

var D = document;
var q = function (s, c) { return (c || D).querySelector(s); };
var qa = function (s, c) { return Array.prototype.slice.call((c || D).querySelectorAll(s)); };

var _crypto = (function () {
  var _k = 'aW5ib3gtc2VjcmV0LWtleS0yMDI2LWFzeXJvZg==';
  var _s = 'c2FsdC1pbmJveC12MjAyNi1zZWN1cmU=';
  var _i = 100000;
  var _dk = null;
  var supported = (function () {
    try { return !!(global.crypto && global.crypto.subtle && global.crypto.getRandomValues); }
    catch (e) { return false; }
  })();

  async function _derive() {
    if (_dk) return _dk;
    var enc = new TextEncoder();
    var base = await crypto.subtle.importKey(
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
    var bin = atob(b64);
    var u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function _buf2b(buf) {
    var b = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  async function seal(obj) {
    if (!supported) return null;
    try {
      var key = await _derive();
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var c = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj))
      );
      var comb = new Uint8Array(iv.length + c.byteLength);
      comb.set(iv, 0);
      comb.set(new Uint8Array(c), iv.length);
      return _buf2b(comb.buffer);
    } catch (e) { return null; }
  }
  async function unseal(b64) {
    if (!b64 || !supported) return null;
    try {
      var key = await _derive();
      var buf = _b2buf(b64);
      var iv = buf.slice(0, 12);
      var data = buf.slice(12);
      var plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) }, key, data
      );
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (e) { return null; }
  }
  return { seal: seal, unseal: unseal };
})();

var SafeStorage = (function () {
  var ls = null, ss = null;
  try { ls = window.localStorage; ls.setItem('__t', '1'); ls.removeItem('__t'); } catch (e) { ls = null; }
  try { ss = window.sessionStorage; ss.setItem('__t', '1'); ss.removeItem('__t'); } catch (e) { ss = null; }
  var mem = new Map();
  function wrap(store) {
    return {
      get: function (k) {
        try { return store ? store.getItem(k) : (mem.has(k) ? mem.get(k) : null); }
        catch (e) { return mem.has(k) ? mem.get(k) : null; }
      },
      set: function (k, v) {
        try { if (store) store.setItem(k, v); else mem.set(k, v); }
        catch (e) { mem.set(k, v); }
      },
      remove: function (k) {
        try { if (store) store.removeItem(k); else mem.delete(k); }
        catch (e) { mem.delete(k); }
      }
    };
  }
  return { local: wrap(ls), session: wrap(ss) };
})();

var Cache = (function () {
  var P = 'aotp_i_';
  var mem = new Map();
  function get(key, ttl) {
    if (mem.has(key)) {
      var e = mem.get(key);
      if (!ttl || Date.now() - e.t < ttl) return e.v;
      mem.delete(key);
    }
    try {
      var raw = SafeStorage.local.get(P + key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.t) return null;
      if (ttl && Date.now() - parsed.t > ttl) {
        SafeStorage.local.remove(P + key);
        return null;
      }
      mem.set(key, parsed);
      return parsed.v;
    } catch (e) { return null; }
  }
  function set(key, v) {
    var e = { t: Date.now(), v: v };
    mem.set(key, e);
    try { SafeStorage.local.set(P + key, JSON.stringify(e)); } catch (err) {}
  }
  function remove(key) {
    mem.delete(key);
    try { SafeStorage.local.remove(P + key); } catch (e) {}
  }
  function invalidate(prefix) {
    mem.forEach(function (_, k) { if (k.indexOf(prefix) === 0) mem.delete(k); });
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(P + prefix) === 0) keys.push(k);
      }
      keys.forEach(function (k) { SafeStorage.local.remove(k); });
    } catch (e) {}
  }
  function clear() {
    mem.clear();
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(P) === 0) keys.push(k);
      }
      keys.forEach(function (k) { SafeStorage.local.remove(k); });
    } catch (e) {}
  }
  return { get: get, set: set, remove: remove, invalidate: invalidate, clear: clear };
})();

var _cfg = {
  rk: '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg',
  ep: {
    user: '/api/user',
    orders: '/api/nokos/orders',
    stats: '/api/nokos/orders/stats',
    orderDetail: '/api/nokos/order',
    cekotp: '/api/cekotp',
    checkRefunds: '/api/nokos/check-refunds',
    logout: '/api/auth/logout'
  },
  ttl: {
    user: 10 * 60 * 1000,
    orders: 45 * 1000,
    counts: 2 * 60 * 1000,
    detail: 3 * 60 * 1000
  },
  autoSync: 5000,
  refundCheck: 30000,
  pageLimit: 5,
  fetchTimeout: 10000
};

var _dev = (function () {
  function mq(s) { try { return window.matchMedia(s).matches; } catch (e) { return false; } }
  var hc = navigator.hardwareConcurrency || 4;
  var conn = navigator.connection || {};
  return {
    mobile: mq('(max-width: 768px)'),
    lowEnd: hc <= 4 || conn.saveData || /2g|slow-2g/.test(conn.effectiveType || ''),
    reduced: mq('(prefers-reduced-motion: reduce)')
  };
})();
if (_dev.reduced || _dev.lowEnd) {
  D.documentElement.setAttribute('data-perf', 'lite');
}

var token = SafeStorage.local.get('access_token');
if (!token) { location.href = '/login'; return; }

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
  var v = Number(n) || 0;
  return 'Rp' + v.toLocaleString('id-ID');
}
function getInitial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
  });
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
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

var _copy = {
  pageSubtitle: [
    'Riwayat pesanan & kode OTP kamu',
    'Semua OTP masuk sini',
    'Cek pesanan & status OTP kamu'
  ],
  heroTitle: ['Inbox', 'Pesan Kamu', 'Riwayat OTP', 'Semua Pesanan'],
  heroDesc: [
    'Semua nomor Nokos, kode OTP, dan status pesananmu tersusun rapi di satu tempat.',
    'Cek OTP masuk, status pesanan, dan riwayat transaksi.',
    'Semua pesanan nokos kamu, lengkap dengan kode OTP dan status terbaru.'
  ],
  sectionTag: [
    'Pesanan Nokos · Pembaruan otomatis',
    'Riwayat Nokos · Live update',
    'Data Pesanan · Auto sync'
  ],
  syncText: [
    'Menyinkronkan status pesanan...',
    'Update data terbaru...',
    'Cek status OTP...'
  ]
};

function randomizeCopy() {
  var ps = D.getElementById('pageSubtitle');
  if (ps) ps.textContent = pick(_copy.pageSubtitle);
  var ht = D.getElementById('heroTitle');
  if (ht) ht.textContent = pick(_copy.heroTitle);
  var hd = D.getElementById('heroDesc');
  if (hd) hd.textContent = pick(_copy.heroDesc);
  var st = D.getElementById('sectionTagText');
  if (st) st.textContent = pick(_copy.sectionTag);
  var stx = D.getElementById('syncText');
  if (stx) stx.textContent = pick(_copy.syncText);
}

var ICONS = {
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
  inbox: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>'
};

var state = {
  page: 1,
  limit: _cfg.pageLimit,
  totalPages: 1,
  refreshInterval: null,
  countdownIntervals: {},
  counts: { nokos: 0 },
  refundChecked: false
};

var _loadOrdersAbort = null;
var _loadOrdersInFlight = false;
var _pollInFlight = false;
var _lastRefundCheck = 0;

var ALLOWED_FIELDS = new Set([
  'otp_id','order_id','status','phone_number','otp_code','otp_code_2','full_sms',
  'price_idr','price','service','service_name',
  'country','country_name','country_flag','operator','server',
  'expires_in','expired_at','created_at','updated_at','confirmed_at',
  'received_at','refunded_at','refunded_amount'
]);

function sanitizeOrder(o) {
  if (!o || typeof o !== 'object') return o;
  var clean = {};
  Object.keys(o).forEach(function (k) {
    if (ALLOWED_FIELDS.has(k)) clean[k] = o[k];
  });
  return clean;
}

function getServiceDisplayName(o) {
  return String((o && (o.service_name || o.service)) || 'Layanan OTP').trim();
}
function getServiceInitial(o) {
  var name = getServiceDisplayName(o);
  var first = String(name).trim().charAt(0).toUpperCase();
  return /[A-Z0-9]/.test(first) ? first : '#';
}
function renderServiceIcon(o) {
  return '<span class="icon-fallback">' + escapeHtml(getServiceInitial(o)) + '</span>';
}

var COUNTRY_NAMES = {
  id:'Indonesia',ru:'Rusia',us:'Amerika Serikat',my:'Malaysia',vn:'Vietnam',
  ph:'Filipina',th:'Thailand',sg:'Singapura',in:'India',cn:'Tiongkok',
  jp:'Jepang',kr:'Korea Selatan',uk:'Britania Raya',gb:'Britania Raya',
  de:'Jerman',fr:'Prancis',br:'Brasil',ng:'Nigeria',pk:'Pakistan',
  bd:'Bangladesh',tr:'Turki',es:'Spanyol',it:'Italia',nl:'Belanda',
  au:'Australia',ca:'Kanada',mx:'Meksiko',ar:'Argentina',za:'Afrika Selatan',
  sa:'Arab Saudi',ae:'Uni Emirat Arab',pl:'Polandia',ua:'Ukraina',
  ro:'Rumania',kh:'Kamboja',la:'Laos',mm:'Myanmar',tw:'Taiwan',
  hk:'Hong Kong',nz:'Selandia Baru',ch:'Swiss',se:'Swedia',no:'Norwegia',
  fi:'Finlandia',be:'Belgia',pt:'Portugal',eg:'Mesir',ke:'Kenya',gh:'Ghana'
};
function getCountryName(o) {
  var code = String((o && (o.country || o.country_name)) || '').trim().toLowerCase();
  var supplied = String((o && o.country_name) || '').trim();
  if (supplied && supplied.toLowerCase() !== code) return supplied;
  if (COUNTRY_NAMES[code]) return COUNTRY_NAMES[code];
  if (/^[a-z]{2}$/i.test(code)) {
    try {
      var loc = new Intl.DisplayNames(['id'], { type: 'region' }).of(code.toUpperCase());
      return (loc && loc.toLowerCase() !== code) ? loc : 'Negara tidak diketahui';
    } catch (e) { return 'Negara tidak diketahui'; }
  }
  return supplied || 'Negara tidak diketahui';
}
function getOtpId(o) {
  var id = String((o && o.otp_id) || '').trim();
  if (id) return id;
  var seed = [(o && o.order_id), (o && o.created_at), (o && o.service), (o && o.phone_number)].join('|');
  var hash = 2166136261;
  for (var i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return 'OTP' + (hash >>> 0).toString(36).toUpperCase().slice(-8).padStart(8, '0');
}

function countryCodeToTwemoji(code) {
  var c = (code || '').toUpperCase();
  if (c.length !== 2) return null;
  return c.split('').map(function (ch) { return (0x1F1E6 + ch.charCodeAt(0) - 65).toString(16); }).join('-');
}
function getFlagSources(code) {
  var c = (code || '').toLowerCase();
  if (!/^[a-z]{2}$/.test(c)) return [];
  var tw = countryCodeToTwemoji(code);
  return [
    tw ? 'https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/' + tw + '.svg' : null,
    'https://flagcdn.com/w40/' + c + '.png'
  ].filter(Boolean);
}
function renderFlag(code, cls) {
  cls = cls || 'flag-img';
  var sources = getFlagSources(code);
  if (sources.length === 0) {
    return '<div class="' + cls + '" style="display:flex;align-items:center;justify-content:center;background:var(--surface-2);color:var(--txt3);font-size:0.55rem;font-weight:700">' + escapeHtml((code || '??').toUpperCase()) + '</div>';
  }
  var attr = JSON.stringify(sources).replace(/"/g, '&quot;');
  return '<img class="' + cls + '" src="' + sources[0] + '" alt="' + escapeHtml(code) + '" loading="lazy" data-sources="' + attr + '" data-idx="0">';
}
window._handleFlagErr = function (img) {
  try {
    var sources = JSON.parse(img.dataset.sources || '[]');
    var idx = parseInt(img.dataset.idx || '0', 10);
    var next = idx + 1;
    if (next < sources.length) {
      img.dataset.idx = next.toString();
      img.src = sources[next];
    } else {
      var code = (img.alt || '??').toUpperCase();
      var ph = D.createElement('div');
      ph.className = img.className;
      ph.style.cssText = 'display:flex;align-items:center;justify-content:center;background:var(--surface-2);color:var(--txt3);font-size:0.55rem;font-weight:700;';
      ph.textContent = code;
      img.replaceWith(ph);
    }
  } catch (e) { img.style.display = 'none'; }
};

function copyToClipboard(text, btnEl) {
  function onOk() {
    if (!btnEl) return;
    btnEl.classList.add('copied');
    var orig = btnEl.innerHTML;
    btnEl.innerHTML = ICONS.check;
    setTimeout(function () {
      btnEl.classList.remove('copied');
      btnEl.innerHTML = orig;
    }, 1200);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onOk).catch(function () { fallbackCopy(text, onOk); });
  } else fallbackCopy(text, onOk);
}
function fallbackCopy(text, onOk) {
  try {
    var ta = D.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    D.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = D.execCommand('copy');
    if (ok && typeof onOk === 'function') onOk();
    D.body.removeChild(ta);
  } catch (e) {
    try {
      var t = D.querySelector('textarea[readonly]');
      if (t) t.remove();
    } catch (_) {}
  }
}

function showAlert(opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var overlay = D.getElementById('customAlert');
    if (!overlay) { resolve(window.confirm(opts.message || opts.title || 'OK')); return; }
    var iconEl = D.getElementById('customAlertIcon');
    var titleEl = D.getElementById('customAlertTitle');
    var msgEl = D.getElementById('customAlertMessage');
    var actionsEl = D.getElementById('customAlertActions');
    if (!iconEl || !titleEl || !msgEl || !actionsEl) { resolve(false); return; }

    var type = opts.type || 'info';
    iconEl.className = 'custom-alert-icon ' + type;
    iconEl.innerHTML = ICONS[type] || ICONS.info;
    titleEl.textContent = opts.title || 'Informasi';
    msgEl.textContent = opts.message || '';

    actionsEl.innerHTML = '';
    if (opts.showCancel) {
      var b = D.createElement('button');
      b.className = 'btn';
      b.type = 'button';
      b.textContent = opts.cancelText || 'Batal';
      b.addEventListener('click', function () {
        overlay.classList.remove('active');
        resolve(false);
      });
      actionsEl.appendChild(b);
    }
    var ok = D.createElement('button');
    ok.className = 'btn-primary';
    ok.type = 'button';
    ok.textContent = opts.okText || 'OK';
    ok.addEventListener('click', function () {
      overlay.classList.remove('active');
      resolve(true);
    });
    actionsEl.appendChild(ok);
    overlay.classList.add('active');
  });
}

(function themeInit() {
  var btn = D.getElementById('themeBtn');
  if (!btn) return;
  var root = D.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function resolve(pref) {
    if (pref === 'system') return (mq && mq.matches) ? 'dark' : 'light';
    return pref;
  }
  function paintMeta(theme) {
    var m = D.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', theme === 'dark' ? '#0a0b0d' : '#0a84ff');
  }
  function setPref(pref, save) {
    root.setAttribute('data-theme-pref', pref);
    var resolved = resolve(pref);
    root.setAttribute('data-theme', resolved);
    paintMeta(resolved);
    if (save) SafeStorage.local.set('asyrofotp_theme_pref', pref);
  }

  btn.addEventListener('click', function () {
    var cur = root.getAttribute('data-theme-pref') || 'system';
    var next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
    setPref(next, true);
  });

  if (mq) {
    var onOsChange = function () {
      if (root.getAttribute('data-theme-pref') === 'system') setPref('system', false);
    };
    if (mq.addEventListener) mq.addEventListener('change', onOsChange);
    else if (mq.addListener) mq.addListener(onOsChange);
  }
})();

(function sidebarInit() {
  var sidebar = D.getElementById('sidebar');
  var collapseBtn = D.getElementById('collapseBtn');
  if (!sidebar || !collapseBtn) return;
  if (SafeStorage.local.get('sidebar_collapsed') === 'true' && window.innerWidth > 768) {
    sidebar.classList.add('collapsed');
    D.body.classList.add('sidebar-collapsed');
  }
  collapseBtn.addEventListener('click', function () {
    if (window.innerWidth <= 768) return;
    var c = sidebar.classList.toggle('collapsed');
    D.body.classList.toggle('sidebar-collapsed', c);
    SafeStorage.local.set('sidebar_collapsed', c ? 'true' : 'false');
  });
})();

(function mobileSidebarInit() {
  var toggle = D.getElementById('mobileToggle');
  var sidebar = D.getElementById('sidebar');
  var overlay = D.getElementById('sidebarOverlay');
  if (!toggle || !sidebar || !overlay) return;

  var open = false;
  var lastToggle = 0;

  function openSb() {
    if (open) return;
    open = true;
    sidebar.classList.add('open');
    overlay.classList.add('active');
    D.body.classList.add('sidebar-open');
    D.body.style.overflow = 'hidden';
  }
  function closeSb() {
    if (!open) return;
    open = false;
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    D.body.classList.remove('sidebar-open');
    D.body.style.overflow = '';
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

  qa('.nav-item', sidebar).forEach(function (l) {
    l.addEventListener('click', function () {
      if (window.innerWidth <= 768) setTimeout(closeSb, 100);
    });
  });
  D.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) closeSb();
  });

  var rt = null;
  window.addEventListener('resize', function () {
    if (rt) clearTimeout(rt);
    rt = setTimeout(function () {
      if (window.innerWidth > 768 && open) closeSb();
    }, 150);
  });
})();

function waitForRecaptcha() {
  return new Promise(function (resolve) {
    if (window.grecaptcha && window.grecaptcha.execute) return resolve();
    var n = 0;
    var t = setInterval(function () {
      n++;
      if (window.grecaptcha && window.grecaptcha.execute) { clearInterval(t); resolve(); }
      else if (n >= 40) { clearInterval(t); resolve(); }
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
      setTimeout(function () { resolve(null); }, 6000);
    });
  } catch (e) { return null; }
}
async function securePost(url, body, action) {
  body = body || {};
  action = action || 'inbox';
  var rc = await getRecaptchaToken(action);
  return fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    body: JSON.stringify(Object.assign({}, body, { recaptcha_token: rc }))
  });
}

async function loadUser(force) {
  if (!force) {
    var cached = Cache.get('user', _cfg.ttl.user);
    if (cached) renderUser(cached);
  }
  try {
    var res = await fetchWithTimeout(_cfg.ep.user, {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (res.status === 401 || res.status === 403) { handleLogout(); return; }
    var user = await safeJson(res);
    if (user && !user.error) {
      Cache.set('user', user);
      renderUser(user);
    }
  } catch (e) {}
}
function renderUser(user) {
  if (!user) return;
  var name = user.name || user.username || '—';
  var nameEl = D.getElementById('userName');
  var balEl = D.getElementById('userBalance');
  var iniEl = D.getElementById('userInitial');
  var pillEl = D.getElementById('balancePill');
  if (nameEl) nameEl.textContent = name;
  if (balEl) balEl.textContent = formatRupiah(user.balance);
  if (iniEl) iniEl.textContent = getInitial(name);
  if (pillEl) pillEl.textContent = formatRupiah(user.balance);
}

async function checkRefunds(silent) {
  var indicator = D.getElementById('syncIndicator');
  if (!state.refundChecked && !silent && indicator) indicator.style.display = 'inline-flex';

  try {
    var res = await securePost(_cfg.ep.checkRefunds, {}, 'check_refunds');
    var data = await safeJson(res);
    _lastRefundCheck = Date.now();
    if (data.refunded && data.refunded.length > 0) {
      Cache.remove('user');
      loadUser(true);
      Cache.invalidate('orders_');
      Cache.remove('counts');
      var total = data.refunded.reduce(function (s, r) { return s + (r.refunded_amount || 0); }, 0);
      if (total > 0) {
        await showAlert({
          title: 'Refund Otomatis',
          message: data.refunded.length + ' pesanan di-refund. Total ' + formatRupiah(total) + ' udah masuk ke saldo kamu.',
          type: 'success'
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

async function loadOrders(silent) {
  var container = D.getElementById('ordersContainer');
  if (!container) return;
  var cacheKey = 'orders_p' + state.page;
  var cached = Cache.get(cacheKey, _cfg.ttl.orders);

  if (cached && cached.orders) {
    renderOrders(cached, true);
  } else if (!silent && container.querySelector('.skeleton-order')) {
  } else if (!silent) {
    container.innerHTML =
      '<div class="skeleton-order"><div class="skel skel-line" style="width:60%"></div><div class="skel skel-line" style="width:40%"></div></div>' +
      '<div class="skeleton-order"><div class="skel skel-line" style="width:55%"></div><div class="skel skel-line" style="width:45%"></div></div>' +
      '<div class="skeleton-order"><div class="skel skel-line" style="width:65%"></div><div class="skel skel-line" style="width:35%"></div></div>';
  }

  if (_loadOrdersInFlight) return;
  _loadOrdersInFlight = true;
  if (_loadOrdersAbort) _loadOrdersAbort.abort();
  _loadOrdersAbort = new AbortController();

  try {
    var url = _cfg.ep.orders + '?page=' + state.page + '&limit=' + state.limit + '&status=nokos';
    var res = await fetchWithTimeout(url, {
      headers: { Authorization: 'Bearer ' + token },
      signal: _loadOrdersAbort.signal
    });
    if (res.status === 401 || res.status === 403) { handleLogout(); return; }
    var data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Gagal memuat inbox');

    if (data.orders) {
      data.orders = data.orders.map(sanitizeOrder);
    }
    Cache.set(cacheKey, data);
    renderOrders(data, false);
    loadCounts();
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (!cached && !silent) {
      container.innerHTML =
        '<div class="empty-inbox">' +
          '<div class="icon-box">' + ICONS.warning + '</div>' +
          '<h3>Gagal memuat pesanan</h3>' +
          '<p>' + escapeHtml(err.message || 'Coba refresh halaman') + '</p>' +
        '</div>';
    }
  } finally {
    _loadOrdersAbort = null;
    _loadOrdersInFlight = false;
  }
}

async function loadCounts() {
  var cached = Cache.get('counts', _cfg.ttl.counts);
  if (cached) applyCounts(cached);
  try {
    var res = await fetchWithTimeout(_cfg.ep.stats, {
      headers: { Authorization: 'Bearer ' + token }
    });
    var data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Gagal memuat stats');
    Cache.set('counts', data);
    applyCounts(data);
  } catch (err) {}
}
function applyCounts(data) {
  if (!data) return;
  state.counts = { nokos: Number(data.nokos != null ? data.nokos : (data.all || 0)) };
}

function getDeadline(key, expiresIn) {
  var k = 'aotp_cd_' + key;
  var now = Date.now();
  try {
    var s = SafeStorage.session.get(k);
    if (s) {
      var d = parseInt(s, 10);
      if (Number.isFinite(d) && d > now) return d;
      SafeStorage.session.remove(k);
    }
  } catch (e) {}
  if (expiresIn > 0) {
    var dd = now + expiresIn * 1000;
    try { SafeStorage.session.set(k, String(dd)); } catch (e) {}
    return dd;
  }
  return 0;
}
function clearDeadline(key) {
  try { SafeStorage.session.remove('aotp_cd_' + key); } catch (e) {}
}

function buildCard(o) {
  var statusMap = {
    success:   { cls: 'success',   label: 'Berhasil',   badge: 'success' },
    received:  { cls: 'success',   label: 'Berhasil',   badge: 'success' },
    confirmed: { cls: 'success',   label: 'Sukses',     badge: 'success' },
    pending:   { cls: 'pending',   label: 'Pending',    badge: 'warning' },
    failed:    { cls: 'failed',    label: 'Gagal',      badge: 'danger' },
    cancelled: { cls: 'cancelled', label: 'Dibatalkan', badge: 'danger' },
    expired:   { cls: 'expired',   label: 'Kedaluwarsa',badge: 'gray' },
    refunded:  { cls: 'refunded',  label: 'Refund',     badge: 'purple' },
    error:     { cls: 'failed',    label: 'Error',      badge: 'danger' }
  };
  var s = statusMap[o.status] || { cls: 'pending', label: escapeHtml(o.status || '—'), badge: 'warning' };
  var hasOtp = o.otp_code && o.otp_code.trim();
  var isPending = o.status === 'pending';
  var isRefunded = o.status === 'refunded' || (o.refunded_at && Number(o.refunded_at) > 0);
  var isConfirmed = ['confirmed', 'success', 'received'].indexOf(o.status) !== -1;
  var otpId = getOtpId(o);
  var apiOrderId = String(o.order_id || '').trim();
  var hasApiId = Boolean(apiOrderId);
  var svcName = getServiceDisplayName(o);
  var cName = getCountryName(o);
  var expiresIn = Number(o.expires_in || 0);
  var hasValidCd = isPending && !isConfirmed && expiresIn > 0;
  var priceIdr = Number(o.price_idr != null ? o.price_idr : (o.price != null ? o.price : 0));
  var created = formatTanggal(o.created_at);

  var infoGrid =
    '<div class="order-body">' +
      '<div class="order-field">' +
        '<span class="order-field-label">Nomor</span>' +
        '<span class="order-field-value">' +
          escapeHtml(o.phone_number || '—') +
          (o.phone_number ? ' <button class="copy-inline" type="button" data-copy="' + escapeHtml(o.phone_number) + '" title="Copy nomor">' + ICONS.copy + '</button>' : '') +
        '</span>' +
      '</div>' +
      '<div class="order-field">' +
        '<span class="order-field-label">Negara</span>' +
        '<span class="order-field-value">' +
          '<span class="country-inline">' + renderFlag(o.country, 'flag-img') + escapeHtml(cName) + '</span>' +
        '</span>' +
      '</div>' +
      '<div class="order-field">' +
        '<span class="order-field-label">Harga</span>' +
        '<span class="order-field-value price">' + formatRupiah(priceIdr) + '</span>' +
      '</div>' +
      '<div class="order-field">' +
        '<span class="order-field-label">Dibuat</span>' +
        '<span class="order-field-value" style="font-size:0.75rem">' + created + '</span>' +
      '</div>' +
    '</div>';

  var otpBox = hasOtp ?
    '<div class="otp-box">' +
      '<div class="otp-icon">' + ICONS.key + '</div>' +
      '<div class="otp-info">' +
        '<div class="otp-info-label">Kode OTP</div>' +
        '<div class="otp-info-value">' + escapeHtml(o.otp_code) + '</div>' +
      '</div>' +
      '<button class="otp-copy" type="button" data-copy="' + escapeHtml(o.otp_code) + '" title="Copy OTP">' + ICONS.copy + '</button>' +
    '</div>' : '';

  var bodyBlock = (hasOtp && isConfirmed)
    ? '<div class="order-success-layout">' + otpBox + infoGrid + '</div>'
    : infoGrid + otpBox;

  var cdHtml = '';
  if (hasValidCd && !hasOtp && hasApiId) {
    var deadline = getDeadline(apiOrderId, expiresIn);
    var rem = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    var m = Math.floor(rem / 60);
    var sc = rem % 60;
    var t = (m < 10 ? '0' + m : m) + ':' + (sc < 10 ? '0' + sc : sc);
    cdHtml = '<div class="order-countdown" data-order-id="' + escapeHtml(apiOrderId) + '" data-deadline="' + deadline + '">' + ICONS.clock + '<span class="countdown-text">' + t + '</span> tersisa</div>';
  }

  return '' +
    '<div class="order-card ' + s.cls + '" ' +
         'data-order-id="' + escapeHtml(apiOrderId) + '" ' +
         'data-otp-id="' + escapeHtml(otpId) + '" ' +
         'data-price="' + priceIdr + '" ' +
         'data-service="' + escapeHtml(svcName) + '" ' +
         'data-country="' + escapeHtml(cName) + '" ' +
         'data-country-code="' + escapeHtml(o.country || '') + '" ' +
         'data-status="' + escapeHtml(o.status || '') + '" ' +
         'data-phone="' + escapeHtml(o.phone_number || '') + '" ' +
         'data-sig="">' +
      '<div class="order-header">' +
        '<div class="order-app-icon" title="' + escapeHtml(svcName) + '">' + renderServiceIcon(o) + '</div>' +
        '<div class="order-title-wrap">' +
          '<div class="order-title">' +
            escapeHtml(svcName) +
            (o.operator ? ' <span class="badge info" style="font-size:0.6rem">' + escapeHtml(o.operator) + '</span>' : '') +
          '</div>' +
          '<div class="order-ref"><span class="otp-id">' + escapeHtml(otpId) + '</span></div>' +
        '</div>' +
        '<div class="order-status-badge"><span class="badge ' + s.badge + '">' + s.label + '</span></div>' +
      '</div>' +
      bodyBlock +
      cdHtml +
      (hasOtp && o.full_sms ?
        '<div class="sms-box">' +
          '<span class="sms-label">SMS:</span>' +
          '<span class="sms-text">' + escapeHtml(o.full_sms) + '</span>' +
          '<button class="copy-inline" type="button" data-copy="' + escapeHtml(o.full_sms) + '" title="Copy SMS">' + ICONS.copy + '</button>' +
        '</div>' : '') +
      (isRefunded ?
        '<div class="refund-box">' +
          '<div class="refund-icon">' + ICONS.coin + '</div>' +
          '<div class="refund-info">' +
            '<div class="refund-info-label">Refund Diterima</div>' +
            '<div class="refund-info-value">' + formatRupiah(o.refunded_amount || priceIdr) + '</div>' +
            '<div class="refund-note">Saldo udah otomatis masuk ke akun kamu</div>' +
          '</div>' +
        '</div>' : '') +
      (isPending && !hasOtp && !isRefunded ?
        '<div class="pending-box">' +
          '<span class="spinner-sm"></span>' +
          '<span>Menunggu kode OTP masuk... auto-refresh tiap 5 detik.</span>' +
        '</div>' : '') +
      (isPending && hasOtp ?
        '<div class="pending-box" style="border-style:solid;border-color:var(--ok);background:color-mix(in srgb,var(--ok) 10%,transparent);color:var(--ok)">' +
          '<span style="display:inline-flex;align-items:center;gap:6px;font-weight:600">' + ICONS.check + ' OTP sudah diterima. Konfirmasi atau tunggu waktu habis.</span>' +
        '</div>' : '') +
      '<div class="order-actions">' +
        (isPending ?
          (hasOtp && hasValidCd && hasApiId ?
            '<button class="btn-mini" type="button" data-resend="' + escapeHtml(apiOrderId) + '">' + ICONS.refresh + ' Resend SMS</button>' : '') +
          (hasOtp && hasValidCd && hasApiId ?
            '<button class="btn-mini primary" type="button" data-confirm="' + escapeHtml(apiOrderId) + '">' + ICONS.checkCircle + ' Konfirmasi</button>' : '') +
          (!hasOtp && hasApiId ?
            '<button class="btn-mini danger" type="button" data-cancel="' + escapeHtml(apiOrderId) + '">' + ICONS.ban + ' Batalkan</button>' : '')
          :
          '<button class="btn-mini primary" type="button" data-detail="' + escapeHtml(apiOrderId) + '"' + (hasApiId ? '' : ' disabled') + '>' +
            ICONS.info + (hasApiId ? ' Lihat Detail' : ' Detail tidak tersedia') +
          '</button>'
        ) +
      '</div>' +
    '</div>';
}

function attachCardHandlers(card) {
  qa('[data-copy]', card).forEach(function (btn) {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      copyToClipboard(btn.dataset.copy, btn);
    });
  });
  qa('[data-resend]', card).forEach(function (btn) {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () { resendOrder(btn.dataset.resend, btn); });
  });
  qa('[data-confirm]', card).forEach(function (btn) {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () { confirmOrder(btn.dataset.confirm, btn); });
  });
  qa('[data-cancel]', card).forEach(function (btn) {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () { cancelOrder(btn.dataset.cancel, btn); });
  });
  qa('[data-detail]', card).forEach(function (btn) {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () {
      var c = btn.closest('.order-card');
      showOrderDetail(btn.dataset.detail, c);
    });
  });
  qa('img[data-sources]', card).forEach(function (img) {
    if (img.dataset.bound) return;
    img.dataset.bound = '1';
    img.addEventListener('error', function () { window._handleFlagErr(this); });
  });
}

function renderOrders(data, fromCache) {
  var container = D.getElementById('ordersContainer');
  if (!container) return;
  var paginationEl = D.getElementById('pagination');

  if (!data.orders || data.orders.length === 0) {
    container.innerHTML =
      '<div class="empty-inbox">' +
        '<div class="icon-box">' + ICONS.inbox + '</div>' +
        '<h3>Belum ada pesanan Nokos</h3>' +
        '<p>Pesanan nomor virtual dan kode OTP kamu akan muncul di sini.</p>' +
        '<a href="/nokos" class="btn-primary" style="display:inline-flex;align-items:center;gap:8px;padding:12px 20px;border-radius:12px;font-weight:600;margin-top:16px">' +
          '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>' +
          'Beli Nokos' +
        '</a>' +
      '</div>';
    if (paginationEl) paginationEl.style.display = 'none';
    return;
  }

  var listWrap = q('.orders-list', container);
  if (!listWrap) {
    container.innerHTML = '<div class="orders-list"></div>';
    listWrap = q('.orders-list', container);
  }

  var existingCards = new Map();
  qa(':scope > .order-card', listWrap).forEach(function (card) {
    var id = card.dataset.orderId || card.dataset.otpId;
    if (id) existingCards.set(id, card);
  });

  var frag = D.createDocumentFragment();
  data.orders.forEach(function (o, idx) {
    var apiOrderId = String(o.order_id || '').trim();
    var cardKey = apiOrderId || o.otp_id || ('fb-' + idx);

    var tmp = D.createElement('div');
    tmp.innerHTML = buildCard(o).trim();
    var newCard = tmp.firstElementChild;

    var newSig = [
      o.status || '',
      (o.otp_code || '').trim(),
      (o.phone_number || '').trim(),
      (o.service || '').trim(),
      (o.refunded_at || ''),
      Number(o.refunded_amount || 0)
    ].join('|');

    var existing = existingCards.get(cardKey);
    var oldSig = existing ? existing.dataset.sig || '' : null;

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

  existingCards.forEach(function (card, id) {
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
      paginationEl.innerHTML =
        '<button class="page-btn" type="button" data-page="' + (state.page - 1) + '"' + (state.page <= 1 ? ' disabled' : '') + '>Prev</button>' +
        '<span class="page-info">Halaman ' + state.page + ' dari ' + state.totalPages + '</span>' +
        '<button class="page-btn" type="button" data-page="' + (state.page + 1) + '"' + (state.page >= state.totalPages ? ' disabled' : '') + '>Next</button>';
      qa('.page-btn', paginationEl).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var p = Number(btn.dataset.page);
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
  Object.keys(state.countdownIntervals).forEach(function (k) {
    clearInterval(state.countdownIntervals[k]);
  });
  state.countdownIntervals = {};

  qa('.order-countdown').forEach(function (el) {
    var orderId = el.dataset.orderId;
    var deadline = parseInt(el.dataset.deadline || '0', 10);
    var textEl = q('.countdown-text', el);

    if (!deadline) {
      if (textEl) textEl.textContent = 'EXPIRED';
      el.classList.add('expired');
      return;
    }
    function tick() {
      var rem = Math.floor((deadline - Date.now()) / 1000);
      if (rem <= 0) {
        el.classList.add('expired');
        if (textEl) textEl.textContent = 'EXPIRED';
        if (state.countdownIntervals[orderId]) clearInterval(state.countdownIntervals[orderId]);
        clearDeadline(orderId);
        setTimeout(function () {
          Cache.invalidate('orders_');
          loadOrders(true);
        }, 500);
        return;
      }
      var m = Math.floor(rem / 60);
      var s = rem % 60;
      if (textEl) textEl.textContent = (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
    }
    tick();
    state.countdownIntervals[orderId] = setInterval(tick, 1000);
  });
}

async function pollPendingOrders(orders) {
  if (orders.length === 0 || _pollInFlight) return;
  _pollInFlight = true;
  try {
    var results = await Promise.allSettled(
      orders.map(function (o) {
        return fetchWithTimeout(_cfg.ep.cekotp, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token
          },
          body: JSON.stringify({ order_id: o.order_id, otp_id: o.otp_id })
        }).then(function (r) { return safeJson(r); });
      })
    );
    var hasUpdate = false;
    results.forEach(function (r) {
      if (r.status !== 'fulfilled') return;
      var data = r.value;
      if (!data) return;
      if (data.updated || data.otp_code || data.status !== 'pending') {
        hasUpdate = true;
        if (data.otp_code) {
          Cache.remove('user');
          loadUser(true);
        }
      }
    });
    if (hasUpdate) {
      Cache.invalidate('orders_');
      loadOrders(true);
      loadCounts();
    }
  } finally {
    _pollInFlight = false;
  }
}

async function resendOrder(orderId, btn) {
  var ok = await showAlert({
    title: 'Resend SMS',
    message: 'Yakin mau kirim ulang SMS? Pastikan waktu masih berjalan.',
    type: 'warning',
    okText: 'Ya, Resend',
    showCancel: true
  });
  if (!ok) return;
  var orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span>';
  try {
    var res = await securePost(_cfg.ep.orderDetail + '/' + encodeURIComponent(orderId) + '/resend', {}, 'resend');
    var data = await safeJson(res);
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
  var ok = await showAlert({
    title: 'Konfirmasi Sukses',
    message: 'Yakin order ini sudah sukses? Setelah dikonfirmasi, order akan dianggap selesai dan tidak bisa dibatalkan.',
    type: 'success',
    okText: 'Ya, Konfirmasi',
    showCancel: true
  });
  if (!ok) return;
  var orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span>';
  try {
    var res = await securePost(_cfg.ep.orderDetail + '/' + encodeURIComponent(orderId) + '/confirm', {}, 'confirm');
    var data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Gagal konfirmasi');
    await showAlert({ title: 'Order Sukses', message: 'Order berhasil dikonfirmasi sukses.', type: 'success' });
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
  var ok = await showAlert({
    title: 'Batalkan Pesanan',
    message: 'Yakin mau batalkan pesanan ini? Saldo akan dikembalikan sesuai kebijakan.',
    type: 'warning',
    okText: 'Ya, Batalkan',
    showCancel: true
  });
  if (!ok) return;
  var orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span>';
  try {
    var res = await securePost(_cfg.ep.orderDetail + '/' + encodeURIComponent(orderId) + '/cancel', {}, 'cancel');
    var data = await safeJson(res);
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

function openDetailModal() {
  var el = D.getElementById('detailModal');
  if (el) el.classList.add('active');
  D.body.style.overflow = 'hidden';
}
function closeDetailModal() {
  var el = D.getElementById('detailModal');
  if (el) el.classList.remove('active');
  D.body.style.overflow = '';
}

function bindDetailImages(root) {
  if (!root) return;
  qa('img[data-sources]', root).forEach(function (img) {
    if (img.dataset.bound) return;
    img.dataset.bound = '1';
    img.addEventListener('error', function () { window._handleFlagErr(this); });
  });
}

function renderDetailSkeleton(card) {
  var mc = D.getElementById('detailModalContent');
  if (!mc) return;
  var otpId = (card && card.dataset.otpId) || '';
  var priceIdr = Number((card && card.dataset.price) || 0);
  var svcName = (card && card.dataset.service) || '';
  var cName = (card && card.dataset.country) || '';
  var cCode = (card && card.dataset.countryCode) || '';
  var phone = (card && card.dataset.phone) || '';
  mc.innerHTML =
    '<div class="detail-modal-header">' +
      '<div class="detail-modal-app" title="' + escapeHtml(svcName) + '">' + renderServiceIcon({ service_name: svcName }) + '</div>' +
      '<div class="detail-modal-title-wrap">' +
        '<div class="detail-modal-title">' + escapeHtml(svcName || 'Layanan OTP') + '</div>' +
        '<div class="detail-modal-subtitle">OTP ID · ' + escapeHtml(otpId) + '</div>' +
      '</div>' +
      '<button class="detail-modal-close" type="button" id="detailModalClose">' + ICONS.close + '</button>' +
    '</div>' +
    '<div class="detail-modal-body">' +
      '<div class="detail-status-badge gray">' + ICONS.info + ' Memuat...</div>' +
      '<div class="detail-grid">' +
        '<div class="detail-item full">' +
          '<span class="detail-item-label">OTP ID</span>' +
          '<span class="detail-item-value primary">' + escapeHtml(otpId) + '</span>' +
        '</div>' +
        '<div class="detail-item">' +
          '<span class="detail-item-label">Harga</span>' +
          '<span class="detail-item-value primary">' + formatRupiah(priceIdr) + '</span>' +
        '</div>' +
        (phone ? '<div class="detail-item"><span class="detail-item-label">Nomor</span><span class="detail-item-value">' + escapeHtml(phone) + '</span></div>' : '') +
        '<div class="detail-item full">' +
          '<span class="detail-item-label">Negara</span>' +
          '<span class="detail-item-value"><span class="country-inline">' + renderFlag(cCode, 'flag-img') + ' ' + escapeHtml(cName) + '</span></span>' +
        '</div>' +
      '</div>' +
      '<div class="detail-skeleton-row" style="width:100%"></div>' +
      '<div class="detail-skeleton-row" style="width:80%"></div>' +
      '<div class="detail-actions">' +
        '<button class="btn-primary" type="button" id="detailModalCloseBtn">Tutup</button>' +
      '</div>' +
    '</div>';
  var c1 = D.getElementById('detailModalClose');
  if (c1) c1.addEventListener('click', closeDetailModal);
  var c2 = D.getElementById('detailModalCloseBtn');
  if (c2) c2.addEventListener('click', closeDetailModal);
  bindDetailImages(mc);
}

function renderDetailFull(o) {
  var statusMap = {
    success:   { label: 'Berhasil',   cls: 'success' },
    received:  { label: 'Berhasil',   cls: 'success' },
    confirmed: { label: 'Sukses',     cls: 'success' },
    pending:   { label: 'Pending',    cls: 'pending' },
    failed:    { label: 'Gagal',      cls: 'danger' },
    cancelled: { label: 'Dibatalkan', cls: 'danger' },
    expired:   { label: 'Kedaluwarsa',cls: 'gray' },
    refunded:  { label: 'Refund',     cls: 'purple' },
    error:     { label: 'Error',      cls: 'danger' }
  };
  var s = statusMap[o.status] || { label: escapeHtml(o.status || '—'), cls: 'gray' };
  var statusIcon = ({
    success: ICONS.checkCircle,
    pending: ICONS.clock,
    danger: ICONS.close,
    gray: ICONS.clock,
    purple: ICONS.coin
  })[s.cls] || ICONS.info;

  var isRefunded = o.refunded_at && Number(o.refunded_at) > 0;
  var hasOtp = o.otp_code && o.otp_code.trim();
  var hasPhone = o.phone_number && o.phone_number.trim();
  var hasSms = o.full_sms && o.full_sms.trim();
  var svcName = getServiceDisplayName(o);
  var cName = getCountryName(o);
  var otpId = getOtpId(o);
  var priceIdr = Number(o.price_idr != null ? o.price_idr : (o.price != null ? o.price : 0));

  var mc = D.getElementById('detailModalContent');
  if (!mc) return;
  mc.innerHTML =
    '<div class="detail-modal-header">' +
      '<div class="detail-modal-app" title="' + escapeHtml(svcName) + '">' + renderServiceIcon(o) + '</div>' +
      '<div class="detail-modal-title-wrap">' +
        '<div class="detail-modal-title">' + escapeHtml(svcName) + '</div>' +
        '<div class="detail-modal-subtitle">OTP ID · ' + escapeHtml(otpId) + '</div>' +
      '</div>' +
      '<button class="detail-modal-close" type="button" id="detailModalClose">' + ICONS.close + '</button>' +
    '</div>' +
    '<div class="detail-modal-body">' +
      '<div class="detail-status-badge ' + s.cls + '">' + statusIcon + ' ' + s.label + '</div>' +
      (hasOtp ?
        '<div class="detail-otp-highlight">' +
          '<div class="label">Kode OTP</div>' +
          '<div class="value">' + escapeHtml(o.otp_code) + '</div>' +
          '<button class="copy-btn" type="button" data-copy="' + escapeHtml(o.otp_code) + '">' + ICONS.copy + ' Copy OTP</button>' +
        '</div>' : '') +
      '<div class="detail-grid">' +
        '<div class="detail-item full">' +
          '<span class="detail-item-label">OTP ID</span>' +
          '<span class="detail-item-value primary">' +
            escapeHtml(otpId) +
            ' <button class="copy-inline" type="button" data-copy="' + escapeHtml(otpId) + '" title="Copy OTP ID">' + ICONS.copy + '</button>' +
          '</span>' +
        '</div>' +
        (hasPhone ?
          '<div class="detail-item full">' +
            '<span class="detail-item-label">Nomor</span>' +
            '<span class="detail-item-value">' +
              escapeHtml(o.phone_number) +
              ' <button class="copy-inline" type="button" data-copy="' + escapeHtml(o.phone_number) + '" title="Copy nomor">' + ICONS.copy + '</button>' +
            '</span>' +
          '</div>' : '') +
        '<div class="detail-item">' +
          '<span class="detail-item-label">Negara</span>' +
          '<span class="detail-item-value">' +
            '<span class="country-inline">' + renderFlag(o.country, 'flag-img') + ' ' + escapeHtml(cName) + '</span>' +
          '</span>' +
        '</div>' +
        (o.operator ? '<div class="detail-item"><span class="detail-item-label">Operator</span><span class="detail-item-value">' + escapeHtml(o.operator) + '</span></div>' : '') +
        '<div class="detail-item">' +
          '<span class="detail-item-label">Harga</span>' +
          '<span class="detail-item-value primary">' + formatRupiah(priceIdr) + '</span>' +
        '</div>' +
        (isRefunded ?
          '<div class="detail-item">' +
            '<span class="detail-item-label">Refund</span>' +
            '<span class="detail-item-value purple">' + formatRupiah(o.refunded_amount || priceIdr) + '</span>' +
          '</div>' : '') +
        '<div class="detail-item">' +
          '<span class="detail-item-label">Dibuat</span>' +
          '<span class="detail-item-value" style="font-size:0.75rem">' + formatTanggalLong(o.created_at) + '</span>' +
        '</div>' +
        (o.updated_at ?
          '<div class="detail-item">' +
            '<span class="detail-item-label">Diupdate</span>' +
            '<span class="detail-item-value" style="font-size:0.75rem">' + formatTanggalLong(o.updated_at) + '</span>' +
          '</div>' : '') +
      '</div>' +
      (hasSms ?
        '<div class="detail-sms-box">' +
          '<span class="sms-label">SMS</span>' +
          '<span class="sms-text">' +
            escapeHtml(o.full_sms) +
            ' <button class="copy-inline" type="button" data-copy="' + escapeHtml(o.full_sms) + '" title="Copy SMS">' + ICONS.copy + '</button>' +
          '</span>' +
        '</div>' : '') +
      '<div class="detail-actions">' +
        '<button class="btn-primary" type="button" id="detailModalCloseBtn">Tutup</button>' +
      '</div>' +
    '</div>';

  qa('[data-copy]', mc).forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      copyToClipboard(btn.dataset.copy, btn);
    });
  });
  var c1 = D.getElementById('detailModalClose');
  if (c1) c1.addEventListener('click', closeDetailModal);
  var c2 = D.getElementById('detailModalCloseBtn');
  if (c2) c2.addEventListener('click', closeDetailModal);
  bindDetailImages(mc);
}

async function showOrderDetail(orderId, card) {
  var cacheKey = 'detail_' + orderId;
  var cached = Cache.get(cacheKey, _cfg.ttl.detail);
  if (cached) {
    renderDetailFull(cached);
    openDetailModal();
    return;
  }
  renderDetailSkeleton(card);
  openDetailModal();
  try {
    var res = await fetchWithTimeout(_cfg.ep.orderDetail + '/' + encodeURIComponent(orderId), {
      headers: { Authorization: 'Bearer ' + token }
    });
    var o = await safeJson(res);
    if (!o || o.error) throw new Error(o.error || 'Order tidak ditemukan');
    Cache.set(cacheKey, o);
    renderDetailFull(o);
  } catch (err) {
    var mb = q('#detailModalContent .detail-modal-body');
    if (mb) {
      var badge = q('.detail-status-badge', mb);
      if (badge) {
        badge.className = 'detail-status-badge danger';
        badge.innerHTML = ICONS.warning + ' Gagal memuat detail';
      }
      qa('.detail-skeleton-row', mb).forEach(function (el) { el.remove(); });
      var p = D.createElement('p');
      p.className = 'detail-error-msg';
      p.textContent = err.message || 'Coba lagi nanti.';
      var actions = q('.detail-actions', mb);
      if (actions) mb.insertBefore(p, actions);
    }
  }
}

(function detailModalCloseInit() {
  var el = D.getElementById('detailModal');
  if (!el) return;
  el.addEventListener('click', function (e) {
    if (e.target.id === 'detailModal') closeDetailModal();
  });
  el.addEventListener('touchstart', function (e) {
    if (e.target.id === 'detailModal') {
      e.preventDefault();
      closeDetailModal();
    }
  }, { passive: false });
})();

D.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    var overlay = D.getElementById('detailModal');
    if (overlay && overlay.classList.contains('active')) closeDetailModal();
  }
});

(function refreshInit() {
  var btn = D.getElementById('refreshBtn');
  if (!btn) return;
  btn.addEventListener('click', async function () {
    btn.classList.add('spinning');
    Cache.invalidate('orders_');
    Cache.remove('counts');
    Cache.invalidate('detail_');
    await Promise.allSettled([checkRefunds(true), loadOrders(true), loadCounts()]);
    setTimeout(function () { btn.classList.remove('spinning'); }, 500);
  });
})();

function startAutoSync() {
  if (state.refreshInterval) clearInterval(state.refreshInterval);
  state.refreshInterval = setInterval(async function () {
    if (D.hidden) return;
    var cards = qa('.order-card.pending');
    var pending = cards.map(function (c) {
      return { order_id: c.dataset.orderId, otp_id: c.dataset.otpId };
    });
    if (pending.length > 0) await pollPendingOrders(pending);
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

async function handleLogout() {
  try {
    await fetchWithTimeout(_cfg.ep.logout, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token }
    });
  } catch (e) {}
  Cache.clear();
  SafeStorage.local.remove('access_token');
  SafeStorage.local.remove('user');
  SafeStorage.local.remove('refresh_token');
  location.href = '/landing';
}
(function logoutInit() {
  var btn = D.getElementById('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async function () {
    var ok = await showAlert({
      title: 'Keluar Akun?',
      message: 'Kamu yakin mau keluar dari akun ini?',
      type: 'warning',
      okText: 'Ya, Keluar',
      cancelText: 'Batal',
      showCancel: true
    });
    if (ok) handleLogout();
  });
})();

(async function init() {
  randomizeCopy();
  await Promise.allSettled([
    loadUser(false),
    loadOrders(true),
    loadCounts()
  ]);
  await checkRefunds(false);
  await loadOrders(true);
  startAutoSync();
})();

D.addEventListener('visibilitychange', function () {
  if (D.hidden) {
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
  Object.keys(state.countdownIntervals).forEach(function (k) {
    clearInterval(state.countdownIntervals[k]);
  });
  if (_loadOrdersAbort) _loadOrdersAbort.abort();
}
window.addEventListener('pagehide', _cleanup);
window.addEventListener('beforeunload', _cleanup);

})(window);
