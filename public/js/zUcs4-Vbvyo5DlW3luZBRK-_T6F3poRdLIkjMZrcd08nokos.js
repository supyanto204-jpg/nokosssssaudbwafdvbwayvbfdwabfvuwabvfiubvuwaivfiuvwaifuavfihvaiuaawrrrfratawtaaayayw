(function (global) {
'use strict';

var D = document;
var q = function (s, c) { return (c || D).querySelector(s); };
var qa = function (s, c) { return Array.prototype.slice.call((c || D).querySelectorAll(s)); };

var _crypto = (function () {
  var _k = 'bm9rb3Mtc2VjcmV0LWtleS0yMDI2LWFzeXJvZg==';
  var _s = 'c2FsdC1ub2tvc3YyMDI2LXNlY3VyZQ=='.replace('v', '-');
  var _i = 100000;
  var _dk = null;
  var supported = !!(global.crypto && global.crypto.subtle && global.crypto.getRandomValues);

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
  async function seal(obj) {
    if (!supported) return null;
    try {
      var key = await _derive();
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
      var comb = new Uint8Array(iv.length + c.byteLength);
      comb.set(iv, 0);
      comb.set(new Uint8Array(c), iv.length);
      return _buf2b(comb.buffer);
    } catch (e) { return null; }
  }
  async function unseal(b64) {
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
  return { seal: seal, unseal: unseal };
})();

var Cache = (function () {
  var P = 'aotp_n_';
  var _mem = new Map();
  async function get(key, ttl) {
    if (_mem.has(key)) {
      var e = _mem.get(key);
      if (!ttl || Date.now() - e.t < ttl) return e.v;
      _mem.delete(key);
    }
    try {
      var raw = localStorage.getItem(P + key);
      if (!raw) return null;
      var e2 = await _crypto.unseal(raw);
      if (!e2) return null;
      if (ttl && Date.now() - e2.t > ttl) { localStorage.removeItem(P + key); return null; }
      _mem.set(key, e2);
      return e2.v;
    } catch (err) { return null; }
  }
  async function set(key, v) {
    var e = { t: Date.now(), v: v };
    _mem.set(key, e);
    try {
      var s = await _crypto.seal(e);
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
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(P) === 0) localStorage.removeItem(k);
      });
    } catch (e) {}
  }
  return { get: get, set: set, remove: remove, clear: clear };
})();

var _cfg = {
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
    logout: '/api/auth/logout'
  },
  ttl: {
    user: 5 * 60 * 1000,
    servers: 30 * 60 * 1000,
    services: 30 * 60 * 1000,
    countries: 30 * 60 * 1000,
    prices: 3 * 60 * 1000,
    orders: 20 * 1000
  },
  autoSync: 6000,
  otpCheck: 8000,
  profileSync: 30000,
  activeLimit: 2,
  fetchTimeout: 10000
};

