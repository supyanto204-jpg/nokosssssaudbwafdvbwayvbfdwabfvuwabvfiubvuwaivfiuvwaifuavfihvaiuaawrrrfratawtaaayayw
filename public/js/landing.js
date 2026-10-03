/* ============================================
   LANDING PAGE v8 — Theme Aware + Blur Edge + Mobile
   ============================================ */
(function () {
    'use strict';

    /* ============================================
       DEVICE DETECTION
       ============================================ */
    const isMobile = window.matchMedia('(max-width: 560px)').matches;
    const isTablet = window.matchMedia('(max-width: 900px)').matches;
    const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = navigator.connection && navigator.connection.saveData;
    const DISABLE_HEAVY = prefersReduced || saveData || isLowEnd;

    const CONFIG = {
        CDN_ICON: 'https://assets.cindigital.id/apps',
        SPIRAL_COUNT: isMobile ? 6 : 8,
        FALLBACK_ICONS: [
            { iconCode: 'wa', name: 'WhatsApp' },
            { iconCode: 'tg', name: 'Telegram' },
            { iconCode: 'ig', name: 'Instagram' },
            { iconCode: 'fb', name: 'Facebook' },
            { iconCode: 'fr', name: 'Dana' },
            { iconCode: 'lf', name: 'TikTok' },
            { iconCode: 'ka', name: 'Shopee' },
            { iconCode: 'tw', name: 'Twitter' },
        ],
        FALLBACK_TEXTTYPE: [
            'Platform OTP cepat & aman',
            'Nomor virtual 1700+ layanan',
            'Kode verifikasi instan',
            'Support 24/7 siap bantu',
        ],
        DISABLE_HEAVY,
        IS_MOBILE: isMobile,
        IS_TABLET: isTablet,
    };

    /* ============================================
       UTILS
       ============================================ */
    const $ = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

    function escapeHtml(v) {
        return String(v ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch]);
    }
    function getAppIconUrl(code) {
        const c = String(code || '').trim().toLowerCase();
        if (!c || !/^[a-z0-9_-]+$/.test(c)) return null;
        return `${CONFIG.CDN_ICON}/${c}.png`;
    }
    function throttleRAF(fn) {
        let t = false;
        return function (...a) {
            if (t) return;
            t = true;
            requestAnimationFrame(() => { t = false; fn.apply(this, a); });
        };
    }
    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
    function smoothstep(min, max, v) {
        const x = clamp((v - min) / (max - min || 1), 0, 1);
        return x * x * (3 - 2 * x);
    }
    function getCurrentTheme() {
        return document.documentElement.getAttribute('data-theme') || 'light';
    }

    /* ============================================
       MODULE REGISTRY
       ============================================ */
    const modules = [];
    function registerModule(setup) {
        const m = { cleanup: null, restart: null, instance: null };
        try {
            m.instance = setup((cleanup, restart) => {
                m.cleanup = cleanup;
                m.restart = restart;
            });
        } catch (e) {
            console.warn('Module setup error:', e);
        }
        modules.push(m);
    }

    /* ============================================
       SECURITY
       ============================================ */
    (function security() {
        try {
            console.log('%c⚠️ STOP!', 'color:#dc2626;font-size:20px;font-weight:900;');
            console.log('%cIni fitur browser untuk developer. Kalau ada yang menyuruh kamu paste sesuatu di sini, itu SCAM.', 'color:#64748b;font-size:12px;');
        } catch (e) {}

        document.addEventListener('contextmenu', e => e.preventDefault());
        document.addEventListener('keydown', e => {
            const k = e.key;
            if (k === 'F12') { e.preventDefault(); return false; }
            if (e.ctrlKey && e.shiftKey && ['I','J','C','i','j','c'].includes(k)) { e.preventDefault(); return false; }
            if (e.ctrlKey && ['U','u','S','s','P','p'].includes(k)) { e.preventDefault(); return false; }
        }, true);

        document.addEventListener('copy', e => {
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            e.preventDefault();
        });
        document.addEventListener('cut', e => {
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            e.preventDefault();
        });

        try {
            const cleanUrl = window.location.origin + window.location.pathname;
            if (window.location.search) history.replaceState(null, '', cleanUrl);
        } catch (e) {}

        (function devtoolsLock() {
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
       AUTO REDIRECT
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
        const btn = $('#themeToggle');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const cur = getCurrentTheme();
            const next = cur === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('asyrofotp_theme', next);
            const m = $('meta[name="theme-color"]');
            if (m) m.setAttribute('content', next === 'dark' ? '#0f172a' : '#2563eb');
            // Trigger theme change event for dependent modules
            window.dispatchEvent(new CustomEvent('asyrof-theme-change', { detail: { theme: next } }));
        });
    })();

    /* ============================================
       NAVBAR
       ============================================ */
    (function navScroll() {
        const nav = $('#mainNav');
        if (!nav) return;
        const onScroll = throttleRAF(() => nav.classList.toggle('scrolled', window.scrollY > 10));
        window.addEventListener('scroll', onScroll, { passive: true });
    })();

    /* ============================================
       FAQ
       ============================================ */
    (function faq() {
        $$('.faq-question').forEach(btn => {
            btn.addEventListener('click', () => {
                const item = btn.parentElement;
                const active = item.classList.contains('active');
                $$('.faq-item').forEach(i => i.classList.remove('active'));
                if (!active) item.classList.add('active');
            });
        });
    })();

    /* ============================================
       SCROLL REVEAL
       ============================================ */
    (function reveal() {
        const els = $$('.reveal');
        if (els.length === 0) return;
        if (!('IntersectionObserver' in window) || CONFIG.DISABLE_HEAVY) {
            els.forEach(el => el.classList.add('in-view'));
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry, i) => {
                if (entry.isIntersecting) {
                    setTimeout(() => entry.target.classList.add('in-view'), i * 50);
                    io.unobserve(entry.target);
                }
            });
        }, { rootMargin: '0px 0px -60px 0px', threshold: 0.1 });
        els.forEach(el => io.observe(el));
    })();

    /* ============================================
       BACK TO TOP
       ============================================ */
    (function backToTop() {
        const btn = $('#backToTop');
        if (!btn) return;
        const onScroll = throttleRAF(() => btn.classList.toggle('visible', window.scrollY > 400));
        window.addEventListener('scroll', onScroll, { passive: true });
        btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    })();

    /* ============================================
       SMOOTH ANCHOR
       ============================================ */
    (function anchor() {
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[href^="#"]');
            if (!link) return;
            const href = link.getAttribute('href');
            if (!href || href === '#' || href.length < 2) return;
            const target = document.querySelector(href);
            if (!target) return;
            e.preventDefault();
            const nav = $('#mainNav');
            const navH = nav ? nav.offsetHeight : 0;
            const top = target.getBoundingClientRect().top + window.scrollY - navH - 12;
            window.scrollTo({ top, behavior: 'smooth' });
        });
    })();

    /* ============================================
       TECHTEXT
       ============================================ */
    registerModule(function (bind) {
        const title = $('#techTitle');
        if (!title) return;
        const words = [
            { text: 'Digital', highlight: true },
            { text: 'Mudah,', highlight: false },
            { text: 'Tanpa', highlight: false },
            { text: 'Perlu', highlight: false },
            { text: 'Ribet', highlight: true },
        ];
        title.innerHTML = words.map((w, i) => `
            <span class="tech-word ${w.highlight ? 'highlight' : ''}" data-index="${i}">
                ${escapeHtml(w.text)}
                <span class="tech-handle-br"></span>
            </span>
        `).join('');

        const wordEls = $$('.tech-word', title);
        if (wordEls.length === 0) return;

        let lastMouseTime = 0;
        let autoIndex = 0;
        let userOverride = false;
        let intervalId = null;
        const handlers = [];

        wordEls.forEach(el => {
            const h1 = () => {
                lastMouseTime = performance.now();
                userOverride = true;
                wordEls.forEach(w => w.classList.remove('selected'));
                el.classList.add('selected');
            };
            el.addEventListener('mouseenter', h1);
            el.addEventListener('touchstart', h1, { passive: true });
            handlers.push({ el, h1 });
        });

        wordEls[0].classList.add('selected');

        function startInterval() {
            if (intervalId) clearInterval(intervalId);
            intervalId = setInterval(() => {
                const idle = performance.now() - lastMouseTime > 2500;
                if (!userOverride || idle || CONFIG.IS_MOBILE) {
                    userOverride = false;
                    wordEls.forEach(w => w.classList.remove('selected'));
                    wordEls[autoIndex].classList.add('selected');
                    autoIndex = (autoIndex + 1) % wordEls.length;
                }
            }, 2000);
        }
        startInterval();

        bind(
            function cleanup() {
                if (intervalId) clearInterval(intervalId);
                handlers.forEach(({ el, h1 }) => el.removeEventListener('mouseenter', h1));
            },
            function restart() { startInterval(); }
        );
    });

    /* ============================================
       TEXTTYPE
       ============================================ */
    registerModule(function (bind) {
        const el = $('#textType');
        const cursor = $('#textTypeCursor');
        if (!el) return;
        const texts = CONFIG.FALLBACK_TEXTTYPE;

        if (CONFIG.DISABLE_HEAVY) {
            el.textContent = texts[0];
            if (cursor) cursor.style.display = 'none';
            return;
        }

        let idx = 0, charIdx = 0, deleting = false, timer = null, started = false;
        const TYPE_MS = 70;
        const DEL_MS = 35;
        const PAUSE = 1800;

        function tick() {
            const cur = texts[idx];
            if (!deleting) {
                if (charIdx < cur.length) {
                    el.textContent = cur.slice(0, ++charIdx);
                    timer = setTimeout(tick, TYPE_MS);
                } else {
                    timer = setTimeout(() => { deleting = true; tick(); }, PAUSE);
                }
            } else {
                if (charIdx > 0) {
                    el.textContent = cur.slice(0, --charIdx);
                    timer = setTimeout(tick, DEL_MS);
                } else {
                    deleting = false;
                    idx = (idx + 1) % texts.length;
                    timer = setTimeout(tick, 400);
                }
            }
        }
        function start() {
            if (started) return;
            started = true;
            timer = setTimeout(tick, 400);
        }

        let io = null;
        if ('IntersectionObserver' in window) {
            io = new IntersectionObserver((entries) => {
                entries.forEach(en => {
                    if (en.isIntersecting) { start(); io.disconnect(); }
                });
            }, { threshold: 0.3 });
            io.observe(el);
        } else start();

        const onVis = () => {
            if (document.hidden) clearTimeout(timer);
            else if (started) { clearTimeout(timer); tick(); }
        };
        document.addEventListener('visibilitychange', onVis);

        bind(
            function cleanup() {
                clearTimeout(timer);
                if (io) io.disconnect();
                document.removeEventListener('visibilitychange', onVis);
            },
            function restart() {
                started = false;
                idx = 0;
                charIdx = 0;
                deleting = false;
                start();
            }
        );
    });

    /* ============================================
       INFINITE SPIRAL — dengan EDGE BLUR
       ============================================ */
    registerModule(function (bind) {
        const stage = $('#spiralStage');
        if (!stage) return;

        const CFG = {
            CARD_W: CONFIG.IS_MOBILE ? 52 : 64,
            CARD_H: CONFIG.IS_MOBILE ? 52 : 64,
            RADIUS: CONFIG.IS_MOBILE ? 100 : (CONFIG.IS_TABLET ? 130 : 150),
            V_SPACE: CONFIG.IS_MOBILE ? 32 : 44,
            TURN: CONFIG.IS_MOBILE ? 4 : 5,
            SPEED: CONFIG.IS_MOBILE ? 0.3 : 0.45,
            PERSPECTIVE: 900,
            FPS_CAP: CONFIG.DISABLE_HEAVY ? 24 : (isMobile ? 30 : 60),
        };
        const FRAME_MIN = 1000 / CFG.FPS_CAP;

        let items = [];
        let cards = [];
        let progress = 0;
        let targetProgress = 0;
        let autoSpeed = 0;
        let cardW = CFG.CARD_W, cardH = CFG.CARD_H, radius = CFG.RADIUS;
        let w = 1, h = 1;
        let raf = 0;
        let lastTime = 0;
        let lastRender = 0;
        let visible = true;
        let hovered = false;
        let dragging = false;
        let lastPY = 0;

        function buildCards(list) {
            stage.innerHTML = '';
            cards = [];
            const frag = document.createDocumentFragment();
            list.forEach((item) => {
                const el = document.createElement('div');
                el.className = 'spiral-item';
                el.setAttribute('role', 'listitem');
                el.setAttribute('aria-label', item.name);
                const url = getAppIconUrl(item.iconCode);
                const initial = String(item.name || '?').charAt(0).toUpperCase();
                if (url) {
                    const img = document.createElement('img');
                    img.src = url;
                    img.alt = item.name;
                    img.loading = 'lazy';
                    img.decoding = 'async';
                    img.addEventListener('error', function () {
                        this.style.display = 'none';
                        const fb = document.createElement('span');
                        fb.className = 'icon-fallback';
                        fb.textContent = initial;
                        this.parentNode.appendChild(fb);
                    }, { once: true });
                    el.appendChild(img);
                } else {
                    const fb = document.createElement('span');
                    fb.className = 'icon-fallback';
                    fb.textContent = initial;
                    el.appendChild(fb);
                }
                frag.appendChild(el);
                cards.push(el);
            });
            stage.appendChild(frag);
        }

        function resize() {
            const r = stage.getBoundingClientRect();
            w = Math.max(r.width, 1);
            h = Math.max(r.height, 1);
            const fit = Math.min(1, w / (CFG.CARD_W * 3.2), h / (CFG.CARD_H * 2.5));
            cardW = CFG.CARD_W * fit;
            cardH = CFG.CARD_H * fit;
            radius = Math.min(CFG.RADIUS, w * 0.32) * fit;
            cards.forEach(c => {
                c.style.width = cardW + 'px';
                c.style.height = cardH + 'px';
            });
        }

        function render(time) {
            raf = 0;
            if (!visible || document.hidden) return;

            if (time - lastRender < FRAME_MIN) {
                raf = requestAnimationFrame(render);
                return;
            }
            lastRender = time;

            const dt = Math.min((time - lastTime) / 1000, 0.05);
            lastTime = time;

            const paused = dragging || hovered;
            const desired = !CONFIG.DISABLE_HEAVY && !paused ? CFG.SPEED : 0;
            autoSpeed += (desired - autoSpeed) * (1 - Math.exp(-dt * 7));
            targetProgress += autoSpeed * dt;
            progress += (targetProgress - progress) * (1 - Math.exp(-dt * (dragging ? 22 : 11)));

            const count = cards.length;
            const half = count / 2;
            const turnSize = CFG.TURN;
            const fadeStart = 0.6;

            for (let i = 0; i < count; i++) {
                const card = cards[i];
                let offset = i - progress;
                offset = ((offset + half) % count + count) % count - half;

                const edge = Math.min(Math.abs(offset) / Math.max(half, 1), 1);
                const opacity = 1 - smoothstep(fadeStart, 1, edge);
                const focus = 1 - Math.min(Math.abs(offset) / Math.max(turnSize * 0.65, 1), 1);
                const scale = 1 + 0.15 * focus;
                const angle = offset * (360 / turnSize);
                const rad = angle * Math.PI / 180;
                const x = Math.sin(rad) * radius;
                const z = Math.cos(rad) * radius;
                const depthScale = clamp(CFG.PERSPECTIVE / Math.max(CFG.PERSPECTIVE - z, 1), 0.72, 1.45);
                const visualScale = scale * depthScale;
                const depth = (z / radius + 1) / 2;
                // EDGE FADE: makin ke pinggir makin blur + transparan
const blurPx = CONFIG.DISABLE_HEAVY ? 0 : (8 * smoothstep(0.3, 1, edge));
const edgeFade = 1 - smoothstep(0.5, 1, edge) * 0.7; // tetep dikit solid sampai edge

                card.style.transform = `translate(-50%,-50%) translate3d(${x.toFixed(1)}px,${(offset * CFG.V_SPACE).toFixed(1)}px,0) scale(${visualScale.toFixed(3)})`;
                card.style.opacity = (opacity * edgeFade).toFixed(2);
                card.style.filter = blurPx > 0.01 ? `blur(${blurPx.toFixed(1)}px)` : 'none';
                card.style.zIndex = String(Math.round(depth * 100) + i);
            }

            raf = requestAnimationFrame(render);
        }

        function schedule() {
            if (!raf && visible && !document.hidden) {
                lastTime = performance.now();
                lastRender = 0;
                raf = requestAnimationFrame(render);
            }
        }

        function stop() {
            if (raf) {
                cancelAnimationFrame(raf);
                raf = 0;
            }
        }

        async function fetchIcons() {
            try {
                const token = localStorage.getItem('access_token');
                if (!token) return CONFIG.FALLBACK_ICONS.slice(0, CONFIG.SPIRAL_COUNT);
                const res = await fetch('/api/nokos/services?server=ekonomi', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) return CONFIG.FALLBACK_ICONS.slice(0, CONFIG.SPIRAL_COUNT);
                const data = await res.json();
                const services = (data.services || []).filter(s => s.icon_code).slice(0, CONFIG.SPIRAL_COUNT);
                if (services.length < 4) return CONFIG.FALLBACK_ICONS.slice(0, CONFIG.SPIRAL_COUNT);
                return services.map(s => ({ iconCode: s.icon_code, name: s.name || s.code }));
            } catch (e) {
                return CONFIG.FALLBACK_ICONS.slice(0, CONFIG.SPIRAL_COUNT);
            }
        }

        const ro = new ResizeObserver(() => resize());
        ro.observe(stage);

        const io = new IntersectionObserver(([en]) => {
            visible = en.isIntersecting;
            if (visible) schedule();
            else stop();
        }, { threshold: 0.05 });
        io.observe(stage);

        stage.addEventListener('mouseenter', () => { hovered = true; });
        stage.addEventListener('mouseleave', () => { hovered = false; });

        stage.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            dragging = true;
            lastPY = e.clientY;
            targetProgress = progress;
            try { stage.setPointerCapture(e.pointerId); } catch (_) {}
        });
        stage.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const dy = e.clientY - lastPY;
            lastPY = e.clientY;
            targetProgress -= dy / Math.max(CFG.V_SPACE, 1);
        });
        const stopDrag = (e) => {
            dragging = false;
            try { stage.releasePointerCapture?.(e.pointerId); } catch (_) {}
        };
        stage.addEventListener('pointerup', stopDrag);
        stage.addEventListener('pointercancel', stopDrag);

        const onVis = () => {
            if (document.hidden) stop();
            else if (visible) schedule();
        };
        document.addEventListener('visibilitychange', onVis);

        (async function init() {
            items = await fetchIcons();
            buildCards(items);
            resize();
            schedule();
        })();

        bind(
            function cleanup() {
                stop();
                ro.disconnect();
                io.disconnect();
                document.removeEventListener('visibilitychange', onVis);
            },
            function restart() {
                resize();
                schedule();
            }
        );
    });

    /* ============================================
       MICRO SLATS — Theme aware
       ============================================ */
    registerModule(function (bind) {
        const container = $('#bgMicroslats');
        if (!container) return;
        if (CONFIG.DISABLE_HEAVY) return;
        if (isMobile) return;

        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%;';
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        let w = 1, h = 1;
        let cols = 1, rows = 1;
        let offX = 0, offY = 0;
        const slatW = 8, slatH = 22, gap = 4;
        let raf = 0;
        let time = 0;
        let visible = true;
        let lastRender = 0;
        const FRAME_MIN = 1000 / (isTablet ? 20 : 24);

        function resize() {
            const r = container.getBoundingClientRect();
            w = Math.max(1, r.width);
            h = Math.max(1, r.height);
            canvas.width = Math.floor(w);
            canvas.height = Math.floor(h);
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            ctx.setTransform(1, 0, 0, 1, 0, 0);

            const pitchX = slatW + gap;
            const pitchY = slatH + gap;
            cols = Math.ceil((w + gap) / pitchX) + 1;
            rows = Math.ceil((h + gap) / pitchY) + 1;
            offX = (w - (cols * pitchX - gap)) / 2;
            offY = (h - (rows * pitchY - gap)) / 2;
        }

        function getSlatColor() {
            const isDark = getCurrentTheme() === 'dark';
            return isDark ? '147,197,253' : '37,99,235';
        }

        function render(now) {
            raf = 0;
            if (!visible || document.hidden) return;
            if (now - lastRender < FRAME_MIN) {
                raf = requestAnimationFrame(render);
                return;
            }
            lastRender = now;
            time += 0.016;

            ctx.clearRect(0, 0, w, h);

            const pitchX = slatW + gap;
            const pitchY = slatH + gap;
            const colorRgb = getSlatColor();

            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const cx = offX + col * pitchX + slatW / 2;
                    const cy = offY + row * pitchY + slatH / 2;

                    const wave1 = Math.sin(col * 0.3 + time * 0.8) * 0.5 + 0.5;
                    const wave2 = Math.cos(row * 0.25 + time * 0.6) * 0.5 + 0.5;
                    const level = (wave1 + wave2) / 2;

                    const alpha = 0.04 + level * 0.28;
                    const curH = slatH * (0.4 + level * 0.6);

                    ctx.fillStyle = `rgba(${colorRgb},${alpha.toFixed(3)})`;
                    ctx.fillRect(cx - slatW / 2, cy - curH / 2, slatW, curH);
                }
            }

            raf = requestAnimationFrame(render);
        }

        function schedule() {
            if (!raf && visible && !document.hidden) {
                lastRender = 0;
                raf = requestAnimationFrame(render);
            }
        }

        function stop() {
            if (raf) { cancelAnimationFrame(raf); raf = 0; }
        }

        const ro = new ResizeObserver(() => { resize(); schedule(); });
        ro.observe(container);
        resize();

        const io = new IntersectionObserver(([en]) => {
            visible = en.isIntersecting;
            if (visible) schedule();
            else stop();
        }, { threshold: 0 });
        io.observe(container);

        const onVis = () => {
            if (document.hidden) stop();
            else schedule();
        };
        document.addEventListener('visibilitychange', onVis);

        // Theme change — warna slat ganti
        window.addEventListener('asyrof-theme-change', () => schedule());

        schedule();

        bind(
            function cleanup() {
                stop();
                ro.disconnect();
                io.disconnect();
                document.removeEventListener('visibilitychange', onVis);
            },
            function restart() {
                resize();
                schedule();
            }
        );
    });

    /* ============================================
       CURSOR GRID — Theme aware
       ============================================ */
    registerModule(function (bind) {
        if (isMobile) return;
        if (prefersReduced) return;

        const canvas = $('#cursorGridCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        const CELL = 70;
        const RADIUS = 140;
        const HOLD = 400;
        const FADE_MS = 800;
        const LINE = 1;
        const MAX_OP = 0.65;

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

        function getGridColor() {
            const isDark = getCurrentTheme() === 'dark';
            return isDark ? [147, 197, 253] : [37, 99, 235];
        }

        function rebuild() {
            const r = canvas.getBoundingClientRect();
            w = Math.max(1, r.width);
            h = Math.max(1, r.height);
            canvas.width = Math.floor(w);
            canvas.height = Math.floor(h);
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
            const [cr, cg, cb] = getGridColor();

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
            if (raf) { cancelAnimationFrame(raf); raf = 0; }
            running = false;
        }

        const onPointerMove = (e) => {
            const r = canvas.getBoundingClientRect();
            const x = e.clientX - r.left;
            const y = e.clientY - r.top;
            if (x < 0 || y < 0 || x > w || y > h) return;
            energize(x, y);
            wake();
        };
        const onPointerDown = (e) => {
            const r = canvas.getBoundingClientRect();
            const x = e.clientX - r.left;
            const y = e.clientY - r.top;
            if (x < 0 || y < 0 || x > w || y > h) return;
            energize(x, y);
            wake();
        };
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        window.addEventListener('pointerdown', onPointerDown, { passive: true });

        const ro = new ResizeObserver(() => { rebuild(); wake(); });
        ro.observe(canvas);
        rebuild();

        const io = new IntersectionObserver(([en]) => {
            visible = en.isIntersecting;
            if (visible) wake();
            else stop();
        }, { threshold: 0 });
        io.observe(canvas);

        const onVis = () => {
            if (document.hidden) stop();
            else wake();
        };
        document.addEventListener('visibilitychange', onVis);

        // Theme change — warna grid ganti
        window.addEventListener('asyrof-theme-change', () => wake());

        wake();

        bind(
            function cleanup() {
                stop();
                ro.disconnect();
                io.disconnect();
                document.removeEventListener('visibilitychange', onVis);
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerdown', onPointerDown);
            },
            function restart() {
                rebuild();
                wake();
            }
        );
    });

    /* ============================================
       BFCACHE HANDLER
       ============================================ */
    window.addEventListener('pageshow', function (event) {
        if (event.persisted) {
            requestAnimationFrame(() => {
                modules.forEach((m) => {
                    try { if (m.restart) m.restart(); } catch (e) {}
                });
            });
        }
    });

    window.addEventListener('pagehide', function () {
        modules.forEach((m) => {
            try { if (m.cleanup) m.cleanup(); } catch (e) {}
        });
    });

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
            modules.forEach((m) => {
                try { if (m.restart) m.restart(); } catch (e) {}
            });
        }
    });

})();
