/* ============================================
   LOGIN PAGE v8 — Full script
   Tema BG: Aurora (dark) / Iridescence (light) + MicroSlats
   Theme transition: Pixel Swap
   Input: Fold Text label animation
   Login: Folder check animation
   ============================================ */
(function () {
    'use strict';

    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const DISABLE_HEAVY = prefersReduced || isLowEnd;

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
       THEME TOGGLE with PIXEL SWAP
       ============================================ */
    (function theme() {
        const btn = document.getElementById('themeToggle');
        const overlay = document.getElementById('pixelSwapOverlay');
        if (!btn || !overlay) return;

        let isAnimating = false;

        // Build pixel grid
        function buildPixels(themeColor) {
            const pixelSize = 20; // banyak pixel kecil
            const cols = Math.ceil(window.innerWidth / pixelSize);
            const rows = Math.ceil(window.innerHeight / pixelSize);
            const total = cols * rows;

            overlay.innerHTML = '';
            overlay.style.gridTemplateColumns = `repeat(${cols}, ${pixelSize}px)`;
            overlay.style.gridTemplateRows = `repeat(${rows}, ${pixelSize}px)`;
            overlay.setAttribute('data-theme-color', themeColor);

            // Batasi max pixel
            const MAX = 4000;
            const step = total > MAX ? Math.ceil(total / MAX) : 1;

            const frag = document.createDocumentFragment();
            for (let i = 0; i < total; i += step) {
                const p = document.createElement('div');
                p.className = 'pixel';
                // Delay random untuk efek chaotic
                const delay = Math.random() * 0.4;
                p.style.animationDelay = delay + 's';
                frag.appendChild(p);
            }
            overlay.appendChild(frag);
        }

        btn.addEventListener('click', () => {
            if (isAnimating) return;

            const cur = document.documentElement.getAttribute('data-theme') || 'light';
            const next = cur === 'dark' ? 'light' : 'dark';

            isAnimating = true;

            // Warna overlay = warna tema TUJUAN
            const targetColor = next === 'dark' ? 'dark' : 'light';
            buildPixels(targetColor);

            overlay.classList.add('active');
            overlay.classList.remove('closing');

            // Ganti tema pas pixel nutup penuh
            setTimeout(() => {
                document.documentElement.setAttribute('data-theme', next);
                localStorage.setItem('asyrofotp_theme', next);
                const m = document.querySelector('meta[name="theme-color"]');
                if (m) m.setAttribute('content', next === 'dark' ? '#0f172a' : '#2563eb');

                // Restart aurora/iridescence berdasarkan tema baru
                restartBgByTheme(next);

                // Fade out pixel
                overlay.classList.add('closing');
                setTimeout(() => {
                    overlay.classList.remove('active', 'closing');
                    overlay.innerHTML = '';
                    isAnimating = false;
                }, 700);
            }, 700);
        });
    })();

    /* ============================================
       AURORA (dark theme)
       ============================================ */
    function initAurora() {
        const container = document.getElementById('bgAurora');
        if (!container) return;
        if (container.dataset.inited === '1') return;
        container.dataset.inited = '1';

        if (DISABLE_HEAVY) {
            container.style.background = 'linear-gradient(180deg, rgba(82,39,255,0.4) 0%, rgba(37,99,235,0.3) 50%, rgba(236,72,153,0.35) 100%)';
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
            container.style.background = 'linear-gradient(180deg, rgba(82,39,255,0.4) 0%, rgba(37,99,235,0.3) 50%, rgba(236,72,153,0.35) 100%)';
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
        if (!vs || !fs) return;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
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

        function resize() {
            const rect = container.getBoundingClientRect();
            const w = Math.max(1, Math.floor(rect.width));
            const h = Math.max(1, Math.floor(rect.height));
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
        const FRAME_MIN = 1000 / (isMobile ? 24 : 30);
        const t0 = performance.now();

        function frame(now) {
            raf = 0;
            if (!visible || document.hidden) return;
            if (now - lastRender < FRAME_MIN) { raf = requestAnimationFrame(frame); return; }
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
    }

    /* ============================================
       IRIDESCENCE (light theme)
       ============================================ */
    function initIridescence() {
        const container = document.getElementById('bgIridescence');
        if (!container) return;
        if (container.dataset.inited === '1') return;
        container.dataset.inited = '1';

        if (DISABLE_HEAVY) {
            container.style.background = 'linear-gradient(135deg, rgba(191,219,254,0.5) 0%, rgba(221,214,254,0.5) 50%, rgba(251,207,232,0.5) 100%)';
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
            container.style.background = 'linear-gradient(135deg, rgba(191,219,254,0.5) 0%, rgba(221,214,254,0.5) 50%, rgba(251,207,232,0.5) 100%)';
            return;
        }

        const VERT = `#version 300 es
in vec2 position;
in vec2 uv;
out vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

        const FRAG = `#version 300 es
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform vec2 uResolution;
out vec4 fragColor;
in vec2 vUv;

void main() {
    float mr = min(uResolution.x, uResolution.y);
    vec2 uv = (vUv * 2.0 - 1.0) * uResolution / mr;

    float d = -uTime * 0.5;
    float a = 0.0;
    for (float i = 0.0; i < 8.0; ++i) {
        a += cos(i - d - a * uv.x);
        d += sin(uv.y * i + a);
    }
    d += uTime * 0.5;
    vec3 col = vec3(cos(uv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
    col = cos(col * cos(vec3(d, a, 2.5)) * 0.5 + 0.5) * uColor;
    // Pastikan warna soft untuk light mode
    col = mix(vec3(1.0), col, 0.35);
    fragColor = vec4(col, 1.0);
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
        if (!vs || !fs) return;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        // Quad dengan UV: position + uv
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 0, 0,
             3, -1, 2, 0,
            -1,  3, 0, 2,
        ]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'position');
        const locUv = gl.getAttribLocation(prog, 'uv');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(locUv);
        gl.vertexAttribPointer(locUv, 2, gl.FLOAT, false, 16, 8);

        const uTime = gl.getUniformLocation(prog, 'uTime');
        const uColor = gl.getUniformLocation(prog, 'uColor');
        const uRes = gl.getUniformLocation(prog, 'uResolution');

        function resize() {
            const rect = container.getBoundingClientRect();
            const w = Math.max(1, Math.floor(rect.width));
            const h = Math.max(1, Math.floor(rect.height));
            const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5);
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform2f(uRes, canvas.width, canvas.height);
        }
        const ro = new ResizeObserver(resize);
        ro.observe(container);
        resize();

        gl.uniform3f(uColor, 0.78, 0.85, 0.98);

        let raf = 0;
        let visible = true;
        let lastRender = 0;
        const FRAME_MIN = 1000 / (isMobile ? 24 : 30);
        const t0 = performance.now();

        function frame(now) {
            raf = 0;
            if (!visible || document.hidden) return;
            if (now - lastRender < FRAME_MIN) { raf = requestAnimationFrame(frame); return; }
            lastRender = now;

            gl.uniform1f(uTime, (now - t0) * 0.001);
            gl.clearColor(1, 1, 1, 0);
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
    }

    /* ============================================
       MICRO SLATS (canvas 2D — versi ringan)
       ============================================ */
    function initMicroSlats() {
        const container = document.getElementById('bgMicroSlats');
        if (!container) return;
        if (DISABLE_HEAVY) return;
        if (container.dataset.inited === '1') return;
        container.dataset.inited = '1';

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
            const rect = container.getBoundingClientRect();
            w = Math.max(1, rect.width);
            h = Math.max(1, rect.height);
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
            if (now - lastRender < FRAME_MIN) { raf = requestAnimationFrame(render); return; }
            lastRender = now;
            time += 0.016;

            ctx.clearRect(0, 0, w, h);

            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
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
                    const color = isDark ? '59,130,246' : '37,99,235';

                    ctx.fillStyle = `rgba(${color},${alpha.toFixed(3)})`;
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

        const ro = new ResizeObserver(() => { resize(); schedule(); });
        ro.observe(container);
        resize();

        const io = new IntersectionObserver(([en]) => {
            visible = en.isIntersecting;
            if (visible) schedule();
        }, { threshold: 0 });
        io.observe(container);

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) schedule();
        });

        schedule();
    }

    function restartBgByTheme(theme) {
        // Reset & init ulang BG sesuai tema
        const aurora = document.getElementById('bgAurora');
        const iridescence = document.getElementById('bgIridescence');

        // Aurora hanya untuk dark, tapi tetap init sekali
        if (!aurora.dataset.inited) initAurora();
        if (!iridescence.dataset.inited) initIridescence();
    }

    // Init awal
    initAurora();
    initIridescence();
    initMicroSlats();

    /* ============================================
       FOLD LABEL — animasi unfold saat input focus
       ============================================ */
    (function foldLabel() {
        const labels = document.querySelectorAll('[data-fold-label]');
        labels.forEach(label => {
            const text = label.getAttribute('data-fold-label');
            const chars = text.split('').map((c, i) =>
                `<span class="fold-char" style="transition-delay: ${i * 0.03}s;">${c === ' ' ? '&nbsp;' : c}</span>`
            ).join('');
            label.innerHTML = chars;
        });

        // Unfold pas halaman load
        setTimeout(() => {
            labels.forEach((label, idx) => {
                setTimeout(() => label.classList.add('unfolded'), idx * 150);
            });
        }, 300);

        // Unfold pas input focus kalau sebelumnya gak unfolded
        document.querySelectorAll('.form-control').forEach(input => {
            input.addEventListener('focus', () => {
                const label = input.parentElement?.previousElementSibling;
                if (label && label.classList.contains('fold-label')) {
                    label.classList.add('unfolded');
                }
            });
        });
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
       FOLDER CHECK ANIMATION
       ============================================ */
    const folderCheck = (function () {
        const overlay = document.getElementById('folderCheckOverlay');
        const folder = document.getElementById('folder3d');
        const textEl = document.getElementById('folderCheckText');
        if (!overlay || !folder) return { play: () => Promise.resolve() };

        const MESSAGES = [
            'Membuka database...',
            'Mencari user...',
            'Memverifikasi kredensial...',
            'Menyiapkan sesi...'
        ];

        function setText(text) {
            if (textEl) textEl.textContent = text;
        }

        function play() {
            return new Promise((resolve) => {
                if (prefersReduced) { resolve(); return; }

                overlay.classList.add('active');
                folder.classList.remove('open');
                setText(MESSAGES[0]);

                // Buka folder
                setTimeout(() => folder.classList.add('open'), 200);

                let idx = 1;
                const msgTimer = setInterval(() => {
                    if (idx < MESSAGES.length) {
                        setText(MESSAGES[idx]);
                        idx++;
                    }
                }, 700);

                // Total durasi ~2.8s
                setTimeout(() => {
                    clearInterval(msgTimer);
                    folder.classList.remove('open');
                    setTimeout(() => {
                        overlay.classList.remove('active');
                        resolve();
                    }, 400);
                }, 2800);
            });
        }

        return { play };
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

        // Play folder check animation
        await folderCheck.play();

        try {
            await waitForRecaptcha();
            if (!window.grecaptcha || !window.grecaptcha.execute) {
                throw new Error('Verifikasi keamanan gagal dimuat. Refresh halaman.');
            }

            const recaptchaToken = await new Promise((resolve, reject) => {
                grecaptcha.ready(() => {
                    grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'login' })
                        .then(resolve)
                        .catch(reject);
                });
                setTimeout(() => reject(new Error('Timeout verifikasi keamanan')), 10000);
            });

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
