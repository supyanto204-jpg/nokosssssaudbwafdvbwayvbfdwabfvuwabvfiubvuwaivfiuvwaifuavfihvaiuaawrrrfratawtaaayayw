(function (global) {
'use strict';

var SafeStorage = (function () {
  var ls = null, ss = null;
  try { ls = window.localStorage; ls.setItem('__t','1'); ls.removeItem('__t'); } catch (e) { ls = null; }
  try { ss = window.sessionStorage; ss.setItem('__t','1'); ss.removeItem('__t'); } catch (e) { ss = null; }
  var mem = new Map();
  function wrap(store) {
    return {
      get: function (k) { try { return store ? store.getItem(k) : (mem.has(k) ? mem.get(k) : null); } catch (e) { return mem.has(k) ? mem.get(k) : null; } },
      set: function (k, v) { try { if (store) store.setItem(k, v); else mem.set(k, v); } catch (e) { mem.set(k, v); } },
      remove: function (k) { try { if (store) store.removeItem(k); else mem.delete(k); } catch (e) { mem.delete(k); } }
    };
  }
  return { local: wrap(ls), session: wrap(ss) };
})();

var Cache = (function () {
  var P = 'aotp_p_';
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
      if (ttl && Date.now() - parsed.t > ttl) { SafeStorage.local.remove(P + key); return null; }
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

var _cfg = {
  rk: '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg',
  ep: {
    user: '/api/user',
    updateName: '/api/user/update',
    changePassword: '/api/user/change-password',
    linkEmail: '/api/user/link-email',
    logout: '/api/auth/logout',
    orderStats: '/api/nokos/orders/stats',
    saldoActivity: '/api/user/saldo-activity'
  },
  ttl: { user: 5 * 60 * 1000, chart: 2 * 60 * 1000 },
  fetchTimeout: 12000
};

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

function formatRupiah(n) { return 'Rp' + (Number(n) || 0).toLocaleString('id-ID'); }
function formatRupiahShort(n) {
  var v = Number(n) || 0;
  if (v >= 1e9) return 'Rp' + (v / 1e9).toFixed(1) + 'M';
  if (v >= 1e6) return 'Rp' + (v / 1e6).toFixed(1) + 'jt';
  if (v >= 1e3) return 'Rp' + (v / 1e3).toFixed(0) + 'rb';
  return 'Rp' + v;
}
function getInitial(name) { return String(name || '?').trim().charAt(0).toUpperCase() || '?'; }
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

function lockBody() {
  var sw = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.setProperty('--scrollbar-width', sw + 'px');
  document.body.classList.add('modal-open');
}
function unlockBody() {
  if (!document.querySelector('.modal-overlay.active')) {
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('--scrollbar-width');
  }
}

(function themeInit() {
  var btn = $('themeBtn');
  if (!btn) return;
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function resolve(pref) {
    if (pref === 'system') return (mq && mq.matches) ? 'dark' : 'light';
    return pref;
  }
  function paintMeta(theme) {
    var m = document.querySelector('meta[name="theme-color"]');
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
  var sidebar = $('sidebar');
  var collapseBtn = $('collapseBtn');
  if (!sidebar || !collapseBtn) return;
  if (SafeStorage.local.get('sidebar_collapsed') === 'true' && window.innerWidth > 768) {
    sidebar.classList.add('collapsed');
    document.body.classList.add('sidebar-collapsed');
  }
  collapseBtn.addEventListener('click', function () {
    if (window.innerWidth <= 768) return;
    var c = sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed', c);
    SafeStorage.local.set('sidebar_collapsed', c ? 'true' : 'false');
  });
})();

(function mobileSidebarInit() {
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
    lockBody();
  }
  function closeSb() {
    if (!open) return;
    open = false;
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    document.body.classList.remove('sidebar-open');
    unlockBody();
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

  var emailEl = $('infoEmail');
  if (emailEl) {
    if (user.email) {
      emailEl.innerHTML = '<span>' + escapeHtml(user.email) + '</span>';
    } else {
      emailEl.innerHTML = '<button class="btn btn-primary" id="btnLinkEmail" type="button" style="padding:4px 12px;font-size:0.75rem;min-height:32px;background:var(--surface-2);color:var(--warn);border-color:var(--border);">Tautkan Email</button>';
      var btnLink = $('btnLinkEmail');
      if (btnLink) {
        btnLink.addEventListener('click', function() { openModal('modalEmail'); });
      }
    }
  }

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

function openModal(id) {
  var m = $(id);
  if (m) {
    m.classList.add('active');
    lockBody();
  }
}
function closeModal(el) {
  if (!el) return;
  el.classList.remove('active');
  unlockBody();
}

(function modalInit() {
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

(function pwdToggleInit() {
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

(function pwdStrengthInit() {
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

(function formNameInit() {
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

(function formPasswordInit() {
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

(function formEmailInit() {
  var form = $('formEmail');
  if (!form) return;
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideAlert('alertEmail');
    var email = ($('inputEmail').value || '').trim();
    var btn = $('btnSaveEmail');
    var orig = btn.innerHTML;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showAlert('alertEmail', 'Format email tidak valid', 'error');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-sm"></span> Menautkan...';
    try {
      var res = await securePost(_cfg.ep.linkEmail, { email: email }, 'link_email');
      var data = await safeJson(res);
      if (!res.ok || data.error) throw new Error(data.error || 'Gagal menautkan email');
      showAlert('alertEmail', 'Email berhasil ditautkan!', 'success');
      setTimeout(function () {
        closeModal($('modalEmail'));
        hideAlert('alertEmail');
        Cache.remove('user');
        loadUser(true);
      }, 1200);
    } catch (err) {
      showAlert('alertEmail', err.message || 'Gagal menautkan email', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });
})();

(function copyInit() {
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
  SafeStorage.local.remove('access_token');
  SafeStorage.local.remove('user');
  SafeStorage.local.remove('refresh_token');
  location.href = '/landing';
}

(function logoutInit() {
  var btn = $('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    if (window.confirm('Yakin mau keluar dari akun ini?')) handleLogout();
  });
})();

function init() {
  loadUser(false);
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
