/* ============================================
   LOGIN PAGE v2 — Aurora + Sticker + Logic
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

        // DevTools detection → set flag + reload (fake 500 error akan tampil)
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
       AURORA BG — WebGL (ported dari React Bits)
       ============================================ */
    (function aurora() {
        const container = document.getElementById('auroraBg');
        if (!container) return;

        // Fallback CSS kalau reduced motion / low-end
        if (DISABLE_HEAVY) {
            container.classList.add('aurora-fallback');
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
uniform float uLightMode;
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

struct ColorStop {
    vec3 color;
    float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {              \
    int index = 0;                                            \
    for (int i = 0; i < 2; i++) {                             \
        ColorStop currentColor = colors[i];                   \
        bool isInBetween = currentColor.position <= factor;   \
        index = int(mix(float(index), float(i), float(isInBetween))); \
    }                                                         \
    ColorStop currentColor = colors[index];                   \
    ColorStop nextColor = colors[index + 1];                  \
    float range = nextColor.position - currentColor.position; \
    float lerpFactor = (factor - currentColor.position) / range; \
    finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \
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
    if (uLightMode > 0.5) {
        float energy = clamp(max(intensity, 0.0), 0.0, 1.0);
        float coverage = clamp(auroraAlpha * (0.55 + 0.45 * energy), 0.0, 0.86);
        vec3 chroma = pow(clamp(rampColor, 0.0, 1.0), vec3(1.2));
        float chromaPeak = max(chroma.r, max(chroma.g, chroma.b));
        chroma /= max(chromaPeak, 0.0001);
        fragColor = vec4(mix(vec3(1.0), chroma, min(coverage * 1.08, 0.94)), 1.0);
    } else {
        fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
    }
}
`;

        function compile(type, src) {
            const sh = gl.createShader(type);
            gl.shaderSource(sh, src);
            gl.compileShader(sh);
            if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
                console.warn('Aurora shader fail:', gl.getShaderInfoLog(sh));
                return null;
            }
            return sh;
        }

        const vs = compile(gl.VERTEX_SHADER, VERT);
        const fs = compile(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) {
            container.classList.add('aurora-fallback');
            return;
        }

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            container.classList.add('aurora-fallback');
            return;
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
        const uLight = gl.getUniformLocation(prog, 'uLightMode');

        // Warna aurora — selaras dengan brand biru-ungu
        const colors = [
            [0.32, 0.15, 1.0],    // #5227FF
            [0.49, 0.39, 0.81],   // #7D63CF
            [0.95, 0.4, 0.7]      // #F266B2
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

            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

            gl.uniform1f(uTime, (now - t0) * 0.001);
            gl.uniform1f(uAmp, 1.0);
            gl.uniform1f(uBlend, 0.5);
            gl.uniform1f(uLight, isDark ? 0 : 1);
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
       STICKER PEEL — Draggable logo
       ============================================ */
    (function sticker() {
        const wrapper = document.getElementById('stickerWrapper');
        const link = document.getElementById('stickerLink');
        const stickerContainer = document.getElementById('stickerContainer');
        if (!wrapper || !link || !stickerContainer) return;

        let dragging = false;
        let startX = 0, startY = 0;
        let currentX = 0, currentY = 0;
        let targetX = 0, targetY = 0;
        let velocityX = 0, velocityY = 0;
        let rotation = 0;
        let raf = 0;
        let moved = false;

        // Boundary — batas gerak relatif ke posisi tengah
        const MAX_DRIFT_X = 60;
        const MAX_DRIFT_Y = 40;

        function applyTransform() {
            stickerContainer.style.transform = `translate(${currentX}px, ${currentY}px) rotate(${rotation}deg) rotate(0deg)`;
        }

        function animate() {
            raf = 0;

            // Spring balik ke 0 kalau tidak dragging
            if (!dragging) {
                const stiffness = 0.15;
                const damping = 0.8;

                velocityX += (targetX - currentX) * stiffness;
                velocityY += (targetY - currentY) * stiffness;
                velocityX *= damping;
                velocityY *= damping;

                currentX += velocityX;
                currentY += velocityY;

                // Rotation ikut velocity horizontal
                rotation += (0 - rotation) * 0.1;
                rotation += velocityX * 0.8;
                rotation *= 0.85;

                // Snap ke 0 kalau udah deket
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
                return;
            }
        }

        function onPointerDown(e) {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            dragging = true;
            moved = false;
            startX = e.clientX;
            startY = e.clientY;
            currentX = 0;
            currentY = 0;
            velocityX = 0;
            velocityY = 0;
            rotation = 0;
            link.setPointerCapture?.(e.pointerId);
            wrapper.classList.add('dragging');
            stickerContainer.classList.add('touch-active');
        }

        function onPointerMove(e) {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;

            // Clamp
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

            // Kalau gak gerak jauh → klik link
            if (!moved) {
                // biarkan click default
            } else {
                // Cegah click setelah drag
                e.preventDefault?.();
            }

            // Mulai animasi balik
            if (!raf) raf = requestAnimationFrame(animate);
        }

        link.addEventListener('pointerdown', onPointerDown, { passive: true });
        link.addEventListener('pointermove', onPointerMove, { passive: true });
        link.addEventListener('pointerup', onPointerUp);
        link.addEventListener('pointercancel', onPointerUp);

        // Cegah click kalau abis drag
        link.addEventListener('click', (e) => {
            if (moved) {
                e.preventDefault();
                e.stopPropagation();
            }
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

    const EYE_OPEN = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
    const EYE_CLOSED = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>`;

    let passwordVisible = false;
    togglePassword.addEventListener('click', () => {
        passwordVisible = !passwordVisible;
        passwordInput.type = passwordVisible ? 'text' : 'password';
        eyeIcon.innerHTML = passwordVisible ? EYE_CLOSED : EYE_OPEN;
    });

    function showAlert(message, type = 'error') {
        alertEl.className = 'alert show ' + type;
        alertText.textContent = message;
    }
    function hideAlert() { alertEl.classList.remove('show'); }

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
