/* ============================================
   DASHBOARD.JS — Logic halaman Dashboard
   v3 — split dari HTML, inisial app, DevTools friendly
   ============================================ */

(function() {
    'use strict';

    /* ============================================
       SECURITY WARNING (soft)
       ============================================ */
    (function() {
        try {
            console.log('%c⚠️ STOP!', 'color:#dc2626;font-size:20px;font-weight:900;');
            console.log('%cIni fitur browser untuk developer. Kalau ada yang menyuruh kamu paste sesuatu di sini, itu SCAM.', 'color:#64748b;font-size:12px;');
            console.log('%cJangan pernah share password, token, atau data pribadi di sini.', 'color:#64748b;font-size:12px;');
        } catch (e) {}
    })();

    /* Blokir context menu & shortcut berbahaya (soft) */
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => {
        const k = e.key;
        if (e.ctrlKey && e.shiftKey && ['I','J','C','i','j','c'].includes(k)) {
            // DevTools dibolehkan
            return;
        }
        if (e.ctrlKey && ['U','u'].includes(k)) {
            e.preventDefault();
        }
    }, true);

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
        const cleanUrl = window.location.origin + window.location.pathname;
        if (window.location.search) history.replaceState(null, '', cleanUrl);
    } catch (e) {}

    /* ============================================
       HELPERS — guard untuk main.js
       ============================================ */
    function safeJson(res) {
        if (typeof window.safeJson === 'function') return window.safeJson(res);
        return res.json().catch(() => ({}));
    }
    function formatRupiah(n) {
        if (typeof window.formatRupiah === 'function') return window.formatRupiah(n);
        return 'Rp' + (Number(n) || 0).toLocaleString('id-ID');
    }
    function getInitial(name) {
        if (typeof window.getInitial === 'function') return window.getInitial(name);
        return String(name || '?').trim().charAt(0).toUpperCase() || '?';
    }
    function swrFetch(url, key, cb) {
        if (typeof window.swrFetch === 'function') return window.swrFetch(url, key, cb);
        fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
            .then(r => r.ok ? r.json() : null)
            .then(d => cb && cb(d))
            .catch(() => {});
    }
    function CacheManagerGet(key) {
        if (window.CacheManager && window.CacheManager.get) return window.CacheManager.get(key);
        return null;
    }
    function CacheManagerSet(key, value, ttl) {
        if (window.CacheManager && window.CacheManager.set) return window.CacheManager.set(key, value, ttl);
    }
    function CacheManagerRemove(key) {
        if (window.CacheManager && window.CacheManager.remove) return window.CacheManager.remove(key);
    }
    function CacheManagerClear() {
        if (window.CacheManager && window.CacheManager.clear) return window.CacheManager.clear();
    }

    function formatTanggal(iso) {
        if (typeof window.formatTanggal === 'function') return window.formatTanggal(iso);
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleString('id-ID', {
                day: '2-digit', month: 'short', year: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (e) { return '—'; }
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch]);
    }

    /* ============================================
       AUTH
       ============================================ */
    const token = localStorage.getItem('access_token');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    const RECAPTCHA_SITE_KEY = '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg';

    const ICONS = {
        check: `<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
        close: `<svg class="icon-svg" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
        info: `<svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
        warning: `<svg class="icon-svg" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        coin: `<svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M15 9.5a3 3 0 0 0-3-1.5c-1.66 0-3 .67-3 1.5s1.34 1.5 3 1.5 3 .67 3 1.5-1.34 1.5-3 1.5a3 3 0 0 1-3-1.5"/></svg>`,
    };

    /* ============================================
       REFUND TOAST
       ============================================ */
    function showRefundToast(totalRefund, count) {
        const oldToast = document.getElementById('refundToast');
        if (oldToast) oldToast.remove();

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
            <button class="close-btn" type="button" aria-label="Tutup">
                ${ICONS.close}
            </button>
        `;
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => toast.classList.add('show'));
        });

        const autoDismiss = setTimeout(() => dismissToast(toast), 8000);

        toast.querySelector('.close-btn').addEventListener('click', () => {
            clearTimeout(autoDismiss);
            dismissToast(toast);
        });
    }

    function dismissToast(toast) {
        if (!toast || !toast.parentNode) return;
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
    }

    /* ============================================
       CUSTOM ALERT
       ============================================ */
    function showCustomAlert({ title, message, type = 'info', okText = 'OK', showCancel = false, cancelText = 'Batal' }) {
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
                const cancelBtn = document.createElement('button');
                cancelBtn.className = 'btn';
                cancelBtn.type = 'button';
                cancelBtn.textContent = cancelText;
                cancelBtn.addEventListener('click', () => {
                    overlay.classList.remove('active');
                    resolve(false);
                });
                actionsEl.appendChild(cancelBtn);
            }

            const okBtn = document.createElement('button');
            okBtn.className = 'btn btn-primary';
            okBtn.type = 'button';
            okBtn.textContent = okText;
            okBtn.addEventListener('click', () => {
                overlay.classList.remove('active');
                resolve(true);
            });
            actionsEl.appendChild(okBtn);

            overlay.classList.add('active');
        });
    }

    /* ============================================
       RECAPTCHA
       ============================================ */
    function waitForRecaptcha() {
        return new Promise((resolve) => {
            if (window.grecaptcha && window.grecaptcha.execute) return resolve();
            let attempts = 0;
            const timer = setInterval(() => {
                attempts++;
                if (window.grecaptcha && window.grecaptcha.execute) {
                    clearInterval(timer);
                    resolve();
                } else if (attempts >= 50) {
                    clearInterval(timer);
                    resolve();
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
                    grecaptcha.execute(RECAPTCHA_SITE_KEY, { action })
                        .then(resolve)
                        .catch(() => resolve(null));
                });
                setTimeout(() => resolve(null), 8000);
            });
        } catch (e) {
            return null;
        }
    }

    /* ============================================
       THEME
       ============================================ */
    (function initTheme() {
        const themeToggle = document.getElementById('themeToggle');
        if (!themeToggle) return;
        themeToggle.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'light';
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('asyrofotp_theme', next);
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', next === 'dark' ? '#0f172a' : '#2563eb');
        });
    })();

    /* ============================================
       SIDEBAR
       ============================================ */
    (function initCollapse() {
        const sidebar = document.getElementById('sidebar');
        const collapseBtn = document.getElementById('collapseBtn');
        if (!sidebar || !collapseBtn || window.innerWidth <= 768) return;

        const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';
        if (isCollapsed) {
            sidebar.classList.add('collapsed');
            document.body.classList.add('sidebar-collapsed');
        }

        collapseBtn.addEventListener('click', () => {
            if (window.innerWidth <= 768) return;
            const collapsed = sidebar.classList.toggle('collapsed');
            document.body.classList.toggle('sidebar-collapsed', collapsed);
            localStorage.setItem('sidebar_collapsed', collapsed);
        });
    })();

    (function initMobileSidebar() {
        const mobileToggle = document.getElementById('mobileToggle');
        const sidebar = document.getElementById('sidebar');
        const sidebarOverlay = document.getElementById('sidebarOverlay');
        if (!mobileToggle || !sidebar) return;

        let isOpen = false;

        function openSidebar() {
            if (isOpen) return;
            isOpen = true;
            sidebar.classList.add('open');
            if (sidebarOverlay) sidebarOverlay.classList.add('active');
            document.body.classList.add('sidebar-open');
            document.body.style.top = `-${window.scrollY}px`;
        }

        function closeSidebar() {
            if (!isOpen) return;
            isOpen = false;
            sidebar.classList.remove('open');
            if (sidebarOverlay) sidebarOverlay.classList.remove('active');
            document.body.classList.remove('sidebar-open');
            const scrollY = document.body.style.top;
            document.body.style.top = '';
            window.scrollTo(0, parseInt(scrollY || '0') * -1);
        }

        mobileToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isOpen) closeSidebar(); else openSidebar();
        });

        if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

        sidebar.querySelectorAll('.nav-item').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 768 && isOpen) setTimeout(closeSidebar, 100);
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen) closeSidebar();
        });

        window.addEventListener('pageshow', () => {
            document.body.style.top = '';
            document.body.classList.remove('sidebar-open');
        });
    })();

    /* ============================================
       SERVICE HELPERS — inisial
       ============================================ */
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
        return `<span class="icon-fallback">${escapeHtml(getServiceInitial(tx))}</span>`;
    }

    /* ============================================
       FLAG
       ============================================ */
    function countryCodeToTwemoji(countryCode) {
        const code = (countryCode || '').toUpperCase();
        if (code.length !== 2) return null;
        return code.split('').map(char => (0x1F1E6 + char.charCodeAt(0) - 65).toString(16)).join('-');
    }

    function getFlagSources(countryCode) {
        const code = (countryCode || '').toLowerCase();
        if (!/^[a-z]{2}$/.test(code)) return [];
        const twemoji = countryCodeToTwemoji(countryCode);
        return [
            twemoji ? `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/${twemoji}.svg` : null,
            `https://flagcdn.com/w40/${code}.png`,
            `https://flagcdn.com/w80/${code}.png`,
        ].filter(Boolean);
    }

    function renderFlag(countryCode, className = 'tx-flag') {
        const sources = getFlagSources(countryCode);
        if (sources.length === 0) {
            return `<div class="${className}" style="display:flex;align-items:center;justify-content:center;background:var(--bg-light);color:var(--text-light);font-size:0.55rem;font-weight:800;">${escapeHtml((countryCode || '??').toUpperCase())}</div>`;
        }
        const sourcesAttr = JSON.stringify(sources).replace(/"/g, '&quot;');
        return `<img class="${className}" src="${sources[0]}" alt="${countryCode}" loading="lazy" data-sources="${sourcesAttr}" data-source-idx="0">`;
    }

    window.handleFlagError = function(imgEl) {
        try {
            const sources = JSON.parse(imgEl.dataset.sources || '[]');
            const currentIdx = parseInt(imgEl.dataset.sourceIdx || '0', 10);
            const nextIdx = currentIdx + 1;
            if (nextIdx < sources.length) {
                imgEl.dataset.sourceIdx = nextIdx.toString();
                imgEl.src = sources[nextIdx];
            } else {
                const code = (imgEl.alt || '??').toUpperCase();
                const placeholder = document.createElement('div');
                placeholder.className = imgEl.className;
                placeholder.style.cssText = 'display:flex;align-items:center;justify-content:center;background:var(--bg-light);color:var(--text-light);font-size:0.55rem;font-weight:800;';
                placeholder.textContent = code;
                imgEl.replaceWith(placeholder);
            }
        } catch (e) {
            imgEl.style.display = 'none';
        }
    };

    function getCountryName(tx) {
        const names = {
            id:'Indonesia', ru:'Rusia', us:'Amerika Serikat', my:'Malaysia', vn:'Vietnam',
            ph:'Filipina', th:'Thailand', sg:'Singapura', in:'India', cn:'Tiongkok',
            jp:'Jepang', kr:'Korea Selatan', uk:'Britania Raya', gb:'Britania Raya',
            de:'Jerman', fr:'Prancis', br:'Brasil', ng:'Nigeria', pk:'Pakistan',
            bd:'Bangladesh', tr:'Turki', es:'Spanyol', it:'Italia', nl:'Belanda',
            au:'Australia', ca:'Kanada', mx:'Meksiko', ar:'Argentina', za:'Afrika Selatan',
            sa:'Arab Saudi', ae:'Uni Emirat Arab', pl:'Polandia', ua:'Ukraina',
            ro:'Rumania', kh:'Kamboja', la:'Laos', mm:'Myanmar', tw:'Taiwan',
            hk:'Hong Kong', nz:'Selandia Baru', ch:'Swiss', se:'Swedia', no:'Norwegia',
            fi:'Finlandia', be:'Belgia', pt:'Portugal', eg:'Mesir', ke:'Kenya', gh:'Ghana',
        };
        const code = String(tx?.country || tx?.country_name || '').trim().toLowerCase();
        const supplied = String(tx?.country_name || '').trim();
        if (supplied && supplied.toLowerCase() !== code) return supplied;
        if (names[code]) return names[code];
        if (/^[a-z]{2}$/i.test(code)) {
            try {
                const localized = new Intl.DisplayNames(['id'], { type: 'region' }).of(code.toUpperCase());
                return localized && localized.toLowerCase() !== code ? localized : '—';
            } catch (_) { return '—'; }
        }
        return supplied || '—';
    }

    /* ============================================
       LOAD USER (SWR)
       ============================================ */
    swrFetch('/api/user', 'user_profile', (user) => {
        if (!user) return;
        document.getElementById('userName').textContent = user.name || user.username;
        document.getElementById('greetingName').textContent = user.name || user.username;
        document.getElementById('userBalance').textContent = formatRupiah(user.balance);
        document.getElementById('balancePill').textContent = formatRupiah(user.balance);
        document.getElementById('userInitial').textContent = getInitial(user.name || user.username);

        if (user.user_code) {
            document.getElementById('userCode').textContent = user.user_code;
            document.getElementById('copyUserCode').style.display = 'inline-flex';
        }
    });

    /* ============================================
       RENDER DASHBOARD
       ============================================ */
    let lastTransactionSig = '';

    function renderDashboard(data) {
        if (!data) return;

        document.getElementById('statTotal').textContent = data.stats?.total ?? 0;
        document.getElementById('statSuccess').textContent = data.stats?.success ?? 0;
        document.getElementById('statPending').textContent = data.stats?.pending ?? 0;
        document.getElementById('statFailed').textContent = data.stats?.failed ?? 0;

        const tbody = document.getElementById('transactionsTable');

        if (!data.transactions || data.transactions.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center;padding:32px 20px;color:var(--text-gray);">
                        <svg class="icon-svg" viewBox="0 0 24 24" style="width:48px;height:48px;margin:0 auto 8px;display:block;color:var(--text-light);"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
                        <strong style="display:block;margin-bottom:4px;color:var(--text-dark);">Belum ada transaksi</strong>
                        <span style="font-size:0.82rem;">Mulai beli nokos buat lihat riwayat</span>
                    </td>
                </tr>
            `;
            lastTransactionSig = '';
            return;
        }

        const newSig = data.transactions.map(t => [
            t.order_id || '',
            t.status || '',
            t.service_name || '',
            t.country || '',
            t.price || '',
        ].join(':')).join('|');

        // Skip render kalau signature sama — anti kelap-kelip
        if (newSig === lastTransactionSig) return;
        lastTransactionSig = newSig;

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
            const countryName = getCountryName(t);
            const orderId = String(t.order_id || '').trim();
            return `
                <tr class="tx-row"
                    data-order-id="${escapeHtml(orderId)}"
                    title="Klik buat lihat detail di Inbox">
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
                            <span>${escapeHtml(countryName)}</span>
                        </div>
                    </td>
                    <td>${formatRupiah(t.price)}</td>
                    <td><span class="badge ${s.class}">${s.label}</span></td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.tx-row').forEach(row => {
            row.addEventListener('click', () => {
                const orderId = row.dataset.orderId;
                if (orderId) {
                    try { sessionStorage.setItem('highlight_order_id', orderId); } catch (_) {}
                }
                window.location.href = '/inbox';
            });
        });

        // Bind flag error handlers
        tbody.querySelectorAll('img[data-sources]').forEach(img => {
            if (img.dataset.bound) return;
            img.dataset.bound = '1';
            img.addEventListener('error', function() { window.handleFlagError(this); });
        });
    }

    /* ============================================
       CHECK & REFUND
       ============================================ */
    let lastRefundCheck = 0;
    const REFUND_CHECK_INTERVAL = 30 * 1000;

    async function checkRefunds(silent = false) {
        try {
            const res = await fetch('/api/nokos/check-refunds', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await safeJson(res);
            if (!res.ok) return;

            lastRefundCheck = Date.now();

            if (data.refunded && data.refunded.length > 0) {
                const totalRefund = data.refunded.reduce((sum, r) => sum + (r.refunded_amount || 0), 0);
                const count = data.refunded.length;

                if (!silent) showRefundToast(totalRefund, count);

                if (data.new_balance !== null && data.new_balance !== undefined) {
                    const newBal = Number(data.new_balance);
                    document.getElementById('userBalance').textContent = formatRupiah(newBal);
                    document.getElementById('balancePill').textContent = formatRupiah(newBal);
                } else {
                    CacheManagerRemove('user_profile');
                    swrFetch('/api/user', 'user_profile', (user) => {
                        if (!user) return;
                        document.getElementById('userBalance').textContent = formatRupiah(user.balance);
                        document.getElementById('balancePill').textContent = formatRupiah(user.balance);
                    });
                }

                lastTransactionSig = '';
                silentRefreshDashboard();
            }
        } catch (err) {
            console.error('Check refunds error:', err);
        }
    }

    /* ============================================
       SILENT REFRESH
       ============================================ */
    let refreshing = false;

    async function silentRefreshDashboard() {
        if (refreshing || document.hidden) return;
        refreshing = true;
        try {
            const res = await fetch('/api/dashboard', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await safeJson(res);
            if (data) {
                CacheManagerSet('dashboard_data', data);
                renderDashboard(data);
            }

            const userRes = await fetch('/api/user', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const user = await safeJson(userRes);
            if (user) {
                CacheManagerSet('user_profile', user);
                document.getElementById('userBalance').textContent = formatRupiah(user.balance);
                document.getElementById('balancePill').textContent = formatRupiah(user.balance);
            }
        } catch (err) {
            console.error('Silent refresh error:', err);
        } finally {
            refreshing = false;
        }
    }

    /* ============================================
       AUTO REFRESH
       ============================================ */
    let dashboardInterval = null;
    let refundInterval = null;

    function startAutoRefresh() {
        if (dashboardInterval) clearInterval(dashboardInterval);
        dashboardInterval = setInterval(silentRefreshDashboard, 10000);

        if (refundInterval) clearInterval(refundInterval);
        refundInterval = setInterval(() => {
            if (!document.hidden) checkRefunds(false);
        }, REFUND_CHECK_INTERVAL);
    }

    /* ============================================
       EVENT BINDINGS
       ============================================ */
    document.getElementById('refreshBtn').addEventListener('click', async function() {
        const btn = this;
        btn.classList.add('spinning');
        lastTransactionSig = '';

        await Promise.all([
            checkRefunds(false),
            silentRefreshDashboard(),
        ]);

        setTimeout(() => btn.classList.remove('spinning'), 500);
    });

    document.getElementById('copyUserCode').addEventListener('click', () => {
        const code = document.getElementById('userCode').textContent;
        navigator.clipboard.writeText(code).then(() => {
            const btn = document.getElementById('copyUserCode');
            const original = btn.innerHTML;
            btn.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
            setTimeout(() => btn.innerHTML = original, 1500);
        });
    });

    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (err) {}

        CacheManagerClear();
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
        window.location.href = '/landing';
    });

    /* ============================================
       INIT
       ============================================ */
    (async function init() {
        // 1. Cek refund DULU biar toast muncul
        await checkRefunds(false);

        // 2. Fetch dashboard
        swrFetch('/api/dashboard', 'dashboard_data', renderDashboard);
    })();

    startAutoRefresh();

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            silentRefreshDashboard();
            if (Date.now() - lastRefundCheck > REFUND_CHECK_INTERVAL) {
                checkRefunds(false);
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        if (dashboardInterval) clearInterval(dashboardInterval);
        if (refundInterval) clearInterval(refundInterval);
    });

})();
