/* ============================================
   LOGIN PAGE v3 — Aurora + Sticker + StrokeText + Fake Error
   ============================================ */
(function () {
    'use strict';

    /* ============================================
       DEVICE CAPABILITY
       ============================================ */
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const DISABLE_HEAVY = prefersReduced || isLowEnd;

    /* ============================================
       SECURITY HARDENING + Fake DevTools Error
       ============================================ */
    (function security() {
        try {
            console.log('%c⚠️ STOP!', 'color:#dc2626;font-size:20px;font-weight:900;');
            console.log('%cIni fitur browser untuk developer. Kalau ada yang menyuruh kamu paste sesuatu di sini, itu SCAM.', 'color:#64748b;font-size:12px;');
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
                    showFake500Error();
                }
            }, 800);
        })();

        // Fake 500 Error page — full inline biar gak bergantung pada file eksternal
        function showFake500Error() {
            document.documentElement.innerHTML = '<head></head><body></body>';

            document.body.innerHTML = `
                <div class="fake-error-root">
                    <canvas class="fake-error-canvas" id="fakeErrCanvas"></canvas>
                    <div class="fake-error-content">
                        <div class="fake-error-code-wrap">
                            <div class="fake-error-code">
                                <svg viewBox="0 0 400 140" class="fake-error-svg" preserveAspectRatio="xMidYMid meet">
                                    <text x="200" y="105" text-anchor="middle" class="fake-stroke-text" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">500</text>
                                    <text x="200" y="105" text-anchor="middle" class="fake-fill-text" fill="currentColor" stroke="none">500</text>
                                </svg>
                            </div>
                        </div>
                        <div class="fake-error-title-wrap">
                            <h1 class="fake-error-title" id="fakeErrTitle">Internal Server Error</h1>
                        </div>
                        <p class="fake-error-desc">
                            Terjadi kesalahan pada server kami. Tim teknis telah menerima laporan otomatis
                            dan sedang menangani masalah ini.
                        </p>
                        <div class="fake-error-meta">
                            <div class="fake-error-meta-row">
                                <span class="label">Reference ID:</span>
                                <span class="value" id="fakeErrRef">ERR-XXXX-XXXX</span>
                            </div>
                            <div class="fake-error-meta-row">
                                <span class="label">Timestamp:</span>
                                <span class="value" id="fakeErrTime">—</span>
                            </div>
                            <div class="fake-error-meta-row">
                                <span class="label">Server:</span>
                                <span class="value">prod-id-01</span>
                            </div>
                        </div>
                        <div class="fake-error-actions">
                            <button type="button" class="fake-btn fake-btn-primary" id="fakeRetryBtn">
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                                Coba Lagi
                            </button>
                            <a href="/" class="fake-btn fake-btn-secondary">Kembali ke Beranda</a>
                        </div>
                        <div class="fake-error-hint">
                            Kode kesalahan: <code>ASYROF_500_INTERNAL</code>
                        </div>
                    </div>
                </div>
                <style>${FAKE_ERROR_CSS}</style>
            `;

            // Setup isi dinamis
            const ref = document.getElementById('fakeErrRef');
            const time = document.getElementById('fakeErrTime');
            if (ref) ref.textContent = 'ERR-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
            if (time) time.textContent = new Date().toISOString();

            // Setup retry button
            const retryBtn = document.getElementById('fakeRetryBtn');
            if (retryBtn) {
                retryBtn.addEventListener('click', () => {
                    sessionStorage.removeItem('asyrof_devtools_lock');
                    window.location.reload();
                });
            }

            // Animate text decrypt
            const titleEl = document.getElementById('fakeErrTitle');
            if (titleEl) {
                decryptText(titleEl, 'Internal Server Error', 800);
            }

            // Stroke text animation
            animateStrokeText();

            // Aurora-ish background (CSS only)
            startFakeBg();

            // Auto reload kalau DevTools ditutup
            const THRESHOLD = 200;
            setInterval(() => {
                const wDiff = window.outerWidth - window.innerWidth;
                const hDiff = window.outerHeight - window.innerHeight;
                if (wDiff <= THRESHOLD && hDiff <= THRESHOLD) {
                    sessionStorage.removeItem('asyrof_devtools_lock');
                    window.location.reload();
                }
            }, 500);
        }

        // CSS untuk fake error page (inline biar gak bergantung file eksternal)
        const FAKE_ERROR_CSS = `
            .fake-error-root {
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 24px;
                position: relative;
                overflow: hidden;
                background: #0f172a;
                color: #f1f5f9;
                font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                -webkit-font-smoothing: antialiased;
            }
            .fake-error-canvas {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                opacity: 0.4;
                z-index: 0;
            }
            .fake-error-content {
                position: relative;
                z-index: 1;
                max-width: 520px;
                width: 100%;
                text-align: center;
                background: rgba(30, 41, 59, 0.7);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 20px;
                padding: 48px 40px 36px;
                box-shadow:
                    0 1px 2px rgba(0, 0, 0, 0.4),
                    0 8px 32px rgba(0, 0, 0, 0.5),
                    0 24px 64px rgba(0, 0, 0, 0.4);
            }
            .fake-error-code-wrap {
                margin-bottom: 8px;
            }
            .fake-error-code {
                width: 100%;
                max-width: 320px;
                margin: 0 auto;
                color: #ef4444;
            }
            .fake-error-svg {
                display: block;
                width: 100%;
                height: auto;
            }
            .fake-stroke-text {
                font-family: 'JetBrains Mono', 'Plus Jakarta Sans', monospace;
                font-size: 96px;
                font-weight: 900;
                letter-spacing: -4px;
                stroke-dasharray: 800;
                stroke-dashoffset: 800;
                animation: fakeStrokeDraw 2s ease-out forwards;
            }
            .fake-fill-text {
                font-family: 'JetBrains Mono', 'Plus Jakarta Sans', monospace;
                font-size: 96px;
                font-weight: 900;
                letter-spacing: -4px;
                opacity: 0;
                animation: fakeFillIn 1s ease-out 1.8s forwards;
            }
            @keyframes fakeStrokeDraw {
                to { stroke-dashoffset: 0; }
            }
            @keyframes fakeFillIn {
                to { opacity: 1; }
            }
            .fake-error-title-wrap {
                margin-bottom: 12px;
            }
            .fake-error-title {
                font-size: 1.5rem;
                font-weight: 800;
                margin: 0;
                letter-spacing: -0.02em;
                color: #f1f5f9;
                min-height: 1.5em;
            }
            .fake-error-title .char {
                display: inline-block;
                transition: opacity 0.1s;
            }
            .fake-error-title .char.encrypted {
                color: #ef4444;
                opacity: 0.7;
            }
            .fake-error-desc {
                font-size: 0.92rem;
                line-height: 1.7;
                color: #94a3b8;
                margin: 0 0 24px;
            }
            .fake-error-meta {
                text-align: left;
                background: rgba(15, 23, 42, 0.6);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 12px;
                padding: 14px 16px;
                margin-bottom: 24px;
                font-family: 'JetBrains Mono', monospace;
                font-size: 0.75rem;
            }
            .fake-error-meta-row {
                display: flex;
                justify-content: space-between;
                gap: 12px;
                padding: 5px 0;
            }
            .fake-error-meta-row:not(:last-child) {
                border-bottom: 1px dashed rgba(255, 255, 255, 0.06);
            }
            .fake-error-meta-row .label {
                color: #94a3b8;
                font-weight: 600;
                flex-shrink: 0;
            }
            .fake-error-meta-row .value {
                color: #f1f5f9;
                font-weight: 700;
                word-break: break-all;
                text-align: right;
            }
            .fake-error-actions {
                display: flex;
                gap: 10px;
                justify-content: center;
                flex-wrap: wrap;
                margin-bottom: 20px;
            }
            .fake-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                padding: 11px 22px;
                border-radius: 10px;
                font-family: inherit;
                font-weight: 700;
                font-size: 0.88rem;
                cursor: pointer;
                border: none;
                text-decoration: none;
                transition: all 0.2s;
            }
            .fake-btn-primary {
                background: #2563eb;
                color: white;
                box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
            }
            .fake-btn-primary:hover {
                background: #1d4ed8;
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
            }
            .fake-btn-secondary {
                background: transparent;
                color: #94a3b8;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            .fake-btn-secondary:hover {
                background: rgba(255, 255, 255, 0.04);
                color: #f1f5f9;
            }
            .fake-error-hint {
                font-size: 0.72rem;
                color: #94a3b8;
                font-family: 'JetBrains Mono', monospace;
                padding-top: 16px;
                border-top: 1px dashed rgba(255, 255, 255, 0.06);
            }
            .fake-error-hint code {
                background: rgba(255, 255, 255, 0.06);
                padding: 2px 8px;
                border-radius: 4px;
                font-weight: 700;
                color: #cbd5e1;
            }
        `;

        // Animate stroke text (SVG dash offset)
        function animateStrokeText() {
            // CSS animation handle ini
        }

        // Animate decrypt text
        function decryptText(el, finalText, duration) {
            const chars = '!@#$%^&*()_+ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            const startTime = performance.now();
            const totalDuration = duration || 800;

            function tick() {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / totalDuration, 1);
                const revealedCount = Math.floor(progress * finalText.length);

                let output = '';
                for (let i = 0; i < finalText.length; i++) {
                    if (i < revealedCount) {
                        output += finalText[i];
                    } else if (finalText[i] === ' ') {
                        output += ' ';
                    } else {
                        output += chars[Math.floor(Math.random() * chars.length)];
                    }
                }

                el.innerHTML = output
                    .split('')
                    .map((c, i) => `<span class="char${i >= revealedCount ? ' encrypted' : ''}">${c === ' ' ? '&nbsp;' : c}</span>`)
                    .join('');

                if (progress < 1) {
                    requestAnimationFrame(tick);
                } else {
                    el.innerHTML = finalText;
                }
            }
            tick();
        }

        // Fake aurora-ish background dengan particles
        function startFakeBg() {
            const canvas = document.getElementById('fakeErrCanvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            let w = canvas.width = window.innerWidth;
            let h = canvas.height = window.innerHeight;

            const particles = [];
            for (let i = 0; i < 40; i++) {
                particles.push({
                    x: Math.random() * w,
                    y: Math.random() * h,
                    r: 30 + Math.random() * 80,
                    vx: (Math.random() - 0.5) * 0.3,
                    vy: (Math.random() - 0.5) * 0.3,
                    hue: 200 + Math.random() * 60
                });
            }

            let raf = 0;
            let last = 0;

            function draw(t) {
                raf = requestAnimationFrame(draw);
                if (t - last < 33) return;
                last = t;

                ctx.clearRect(0, 0, w, h);

                for (const p of particles) {
                    p.x += p.vx;
                    p.y += p.vy;
                    if (p.x < -p.r) p.x = w + p.r;
                    if (p.x > w + p.r) p.x = -p.r;
                    if (p.y < -p.r) p.y = h + p.r;
                    if (p.y > h + p.r) p.y = -p.r;

                    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
                    grad.addColorStop(0, `hsla(${p.hue}, 70%, 50%, 0.15)`);
                    grad.addColorStop(1, `hsla(${p.hue}, 70%, 50%, 0)`);
                    ctx.fillStyle = grad;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            raf = requestAnimationFrame(draw);

            window.addEventListener('resize', () => {
                w = canvas.width = window.innerWidth;
                h = canvas.height = window.innerHeight;
            });
        }
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
       AURORA BG
       ============================================ */
    (function aurora() {
        const container = document.getElementById('auroraBg');
        if (!container) return;

        if (DISABLE_HEAVY) {
            container.classList.add('aurora-fallback');
            return;
        }

        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%;';
        container.appendChild(canvas);

        const gl = canvas.getContext('webgl2', {
            alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
            powerPreference: 'low-power',
        });

        if (!gl) {
            container.classList.add('aurora-fallback');
            return;
        }

        const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

        const FRAG = `#version 300 es
precision highp float;
uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;
out vec4 fragColor;

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

struct ColorStop { vec3 color; float position; };

#define COLOR_RAMP(colors, factor, finalColor) {              \\
    int index = 0;                                            \\
    for (int i = 0; i < 2; i++) {                             \\
        ColorStop currentColor = colors[i];                   \\
        bool isInBetween = currentColor.position <= factor;   \\
        index = int(mix(float(index), float(i), float(isInBetween))); \\
    }                                                         \\
    ColorStop currentColor = colors[index];                   \\
    ColorStop nextColor = colors[index + 1];                  \\
    float range = nextColor.position - currentColor.position; \\
    float lerpFactor = (factor - currentColor.position) / range; \\
    finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \\
}

void main() {
    vec2 uv = gl_FragCoord.xy / uResolution;
    ColorStop colors[3];
    colors[0] = ColorStop(uColorStops[0], 0.0);
    colors[1] = ColorStop(uColorStops[1], 0.5);
    colors[2] = ColorStop(uColorStops[2], 1.0);
    vec3 rampColor;
    COLOR_RAMP(colors, uv.x, rampColor);
    float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
    height = exp(height);
    height = (uv.y * 2.0 - height + 0.2);
    float intensity = 0.6 * height;
    float midPoint = 0.20;
    float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);
    vec3 auroraColor = intensity * rampColor;
    fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`;

        function compile(type, src) {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
            return sh;
        }

        const vs = compile(gl.VERTEX_SHADER, VERT);
        const fs = compile(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) { container.classList.add('aurora-fallback'); return; }

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { container.classList.add('aurora-fallback'); return; }
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'position');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        const uTime = gl.getUniformLocation(prog, 'uTime');
        const uAmp = gl.getUniformLocation(prog, 'uAmplitude');
        const uStops = gl.getUniformLocation(prog, 'uColorStops');
        const uRes = gl.getUniformLocation(prog, 'uResolution');
        const uBlend = gl.getUniformLocation(prog, 'uBlend');

        const colors = [
            [0.32, 0.15, 1.0],
            [0.49, 0.39, 0.81],
            [0.95, 0.4, 0.7]
        ];

        let w = 1, h = 1;
        function resize() {
            const rect = container.getBoundingClientRect();
            w = Math.max(1, Math.floor(rect.width));
            h = Math.max(1, Math.floor(rect.height));
            const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5);
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform2f(uRes, canvas.width, canvas.height);
        }
        const ro = new ResizeObserver(resize);
        ro.observe(container);
        resize();

        let raf = 0;
        let visible = true;
        let lastRender = 0;
        const FPS_CAP = isMobile ? 24 : 30;
        const FRAME_MIN = 1000 / FPS_CAP;
        const t0 = performance.now();

        function frame(now) {
            raf = 0;
            if (!visible || document.hidden) return;
            if (now - lastRender < FRAME_MIN) {
                raf = requestAnimationFrame(frame);
                return;
            }
            lastRender = now;

            gl.uniform1f(uTime, (now - t0) * 0.001);
            gl.uniform1f(uAmp, 1.0);
            gl.uniform1f(uBlend, 0.5);
            gl.uniform3fv(uStops, new Float32Array(colors.flat()));

            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 3);

            raf = requestAnimationFrame(frame);
        }

        function schedule() {
            if (!raf && visible && !document.hidden) {
                lastRender = 0;
                raf = requestAnimationFrame(frame);
            }
        }

        const io = new IntersectionObserver(([en]) => {
            visible = en.isIntersecting;
            if (visible) schedule();
        }, { threshold: 0 });
        io.observe(container);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) schedule();
        });

        schedule();
    })();

    /* ============================================
       STICKER — draggable, NOT clickable
       ============================================ */
    (function sticker() {
        const wrapper = document.getElementById('stickerWrapper');
        const link = document.getElementById('stickerLink');
        const stickerContainer = document.getElementById('stickerContainer');
        if (!wrapper || !link || !stickerContainer) return;

        let dragging = false;
        let startX = 0, startY = 0;
        let currentX = 0, currentY = 0;
        let velocityX = 0, velocityY = 0;
        let rotation = 0;
        let raf = 0;

        const MAX_DRIFT_X = 60;
        const MAX_DRIFT_Y = 40;

        function applyTransform() {
            stickerContainer.style.transform = `translate(${currentX}px, ${currentY}px) rotate(${rotation}deg)`;
        }

        function animate() {
            raf = 0;
            if (!dragging) {
                const stiffness = 0.15;
                const damping = 0.8;

                velocityX += (0 - currentX) * stiffness;
                velocityY += (0 - currentY) * stiffness;
                velocityX *= damping;
                velocityY *= damping;

                currentX += velocityX;
                currentY += velocityY;
                rotation += (0 - rotation) * 0.1;
                rotation += velocityX * 0.8;
                rotation *= 0.85;

                if (Math.abs(currentX) < 0.1 && Math.abs(currentY) < 0.1 &&
                    Math.abs(velocityX) < 0.1 && Math.abs(velocityY) < 0.1 &&
                    Math.abs(rotation) < 0.1) {
                    currentX = 0; currentY = 0; rotation = 0;
                    velocityX = 0; velocityY = 0;
                    applyTransform();
                    return;
                }
                applyTransform();
                raf = requestAnimationFrame(animate);
            }
        }

        function onPointerDown(e) {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            currentX = 0; currentY = 0;
            velocityX = 0; velocityY = 0;
            rotation = 0;
            link.setPointerCapture?.(e.pointerId);
            wrapper.classList.add('dragging');
            stickerContainer.classList.add('touch-active');
        }

        function onPointerMove(e) {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            currentX = Math.max(-MAX_DRIFT_X, Math.min(MAX_DRIFT_X, dx));
            currentY = Math.max(-MAX_DRIFT_Y, Math.min(MAX_DRIFT_Y, dy));
            rotation = dx * 0.3;
            applyTransform();
        }

        function onPointerUp(e) {
            if (!dragging) return;
            dragging = false;
            wrapper.classList.remove('dragging');
            stickerContainer.classList.remove('touch-active');
            try { link.releasePointerCapture?.(e.pointerId); } catch (_) {}
            if (!raf) raf = requestAnimationFrame(animate);
        }

        link.addEventListener('pointerdown', onPointerDown, { passive: true });
        link.addEventListener('pointermove', onPointerMove, { passive: true });
        link.addEventListener('pointerup', onPointerUp);
        link.addEventListener('pointercancel', onPointerUp);
    })();

    /* ============================================
       STROKE TEXT — animasi "AsyrofOTP"
       ============================================ */
    (function strokeText() {
        const wrap = document.getElementById('logoStrokeWrap');
        const strokeEl = document.getElementById('logoStrokeText');
        const fillEl = document.getElementById('logoFillText');
        if (!wrap || !strokeEl || !fillEl) return;

        // Ukur dulu, baru set dasharray
        try {
            const length = strokeEl.getComputedTextLength ? strokeEl.getComputedTextLength() : 0;
            const dash = Math.max(length * 1.2, 800);
            strokeEl.style.strokeDasharray = dash;
            strokeEl.style.strokeDashoffset = dash;
        } catch (e) {
            strokeEl.style.strokeDasharray = 800;
            strokeEl.style.strokeDashoffset = 800;
        }

        let played = false;

        function play() {
            if (played) return;
            played = true;

            if (prefersReduced) {
                strokeEl.style.strokeDashoffset = 0;
                fillEl.style.opacity = '1';
                return;
            }

            // Animasi stroke draw
            const startTime = performance.now();
            const duration = 1500;
            const initialDash = parseFloat(strokeEl.style.strokeDashoffset) || 800;

            function tick() {
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3);
                strokeEl.style.strokeDashoffset = String(initialDash * (1 - eased));

                if (progress < 1) {
                    requestAnimationFrame(tick);
                } else {
                    // Fill fade in
                    fillEl.style.opacity = '1';
                    wrap.classList.add('animate');
                }
            }
            requestAnimationFrame(tick);
        }

        // Play when in view
        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver(([en]) => {
                if (en.isIntersecting) {
                    setTimeout(play, 300);
                    io.disconnect();
                }
            }, { threshold: 0.3 });
            io.observe(wrap);
        } else {
            setTimeout(play, 300);
        }
    })();

    /* ============================================
       BORDER GLOW
       ============================================ */
    (function borderGlow() {
        if (prefersReduced) return;
        const card = document.getElementById('loginCard');
        if (!card) return;

        let raf = 0;
        let targetX = 0, targetY = 0;
        let curX = 0, curY = 0;

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

            if (Math.abs(targetX - curX) > 0.5 || Math.abs(targetY - curY) > 0.5) {
                raf = requestAnimationFrame(animate);
            }
        }

        card.addEventListener('pointermove', onPointerMove, { passive: true });
        card.addEventListener('pointerenter', onPointerMove, { passive: true });
        card.addEventListener('pointerleave', () => {
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
    const alertIcon = document.getElementById('alertIcon');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = document.getElementById('btnText');
    const btnIcon = document.getElementById('btnIcon');
    const passwordInput = document.getElementById('password');
    const togglePassword = document.getElementById('togglePassword');
    const eyeIcon = document.getElementById('eyeIcon');

    const statusRow = document.getElementById('statusRow');
    const statusMark = document.getElementById('statusMark');
    const statusLabel = document.getElementById('statusLabel');

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

    const ALERT_ICONS = {
        info: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`,
        error: `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`,
        success: `<polyline points="20 6 9 17 4 12"/>`,
    };

    function showAlert(message, type = 'error') {
        alertEl.className = 'alert show ' + type;
        alertText.textContent = message;
        if (alertIcon) alertIcon.innerHTML = ALERT_ICONS[type] || ALERT_ICONS.info;
    }
    function hideAlert() { alertEl.classList.remove('show'); }

    const EYE_OPEN = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
    const EYE_CLOSED = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;

    let passwordVisible = false;
    togglePassword.addEventListener('click', () => {
        passwordVisible = !passwordVisible;
        passwordInput.type = passwordVisible ? 'text' : 'password';
        eyeIcon.innerHTML = passwordVisible ? EYE_CLOSED : EYE_OPEN;
    });

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

            setTimeout(() => { window.location.replace('/dashboard'); }, 800);

        } catch (err) {
            setStatus('failed', 'Gagal login');
            showAlert(err.message || 'Terjadi kesalahan', 'error');
            submitBtn.disabled = false;
            btnText.textContent = 'Login';
            const oldIcon = document.getElementById('btnIcon');
            if (oldIcon) {
                oldIcon.outerHTML = '<svg class="icon-svg" viewBox="0 0 24 24" id="btnIcon"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
            }
            setTimeout(() => setStatus('pending', 'Menunggu'), 3000);
        }
    });

})();