var _dev = (function () {
  function mq(qq) { try { return window.matchMedia(qq).matches; } catch (e) { return false; } }
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

var token = localStorage.getItem('access_token');
if (!token) { location.href = '/login'; return; }

function safeJson(res) { return res.json().catch(function () { return {}; }); }
function formatRupiah(n) { return 'Rp' + (Number(n) || 0).toLocaleString('id-ID'); }
function getInitial(name) { return String(name || '?').trim().charAt(0).toUpperCase() || '?'; }
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
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
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function fetchWithTimeout(url, opts, ms) {
  opts = opts || {};
  ms = ms || _cfg.fetchTimeout;
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
  var o = Object.assign({}, opts);
  if (ctrl) o.signal = ctrl.signal;
  return fetch(url, o).finally(function () { if (timer) clearTimeout(timer); });
}

function apiFetch(path, opts) {
  opts = opts || {};
  var headers = Object.assign({
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/json'
  }, opts.headers || {});
  return fetchWithTimeout(path, Object.assign({}, opts, { headers: headers }));
}

var _copy = {
  pageSubtitle: [
    'Nomor OTP langsung, kode OTP muncul sendiri',
    'Verifikasi akun tanpa ribet, OTP masuk otomatis',
    'Nokos ready 24 jam, refund otomatis kalau gagal',
    'Beli nomor, tunggu OTP, selesai',
    'Pilih server, aplikasi, negara. OTP langsung nongol'
  ],
  heroTitle: ['Beli Nokos', 'Pilih Nomor Kamu', 'Nokos Ready 24 Jam', 'Mulai Beli Nokos'],
  heroDesc: [
    'Pilih server, aplikasi, lalu negara. Nomor langsung tampil, kode OTP muncul sendiri. Expired 15 menit, auto refund kalau kode ga masuk.',
    'Nomor virtual buat verifikasi akun. Proses otomatis 24/7, refund kalau gagal.',
    'Verifikasi akun tanpa pakai nomor pribadi. OTP masuk inbox kamu.',
    'Beli nomor OTP dalam hitungan detik. Kalau gagal, saldo balik penuh.'
  ],
  sectionActive: ['Pesanan Aktif', 'Order Kamu Sekarang', 'Aktivitas Terkini', 'Pesanan Berjalan'],
  ctaText: ['Pesan Nomor Sekarang', 'Beli Nokos Sekarang', 'Mulai Beli', 'Pilih Nomor'],
  sheetStep1: ['Mau pakai server yang mana?', 'Pilih server dulu ya', 'Server mana yang cocok?'],
  sheetStep2: ['Mau beli nomor untuk aplikasi apa?', 'Pilih aplikasi target', 'Aplikasi apa nih?'],
  sheetStep3: ['Mau nomor dari negara mana?', 'Pilih negara', 'Negara mana yang kamu mau?'],
  sheetStep4: ['Pilih harga yang sesuai', 'Pilih opsi harga', 'Harga mana yang cocok?']
};

function randomizeCopy() {
  var ps = D.getElementById('pageSubtitle');
  if (ps) ps.textContent = pick(_copy.pageSubtitle);
  var ht = D.getElementById('heroTitle');
  if (ht) ht.textContent = pick(_copy.heroTitle);
  var hd = D.getElementById('heroDesc');
  if (hd) hd.textContent = pick(_copy.heroDesc);
  var sat = D.getElementById('sectionActiveTitle');
  if (sat) sat.textContent = pick(_copy.sectionActive);
  var ct = D.getElementById('ctaText');
  if (ct) ct.textContent = pick(_copy.ctaText);
}

var ICONS = {
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
  phone: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>'
};

var state = {
  step: 1, server: null, serverLabel: null, requiresOperator: false,
  service: null, serviceName: null, country: null, countryName: null,
  operator: 'any', providers: [], filter: 'sukses'
};

var activeState = {
  page: 1, limit: _cfg.activeLimit, totalPages: 1, allOrders: [],
  countdownIntervals: {}, initialLoadDone: false
};

var ORDER_ID_MAP = new Map();
var PROVIDER_RAW_MAP = new Map();
var ALLOWED_ORDER_FIELDS = new Set([
  'otp_id','status','phone_number','otp_code','otp_code_2','full_sms',
  'price_idr','price','service','service_name',
  'country','country_name','country_flag','operator','server',
  'expires_in','expired_at','created_at','updated_at',
  'received_at','refunded_at','refunded_amount','_bucket'
]);
var ALLOWED_PROVIDER_FIELDS = new Set([
  'id','provider_id','provider_price','price_idr','price',
  'stock','available','active','name','operator',
  'product_id','catalog_product_id','operator_id','operator_name'
]);

function sanitizeOrder(order) {
  if (!order || typeof order !== 'object') return order;
  var clean = {};
  Object.keys(order).forEach(function (k) {
    if (ALLOWED_ORDER_FIELDS.has(k)) clean[k] = order[k];
  });
  return clean;
}
function sanitizeProvider(provider) {
  if (!provider || typeof provider !== 'object') return provider;
  var clean = {};
  Object.keys(provider).forEach(function (k) {
    if (ALLOWED_PROVIDER_FIELDS.has(k)) clean[k] = provider[k];
  });
  return clean;
}

function getServiceDisplayName(order) {
  return String((order && (order.service_name || order.service)) || 'Layanan OTP').trim();
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
function getCountryName(order) {
  var code = String((order && (order.country || order.country_name)) || '').trim().toLowerCase();
  var supplied = String((order && order.country_name) || '').trim();
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
function getOtpId(order) {
  var id = String((order && order.otp_id) || '').trim();
  if (id) return id;
  var seed = [(order && order.created_at), (order && order.service), (order && order.phone_number)].join('|');
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

function fallbackCopy(text, onOk) {
  var ta = D.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
  D.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  try {
    var ok = D.execCommand('copy');
    if (ok && typeof onOk === 'function') onOk();
  } catch (e) {}
  D.body.removeChild(ta);
}
function copyToClipboard(text, btnEl) {
  function onOk() {
    if (!btnEl) return;
    var orig = btnEl.innerHTML;
    btnEl.innerHTML = ICONS.check;
    setTimeout(function () { btnEl.innerHTML = orig; }, 1200);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onOk).catch(function () { fallbackCopy(text, onOk); });
  } else fallbackCopy(text, onOk);
}

function showAlert(opts) {
  return new Promise(function (resolve) {
    var type = opts.type || 'info';
    var overlay = D.getElementById('customAlert');
    var iconEl = D.getElementById('customAlertIcon');
    var titleEl = D.getElementById('customAlertTitle');
    var msgEl = D.getElementById('customAlertMessage');
    var actionsEl = D.getElementById('customAlertActions');

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
    if (save) try { localStorage.setItem('asyrofotp_theme_pref', pref); } catch (e) {}
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
  if (localStorage.getItem('sidebar_collapsed') === 'true' && window.innerWidth > 768) {
    sidebar.classList.add('collapsed');
    D.body.classList.add('sidebar-collapsed');
  }
  collapseBtn.addEventListener('click', function () {
    if (window.innerWidth <= 768) return;
    var c = sidebar.classList.toggle('collapsed');
    D.body.classList.toggle('sidebar-collapsed', c);
    try { localStorage.setItem('sidebar_collapsed', c ? 'true' : 'false'); } catch (e) {}
  });
})();

(function mobileSidebarInit() {
  var toggle = D.getElementById('mobileToggle');
  var sidebar = D.getElementById('sidebar');
  var overlay = D.getElementById('sidebarOverlay');
  if (!toggle || !sidebar || !overlay) return;
  var open = false;
  function openSb() {
    if (open) return;
    open = true;
    sidebar.classList.add('open');
    overlay.classList.add('active');
    D.body.style.overflow = 'hidden';
  }
  function closeSb() {
    if (!open) return;
    open = false;
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    D.body.style.overflow = '';
  }
  toggle.addEventListener('click', function (e) {
    e.preventDefault();
    if (open) closeSb(); else openSb();
  });
  overlay.addEventListener('click', closeSb);
  qa('.nav-item', sidebar).forEach(function (l) {
    l.addEventListener('click', function () {
      if (window.innerWidth <= 768) setTimeout(closeSb, 100);
    });
  });
  D.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) closeSb();
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
  action = action || 'nokos';
  var rc = await getRecaptchaToken(action);
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({}, body, { recaptcha_token: rc }))
  });
}

async function loadProfile(force) {
  if (!force) {
    var cached = await Cache.get('user', _cfg.ttl.user);
    if (cached) renderUser(cached);
  }
  try {
    var res = await apiFetch(_cfg.ep.user);
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
  var nameEl = D.getElementById('userName');
  var balEl = D.getElementById('userBalance');
  var iniEl = D.getElementById('userInitial');
  var pillEl = D.getElementById('balancePill');
  var sheetEl = D.getElementById('sheetBalance');
  if (nameEl) nameEl.textContent = name;
  if (balEl) balEl.textContent = formatRupiah(user.balance);
  if (iniEl) iniEl.textContent = getInitial(name);
  if (pillEl) pillEl.textContent = formatRupiah(user.balance);
  if (sheetEl) sheetEl.textContent = formatRupiah(user.balance);
}

async function fetchActiveOrders() {
  var responses = await Promise.all([
    apiFetch(_cfg.ep.orders + '?status=pending&limit=50'),
    apiFetch(_cfg.ep.orders + '?status=success&limit=20')
  ]);
  var pRaw = await safeJson(responses[0]);
  var sRaw = await safeJson(responses[1]);
  var pData = (pRaw && pRaw.data) || pRaw || {};
  var sData = (sRaw && sRaw.data) || sRaw || {};
  var now = Date.now();
  var FIVE_MIN = 5 * 60 * 1000;
  var pending = (pData.orders || []).map(function (o) {
    return Object.assign({}, sanitizeOrder(o), { _bucket: 'pending' });
  });
  var recent = (sData.orders || [])
    .filter(function (o) {
      var t = o.updated_at || o.created_at;
      if (!t) return false;
      var ts = new Date(t).getTime();
      return Number.isFinite(ts) && (now - ts) <= FIVE_MIN;
    })
    .map(function (o) {
      return Object.assign({}, sanitizeOrder(o), { _bucket: 'success' });
    });
  var merged = pending.concat(recent);
  merged.sort(function (a, b) {
    if (a._bucket !== b._bucket) return a._bucket === 'pending' ? -1 : 1;
    var ta = new Date(a.updated_at || a.created_at || 0).getTime();
    var tb = new Date(b.updated_at || b.created_at || 0).getTime();
    return tb - ta;
  });
  return merged;
}

var _loadActiveInFlight = false;
async function loadActiveOrders() {
  var cached = await Cache.get('orders', _cfg.ttl.orders);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    activeState.allOrders = cached;
    renderActiveOrders(cached);
  }
  if (_loadActiveInFlight) return;
  _loadActiveInFlight = true;
  try {
    var merged = await fetchActiveOrders();
    merged.forEach(function (o) {
      var otpId = String(o.otp_id || '').trim();
      var realId = String(o.raw_id || o.order_id || '').trim();
      if (otpId && realId) ORDER_ID_MAP.set(otpId, realId);
    });
    activeState.allOrders = merged;
    var safe = merged.map(function (o) {
      var rest = Object.assign({}, o);
      delete rest.raw_id;
      delete rest.order_id;
      return rest;
    });
    if (safe.length > 0) await Cache.set('orders', safe);
    else Cache.remove('orders');
    renderActiveOrders(merged);
    activeState.initialLoadDone = true;
  } catch (err) {
    if (activeState.allOrders.length === 0) {
      var c = D.getElementById('activeOrders');
      if (c) {
        c.className = '';
        c.innerHTML =
          '<div class="empty-orders">' +
            '<div class="icon-box">' + ICONS.warning + '</div>' +
            '<h3>Gagal memuat pesanan</h3>' +
            '<p>' + escapeHtml(err.message || 'Coba refresh halaman') + '</p>' +
          '</div>';
      }
    }
  } finally {
    _loadActiveInFlight = false;
  }
}

function getDeadline(key, expiresIn) {
  var k = 'aotp_cd_' + key;
  var now = Date.now();
  try {
    var s = sessionStorage.getItem(k);
    if (s) {
      var d = parseInt(s, 10);
      if (Number.isFinite(d) && d > now) return d;
      sessionStorage.removeItem(k);
    }
  } catch (e) {}
  if (expiresIn > 0) {
    var dd = now + expiresIn * 1000;
    try { sessionStorage.setItem(k, String(dd)); } catch (e) {}
    return dd;
  }
  return 0;
}
function clearDeadline(key) {
  try { sessionStorage.removeItem('aotp_cd_' + key); } catch (e) {}
}

function buildCard(o) {
  var isSuccess = o._bucket === 'success' || o.status === 'success' || o.status === 'received' || o.status === 'confirmed';
  var isPending = o.status === 'pending' && !isSuccess;
  var hasOtp = o.otp_code && o.otp_code.trim();
  var otpId = getOtpId(o);
  var hasApiId = Boolean(o.order_id || o.raw_id);
  var svcName = getServiceDisplayName(o);
  var cName = getCountryName(o);
  var expiresIn = Number(o.expires_in || 0);
  var hasValidCd = isPending && !hasOtp && expiresIn > 0;
  var priceIdr = Number(o.price_idr != null ? o.price_idr : (o.price != null ? o.price : 0));
  var created = formatTanggal(o.created_at);
  if ((o.order_id || o.raw_id) && otpId) ORDER_ID_MAP.set(otpId, o.order_id || o.raw_id);
  var cardClass = isSuccess ? 'is-success' : (isPending ? 'is-pending' : 'is-expired');
  var badgeClass = isSuccess ? 'success' : (isPending ? 'warning' : 'gray');
  var badgeLabel = isSuccess ? 'Berhasil' : (isPending ? (hasOtp ? 'OTP Masuk' : 'Pending') : 'Expired');
  var displayInitial = getInitial(svcName);

  var cdHtml = '';
  if (hasValidCd) {
    var deadline = getDeadline(otpId, expiresIn);
    var rem = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    var m = Math.floor(rem / 60);
    var s = rem % 60;
    var t = (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
    cdHtml = '<div class="aoc-countdown" data-ref="' + escapeHtml(otpId) + '" data-deadline="' + deadline + '">' + ICONS.clock + '<span class="countdown-text">' + t + '</span> tersisa</div>';
  }

  return '' +
    '<div class="aoc-card ' + cardClass + '" ' +
         'data-ref="' + escapeHtml(otpId) + '" ' +
         'data-bucket="' + escapeHtml(o._bucket || '') + '" ' +
         'data-status="' + escapeHtml(o.status || '') + '" ' +
         'data-has-id="' + (hasApiId ? '1' : '0') + '" ' +
         'data-sig="">' +
      '<div class="aoc-header">' +
        '<div class="aoc-card-number">' + escapeHtml(displayInitial) + '</div>' +
        '<div class="aoc-title-wrap">' +
          '<div class="aoc-title">' +
            escapeHtml(svcName) +
            (o.operator ? ' <span class="badge info" style="font-size:0.58rem">' + escapeHtml(o.operator) + '</span>' : '') +
          '</div>' +
          '<div class="aoc-ref"><span class="otp-id">' + escapeHtml(otpId) + '</span></div>' +
        '</div>' +
        '<span class="badge ' + badgeClass + '">' + badgeLabel + '</span>' +
      '</div>' +
      (hasOtp ?
        '<div class="aoc-otp">' +
          '<div class="aoc-otp-icon">' + ICONS.key + '</div>' +
          '<div class="aoc-otp-info">' +
            '<div class="aoc-otp-label">Kode OTP</div>' +
            '<div class="aoc-otp-value">' + escapeHtml(o.otp_code) + '</div>' +
          '</div>' +
          '<button class="aoc-otp-copy" type="button" data-copy="' + escapeHtml(o.otp_code) + '" title="Copy OTP">' + ICONS.copy + '</button>' +
        '</div>' : '') +
      '<div class="aoc-body">' +
        '<div class="aoc-field">' +
          '<span class="aoc-field-label">Nomor</span>' +
          '<span class="aoc-field-value">' +
            escapeHtml(o.phone_number || '—') +
            (o.phone_number ? ' <button class="aoc-otp-copy" style="width:22px;height:22px;min-width:22px;min-height:22px" type="button" data-copy="' + escapeHtml(o.phone_number) + '" title="Copy">' + ICONS.copy + '</button>' : '') +
          '</span>' +
        '</div>' +
        '<div class="aoc-field">' +
          '<span class="aoc-field-label">Negara</span>' +
          '<span class="aoc-field-value">' +
            '<span class="country-inline">' + renderFlag(o.country, 'flag-img') + escapeHtml(cName) + '</span>' +
          '</span>' +
        '</div>' +
        '<div class="aoc-field">' +
          '<span class="aoc-field-label">Harga</span>' +
          '<span class="aoc-field-value price">' + formatRupiah(priceIdr) + '</span>' +
        '</div>' +
        '<div class="aoc-field">' +
          '<span class="aoc-field-label">Dibuat</span>' +
          '<span class="aoc-field-value" style="font-size:0.7rem">' + created + '</span>' +
        '</div>' +
      '</div>' +
      cdHtml +
      '<div class="aoc-actions">' +
        (isPending && hasApiId ?
          (hasOtp ?
            '<button class="btn-mini" type="button" data-resend="' + escapeHtml(otpId) + '">' + ICONS.refresh + ' Resend</button>' +
            '<button class="btn-mini primary" type="button" data-confirm="' + escapeHtml(otpId) + '">' + ICONS.checkCircle + ' Konfirmasi</button>' :
            '<button class="btn-mini danger" type="button" data-cancel="' + escapeHtml(otpId) + '">' + ICONS.ban + ' Batalkan</button>'
          ) :
          '<a href="/inbox" class="btn-mini primary">' + ICONS.info + ' Lihat Detail</a>'
        ) +
      '</div>' +
    '</div>';
}

function bindCard(card) {
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
    btn.addEventListener('click', function () {
      var id = ORDER_ID_MAP.get(btn.dataset.resend) || btn.dataset.resend;
      resendOrder(id, btn);
    });
  });
  qa('[data-confirm]', card).forEach(function (btn) {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () {
      var id = ORDER_ID_MAP.get(btn.dataset.confirm) || btn.dataset.confirm;
      confirmOrder(id, btn);
    });
  });
  qa('[data-cancel]', card).forEach(function (btn) {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () {
      var id = ORDER_ID_MAP.get(btn.dataset.cancel) || btn.dataset.cancel;
      cancelOrder(id, btn);
    });
  });
  qa('img[data-sources]', card).forEach(function (img) {
    if (img.dataset.bound) return;
    img.dataset.bound = '1';
    img.addEventListener('error', function () { window._handleFlagErr(this); });
  });
}

