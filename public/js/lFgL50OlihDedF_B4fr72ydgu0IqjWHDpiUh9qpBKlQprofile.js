(function (global) {
'use strict';

// storage yang aman kalau localStorage diblokir (private mode, dsb)
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

// AES-GCM wrapper. fallback ke base64 obfuscation kalau subtle crypto gak ada.
var _crypto = (function () {
  var _k = 'cHJvZmlsZS1zZWNyZXQta2V5LTIwMjYtYXN5cm9m';
  var _s = 'c2FsdC1wcm9maWxlLXYyMDI2LXNlY3VyZQ==';
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
  return { seal: seal, unseal: unseal };
})();

// cache dua lapis: memori dulu, baru storage terenkripsi
var Cache = (function () {
  var P = 'aotp_p_';
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
  function clear() {
    _mem.clear();
    try { SafeStorage.local.keys().forEach(function (k) { if (k.indexOf(P) === 0) SafeStorage.local.remove(k); }); } catch (e) {}
  }
  return { get: get, set: set, remove: remove, clear: clear };
})();

var _cfg = {
  rk: '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg',
  ep: {
    user: '/api/user',
    updateName: '/api/user/update',
    changePassword: '/api/user/change-password',
    logout: '/api/auth/logout',
    orderStats: '/api/nokos/orders/stats',
    saldoActivity: '/api/user/saldo-activity'
  },
  ttl: { user: 5 * 60 * 1000, chart: 2 * 60 * 1000 },
  fetchTimeout: 12000
};

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
function formatRupiahShort(n) {
  var v = Number(n) || 0;
  if (v >= 1e9) return 'Rp' + (v / 1e9).toFixed(1) + 'M';
  if (v >= 1e6) return 'Rp' + (v / 1e6).toFixed(1) + 'jt';
  if (v >= 1e3) return 'Rp' + (v / 1e3).toFixed(0) + 'rb';
  return 'Rp' + v;
}
function getInitial(name) {
  return String(name || '?').trim().charAt(0).toUpperCase() || '?';
}
function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}
function fallbackCopy(text, onOk) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    var ok = document.execCommand('copy');
    if (ok && typeof onOk === 'function') onOk();
    document.body.removeChild(ta);
  } catch (e) {
    try { var t = document.querySelector('textarea[readonly]'); if (t) t.remove(); } catch (_) {}
  }
}
function copyToClipboard(text, btnEl, successHtml) {
  function onOk() {
    if (!btnEl) return;
    var orig = btnEl.innerHTML;
    btnEl.classList.add('copied');
    if (successHtml) btnEl.innerHTML = successHtml;
    setTimeout(function () {
      btnEl.classList.remove('copied');
      btnEl.innerHTML = orig;
    }, 1200);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onOk).catch(function () { fallbackCopy(text, onOk); });
  } else fallbackCopy(text, onOk);
}

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
  action = action || 'profile';
  var rc = await getRecaptchaToken(action);
  return fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(Object.assign({}, body, { recaptcha_token: rc }))
  });
}

// theme toggle. chart di-redraw karena warna stroke-nya hardcoded per theme
(function () {
  var btn = $('themeBtn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') || 'light';
    var nx = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nx);
    try { SafeStorage.local.set('asyrofotp_theme', nx); } catch (e) {}
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', nx === 'dark' ? '#0a0a0c' : '#0a84ff');
    if (state.chartOrder.data) drawChart('order', state.chartOrder.data);
    if (state.chartSaldo.data) drawChart('saldo', state.chartSaldo.data);
  });
})();

// collapse sidebar. persist state, skip kalau mobile
(function () {
  var sidebar = $('sidebar');
  var btn = $('collapseBtn');
  if (!sidebar || !btn) return;
  var isCollapsed = SafeStorage.local.get('sidebar_collapsed') === 'true';
  if (isCollapsed && window.innerWidth > 768) {
    sidebar.classList.add('collapsed');
    document.body.classList.add('sidebar-collapsed');
  }
  btn.addEventListener('click', function () {
    if (window.innerWidth <= 768) return;
    var c = sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed', c);
    try { SafeStorage.local.set('sidebar_collapsed', c); } catch (e) {}
  });
})();

