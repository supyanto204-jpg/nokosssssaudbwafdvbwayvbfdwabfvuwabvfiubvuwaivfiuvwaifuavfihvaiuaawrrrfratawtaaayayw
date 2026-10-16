/* ============================================
   DEPOSIT.JS — Logic halaman Deposit
   v3 — split dari HTML, DevTools friendly
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

    /* ============================================
       GUARD — pastikan main.js sudah load
       ============================================ */
    if (typeof window.swrFetch !== 'function') {
        console.error('[deposit.js] main.js belum load — swrFetch tidak ada');
    }

    /* ============================================
       RECAPTCHA
       ============================================ */
    const RECAPTCHA_SITE_KEY = '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg';

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
       ICONS
       ============================================ */
    const ICONS = {
        qrispy: `<svg class="icon-svg" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        dana: `<svg class="icon-svg" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><circle cx="17" cy="15" r="1.5" fill="currentColor"/></svg>`,
        check: `<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`,
        close: `<svg class="icon-svg" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
        clock: `<svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
        warning: `<svg class="icon-svg" viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        info: `<svg class="icon-svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
        arrowRight: `<svg class="icon-svg" viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`,
        arrowLeft: `<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>`,
        wallet: `<svg class="icon-svg" viewBox="0 0 24 24"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>`,
        copy: `<svg class="icon-svg" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
        download: `<svg class="icon-svg" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    };

    const QRISPY_BASE = 'https://cloudflareworkerdeploydidashcloudflarecomexportdef.rahayucahyapurwa.workers.dev';

    const token = localStorage.getItem('access_token');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    /* ============================================
       STATE
       ============================================ */
    let state = {
        amount: 0,
        method: null,
        methodLabel: null,
        deposit: null,
        pollingInterval: null,
        countdownInterval: null,
        presets: [],
        isCreating: false,
        historyPage: 1,
        historyLimit: 5,
        expired: false,
    };

    /* ============================================
       HELPERS
       ============================================ */
    function safeJson(res) {
        if (typeof window.safeJson === 'function') return window.safeJson(res);
        return res.json().catch(() => ({}));
    }

    function formatRupiah(n) {
        if (typeof window.formatRupiah === 'function') return window.formatRupiah(n);
        const num = Number(n) || 0;
        return 'Rp' + num.toLocaleString('id-ID');
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

    /* ============================================
       SECURE FETCH (recaptcha untuk POST)
       ============================================ */
    async function securePost(url, body = {}, action = 'deposit') {
        const recaptchaToken = await getRecaptchaToken(action);
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ ...body, recaptcha_token: recaptchaToken })
        });
    }

    /* ============================================
       CUSTOM ALERT / CONFIRM
       ============================================ */
    function showCustomAlert({ title, message, type = 'info', okText = 'OK', showCancel = false, cancelText = 'Batal' }) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('customAlert');
            const iconEl = document.getElementById('customAlertIcon');
            const titleEl = document.getElementById('customAlertTitle');
            const msgEl = document.getElementById('customAlertMessage');
            const actionsEl = document.getElementById('customAlertActions');

            iconEl.className = 'custom-alert-icon ' + type;
            const iconMap = {
                success: ICONS.check,
                warning: ICONS.warning,
                danger: ICONS.close,
                info: ICONS.info,
            };
            iconEl.innerHTML = iconMap[type] || ICONS.info;
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

    function customAlert(message, type = 'info', title = null) {
        const titles = { success: 'Berhasil', warning: 'Perhatian', danger: 'Error', info: 'Informasi' };
        return showCustomAlert({ title: title || titles[type] || 'Informasi', message, type });
    }

    function customConfirm(message, type = 'warning', title = 'Konfirmasi') {
        return showCustomAlert({ title, message, type, okText: 'Ya', showCancel: true, cancelText: 'Batal' });
    }

    /* ============================================
       THEME TOGGLE
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
        if (!sidebar || !collapseBtn) return;
        if (window.innerWidth <= 768) return;

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

        window.addEventListener('resize', () => {
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('collapsed');
                document.body.classList.remove('sidebar-collapsed');
            } else {
                const isCollapsed2 = localStorage.getItem('sidebar_collapsed') === 'true';
                if (isCollapsed2) {
                    sidebar.classList.add('collapsed');
                    document.body.classList.add('sidebar-collapsed');
                }
            }
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
            if (window.innerWidth <= 768) {
                sidebar.classList.remove('collapsed');
                document.body.classList.remove('sidebar-collapsed');
            }
            sidebar.classList.add('open');
            if (sidebarOverlay) sidebarOverlay.classList.add('active');
            document.body.classList.add('sidebar-open');
            const scrollY = window.scrollY;
            document.body.style.top = `-${scrollY}px`;
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

        if (sidebarOverlay) {
            sidebarOverlay.addEventListener('click', (e) => {
                e.preventDefault();
                closeSidebar();
            });
        }

        sidebar.querySelectorAll('.nav-item').forEach(link => {
            link.addEventListener('click', () => {
                if (window.innerWidth <= 768 && isOpen) {
                    setTimeout(closeSidebar, 100);
                }
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isOpen) closeSidebar();
        });

        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (window.innerWidth > 768) {
                    if (isOpen) closeSidebar();
                } else {
                    sidebar.classList.remove('collapsed');
                    document.body.classList.remove('sidebar-collapsed');
                }
            }, 150);
        });

        window.addEventListener('pageshow', () => {
            document.body.style.top = '';
            document.body.classList.remove('sidebar-open');
        });
    })();

    /* ============================================
       STATE PERSISTENCE
       ============================================ */
    function restoreState() {
        try {
            const saved = sessionStorage.getItem('deposit_state');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.amount) {
                    state.amount = parsed.amount;
                    document.getElementById('inputAmount').value = parsed.amount;
                }
            }
        } catch (e) {}
    }

    function saveState() {
        try {
            sessionStorage.setItem('deposit_state', JSON.stringify({ amount: state.amount }));
        } catch (e) {}
    }

    function clearState() {
        try { sessionStorage.removeItem('deposit_state'); } catch (e) {}
    }

    /* ============================================
       LOAD USER
       ============================================ */
    swrFetch('/api/user', 'user_profile', (user) => {
        if (!user) return;
        document.getElementById('userName').textContent = user.name || user.username;
        document.getElementById('userBalance').textContent = formatRupiah(user.balance);
        document.getElementById('userInitial').textContent = getInitial(user.name || user.username);
        document.getElementById('balancePill').textContent = formatRupiah(user.balance);
        document.getElementById('saldoSekarang').textContent = formatRupiah(user.balance);
    });

    /* ============================================
       LOAD PRESETS
       ============================================ */
    async function loadPresets() {
        try {
            const res = await fetch('/api/deposit/presets', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await safeJson(res);
            state.presets = data.presets || [];
        } catch (err) {
            state.presets = [
                { amount: 10000, label: 'Rp10.000' },
                { amount: 20000, label: 'Rp20.000' },
                { amount: 50000, label: 'Rp50.000' },
                { amount: 100000, label: 'Rp100.000' },
                { amount: 200000, label: 'Rp200.000' },
                { amount: 500000, label: 'Rp500.000' },
            ];
        }
        renderPresets();
    }

    function renderPresets() {
        const grid = document.getElementById('presetGrid');
        grid.innerHTML = state.presets.map(p => `
            <button class="preset-item" type="button" data-amount="${p.amount}">${p.label}</button>
        `).join('');

        grid.querySelectorAll('.preset-item').forEach(btn => {
            btn.addEventListener('click', () => {
                grid.querySelectorAll('.preset-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('inputAmount').value = btn.dataset.amount;
                state.amount = Number(btn.dataset.amount);
                updateButton();
                saveState();
            });
        });
    }

    const inputAmount = document.getElementById('inputAmount');
    const btnLanjut = document.getElementById('btnLanjut');

    function updateButton() {
        const val = Number(inputAmount.value);
        if (val >= 1000 && val <= 10000000) {
            btnLanjut.disabled = false;
            state.amount = val;
        } else {
            btnLanjut.disabled = true;
            state.amount = 0;
        }
    }

    inputAmount.addEventListener('input', () => {
        document.querySelectorAll('.preset-item').forEach(b => b.classList.remove('active'));
        updateButton();
        saveState();
    });

    /* ============================================
       STEP INDICATOR
       ============================================ */
    function setStep(step, expired = false) {
        ['step1', 'step2', 'step3'].forEach(id => {
            const el = document.getElementById(id);
            el.classList.remove('active', 'done', 'expired');
        });

        const setIcon = (id, symbol) => {
            const iconEl = document.getElementById(id);
            if (iconEl) iconEl.textContent = symbol;
        };

        if (step === 1) {
            document.getElementById('step1').classList.add('active');
            setIcon('step1Icon', '●');
            setIcon('step2Icon', '●');
            setIcon('step3Icon', '●');
        } else if (step === 2) {
            document.getElementById('step1').classList.add('done');
            document.getElementById('step2').classList.add('active');
            setIcon('step1Icon', '✓');
            setIcon('step2Icon', '●');
            setIcon('step3Icon', '●');
        } else if (step === 3) {
            document.getElementById('step1').classList.add('done');
            document.getElementById('step2').classList.add('done');
            document.getElementById('step3').classList.add(expired ? 'expired' : 'active');
            setIcon('step1Icon', '✓');
            setIcon('step2Icon', '✓');
            setIcon('step3Icon', expired ? '✕' : '●');
        }
    }

    /* ============================================
       LOAD METHODS
       ============================================ */
    async function loadMethods() {
        const grid = document.getElementById('methodGrid');
        try {
            const res = await fetch('/api/deposit/methods', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await safeJson(res);

            grid.innerHTML = data.methods.map(m => {
                const iconSvg = m.id === 'qrispy' ? ICONS.qrispy : ICONS.dana;
                const badge = m.id === 'qrispy'
                    ? `<span class="method-badge">OTOMATIS</span>`
                    : `<span class="method-badge warning">MANUAL</span>`;
                return `
                    <button class="method-card" type="button" data-method="${m.id}" data-label="${m.label}">
                        <div class="method-icon ${m.id === 'qrispy' ? 'qrispy' : 'dana'}">${iconSvg}</div>
                        <div class="method-info">
                            <div class="method-title">${m.label} ${badge}</div>
                            <div class="method-desc">${m.desc}</div>
                        </div>
                    </button>
                `;
            }).join('');

            grid.querySelectorAll('.method-card').forEach(card => {
                card.addEventListener('click', () => {
                    state.method = card.dataset.method;
                    state.methodLabel = card.dataset.label;
                    closeModal('modalMethod');
                    setStep(3);
                    createDeposit();
                });
            });
        } catch (err) {
            grid.innerHTML = `<div class="empty-block"><h3>Gagal memuat</h3><p>${err.message}</p></div>`;
        }
    }

    /* ============================================
       CREATE DEPOSIT
       ============================================ */
    async function createDeposit() {
        if (state.isCreating) return;
        state.isCreating = true;
        state.expired = false;

        const btn = btnLanjut;
        const original = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<span class="loading-spinner loading-spinner-sm"></span> Membuat QR...';

        try {
            if (state.method === 'qrispy') {
                await createQrispyDeposit();
            } else if (state.method === 'qris_dana') {
                await createQrisDanaDeposit();
            }
        } catch (err) {
            await customAlert('Gagal membuat deposit: ' + err.message, 'danger', 'Gagal');
            setStep(1);
            btn.disabled = false;
            btn.innerHTML = original;
        } finally {
            state.isCreating = false;
        }
    }

    async function createQrispyDeposit() {
        const refRes = await securePost('/api/deposit/generate-ref', {}, 'deposit_ref');
        const refData = await safeJson(refRes);
        if (!refRes.ok || !refData.reference_id) {
            throw new Error('Gagal generate reference ID');
        }
        const referenceId = refData.reference_id;

        const qrispyRes = await fetch(`${QRISPY_BASE}/api/payment/qris/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: Number(state.amount),
                payment_reference: referenceId,
            }),
        });

        const qrispyData = await safeJson(qrispyRes);
        if (!qrispyRes.ok || qrispyData.status === 'error') {
            throw new Error(qrispyData.message || 'Gagal membuat QRIS');
        }

        const saveRes = await securePost('/api/deposit/qrispy-save', {
            reference_id: referenceId,
            amount: Number(state.amount),
            qris_id: qrispyData.data.qris_id,
            qris_url: qrispyData.data.qris_image_url,
            expired_at: qrispyData.data.expired_at,
            expires_in_seconds: qrispyData.data.expires_in_seconds,
        }, 'deposit_save');

        const saveData = await safeJson(saveRes);
        if (!saveRes.ok) throw new Error(saveData.error || 'Gagal simpan deposit');

        state.deposit = saveData.deposit;
        showPaymentPanel();
    }

    async function createQrisDanaDeposit() {
        const res = await securePost('/api/deposit/qris-dana', {
            amount: Number(state.amount)
        }, 'deposit_dana');

        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.error || 'Gagal membuat QRIS DANA');

        state.deposit = data.deposit;
        showPaymentPanel();
    }

    /* ============================================
       SHOW PAYMENT PANEL
       ============================================ */
    function showPaymentPanel() {
        setStep(3);
        document.getElementById('panelNominal').style.display = 'none';
        const panelPayment = document.getElementById('panelPayment');
        panelPayment.style.display = 'block';

        const d = state.deposit;
        const isManual = state.method === 'qris_dana';

        const saldoMasuk = Number(d.amount);
        let fee, totalBayar;

        if (isManual) {
            fee = Number(d.unique_code) || Number(d.fee) || 0;
            totalBayar = Number(d.total_amount) || (saldoMasuk + fee);
        } else {
            fee = Number(d.fee) || 0;
            totalBayar = Number(d.total_amount) || saldoMasuk;
        }

        panelPayment.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
                <div class="countdown" id="countdown" style="margin-bottom:0;">
                    ${ICONS.clock}
                    <span id="countdownText">--:--</span>
                </div>
            </div>

            <div class="qr-display">
                <div class="qr-total">
                    <div class="label">Total yang harus dibayar</div>
                    <div class="amount" id="qrAmount">${formatRupiah(totalBayar)}</div>
                </div>
                <div class="qr-wrapper">
                    <img src="${d.qris_url}" alt="QR Code" id="qrImage" crossorigin="anonymous">
                </div>
            </div>

            <div class="qr-info">
                <div class="qr-row">
                    <span class="label">Reference ID</span>
                    <span class="value">${d.reference_id}</span>
                </div>
                <div class="qr-row">
                    <span class="label">Metode</span>
                    <span class="value">${state.methodLabel}</span>
                </div>
                <div class="qr-row">
                    <span class="label">Saldo Top Up</span>
                    <span class="value">${formatRupiah(saldoMasuk)}</span>
                </div>
                ${isManual ? `
                    <div class="qr-row">
                        <span class="label">Kode Unik</span>
                        <span class="value unique">+${d.unique_code}</span>
                    </div>
                ` : ''}
                <div class="qr-row">
                    <span class="label">Fee</span>
                    <span class="value" id="qrFee">
                        ${isManual ? formatRupiah(fee) : '<span class="inline-loader"></span>'}
                    </span>
                </div>
                <div class="qr-row total-row">
                    <span class="label">Total Bayar</span>
                    <span class="value big" id="qrTotal">${formatRupiah(totalBayar)}</span>
                </div>
                <div class="qr-row">
                    <span class="label">Saldo Diterima</span>
                    <span class="value success">${formatRupiah(saldoMasuk)}</span>
                </div>
            </div>

            ${isManual ? `
                <div class="info-box">
                    ${ICONS.warning}
                    <span><strong>Penting:</strong> Transfer <strong>tepat ${formatRupiah(totalBayar)}</strong> (termasuk kode unik +${d.unique_code}). Kode unik dipakai buat verifikasi otomatis.</span>
                </div>
            ` : `
                <div class="polling-indicator">
                    <span class="loading-spinner"></span>
                    <span>Menunggu pembayaran... otomatis cek status</span>
                </div>
            `}

            <div class="payment-actions">
                <button class="btn-download-qr" id="btnDownloadQr" type="button">
                    ${ICONS.download}
                    Download QR
                </button>
                <button class="btn-cancel-red" id="btnCancel" type="button">
                    ${ICONS.close}
                    Batalkan
                </button>
            </div>
        `;

        document.getElementById('btnCancel').addEventListener('click', cancelDeposit);
        document.getElementById('btnDownloadQr').addEventListener('click', downloadQR);

        let countdownSeconds = d.expires_in_seconds || 1800;
        if (d.expired_at) {
            const expiresAt = new Date(d.expired_at).getTime();
            countdownSeconds = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
        }
        startCountdown(countdownSeconds);

        if (isManual) {
            startManualExpiryCheck(d.reference_id);
        } else {
            startPolling(d.reference_id);
            fetchQrispyFeeAsync(d.reference_id, d.qris_id, saldoMasuk);
        }
    }

    /* ============================================
       DOWNLOAD QR
       ============================================ */
    async function downloadQR() {
        const qrImg = document.getElementById('qrImage');
        if (!qrImg) return;

        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const size = 600;
            const padding = 40;
            const topSpace = 60;
            const bottomSpace = 60;

            canvas.width = size;
            canvas.height = size;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);

            ctx.fillStyle = '#2563eb';
            ctx.font = 'bold 24px "Bricolage Grotesque", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('AsyrofOTP', size / 2, topSpace / 2);

            const img = new Image();
            img.crossOrigin = 'anonymous';
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = qrImg.src;
            });

            const qrSize = size - (padding * 2);
            ctx.drawImage(img, padding, topSpace, qrSize, qrSize - (bottomSpace - topSpace) / 2);

            ctx.fillStyle = '#64748b';
            ctx.font = '14px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(state.deposit?.reference_id || '', size / 2, size - bottomSpace / 2);

            const link = document.createElement('a');
            link.download = `AsyrofOTP-QR-${state.deposit?.reference_id || Date.now()}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (err) {
            console.error('Download QR error:', err);
            window.open(qrImg.src, '_blank');
        }
    }

    /* ============================================
       FETCH QRISPY FEE
       ============================================ */
    async function fetchQrispyFeeAsync(referenceId, qrisId, saldoMasuk) {
        try {
            let transaction = null;

            try {
                const res = await fetch(`${QRISPY_BASE}/api/payment/transactions?qris_id=${qrisId}`);
                const data = await safeJson(res);
                if (Array.isArray(data.data)) {
                    transaction = data.data.find(t => t.payment_reference === referenceId || t.qris_id === qrisId);
                } else if (data.data && typeof data.data === 'object') {
                    transaction = data.data;
                }
            } catch (e) {
                try {
                    const res2 = await fetch(`${QRISPY_BASE}/api/payment/qris/${qrisId}/status`);
                    const data2 = await safeJson(res2);
                    transaction = data2.data;
                } catch (e2) {
                    console.error('Both QRISPY endpoints failed:', e2);
                }
            }

            const feeEl = document.getElementById('qrFee');
            const totalEl = document.getElementById('qrTotal');
            const amountEl = document.getElementById('qrAmount');

            if (transaction) {
                const totalBayar = Number(transaction.amount) || saldoMasuk;
                const fee = Math.max(0, totalBayar - saldoMasuk);

                if (feeEl) feeEl.textContent = formatRupiah(fee);
                if (totalEl) totalEl.textContent = formatRupiah(totalBayar);
                if (amountEl) amountEl.textContent = formatRupiah(totalBayar);

                state.deposit.total_amount = totalBayar;
                state.deposit.fee = fee;

                securePost(`/api/deposit/${referenceId}/update-fee`, {
                    total_amount: totalBayar,
                    fee
                }, 'deposit_fee').catch(() => {});
            } else {
                if (feeEl) feeEl.textContent = 'Rp0';
                state.deposit.fee = 0;
            }
        } catch (err) {
            console.error('Fetch QRISPY fee error:', err);
            const feeEl = document.getElementById('qrFee');
            if (feeEl) feeEl.textContent = 'Rp0';
        }
    }

    function startManualExpiryCheck(referenceId) {
        if (window._manualExpiryInterval) clearInterval(window._manualExpiryInterval);
        window._manualExpiryInterval = setInterval(async () => {
            if (state.expired) {
                clearInterval(window._manualExpiryInterval);
                return;
            }
            try {
                const res = await fetch(`/api/deposit/${referenceId}/status`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await safeJson(res);
                if (data.deposit?.status === 'expired') {
                    clearInterval(window._manualExpiryInterval);
                    stopCountdown();
                    showExpired();
                }
            } catch (err) {}
        }, 30000);
    }

    function startPolling(referenceId) {
        stopPolling();
        state.pollingInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/deposit/${referenceId}/status`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await safeJson(res);

                if (data.status === 'success' || data.deposit?.status === 'success') {
                    stopPolling();
                    stopCountdown();
                    showSuccess(data.deposit);
                } else if (data.deposit?.status === 'expired') {
                    stopPolling();
                    stopCountdown();
                    showExpired();
                }
            } catch (err) {
                console.error('Polling error:', err);
            }
        }, 3000);
    }

    function stopPolling() {
        if (state.pollingInterval) {
            clearInterval(state.pollingInterval);
            state.pollingInterval = null;
        }
        if (window._manualExpiryInterval) {
            clearInterval(window._manualExpiryInterval);
            window._manualExpiryInterval = null;
        }
    }

    function startCountdown(seconds) {
        stopCountdown();
        let remaining = seconds;

        function tick() {
            if (state.expired) return;
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            const text = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            const el = document.getElementById('countdownText');
            const cd = document.getElementById('countdown');
            if (el) el.textContent = text;

            if (remaining <= 0) {
                if (cd) cd.classList.add('expired');
                if (el) el.textContent = 'EXPIRED';
                stopCountdown();
                stopPolling();
                showExpired();
                return;
            }
            remaining--;
        }

        tick();
        state.countdownInterval = setInterval(tick, 1000);
    }

    function stopCountdown() {
        if (state.countdownInterval) {
            clearInterval(state.countdownInterval);
            state.countdownInterval = null;
        }
    }

    /* ============================================
       SHOW EXPIRED
       ============================================ */
    function showExpired() {
        state.expired = true;
        stopPolling();
        stopCountdown();
        setStep(3, true);

        if (state.deposit?.reference_id) {
            securePost(`/api/deposit/${state.deposit.reference_id}/expire`, {}, 'deposit_expire').catch(() => {});
        }

        const panelPayment = document.getElementById('panelPayment');
        panelPayment.innerHTML = `
            <div style="text-align:center;padding:32px 20px;">
                <div class="success-icon expired">
                    ${ICONS.clock}
                </div>
                <h2 style="font-family:var(--font-display);font-size:1.3rem;font-weight:800;margin-bottom:8px;color:var(--text-dark);">QRIS Kedaluwarsa</h2>
                <p style="color:var(--text-gray);font-size:0.9rem;margin-bottom:24px;">
                    Waktu pembayaran habis. Status deposit ini udah <strong>EXPIRED</strong>.
                </p>
                <div class="detail-list" style="text-align:left;margin-bottom:16px;">
                    <div class="detail-row">
                        <span class="detail-label">Reference ID</span>
                        <span class="detail-value">${state.deposit?.reference_id || '—'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Status</span>
                        <span class="detail-value expired">EXPIRED</span>
                    </div>
                </div>
                <button class="btn btn-primary btn-block" type="button" onclick="window.resetDepositPanel()">
                    ${ICONS.arrowRight}
                    Buat Deposit Baru
                </button>
            </div>
        `;
        invalidateHistoryCache();
        loadHistory(state.historyPage);
    }

    async function cancelDeposit() {
        if (!state.deposit) return;
        const ok = await customConfirm('Yakin mau batalkan deposit ini? Saldo belum terpotong kok.', 'warning', 'Batalkan Deposit');
        if (!ok) return;

        try {
            await securePost(`/api/deposit/${state.deposit.reference_id}/cancel`, {}, 'deposit_cancel');
        } catch (err) {}

        stopPolling();
        stopCountdown();
        resetPanel();
        invalidateHistoryCache();
        loadHistory(state.historyPage);
    }

    function resetPanel() {
        stopPolling();
        stopCountdown();
        state.expired = false;
        setStep(1);
        document.getElementById('panelNominal').style.display = 'block';
        document.getElementById('panelPayment').style.display = 'none';
        document.getElementById('panelPayment').innerHTML = '';
        state.deposit = null;
        state.method = null;
        state.methodLabel = null;
        btnLanjut.disabled = !state.amount;
        btnLanjut.innerHTML = `${ICONS.arrowRight} <span>Pilih Metode Pembayaran</span>`;
    }

    window.resetDepositPanel = resetPanel;

    function openModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.add('active');
            document.body.classList.add('modal-open');
        }
    }

    function closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('active');
            if (!document.querySelector('.modal-overlay.active')) {
                document.body.classList.remove('modal-open');
