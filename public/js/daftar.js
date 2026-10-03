/* ============================================
   DAFTAR PAGE SCRIPT
   Background sama kayak login (Aurora/Iridescence)
   + Register form logic
   ============================================ */
(function () {
    'use strict';

    /* ============================================
       DEVICE DETECTION
       ============================================ */
    const isMobile = window.matchMedia('(max-width: 700px)').matches;
    const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const saveData = navigator.connection && navigator.connection.saveData;
    const DISABLE_HEAVY = prefersReduced || saveData || isLowEnd;

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
       AUTO REDIRECT kalau udah login
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

            // Restart shader dengan theme baru
            restartShader();
        });
    })();

    /* ============================================
       SHADER MANAGER — Aurora (dark) / Iridescence (light)
       ============================================ */
    let currentShaderCleanup = null;

    function restartShader() {
        if (currentShaderCleanup) {
            try { currentShaderCleanup(); } catch (e) {}
            currentShaderCleanup = null;
        }
        const container = document.getElementById('bgShader');
        if (!container) return;
        container.innerHTML = '';
        container.classList.remove('shader-fallback');

        const theme = document.documentElement.getAttribute('data-theme') || 'light';

        if (DISABLE_HEAVY) {
            container.classList.add('shader-fallback');
            return;
        }

        if (theme === 'dark') {
            currentShaderCleanup = initAurora(container);
        } else {
            currentShaderCleanup = initIridescence(container);
        }
    }

    /* ============================================
       AURORA (dark theme)
       ============================================ */
    function initAurora(container) {
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%;';
        container.appendChild(canvas);

        const gl = canvas.getContext('webgl2', {
            alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
            powerPreference: 'low-power',
        });

        if (!gl) {
            container.classList.add('shader-fallback');
            return null;
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
        if (!vs || !fs) {
            container.classList.add('shader-fallback');
            return null;
        }

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            container.classList.add('shader-fallback');
            return null;
        }
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
            const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
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
        const FRAME_MIN = 1000 / 30;
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

        const onVis = () => {
            if (!document.hidden) schedule();
        };
        document.addEventListener('visibilitychange', onVis);

        schedule();

        return function cleanup() {
            if (raf) cancelAnimationFrame(raf);
            ro.disconnect();
            io.disconnect();
            document.removeEventListener('visibilitychange', onVis);
            try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) {}
        };
    }

    /* ============================================
       IRIDESCENCE (light theme)
       ============================================ */
    function initIridescence(container) {
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'display:block;width:100%;height:100%;';
        container.appendChild(canvas);

        const gl = canvas.getContext('webgl2', {
            alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
            powerPreference: 'low-power',
        });

        if (!gl) {
            container.classList.add('shader-fallback');
            return null;
        }

        const VERT = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

        const FRAG = `#version 300 es
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uResolution;
uniform vec2 uMouse;
uniform float uAmplitude;
uniform float uSpeed;
out vec4 fragColor;

void main() {
    float mr = min(uResolution.x, uResolution.y);
    vec2 uv = ((gl_FragCoord.xy / uResolution.xy) * 2.0 - 1.0) * uResolution.xy / mr;
    uv += (uMouse - vec2(0.5)) * uAmplitude;

    float d = -uTime * 0.5 * uSpeed;
    float a = 0.0;
    for (float i = 0.0; i < 8.0; ++i) {
        a += cos(i - d - a * uv.x);
        d += sin(uv.y * i + a);
    }
    d += uTime * 0.5 * uSpeed;
    vec3 col = vec3(cos(uv * vec2(d, a)) * 0.6 + 0.4, cos(a + d) * 0.5 + 0.5);
    col = cos(col * cos(vec3(d, a, 2.5)) * 0.5 + 0.5) * uColor;
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
        if (!vs || !fs) {
            container.classList.add('shader-fallback');
            return null;
        }

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            container.classList.add('shader-fallback');
            return null;
        }
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'position');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        const uTime = gl.getUniformLocation(prog, 'uTime');
        const uColor = gl.getUniformLocation(prog, 'uColor');
        const uRes = gl.getUniformLocation(prog, 'uResolution');
        const uMouse = gl.getUniformLocation(prog, 'uMouse');
        const uAmp = gl.getUniformLocation(prog, 'uAmplitude');
        const uSpeed = gl.getUniformLocation(prog, 'uSpeed');

        const baseColor = [0.55, 0.65, 0.95];

        const targetMouse = [0.5, 0.5];
        const currentMouse = [0.5, 0.5];

        function resize() {
            const rect = container.getBoundingClientRect();
            const w = Math.max(1, Math.floor(rect.width));
            const h = Math.max(1, Math.floor(rect.height));
            const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform3f(uRes, canvas.width, canvas.height, canvas.width / canvas.height);
        }
        const ro = new ResizeObserver(resize);
        ro.observe(container);
        resize();

        const onPointerMove = (e) => {
            const rect = container.getBoundingClientRect();
            targetMouse[0] = (e.clientX - rect.left) / rect.width;
            targetMouse[1] = 1 - (e.clientY - rect.top) / rect.height;
        };
        window.addEventListener('pointermove', onPointerMove, { passive: true });

        let raf = 0;
        let visible = true;
        let lastRender = 0;
        const FRAME_MIN = 1000 / 30;
        const t0 = performance.now();

        function frame(now) {
            raf = 0;
            if (!visible || document.hidden) return;
            if (now - lastRender < FRAME_MIN) {
                raf = requestAnimationFrame(frame);
                return;
            }
            lastRender = now;

            currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
            currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);

            gl.uniform1f(uTime, (now - t0) * 0.001);
            gl.uniform3f(uColor, baseColor[0], baseColor[1], baseColor[2]);
            gl.uniform2f(uMouse, currentMouse[0], currentMouse[1]);
            gl.uniform1f(uAmp, 0.1);
            gl.uniform1f(uSpeed, 1.0);

            gl.clearColor(1, 1, 1, 1);
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

        const onVis = () => {
            if (!document.hidden) schedule();
        };
        document.addEventListener('visibilitychange', onVis);

        schedule();

        return function cleanup() {
            if (raf) cancelAnimationFrame(raf);
            ro.disconnect();
            io.disconnect();
            document.removeEventListener('visibilitychange', onVis);
            window.removeEventListener('pointermove', onPointerMove);
            try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) {}
        };
    }

    /* ============================================
       MICRO SLATS
       ============================================ */
    (function microSlats() {
        const container = document.getElementById('bgMicroslats');
        if (!container) return;
        if (DISABLE_HEAVY || isMobile) return;

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

        function getSlatColor() {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            return isDark ? '255,255,255' : '37,99,235';
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

        window.addEventListener('asyrof-theme-change', () => schedule());

        schedule();
    })();

    /* ============================================
       CURSOR GRID
       ============================================ */
    (function cursorGrid() {
        if (isMobile) return;
        if (prefersReduced) return;

        const canvas = document.getElementById('cursorGridCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        const CELL = 70;
        const RADIUS = 140;
        const HOLD = 400;
        const FADE_MS = 800;
        const LINE = 1;
        const MAX_OP = 0.7;

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
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
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

        window.addEventListener('asyrof-theme-change', () => wake());

        wake();
    })();

    /* ============================================
       SPOTLIGHT CARD
       ============================================ */
    (function spotlightCard() {
        if (prefersReduced) return;
        const card = document.getElementById('registerCard');
        if (!card) return;

        let raf = 0;
        let targetX = 0, targetY = 0;
        let curX = 50, curY = 50;

        const onPointerMove = (e) => {
            const rect = card.getBoundingClientRect();
            targetX = e.clientX - rect.left;
            targetY = e.clientY - rect.top;
            if (!raf) raf = requestAnimationFrame(animate);
        };

        function animate() {
            raf = 0;
            curX += (targetX - curX) * 0.3;
            curY += (targetY - curY) * 0.3;

            card.style.setProperty('--mouse-x', curX + 'px');
            card.style.setProperty('--mouse-y', curY + 'px');

            if (Math.abs(targetX - curX) > 0.5 || Math.abs(targetY - curY) > 0.5) {
                raf = requestAnimationFrame(animate);
            }
        }

        card.addEventListener('pointermove', onPointerMove, { passive: true });
    })();

    /* ============================================
       INIT SHADER
       ============================================ */
    restartShader();

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            const container = document.getElementById('bgShader');
            if (container && !container.querySelector('canvas') && !container.classList.contains('shader-fallback')) {
                restartShader();
            }
        }
    });

    /* ============================================
       RECAPTCHA HELPER
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

    /* ============================================
       REGISTER LOGIC
       ============================================ */
    const form = document.getElementById('registerForm');
    if (!form) return;

    const alertEl = document.getElementById('alert');
    const alertText = document.getElementById('alert-text');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = document.getElementById('btnText');
    const btnIcon = document.getElementById('btnIcon');

    const usernameInput = document.getElementById('username');
    const nameInput = document.getElementById('name');
    const passwordInput = document.getElementById('password');
    const password2Input = document.getElementById('password2');
    const agreeCheckbox = document.getElementById('agree');

    const hintUsername = document.getElementById('hint-username');
    const hintPassword = document.getElementById('hint-password');
    const hintPassword2 = document.getElementById('hint-password2');

    const statusUsername = document.getElementById('status-username');

    const groupName = document.getElementById('group-name');
    const groupPassword = document.getElementById('group-password');
    const groupPassword2 = document.getElementById('group-password2');
    const groupTerms = document.getElementById('group-terms');

    const stepDots = document.querySelectorAll('.step-dot');
    const stepLines = document.querySelectorAll('.step-line');

    let usernameCheckState = {
        checking: false,
        available: false,
        lastChecked: '',
        abortController: null,
    };

    function showAlert(message, type = 'error') {
        alertEl.className = 'alert show ' + type;
        alertText.textContent = message;
    }
    function hideAlert() { alertEl.classList.remove('show'); }

    const EYE_OPEN = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
    const EYE_CLOSED = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;

    function setupEye(btnId, iconId, input) {
        const btn = document.getElementById(btnId);
        const icon = document.getElementById(iconId);
        if (!btn || !icon || !input) return;
        let visible = false;
        btn.addEventListener('click', () => {
            visible = !visible;
            input.type = visible ? 'text' : 'password';
            icon.innerHTML = visible ? EYE_CLOSED : EYE_OPEN;
        });
    }
    setupEye('togglePassword', 'eyeIcon', passwordInput);
    setupEye('togglePassword2', 'eyeIcon2', password2Input);

    const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

    function validateUsernameFormat() {
        const v = usernameInput.value.trim();
        if (!v) {
            usernameInput.classList.remove('valid', 'invalid');
            hintUsername.className = 'form-hint';
            hintUsername.textContent = 'Huruf, angka, underscore. 3-20 karakter.';
            return false;
        }
        if (!USERNAME_RE.test(v)) {
            usernameInput.classList.add('invalid');
            usernameInput.classList.remove('valid');
            hintUsername.className = 'form-hint error';
            hintUsername.textContent = 'Username hanya boleh huruf, angka, underscore (3-20 karakter).';
            return false;
        }
        return true;
    }

    function setUsernameStatus(state, message) {
        statusUsername.className = 'input-status';
        if (state === 'loading') {
            statusUsername.innerHTML = '<div class="loading-spinner-sm"></div>';
            statusUsername.classList.add('show');
            hintUsername.className = 'form-hint';
            hintUsername.textContent = 'Mengecek ketersediaan username...';
            usernameInput.classList.remove('valid', 'invalid');
        } else if (state === 'success') {
            statusUsername.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
            statusUsername.classList.add('show', 'success');
            hintUsername.className = 'form-hint success';
            hintUsername.textContent = message || '✓ Username tersedia';
            usernameInput.classList.add('valid');
            usernameInput.classList.remove('invalid');
        } else if (state === 'error') {
            statusUsername.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
            statusUsername.classList.add('show', 'error');
            hintUsername.className = 'form-hint error';
            hintUsername.textContent = message || '✕ Username tidak tersedia';
            usernameInput.classList.add('invalid');
            usernameInput.classList.remove('valid');
        } else {
            statusUsername.innerHTML = '';
            statusUsername.classList.remove('show', 'success', 'error');
        }
    }

    async function checkUsernameToBackend(username) {
        if (usernameCheckState.abortController) {
            usernameCheckState.abortController.abort();
        }
        const controller = new AbortController();
        usernameCheckState.abortController = controller;

        usernameCheckState.checking = true;
        usernameCheckState.available = false;
        usernameCheckState.lastChecked = username;

        setUsernameStatus('loading');

        try {
            const res = await fetch('/api/auth/check-username', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username }),
                signal: controller.signal,
            });

            const data = await res.json();
            if (usernameCheckState.lastChecked !== username) return;
            usernameCheckState.checking = false;

            if (!res.ok) {
                setUsernameStatus('error', data.error || 'Gagal cek username');
                return;
            }

            if (data.available) {
                usernameCheckState.available = true;
                setUsernameStatus('success', '✓ Username tersedia');
                revealNext();
            } else {
                usernameCheckState.available = false;
                setUsernameStatus('error', '✕ Username sudah dipakai. Coba yang lain.');
            }
            checkReady();
        } catch (err) {
            if (err.name === 'AbortError') return;
            if (usernameCheckState.lastChecked !== username) return;
            usernameCheckState.checking = false;
            setUsernameStatus('error', 'Gagal cek username. Coba lagi.');
        }
    }

    let usernameDebounceTimer = null;
    function scheduleUsernameCheck(username) {
        clearTimeout(usernameDebounceTimer);
        usernameDebounceTimer = setTimeout(() => {
            checkUsernameToBackend(username);
        }, 500);
    }

    function validatePassword() {
        const v = passwordInput.value;
        if (!v) {
            passwordInput.classList.remove('valid', 'invalid');
            hintPassword.className = 'form-hint';
            hintPassword.textContent = 'Minimal 6 karakter.';
            return false;
        }
        if (v.length < 6) {
            passwordInput.classList.add('invalid');
            passwordInput.classList.remove('valid');
            hintPassword.className = 'form-hint error';
            hintPassword.textContent = 'Password minimal 6 karakter.';
            return false;
        }
        passwordInput.classList.add('valid');
        passwordInput.classList.remove('invalid');
        hintPassword.className = 'form-hint success';
        hintPassword.textContent = '✓ Password cukup kuat';
        return true;
    }

    function validatePassword2() {
        const v = password2Input.value;
        if (!v) {
            password2Input.classList.remove('valid', 'invalid');
            hintPassword2.className = 'form-hint';
            hintPassword2.textContent = 'Ulangi password yang sama.';
            return false;
        }
        if (v !== passwordInput.value) {
            password2Input.classList.add('invalid');
            password2Input.classList.remove('valid');
            hintPassword2.className = 'form-hint error';
            hintPassword2.textContent = 'Password tidak cocok.';
            return false;
        }
        password2Input.classList.add('valid');
        password2Input.classList.remove('invalid');
        hintPassword2.className = 'form-hint success';
        hintPassword2.textContent = '✓ Password cocok';
        return true;
    }

    function revealNext() {
        if (validateUsernameFormat() && usernameCheckState.available && !groupName.classList.contains('visible')) {
            groupName.classList.add('visible');
            updateSteps(2);
            return;
        }
        if (groupName.classList.contains('visible') && !groupPassword.classList.contains('visible') && usernameCheckState.available) {
            groupPassword.classList.add('visible');
            updateSteps(3);
            return;
        }
        if (groupPassword.classList.contains('visible') && !groupPassword2.classList.contains('visible') && validatePassword()) {
            groupPassword2.classList.add('visible');
            updateSteps(4);
            return;
        }
        if (groupPassword2.classList.contains('visible') && !groupTerms.classList.contains('visible') && validatePassword2()) {
            groupTerms.classList.add('visible');
            updateSteps(5);
        }
        checkReady();
    }

    function checkReady() {
        const ok = validateUsernameFormat()
            && usernameCheckState.available
            && validatePassword()
            && validatePassword2()
            && agreeCheckbox.checked;
        submitBtn.disabled = !ok;
    }

    function updateSteps(activeStep) {
        stepDots.forEach(dot => {
            const s = Number(dot.dataset.step);
            dot.classList.toggle('active', s === activeStep);
            dot.classList.toggle('done', s < activeStep);
            if (s < activeStep) dot.textContent = '✓';
            else dot.textContent = String(s);
        });
        stepLines.forEach(line => {
            const l = Number(line.dataset.line);
            line.classList.toggle('done', l < activeStep);
        });
    }

    usernameInput.addEventListener('input', () => {
        const v = usernameInput.value.trim();
        usernameCheckState.available = false;
        if (!validateUsernameFormat()) {
            setUsernameStatus('idle');
            checkReady();
            return;
        }
        scheduleUsernameCheck(v);
        checkReady();
    });

    usernameInput.addEventListener('blur', () => {
        const v = usernameInput.value.trim();
        if (validateUsernameFormat()) {
            if (usernameCheckState.lastChecked !== v || !usernameCheckState.available) {
                clearTimeout(usernameDebounceTimer);
                checkUsernameToBackend(v);
            }
        }
    });

    nameInput.addEventListener('blur', () => { if (groupName.classList.contains('visible')) revealNext(); });
    nameInput.addEventListener('input', () => { if (groupName.classList.contains('visible')) revealNext(); });

    passwordInput.addEventListener('input', () => {
        validatePassword();
        if (validatePassword()) revealNext();
        if (password2Input.value) validatePassword2();
        checkReady();
    });
    passwordInput.addEventListener('blur', () => { if (validatePassword()) revealNext(); });

    password2Input.addEventListener('input', () => {
        validatePassword2();
        if (validatePassword2()) revealNext();
        checkReady();
    });
    password2Input.addEventListener('blur', () => { if (validatePassword2()) revealNext(); });

    agreeCheckbox.addEventListener('change', () => {
        checkReady();
        if (agreeCheckbox.checked && validateUsernameFormat() && usernameCheckState.available && validatePassword() && validatePassword2()) {
            updateSteps(5);
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        if (!validateUsernameFormat()) { showAlert('Username tidak valid', 'error'); return; }
        if (!usernameCheckState.available) { showAlert('Username belum tersedia atau belum dicek', 'error'); return; }
        if (!validatePassword()) { showAlert('Password minimal 6 karakter', 'error'); return; }
        if (!validatePassword2()) { showAlert('Konfirmasi password tidak cocok', 'error'); return; }
        if (!agreeCheckbox.checked) { showAlert('Kamu harus menyetujui Syarat & Ketentuan', 'error'); return; }

        const username = usernameInput.value.trim();
        const name = nameInput.value.trim();
        const password = passwordInput.value;

        submitBtn.disabled = true;
        btnText.textContent = 'Memproses...';
        if (btnIcon && btnIcon.parentNode) {
            btnIcon.outerHTML = '<div class="spinner" id="btnIcon"></div>';
        }

        try {
            await waitForRecaptcha();
            if (!window.grecaptcha || !window.grecaptcha.execute) {
                throw new Error('Verifikasi keamanan gagal dimuat. Refresh halaman.');
            }

            const recaptchaToken = await new Promise((resolve, reject) => {
                grecaptcha.ready(() => {
                    grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'register' })
                        .then(resolve)
                        .catch(reject);
                });
                setTimeout(() => reject(new Error('Timeout verifikasi keamanan')), 10000);
            });

            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username,
                    password,
                    name: name || undefined,
                    recaptcha_token: recaptchaToken,
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Registrasi gagal');

            updateSteps(6);
            showAlert('Registrasi berhasil! Mengalihkan ke login...', 'success');

            setTimeout(() => { window.location.replace('/login'); }, 1200);

        } catch (err) {
            showAlert(err.message, 'error');
            submitBtn.disabled = false;
            btnText.textContent = 'Daftar';
            const oldIcon = document.getElementById('btnIcon');
            if (oldIcon) {
                oldIcon.outerHTML = '<svg class="icon-svg" viewBox="0 0 24 24" id="btnIcon"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
            }
            if (err.message && err.message.toLowerCase().includes('username')) {
                usernameCheckState.available = false;
                setUsernameStatus('error', '✕ ' + err.message);
            }
        }
    });

    checkReady();
})();