// sidebar drawer mobile. debounce 300ms biar touchend+click gak double-fire
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
  user: null,
  chartOrder: { range: 7, data: null },
  chartSaldo: { range: 7, data: null }
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
      state.user = user;
      renderUser(user);
    }
  } catch (e) {}
}

function renderUser(user) {
  if (!user) return;
  var name = user.name || user.username || '—';
  var initial = getInitial(name);
  var bal = formatRupiah(user.balance);
  var set = function (id, txt) { var el = $(id); if (el) el.textContent = txt; };
  set('userName', name);
  set('userBalance', bal);
  set('userInitial', initial);
  set('balancePill', bal);
  set('profileAvatar', initial);
  set('profileName', name);
  set('profileUsername', '@' + (user.username || ''));
  set('infoUsername', '@' + (user.username || ''));
  set('infoName', user.name || '—');
  set('infoBalance', bal);
  set('statSaldoNow', bal);
  var inputName = $('inputName');
  if (inputName) inputName.value = user.name || '';
  if (user.user_code) {
    var code = String(user.user_code);
    var badge = $('profileCodeBadge');
    if (badge) badge.style.display = 'inline-flex';
    set('profileCodeText', code);
    set('infoUserCode', code);
    var copyBtn = $('btnCopyUserCode');
    if (copyBtn) copyBtn.style.display = 'inline-flex';
  }
}

var COLORS = {
  success: '#34c759',
  successGlow: 'rgba(52, 199, 89, 0.2)',
  danger: '#ff3b30',
  dangerGlow: 'rgba(255, 59, 48, 0.15)',
  primary: '#0a84ff',
  primaryGlow: 'rgba(10, 132, 255, 0.2)',
  grid: 'rgba(142, 142, 147, 0.15)',
  text: '#8e8e93'
};

// manual SVG chart. gak pakai lib biar bundle kecil.
function buildChartSVG(svgEl, series, opts) {
  opts = opts || {};
  if (!svgEl) return;
  var W = 800, H = 260;
  var padL = 50, padR = 20, padT = 20, padB = 30;
  var innerW = W - padL - padR;
  var innerH = H - padT - padB;
  var allValues = [];
  series.forEach(function (s) { s.points.forEach(function (p) { allValues.push(p.y); }); });
  if (allValues.length === 0) { svgEl.innerHTML = ''; return; }
  var minY = Math.min.apply(null, allValues);
  var maxY = Math.max.apply(null, allValues);
  if (minY === maxY) { maxY = minY + 1; minY = Math.max(0, minY - 1); }
  if (opts.allowNegative && minY > 0) minY = 0;
  if (opts.allowNegative && maxY < 0) maxY = 0;
  var rangeY = maxY - minY;
  var n = series[0].points.length;
  var stepX = n > 1 ? innerW / (n - 1) : innerW;

  function x(i) { return padL + i * stepX; }
  function y(v) { return padT + innerH - ((v - minY) / rangeY) * innerH; }

  function buildPath(points) {
    if (points.length === 0) return '';
    var d = '';
    points.forEach(function (p, i) {
      var px = x(i);
      var py = y(p.y);
      if (i === 0) d += 'M ' + px.toFixed(1) + ' ' + py.toFixed(1);
      else {
        var prev = points[i - 1];
        var prevX = x(i - 1);
        var prevY = y(prev.y);
        var cx1 = prevX + (px - prevX) / 3;
        var cy1 = prevY;
        var cx2 = px - (px - prevX) / 3;
        var cy2 = py;
        d += ' C ' + cx1.toFixed(1) + ' ' + cy1.toFixed(1) + ', ' + cx2.toFixed(1) + ' ' + cy2.toFixed(1) + ', ' + px.toFixed(1) + ' ' + py.toFixed(1);
      }
    });
    return d;
  }

  var gridLines = '';
  var gridCount = 4;
  for (var i = 0; i <= gridCount; i++) {
    var gy = padT + (innerH / gridCount) * i;
    var val = maxY - (rangeY / gridCount) * i;
    gridLines += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '" stroke="' + COLORS.grid + '" stroke-width="1" stroke-dasharray="4 4"/>';
    gridLines += '<text x="' + (padL - 8) + '" y="' + (gy + 4).toFixed(1) + '" fill="' + COLORS.text + '" font-size="10" font-family="JetBrains Mono, monospace" text-anchor="end">' + formatRupiahShort(val) + '</text>';
  }
  var xLabels = '';
  var xStep = Math.max(1, Math.floor(n / 6));
  for (var i2 = 0; i2 < n; i2 += xStep) {
    var px2 = x(i2);
    var p2 = series[0].points[i2];
    if (p2 && p2.label) {
      xLabels += '<text x="' + px2.toFixed(1) + '" y="' + (H - 8) + '" fill="' + COLORS.text + '" font-size="10" font-family="JetBrains Mono, monospace" text-anchor="middle">' + escapeHtml(p2.label) + '</text>';
    }
  }
  var seriesSVG = '';
  series.forEach(function (s) {
    var pathD = buildPath(s.points);
    if (!pathD) return;
    var areaD = pathD + ' L ' + x(n - 1).toFixed(1) + ' ' + (padT + innerH).toFixed(1) + ' L ' + x(0).toFixed(1) + ' ' + (padT + innerH).toFixed(1) + ' Z';
    seriesSVG +=
      '<defs><linearGradient id="grad-' + s.id + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + s.color + '" stop-opacity="0.3"/>' +
        '<stop offset="100%" stop-color="' + s.color + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<path d="' + areaD + '" fill="url(#grad-' + s.id + ')" />' +
      '<path d="' + pathD + '" fill="none" stroke="' + s.color + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />';
    s.points.forEach(function (p, i3) {
      var px3 = x(i3);
      var py3 = y(p.y);
      seriesSVG += '<circle cx="' + px3.toFixed(1) + '" cy="' + py3.toFixed(1) + '" r="3" fill="' + s.color + '" stroke="white" stroke-width="1.5"/>';
    });
  });
  svgEl.innerHTML = gridLines + xLabels + seriesSVG;
}

