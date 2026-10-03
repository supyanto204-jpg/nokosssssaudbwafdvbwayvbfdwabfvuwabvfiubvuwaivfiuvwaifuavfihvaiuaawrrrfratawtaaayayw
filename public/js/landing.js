/* ============================================
   LANDING PAGE — MAIN SCRIPT
   ============================================ */
(function () {
    'use strict';

    /* ============================================
       CONFIG
       ============================================ */
    const CONFIG = {
        CDN_ICON: 'https://assets.cindigital.id/apps',
        SPIRAL_COUNT: 8,
        FALLBACK_ICONS: [
            { iconCode: 'whatsapp', name: 'WhatsApp' },
            { iconCode: 'telegram', name: 'Telegram' },
            { iconCode: 'instagram', name: 'Instagram' },
            { iconCode: 'facebook', name: 'Facebook' },
            { iconCode: 'google', name: 'Google' },
            { iconCode: 'tiktok', name: 'TikTok' },
            { iconCode: 'shopee', name: 'Shopee' },
            { iconCode: 'twitter', name: 'Twitter' },
        ],
        FALLBACK_TEXTTYPE: [
            'Platform OTP cepat & aman',
            'Nomor virtual 1700+ layanan',
            'Kode verifikasi instan',
            'Support 24/7 siap bantu',
        ],
        REDUCED_MOTION: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        IS_MOBILE: window.matchMedia('(max-width: 900px)').matches,
    };

    /* ============================================
       UTILITIES
       ============================================ */
    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

    function getAppIconUrl(iconCode) {
        const code = String(iconCode || '').trim().toLowerCase();
        if (!code || !/^[a-z0-9_-]+$/.test(code)) return null;
        return `${CONFIG.CDN_ICON}/${code}.png`;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[ch]);
    }

    function throttleRAF(fn) {
        let ticking = false;
        return function (...args) {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                ticking = false;
                fn.apply(this, args);
            });
        };
    }

    /* ============================================
       SECURITY HARDENING
       ============================================ */
    (function securityHardening() {
        try {
            const style = 'color:#dc2626;font-size:20px;font-weight:900;';
            const styleSub = 'color:#64748b;font-size:12px;';
            console.log('%c⚠️ STOP!', style);
            console.log('%cIni fitur browser untuk developer. Kalau ada yang menyuruh kamu paste sesuatu di sini, itu SCAM.', styleSub);
            console.log('%cJangan pernah share password, token, atau data pribadi di sini.', styleSub);
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

        // DevTools lock detection
        (function () {
            const LOCK_FLAG = 'asyrof_devtools_lock';
            const W_THRESHOLD = 200;
            const H_THRESHOLD = 200;

            function shouldSkip() {
                if (navigator.maxTouchPoints > 0 && window.innerWidth < 1024) return true;
                if (window.innerWidth < 600) return true;
                return false;
            }
            function isOpen() {
                if (shouldSkip()) return false;
                const wd = window.outerWidth - window.innerWidth;
                const hd = window.outerHeight - window.innerHeight;
                return wd > W_THRESHOLD || hd > H_THRESHOLD;
            }
            if (sessionStorage.getItem(LOCK_FLAG) === '1') return;
            setInterval(() => {
                if (isOpen()) {
                    try { sessionStorage.setItem(LOCK_FLAG, '1'); } catch (e) {}
                    try {
                        document.body.style.cssText = '';
                        document.documentElement.style.cssText = '';
                        document.body.classList.remove('modal-open', 'sidebar-open', 'sheet-open');
                    } catch (e) {}
                    document.body.innerHTML = '';
                    window.location.reload();
                }
            }, 700);
        })();
    })();

    /* ============================================
       AUTO-REDIRECT KALAU SUDAH LOGIN
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
    (function initTheme() {
        const btn = $('#themeToggle');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const cur = document.documentElement.getAttribute('data-theme') || 'light';
            const next = cur === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('asyrofotp_theme', next);
            const meta = $('meta[name="theme-color"]');
            if (meta) meta.setAttribute('content', next === 'dark' ? '#0f172a' : '#2563eb');
        });
    })();

    /* ============================================
       NAVBAR SCROLL
       ============================================ */
    (function initNavScroll() {
        const nav = $('#mainNav');
        if (!nav) return;
        const onScroll = throttleRAF(() => {
            nav.classList.toggle('scrolled', window.scrollY > 10);
        });
        window.addEventListener('scroll', onScroll, { passive: true });
    })();

    /* ============================================
       FAQ ACCORDION
       ============================================ */
    (function initFaq() {
        $$('.faq-question').forEach(button => {
            button.addEventListener('click', () => {
                const item = button.parentElement;
                const isActive = item.classList.contains('active');
                $$('.faq-item').forEach(i => i.classList.remove('active'));
                if (!isActive) item.classList.add('active');
            });
        });
    })();

    /* ============================================
       SCROLL REVEAL
       ============================================ */
    (function initReveal() {
        const els = $$('.reveal');
        if (els.length === 0) return;
        if (!('IntersectionObserver' in window) || CONFIG.REDUCED_MOTION) {
            els.forEach(el => el.classList.add('in-view'));
            return;
        }
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry, i) => {
                if (entry.isIntersecting) {
                    setTimeout(() => entry.target.classList.add('in-view'), i * 80);
                    io.unobserve(entry.target);
                }
            });
        }, { rootMargin: '0px 0px -80px 0px', threshold: 0.1 });
        els.forEach(el => io.observe(el));
    })();

    /* ============================================
       BACK TO TOP
       ============================================ */
    (function initBackToTop() {
        const btn = $('#backToTop');
        if (!btn) return;
        const onScroll = throttleRAF(() => {
            btn.classList.toggle('visible', window.scrollY > 400);
        });
        window.addEventListener('scroll', onScroll, { passive: true });
        btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    })();

    /* ============================================
       SMOOTH ANCHOR
       ============================================ */
    (function initSmoothAnchor() {
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
       TECHTEXT — Word Selection Box
       ============================================ */
    (function initTechTitle() {
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
        let hasMouse = false;
        let autoIndex = 0;
        let userOverride = false;

        // Desktop hover
        wordEls.forEach((el) => {
            el.addEventListener('mouseenter', () => {
                hasMouse = true;
                lastMouseTime = performance.now();
                userOverride = true;
                wordEls.forEach(w => w.classList.remove('selected'));
                el.classList.add('selected');
            });
        });

        // Mobile tap
        wordEls.forEach((el) => {
            el.addEventListener('touchstart', (e) => {
                hasMouse = true;
                lastMouseTime = performance.now();
                userOverride = true;
                wordEls.forEach(w => w.classList.remove('selected'));
                el.classList.add('selected');
            }, { passive: true });
        });

        // Auto cycle (mobile / idle)
        wordEls[0].classList.add('selected');
        setInterval(() => {
            const idle = performance.now() - lastMouseTime > 2500;
            const shouldAuto = !userOverride || idle || CONFIG.IS_MOBILE;
            if (shouldAuto) {
                userOverride = false;
                wordEls.forEach(w => w.classList.remove('selected'));
                wordEls[autoIndex].classList.add('selected');
                autoIndex = (autoIndex + 1) % wordEls.length;
            }
        }, 1800);
    })();

    /* ============================================
       TEXTTYPE — Typing effect (tanpa GSAP)
       ============================================ */
    (function initTextType() {
        const el = $('#textType');
        const cursor = $('#textTypeCursor');
        if (!el) return;

        const texts = CONFIG.FALLBACK_TEXTTYPE;
        let currentTextIdx = 0;
        let currentCharIdx = 0;
        let isDeleting = false;
        let timer = null;
        let started = false;

        const TYPE_SPEED = 65;
        const DELETE_SPEED = 35;
        const PAUSE = 1800;
        const INIT_DELAY = 400;

        function tick() {
            const currentText = texts[currentTextIdx];
            if (!isDeleting) {
                if (currentCharIdx < currentText.length) {
                    el.textContent = currentText.slice(0, currentCharIdx + 1);
                    currentCharIdx++;
                    timer = setTimeout(tick, TYPE_SPEED + Math.random() * 40);
                } else {
                    timer = setTimeout(() => {
                        isDeleting = true;
                        tick();
                    }, PAUSE);
                }
            } else {
                if (currentCharIdx > 0) {
                    el.textContent = currentText.slice(0, currentCharIdx - 1);
                    currentCharIdx--;
                    timer = setTimeout(tick, DELETE_SPEED);
                } else {
                    isDeleting = false;
                    currentTextIdx = (currentTextIdx + 1) % texts.length;
                    timer = setTimeout(tick, 400);
                }
            }
        }

        function start() {
            if (started) return;
            started = true;
            timer = setTimeout(tick, INIT_DELAY);
        }

        if (CONFIG.REDUCED_MOTION) {
            el.textContent = texts[0];
            if (cursor) cursor.style.display = 'none';
            return;
        }

        // Start saat visible
        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        start();
                        io.disconnect();
                    }
                });
            }, { threshold: 0.3 });
            io.observe(el);
        } else {
            start();
        }

        // Pause kalau tab hidden
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                clearTimeout(timer);
            } else if (started) {
                clearTimeout(timer);
                tick();
            }
        });
    })();

    /* ============================================
       INFINITE SPIRAL — Icon apps dari backend
       ============================================ */
    (function initSpiral() {
        const stage = $('#spiralStage');
        if (!stage) return;

        const CARD_W = 64;
        const CARD_H = 64;
        const RADIUS = 150;
        const VERTICAL_SPACING = 44;
        const CARDS_PER_TURN = 5;
        const SPEED = CONFIG.IS_MOBILE ? 0.4 : 0.5;
        const PERSPECTIVE = 900;

        let items = [];
        let progress = 0;
        let autoSpeed = 0;
        let cards = [];
        let cardWidth = CARD_W;
        let cardHeight = CARD_H;
        let radius = RADIUS;
        let w = 1, h = 1;
        let raf = 0;
        let lastTime = 0;
        let visible = true;
        let hovered = false;
        let dragging = false;
        let lastPointerY = 0;
        let dragMoved = false;
        let targetProgress = 0;

        const reduced = CONFIG.REDUCED_MOTION;

        function buildCards(list) {
            stage.innerHTML = '';
            cards = [];
            const frag = document.createDocumentFragment();
            list.forEach((item, i) => {
                const el = document.createElement('div');
                el.className = 'spiral-item';
                el.setAttribute('role', 'listitem');
                el.setAttribute('aria-label', item.name);
                el.style.width = CARD_W + 'px';
                el.style.height = CARD_H + 'px';

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
            const rect = stage.getBoundingClientRect();
            w = Math.max(rect.width, 1);
            h = Math.max(rect.height, 1);
            const fit = Math.min(1, w / (CARD_W * 3.2), h / (CARD_H * 2.5));
            cardWidth = CARD_W * fit;
            cardHeight = CARD_H * fit;
            radius = Math.min(RADIUS, w * 0.32) * fit;
        }

        function render(time) {
            raf = 0;
            if (!visible || document.hidden) return;
            const dt = Math.min((time - lastTime) / 1000, 0.05);
            lastTime = time;

            // Auto speed
            const autoEnabled = !reduced;
            const motionPaused = dragging || hovered;
            const desired = autoEnabled && !motionPaused ? SPEED : 0;
            autoSpeed += (desired - autoSpeed) * (1 - Math.exp(-dt * 7));
            targetProgress += autoSpeed * dt;

            // Follow
            progress += (targetProgress - progress) * (1 - Math.exp(-dt * (dragging ? 22 : 11)));

            const count = cards.length;
            const half = count / 2;
            const turnSize = Math.max(CARDS_PER_TURN, 1);
            const edgeFade = 0.3;
            const fadeStart = 1 - edgeFade;

            cards.forEach((card, i) => {
                let offset = i - progress;
                offset = ((offset + half) % count + count) % count - half;
                const edge = Math.min(Math.abs(offset) / Math.max(half, 1), 1);
                const opacity = 1 - smoothstep(fadeStart, 1, edge);
                const focus = 1 - Math.min(Math.abs(offset) / Math.max(turnSize * 0.65, 1), 1);
                const scale = (1 + 0.15 * focus);
                const angle = offset * (360 / turnSize);
                const rad = angle * Math.PI / 180;
                const x = Math.sin(rad) * radius;
                const z = Math.cos(rad) * radius;
                const depthScale = clamp(PERSPECTIVE / Math.max(PERSPECTIVE - z, 1), 0.72, 1.45);
                const visualScale = scale * depthScale;
                const depth = (z / radius + 1) / 2;
                const blur = 5 * smoothstep(0.35, 1, edge);

                card.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${offset * VERTICAL_SPACING}px, 0) scale(${visualScale})`;
                card.style.opacity = opacity.toFixed(3);
                card.style.filter = blur > 0.01 ? `blur(${blur.toFixed(2)}px)` : 'none';
                card.style.zIndex = String(Math.round(depth * 10000) + i);
            });

            scheduleFrame();
        }

        function smoothstep(min, max, val) {
            const x = clamp((val - min) / (max - min || 1), 0, 1);
            return x * x * (3 - 2 * x);
        }
        function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

        function scheduleFrame() {
            if (!raf) raf = requestAnimationFrame(render);
        }

        // Init
        async function fetchIcons() {
            try {
                const token = localStorage.getItem('access_token');
                if (!token) return CONFIG.FALLBACK_ICONS;
                const res = await fetch('/api/nokos/services?server=ekonomi', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) return CONFIG.FALLBACK_ICONS;
                const data = await res.json();
                const services = data.services || [];
                if (services.length === 0) return CONFIG.FALLBACK_ICONS;

                // Ambil icon yang punya icon_code
                const mapped = services
                    .filter(s => s.icon_code)
                    .slice(0, CONFIG.SPIRAL_COUNT)
                    .map(s => ({
                        iconCode: s.icon_code,
                        name: s.name || s.code,
                    }));

                return mapped.length >= 4 ? mapped : CONFIG.FALLBACK_ICONS;
            } catch (e) {
                return CONFIG.FALLBACK_ICONS;
            }
        }

        (async function init() {
            items = await fetchIcons();
            buildCards(items);
            resize();
            scheduleFrame();

            const ro = new ResizeObserver(() => { resize(); });
            ro.observe(stage);

            const io = new IntersectionObserver(([entry]) => {
                visible = entry.isIntersecting;
                if (visible) scheduleFrame();
            }, { threshold: 0.05 });
            io.observe(stage);

            // Hover
            stage.addEventListener('mouseenter', () => { hovered = true; });
            stage.addEventListener('mouseleave', () => { hovered = false; });

            // Drag
            stage.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                dragging = true;
                dragMoved = false;
                lastPointerY = e.clientY;
                targetProgress = progress;
                try { stage.setPointerCapture(e.pointerId); } catch (_) {}
            });
            stage.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                const dy = e.clientY - lastPointerY;
                lastPointerY = e.clientY;
                if (Math.abs(dy) > 0.5) dragMoved = true;
                targetProgress -= dy / Math.max(VERTICAL_SPACING, 1);
            });
            const stopDrag = () => { dragging = false; try { stage.releasePointerCapture?.(); } catch (_) {} };
            stage.addEventListener('pointerup', stopDrag);
            stage.addEventListener('pointercancel', stopDrag);

            // Visibility
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && visible) scheduleFrame();
            });

            window.addEventListener('beforeunload', () => {
                if (raf) cancelAnimationFrame(raf);
                ro.disconnect();
                io.disconnect();
            });
        })();
    })();

    /* ============================================
       GRADIENT WAVES — WebGL shader (dari React Bits, disederhanakan)
       ============================================ */
    (function initGradientWaves() {
        const container = $('#gradientWaves');
        if (!container) return;
        if (CONFIG.REDUCED_MOTION) {
            // Fallback CSS gradient kalau reduced motion
            container.style.background = 'linear-gradient(180deg, #7c3aed 0%, #2563eb 40%, #ec4899 100%)';
            container.style.opacity = '0.4';
            return;
        }

        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%;';
        container.appendChild(canvas);

        const gl = canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: true,
            antialias: false,
            depth: false,
        });
        if (!gl) {
            container.style.background = 'linear-gradient(180deg, #7c3aed 0%, #2563eb 40%, #ec4899 100%)';
            container.style.opacity = '0.4';
            return;
        }

        const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

        // Simplified version — tetap pakai plasma raymarch tapi lebih ringan
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
    for (int i = 0; i < 50; i++) {
        float dscene = plasma(pos + dist * dir, freq, tc);
        if (abs(dscene) < 0.1) break;
        dist += 0.9 * dscene;
        if (abs(dist) > 20000.0) return 20000.0;
    }
    return dist;
}

void main() {
    float T = iTime * 0.35;
    vec2 freq = vec2(0.6 / 7.0, (0.6 * 0.9) / 3.0);
    vec4 tc = vec4(T / 0.130, T / 0.810, T / 0.200, T / 0.710);

    vec2 uv = (gl_FragCoord.xy / iResolution.xy) - 0.5;
    uv.x *= iResolution.x / iResolution.y;
    uv.y *= -1.0;

    float vfov = (3.14159 / 2.3);
    vec3 dir = vec3(0.0, 0.0, -1.0);
    float ulen = length(uv);
    float xrot = vfov * ulen;
    float c = cos(xrot), s = sin(xrot);
    dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
    vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);
    c = nuv.x; s = nuv.y;
    dir = mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0) * dir;
    c = cos(1.11); s = sin(1.11);
    dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;

    float yaw = (uMouse.x - 0.5) * 0.5 * 0.4;
    float pitch = (uMouse.y - 0.5) * 0.5 * 0.4;
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

    float alpha = clamp(t, 0.0, 1.0) * 0.85;
    float g = hash21(gl_FragCoord.xy + mod(iTime, 64.0) * 11.0);
    alpha += (g - 0.5) * 0.05;
    alpha = clamp(alpha, 0.0, 1.0);
    fragColor = vec4(col * alpha, alpha);
}
`;

        function compile(type, src) {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                console.error('Shader error:', gl.getShaderInfoLog(sh));
                return null;
            }
            return sh;
        }

        const vs = compile(gl.VERTEX_SHADER, VERT);
        const fs = compile(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) return;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(prog));
            return;
        }
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'position');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        const uRes = gl.getUniformLocation(prog, 'iResolution');
        const uTime = gl.getUniformLocation(prog, 'iTime');
        const uMouse = gl.getUniformLocation(prog, 'uMouse');

        let dpr = Math.min(window.devicePixelRatio || 1, 2);
        let w = 1, h = 1;
        const targetMouse = [0.5, 0.5];
        const currentMouse = [0.5, 0.5];

        function resize() {
            const rect = container.getBoundingClientRect();
            w = Math.max(1, Math.floor(rect.width));
            h = Math.max(1, Math.floor(rect.height));
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform2f(uRes, canvas.width, canvas.height);
        }
        const ro = new ResizeObserver(resize);
        ro.observe(container);
        resize();

        window.addEventListener('pointermove', (e) => {
            const rect = container.getBoundingClientRect();
            targetMouse[0] = (e.clientX - rect.left) / rect.width;
            targetMouse[1] = 1 - (e.clientY - rect.top) / rect.height;
        }, { passive: true });

        let raf = 0;
        let visible = true;
        let lastTime = performance.now();
        const startTime = lastTime;
        const t0 = startTime;

        function frame(now) {
            raf = 0;
            if (!visible || document.hidden) return;

            currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
            currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);

            gl.uniform1f(uTime, (now - t0) * 0.001);
            gl.uniform2f(uMouse, currentMouse[0], currentMouse[1]);

            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 3);

            raf = requestAnimationFrame(frame);
        }

        function schedule() {
            if (!raf && visible && !document.hidden) {
                raf = requestAnimationFrame(frame);
            }
        }

        const io = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible) schedule();
        }, { threshold: 0 });
        io.observe(container);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) schedule();
        });

        schedule();

        window.addEventListener('beforeunload', () => {
            if (raf) cancelAnimationFrame(raf);
            ro.disconnect();
            io.disconnect();
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        });
    })();

    /* ============================================
       MICRO SLATS — Canvas 2D (simplified)
       ============================================ */
    (function initMicroSlats() {
        const container = $('#microSlats');
        if (!container) return;
        if (CONFIG.REDUCED_MOTION) return;

        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%;';
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        let w = 1, h = 1;
        let cols = 1, rows = 1;
        let offX = 0, offY = 0;
        let slatW = 8, slatH = 20, gap = 4;
        let raf = 0;
        let time = 0;
        let visible = true;
        let lastTime = performance.now();
        const pointer = { x: 0.5, y: 0.5, active: false, lastTime: 0 };

        function resize() {
            const rect = container.getBoundingClientRect();
            w = Math.max(1, rect.width);
            h = Math.max(1, rect.height);
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            slatW = CONFIG.IS_MOBILE ? 6 : 8;
            slatH = CONFIG.IS_MOBILE ? 16 : 22;
            gap = 4;
            const pitchX = slatW + gap;
            const pitchY = slatH + gap;
            cols = Math.ceil((w + gap) / pitchX) + 1;
            rows = Math.ceil((h + gap) / pitchY) + 1;
            offX = (w - (cols * pitchX - gap)) / 2;
            offY = (h - (rows * pitchY - gap)) / 2;
        }

        window.addEventListener('pointermove', (e) => {
            const rect = container.getBoundingClientRect();
            pointer.x = (e.clientX - rect.left) / rect.width;
            pointer.y = (e.clientY - rect.top) / rect.height;
            pointer.active = true;
            pointer.lastTime = performance.now();
        }, { passive: true });

        function render(now) {
            raf = 0;
            if (!visible || document.hidden) return;
            const dt = Math.min((now - lastTime) / 1000, 0.05);
            lastTime = now;
            time += dt;

            ctx.clearRect(0, 0, w, h);

            const px = pointer.x * w;
            const py = pointer.y * h;
            const pointerActive = pointer.active && (now - pointer.lastTime) < 2500;
            const pulsePhase = pointerActive ? 0 : time;

            const pitchX = slatW + gap;
            const pitchY = slatH + gap;

            for (let row = 0; row < rows; row++) {
                for (let col = 0; col < cols; col++) {
                    const cx = offX + col * pitchX + slatW / 2;
                    const cy = offY + row * pitchY + slatH / 2;

                    const wave1 = Math.sin(col * 0.3 + pulsePhase * 0.8) * 0.5 + 0.5;
                    const wave2 = Math.cos(row * 0.25 + pulsePhase * 0.6) * 0.5 + 0.5;
                    let level = (wave1 + wave2) / 2;

                    if (pointerActive) {
                        const dx = cx - px;
                        const dy = cy - py;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const radius = 180;
                        if (dist < radius) {
                            const t = 1 - dist / radius;
                            level = Math.max(level, t * t);
                        }
                    }

                    const alpha = 0.05 + level * 0.35;
                    const scaleY = 0.4 + level * 0.6;
                    const curH = slatH * scaleY;

                    ctx.fillStyle = `rgba(37, 99, 235, ${alpha.toFixed(3)})`;
                    const rx = slatW / 2;
                    const ry = curH / 2;
                    ctx.beginPath();
                    if (ctx.roundRect) {
                        ctx.roundRect(cx - rx, cy - ry, slatW, curH, 3);
                    } else {
                        ctx.rect(cx - rx, cy - ry, slatW, curH);
                    }
                    ctx.fill();
                }
            }

            raf = requestAnimationFrame(render);
        }

        function schedule() {
            if (!raf && visible && !document.hidden) {
                lastTime = performance.now();
                raf = requestAnimationFrame(render);
            }
        }

        const ro = new ResizeObserver(() => { resize(); schedule(); });
        ro.observe(container);
        resize();

        const io = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible) schedule();
        }, { threshold: 0 });
        io.observe(container);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) schedule();
        });

        schedule();

        window.addEventListener('beforeunload', () => {
            if (raf) cancelAnimationFrame(raf);
            ro.disconnect();
            io.disconnect();
        });
    })();

    /* ============================================
       CURSOR GRID — Canvas 2D
       ============================================ */
    (function initCursorGrid() {
        const canvas = $('#cursorGridCanvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const CELL = CONFIG.IS_MOBILE ? 50 : 70;
        const RADIUS = 140;
        const HOLD_TIME = 400;
        const FADE_DURATION = 800;
        const LINE_WIDTH = 1;
        const MAX_OPACITY = 0.7;
        const COLOR = [37, 99, 235];

        let cols = 0, rows = 0;
        let offX = 0, offY = 0;
        let alphas = new Float32Array(0);
        let touched = new Float64Array(0);
        let w = 1, h = 1;
        let raf = 0;
        let running = false;
        let lastFrame = 0;
        let visible = true;

        function rebuild() {
            const rect = canvas.getBoundingClientRect();
            w = Math.max(1, rect.width);
            h = Math.max(1, rect.height);
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
            const minCol = Math.max(0, Math.floor((x - RADIUS - offX) / CELL));
            const maxCol = Math.min(cols - 1, Math.floor((x + RADIUS - offX) / CELL));
            const minRow = Math.max(0, Math.floor((y - RADIUS - offY) / CELL));
            const maxRow = Math.min(rows - 1, Math.floor((y + RADIUS - offY) / CELL));
            for (let r = minRow; r <= maxRow; r++) {
                for (let c = minCol; c <= maxCol; c++) {
                    const i = r * cols + c;
                    const [cx, cy] = cellCenter(i);
                    const dist = Math.hypot(cx - x, cy - y);
                    if (dist > RADIUS) continue;
                    const t = 1 - dist / RADIUS;
                    const eased = t * t * (3 - 2 * t);
                    const level = eased * MAX_OPACITY;
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
            const dt = Math.min(now - lastFrame, 50);
            lastFrame = now;
            ctx.clearRect(0, 0, w, h);

            let anyVisible = false;
            const fadeStep = dt / FADE_DURATION;
            const half = CELL / 2;
            const [cr, cg, cb] = COLOR;

            for (let i = 0; i < alphas.length; i++) {
                let a = alphas[i];
                if (a <= 0) continue;
                if (now - touched[i] > HOLD_TIME) {
                    a = Math.max(0, a - fadeStep);
                    alphas[i] = a;
                    if (a <= 0) continue;
                }
                anyVisible = true;

                const [cx, cy] = cellCenter(i);
                const gradient = ctx.createRadialGradient(cx, cy, half * 0.1, cx, cy, CELL);
                gradient.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${a})`);
                gradient.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);

                const x = cx - half + 0.5;
                const y = cy - half + 0.5;
                const s = CELL - 1;

                ctx.beginPath();
                if (ctx.roundRect) ctx.roundRect(x, y, s, s, 0);
                else ctx.rect(x, y, s, s);
                ctx.strokeStyle = gradient;
                ctx.lineWidth = LINE_WIDTH;
                ctx.stroke();
            }

            if (anyVisible) {
                raf = requestAnimationFrame(draw);
            } else {
                running = false;
            }
        }

        function wake() {
            if (running) return;
            running = true;
            lastFrame = performance.now();
            raf = requestAnimationFrame(draw);
        }

        function toLocal(e) {
            const rect = canvas.getBoundingClientRect();
            return [e.clientX - rect.left, e.clientY - rect.top];
        }

        window.addEventListener('pointermove', (e) => {
            const [x, y] = toLocal(e);
            if (x < 0 || y < 0 || x > w || y > h) return;
            energize(x, y);
            wake();
        }, { passive: true });

        window.addEventListener('pointerdown', (e) => {
            const [x, y] = toLocal(e);
            if (x < 0 || y < 0 || x > w || y > h) return;
            energize(x, y);
            wake();
        }, { passive: true });

        const ro = new ResizeObserver(() => {
            rebuild();
            wake();
        });
        ro.observe(canvas);
        rebuild();

        const io = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible) wake();
        }, { threshold: 0 });
        io.observe(canvas);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) wake();
        });

        wake();

        window.addEventListener('beforeunload', () => {
            if (raf) cancelAnimationFrame(raf);
            ro.disconnect();
            io.disconnect();
        });
    })();

    /* ============================================
       BG SECTION SWAP — berdasarkan scroll
       ============================================ */
    (function initBgSectionSwap() {
        const sections = $$('[data-bg-section]');
        if (sections.length === 0) return;

        // Buat div swap
        const swap = document.createElement('div');
        swap.className = 'bg-section-swap';
        swap.setAttribute('data-bg', 'hero');
        document.body.insertBefore(swap, document.body.firstChild);

        let currentSection = 'hero';

        function setActive(name) {
            if (name === currentSection) return;
            currentSection = name;
            swap.style.opacity = '0';
            setTimeout(() => {
                swap.setAttribute('data-bg', name);
                swap.style.opacity = '';
            }, 200);
        }

        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && entry.intersectionRatio > 0.3) {
                        const name = entry.target.getAttribute('data-bg-section');
                        if (name) setActive(name);
                    }
                });
            }, { threshold: [0.3, 0.5, 0.7], rootMargin: '-10% 0px -10% 0px' });
            sections.forEach(s => io.observe(s));
        }

        // Set active first
        swap.classList.add('active');
    })();

    /* ============================================
       FEATURE CARD GLOW — mouse follow
       ============================================ */
    (function initFeatureGlow() {
        if (CONFIG.REDUCED_MOTION) return;
        $$('.feature-card').forEach(card => {
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 100;
                const y = ((e.clientY - rect.top) / rect.height) * 100;
                card.style.setProperty('--mx', x + '%');
                card.style.setProperty('--my', y + '%');
            });
        });
    })();

})();