function renderActiveOrders(orders) {
  var container = D.getElementById('activeOrders');
  var countEl = D.getElementById('activeCount');
  var pagEl = D.getElementById('activeOrdersPagination');
  if (!container) return;
  var hasOrders = Array.isArray(orders) && orders.length > 0;
  if (!hasOrders) {
    if (activeState.allOrders.length > 0) return;
    container.className = '';
    container.innerHTML =
      '<div class="empty-orders">' +
        '<div class="icon-box">' + ICONS.phone + '</div>' +
        '<h3>Belum ada pesanan aktif</h3>' +
        '<p>Nomor yang kamu beli bakal muncul di sini beserta kode OTP-nya.</p>' +
      '</div>';
    if (countEl) countEl.style.display = 'none';
    if (pagEl) pagEl.style.display = 'none';
    return;
  }
  if (countEl) {
    countEl.textContent = orders.length;
    countEl.style.display = 'inline-flex';
  }
  var total = orders.length;
  activeState.totalPages = Math.max(1, Math.ceil(total / activeState.limit));
  if (activeState.page > activeState.totalPages) activeState.page = activeState.totalPages;
  var start = (activeState.page - 1) * activeState.limit;
  var pageOrders = orders.slice(start, start + activeState.limit);

  if (!container.classList.contains('active-orders')) container.className = 'active-orders';
  var emptyEl = q('.empty-orders', container);
  if (emptyEl) emptyEl.remove();

  var existing = new Map();
  qa(':scope > .aoc-card', container).forEach(function (card) {
    var id = card.dataset.ref;
    if (id) existing.set(id, card);
  });
  var frag = D.createDocumentFragment();
  pageOrders.forEach(function (o, idx) {
    var otpId = getOtpId(o);
    var key = otpId || ('fb-' + idx);
    var tmp = D.createElement('div');
    tmp.innerHTML = buildCard(o).trim();
    var newCard = tmp.firstElementChild;
    var newSig = [
      o.status || '',
      (o.otp_code || '').trim(),
      (o.phone_number || '').trim(),
      (o.service || '').trim(),
      o._bucket || ''
    ].join('|');
    var old = existing.get(key);
    var oldSig = old ? old.dataset.sig || '' : null;
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
  existing.forEach(function (card, id) {
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
    pagEl.innerHTML =
      '<button class="page-btn" type="button" data-page="' + (activeState.page - 1) + '" ' + (activeState.page <= 1 ? 'disabled' : '') + '>Prev</button>' +
      '<span class="page-info">Halaman ' + activeState.page + ' dari ' + activeState.totalPages + '</span>' +
      '<button class="page-btn" type="button" data-page="' + (activeState.page + 1) + '" ' + (activeState.page >= activeState.totalPages ? 'disabled' : '') + '>Next</button>';
    qa('.page-btn', pagEl).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var p = Number(btn.dataset.page);
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
  Object.keys(activeState.countdownIntervals).forEach(function (k) {
    clearInterval(activeState.countdownIntervals[k]);
  });
  activeState.countdownIntervals = {};
  qa('.aoc-countdown').forEach(function (el) {
    var ref = el.dataset.ref;
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
        if (activeState.countdownIntervals[ref]) clearInterval(activeState.countdownIntervals[ref]);
        clearDeadline(ref);
        setTimeout(function () {
          Cache.remove('orders');
          loadActiveOrders();
        }, 500);
        return;
      }
      var m = Math.floor(rem / 60);
      var s = rem % 60;
      if (textEl) textEl.textContent = (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
    }
    tick();
    activeState.countdownIntervals[ref] = setInterval(tick, 1000);
  });
}

async function syncPendingOrders() {
  var pending = activeState.allOrders.filter(function (o) {
    return o._bucket === 'pending' && o.status === 'pending' && !(o.otp_code && o.otp_code.trim());
  });
  if (pending.length === 0) return;
  var results = await Promise.allSettled(
    pending.map(function (o) {
      var otpId = String(o.otp_id || '').trim();
      var realId = ORDER_ID_MAP.get(otpId) || o.order_id || o.raw_id;
      return securePost(_cfg.ep.cekotp, { order_id: realId, otp_id: otpId }, 'cekotp').then(function (r) { return safeJson(r); });
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
        loadProfile(true);
      }
    }
  });
  if (hasUpdate) {
    Cache.remove('orders');
    loadActiveOrders();
  }
}

var autoSyncInterval = null;
var otpCheckInterval = null;
var profileSyncInterval = null;

function startAutoSync() {
  if (autoSyncInterval) clearInterval(autoSyncInterval);
  autoSyncInterval = setInterval(function () {
    if (!D.hidden) loadActiveOrders();
  }, _cfg.autoSync);
  if (otpCheckInterval) clearInterval(otpCheckInterval);
  otpCheckInterval = setInterval(function () {
    if (!D.hidden) syncPendingOrders();
  }, _cfg.otpCheck);
  if (profileSyncInterval) clearInterval(profileSyncInterval);
  profileSyncInterval = setInterval(function () {
    if (!D.hidden) loadProfile(false);
  }, _cfg.profileSync);
}
function stopAutoSync() {
  if (autoSyncInterval) { clearInterval(autoSyncInterval); autoSyncInterval = null; }
  if (otpCheckInterval) { clearInterval(otpCheckInterval); otpCheckInterval = null; }
  if (profileSyncInterval) { clearInterval(profileSyncInterval); profileSyncInterval = null; }
}

async function resendOrder(orderId, btn) {
  var orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span>';
  try {
    var res = await securePost(_cfg.ep.order + '/' + encodeURIComponent(orderId) + '/resend', {}, 'resend');
    var data = await safeJson(res);
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
  var ok = await showAlert({
    title: 'Konfirmasi Sukses',
    message: 'Yakin order ini sudah sukses? Setelah dikonfirmasi, order akan dianggap selesai dan tidak bisa dibatalkan.',
    type: 'success', okText: 'Ya, Konfirmasi', showCancel: true
  });
  if (!ok) return;
  var orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span>';
  try {
    var res = await securePost(_cfg.ep.order + '/' + encodeURIComponent(orderId) + '/confirm', {}, 'confirm');
    var data = await safeJson(res);
    if (!res.ok) throw new Error(data.error || 'Gagal konfirmasi');
    await showAlert({ title: 'Order Sukses', message: 'Order berhasil dikonfirmasi sukses.', type: 'success' });
    Cache.remove('orders');
    loadActiveOrders();
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
    type: 'warning', okText: 'Ya, Batalkan', showCancel: true
  });
  if (!ok) return;
  var orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span>';
  try {
    var res = await securePost(_cfg.ep.order + '/' + encodeURIComponent(orderId) + '/cancel', {}, 'cancel');
    var data = await safeJson(res);
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

var _sheetClosing = false;
function openSheet() {
  var overlay = D.getElementById('sheetOverlay');
  if (!overlay) return;
  overlay.classList.remove('closing');
  overlay.classList.add('active');
  D.body.classList.add('sheet-open');
  _sheetClosing = false;
}
function closeSheet() {
  var overlay = D.getElementById('sheetOverlay');
  if (!overlay || _sheetClosing) return;
  _sheetClosing = true;
  overlay.classList.add('closing');
  setTimeout(function () {
    overlay.classList.remove('active', 'closing');
    D.body.classList.remove('sheet-open');
    _sheetClosing = false;
  }, 220);
}
function adjustSheetHeight() {
  var sheet = D.getElementById('bottomSheet');
  var body = D.getElementById('sheetBody');
  if (!sheet || !body) return;
  body.style.maxHeight = '';
  var headerEl = q('.sheet-header', sheet);
  var handleEl = q('.sheet-handle', sheet);
  var headerH = headerEl ? headerEl.offsetHeight : 0;
  var handleH = handleEl ? handleEl.offsetHeight : 0;
  var maxBodyH = window.innerHeight * 0.88 - headerH - handleH - 24;
  var targetH = Math.min(body.scrollHeight, maxBodyH);
  body.style.maxHeight = targetH + 'px';
}

function goToStep(step) {
  state.step = step;
  var body = D.getElementById('sheetBody');
  var stepEl = D.getElementById('sheetStep');
  var titleEl = D.getElementById('sheetTitle');
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
  var body = D.getElementById('sheetBody');
  body.innerHTML = '<div class="loading-block"><span class="spinner"></span><span>Memuat server...</span></div>';
  adjustSheetHeight();
  var cached = await Cache.get('servers', _cfg.ttl.servers);
  if (cached && cached.length > 0) renderServers(cached);
  try {
    var res = await apiFetch(_cfg.ep.servers);
    var data = await safeJson(res);
    var servers = data.servers || [];
    if (servers.length > 0) await Cache.set('servers', servers);
    renderServers(servers);
  } catch (err) {
    if (!cached) {
      body.innerHTML = '<div class="empty-block"><h3>Gagal memuat server</h3><p>' + escapeHtml(err.message) + '</p></div>';
      adjustSheetHeight();
    }
  }
}

function renderServers(servers) {
  var body = D.getElementById('sheetBody');
  if (!servers || servers.length === 0) {
    body.innerHTML = '<div class="empty-block"><h3>Belum ada server</h3><p>Coba lagi nanti.</p></div>';
    adjustSheetHeight();
    return;
  }
  body.innerHTML =
    '<div class="server-list">' +
      servers.map(function (s) {
        return '<button class="server-card" type="button" data-server="' + escapeHtml(s.id) + '" data-label="' + escapeHtml(s.label) + '" data-operator="' + s.requiresOperator + '">' +
          '<div class="server-icon">' + ICONS.server + '</div>' +
          '<div class="server-info">' +
            '<div class="server-title">' + escapeHtml(s.label) +
              (s.badge ? ' <span class="server-badge">' + escapeHtml(s.badge) + '</span>' : '') +
            '</div>' +
            '<div class="server-desc">' + escapeHtml(s.desc || '') + '</div>' +
          '</div>' +
          '<div class="server-arrow"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>' +
        '</button>';
      }).join('') +
    '</div>';
  qa('.server-card', body).forEach(function (card) {
    card.addEventListener('click', function () {
      state.server = card.dataset.server;
      state.serverLabel = card.dataset.label;
      state.requiresOperator = card.dataset.operator === 'true';
      state.service = null;
      state.country = null;
      prefetchForServer(state.server);
      goToStep(2);
    });
  });
  adjustSheetHeight();
}

function prefetchForServer(server) {
  if (!server) return;
  apiFetch(_cfg.ep.services + '?server=' + encodeURIComponent(server))
    .then(safeJson)
    .then(function (data) {
      if (data && data.services && data.services.length > 0) {
        Cache.set('services_' + server, data.services);
      }
    })
    .catch(function () {});
}

async function renderAppStep() {
  var body = D.getElementById('sheetBody');
  body.innerHTML =
    '<button class="sheet-back" type="button" id="backBtn">' +
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Ganti Server' +
    '</button>' +
    '<div class="sheet-search">' +
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<input type="text" class="form-control" id="appSearch" placeholder="Cari nama aplikasi...">' +
    '</div>' +
    '<div id="appContent"><div class="loading-block"><span class="spinner"></span><span>Memuat aplikasi...</span></div></div>';
  adjustSheetHeight();
  D.getElementById('backBtn').addEventListener('click', function () { goToStep(1); });

  var ck = 'services_' + state.server;
  var cached = await Cache.get(ck, _cfg.ttl.services);
  if (cached && cached.length > 0) renderApps(cached);
  try {
    var res = await apiFetch(_cfg.ep.services + '?server=' + encodeURIComponent(state.server));
    var data = await safeJson(res);
    var services = data.services || [];
    if (services.length > 0) await Cache.set(ck, services);
    renderApps(services);
    var search = D.getElementById('appSearch');
    if (search) {
      search.addEventListener('input', function (e) {
        var val = e.target.value.toLowerCase().trim();
        var f = services.filter(function (s) {
          return (s.name || '').toLowerCase().indexOf(val) !== -1 || (s.code || '').toLowerCase().indexOf(val) !== -1;
        });
        renderApps(f);
      });
    }
  } catch (err) {
    if (!cached) {
      var c = D.getElementById('appContent');
      if (c) {
        c.innerHTML = '<div class="empty-block"><h3>Gagal memuat aplikasi</h3><p>' + escapeHtml(err.message) + '</p></div>';
        adjustSheetHeight();
      }
    }
  }
}

function renderApps(services) {
  var c = D.getElementById('appContent');
  if (!c) return;
  if (!services || services.length === 0) {
    c.innerHTML = '<div class="empty-block"><h3>Belum ada aplikasi</h3><p>Server ini belum punya aplikasi tersedia.</p></div>';
    adjustSheetHeight();
    return;
  }
  c.innerHTML =
    '<div class="app-grid">' +
      services.map(function (s) {
        return '<button class="app-card" type="button" data-service="' + escapeHtml(s.code) + '" data-name="' + escapeHtml(s.name) + '">' +
          '<div class="app-list-number">' + escapeHtml(getInitial(s.name)) + '</div>' +
          '<div class="name">' + escapeHtml(s.name) + '</div>' +
        '</button>';
      }).join('') +
    '</div>';
  qa('.app-card', c).forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.service = btn.dataset.service;
      state.serviceName = btn.dataset.name;
      state.country = null;
      state.operator = 'any';
      prefetchCountries(state.server, state.service);
      goToStep(3);
    });
  });
  adjustSheetHeight();
}