async function loadChartOrder(range, force) {
  range = range || 7;
  state.chartOrder.range = range;
  var svgEl = $('chartOrderSvg');
  var loading = $('chartOrderLoading');
  var empty = $('chartOrderEmpty');
  if (loading) loading.style.display = 'flex';
  if (empty) empty.style.display = 'none';
  if (svgEl) svgEl.innerHTML = '';
  var cacheKey = 'chart_order_' + range;
  if (!force) {
    var cached = await Cache.get(cacheKey, _cfg.ttl.chart);
    if (cached) {
      state.chartOrder.data = cached;
      renderChartOrder(cached);
      if (loading) loading.style.display = 'none';
      return;
    }
  }
  try {
    var res = await fetchWithTimeout(_cfg.ep.orderStats + '?range=' + range, {
      headers: { Authorization: 'Bearer ' + token }
    });
    var data = await safeJson(res);
    state.chartOrder.data = data;
    await Cache.set(cacheKey, data);
    renderChartOrder(data);
  } catch (err) {
    console.warn('Chart order error:', err);
    if (empty) empty.style.display = 'flex';
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

function renderChartOrder(data) {
  var svgEl = $('chartOrderSvg');
  var empty = $('chartOrderEmpty');
  if (!data || !data.labels || data.labels.length === 0) {
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';
  var labels = data.labels || [];
  var successArr = data.success || [];
  var failedArr = data.failed || [];
  var successPoints = labels.map(function (l, i) { return { y: successArr[i] || 0, label: l }; });
  var failedPoints = labels.map(function (l, i) { return { y: failedArr[i] || 0, label: l }; });
  buildChartSVG(svgEl, [
    { id: 'success', color: COLORS.success, points: successPoints },
    { id: 'failed', color: COLORS.danger, points: failedPoints }
  ]);
  var total = data.total || 0;
  var succ = successArr.reduce(function (a, b) { return a + b; }, 0);
  var fail = failedArr.reduce(function (a, b) { return a + b; }, 0);
  var rate = total > 0 ? Math.round((succ / total) * 100) : 0;
  var set = function (id, txt) { var el = $(id); if (el) el.textContent = txt; };
  set('statTotalOrders', total);
  set('statSuccessOrders', succ);
  set('statFailedOrders', fail);
  set('statSuccessRate', rate + '%');
}

async function loadChartSaldo(range, force) {
  range = range || 7;
  state.chartSaldo.range = range;
  var svgEl = $('chartSaldoSvg');
  var loading = $('chartSaldoLoading');
  var empty = $('chartSaldoEmpty');
  if (loading) loading.style.display = 'flex';
  if (empty) empty.style.display = 'none';
  if (svgEl) svgEl.innerHTML = '';
  var cacheKey = 'chart_saldo_' + range;
  if (!force) {
    var cached = await Cache.get(cacheKey, _cfg.ttl.chart);
    if (cached) {
      state.chartSaldo.data = cached;
      renderChartSaldo(cached);
      if (loading) loading.style.display = 'none';
      return;
    }
  }
  try {
    var res = await fetchWithTimeout(_cfg.ep.saldoActivity + '?range=' + range, {
      headers: { Authorization: 'Bearer ' + token }
    });
    var data = await safeJson(res);
    state.chartSaldo.data = data;
    await Cache.set(cacheKey, data);
    renderChartSaldo(data);
  } catch (err) {
    console.warn('Chart saldo error:', err);
    if (empty) empty.style.display = 'flex';
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

function renderChartSaldo(data) {
  var svgEl = $('chartSaldoSvg');
  var empty = $('chartSaldoEmpty');
  if (!data || !data.labels || data.labels.length === 0) {
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';
  var labels = data.labels || [];
  var balanceArr = data.balance || [];
  var points = labels.map(function (l, i) { return { y: balanceArr[i] || 0, label: l }; });
  buildChartSVG(svgEl, [{ id: 'balance', color: COLORS.primary, points: points }], { allowNegative: true });
  var totalIn = data.total_in || 0;
  var totalOut = data.total_out || 0;
  var now = balanceArr.length > 0 ? balanceArr[balanceArr.length - 1] : 0;
  var set = function (id, txt) { var el = $(id); if (el) el.textContent = txt; };
  set('statSaldoIn', formatRupiahShort(totalIn));
  set('statSaldoOut', formatRupiahShort(totalOut));
  set('statSaldoNow', formatRupiah(now));
}

// chart tab switcher (7/30/90 hari)
(function () {
  var tabsOrder = document.querySelectorAll('#chartOrderTabs .chart-tab');
  tabsOrder.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabsOrder.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      loadChartOrder(Number(tab.dataset.range), true);
    });
  });
  var tabsSaldo = document.querySelectorAll('#chartSaldoTabs .chart-tab');
  tabsSaldo.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabsSaldo.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      loadChartSaldo(Number(tab.dataset.range), true);
    });
  });
})();

