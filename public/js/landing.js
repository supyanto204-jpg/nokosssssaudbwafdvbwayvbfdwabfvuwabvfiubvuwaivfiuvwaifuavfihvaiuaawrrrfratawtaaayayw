/* ============================================
   LANDING PAGE — OPTIMIZED + BFCACHE FIX
   ============================================ */
(function () {
    'use strict';

    /* ============================================
       DETECT DEVICE CAPABILITY
       ============================================ */
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = navigator.connection && navigator.connection.saveData;
    const slowNet = navigator.connection && /(2g|slow-2g)/.test(navigator.connection.effectiveType || '');
    const DISABLE_HEAVY = prefersReduced || saveData || slowNet || isLowEnd;

    const CONFIG = {
        CDN_ICON: 'https://assets.cindigital.id/apps',
        SPIRAL_COUNT: 8,
        FALLBACK_ICONS: [
            { iconCode: 'wa', name: 'WhatsApp' },
            { iconCode: 'tg', name: 'Telegram' },
            { iconCode: 'ig', name: 'Instagram' },
            { iconCode: 'fb', name: 'Facebook' },
            { iconCode: 'fr', name: 'Dana' },
            { iconCode: 'lf', name: 'TikTok' },
            { iconCode: 'ka', name: 'Shopee' },
            { iconCode: 'tw', name: 'Twitter' },
            { iconCode: 'ds', name: 'Discord' },
        ],
        FALLBACK_TEXTTYPE: [
            'Platform OTP cepat & aman',
            'Nomor virtual 1700+ layanan',
            'Kode verifikasi instan',
            'Support 24/7 siap bantu',
        ],
        DISABLE_HEAVY,
        IS_MOBILE: isMobile,
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

    /* ============================================
       REGISTRY — semua module daftar di sini
       biar bisa di-restart waktu balik dari bfcache
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
            }, 1000);
        })();
    })();

    /* ============================================
       AUTO-REDIRECT KALAU SUDAH LOGIN
       ============================================ */
    (async function checkLogin() {
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
            const cur = document.documentElement.getAttribute('data-theme') || 'light';
            const next = cur === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('asyrofotp_theme', next);
            const m = $('meta[name="theme-color"]');
            if (m) m.setAttribute('content', next === 'dark' ? '#0f172a' : '#2563eb');
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
            const h2 = () => {
                lastMouseTime = performance.now();
                userOverride = true;
                wordEls.forEach(w => w.classList.remove('selected'));
                el.classList.add('selected');
            };
            el.addEventListener('mouseenter', h1);
            el.addEventListener('touchstart', h2, { passive: true });
            handlers.push({ el, h1, h2 });
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
                handlers.forEach(({ el, h1, h2 }) => {
                    el.removeEventListener('mouseenter', h1);
                    el.removeEventListener('touchstart', h2);
                });
            },
            function restart() {
                startInterval();
            }
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
       INFINITE SPIRAL
       ============================================ */
    registerModule(function (bind) {
        const stage = $('#spiralStage');
        if (!stage) return;

        const CFG = {
            CARD_W: 64,
            CARD_H: 64,
            RADIUS: CONFIG.IS_MOBILE ? 110 : 150,
            V_SPACE: CONFIG.IS_MOBILE ? 36 : 44,
            TURN: 5,
            SPEED: CONFIG.IS_MOBILE ? 0.35 : 0.45,
            PERSPECTIVE: 900,
            FPS_CAP: CONFIG.DISABLE_HEAVY ? 30 : 60,
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
            const fadeStart = 0.7;

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

                card.style.transform = `translate(-50%,-50%) translate3d(${x.toFixed(1)}px,${(offset * CFG.V_SPACE).toFixed(1)}px,0) scale(${visualScale.toFixed(3)})`;
                card.style.opacity = opacity.toFixed(2);
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
                if (!token) return CONFIG.FALLBACK_ICONS;
                const res = await fetch('/api/nokos/services?server=ekonomi', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) return CONFIG.FALLBACK_ICONS;
                const data = await res.json();
                const services = (data.services || []).filter(s => s.icon_code).slice(0, CONFIG.SPIRAL_COUNT);
                if (services.length < 4) return CONFIG.FALLBACK_ICONS;
                return services.map(s => ({ iconCode: s.icon_code, name: s.name || s.code }));
            } catch (e) {
                return CONFIG.FALLBACK_ICONS;
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
       GRADIENT WAVES — WebGL dengan context lost handling
       ============================================ */
    registerModule(function (bind) {
        const container = $('#gradientWaves');
        if (!container) return;

        // Fallback kalau reduced motion / low-end
        if (CONFIG.DISABLE_HEAVY) {
            container.classList.add('context-lost');
            return;
        }

        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%;';
        container.appendChild(canvas);

        let gl = null;
        let prog = null;
        let uRes = null;
        let uTime = null;
        let uMouse = null;
        let raf = 0;
        let visible = true;
        let lastTime = 0;
        let lastRender = 0;
        const FPS_CAP = 30;
        const FRAME_MIN = 1000 / FPS_CAP;
        let t0 = performance.now();
        let targetMouse = [0.5, 0.5];
        let currentMouse = [0.5, 0.5];
        let contextLost = false;

        const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

        const FRAG = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform vec2 uMouse;
out vec4 fragColor;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float plasma(vec3 r, vec2 freq, vec4 tc) {
    float mx = r.x + tc.x;
    mx += 35.0 * sin((r.y + mx) / 20.0 + tc.y);
    float my = r.y - tc.z;
    my += 20.0 * cos(r.x / 23.0 + tc.w);
    return r.z - (sin(mx * freq.x) * 2.5 + sin(my * freq.y) * 2.5 + 5.5);
}

float raymarch(vec3 pos, vec3 dir, vec2 freq, vec4 tc) {
    float dist = 0.0;
    for (int i = 0; i < 28; i++) {
        float dscene = plasma(pos + dist * dir, freq, tc);
        if (abs(dscene) < 0.15) break;
        dist += 1.1 * dscene;
        if (abs(dist) > 5000.0) return 5000.0;
    }
    return dist;
}

void main() {
    float T = iTime * 0.3;
    vec2 freq = vec2(0.6 / 7.0, (0.6 * 0.9) / 3.0);
    vec4 tc = vec4(T / 0.130, T / 0.810, T / 0.200, T / 0.710);

    vec2 uv = (gl_FragCoord.xy / iResolution.xy) - 0.5;
    uv.x *= iResolution.x / iResolution.y;
    uv.y *= -1.0;

    vec3 dir = vec3(0.0, 0.0, -1.0);
    float ulen = length(uv);
    float xrot = (3.14159 / 2.3) * ulen;
    float c = cos(xrot), s = sin(xrot);
    dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
    vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);
    c = nuv.x; s = nuv.y;
    dir = mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0) * dir;
    c = cos(1.11); s = sin(1.11);
    dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;

    float yaw = (uMouse.x - 0.5) * 0.2;
    float pitch = (uMouse.y - 0.5) * 0.2;
    c = cos(yaw); s = sin(yaw);
    dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;
    c = cos(pitch); s = sin(pitch);
    dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;

    vec3 cam = vec3(0.0, 0.0, 30.0);
    float dist = raymarch(cam, dir, freq, tc);
    vec3 pos = cam + dist * dir;

    float t = clamp(15.0 / max(dist, 0.001), 0.0, 1.0);
    vec3 horizon = vec3(0.32, 0.15, 1.0);
    vec3 wave = vec3(1.0, 0.62, 0.99);
    vec3 crest = vec3(1.0, 1.0, 1.0);
    vec3 body = mix(wave, crest, clamp(pos.z * 0.08 + 0.5, 0.0, 1.0));
    vec3 col = mix(horizon, body, t);
    col = clamp(col, 0.0, 1.0);

    float alpha = clamp(t, 0.0, 1.0) * 0.8;
    float g = hash21(gl_FragCoord.xy + mod(iTime, 64.0) * 11.0);
    alpha += (g - 0.5) * 0.04;
    alpha = clamp(alpha, 0.0, 1.0);
    fragColor = vec4(col * alpha, alpha);
}
`;

        function compile(type, src) {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                console.warn('Shader compile fail:', gl.getShaderInfoLog(sh));
                return null;
            }
            return sh;
        }

        function initGL() {
            try {
                gl = canvas.getContext('webgl2', {
                    alpha: true,
                    premultipliedAlpha: true,
                    antialias: false,
                    depth: false,
                    powerPreference: 'low-power',
                    failIfMajorPerformanceCaveat: false,
                });
                if (!gl) return false;

                const vs = compile(gl.VERTEX_SHADER, VERT);
                const fs = compile(gl.FRAGMENT_SHADER, FRAG);
                if (!vs || !fs) return false;

                prog = gl.createProgram();
                gl.attachShader(prog, vs);
                gl.attachShader(prog, fs);
                gl.linkProgram(prog);
                if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
                gl.useProgram(prog);

                const buf = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
                const loc = gl.getAttribLocation(prog, 'position');
                gl.enableVertexAttribArray(loc);
                gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

                uRes = gl.getUniformLocation(prog, 'iResolution');
                uTime = gl.getUniformLocation(prog, 'iTime');
                uMouse = gl.getUniformLocation(prog, 'uMouse');

                // Context lost handler
                canvas.addEventListener('webglcontextlost', (e) => {
                    e.preventDefault();
                    contextLost = true;
                    container.classList.add('context-lost');
                    stop();
                }, false);

                canvas.addEventListener('webglcontextrestored', () => {
                    contextLost = false;
                    container.classList.remove('context-lost');
                    if (initGL()) {
                        resize();
                        schedule();
                    }
                }, false);

                t0 = performance.now();
                return true;
            } catch (e) {
                console.warn('WebGL init error:', e);
                return false;
            }
        }

        function resize() {
            if (!gl || contextLost) return;
            const r = container.getBoundingClientRect();
            const w = Math.max(1, Math.floor(r.width));
            const h = Math.max(1, Math.floor(r.height));
            const SCALE = CONFIG.IS_MOBILE ? 0.5 : 0.7;
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * SCALE;
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform2f(uRes, canvas.width, canvas.height);
        }

        function frame(now) {
            raf = 0;
            if (!visible || document.hidden || contextLost || !gl) return;

            if (now - lastRender < FRAME_MIN) {
                raf = requestAnimationFrame(frame);
                return;
            }
            lastRender = now;

            currentMouse[0] += 0.08 * (targetMouse[0] - currentMouse[0]);
            currentMouse[1] += 0.08 * (targetMouse[1] - currentMouse[1]);

            gl.uniform1f(uTime, (now - t0) * 0.001);
            gl.uniform2f(uMouse, currentMouse[0], currentMouse[1]);

            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 3);

            raf = requestAnimationFrame(frame);
        }

        function schedule() {
            if (!raf && visible && !document.hidden && !contextLost && gl) {
                lastTime = performance.now();
                lastRender = 0;
                raf = requestAnimationFrame(frame);
            }
        }

        function stop() {
            if (raf) {
                cancelAnimationFrame(raf);
                raf = 0;
            }
        }

        // Init
        if (!initGL()) {
            container.classList.add('context-lost');
            return;
        }
        resize();

        const ro = new ResizeObserver(resize);
        ro.observe(container);

        if (!CONFIG.IS_MOBILE) {
            window.addEventListener('pointermove', (e) => {
                const r = container.getBoundingClientRect();
                targetMouse[0] = (e.clientX - r.left) / r.width;
                targetMouse[1] = 1 - (e.clientY - r.top) / r.height;
            }, { passive: true });
        }

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

        schedule();

        bind(
            function cleanup() {
                stop();
                ro.disconnect();
                io.disconnect();
                document.removeEventListener('visibilitychange', onVis);
                try {
                    const ext = gl.getExtension('WEBGL_lose_context');
                    if (ext) ext.loseContext();
                } catch (e) {}
                gl = null;
            },
            function restart() {
                // Re-init kalau context lost (bfcache)
                if (!gl || contextLost) {
                    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
                    container.innerHTML = '';
                    container.appendChild(canvas);
                    if (initGL()) {
                        resize();
                        schedule();
                    } else {
                        container.classList.add('context-lost');
                    }
                } else {
                    schedule();
                }
            }
        );
    });

    /* ============================================
       MICRO SLATS
       ============================================ */
    registerModule(function (bind) {
        const container = $('#microSlats');
        if (!container) return;
        if (CONFIG.DISABLE_HEAVY) return;

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
        const FRAME_MIN = 1000 / 24;

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

            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const cx = offX + col * pitchX + slatW / 2;
                    const cy = offY + row * pitchY + slatH / 2;

                    const wave1 = Math.sin(col * 0.3 + time * 0.8) * 0.5 + 0.5;
                    const wave2 = Math.cos(row * 0.25 + time * 0.6) * 0.5 + 0.5;
                    const level = (wave1 + wave2) / 2;

                    const alpha = 0.04 + level * 0.28;
                    const curH = slatH * (0.4 + level * 0.6);

                    ctx.fillStyle = `rgba(37,99,235,${alpha.toFixed(3)})`;
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
            if (raf) {
                cancelAnimationFrame(raf);
                raf = 0;
            }
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
       CURSOR GRID
       ============================================ */
    registerModule(function (bind) {
        if (CONFIG.IS_MOBILE) return;
        const canvas = $('#cursorGridCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        const CELL = 70;
        const RADIUS = 140;
        const HOLD = 400;
        const FADE_MS = 800;
        const LINE = 1;
        const MAX_OP = 0.6;
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
       BFCACHE HANDLER — FIX ABU-ABU
       ============================================ */
    window.addEventListener('pageshow', function (event) {
        // Restart semua module — terutama setelah balik dari halaman lain
        // (event.persisted = true artinya diambil dari bfcache)
        if (event.persisted) {
            requestAnimationFrame(() => {
                modules.forEach((m) => {
                    try { if (m.restart) m.restart(); } catch (e) {}
                });
            });
        }
    });

    window.addEventListener('pagehide', function () {
        // Cleanup rapi sebelum keluar
        modules.forEach((m) => {
            try { if (m.cleanup) m.cleanup(); } catch (e) {}
        });
    });

    // Restart juga kalau tab balik visible
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
            modules.forEach((m) => {
                try { if (m.restart) m.restart(); } catch (e) {}
            });
        }
    });

})();