function prefetchCountries(server, service) {
  if (!server || !service) return;
  var ck = 'countries_' + server + '_' + service;
  apiFetch(_cfg.ep.countries + '?server=' + encodeURIComponent(server) + '&service=' + encodeURIComponent(service))
    .then(safeJson)
    .then(function (data) {
      if (data && data.countries && data.countries.length > 0) {
        Cache.set(ck, data.countries);
      }
    })
    .catch(function () {});
}

async function renderCountryStep() {
  var body = D.getElementById('sheetBody');
  body.innerHTML =
    '<button class="sheet-back" type="button" id="backBtn">' +
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Ganti Aplikasi' +
    '</button>' +
    '<div class="app-selected-card">' +
      '<div class="app-list-number">' + escapeHtml(getInitial(state.serviceName)) + '</div>' +
      '<div class="info">' +
        '<div class="name">' + escapeHtml(state.serviceName || '') + '</div>' +
        '<div class="sub">Aplikasi yang dipilih</div>' +
      '</div>' +
    '</div>' +
    '<div class="sheet-search">' +
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<input type="text" class="form-control" id="countrySearch" placeholder="Cari nama negara...">' +
    '</div>' +
    '<div id="countryContent"><div class="loading-block"><span class="spinner"></span><span>Memuat negara...</span></div></div>';
  adjustSheetHeight();
  D.getElementById('backBtn').addEventListener('click', function () { goToStep(2); });

  var ck = 'countries_' + state.server + '_' + state.service;
  var cached = await Cache.get(ck, _cfg.ttl.countries);
  if (cached && cached.length > 0) renderCountries(cached);
  try {
    var res = await apiFetch(
      _cfg.ep.countries + '?server=' + encodeURIComponent(state.server) + '&service=' + encodeURIComponent(state.service)
    );
    var data = await safeJson(res);
    var countries = data.countries || [];
    if (countries.length > 0) await Cache.set(ck, countries);
    renderCountries(countries);
    var search = D.getElementById('countrySearch');
    if (search) {
      search.addEventListener('input', function (e) {
        var val = e.target.value.toLowerCase().trim();
        var f = countries.filter(function (c) {
          return (c.name || '').toLowerCase().indexOf(val) !== -1 || (c.code || '').toLowerCase().indexOf(val) !== -1;
        });
        renderCountries(f);
      });
    }
  } catch (err) {
    if (!cached) {
      var c = D.getElementById('countryContent');
      if (c) {
        c.innerHTML = '<div class="empty-block"><h3>Gagal memuat negara</h3><p>' + escapeHtml(err.message) + '</p></div>';
        adjustSheetHeight();
      }
    }
  }
}

