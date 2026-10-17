/* ============================================================
   DAFTAR.JS — All-in-one: crypto + cache + API + security + form
   Obfuscated naming biar susah dibaca
   ============================================================ */
(function (global) {
  'use strict';

  /* ============================================================
     §1 — CRYPTO (AES-GCM + PBKDF2)
     ============================================================ */
  const _crypto = (() => {
    const _k = 'dGhpcy1pcy1hLXNlY3JldC1rZXktZm9yLWNhY2hlLTIwMjY=';
    const _s = 'c2FsdC1hc3lyb2Ytb3RwLXYyMDI2LXNlY3VyZQ==';
    const _i = 100000;
    let _dk = null;

    async function _derive() {
      if (_dk) return _dk;
      const enc = new TextEncoder();
      const base = await crypto.subtle.importKey(
        'raw', enc.encode(atob(_k)), { name: 'PBKDF2' }, false, ['deriveKey']
      );
      _dk = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(atob(_s)), iterations: _i, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
      return _dk;
    }

    function _b2buf(b64) {
      const bin = atob(b64);
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u.buffer;
    }
    function _buf2b(buf) {
      const b = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      return btoa(s);
    }

    async function seal(obj) {
      try {
        const key = await _derive();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const c = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))
        );
        const comb = new Uint8Array(iv.length + c.byteLength);
        comb.set(iv, 0);
        comb.set(new Uint8Array(c), iv.length);
        return _buf2b(comb.buffer);
      } catch (e) { return null; }
    }

    async function unseal(b64) {
      try {
        const key = await _derive();
        const buf = _b2buf(b64);
        const iv = buf.slice(0, 12);
        const data = buf.slice(12);
        const plain = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: new Uint8Array(iv) }, key, data
        );
        return JSON.parse(new TextDecoder().decode(plain));
      } catch (e) { return null; }
    }

    return { seal, unseal };
  })();

  /* ============================================================
     §2 — API CACHE (memory + persistent + dedupe + negative)
     ============================================================ */
  const _api = (() => {
    const P = 'aotp_c_';
    const TTL = 5 * 60 * 1000;
    const NEG_TTL = 30 * 1000;
    const _inflight = new Map();
    const _mem = new Map();
    const _neg = new Map();

    async function _read(key) {
      if (_mem.has(key)) {
        const e = _mem.get(key);
        if (Date.now() - e.t < TTL) return e.v;
        _mem.delete(key);
      }
      try {
        const raw = localStorage.getItem(P + key);
        if (!raw) return null;
        const e = await _crypto.unseal(raw);
        if (!e || Date.now() - e.t > TTL) {
          localStorage.removeItem(P + key);
          return null;
        }
        _mem.set(key, e);
        return e.v;
      } catch (e) { return null; }
    }

    async function _write(key, v) {
      const e = { t: Date.now(), v };
      _mem.set(key, e);
      try {
        const s = await _crypto.seal(e);
        if (s) localStorage.setItem(P + key, s);
      } catch (e) {}
    }

    async function fetchCached(url, opts = {}, cfg = {}) {
      const key = cfg.key || (opts.method || 'GET') + ':' + url;
      const force = cfg.force === true;

      if (!force && _neg.has(key)) {
        const n = _neg.get(key);
        if (Date.now() - n.t < (cfg.negTtl || NEG_TTL)) return n.r.clone();
        _neg.delete(key);
      }

      if (!force && (opts.method || 'GET') === 'GET') {
        const c = await _read(key);
        if (c) {
          return new Response(JSON.stringify(c), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'X-From-Cache': '1' },
          });
        }
      }

      if (_inflight.has(key)) return _inflight.get(key);

      const p = (async () => {
        try {
          const res = await fetch(url, opts);
          if (res.ok && (opts.method || 'GET') === 'GET') {
            const d = await res.clone().json().catch(() => null);
            if (d) await _write(key, d);
          } else if (res.status >= 400 && res.status < 500) {
            _neg.set(key, { t: Date.now(), r: res.clone() });
          }
          return res;
        } finally {
          _inflight.delete(key);
        }
      })();

      _inflight.set(key, p);
      return p;
    }

    function prefetch(urls) {
      const run = () => urls.forEach((u) => fetchCached(u).catch(() => {}));
      if ('requestIdleCallback' in window) {
        requestIdleCallback(run, { timeout: 3000 });
      } else {
        setTimeout(run, 1500);
      }
    }

    function invalidate(prefix) {
      _mem.forEach((_, k) => { if (k.startsWith(prefix)) _mem.delete(k); });
      try {
        Object.keys(localStorage).forEach((k) => {
          if (k.startsWith(P + prefix)) localStorage.removeItem(k);
        });
      } catch (e) {}
    }

    return { fetchCached, prefetch, invalidate };
  })();

  /* ============================================================
     §3 — CONFIG
     ============================================================ */
  const _cfg = {
    rk: '6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg',
    ep: {
      check: '/api/auth/check-username',
      reg: '/api/auth/register',
      me: '/api/user',
    },
    userRe: /^[a-zA-Z0-9_]{3,20}$/,
    minPass: 6,
  };

  /* ============================================================
     §4 — DEVICE DETECTION
     ============================================================ */
  const _dev = (() => {
    const mq = (q) => window.matchMedia(q).matches;
    const hc = navigator.hardwareConcurrency || 4;
    const conn = navigator.connection || {};
    const mobile = mq('(max-width: 700px)');
    const lowEnd = hc <= 4 || conn.saveData || /2g|slow-2g/.test(conn.effectiveType || '');
    const reduced = mq('(prefers-reduced-motion: reduce)');
    return { mobile, lowEnd, reduced, disableHeavy: reduced || lowEnd };
  })();

  if (_dev.disableHeavy) {
    document.documentElement.setAttribute('data-perf', 'lite');
  }

  /* ============================================================
     §5 — SECURITY (multi-layer, susah dibaca)
     ============================================================ */
  (function _sec() {
    // Console warning
    try {
      const a = '%c⚠️ STOP!';
      const b = '%cJangan paste apapun di sini. Itu SCAM.';
      console.log(a, 'color:#ff3b30;font-size:20px;font-weight:900');
      console.log(b, 'color:#8e8e93;font-size:12px');
    } catch (e) {}

    // Block context menu
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    // Block keys
    document.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'F12') { e.preventDefault(); return false; }
      if (e.ctrlKey && e.shiftKey && ['I','J','C','i','j','c'].includes(k)) {
        e.preventDefault(); return false;
      }
      if (e.ctrlKey && ['U','u','S','s','P','p'].includes(k)) {
        e.preventDefault(); return false;
      }
    }, true);

    // Block copy/cut di luar input
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

    // Clean URL
    try {
      const clean = location.origin + location.pathname;
      if (location.search) history.replaceState(null, '', clean);
    } catch (e) {}

    // DevTools detection (3 methods, cuma lock kalau 2+ positif)
    const _flag = 'aotp_dtl';
    if (sessionStorage.getItem(_flag) === '1') {
      _lockScreen();
      return;
    }
    if (navigator.maxTouchPoints > 0 && innerWidth < 1024) return;
    if (innerWidth < 600) return;

    let _pos = 0;
    setInterval(() => {
      let hits = 0;
      // dim
      const wd = outerWidth - innerWidth;
      const hd = outerHeight - innerHeight;
      if (wd > 220 || hd > 220) hits++;
      // timing
      const t0 = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      if (performance.now() - t0 > 120) hits++;
      // scale
      if (outerWidth / innerWidth > 1.3 || outerHeight / innerHeight > 1.3) hits++;

      if (hits >= 2) {
        _pos++;
        if (_pos >= 2) {
          try { sessionStorage.setItem(_flag, '1'); } catch (e) {}
          document.body.innerHTML = '';
          location.reload();
        }
      } else {
        _pos = 0;
      }
    }, 1200);

    function _lockScreen() {
      document.documentElement.innerHTML = '<head></head><body></body>';
      const show = () => {
        document.body.innerHTML = '<div id="aotpLock"><div class="aotp-lock-box"><div class="aotp-lock-icon">🔒</div><h2>Akses Dibatasi</h2><p>Developer Tools terdeteksi. Konten dihapus sementara demi keamanan.</p><p class="aotp-lock-hint">Tutup Developer Tools untuk memuat ulang.</p></div></div><style>html,body{margin:0;padding:0;background:#0f172a;overflow:auto!important;height:auto!important;min-height:100vh!important;width:100%!important}#aotpLock{min-height:100vh;width:100%;background:#0f172a;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,sans-serif;user-select:none;-webkit-user-select:none}#aotpLock .aotp-lock-box{background:#1e293b;border:3px solid #475569;border-radius:20px;padding:40px 32px;max-width:440px;width:100%;text-align:center;box-shadow:8px 8px 0px rgba(0,0,0,.5);box-sizing:border-box}#aotpLock .aotp-lock-icon{font-size:3rem;margin-bottom:16px;line-height:1}#aotpLock h2{color:#dc2626;font-size:1.5rem;font-weight:800;margin:0 0 12px}#aotpLock p{color:#cbd5e1;font-size:.95rem;line-height:1.6;margin:0 0 8px}#aotpLock .aotp-lock-hint{color:#64748b;font-size:.78rem;font-family:ui-monospace,monospace;margin-top:20px;padding-top:16px;border-top:1px dashed #334155}</style>';
        setInterval(() => {
          if (outerWidth - innerWidth <= 200 && outerHeight - innerHeight <= 200) {
            sessionStorage.removeItem(_flag);
            location.reload();
          }
        }, 700);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', show);
      } else {
        show();
      }
    }
  })();

  /* ============================================================
     §6 — AUTO REDIRECT kalau sudah login
     ============================================================ */
  (async function _checkAuth() {
    let tk = null;
    try { tk = localStorage.getItem('access_token'); } catch (e) {}
    if (!tk) return;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(_cfg.ep.me, {
        headers: { Authorization: 'Bearer ' + tk },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (res.ok) { location.replace('/dashboard'); return; }
      if (res.status === 401 || res.status === 403) {
        try {
          localStorage.removeItem('access_token');
          localStorage.removeItem('user');
          localStorage.removeItem('refresh_token');
        } catch (e) {}
      }
    } catch (e) {}
  })();

  /* ============================================================
     §7 — THEME
     ============================================================ */
  (function _theme() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      const nx = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', nx);
      try { localStorage.setItem('asyrofotp_theme', nx); } catch (e) {}
      const m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', nx === 'dark' ? '#000000' : '#007aff');
      _restartShader();
    });
  })();

  /* ============================================================
     §8 — SHADER (Aurora dark / Iridescence light)
     ============================================================ */
  let _shaderCleanup = null;

  function _restartShader() {
    if (_shaderCleanup) {
      try { _shaderCleanup(); } catch (e) {}
      _shaderCleanup = null;
    }
    const c = document.getElementById('bgShader');
    if (!c) return;
    c.innerHTML = '';
    c.classList.remove('shader-fallback');
    if (_dev.disableHeavy) { c.classList.add('shader-fallback'); return; }
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    _shaderCleanup = theme === 'dark' ? _initAurora(c) : _initIridescence(c);
  }

  function _initAurora(container) {
    const cv = document.createElement('canvas');
    cv.style.cssText = 'display:block;width:100%;height:100%';
    container.appendChild(cv);
    const gl = cv.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
      powerPreference: 'low-power',
    });
    if (!gl) { container.classList.add('shader-fallback'); return null; }

    const V = `#version 300 es
in vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}`;

    const F = `#version 300 es
precision highp float;
uniform float uT;uniform vec3 uC[3];uniform vec2 uR;uniform float uB;
out vec4 o;
vec3 pm(vec3 x){return mod(((x*34.0)+1.0)*x,289.0);}
float sn(vec2 v){
  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
  vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod(i,289.0);
  vec3 p=pm(pm(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);
  m=m*m;m=m*m;vec3 x=2.0*fract(p*C.www)-1.0;vec3 h=abs(x)-0.5;vec3 ox=floor(x+0.5);vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);vec3 g;
  g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.0*dot(m,g);
}
struct CS{vec3 c;float p;};
void main(){
  vec2 uv=gl_FragCoord.xy/uR;
  CS cs[3];cs[0]=CS(uC[0],0.0);cs[1]=CS(uC[1],0.5);cs[2]=CS(uC[2],1.0);
  int idx=0;
  for(int i=0;i<2;i++){bool ib=cs[i].p<=uv.x;idx=int(mix(float(idx),float(i),float(ib)));}
  vec3 rc=mix(cs[idx].c,cs[idx+1].c,(uv.x-cs[idx].p)/(cs[idx+1].p-cs[idx].p));
  float h=sn(vec2(uv.x*2.0+uT*0.1,uT*0.25))*0.5;h=exp(h);h=(uv.y*2.0-h+0.2);
  float it=0.6*h;float mp=0.20;
  float aa=smoothstep(mp-uB*0.5,mp+uB*0.5,it);
  o=vec4(it*rc*aa,aa);
}`;

    function comp(t, s) {
      const sh = gl.createShader(t);
      gl.shaderSource(sh, s);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    }
    const vs = comp(gl.VERTEX_SHADER, V);
    const fs = comp(gl.FRAGMENT_SHADER, F);
    if (!vs || !fs) { container.classList.add('shader-fallback'); return null; }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      container.classList.add('shader-fallback'); return null;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uT = gl.getUniformLocation(prog, 'uT');
    const uC = gl.getUniformLocation(prog, 'uC');
    const uR = gl.getUniformLocation(prog, 'uR');
    const uB = gl.getUniformLocation(prog, 'uB');

    const colors = [0.32,0.15,1.0, 0.49,0.39,0.81, 0.95,0.4,0.7];

    function resize() {
      const r = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width));
      const h = Math.max(1, Math.floor(r.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform2f(uR, cv.width, cv.height);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    let raf = 0;
    let vis = true;
    let lr = 0;
    const FM = 1000 / 30;
    const t0 = performance.now();

    function frame(now) {
      raf = 0;
      if (!vis || document.hidden) return;
      if (now - lr < FM) { raf = requestAnimationFrame(frame); return; }
      lr = now;
      gl.uniform1f(uT, (now - t0) * 0.001);
      gl.uniform3fv(uC, new Float32Array(colors));
      gl.uniform1f(uB, 0.5);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }
    function sched() {
      if (!raf && vis && !document.hidden) { lr = 0; raf = requestAnimationFrame(frame); }
    }
    const io = new IntersectionObserver(([e]) => {
      vis = e.isIntersecting;
      if (vis) sched();
    }, { threshold: 0 });
    io.observe(container);
    const onVis = () => { if (!document.hidden) sched(); };
    document.addEventListener('visibilitychange', onVis);
    sched();

    return function () {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) {}
    };
  }

  function _initIridescence(container) {
    const cv = document.createElement('canvas');
    cv.style.cssText = 'display:block;width:100%;height:100%';
    container.appendChild(cv);
    const gl = cv.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
      powerPreference: 'low-power',
    });
    if (!gl) { container.classList.add('shader-fallback'); return null; }

    const V = `#version 300 es
in vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}`;

    const F = `#version 300 es
precision highp float;
uniform float uT;uniform vec3 uC;uniform vec3 uR;uniform vec2 uM;uniform float uA;uniform float uS;
out vec4 o;
void main(){
  float mr=min(uR.x,uR.y);
  vec2 uv=((gl_FragCoord.xy/uR.xy)*2.0-1.0)*uR.xy/mr;
  uv+=(uM-vec2(0.5))*uA;
  float d=-uT*0.5*uS;float a=0.0;
  for(float i=0.0;i<8.0;++i){a+=cos(i-d-a*uv.x);d+=sin(uv.y*i+a);}
  d+=uT*0.5*uS;
  vec3 col=vec3(cos(uv*vec2(d,a))*0.6+0.4,cos(a+d)*0.5+0.5);
  col=cos(col*cos(vec3(d,a,2.5))*0.5+0.5)*uC;
  o=vec4(col,1.0);
}`;

    function comp(t, s) {
      const sh = gl.createShader(t);
      gl.shaderSource(sh, s);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    }
    const vs = comp(gl.VERTEX_SHADER, V);
    const fs = comp(gl.FRAGMENT_SHADER, F);
    if (!vs || !fs) { container.classList.add('shader-fallback'); return null; }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      container.classList.add('shader-fallback'); return null;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uT = gl.getUniformLocation(prog, 'uT');
    const uC = gl.getUniformLocation(prog, 'uC');
    const uR = gl.getUniformLocation(prog, 'uR');
    const uM = gl.getUniformLocation(prog, 'uM');
    const uA = gl.getUniformLocation(prog, 'uA');
    const uS = gl.getUniformLocation(prog, 'uS');

    const base = [0.55, 0.65, 0.95];
    const tgt = [0.5, 0.5];
    const cur = [0.5, 0.5];

    function resize() {
      const r = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(r.width));
      const h = Math.max(1, Math.floor(r.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.uniform3f(uR, cv.width, cv.height, cv.width / cv.height);
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const onPtr = (e) => {
      const r = container.getBoundingClientRect();
      tgt[0] = (e.clientX - r.left) / r.width;
      tgt[1] = 1 - (e.clientY - r.top) / r.height;
    };
    window.addEventListener('pointermove', onPtr, { passive: true });

    let raf = 0;
    let vis = true;
    let lr = 0;
    const FM = 1000 / 30;
    const t0 = performance.now();

    function frame(now) {
      raf = 0;
      if (!vis || document.hidden) return;
      if (now - lr < FM) { raf = requestAnimationFrame(frame); return; }
      lr = now;
      cur[0] += 0.05 * (tgt[0] - cur[0]);
      cur[1] += 0.05 * (tgt[1] - cur[1]);
      gl.uniform1f(uT, (now - t0) * 0.001);
      gl.uniform3f(uC, base[0], base[1], base[2]);
      gl.uniform2f(uM, cur[0], cur[1]);
      gl.uniform1f(uA, 0.1);
      gl.uniform1f(uS, 1.0);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }
    function sched() {
      if (!raf && vis && !document.hidden) { lr = 0; raf = requestAnimationFrame(frame); }
    }
    const io = new IntersectionObserver(([e]) => {
      vis = e.isIntersecting;
      if (vis) sched();
    }, { threshold: 0 });
    io.observe(container);
    const onVis = () => { if (!document.hidden) sched(); };
    document.addEventListener('visibilitychange', onVis);
    sched();

    return function () {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pointermove', onPtr);
      try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) {}
    };
  }

  /* ============================================================
     §9 — MICRO SLATS
     ============================================================ */
  (function _slats() {
    const c = document.getElementById('bgMicroslats');
    if (!c || _dev.disableHeavy || _dev.mobile) return;
    const cv = document.createElement('canvas');
    cv.style.cssText = 'display:block;width:100%;height:100%';
    c.appendChild(cv);
    const ctx = cv.getContext('2d', { alpha: true });
    if (!ctx) return;

    let w = 1, h = 1, cols = 1, rows = 1, offX = 0, offY = 0;
    const sw = 8, sh = 22, gap = 4;
    let raf = 0, time = 0, vis = true, lr = 0;
    const FM = 1000 / 24;

    function resize() {
      const r = c.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      cv.width = Math.floor(w);
      cv.height = Math.floor(h);
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const px = sw + gap, py = sh + gap;
      cols = Math.ceil((w + gap) / px) + 1;
      rows = Math.ceil((h + gap) / py) + 1;
      offX = (w - (cols * px - gap)) / 2;
      offY = (h - (rows * py - gap)) / 2;
    }

    function col() {
      return document.documentElement.getAttribute('data-theme') === 'dark'
        ? '255,255,255' : '0,122,255';
    }

    function render(now) {
      raf = 0;
      if (!vis || document.hidden) return;
      if (now - lr < FM) { raf = requestAnimationFrame(render); return; }
      lr = now;
      time += 0.016;
      ctx.clearRect(0, 0, w, h);
      const px = sw + gap, py = sh + gap;
      const cr = col();
      for (let row = 0; row < rows; row++) {
        for (let colI = 0; colI < cols; colI++) {
          const cx = offX + colI * px + sw / 2;
          const cy = offY + row * py + sh / 2;
          const w1 = Math.sin(colI * 0.3 + time * 0.8) * 0.5 + 0.5;
          const w2 = Math.cos(row * 0.25 + time * 0.6) * 0.5 + 0.5;
          const lv = (w1 + w2) / 2;
          const alpha = 0.04 + lv * 0.28;
          const ch = sh * (0.4 + lv * 0.6);
          ctx.fillStyle = 'rgba(' + cr + ',' + alpha.toFixed(3) + ')';
          ctx.fillRect(cx - sw / 2, cy - ch / 2, sw, ch);
        }
      }
      raf = requestAnimationFrame(render);
    }
    function sched() {
      if (!raf && vis && !document.hidden) { lr = 0; raf = requestAnimationFrame(render); }
    }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    const ro = new ResizeObserver(() => { resize(); sched(); });
    ro.observe(c);
    resize();

    const io = new IntersectionObserver(([e]) => {
      vis = e.isIntersecting;
      if (vis) sched(); else stop();
    }, { threshold: 0 });
    io.observe(c);

    const onVis = () => { if (document.hidden) stop(); else sched(); };
    document.addEventListener('visibilitychange', onVis);
    sched();
  })();

  /* ============================================================
     §10 — CURSOR GRID
     ============================================================ */
  (function _cursor() {
    if (_dev.mobile || _dev.reduced) return;
    const cv = document.getElementById('cursorGridCanvas');
    if (!cv) return;
    const ctx = cv.getContext('2d', { alpha: true });
    if (!ctx) return;

    const CELL = 70, RADIUS = 140, HOLD = 400, FADE = 800, MAX_OP = 0.7;
    let cols = 0, rows = 0, offX = 0, offY = 0;
    let alphas = new Float32Array(0);
    let touched = new Float64Array(0);
    let w = 1, h = 1, raf = 0, running = false;
    let lastF = 0, vis = true, lr = 0;
    const FM = 1000 / 30;

    function getColor() {
      return document.documentElement.getAttribute('data-theme') === 'dark'
        ? [147, 197, 253] : [0, 122, 255];
    }

    function rebuild() {
      const r = cv.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      cv.width = Math.floor(w);
      cv.height = Math.floor(h);
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      cols = Math.ceil(w / CELL) + 1;
      rows = Math.ceil(h / CELL) + 1;
      offX = (w - cols * CELL) / 2;
      offY = (h - rows * CELL) / 2;
      alphas = new Float32Array(cols * rows);
      touched = new Float64Array(cols * rows);
    }

    function cc(i) {
      return [offX + (i % cols) * CELL + CELL / 2, offY + Math.floor(i / cols) * CELL + CELL / 2];
    }

    function en(x, y) {
      const now = performance.now();
      const mc = Math.max(0, Math.floor((x - RADIUS - offX) / CELL));
      const xc = Math.min(cols - 1, Math.floor((x + RADIUS - offX) / CELL));
      const mr = Math.max(0, Math.floor((y - RADIUS - offY) / CELL));
      const xr = Math.min(rows - 1, Math.floor((y + RADIUS - offY) / CELL));
      for (let r = mr; r <= xr; r++) {
        for (let c = mc; c <= xc; c++) {
          const i = r * cols + c;
          const [cx, cy] = cc(i);
          const d = Math.hypot(cx - x, cy - y);
          if (d > RADIUS) continue;
          const t = 1 - d / RADIUS;
          const e = t * t * (3 - 2 * t);
          const lv = e * MAX_OP;
          if (lv > alphas[i]) { alphas[i] = lv; touched[i] = now; }
          else if (lv > 0) touched[i] = now;
        }
      }
    }

    function draw(now) {
      raf = 0;
      if (!vis || document.hidden) { running = false; return; }
      if (now - lr < FM) { raf = requestAnimationFrame(draw); return; }
      lr = now;
      const dt = Math.min(now - lastF, 50);
      lastF = now;
      ctx.clearRect(0, 0, w, h);
      let any = false;
      const fs = dt / FADE;
      const half = CELL / 2;
      const [cr, cg, cb] = getColor();
      for (let i = 0; i < alphas.length; i++) {
        let a = alphas[i];
        if (a <= 0) continue;
        if (now - touched[i] > HOLD) {
          a = Math.max(0, a - fs);
          alphas[i] = a;
          if (a <= 0) continue;
        }
        any = true;
        const [cx, cy] = cc(i);
        ctx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + a + ')';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - half + 0.5, cy - half + 0.5, CELL - 1, CELL - 1);
      }
      if (any) raf = requestAnimationFrame(draw);
      else running = false;
    }

    function wake() {
      if (running) return;
      running = true;
      lastF = performance.now();
      lr = 0;
      raf = requestAnimationFrame(draw);
    }

    function stop() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      running = false;
    }

    const onMove = (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (x < 0 || y < 0 || x > w || y > h) return;
      en(x, y); wake();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });

    const ro = new ResizeObserver(() => { rebuild(); wake(); });
    ro.observe(cv);
    rebuild();

    const io = new IntersectionObserver(([e]) => {
      vis = e.isIntersecting;
      if (vis) wake(); else stop();
    }, { threshold: 0 });
    io.observe(cv);

    const onVis = () => { if (document.hidden) stop(); else wake(); };
    document.addEventListener('visibilitychange', onVis);
    wake();
  })();

  /* ============================================================
     §11 — SPOTLIGHT CARD
     ============================================================ */
  (function _spotlight() {
    if (_dev.reduced) return;
    const card = document.getElementById('registerCard');
    if (!card) return;
    let raf = 0, tx = 0, ty = 0, cx = 50, cy = 50;
    const onMove = (e) => {
      const r = card.getBoundingClientRect();
      tx = e.clientX - r.left;
      ty = e.clientY - r.top;
      if (!raf) raf = requestAnimationFrame(anim);
    };
    function anim() {
      raf = 0;
      cx += (tx - cx) * 0.3;
      cy += (ty - cy) * 0.3;
      card.style.setProperty('--mouse-x', cx + 'px');
      card.style.setProperty('--mouse-y', cy + 'px');
      if (Math.abs(tx - cx) > 0.5 || Math.abs(ty - cy) > 0.5) {
        raf = requestAnimationFrame(anim);
      }
    }
    card.addEventListener('pointermove', onMove, { passive: true });
  })();

  /* ============================================================
     §12 — INIT SHADER
     ============================================================ */
  _restartShader();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const c = document.getElementById('bgShader');
      if (c && !c.querySelector('canvas') && !c.classList.contains('shader-fallback')) {
        _restartShader();
      }
    }
  });

  /* ============================================================
     §13 — RECAPTCHA
     ============================================================ */
  function _waitRecap() {
    return new Promise((resolve) => {
      if (global.grecaptcha && global.grecaptcha.execute) return resolve();
      let n = 0;
      const t = setInterval(() => {
        n++;
        if (global.grecaptcha && global.grecaptcha.execute) {
          clearInterval(t); resolve();
        } else if (n >= 50) {
          clearInterval(t); resolve();
        }
      }, 100);
    });
  }

  /* ============================================================
     §14 — REGISTER FORM
     ============================================================ */
  const form = document.getElementById('registerForm');
  if (!form) return;

  const el = (id) => document.getElementById(id);

  const alertEl = el('alert');
  const alertText = el('alert-text');
  const submitBtn = el('submitBtn');
  const btnText = el('btnText');
  const btnIcon = el('btnIcon');

  const userIn = el('username');
  const nameIn = el('name');
  const passIn = el('password');
  const pass2In = el('password2');
  const agreeIn = el('agree');

  const hintUser = el('hint-username');
  const hintPass = el('hint-password');
  const hintPass2 = el('hint-password2');
  const statusUser = el('status-username');

  const grpName = el('group-name');
  const grpPass = el('group-password');
  const grpPass2 = el('group-password2');
  const grpTerms = el('group-terms');

  const dots = document.querySelectorAll('.step-dot');
  const lines = document.querySelectorAll('.step-line');

  /* ---------- State ---------- */
  const userState = {
    checking: false,
    available: false,
    last: '',
    ac: null,
  };

  /* ---------- Alert ---------- */
  function showAlert(msg, type) {
    type = type || 'error';
    alertEl.className = 'alert show ' + type;
    alertText.textContent = msg;
    const ic = el('alertIcon');
    if (ic) {
      if (type === 'success') {
        ic.innerHTML = '<polyline points="20 6 9 17 4 12"/>';
      } else if (type === 'info') {
        ic.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>';
      } else {
        ic.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';
      }
    }
  }
  function hideAlert() { alertEl.classList.remove('show'); }

  /* ---------- Eye toggle ---------- */
  const EYE_OPEN = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const EYE_CLOSED = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';

  function setupEye(btnId, iconId, input) {
    const b = el(btnId), ic = el(iconId);
    if (!b || !ic || !input) return;
    let v = false;
    b.addEventListener('click', () => {
      v = !v;
      input.type = v ? 'text' : 'password';
      ic.innerHTML = v ? EYE_CLOSED : EYE_OPEN;
    });
  }
  setupEye('togglePassword', 'eyeIcon', passIn);
  setupEye('togglePassword2', 'eyeIcon2', pass2In);

  /* ---------- Validators ---------- */
  function validateUserFormat() {
    const v = userIn.value.trim();
    if (!v) {
      userIn.classList.remove('valid', 'invalid');
      hintUser.className = 'form-hint';
      hintUser.textContent = 'Huruf, angka, underscore. 3-20 karakter.';
      return false;
    }
    if (!_cfg.userRe.test(v)) {
      userIn.classList.add('invalid');
      userIn.classList.remove('valid');
      hintUser.className = 'form-hint error';
      hintUser.textContent = 'Username hanya boleh huruf, angka, underscore (3-20 karakter).';
      return false;
    }
    return true;
  }

  function setUserStatus(state, msg) {
    statusUser.className = 'input-status';
    if (state === 'loading') {
      statusUser.innerHTML = '<div class="loading-spinner-sm"></div>';
      statusUser.classList.add('show');
      hintUser.className = 'form-hint';
      hintUser.textContent = 'Mengecek ketersediaan username...';
      userIn.classList.remove('valid', 'invalid');
    } else if (state === 'success') {
      statusUser.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
      statusUser.classList.add('show', 'success');
      hintUser.className = 'form-hint success';
      hintUser.textContent = msg || '✓ Username tersedia';
      userIn.classList.add('valid');
      userIn.classList.remove('invalid');
    } else if (state === 'error') {
      statusUser.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      statusUser.classList.add('show', 'error');
      hintUser.className = 'form-hint error';
      hintUser.textContent = msg || '✕ Username tidak tersedia';
      userIn.classList.add('invalid');
      userIn.classList.remove('valid');
    } else {
      statusUser.innerHTML = '';
      statusUser.classList.remove('show', 'success', 'error');
    }
  }

  /* ---------- Check username (cached + deduped) ---------- */
  async function checkUser(name) {
    if (userState.ac) userState.ac.abort();
    const ac = new AbortController();
    userState.ac = ac;
    userState.checking = true;
    userState.available = false;
    userState.last = name;
    setUserStatus('loading');

    try {
      // Cache key: username
      const res = await _api.fetchCached(_cfg.ep.check, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name }),
        signal: ac.signal,
      }, { key: 'chk:' + name });

      if (userState.last !== name) return;
      userState.checking = false;

      const data = await res.json();
      if (!res.ok) {
        setUserStatus('error', data.error || 'Gagal cek username');
        return;
      }
      if (data.available) {
        userState.available = true;
        setUserStatus('success', '✓ Username tersedia');
        revealNext();
      } else {
        userState.available = false;
        setUserStatus('error', '✕ Username sudah dipakai. Coba yang lain.');
      }
      checkReady();
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (userState.last !== name) return;
      userState.checking = false;
      setUserStatus('error', 'Gagal cek username. Coba lagi.');
    }
  }

  let userDebounce = null;
  function scheduleCheck(name) {
    clearTimeout(userDebounce);
    userDebounce = setTimeout(() => checkUser(name), 400);
  }

  /* ---------- Password validators ---------- */
  function validatePass() {
    const v = passIn.value;
    if (!v) {
      passIn.classList.remove('valid', 'invalid');
      hintPass.className = 'form-hint';
      hintPass.textContent = 'Minimal 6 karakter.';
      return false;
    }
    if (v.length < _cfg.minPass) {
      passIn.classList.add('invalid');
      passIn.classList.remove('valid');
      hintPass.className = 'form-hint error';
      hintPass.textContent = 'Password minimal 6 karakter.';
      return false;
    }
    passIn.classList.add('valid');
    passIn.classList.remove('invalid');
    hintPass.className = 'form-hint success';
    hintPass.textContent = '✓ Password cukup kuat';
    return true;
  }

  function validatePass2() {
    const v = pass2In.value;
    if (!v) {
      pass2In.classList.remove('valid', 'invalid');
      hintPass2.className = 'form-hint';
      hintPass2.textContent = 'Ulangi password yang sama.';
      return false;
    }
    if (v !== passIn.value) {
      pass2In.classList.add('invalid');
      pass2In.classList.remove('valid');
      hintPass2.className = 'form-hint error';
      hintPass2.textContent = 'Password tidak cocok.';
      return false;
    }
    pass2In.classList.add('valid');
    pass2In.classList.remove('invalid');
    hintPass2.className = 'form-hint success';
    hintPass2.textContent = '✓ Password cocok';
    return true;
  }

  /* ---------- Reveal next ---------- */
  function revealNext() {
    if (validateUserFormat() && userState.available && !grpName.classList.contains('visible')) {
      grpName.classList.add('visible');
      updateSteps(2);
      return;
    }
    if (grpName.classList.contains('visible') && !grpPass.classList.contains('visible') && userState.available) {
      grpPass.classList.add('visible');
      updateSteps(3);
      return;
    }
    if (grpPass.classList.contains('visible') && !grpPass2.classList.contains('visible') && validatePass()) {
      grpPass2.classList.add('visible');
      updateSteps(4);
      return;
    }
    if (grpPass2.classList.contains('visible') && !grpTerms.classList.contains('visible') && validatePass2()) {
      grpTerms.classList.add('visible');
      updateSteps(5);
    }
    checkReady();
  }

  function checkReady() {
    const ok =
      validateUserFormat() &&
      userState.available &&
      validatePass() &&
      validatePass2() &&
      agreeIn.checked;
    submitBtn.disabled = !ok;
  }

  function updateSteps(active) {
    dots.forEach((d) => {
      const s = Number(d.dataset.step);
      d.classList.toggle('active', s === active);
      d.classList.toggle('done', s < active);
      d.textContent = s < active ? '✓' : String(s);
    });
    lines.forEach((l) => {
      const lv = Number(l.dataset.line);
      l.classList.toggle('done', lv < active);
    });
  }

  /* ---------- Input events ---------- */
  userIn.addEventListener('input', () => {
    userState.available = false;
    if (!validateUserFormat()) {
      setUserStatus('idle');
      checkReady();
      return;
    }
    scheduleCheck(userIn.value.trim());
    checkReady();
  });

  userIn.addEventListener('blur', () => {
    const v = userIn.value.trim();
    if (validateUserFormat()) {
      if (userState.last !== v || !userState.available) {
        clearTimeout(userDebounce);
        checkUser(v);
      }
    }
  });

  nameIn.addEventListener('blur', () => { if (grpName.classList.contains('visible')) revealNext(); });
  nameIn.addEventListener('input', () => { if (grpName.classList.contains('visible')) revealNext(); });

  passIn.addEventListener('input', () => {
    validatePass();
    if (validatePass()) revealNext();
    if (pass2In.value) validatePass2();
    checkReady();
  });
  passIn.addEventListener('blur', () => { if (validatePass()) revealNext(); });

  pass2In.addEventListener('input', () => {
    validatePass2();
    if (validatePass2()) revealNext();
    checkReady();
  });
  pass2In.addEventListener('blur', () => { if (validatePass2()) revealNext(); });

  agreeIn.addEventListener('change', () => {
    checkReady();
    if (agreeIn.checked && validateUserFormat() && userState.available && validatePass() && validatePass2()) {
      updateSteps(5);
    }
  });

  /* ---------- Submit ---------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert();

    if (!validateUserFormat()) { showAlert('Username tidak valid', 'error'); return; }
    if (!userState.available) { showAlert('Username belum tersedia atau belum dicek', 'error'); return; }
    if (!validatePass()) { showAlert('Password minimal 6 karakter', 'error'); return; }
    if (!validatePass2()) { showAlert('Konfirmasi password tidak cocok', 'error'); return; }
    if (!agreeIn.checked) { showAlert('Kamu harus menyetujui Syarat & Ketentuan', 'error'); return; }

    const username = userIn.value.trim();
    const name = nameIn.value.trim();
    const password = passIn.value;

    submitBtn.disabled = true;
    btnText.textContent = 'Memproses...';
    const origIcon = btnIcon ? btnIcon.outerHTML : '';
    if (btnIcon && btnIcon.parentNode) {
      btnIcon.outerHTML = '<span class="spinner" id="btnIcon"></span>';
    }

    try {
      await _waitRecap();
      if (!global.grecaptcha || !global.grecaptcha.execute) {
        throw new Error('Verifikasi keamanan gagal dimuat. Refresh halaman.');
      }

      const token = await new Promise((resolve, reject) => {
        global.grecaptcha.ready(() => {
          global.grecaptcha.execute(_cfg.rk, { action: 'register' })
            .then(resolve)
            .catch(reject);
        });
        setTimeout(() => reject(new Error('Timeout verifikasi keamanan')), 10000);
      });

      const res = await fetch(_cfg.ep.reg, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          name: name || undefined,
          recaptcha_token: token,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registrasi gagal');

      // Invalidate cache username ini (biar gak available lagi)
      _api.invalidate('chk:' + username);

      updateSteps(6);
      showAlert('Registrasi berhasil! Mengalihkan ke login...', 'success');

      setTimeout(() => { location.replace('/login'); }, 1200);
    } catch (err) {
      showAlert(err && err.message ? err.message : 'Terjadi kesalahan', 'error');
      submitBtn.disabled = false;
      btnText.textContent = 'Daftar';
      const old = el('btnIcon');
      if (old && origIcon) old.outerHTML = origIcon;
      if (err.message && err.message.toLowerCase().includes('username')) {
        userState.available = false;
        setUserStatus('error', '✕ ' + err.message);
      }
    }
  });

  checkReady();

  /* ---------- Prefetch (warm cache) ---------- */
  _api.prefetch([]);
})(window);
