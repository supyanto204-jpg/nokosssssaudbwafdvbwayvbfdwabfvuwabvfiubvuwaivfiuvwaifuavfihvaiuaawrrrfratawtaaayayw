/* ============================================
   LOGIN PAGE — MAIN SCRIPT
   ============================================ */
(function () {
    'use strict';

    /* ============================================
       SECURITY HARDENING
       ============================================ */
    (function security() {
        try {
            console.log('%c⚠️ STOP!', 'color:#dc2626;font-size:20px;font-weight:900;');
            console.log('%cIni fitur browser untuk developer. Kalau ada yang menyuruh kamu paste sesuatu di sini, itu SCAM.', 'color:#64748b;font-size:12px;');
            console.log('%cJangan pernah share password, token, atau data pribadi di sini.', 'color:#64748b;font-size:12px;');
        } catch (e) {}

        document.addEventListener('contextmenu', (e) => e.preventDefault());
        document.addEventListener('keydown', (e) => {
            const k = e.key;
            if (k === 'F12') { e.preventDefault(); return false; }
            if (e.ctrlKey && e.shiftKey && ['I','J','C','i','j','c'].includes(k)) { e.preventDefault(); return false; }
            if (e.ctrlKey && ['U','u','S','s','P','p'].includes(k)) { e.preventDefault(); return false; }
        }, true);

        document.addEventListener('copy', (e) => {
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
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

        // DevTools detection
        (function () {
            const FLAG = 'asyrof_devtools_lock';
            if (sessionStorage.getItem(FLAG) === '1') return;
            if (navigator.maxTouchPoints > 0 && window.innerWidth < 1024) return;
            if (window.innerWidth < 600) return;
            setInterval(() => {
                const wd = window.outerWidth - window.innerWidth;
                const hd = window.outerHeight - window.innerHeight;
                if (wd > 200 || hd > 200) {
                    try { sessionStorage.setItem(FLAG, '1'); } catch (e) {}
                    document.body.innerHTML = '';
                    window.location.reload();
                }
            }, 800);
        })();
    })();

    /* ============================================
       AUTO REDIRECT — kalau udah login
       ============================================ */
    (async function checkAlreadyLoggedIn() {
        const token = localStorage.getItem('access_token');
        if (!token) return;
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch('/api/user', {
                headers: { 'Authorization': `Bearer ${token}` },
                signal: ctrl.signal,
            });
            clearTimeout(t);
            if (res.ok) { window.location.replace('/dashboard'); return; }
            if (res.status === 401 || res.status === 403) {
                localStorage.removeItem('access_token');
                localStorage.removeItem('user');
            }
        } catch (e) {}
    })();

    /* ============================================
       THEME TOGGLE
       ============================================ */
    (function theme() {
        const btn = document.getElementById('themeToggle');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const cur = document.documentElement.getAttribute('data-theme') || 'light';
            const next = cur === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('asyrofotp_theme', next);
            const m = document.querySelector('meta[name="theme-color"]');
            if (m) m.setAttribute('content', next === 'dark' ? '#0f172a' : '#2563eb');
        });
    })();

    /* ============================================
       CURSOR GRID — Background reaktif kursor
       ============================================ */
    (function cursorGrid() {
        const isMobile = window.matchMedia('(max-width: 900px)').matches;
        if (isMobile) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const canvas = document.getElementById('cursorGridCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        const CELL = 70;
        const RADIUS = 160;
        const HOLD = 500;
        const FADE_MS = 900;
        const LINE = 1;
        const MAX_OP = 0.7;
        const COLOR = [37, 99, 235];

        let cols = 0, rows = 0, offX = 0, offY = 0;
        let alphas = new Float32Array(0);
        let touched = new Float64Array(0);
        let w = 1, h = 1;
        let raf = 0;
        let running = false;
        let lastFrame = 0;
        let visible = true;
        let lastRender = 0;
        const FRAME_MIN = 1000 / 30;

        function rebuild() {
            w = window.innerWidth;
            h = window.innerHeight;
            canvas.width = w;
            canvas.height = h;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            cols = Math.ceil(w / CELL) + 1;
            rows = Math.ceil(h / CELL) + 1;
            offX = (w - cols * CELL) / 2;
            offY = (h - rows * CELL) / 2;
            alphas = new Float32Array(cols * rows);
            touched = new Float64Array(cols * rows);
        }

        function cellCenter(i) {
            const cx = offX + (i % cols) * CELL + CELL / 2;
            const cy = offY + Math.floor(i / cols) * CELL + CELL / 2;
            return [cx, cy];
        }

        function energize(x, y) {
            const now = performance.now();
            const minC = Math.max(0, Math.floor((x - RADIUS - offX) / CELL));
            const maxC = Math.min(cols - 1, Math.floor((x + RADIUS - offX) / CELL));
            const minR = Math.max(0, Math.floor((y - RADIUS - offY) / CELL));
            const maxR = Math.min(rows - 1, Math.floor((y + RADIUS - offY) / CELL));
            for (let r = minR; r <= maxR; r++) {
                for (let c = minC; c <= maxC; c++) {
                    const i = r * cols + c;
                    const [cx, cy] = cellCenter(i);
                    const dist = Math.hypot(cx - x, cy - y);
                    if (dist > RADIUS) continue;
                    const t = 1 - dist / RADIUS;
                    const eased = t * t * (3 - 2 * t);
                    const level = eased * MAX_OP;
                    if (level > alphas[i]) {
                        alphas[i] = level;
                        touched[i] = now;
                    } else if (level > 0) {
                        touched[i] = now;
                    }
                }
            }
        }

        function draw(now) {
            raf = 0;
            if (!visible || document.hidden) { running = false; return; }
            if (now - lastRender < FRAME_MIN) {
                raf = requestAnimationFrame(draw);
                return;
            }
            lastRender = now;
            const dt = Math.min(now - lastFrame, 50);
            lastFrame = now;
            ctx.clearRect(0, 0, w, h);

            let any = false;
            const fadeStep = dt / FADE_MS;
            const half = CELL / 2;
            const [cr, cg, cb] = COLOR;

            for (let i = 0; i < alphas.length; i++) {
                let a = alphas[i];
                if (a <= 0) continue;
                if (now - touched[i] > HOLD) {
                    a = Math.max(0, a - fadeStep);
                    alphas[i] = a;
                    if (a <= 0) continue;
                }
                any = true;
                const [cx, cy] = cellCenter(i);
                const x = cx - half + 0.5;
                const y = cy - half + 0.5;
                const s = CELL - 1;

                ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a})`;
                ctx.lineWidth = LINE;
                ctx.strokeRect(x, y, s, s);
            }

            if (any) raf = requestAnimationFrame(draw);
            else running = false;
        }

        function wake() {
            if (running) return;
            running = true;
            lastFrame = performance.now();
            lastRender = 0;
            raf = requestAnimationFrame(draw);
        }

        function stop() {
            if (raf) {
                cancelAnimationFrame(raf);
                raf = 0;
            }
            running = false;
        }

        const onPointerMove = (e) => {
            energize(e.clientX, e.clientY);
            wake();
        };
        const onPointerDown = (e) => {
            energize(e.clientX, e.clientY);
            wake();
        };
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        window.addEventListener('pointerdown', onPointerDown, { passive: true });

        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { rebuild(); wake(); }, 200);
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) stop();
            else wake();
        });

        rebuild();
        wake();
    })();

    /* ============================================
       BORDER GLOW — glow ngikutin kursor
       ============================================ */
    (function borderGlow() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const card = document.getElementById('loginCard');
        if (!card) return;

        let raf = 0;
        let targetX = 0, targetY = 0;
        let curX = 0, curY = 0;
        let active = false;

        function getEdgeProximity(el, x, y) {
            const rect = el.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const dx = x - cx;
            const dy = y - cy;
            let kx = Infinity, ky = Infinity;
            if (dx !== 0) kx = cx / Math.abs(dx);
            if (dy !== 0) ky = cy / Math.abs(dy);
            return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
        }

        function getCursorAngle(el, x, y) {
            const rect = el.getBoundingClientRect();
            const cx = rect.width / 2;
            const cy = rect.height / 2;
            const dx = x - cx;
            const dy = y - cy;
            if (dx === 0 && dy === 0) return 0;
            const rad = Math.atan2(dy, dx);
            let deg = rad * (180 / Math.PI) + 90;
            if (deg < 0) deg += 360;
            return deg;
        }

        const onPointerMove = (e) => {
            const rect = card.getBoundingClientRect();
            targetX = e.clientX - rect.left;
            targetY = e.clientY - rect.top;
            active = true;
            if (!raf) raf = requestAnimationFrame(animate);
        };

        function animate() {
            raf = 0;
            curX += (targetX - curX) * 0.25;
            curY += (targetY - curY) * 0.25;

            const edge = getEdgeProximity(card, curX, curY);
            const angle = getCursorAngle(card, curX, curY);

            card.style.setProperty('--edge-proximity', (edge * 100).toFixed(2));
            card.style.setProperty('--cursor-angle', angle.toFixed(2) + 'deg');

            // Lanjut kalau masih bergerak
            if (Math.abs(targetX - curX) > 0.5 || Math.abs(targetY - curY) > 0.5) {
                raf = requestAnimationFrame(animate);
            }
        }

        card.addEventListener('pointermove', onPointerMove, { passive: true });
        card.addEventListener('pointerenter', onPointerMove, { passive: true });
        card.addEventListener('pointerleave', () => {
            active = false;
            card.style.setProperty('--edge-proximity', '0');
        });
    })();

    /* ============================================
       LOGIN LOGIC
       ============================================ */
    const RECAPTCHA_SITE_KEY = '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg';

    const form = document.getElementById('loginForm');
    const alertEl = document.getElementById('alert');
    const alertText = document.getElementById('alert-text');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = document.getElementById('btnText');
    const btnIcon = document.getElementById('btnIcon');
    const passwordInput = document.getElementById('password');
    const togglePassword = document.getElementById('togglePassword');
    const eyeIcon = document.getElementById('eyeIcon');

    const statusRow = document.getElementById('statusRow');
    const statusMark = document.getElementById('statusMark');
    const statusLabel = document.getElementById('statusLabel');

    /* ===== Status Mark Helper ===== */
    function setStatus(status, labelText) {
        if (!statusMark) return;
        statusMark.setAttribute('data-status', status);
        if (statusLabel && labelText) statusLabel.textContent = labelText;

        if (status === 'pending') {
            statusRow.classList.remove('visible');
            statusRow.setAttribute('aria-hidden', 'true');
        } else {
            statusRow.classList.add('visible');
            statusRow.setAttribute('aria-hidden', 'false');
        }
    }

    /* ===== Toggle Password ===== */
    const EYE_OPEN = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
    const EYE_CLOSED = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;

    let passwordVisible = false;
    togglePassword.addEventListener('click', () => {
        passwordVisible = !passwordVisible;
        passwordInput.type = passwordVisible ? 'text' : 'password';
        eyeIcon.innerHTML = passwordVisible ? EYE_CLOSED : EYE_OPEN;
    });

    /* ===== Alert Helper ===== */
    function showAlert(message, type = 'error') {
        alertEl.className = 'alert show ' + type;
        alertText.textContent = message;
    }
    function hideAlert() {
        alertEl.classList.remove('show');
    }

    /* ===== reCAPTCHA ===== */
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

    /* ===== Submit ===== */
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        const username = document.getElementById('username').value.trim();
        const password = passwordInput.value;

        if (!username || !password) {
            showAlert('Username dan password wajib diisi', 'error');
            setStatus('failed', 'Data belum lengkap');
            return;
        }

        // Lock form
        submitBtn.disabled = true;
        btnText.textContent = 'Memproses...';
        if (btnIcon && btnIcon.parentNode) {
            btnIcon.outerHTML = '<div class="spinner" id="btnIcon"></div>';
        }

        setStatus('running', 'Memverifikasi kredensial...');

        try {
            await waitForRecaptcha();

            if (!window.grecaptcha || !window.grecaptcha.execute) {
                throw new Error('Verifikasi keamanan gagal dimuat. Refresh halaman.');
            }

            setStatus('running', 'Memeriksa keamanan...');

            const recaptchaToken = await new Promise((resolve, reject) => {
                grecaptcha.ready(() => {
                    grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'login' })
                        .then(resolve)
                        .catch(reject);
                });
                setTimeout(() => reject(new Error('Timeout verifikasi keamanan')), 10000);
            });

            setStatus('running', 'Menghubungi server...');

            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, recaptcha_token: recaptchaToken })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Login gagal');

            localStorage.setItem('access_token', data.session.access_token);
            localStorage.setItem('user', JSON.stringify(data.user));

            setStatus('done', 'Login berhasil!');
            showAlert('Login berhasil! Mengalihkan...', 'success');

            setTimeout(() => {
                window.location.replace('/dashboard');
            }, 800);

        } catch (err) {
            setStatus('failed', 'Gagal login');
            showAlert(err.message || 'Terjadi kesalahan', 'error');
            submitBtn.disabled = false;
            btnText.textContent = 'Login';
            const oldIcon = document.getElementById('btnIcon');
            if (oldIcon) {
                oldIcon.outerHTML = '<svg class="icon-svg" viewBox="0 0 24 24" id="btnIcon"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
            }

            // Reset status ke pending setelah 3 detik
            setTimeout(() => setStatus('pending', 'Menunggu'), 3000);
        }
    });

})();