function renderCountries(countries) {
  var c = D.getElementById('countryContent');
  if (!c) return;
  if (!countries || countries.length === 0) {
    c.innerHTML = '<div class="empty-block"><h3>Belum ada negara</h3><p>Server ini belum punya negara tersedia.</p></div>';
    adjustSheetHeight();
    return;
  }
  c.innerHTML =
    '<div class="country-list">' +
      countries.map(function (co) {
        var isPremium = state.server === 'premium';
        var minPrice = co.min_price != null ? Number(co.min_price) : null;
        var hasPrice = isPremium && Number.isFinite(minPrice) && minPrice > 0;
        var isSoldOut = isPremium && co.min_price === null;
        var meta = 'Kode: ' + escapeHtml((co.code || '').toUpperCase());
        if (hasPrice) {
          meta = 'Mulai ' + formatRupiah(minPrice) + ' · ' + escapeHtml((co.code || '').toUpperCase());
        } else if (isSoldOut) {
          meta = 'Stok habis';
        }
        var disabled = isSoldOut ? ' disabled' : '';
        return '<button class="country-item" type="button" data-country="' + escapeHtml(co.code) + '" data-name="' + escapeHtml(co.name) + '"' + disabled + '>' +
          '<div class="country-flag">' + renderFlag(co.code) + '</div>' +
          '<div class="country-info">' +
            '<div class="country-name">' + escapeHtml(co.name) + '</div>' +
            '<div class="country-meta">' + meta + '</div>' +
          '</div>' +
          '<div class="country-arrow"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>' +
        '</button>';
      }).join('') +
    '</div>';
  qa('.country-item', c).forEach(function (item) {
    if (item.disabled) return;
    item.addEventListener('click', function () {
      state.country = item.dataset.country;
      state.countryName = item.dataset.name;
      state.operator = 'any';
      goToStep(4);
    });
  });
  qa('img[data-sources]', c).forEach(function (img) {
    img.addEventListener('error', function () { window._handleFlagErr(this); });
  });
  adjustSheetHeight();
}