function openModal(id) {
  var m = $(id);
  if (m) {
    m.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}
function closeModal(el) {
  if (!el) return;
  el.classList.remove('active');
  if (!document.querySelector('.modal-overlay.active')) document.body.style.overflow = '';
}

// modal wiring. esc + click luar = tutup
(function () {
  var btnEdit = $('btnEditName');
  if (btnEdit) btnEdit.addEventListener('click', function () { openModal('modalName'); });
  var btnPass = $('btnChangePassword');
  if (btnPass) btnPass.addEventListener('click', function () { openModal('modalPassword'); });

  document.querySelectorAll('[data-modal-close]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var m = btn.closest('.modal-overlay');
      if (m) closeModal(m);
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal(overlay);
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var a = document.querySelector('.modal-overlay.active');
      if (a) closeModal(a);
    }
  });
})();

// toggle password visibility
(function () {
  document.querySelectorAll('.password-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = $(btn.dataset.toggle);
      if (!input) return;
      var eo = btn.querySelector('.eye-open');
      var ec = btn.querySelector('.eye-closed');
      if (input.type === 'password') {
        input.type = 'text';
        if (eo) eo.style.display = 'none';
        if (ec) ec.style.display = 'block';
      } else {
        input.type = 'password';
        if (eo) eo.style.display = 'block';
        if (ec) ec.style.display = 'none';
      }
    });
  });
})();

// password strength meter. heuristik 0-4, bukan zxcvbn.
(function () {
  var input = $('inputNewPassword');
  var meter = $('pwdStrength');
  if (!input || !meter) return;
  var bars = meter.querySelectorAll('.pwd-strength-bar');
  input.addEventListener('input', function () {
    var v = input.value;
    var score = 0;
    if (v.length >= 6) score++;
    if (v.length >= 10) score++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
    if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
    score = Math.min(score, 4);
    bars.forEach(function (b, i) {
      b.className = 'pwd-strength-bar';
      if (i < score) {
        if (score <= 1) b.classList.add('weak');
        else if (score <= 2) b.classList.add('medium');
        else b.classList.add('strong');
      }
    });
  });
})();

