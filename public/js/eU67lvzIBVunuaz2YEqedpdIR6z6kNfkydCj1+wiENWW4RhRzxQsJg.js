(function (global) {
  'use strict';
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
  const Cache = (() => {
    const P = 'aotp_p_';
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
        const e = JSON.parse(raw);
        if (!e) return null;
        if (ttl && Date.now() - e.t > ttl) { SafeStorage.local.remove(P + key); return null; }
        _mem.set(key, e);
        return e.v;
      } catch(err) { return null; }
    }
    async function set(key, v) {
      const e = { t: Date.now(), v };
      _mem.set(key, e);
      try {
        SafeStorage.local.set(P + key, JSON.stringify(e));
      } catch(err) {}
    }
    function remove(key) {
      _mem.delete(key);
      try { SafeStorage.local.remove(P + key); } catch(e) {}
    }
    function clear() {
      _mem.clear();
      try { SafeStorage.local.keys().forEach(k => { if (k.startsWith(P)) SafeStorage.local.remove(k); }); } catch(e) {}
    }
    return { get, set, remove, clear };
  })();
  const _cfg = {
    rk: '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg',
    ep: {
      user: '/api/user',
      updateName: '/api/user/update',
      changePassword: '/api/user/change-password',
      logout: '/api/auth/logout',
      orderStats: '/api/nokos/orders/stats',
      saldoActivity: '/api/user/saldo-activity',
    },
    ttl: {
      user: 5 * 60 * 1000,
      chart: 2 * 60 * 1000,
    },
    fetchTimeout: 12000,
  };
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
  let token = null;
  try { token = SafeStorage.local.get('access_token'); } catch(e) { token = null; }
  if (!token) { location.href = '/login'; return; }
  function $(id) { return document.getElementById(id); }
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
  function formatRupiahShort(n) {
    const v = Number(n) || 0;
    if (v >= 1e9) return 'Rp' + (v / 1e9).toFixed(1) + 'M';
    if (v >= 1e6) return 'Rp' + (v / 1e6).toFixed(1) + 'jt';
    if (v >= 1e3) return 'Rp' + (v / 1e3).toFixed(0) + 'rb';
    return 'Rp' + v;
  }
  function getInitial(name) {
    return String(name || '?').trim().charAt(0).toUpperCase() || '?';
  }
  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }
  function copyToClipboard(text, btnEl, successHtml) {
    const onOk = () => {
      if (!btnEl) return;
      const orig = btnEl.innerHTML;
      btnEl.classList.add('copied');
      if (successHtml) btnEl.innerHTML = successHtml;
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
    } catch(e) {
      try { const t = document.querySelector('textarea[readonly]'); if (t) t.remove(); } catch(_) {}
    }
  }
  function waitForRecaptcha() {
    return new Promise((resolve) => {
      if (window.grecaptcha && window.grecaptcha.execute) return resolve();
      let n = 0;
      const t = setInterval(() => {
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
      return await new Promise((resolve) => {
        grecaptcha.ready(() => {
          grecaptcha.execute(_cfg.rk, { action }).then(resolve).catch(() => resolve(null));
        });
        setTimeout(() => resolve(null), 8000);
      });
    } catch(e) { return null; }
  }
  async function securePost(url, body = {}, action = 'profile') {
    const rc = await getRecaptchaToken(action);
    return fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ ...body, recaptcha_token: rc }),
    });
  }
  (function () {
    const btn = $('themeBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      const nx = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nx);
      try { SafeStorage.local.set('asyrofotp_theme', nx); } catch(e) {}
      const m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', nx === 'dark' ? '#0a0a0c' : '#0a84ff');
      // Re-render charts with new theme colors
      if (state.chartOrder.data) drawChart('order', state.chartOrder.data);
      if (state.chartSaldo.data) drawChart('saldo', state.chartSaldo.data);
    });
  })();
  (function () {
    const sidebar = $('sidebar');
    const btn = $('collapseBtn');
    if (!sidebar || !btn) return;
    const isCollapsed = SafeStorage.local.get('sidebar_collapsed') === 'true';
    if (isCollapsed && window.innerWidth > 768) {
      sidebar.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    }
    btn.addEventListener('click', () => {
      if (window.innerWidth <= 768) return;
      const c = sidebar.classList.toggle('collapsed');
      document.body.classList.toggle('sidebar-collapsed', c);
      try { SafeStorage.local.set('sidebar_collapsed', c); } catch(e) {}
    });
  })();
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
      rt = setTimeout(() => { if (window.innerWidth > 768 && open) closeSb(); }, 150);
    });
  })();
  const state = {
    user: null,
    chartOrder: { range: 7, data: null },
    chartSaldo: { range: 7, data: null },
  };
  let avatarModules;
  let currentAvatar;
  let avatarSeed;
  function getAvatarModules() {
    if (!avatarModules) {
      avatarModules = Promise.all([
        import('https://esm.sh/@dicebear/core@10.7.0'),
        import('https://esm.sh/@dicebear/styles@10.7.0/lorelei.json'),
        import('https://esm.sh/@dicebear/converter@10.7.0'),
      ]).then(([core, styleModule, converter]) => ({
        Avatar: core.Avatar,
        Style: core.Style,
        style: new core.Style(styleModule.default || styleModule),
        toPng: converter.toPng,
      }));
    }
    return avatarModules;
  }
  async function renderAvatar(user) {
    const seed = String(user.user_code || user.username || 'asyrofotp-user');
    avatarSeed = seed;
    try {
      const { Avatar, style } = await getAvatarModules();
      const avatar = new Avatar(style, { seed, size: 160, backgroundColor: ['#e8f3ff'] });
      if (avatarSeed !== seed) return;
      currentAvatar = avatar;
      const source = avatar.toDataUri();
      ['profileAvatar', 'userInitial'].forEach((id) => {
        const target = $(id);
        if (!target) return;
        const image = document.createElement('img');
        image.src = source;
        image.alt = 'Avatar ' + String(user.username || 'pengguna');
        image.width = id === 'profileAvatar' ? 112 : 40;
        image.height = image.width;
        image.decoding = 'async';
        image.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;border-radius:inherit';
        target.replaceChildren(image);
      });
      const download = $('downloadAvatarBtn');
      if (download) download.disabled = false;
      const status = $('avatarStatus');
      if (status) status.textContent = 'Avatar konsisten dibuat di perangkat ini dengan DiceBear.';
    } catch (error) {
      const status = $('avatarStatus');
      if (status) status.textContent = 'Avatar ilustrasi tidak tersedia. Inisial akun tetap digunakan.';
    }
  }
  (function bindAvatarDownload() {
    const button = $('downloadAvatarBtn');
    if (!button) return;
    button.addEventListener('click', async () => {
      if (!currentAvatar || button.disabled) return;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Menyiapkan PNG…';
      try {
        const { toPng } = await getAvatarModules();
        const png = await toPng(currentAvatar, { size: 512 }).toDataUri();
        const link = document.createElement('a');
        link.href = png;
        link.download = 'avatar-' + String(avatarSeed).replace(/[^a-z0-9_-]/gi, '-') + '.png';
        link.click();
      } catch (error) {
        const status = $('avatarStatus');
        if (status) status.textContent = 'PNG gagal dibuat. Coba lagi setelah koneksi tersedia.';
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    });
  })();
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
        state.user = user;
        renderUser(user);
      }
    } catch(e) {}
  }
  function renderUser(user) {
    if (!user) return;
    const name = user.name || user.username || '—';
    const initial = getInitial(name);
    const bal = formatRupiah(user.balance);
    const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    set('userName', name);
    set('userBalance', bal);
    set('userInitial', initial);
    set('balancePill', bal);
    set('profileAvatar', initial);
    renderAvatar(user);
    set('profileName', name);
    set('profileUsername', '@' + (user.username || ''));
    set('infoUsername', '@' + (user.username || ''));
    set('infoName', user.name || '—');
    set('infoBalance', bal);
    set('statSaldoNow', bal);
    const inputName = $('inputName');
    if (inputName) inputName.value = user.name || '';
    if (user.user_code) {
      const code = String(user.user_code);
      const badge = $('profileCodeBadge');
      if (badge) badge.style.display = 'inline-flex';
      set('profileCodeText', code);
      set('infoUserCode', code);
      const copyBtn = $('btnCopyUserCode');
      if (copyBtn) copyBtn.style.display = 'inline-flex';
    }
  }
  const COLORS = {
    success: '#34c759',
    successGlow: 'rgba(52, 199, 89, 0.2)',
    danger: '#ff3b30',
    dangerGlow: 'rgba(255, 59, 48, 0.15)',
    primary: '#0a84ff',
    primaryGlow: 'rgba(10, 132, 255, 0.2)',
    grid: 'rgba(142, 142, 147, 0.15)',
    text: '#8e8e93',
  };
  function buildChartSVG(svgEl, series, opts = {}) {
    if (!svgEl) return;
    const W = 800, H = 260;
    const padL = 50, padR = 20, padT = 20, padB = 30;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    let allValues = [];
    series.forEach(s => {
      s.points.forEach(p => allValues.push(p.y));
    });
    if (allValues.length === 0) { svgEl.innerHTML = ''; return; }
    let minY = Math.min(...allValues);
    let maxY = Math.max(...allValues);
    if (minY === maxY) { maxY = minY + 1; minY = Math.max(0, minY - 1); }
    if (opts.allowNegative && minY > 0) minY = 0;
    if (opts.allowNegative && maxY < 0) maxY = 0;
    const rangeY = maxY - minY;
    const n = series[0].points.length;
    const stepX = n > 1 ? innerW / (n - 1) : innerW;
    function x(i) { return padL + i * stepX; }
    function y(v) { return padT + innerH - ((v - minY) / rangeY) * innerH; }
    function buildPath(points) {
      if (points.length === 0) return '';
      let d = '';
      points.forEach((p, i) => {
        const px = x(i);
        const py = y(p.y);
        if (i === 0) d += `M ${px.toFixed(1)} ${py.toFixed(1)}`;
        else {
          const prev = points[i - 1];
          const prevX = x(i - 1);
          const prevY = y(prev.y);
          const cx1 = prevX + (px - prevX) / 3;
          const cy1 = prevY;
          const cx2 = px - (px - prevX) / 3;
          const cy2 = py;
          d += ` C ${cx1.toFixed(1)} ${cy1.toFixed(1)}, ${cx2.toFixed(1)} ${cy2.toFixed(1)}, ${px.toFixed(1)} ${py.toFixed(1)}`;
        }
      });
      return d;
    }
    let gridLines = '';
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const gy = padT + (innerH / gridCount) * i;
      const val = maxY - (rangeY / gridCount) * i;
      gridLines += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="${COLORS.grid}" stroke-width="1" stroke-dasharray="4 4"/>`;
      gridLines += `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" fill="${COLORS.text}" font-size="10" font-family="JetBrains Mono, monospace" text-anchor="end">${formatRupiahShort(val)}</text>`;
    }
    let xLabels = '';
    const xStep = Math.max(1, Math.floor(n / 6));
    for (let i = 0; i < n; i += xStep) {
      const px = x(i);
      const p = series[0].points[i];
      if (p && p.label) {
        xLabels += `<text x="${px.toFixed(1)}" y="${H - 8}" fill="${COLORS.text}" font-size="10" font-family="JetBrains Mono, monospace" text-anchor="middle">${escapeHtml(p.label)}</text>`;
      }
    }
    let seriesSVG = '';
    series.forEach(s => {
      const pathD = buildPath(s.points);
      if (!pathD) return;
      const areaD = pathD + ` L ${x(n - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} L ${x(0).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;
      seriesSVG += `
        <defs>
          <linearGradient id="grad-${s.id}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${s.color}" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="${s.color}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${areaD}" fill="url(#grad-${s.id})" />
        <path d="${pathD}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      `;
      s.points.forEach((p, i) => {
        const px = x(i);
        const py = y(p.y);
        seriesSVG += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3" fill="${s.color}" stroke="white" stroke-width="1.5"/>`;
      });
    });

    svgEl.innerHTML = gridLines + xLabels + seriesSVG;
  }
  async function loadChartOrder(range = 7, force = false) {
    state.chartOrder.range = range;
    const svgEl = $('chartOrderSvg');
    const loading = $('chartOrderLoading');
    const empty = $('chartOrderEmpty');
    if (loading) loading.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    if (svgEl) svgEl.innerHTML = '';
    const cacheKey = `chart_order_${range}`;
    if (!force) {
      const cached = await Cache.get(cacheKey, _cfg.ttl.chart);
      if (cached) {
        state.chartOrder.data = cached;
        renderChartOrder(cached);
        if (loading) loading.style.display = 'none';
        return;
      }
    }
    try {
      const res = await fetchWithTimeout(`${_cfg.ep.orderStats}?range=${range}`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await safeJson(res);
      state.chartOrder.data = data;
      await Cache.set(cacheKey, data);
      renderChartOrder(data);
    } catch(err) {
      console.warn('Chart order error:', err);
      // Fallback: empty
      if (empty) empty.style.display = 'flex';
    } finally {
      if (loading) loading.style.display = 'none';
    }
  }
  function renderChartOrder(data) {
    const svgEl = $('chartOrderSvg');
    const empty = $('chartOrderEmpty');
    if (!data || !data.labels || data.labels.length === 0) {
      if (empty) empty.style.display = 'flex';
      return;
    }
    if (empty) empty.style.display = 'none';
    const labels = data.labels || [];
    const successArr = data.success || [];
    const failedArr = data.failed || [];
    const successPoints = labels.map((l, i) => ({ y: successArr[i] || 0, label: l }));
    const failedPoints = labels.map((l, i) => ({ y: failedArr[i] || 0, label: l }));
    buildChartSVG(svgEl, [
      { id: 'success', color: COLORS.success, points: successPoints },
      { id: 'failed', color: COLORS.danger, points: failedPoints },
    ]);
    const total = (data.total || 0);
    const succ = successArr.reduce((a, b) => a + b, 0);
    const fail = failedArr.reduce((a, b) => a + b, 0);
    const rate = total > 0 ? Math.round((succ / total) * 100) : 0;
    const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    set('statTotalOrders', total);
    set('statSuccessOrders', succ);
    set('statFailedOrders', fail);
    set('statSuccessRate', rate + '%');
  }
  async function loadChartSaldo(range = 7, force = false) {
    state.chartSaldo.range = range;
    const svgEl = $('chartSaldoSvg');
    const loading = $('chartSaldoLoading');
    const empty = $('chartSaldoEmpty');
    if (loading) loading.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    if (svgEl) svgEl.innerHTML = '';
    const cacheKey = `chart_saldo_${range}`;
    if (!force) {
      const cached = await Cache.get(cacheKey, _cfg.ttl.chart);
      if (cached) {
        state.chartSaldo.data = cached;
        renderChartSaldo(cached);
        if (loading) loading.style.display = 'none';
        return;
      }
    }
    try {
      const res = await fetchWithTimeout(`${_cfg.ep.saldoActivity}?range=${range}`, {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await safeJson(res);
      state.chartSaldo.data = data;
      await Cache.set(cacheKey, data);
      renderChartSaldo(data);
    } catch(err) {
      console.warn('Chart saldo error:', err);
      if (empty) empty.style.display = 'flex';
    } finally {
      if (loading) loading.style.display = 'none';
    }
  }
  function renderChartSaldo(data) {
    const svgEl = $('chartSaldoSvg');
    const empty = $('chartSaldoEmpty');
    if (!data || !data.labels || data.labels.length === 0) {
      if (empty) empty.style.display = 'flex';
      return;
    }
    if (empty) empty.style.display = 'none';
    const labels = data.labels || [];
    const balanceArr = data.balance || [];
    const points = labels.map((l, i) => ({ y: balanceArr[i] || 0, label: l }));
    buildChartSVG(svgEl, [
      { id: 'balance', color: COLORS.primary, points: points },
    ], { allowNegative: true });
    const totalIn = data.total_in || 0;
    const totalOut = data.total_out || 0;
    const now = balanceArr.length > 0 ? balanceArr[balanceArr.length - 1] : 0;
    const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    set('statSaldoIn', formatRupiahShort(totalIn));
    set('statSaldoOut', formatRupiahShort(totalOut));
    set('statSaldoNow', formatRupiah(now));
  }
  (function () {
    const tabsOrder = document.querySelectorAll('#chartOrderTabs .chart-tab');
    tabsOrder.forEach(tab => {
      tab.addEventListener('click', () => {
        tabsOrder.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        loadChartOrder(Number(tab.dataset.range), true);
      });
    });
    const tabsSaldo = document.querySelectorAll('#chartSaldoTabs .chart-tab');
    tabsSaldo.forEach(tab => {
      tab.addEventListener('click', () => {
        tabsSaldo.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        loadChartSaldo(Number(tab.dataset.range), true);
      });
    });
  })();
  function openModal(id) {
    const m = $(id);
    if (m) {
      m.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }
  function closeModal(el) {
    if (!el) return;
    el.classList.remove('active');
    if (!document.querySelector('.modal-overlay.active')) {
      document.body.style.overflow = '';
    }
  }
  (function () {
    const btnEdit = $('btnEditName');
    if (btnEdit) btnEdit.addEventListener('click', () => openModal('modalName'));
    const btnPass = $('btnChangePassword');
    if (btnPass) btnPass.addEventListener('click', () => openModal('modalPassword'));

    document.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.closest('.modal-overlay');
        if (m) closeModal(m);
      });
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal(overlay);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const a = document.querySelector('.modal-overlay.active');
        if (a) closeModal(a);
      }
    });
  })();
  (function () {
    document.querySelectorAll('.password-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = $(btn.dataset.toggle);
        if (!input) return;
        const eo = btn.querySelector('.eye-open');
        const ec = btn.querySelector('.eye-closed');
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
  (function () {
    const input = $('inputNewPassword');
    const meter = $('pwdStrength');
    if (!input || !meter) return;
    const bars = meter.querySelectorAll('.pwd-strength-bar');
    input.addEventListener('input', () => {
      const v = input.value;
      let score = 0;
      if (v.length >= 6) score++;
      if (v.length >= 10) score++;
      if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
      if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
      score = Math.min(score, 4);
      bars.forEach((b, i) => {
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
    const el = $(id);
    if (!el) return;
    el.className = 'alert show ' + (type || 'error');
    const t = $(id + 'Text');
    if (t) t.textContent = message;
  }
  function hideAlert(id) {
    const el = $(id);
    if (el) el.classList.remove('show');
  }
  (function () {
    const form = $('formName');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert('alertName');
      const name = ($('inputName').value || '').trim();
      const btn = $('btnSaveName');
      const orig = btn.innerHTML;
      if (!name) { showAlert('alertName', 'Nama tidak boleh kosong', 'error'); return; }
      if (name.length > 50) { showAlert('alertName', 'Nama maksimal 50 karakter', 'error'); return; }
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-sm"></span> Menyimpan...';
      try {
        const res = await securePost(_cfg.ep.updateName, { name }, 'update_profile');
        const data = await safeJson(res);
        if (!res.ok || data.error) throw new Error(data.error || 'Gagal menyimpan');
        showAlert('alertName', 'Nama berhasil diupdate!', 'success');
        const initial = getInitial(name);
        const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
        set('profileName', name);
        set('infoName', name);
        set('userName', name);
        set('profileAvatar', initial);
        set('userInitial', initial);
        Cache.remove('user');
        setTimeout(() => {
          closeModal($('modalName'));
          hideAlert('alertName');
        }, 1000);
      } catch(err) {
        showAlert('alertName', err.message || 'Gagal menyimpan', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });
  })();
  (function () {
    const form = $('formPassword');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert('alertPassword');
      const cur = $('inputOldPassword').value;
      const np = $('inputNewPassword').value;
      const np2 = $('inputNewPassword2').value;
      const btn = $('btnSavePassword');
      const orig = btn.innerHTML;
      if (!cur) { showAlert('alertPassword', 'Password lama wajib diisi', 'error'); return; }
      if (np.length < 6) { showAlert('alertPassword', 'Password baru minimal 6 karakter', 'error'); return; }
      if (np !== np2) { showAlert('alertPassword', 'Konfirmasi password tidak cocok', 'error'); return; }
      if (np === cur) { showAlert('alertPassword', 'Password baru harus beda dengan yang lama', 'error'); return; }
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-sm"></span> Menyimpan...';
      try {
        const res = await securePost(_cfg.ep.changePassword, { current_password: cur, new_password: np }, 'change_password');
        const data = await safeJson(res);
        if (!res.ok || data.error) throw new Error(data.error || 'Gagal mengubah password');
        showAlert('alertPassword', 'Password berhasil diubah!', 'success');
        form.reset();
        document.querySelectorAll('#pwdStrength .pwd-strength-bar').forEach(b => b.className = 'pwd-strength-bar');
        setTimeout(() => {
          closeModal($('modalPassword'));
          hideAlert('alertPassword');
        }, 1200);
      } catch(err) {
        showAlert('alertPassword', err.message || 'Gagal mengubah password', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = orig;
      }
    });
  })();
  (function () {
    const badge = $('profileCodeBadge');
    if (badge) {
      badge.addEventListener('click', function () {
        const code = $('profileCodeText').textContent;
        if (!code || code === '—') return;
        copyToClipboard(code, badge, '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!');
      });
    }
    const copyBtn = $('btnCopyUserCode');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        const code = $('infoUserCode').textContent;
        if (!code || code === '—') return;
        copyToClipboard(code, copyBtn, '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>');
      });
    }
  })();
  async function handleLogout() {
    try {
      await fetchWithTimeout(_cfg.ep.logout, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
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
  (function () {
    const btn = $('logoutBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadUser(false);
    }
  });
  function _cleanup() {}
  window.addEventListener('pagehide', _cleanup);
  window.addEventListener('beforeunload', _cleanup);

})(window);