async function renderPriceStep() {
  var body = D.getElementById('sheetBody');
  body.innerHTML =
    '<button class="sheet-back" type="button" id="backBtn">' +
      '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Ganti Negara' +
    '</button>' +
    '<div class="app-selected-card">' +
      '<div class="app-list-number">' + escapeHtml(getInitial(state.serviceName)) + '</div>' +
      '<div class="info">' +
        '<div class="name">' + escapeHtml(state.serviceName || '') + '</div>' +
        '<div class="sub"><span class="country-inline">' + renderFlag(state.country) + ' ' + escapeHtml(state.countryName || '') + '</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="sheet-tabs">' +
      '<button class="sheet-tab active" type="button" data-filter="sukses">Paling Sukses</button>' +
      '<button class="sheet-tab" type="button" data-filter="murah">Termurah</button>' +
    '</div>' +
    '<div id="priceContent"><div class="loading-block"><span class="spinner"></span><span>Memuat harga...</span></div></div>';
  adjustSheetHeight();
  D.getElementById('backBtn').addEventListener('click', function () { goToStep(3); });

  qa('.sheet-tab', body).forEach(function (tab) {
    tab.addEventListener('click', function () {
      qa('.sheet-tab', body).forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      state.filter = tab.dataset.filter;
      renderPrices(state.providers);
    });
  });

  var ck = 'prices_' + state.server + '_' + state.service + '_' + state.country;
  var cached = await Cache.get(ck, _cfg.ttl.prices);
  if (cached && cached.length > 0) {
    state.providers = cached;
    renderPrices(state.providers);
  }
  try {
    var res = await apiFetch(
      _cfg.ep.prices + '?server=' + encodeURIComponent(state.server) +
      '&service=' + encodeURIComponent(state.service) +
      '&country=' + encodeURIComponent(state.country)
    );
    var data = await safeJson(res);
    var raw = data.providers || [];
    PROVIDER_RAW_MAP.clear();
    raw.forEach(function (p) {
      var pid = String(p.id || p.provider_id || '').trim();
      if (pid) {
        PROVIDER_RAW_MAP.set(pid, {
          id: p.id,
          provider_id: p.provider_id,
          provider_price: p.provider_price,
          price: p.price
        });
      }
    });
    var providers = raw.map(function (p) {
      var clean = sanitizeProvider(p);
      clean._pid = String(p.id || p.provider_id || '').trim();
      return clean;
    });
    state.providers = providers;
    if (providers.length > 0) await Cache.set(ck, providers);
    renderPrices(providers);
  } catch (err) {
    if (!cached) {
      var c = D.getElementById('priceContent');
      if (c) {
        c.innerHTML = '<div class="empty-block"><h3>Gagal memuat harga</h3><p>' + escapeHtml(err.message) + '</p></div>';
        adjustSheetHeight();
      }
    }
  }
}

