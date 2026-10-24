(function (global) {
  'use strict';

  var D = document;
  var q = function (s, c) { return (c || D).querySelector(s); };
  var qa = function (s, c) { return Array.prototype.slice.call((c || D).querySelectorAll(s)); };
  var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isLite = D.documentElement.getAttribute('data-perf') === 'lite';

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
    var P = 'aotp_d_';
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
    return { get: get, set: set, remove: remove, clear: clear };
  })();

  var cfg = {
    ep: {
      user: '/api/user',
      orders: '/api/nokos/orders',
      refunds: '/api/nokos/check-refunds',
      logout: '/api/auth/logout'
    },
    ttl: { user: 5 * 60 * 1000, orders: 30 * 1000 },
    refreshInterval: 15000,
    refundInterval: 30000,
    fetchTimeout: 12000
  };

  var dev = (function () {
    var mq = function (s) { try { return window.matchMedia(s).matches; } catch (e) { return false; } };
    var hc = navigator.hardwareConcurrency || 4;
    var conn = navigator.connection || {};
    return {
      mobile: mq('(max-width: 768px)'),
      lowEnd: hc <= 4 || conn.saveData || /2g|slow-2g/.test(conn.effectiveType || ''),
      reduced: mq('(prefers-reduced-motion: reduce)')
    };
  })();

  if (dev.reduced || dev.lowEnd) {
    D.documentElement.setAttribute('data-perf', 'lite');
    isLite = true;
  }

  var token = SafeStorage.local.get('access_token');
  if (!token) { location.href = '/login'; return; }

  function safeJson(res) { return res.json().catch(function () { return {}; }); }

  function fetchWithTimeout(url, opts, ms) {
    opts = opts || {};
    ms = ms || cfg.fetchTimeout;
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

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
    }
    try {
      var ta = D.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      D.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = D.execCommand('copy');
      D.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  var copyBank = {
    greeting: [
      'Halo, {name}',
      'Selamat datang, {name}',
      'Hai {name}',
      '{name}, siap order?'
    ],
    heroTitle: [
      'Selamat Datang',
      'Halo Lagi',
      'Siap Order?',
      'Mulai Hari Ini'
    ],
    heroDesc: [
      'Nokos OTP 24 jam, proses instan, refund otomatis. Beli nomor & terima OTP langsung di inbox.',
      'Nomor virtual buat verifikasi akun. Proses otomatis 24/7.',
      'Verifikasi akun tanpa pakai nomor pribadi. Refund otomatis kalau gagal.'
    ],
    userCodeHint: [
      'Bagikan ID ini kalau butuh bantuan support',
      'Simpan ID ini, dipakai admin buat verifikasi',
      'Kasih ID ini ke admin kalau ada kendala'
    ],
    qaDesc: {
      nokos: ['Order nomor OTP', 'Beli nomor virtual', 'Pilih nomor'],
      deposit: ['Top-up saldo', 'Isi saldo', 'Tambah saldo'],
      inbox: ['Lihat pesan', 'Cek OTP masuk', 'Baca inbox'],
      profile: ['Atur akun', 'Edit profil', 'Pengaturan']
    },
    txCardDesc: [
      'Klik baris buat lihat detail di Inbox',
      'Tap buat buka detail pesanan',
      'Klik buat lihat OTP di Inbox'
    ]
  };

  function fillGreeting(name) {
    return pick(copyBank.greeting).replace('{name}', escapeHtml(name || '—'));
  }

  function randomizeCopy() {
    var hn = D.getElementById('greetingName');
    var gl = D.getElementById('greetingLine');
    if (gl && hn) gl.innerHTML = fillGreeting(hn.textContent);

    var heroT = D.getElementById('heroTitle');
    if (heroT) heroT.textContent = pick(copyBank.heroTitle);

    var heroD = D.getElementById('heroDesc');
    if (heroD) heroD.textContent = pick(copyBank.heroDesc);

    var uq = D.getElementById('userCodeHint');
    if (uq) uq.textContent = pick(copyBank.userCodeHint);

    ['Nokos', 'Deposit', 'Inbox', 'Profile'].forEach(function (k) {
      var el = D.getElementById('qaDesc' + k);
      if (el) el.textContent = pick(copyBank.qaDesc[k.toLowerCase()]);
    });

    var txDesc = D.getElementById('txCardDesc');
    if (txDesc) txDesc.textContent = pick(copyBank.txCardDesc);
  }

  var ICONS = {
    check: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    close: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    warning: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    coin: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M15 9.5a3 3 0 0 0-3-1.5c-1.66 0-3 .67-3 1.5s1.34 1.5 3 1.5 3 .67 3 1.5-1.34 1.5-3 1.5a3 3 0 0 1-3-1.5"/></svg>'
  };

  function animateCounter(el, target) {
    if (!el) return;
    var start = Number(el.dataset.value || 0);
    var end = Number(target) || 0;
    if (start === end) { el.textContent = end; el.dataset.value = end; return; }
    var duration = (dev.reduced || isLite) ? 0 : 600;
    if (duration === 0) { el.textContent = end; el.dataset.value = end; return; }
    var t0 = performance.now();
    function step(now) {
      var p = Math.min(1, (now - t0) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      var val = Math.round(start + (end - start) * eased);
      el.textContent = val;
      if (p < 1) requestAnimationFrame(step);
      else { el.textContent = end; el.dataset.value = end; }
    }
    requestAnimationFrame(step);
  }

  function showRefundToast(totalRefund, count) {
    var old = D.getElementById('refundToast');
    if (old) old.remove();

    var toast = D.createElement('div');
    toast.id = 'refundToast';
    toast.className = 'refund-toast';
    toast.innerHTML =
      '<div class="icon-box">' + ICONS.coin + '</div>' +
      '<div class="content">' +
        '<div class="title">Refund Diterima</div>' +
        '<div class="message">' + count + ' pesanan di-refund. Total <strong>' + formatRupiah(totalRefund) + '</strong> masuk ke saldo.</div>' +
      '</div>' +
      '<button class="close-btn" type="button" aria-label="Tutup">' + ICONS.close + '</button>';
    D.body.appendChild(toast);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { toast.classList.add('show'); });
    });

    var timer = setTimeout(function () { dismissToast(toast); }, 8000);
    toast.querySelector('.close-btn').addEventListener('click', function () {
      clearTimeout(timer);
      dismissToast(toast);
    });
  }

  function dismissToast(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.remove('show');
    setTimeout(function () { toast.remove(); }, 400);
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
      D.body.style.overflow = 'hidden';
    }
    function closeSb() {
      if (!open) return;
      open = false;
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
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

  function getServiceDisplayName(tx) {
    var name = String((tx && tx.service_name) || '').trim();
    if (name) return name;
    var svc = String((tx && tx.service) || '').trim();
    if (svc) return svc;
    return 'Layanan OTP';
  }

  function getServiceInitial(tx) {
    var name = getServiceDisplayName(tx);
    var first = String(name).trim().charAt(0).toUpperCase();
    return /[A-Z0-9]/.test(first) ? first : '#';
  }

  function renderServiceIcon(tx) {
    return '<span>' + escapeHtml(getServiceInitial(tx)) + '</span>';
  }

  function countryCodeToTwemoji(code) {
    var c = (code || '').toUpperCase();
    if (c.length !== 2) return null;
    return c.split('').map(function (ch) {
      return (0x1F1E6 + ch.charCodeAt(0) - 65).toString(16);
    }).join('-');
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
    cls = cls || 'tx-flag';
    var sources = getFlagSources(code);
    if (sources.length === 0) {
      return '<div class="' + cls + '" style="display:flex;align-items:center;justify-content:center;background:var(--surface-2);color:var(--txt3);font-size:0.55rem;font-weight:700;">' + escapeHtml((code || '??').toUpperCase()) + '</div>';
    }
    var attr = JSON.stringify(sources).replace(/"/g, '&quot;');
    return '<img class="' + cls + '" src="' + sources[0] + '" alt="' + code + '" loading="lazy" data-sources="' + attr + '" data-idx="0">';
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

  var COUNTRY_NAMES = {
    id: 'Indonesia', ru: 'Rusia', us: 'Amerika Serikat', my: 'Malaysia', vn: 'Vietnam',
    ph: 'Filipina', th: 'Thailand', sg: 'Singapura', in: 'India', cn: 'Tiongkok',
    jp: 'Jepang', kr: 'Korea Selatan', uk: 'Britania Raya', gb: 'Britania Raya',
    de: 'Jerman', fr: 'Prancis', br: 'Brasil', ng: 'Nigeria', pk: 'Pakistan',
    bd: 'Bangladesh', tr: 'Turki', es: 'Spanyol', it: 'Italia', nl: 'Belanda',
    au: 'Australia', ca: 'Kanada', mx: 'Meksiko', ar: 'Argentina', za: 'Afrika Selatan',
    sa: 'Arab Saudi', ae: 'Uni Emirat Arab', pl: 'Polandia', ua: 'Ukraina',
    ro: 'Rumania', kh: 'Kamboja', la: 'Laos', mm: 'Myanmar', tw: 'Taiwan',
    hk: 'Hong Kong', nz: 'Selandia Baru', ch: 'Swiss', se: 'Swedia', no: 'Norwegia',
    fi: 'Finlandia', be: 'Belgia', pt: 'Portugal', eg: 'Mesir', ke: 'Kenya', gh: 'Ghana'
  };

  function getCountryName(tx) {
    var code = String((tx && (tx.country || tx.country_name)) || '').trim().toLowerCase();
    var supplied = String((tx && tx.country_name) || '').trim();
    if (supplied && supplied.toLowerCase() !== code) return supplied;
    if (COUNTRY_NAMES[code]) return COUNTRY_NAMES[code];
    if (/^[a-z]{2}$/i.test(code)) {
      try {
        var loc = new Intl.DisplayNames(['id'], { type: 'region' }).of(code.toUpperCase());
        return (loc && loc.toLowerCase() !== code) ? loc : '—';
      } catch (e) { return '—'; }
    }
    return supplied || '—';
  }

  async function loadUser(force) {
    var cached = !force ? Cache.get('user', cfg.ttl.user) : null;
    if (cached) renderUser(cached);

    try {
      var res = await fetchWithTimeout(cfg.ep.user, {
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
    var un = D.getElementById('userName');
    var gn = D.getElementById('greetingName');
    var ub = D.getElementById('userBalance');
    var bp = D.getElementById('balancePill');
    var ui = D.getElementById('userInitial');

    if (un) un.textContent = name;
    if (gn) gn.textContent = name;
    if (ub) ub.textContent = formatRupiah(user.balance);
    if (bp) bp.textContent = formatRupiah(user.balance);
    if (ui) ui.textContent = getInitial(name);

    var gl = D.getElementById('greetingLine');
    if (gl) gl.innerHTML = fillGreeting(name);

    if (user.user_code) {
      var uc = D.getElementById('userCode');
      var cc = D.getElementById('copyUserCode');
      if (uc) uc.textContent = user.user_code;
      if (cc) cc.style.display = 'inline-flex';
    }
  }

  var lastTxSig = '';
  var STATUS_MAP = {
    success:   { cls: 'success', label: 'Berhasil' },
    received:  { cls: 'success', label: 'Berhasil' },
    confirmed: { cls: 'success', label: 'Berhasil' },
    pending:   { cls: 'warning', label: 'Pending' },
    cancelled: { cls: 'danger',  label: 'Dibatalkan' },
    expired:   { cls: 'gray',    label: 'Kedaluwarsa' },
    failed:    { cls: 'danger',  label: 'Gagal' },
    refunded:  { cls: 'purple',  label: 'Refund' },
    error:     { cls: 'danger',  label: 'Error' }
  };

  function bindTxRows(tbody) {
    if (tbody.dataset.bound) return;
    tbody.dataset.bound = '1';

    function navigate(row) {
      var oid = row.dataset.orderId;
      if (oid) { try { SafeStorage.session.set('highlight_order_id', oid); } catch (e) {} }
      location.href = '/inbox';
    }

    tbody.addEventListener('click', function (e) {
      var row = e.target.closest('.tx-row');
      if (row) navigate(row);
    });
    tbody.addEventListener('touchstart', function (e) {
      var row = e.target.closest('.tx-row');
      if (!row) return;
      var t = e.changedTouches && e.changedTouches[0];
      if (t) { row._txX = t.clientX; row._txY = t.clientY; }
    }, { passive: true });
    tbody.addEventListener('touchend', function (e) {
      var row = e.target.closest('.tx-row');
      if (!row) return;
      if (e.changedTouches && e.changedTouches[0]) {
        var t = e.changedTouches[0];
        if (row._txX == null) return;
        var dx = Math.abs(t.clientX - row._txX);
        var dy = Math.abs(t.clientY - row._txY);
        if (dx < 10 && dy < 10) {
          e.preventDefault();
          navigate(row);
        }
      }
    }, { passive: false });
  }

  function renderOrders(data) {
    if (!data) return;

    var orders = data.orders || [];

    var total = Number(data.total) || orders.length;
    var success = 0, pending = 0, failed = 0;
    orders.forEach(function (o) {
      var s = String(o.status || '').toLowerCase();
      if (s === 'success' || s === 'received' || s === 'confirmed') success++;
      else if (s === 'pending') pending++;
      else if (s === 'cancelled' || s === 'expired' || s === 'failed' || s === 'error') failed++;
    });

    animateCounter(D.getElementById('statTotal'), total);
    animateCounter(D.getElementById('statSuccess'), success);
    animateCounter(D.getElementById('statPending'), pending);
    animateCounter(D.getElementById('statFailed'), failed);

    var tbody = D.getElementById('transactionsTable');
    if (!tbody) return;

    if (orders.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5">' +
        '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>' +
        '<strong>Belum ada transaksi</strong>' +
        '<span>Mulai beli nokos buat lihat riwayat</span>' +
        '</div></td></tr>';
      lastTxSig = '';
      return;
    }

    var sig = orders.map(function (o) {
      return [o.order_id || '', o.status || '', o.service_name || '', o.country || '', o.price || ''].join(':');
    }).join('|');

    if (sig === lastTxSig) return;
    lastTxSig = sig;

    tbody.innerHTML = orders.map(function (o) {
      var st = String(o.status || '').toLowerCase();
      var s = STATUS_MAP[st] || { cls: 'gray', label: escapeHtml(o.status || '—') };
      var cName = getCountryName(o);
      var oid = String(o.order_id || '').trim();
      return '<tr class="tx-row" data-order-id="' + escapeHtml(oid) + '" role="button" tabindex="0">' +
        '<td>' + formatTanggal(o.created_at) + '</td>' +
        '<td><div class="tx-service-cell"><div class="tx-app-icon">' + renderServiceIcon(o) + '</div><strong>' + escapeHtml(getServiceDisplayName(o)) + '</strong></div></td>' +
        '<td><div class="tx-country-cell">' + renderFlag(o.country, 'tx-flag') + '<span>' + escapeHtml(cName) + '</span></div></td>' +
        '<td>' + formatRupiah(o.price) + '</td>' +
        '<td><span class="badge ' + s.cls + '">' + s.label + '</span></td>' +
        '</tr>';
    }).join('');

    bindTxRows(tbody);

    qa('img[data-sources]', tbody).forEach(function (img) {
      if (img.dataset.bound) return;
      img.dataset.bound = '1';
      img.addEventListener('error', function () { window._handleFlagErr(this); });
    });
  }

  async function loadOrders(force) {
    var cached = !force ? Cache.get('orders', cfg.ttl.orders) : null;
    if (cached) renderOrders(cached);

    try {
      var res = await fetchWithTimeout(cfg.ep.orders + '?page=1&limit=5&status=nokos', {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (res.status === 401 || res.status === 403) { handleLogout(); return; }
      var data = await safeJson(res);
      if (data && !data.error) {
        Cache.set('orders', data);
        renderOrders(data);
      }
    } catch (e) {}
  }

  var lastRefundCheck = 0;

  async function checkRefunds(silent) {
    try {
      var res = await fetchWithTimeout(cfg.ep.refunds, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
      });
      if (!res.ok) return;
      var data = await safeJson(res);
      lastRefundCheck = Date.now();

      if (data.refunded && data.refunded.length > 0) {
        var total = data.refunded.reduce(function (s, r) { return s + (r.refunded_amount || 0); }, 0);
        var count = data.refunded.length;
        if (!silent) showRefundToast(total, count);

        if (data.new_balance != null) {
          var ub = D.getElementById('userBalance');
          var bp = D.getElementById('balancePill');
          if (ub) ub.textContent = formatRupiah(data.new_balance);
          if (bp) bp.textContent = formatRupiah(data.new_balance);
        } else {
          Cache.remove('user');
          loadUser(true);
        }

        lastTxSig = '';
        await loadOrders(true);
      }
    } catch (e) {}
  }

  async function handleLogout() {
    try {
      await fetchWithTimeout(cfg.ep.logout, {
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

  function bindEvents() {
    var refreshBtn = D.getElementById('refreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async function () {
        this.classList.add('spinning');
        lastTxSig = '';
        randomizeCopy();
        await Promise.all([checkRefunds(false), loadUser(true), loadOrders(true)]);
        var self = this;
        setTimeout(function () { self.classList.remove('spinning'); }, 500);
      });
    }

    var copyBtn = D.getElementById('copyUserCode');
    if (copyBtn) {
      copyBtn.addEventListener('click', async function () {
        var codeEl = D.getElementById('userCode');
        var code = codeEl ? codeEl.textContent : '';
        if (!code || code === '—') return;
        var ok = await copyToClipboard(code);
        if (!ok) return;
        var orig = copyBtn.innerHTML;
        copyBtn.innerHTML = ICONS.check + ' Copied!';
        setTimeout(function () { copyBtn.innerHTML = orig; }, 1500);
      });
    }

    var userCodeEl = D.getElementById('userCode');
    if (userCodeEl) {
      userCodeEl.setAttribute('data-copy', '');
      userCodeEl.addEventListener('click', async function () {
        var code = userCodeEl.textContent;
        if (!code || code === '—') return;
        var ok = await copyToClipboard(code);
        if (!ok) return;
        var orig = userCodeEl.textContent;
        userCodeEl.textContent = '✓ Tersalin!';
        setTimeout(function () { userCodeEl.textContent = orig; }, 1200);
      });
    }

    var logoutBtn = D.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async function () {
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
    }
  }

  var dashInterval = null;
  var refundInterval = null;

  function startAutoRefresh() {
    if (dashInterval) clearInterval(dashInterval);
    dashInterval = setInterval(function () {
      if (!D.hidden) loadOrders(false);
    }, cfg.refreshInterval);

    if (refundInterval) clearInterval(refundInterval);
    refundInterval = setInterval(function () {
      if (!D.hidden) checkRefunds(true);
    }, cfg.refundInterval);
  }

  function stopAutoRefresh() {
    if (dashInterval) { clearInterval(dashInterval); dashInterval = null; }
    if (refundInterval) { clearInterval(refundInterval); refundInterval = null; }
  }

  async function init() {
    randomizeCopy();
    bindEvents();
    await Promise.all([loadUser(false), loadOrders(false), checkRefunds(false)]);
    startAutoRefresh();
  }

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init);
  else init();

  D.addEventListener('visibilitychange', function () {
    if (D.hidden) {
      stopAutoRefresh();
    } else {
      loadOrders(false);
      if (Date.now() - lastRefundCheck > cfg.refundInterval) checkRefunds(true);
      startAutoRefresh();
    }
  });

  window.addEventListener('pagehide', stopAutoRefresh);
  window.addEventListener('beforeunload', stopAutoRefresh);

})(window);