function showAlert(id, message, type) {
  var el = $(id);
  if (!el) return;
  el.className = 'alert show ' + (type || 'error');
  var t = $(id + 'Text');
  if (t) t.textContent = message;
}
function hideAlert(id) {
  var el = $(id);
  if (el) el.classList.remove('show');
}

// form update nama
(function () {
  var form = $('formName');
  if (!form) return;
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideAlert('alertName');
    var name = ($('inputName').value || '').trim();
    var btn = $('btnSaveName');
    var orig = btn.innerHTML;
    if (!name) { showAlert('alertName', 'Nama tidak boleh kosong', 'error'); return; }
    if (name.length > 50) { showAlert('alertName', 'Nama maksimal 50 karakter', 'error'); return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span> Menyimpan...';
    try {
      var res = await securePost(_cfg.ep.updateName, { name: name }, 'update_profile');
      var data = await safeJson(res);
      if (!res.ok || data.error) throw new Error(data.error || 'Gagal menyimpan');
      showAlert('alertName', 'Nama berhasil diupdate!', 'success');
      var initial = getInitial(name);
      var set = function (id, txt) { var el = $(id); if (el) el.textContent = txt; };
      set('profileName', name);
      set('infoName', name);
      set('userName', name);
      set('profileAvatar', initial);
      set('userInitial', initial);
      Cache.remove('user');
      setTimeout(function () {
        closeModal($('modalName'));
        hideAlert('alertName');
      }, 1000);
    } catch (err) {
      showAlert('alertName', err.message || 'Gagal menyimpan', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });
})();

// form ganti password
(function () {
  var form = $('formPassword');
  if (!form) return;
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideAlert('alertPassword');
    var cur = $('inputOldPassword').value;
    var np = $('inputNewPassword').value;
    var np2 = $('inputNewPassword2').value;
    var btn = $('btnSavePassword');
    var orig = btn.innerHTML;
    if (!cur) { showAlert('alertPassword', 'Password lama wajib diisi', 'error'); return; }
    if (np.length < 6) { showAlert('alertPassword', 'Password baru minimal 6 karakter', 'error'); return; }
    if (np !== np2) { showAlert('alertPassword', 'Konfirmasi password tidak cocok', 'error'); return; }
    if (np === cur) { showAlert('alertPassword', 'Password baru harus beda dengan yang lama', 'error'); return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span> Menyimpan...';
    try {
      var res = await securePost(_cfg.ep.changePassword, { current_password: cur, new_password: np }, 'change_password');
      var data = await safeJson(res);
      if (!res.ok || data.error) throw new Error(data.error || 'Gagal mengubah password');
      showAlert('alertPassword', 'Password berhasil diubah!', 'success');
      form.reset();
      document.querySelectorAll('#pwdStrength .pwd-strength-bar').forEach(function (b) { b.className = 'pwd-strength-bar'; });
      setTimeout(function () {
        closeModal($('modalPassword'));
        hideAlert('alertPassword');
      }, 1200);
    } catch (err) {
      showAlert('alertPassword', err.message || 'Gagal mengubah password', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });
})();

// tombol copy user code (badge + inline)
(function () {
  var badge = $('profileCodeBadge');
  if (badge) {
    badge.addEventListener('click', function () {
      var code = $('profileCodeText').textContent;
      if (!code || code === '—') return;
      copyToClipboard(code, badge, '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!');
    });
  }
  var copyBtn = $('btnCopyUserCode');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var code = $('infoUserCode').textContent;
      if (!code || code === '—') return;
      copyToClipboard(code, copyBtn, '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>');
    });
  }
})();

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

(function () {
  var btn = $('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    if (window.confirm('Yakin mau keluar dari akun ini?')) handleLogout();
  });
})();

function init() {
  loadUser(false);
  loadChartOrder(7, false);
  loadChartSaldo(7, false);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
document.addEventListener('visibilitychange', function () {
  if (!document.hidden) loadUser(false);
});

})(window);