function renderPrices(providers) {
  var c = D.getElementById('priceContent');
  if (!c) return;
  var list = (providers || []).filter(function (p) { return p.active !== false; });
  if (list.length === 0) {
    c.innerHTML = '<div class="empty-block"><h3>Stok habis</h3><p>Belum ada stok tersedia untuk kombinasi ini.</p></div>';
    adjustSheetHeight();
    return;
  }
  var sorted = list.slice();
  if (state.filter === 'murah') sorted.sort(function (a, b) { return a.price_idr - b.price_idr; });
  else sorted.sort(function (a, b) { return (b.stock || 0) - (a.stock || 0); });
  var svcIni = getInitial(state.serviceName);
  c.innerHTML =
    '<div class="price-list">' +
      sorted.map(function (p, i) {
        var stock = Number(p.stock) || Number(p.available) || 0;
        var sc = stock === 0 ? 'out' : (stock < 50 ? 'low' : '');
        return '<div class="price-item">' +
          '<div class="app-list-number">' + escapeHtml(svcIni) + '</div>' +
          '<div class="price-info">' +
            '<div class="price-title">Opsi ' + (i + 1) +
              ' <span class="price-stock ' + sc + '">' + stock + ' stok</span>' +
            '</div>' +
            '<div class="price-meta">' + escapeHtml(state.countryName || '') + '</div>' +
          '</div>' +
          '<div class="price-right">' +
            '<div class="price-amount">' + formatRupiah(p.price_idr) + '</div>' +
            '<button class="btn-primary" type="button" data-buy-pid="' + escapeHtml(p._pid || '') + '"' + (stock === 0 ? ' disabled' : '') + '>' +
              '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>' +
              ' ORDER' +
            '</button>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  qa('[data-buy-pid]', c).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pid = btn.dataset.buyPid;
      var p = sorted.find(function (x) { return String(x._pid) === String(pid); });
      if (p) confirmPurchase(pid, p, btn);
    });
  });
  adjustSheetHeight();
}

async function confirmPurchase(pid, priceData, btn) {
  var price = Number(priceData.price_idr || priceData.price || 0);
  var ok = await showAlert({
    title: 'Konfirmasi Pembelian',
    message: 'Beli nomor ' + state.serviceName + ' dari ' + state.countryName + ' dengan harga ' + formatRupiah(price) + '? Saldo akan langsung terpotong.',
    type: 'warning', okText: 'Ya, Beli', showCancel: true, cancelText: 'Batal'
  });
  if (!ok) return;
  placeOrder(pid, priceData, btn);
}

async function placeOrder(pid, priceData, btn) {
  var orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span>';
  try {
    var raw = PROVIDER_RAW_MAP.get(pid) || {};
    var expected = Number(priceData.price_idr || priceData.price || 0);
    var body = {
      server: state.server, service: state.service, country: state.country,
      service_name: state.serviceName, country_flag: state.country,
      expected_price: expected
    };
    if (state.requiresOperator) {
      body.provider_id = raw.provider_id || raw.id;
      body.provider_price = raw.provider_price || raw.price;
      body.operator = state.operator || 'any';
    } else {
      body.id = raw.id || pid;
    }
    var res = await securePost(_cfg.ep.order, body, 'order');
    var data = await safeJson(res);
    if (!res.ok) {
      var code = data.code || '';
      if (code === 'PRICE_CHANGED') throw new Error('Harga berubah jadi ' + formatRupiah(data.actual) + '. Silakan pilih ulang.');
      if (code === 'INSUFFICIENT_USER_BALANCE') throw new Error('Saldo kamu tidak cukup. Silakan deposit dulu.');
      if (code === 'INSUFFICIENT_BALANCE' || code === 'INSUFFICIENT_PROVIDER_BALANCE') throw new Error('Server sedang sibuk, coba lagi nanti.');
      throw new Error(data.error || 'Order gagal');
    }
    closeSheet();
    PROVIDER_RAW_MAP.clear();
    Cache.remove('user');
    Cache.remove('orders');
    D.getElementById('modalSuccess').classList.add('active');
    setTimeout(function () {
      loadProfile(true);
      loadActiveOrders();
    }, 400);
  } catch (err) {
    await showAlert({ title: 'Order Gagal', message: err.message || 'Terjadi kesalahan', type: 'danger' });
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

D.addEventListener('click', function (e) {
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});
D.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    var m = q('.modal-overlay.active');
    if (m) m.classList.remove('active');
    var s = D.getElementById('sheetOverlay');
    if (s && s.classList.contains('active')) closeSheet();
  }
});

async function handleLogout() {
  try {
    await apiFetch(_cfg.ep.logout, { method: 'POST' });
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
D.getElementById('logoutBtn').addEventListener('click', async function () {
  var ok = await showAlert({
    title: 'Keluar Akun?',
    message: 'Kamu yakin mau keluar dari akun ini?',
    type: 'warning', okText: 'Ya, Keluar', cancelText: 'Batal', showCancel: true
  });
  if (ok) handleLogout();
});

(function initEmptyState() {
  var c = D.getElementById('activeOrders');
  if (!c) return;
  c.className = '';
  c.innerHTML =
    '<div class="empty-orders">' +
      '<div class="icon-box"><span class="spinner-sm"></span></div>' +
      '<h3>Memuat pesanan...</h3>' +
      '<p>Sedang mengambil data pesanan aktif kamu.</p>' +
    '</div>';
})();

(function initSheetClick() {
  var btn = D.getElementById('btnOrder');
  var overlay = D.getElementById('sheetOverlay');
  if (btn) {
    btn.addEventListener('click', function () {
      openSheet();
      goToStep(1);
    });
  }
  if (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target.id === 'sheetOverlay') closeSheet();
    });
  }
})();

(async function () {
  randomizeCopy();
  await Promise.allSettled([loadProfile(false), loadActiveOrders()]);
  startAutoSync();
})();

D.addEventListener('visibilitychange', function () {
  if (!D.hidden) {
    loadProfile(false);
    loadActiveOrders();
    syncPendingOrders();
  }
});
window.addEventListener('beforeunload', function () {
  stopAutoSync();
  Object.keys(activeState.countdownIntervals).forEach(function (k) {
    clearInterval(activeState.countdownIntervals[k]);
  });
});

})(window);
