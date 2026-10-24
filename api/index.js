const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();

app.disable('x-powered-by');
app.set('etag', false);
app.set('trust proxy', 1);

// security headers
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://www.google.com https://www.gstatic.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https://www.google.com https://accounts.google.com https://cloudflareworkerdeploydidashcloudflarecomexportdef.rahayucahyapurwa.workers.dev https://api.qrserver.com https://api.telegram.org",
        "frame-src https://www.google.com https://accounts.google.com",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        "upgrade-insecure-requests",
    ].join('; '));
    next();
});

// icon proxy — cache 7 hari, retry 3x
const ICON_CDN_BASE = 'https://assets.cindigital.id/apps';
const ICON_CACHE = new Map();
const ICON_TTL = 7 * 24 * 60 * 60 * 1000;

async function fetchIconWithRetry(url, retries = 3) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'AsyrofOTP/1.0',
                    'Accept': 'image/png,image/*;q=0.8,*/*;q=0.5',
                },
            });
            if (res.status >= 500 && i < retries - 1) {
                await new Promise(r => setTimeout(r, 800 * (i + 1)));
                continue;
            }
            return res;
        } catch (err) {
            lastErr = err;
            if (i < retries - 1) {
                await new Promise(r => setTimeout(r, 800 * (i + 1)));
                continue;
            }
            throw err;
        }
    }
    throw lastErr || new Error('Icon fetch failed');
}

app.get('/api/icon/:code', async (req, res) => {
    const raw = String(req.params.code || '').trim().toLowerCase();
    const code = raw.replace(/\.png$/, '').replace(/[^a-z0-9_-]/g, '');

    if (!code || code.length > 64) {
        return res.status(400).json({ error: 'Invalid icon code' });
    }

    const cached = ICON_CACHE.get(code);
    if (cached && (Date.now() - cached.ts) < ICON_TTL) {
        res.set('Content-Type', cached.mime);
        res.set('Cache-Control', 'public, max-age=604800, immutable');
        return res.send(cached.buffer);
    }

    try {
        const upstream = await fetchIconWithRetry(`${ICON_CDN_BASE}/${code}.png`, 3);
        if (!upstream.ok) {
            if (upstream.status === 404) return res.status(404).json({ error: 'Icon not found', code });
            return res.status(upstream.status).json({ error: 'Upstream error', code });
        }
        const buffer = Buffer.from(await upstream.arrayBuffer());
        if (!buffer || buffer.length === 0) return res.status(502).json({ error: 'Empty icon response', code });
        const mime = upstream.headers.get('content-type') || 'image/png';
        ICON_CACHE.set(code, { buffer, mime, ts: Date.now() });
        res.set('Content-Type', mime);
        res.set('Cache-Control', 'public, max-age=604800, immutable');
        res.send(buffer);
    } catch (err) {
        return res.status(502).json({ error: 'Failed to fetch icon', code });
    }
});

// cors whitelist
const ALLOWED_ORIGINS = [
    'https://asyrofotp.vercel.app',
    'https://asyrofotp.com',
    'https://www.asyrofotp.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
];

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
        res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-depo1-signature, x-server1-signature, x-server2-signature, x-webhook-signature, x-cron-secret, x-encrypt, x-refresh-token, x-device-id');
    res.header('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// body parser. simpan rawBody buat verify webhook signature
app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf.toString('utf8'); },
    limit: '512kb'
}));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body tidak valid' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body terlalu besar' });
    next(err);
});

// sanitizer log biar password/token gak muncul di console
function safeLogBody(body) {
    if (!body || typeof body !== 'object') return body;
    const safe = { ...body };
    const SENSITIVE = [
        'password', 'password_hash', 'current_password', 'new_password',
        'token', 'access_token', 'refresh_token', 'recaptcha_token',
        'g-recaptcha-response', 'secret', 'jti', 'api_key', 'apikey',
        'authorization', 'x-refresh-token', 'qris_string'
    ];
    for (const key of Object.keys(safe)) {
        if (SENSITIVE.includes(key.toLowerCase())) safe[key] = '[REDACTED]';
    }
    return safe;
}

// anti-leak. field internal provider gak boleh keluar
function sanitizeOrderForUser(order) {
    if (!order) return order;
    const { order_id, user_id, payment_reference, notified_at, refund_reason, provider_price, ...rest } = order;
    return { ...rest, otp_id: rest.otp_id || null };
}

function sanitizeDepositForUser(dep) {
    if (!dep) return dep;
    const { user_id, payment_reference, notified_at, qris_string, ...rest } = dep;
    return rest;
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    min: 0,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    query_timeout: 15000,
    keepAlive: true,
});

pool.on('error', (err) => { console.error('Unexpected pool error:', err.message); });

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.error('⚠️  JWT_SECRET belum di-set!');
const JWT_SECRET_FINAL = JWT_SECRET || 'asyrofotp-secret-ganti-di-env';
const GOOGLE_CLIENT_ID = process.env.CLIENT_ID_GOOGLE_LOGIN;
if (!GOOGLE_CLIENT_ID) console.error('⚠️  CLIENT_ID_GOOGLE_LOGIN belum di-set!');
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const JWT_EXPIRES = '30m';
const REFRESH_EXPIRES_DAYS = 30;
const SESSION_MAX_AGE_MS = REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000;

const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) console.error('⚠️  CRON_SECRET belum di-set!');

const API_CDN = process.env.API_CDN;
const DIBANANA_BASE = 'https://dibanana.id/api/v1';
const DIBANANA_API_KEY = process.env.API_SERVER_EKONOMI;

// server2 (v1, IDR). nama env tetap biar gak break deploy lama
const PREMIUM_BASE = 'https://api.smscode.gg/v1';
const PREMIUM_API_KEY = process.env.API_SERVER_PREMIUM;
const PREMIUM_WEBHOOK_SECRET = process.env.WEBHOOK_OTP2;
const SMScode_PUBLIC_KEY = 'da303966286507311b5f8260cd7ae743df424b57d4b66eb44fa66e0d036ebdcf';
if (!PREMIUM_API_KEY) console.error('⚠️  API_SERVER_PREMIUM belum di-set!');
if (!PREMIUM_WEBHOOK_SECRET) console.error('⚠️  WEBHOOK_OTP2 belum di-set!');

// cuma 2 server
const SERVER_CONFIG = {
    ekonomi: {
        label: 'Server 1',
        desc: 'Harga terjangkau, khusus Indonesia',
        badge: 'MURAH',
        countries: ['id'],
        provider: 'server1',
    },
    premium: {
        label: 'Server 2',
        desc: 'Semua negara, stok lengkap, real SIM',
        badge: 'PREMIUM',
        countries: null,
        provider: 'server2',
    },
};

const COUNTRY_NAMES = {
    id: 'Indonesia', ru: 'Russia', us: 'United States', my: 'Malaysia',
    vn: 'Vietnam', ph: 'Philippines', th: 'Thailand', sg: 'Singapore',
    in: 'India', cn: 'China', jp: 'Japan', kr: 'South Korea',
    uk: 'United Kingdom', de: 'Germany', fr: 'France', br: 'Brazil', ng: 'Nigeria',
};

// depo1 = payment gateway QRIS. nama env tetap biar gak break deploy lama
const QRISPY_BASE = 'https://cloudflareworkerdeploydidashcloudflarecomexportdef.rahayucahyapurwa.workers.dev';
const QRISPY_WEBHOOK_SECRET = process.env.PW_WEBHOOK;
const WEBHOOK_OTP1_SECRET = process.env.WEBHOOK_OTP1;
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const TELEGRAM_CHANNEL_OTP_ID = process.env.TELEGRAM_CHANNEL_OTP_ID || TELEGRAM_CHANNEL_ID;
const TELEGRAM_CHANNEL_DEPOSIT_ID = process.env.TELEGRAM_CHANNEL_DEPOSIT_ID || TELEGRAM_CHANNEL_ID;
if (!TELEGRAM_BOT_TOKEN) console.error('⚠️  TELEGRAM_BOT_TOKEN belum di-set!');
if (!TELEGRAM_CHANNEL_ID) console.error('⚠️  TELEGRAM_CHANNEL_ID belum di-set!');
const TELEGRAM_API = TELEGRAM_BOT_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}` : null;

const ORDER_EXPIRY_MS = 15 * 60 * 1000;
const REVIVE_GRACE_PERIOD_MS = 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 8000;
const SYNC_INTERVAL_MS = 2 * 60 * 1000;

// profit config
const MARKUP_PERCENT = 0.10;
const DEPOSIT_FEE_MIN = 50;
const DEPOSIT_FEE_MAX = 100;
const DEPOSIT_FEE_PERCENT = 0.005;

function calculateDepositFee(amount) {
    const a = Number(amount) || 0;
    if (a <= 0) return DEPOSIT_FEE_MIN;
    const fee = Math.round(a * DEPOSIT_FEE_PERCENT);
    return Math.max(DEPOSIT_FEE_MIN, Math.min(DEPOSIT_FEE_MAX, fee));
}

// markup 10% pure, dibulatkan ke rupiah. max deviasi 0.5rp dari ideal
function applyMarkup(providerPrice) {
    const p = Number(providerPrice) || 0;
    if (p <= 0) return 0;
    return Math.round(p * (1 + MARKUP_PERCENT));
}

// in-memory cache TTL
const cache = new Map();
function cacheGet(key) {
    const item = cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) { cache.delete(key); return null; }
    return item.value;
}
function cacheSet(key, value, ttlMs) { cache.set(key, { value, expiresAt: Date.now() + ttlMs }); }
function cacheDelPattern(prefix) { for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k); }

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache.entries()) if (now > v.expiresAt) cache.delete(k);
}, 5 * 60 * 1000);

// price lock — persist tanpa TTL, diganti saat /prices dipanggil ulang.
// tujuan: user bayar persis sesuai harga di list, gak ada selisih.
// FIFO 10k entries biar gak numpuk selamanya
const PRICE_LOCK_MAX_SIZE = 10000;
const priceLockCache = new Map();

function setPriceLock(providerId, sellPrice, providerPrice, meta = {}) {
    if (!providerId || !sellPrice) return;
    const key = String(providerId);
    if (priceLockCache.size >= PRICE_LOCK_MAX_SIZE && !priceLockCache.has(key)) {
        const firstKey = priceLockCache.keys().next().value;
        if (firstKey !== undefined) priceLockCache.delete(firstKey);
    }
    priceLockCache.set(key, {
        price_idr: Number(sellPrice),
        provider_price: Number(providerPrice) || 0,
        locked_at: Date.now(),
        server: meta.server || null,
        provider: meta.provider || null,
        service: meta.service || null,
        country: meta.country || null,
        product_id: meta.product_id || null,
        catalog_product_id: meta.catalog_product_id || null,
        operator_id: meta.operator_id || null,
    });
}

function getPriceLock(providerId) {
    if (!providerId) return null;
    return priceLockCache.get(String(providerId)) || null;
}

async function premiumFetchPublic(endpoint, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        const res = await fetch(`${PREMIUM_BASE}${endpoint}`, {
            ...options,
            signal: controller.signal,
            headers: {
                'Authorization': `Bearer ${SMScode_PUBLIC_KEY}`,
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        });
        let data;
        try { data = await res.json(); }
        catch (e) {
            const err = new Error(`Provider error: ${res.status}`);
            err.status = res.status;
            throw err;
        }
        if (!res.ok || data.success === false) {
            const err = new Error(data.error?.message || data.message || 'Provider error');
            err.status = res.status;
            err.code = data.error?.code || data.code;
            err.data = data;
            throw err;
        }
        return data.data;
    } finally { clearTimeout(timeout); }
}

// service name → icon code
function normalizeServiceName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function getServiceCodeMap() {
    const cacheKey = 'service_code_map_ekonomi';
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    try {
        const data = await dibananaFetch('/services?server=ekonomi');
        const services = data.services || [];
        const map = {};
        for (const s of services) {
            const code = String(s.code || '').trim();
            const name = String(s.name || '').trim();
            if (!code) continue;
            const normName = normalizeServiceName(name);
            if (normName) map[normName] = code;
            const normCode = normalizeServiceName(code);
            if (normCode) map[normCode] = code;
        }
        cacheSet(cacheKey, map, 5 * 60 * 1000);
        console.log(`✅ Service code map (server1): ${Object.keys(map).length} entries`);
        return map;
    } catch (err) {
        console.error('Get service code map error:', err.message);
        return {};
    }
}

async function getPremiumServiceCodeMap() {
    const cacheKey = 'service_code_map_premium';
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    try {
        const services = await premiumFetch('/catalog/services');
        const map = {};
        for (const s of (services || [])) {
            const code = String(s.code || '').trim().toLowerCase();
            const name = String(s.name || '').trim();
            if (!code) continue;
            map[normalizeServiceName(name)] = code;
            map[normalizeServiceName(code)] = code;
        }
        cacheSet(cacheKey, map, 30 * 60 * 1000);
        console.log(`✅ Service code map (server2): ${Object.keys(map).length} entries`);
        return map;
    } catch (err) {
        console.error('Premium service code map error:', err.message);
        return {};
    }
}

async function enrichServicesWithCode(services, server) {
    if (!services || services.length === 0) return services;
    if (server === 'ekonomi') {
        return services.map(s => ({ ...s, icon_code: s.code || null }));
    }
    const codeMap = await getPremiumServiceCodeMap();
    return services.map(s => {
        const normName = normalizeServiceName(s.name);
        return { ...s, icon_code: codeMap[normName] || s.code || null };
    });
}

const DEPOSIT_METHODS = [
    { id: 'qrispy', label: 'QRIS Otomatis', desc: 'Bayar pakai QRIS, saldo masuk otomatis', icon: 'depo1', fee: 0 },
];

const DEPOSIT_PRESETS = {
    presets: [
        { amount: 1000, label: 'Rp1.000' },
        { amount: 5000, label: 'Rp5.000' },
        { amount: 10000, label: 'Rp10.000' },
        { amount: 20000, label: 'Rp20.000' },
        { amount: 50000, label: 'Rp50.000' },
        { amount: 100000, label: 'Rp100.000' },
    ],
    min: 1000,
    max: 10000000,
};

const SERVERS_LIST = Object.entries(SERVER_CONFIG).map(([key, config]) => ({
    id: key,
    label: config.label,
    desc: config.desc,
    badge: config.badge,
    countries: config.countries,
    provider: config.provider,
}));

// rate limiter
const rateLimitStore = new Map();

function rateLimit(maxRequests, windowMs, keyFn) {
    return (req, res, next) => {
        const key = (keyFn ? keyFn(req) : req.ip) + ':' + req.path;
        const now = Date.now();
        const record = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };
        if (now > record.resetAt) { record.count = 0; record.resetAt = now + windowMs; }
        record.count++;
        rateLimitStore.set(key, record);
        if (record.count > maxRequests) {
            return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
        }
        next();
    };
}

function userRateLimit(maxRequests, windowMs) {
    return (req, res, next) => {
        if (!req.user || !req.user.id) return next();
        return rateLimit(maxRequests, windowMs, (r) => 'u:' + r.user.id)(req, res, next);
    };
}

setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) if (now > record.resetAt) rateLimitStore.delete(key);
}, 5 * 60 * 1000);

// fetch helper dengan timeout + error normalize
async function qrispyFetch(endpoint, options = {}) {
    const fullUrl = `${QRISPY_BASE}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        const res = await fetch(fullUrl, {
            ...options,
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); }
        catch (e) {
            const err = new Error(`depo1 error ${res.status}: response bukan JSON`);
            err.status = res.status; err.raw = text.substring(0, 500); throw err;
        }
        if (!res.ok || data.status === 'error') {
            const err = new Error(data.message || 'depo1 error');
            err.status = res.status; err.data = data; throw err;
        }
        return data;
    } finally { clearTimeout(timeout); }
}

async function dibananaFetch(endpoint, options = {}) {
    if (!DIBANANA_API_KEY) throw new Error('API_SERVER_EKONOMI belum di-set');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        const res = await fetch(`${DIBANANA_BASE}${endpoint}`, {
            ...options,
            signal: controller.signal,
            headers: {
                'Authorization': `Bearer ${DIBANANA_API_KEY}`,
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        });
        let data;
        try { data = await res.json(); }
        catch (e) { const err = new Error(`Provider error: ${res.status}`); err.status = res.status; throw err; }
        if (!res.ok || data.ok === false) {
            const err = new Error(data.message || data.error || 'Provider error');
            err.status = res.status; err.code = data.error; err.data = data; throw err;
        }
        return data;
    } finally { clearTimeout(timeout); }
}

// server2 fetch. v1 money = integer IDR, gak ada konversi
async function premiumFetch(endpoint, options = {}) {
    if (!PREMIUM_API_KEY) throw new Error('API_SERVER_PREMIUM belum di-set');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        const res = await fetch(`${PREMIUM_BASE}${endpoint}`, {
            ...options,
            signal: controller.signal,
            headers: {
                'Authorization': `Bearer ${PREMIUM_API_KEY}`,
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        });
        let data;
        try { data = await res.json(); }
        catch (e) {
            const err = new Error(`Provider error: ${res.status}`);
            err.status = res.status;
            throw err;
        }
        if (!res.ok || data.success === false) {
            const err = new Error(data.error?.message || data.message || 'Provider error');
            err.status = res.status;
            err.code = data.error?.code || data.code;
            err.data = data;
            throw err;
        }
        return data.data;
    } finally { clearTimeout(timeout); }
}

function premiumMoneyToIdr(money) {
    if (money == null) return 0;
    return Math.round(Number(money) || 0);
}

async function getProviderBalance() {
    try {
        const data = await dibananaFetch('/balance');
        const balance = Number(data.balance) || Number(data.saldo) || Number(data.data?.balance) || 0;
        return { ok: true, balance };
    } catch (err) {
        return { ok: false, error: err.message, balance: 0 };
    }
}

// provider-agnostic wrapper
async function providerOrderStatus(order) {
    if (order.server === 'premium') {
        const raw = await premiumFetch(`/orders/${encodeURIComponent(order.order_id)}`);
        const mapStatus = (s) => {
            switch (String(s || '').toUpperCase()) {
                case 'OTP_RECEIVED': return 'received';
                case 'COMPLETED':    return 'success';
                case 'CANCELED':     return 'cancelled';
                case 'EXPIRED':      return 'expired';
                case 'ACTIVE':       return 'pending';
                default:             return 'pending';
            }
        };
        return {
            status: mapStatus(raw.status),
            otp_code: raw.otp_code || null,
            otp_code_2: null,
            full_sms: raw.otp_message || raw.full_sms || null,
        };
    }
    return await dibananaFetch(`/status?order_id=${encodeURIComponent(order.order_id)}`);
}

async function providerCancelOrder(order) {
    if (order.server === 'premium') {
        return await premiumFetch('/orders/cancel', {
            method: 'POST',
            body: JSON.stringify({ id: Number(order.order_id) }),
        });
    }
    return await dibananaFetch('/cancel', {
        method: 'POST',
        body: JSON.stringify({ order_id: Number(order.order_id) }),
    });
}

async function providerResendOrder(order) {
    if (order.server === 'premium') {
        const raw = await premiumFetch('/orders/resend', {
            method: 'POST',
            body: JSON.stringify({ id: Number(order.order_id) }),
        });
        return { ...raw, status: 'pending' };
    }
    return await dibananaFetch('/resend', {
        method: 'POST',
        body: JSON.stringify({ order_id: Number(order.order_id) }),
    });
}

// telegram notif helpers
function escapeHtmlNotif(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function censorPhoneNotif(phone) {
    if (!phone || phone === 'Pending') return 'Pending';
    let str = String(phone).replace(/^\++/, '+').replace(/\++/g, '+');
    let cc = '', rest = str;

    if (str.startsWith('+')) {
        const m = str.match(/^\+(\d{1,3})/);
        if (m) { cc = '+' + m[1]; rest = str.slice(cc.length); }
    } else if (str.startsWith('0')) { cc = '0'; rest = str.slice(1); }
    else if (str.startsWith('62')) { cc = '62'; rest = str.slice(2); }
    else {
        if (str.length <= 4) return str;
        return '****' + str.slice(-4);
    }

    const d = rest.replace(/\s/g, '');
    if (d.length <= 4) return cc + rest;
    return cc + '*'.repeat(d.length - 4) + d.slice(-4);
}

function toRupiahNotif(n) {
    if (isNaN(n) || n == null) n = 0;
    return 'Rp ' + Number(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatWaktuJakarta() {
    return new Date().toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

async function telegramSendMessage(channelId, text, options = {}) {
    if (!TELEGRAM_BOT_TOKEN || !channelId) {
        throw new Error('Telegram notif belum dikonfigurasi');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: channelId,
                text,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                ...options,
            }),
            signal: controller.signal,
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.description || 'Telegram API error');
        return data.result;
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchUserForOrder(order) {
    if (!order || !order.user_id) return null;
    try {
        const userRes = await pool.query(
            'SELECT username, name, user_code FROM users WHERE id = $1 LIMIT 1',
            [order.user_id]
        );
        return userRes.rows[0] || null;
    } catch (err) {
        console.error('fetchUserForOrder error:', err.message);
        return null;
    }
}

// notif OTP sukses. identifier pakai otp_id
async function notifyOtpSuccess(order, user = null) {
    const channelId = TELEGRAM_CHANNEL_OTP_ID;
    if (!channelId) return { sent: false, reason: 'NO_CHANNEL' };

    if (order.notified_at) {
        return { sent: false, reason: 'ALREADY_NOTIFIED' };
    }

    const displayId = order.otp_id || order.order_id || '-';
    const serverLabel = order.server === 'premium' ? 'Server 2' : 'Server 1';

    const text =
        `<b>🔔 SUCCESSFULLY GET OTP</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        (user ? `<u>• User:</u> <b>${escapeHtmlNotif(user.username || user.name || '-')}</b>\n` : '') +
        (user ? `<u>• User ID:</u> <code>${escapeHtmlNotif(user.user_code || '-')}</code>\n` : '') +
        `<u>• OTP ID:</u> <b>${escapeHtmlNotif(displayId)}</b>\n` +
        `<u>• Server:</u> <b>${escapeHtmlNotif(serverLabel)}</b>\n` +
        `<u>• Service:</u> <b>${escapeHtmlNotif(order.service_name || order.service || '-')} - ${escapeHtmlNotif(order.country_name || order.country || '-')}</b>\n` +
        `<u>• Phone:</u> <b>${escapeHtmlNotif(censorPhoneNotif(order.phone_number))}</b>\n` +
        `<u>• Kode:</u> <b>${escapeHtmlNotif(order.otp_code || '-')}</b>\n` +
        (order.otp_code_2 ? `<u>• Kode 2:</u> <b>${escapeHtmlNotif(order.otp_code_2)}</b>\n` : '') +
        `<u>• Harga:</u> <b>${toRupiahNotif(order.price)}</b>\n` +
        `<u>• Waktu:</u> <code>${formatWaktuJakarta()}</code>`;

    const replyMarkup = {
        inline_keyboard: [
            [{ text: '🛒 Beli Sekarang', url: 'https://asyrofotp.vercel.app' }]
        ]
    };

    try {
        const msg = await telegramSendMessage(channelId, text, { reply_markup: replyMarkup });

        await pool.query(
            `UPDATE orders SET notified_at = NOW() WHERE id = $1 AND notified_at IS NULL`,
            [order.id]
        ).catch(err => console.error('Update notified_at (otp) error:', err.message));

        console.log(`✅ Notif OTP [${displayId}] sent, msg_id=${msg.message_id}`);
        return { sent: true, message_id: msg.message_id };
    } catch (err) {
        console.error(`❌ Notif OTP [${displayId}] error:`, err.message);
        return { sent: false, reason: 'SEND_ERROR', error: err.message };
    }
}

// notif deposit sukses. identifier pakai reference_id
async function notifyDepositSuccess(deposit, saldoMasuk, totalBayar, fee, user, unique_id) {
    const channelId = TELEGRAM_CHANNEL_DEPOSIT_ID;
    if (!channelId) return { sent: false, reason: 'NO_CHANNEL' };

    if (deposit.notified_at) {
        return { sent: false, reason: 'ALREADY_NOTIFIED' };
    }

    const text =
        `<b>💰 SUCCESSFUL DEPOSIT</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<u>• User:</u> <b>${escapeHtmlNotif(user?.username || user?.name || '-')}</b>\n` +
        `<u>• User ID:</u> <code>${escapeHtmlNotif(user?.user_code || '-')}</code>\n` +
        `<u>• Deposit ID:</u> <code>${escapeHtmlNotif(deposit.reference_id)}</code>\n` +
        `<u>• Method:</u> <b>QRIS Otomatis</b>\n` +
        `<u>• Nominal:</u> <b>${toRupiahNotif(saldoMasuk)}</b>\n` +
        `<u>• Waktu:</u> <code>${formatWaktuJakarta()}</code>`;

    const replyMarkup = {
        inline_keyboard: [
            [{ text: '🛒 Beli Sekarang', url: 'https://asyrofotp.vercel.app' }]
        ]
    };

    try {
        const msg = await telegramSendMessage(channelId, text, { reply_markup: replyMarkup });

        await pool.query(
            `UPDATE deposits SET notified_at = NOW() WHERE id = $1 AND notified_at IS NULL`,
            [deposit.id]
        ).catch(err => console.error('Update notified_at (deposit) error:', err.message));

        console.log(`✅ Notif deposit [${deposit.reference_id}] sent, msg_id=${msg.message_id}`);
        return { sent: true, message_id: msg.message_id };
    } catch (err) {
        console.error(`❌ Notif deposit [${deposit.reference_id}] error:`, err.message);
        return { sent: false, reason: 'SEND_ERROR', error: err.message };
    }
}

// general helpers
function isValidUsername(username) {
    return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

function signToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role, jti: crypto.randomBytes(16).toString('hex') },
        JWT_SECRET_FINAL,
        { expiresIn: JWT_EXPIRES }
    );
}

// generateUniqueCode() DIHAPUS — eksklusif QRIS DANA (MoonRed)

async function generateUniqueReferenceId(maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        const timestamp = Date.now();
        const random1 = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        const random2 = crypto.randomBytes(2).toString('hex').toUpperCase();
        const referenceId = `DEP${timestamp}${random1}${random2}`;

        try {
            const check = await pool.query(
                'SELECT 1 FROM deposits WHERE reference_id = $1 LIMIT 1',
                [referenceId]
            );
            if (check.rows.length === 0) return referenceId;
        } catch (err) {}
    }
    return `DEP${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function generateOtpReferenceId(maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        const random = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
        const otpId = `OTP${random}`;

        try {
            const check = await pool.query(
                'SELECT 1 FROM orders WHERE otp_id = $1 LIMIT 1',
                [otpId]
            );
            if (check.rows.length === 0) return otpId;
        } catch (err) {}
    }
    return `OTP${Date.now().toString().slice(-8)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

async function logStatusChange({ entityType, entityId, userId = null, oldStatus = null, newStatus, reason = null, metadata = null }, client = null) {
    if (!newStatus) return;
    if (oldStatus === newStatus) return;

    const executor = client || pool;
    try {
        await executor.query(
            `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [entityType, String(entityId), userId, oldStatus, newStatus, reason, metadata ? JSON.stringify(metadata) : null]
        );
    } catch (err) {
        console.error('Log error:', err.message);
    }
}

// recaptcha v3 helper
async function verifyRecaptcha(token, { minScore = 0.5, expectedAction = null } = {}) {
    if (!token) {
        return { success: false, error: 'Token reCAPTCHA kosong', code: 'MISSING_TOKEN' };
    }
    if (!RECAPTCHA_SECRET) {
        console.error('⚠️ RECAPTCHA_SECRET_KEY belum di-set');
        return { success: false, error: 'Verifikasi belum dikonfigurasi', code: 'NO_SECRET' };
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                secret: RECAPTCHA_SECRET,
                response: String(token),
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
            return { success: false, error: 'Gagal menghubungi reCAPTCHA', code: 'HTTP_ERROR' };
        }

        const data = await res.json();

        if (!data.success) {
            console.warn('reCAPTCHA rejected:', data['error-codes'] || 'unknown');
            return {
                success: false,
                error: 'Verifikasi keamanan gagal. Coba lagi.',
                code: 'VERIFY_FAILED',
                details: data['error-codes'] || [],
            };
        }

        if (typeof data.score === 'number' && data.score < minScore) {
            console.warn(`reCAPTCHA low score: ${data.score} (min ${minScore})`);
            return {
                success: false,
                error: 'Aktivitas mencurigakan terdeteksi. Coba lagi nanti.',
                code: 'LOW_SCORE',
                score: data.score,
            };
        }

        if (expectedAction && data.action !== expectedAction) {
            return {
                success: false,
                error: 'Aksi tidak valid.',
                code: 'ACTION_MISMATCH',
                action: data.action,
            };
        }

        return {
            success: true,
            score: data.score,
            action: data.action,
            hostname: data.hostname,
        };
    } catch (err) {
        if (err.name === 'AbortError') {
            return { success: false, error: 'Timeout verifikasi keamanan', code: 'TIMEOUT' };
        }
        console.error('verifyRecaptcha error:', err.message);
        return { success: false, error: 'Gagal verifikasi keamanan', code: 'ERROR' };
    }
}

// token blacklist
async function isTokenBlacklisted(jti) {
    if (!jti) return false;
    try {
        const result = await pool.query(
            'SELECT 1 FROM token_blacklist WHERE jti = $1 AND expires_at > NOW() LIMIT 1',
            [jti]
        );
        return result.rows.length > 0;
    } catch (err) {
        return false;
    }
}

async function blacklistToken(jti, expiresAt) {
    if (!jti) return;
    try {
        await pool.query(
            `INSERT INTO token_blacklist (jti, expires_at) VALUES ($1, $2) ON CONFLICT (jti) DO NOTHING`,
            [jti, expiresAt]
        );
    } catch (err) {
        console.error('Blacklist error:', err.message);
    }
}

// session helpers
function hashRefreshToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function createSession({ userId, device, userAgent, ipAddress }) {
    const rawRefresh = crypto.randomBytes(48).toString('hex');
    const refreshHash = hashRefreshToken(rawRefresh);
    const jti = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

    await pool.query(
        `INSERT INTO sessions (user_id, refresh_token_hash, jti, device, user_agent, ip_address, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, refreshHash, jti, device || null, userAgent || null, ipAddress || null, expiresAt]
    );

    return { rawRefresh, jti, expiresAt };
}

async function findActiveSessionByRefresh(rawRefresh) {
    const refreshHash = hashRefreshToken(rawRefresh);
    const result = await pool.query(
        `SELECT * FROM sessions WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1`,
        [refreshHash]
    );
    return result.rows[0] || null;
}

async function revokeSession(sessionId) {
    await pool.query(`UPDATE sessions SET revoked_at = NOW() WHERE id = $1`, [sessionId]);
}

async function revokeAllUserSessions(userId, exceptSessionId = null) {
    if (exceptSessionId) {
        await pool.query(`UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND id <> $2`, [userId, exceptSessionId]);
    } else {
        await pool.query(`UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1`, [userId]);
    }
}

// schema definitions
const SCHEMA = {
    tables: [
        {
            name: 'users',
            create: `CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT,
                balance BIGINT DEFAULT 0,
                role TEXT DEFAULT 'user',
                status TEXT DEFAULT 'active',
                user_code TEXT,
                last_login_at TIMESTAMPTZ,
                last_login_ip TEXT,
                last_device TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            columns: [
                { name: 'google_id', def: 'TEXT' },
                { name: 'email', def: 'TEXT' },
                { name: 'user_code', def: 'TEXT' },
                { name: 'role', def: "TEXT DEFAULT 'user'" },
                { name: 'status', def: "TEXT DEFAULT 'active'" },
                { name: 'name', def: 'TEXT' },
                { name: 'balance', def: 'BIGINT DEFAULT 0' },
                { name: 'last_login_at', def: 'TIMESTAMPTZ' },
                { name: 'last_login_ip', def: 'TEXT' },
                { name: 'last_device', def: 'TEXT' },
                { name: 'created_at', def: 'TIMESTAMPTZ DEFAULT NOW()' },
                { name: 'updated_at', def: 'TIMESTAMPTZ DEFAULT NOW()' },
            ],
        },
        {
            name: 'sessions',
            create: `CREATE TABLE IF NOT EXISTS sessions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                refresh_token_hash TEXT UNIQUE NOT NULL,
                jti TEXT NOT NULL,
                device TEXT,
                user_agent TEXT,
                ip_address TEXT,
                expires_at TIMESTAMPTZ NOT NULL,
                revoked_at TIMESTAMPTZ,
                last_used_at TIMESTAMPTZ DEFAULT NOW(),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            columns: [
                { name: 'device', def: 'TEXT' },
                { name: 'user_agent', def: 'TEXT' },
                { name: 'ip_address', def: 'TEXT' },
                { name: 'revoked_at', def: 'TIMESTAMPTZ' },
                { name: 'last_used_at', def: 'TIMESTAMPTZ DEFAULT NOW()' },
            ],
        },
        {
            name: 'orders',
            create: `CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                order_id TEXT UNIQUE,
                otp_id TEXT UNIQUE,
                server TEXT,
                service TEXT,
                service_name TEXT,
                icon_code TEXT,
                country TEXT,
                country_name TEXT,
                country_flag TEXT,
                operator TEXT,
                phone_number TEXT,
                otp_code TEXT,
                otp_code_2 TEXT,
                full_sms TEXT,
                price BIGINT NOT NULL DEFAULT 0,
                provider_price BIGINT DEFAULT 0,
                status TEXT DEFAULT 'pending',
                expires_in INTEGER DEFAULT 0,
                resend_count INTEGER DEFAULT 0,
                refunded_at BIGINT,
                refunded_amount BIGINT,
                refund_reason TEXT,
                revived_at TIMESTAMPTZ,
                revived_count INTEGER DEFAULT 0,
                notified_at TIMESTAMPTZ,
                last_synced_at TIMESTAMPTZ,
                sync_attempt_count INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                received_at TIMESTAMPTZ,
                last_checked_at TIMESTAMPTZ,
                expired_at TIMESTAMPTZ
            );`,
            columns: [
                { name: 'otp_id', def: 'TEXT' },
                { name: 'server', def: 'TEXT' },
                { name: 'service', def: 'TEXT' },
                { name: 'service_name', def: 'TEXT' },
                { name: 'icon_code', def: 'TEXT' },
                { name: 'country', def: 'TEXT' },
                { name: 'country_name', def: 'TEXT' },
                { name: 'country_flag', def: 'TEXT' },
                { name: 'operator', def: 'TEXT' },
                { name: 'phone_number', def: 'TEXT' },
                { name: 'otp_code', def: 'TEXT' },
                { name: 'otp_code_2', def: 'TEXT' },
                { name: 'full_sms', def: 'TEXT' },
                { name: 'price', def: 'BIGINT DEFAULT 0' },
                { name: 'provider_price', def: 'BIGINT DEFAULT 0' },
                { name: 'status', def: "TEXT DEFAULT 'pending'" },
                { name: 'expires_in', def: 'INTEGER DEFAULT 0' },
                { name: 'resend_count', def: 'INTEGER DEFAULT 0' },
                { name: 'refunded_at', def: 'BIGINT' },
                { name: 'refunded_amount', def: 'BIGINT' },
                { name: 'refund_reason', def: 'TEXT' },
                { name: 'revived_at', def: 'TIMESTAMPTZ' },
                { name: 'revived_count', def: 'INTEGER DEFAULT 0' },
                { name: 'notified_at', def: 'TIMESTAMPTZ' },
                { name: 'last_synced_at', def: 'TIMESTAMPTZ' },
                { name: 'sync_attempt_count', def: 'INTEGER DEFAULT 0' },
                { name: 'created_at', def: 'TIMESTAMPTZ DEFAULT NOW()' },
                { name: 'updated_at', def: 'TIMESTAMPTZ DEFAULT NOW()' },
                { name: 'received_at', def: 'TIMESTAMPTZ' },
                { name: 'last_checked_at', def: 'TIMESTAMPTZ' },
                { name: 'expired_at', def: 'TIMESTAMPTZ' },
            ],
        },
        {
            name: 'transactions',
            create: `CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                order_id TEXT,
                service_name TEXT,
                country TEXT,
                country_flag TEXT,
                phone_number TEXT,
                otp_code TEXT,
                status TEXT DEFAULT 'pending',
                price BIGINT NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            columns: [
                { name: 'order_id', def: 'TEXT' },
                { name: 'service_name', def: 'TEXT' },
                { name: 'country', def: 'TEXT' },
                { name: 'country_flag', def: 'TEXT' },
                { name: 'phone_number', def: 'TEXT' },
                { name: 'otp_code', def: 'TEXT' },
                { name: 'status', def: "TEXT DEFAULT 'pending'" },
                { name: 'price', def: 'BIGINT DEFAULT 0' },
                { name: 'created_at', def: 'TIMESTAMPTZ DEFAULT NOW()' },
                { name: 'updated_at', def: 'TIMESTAMPTZ DEFAULT NOW()' },
            ],
        },
                {
            name: 'rate_limits',
            create: `CREATE TABLE IF NOT EXISTS rate_limits (
                id SERIAL PRIMARY KEY,
                ip_address TEXT,
                device_id TEXT,
                action TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            columns: []
        },
                {
            name: 'password_resets',
            create: `CREATE TABLE IF NOT EXISTS password_resets (
                id SERIAL PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                token TEXT UNIQUE NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                used_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            columns: []
        },
        {
            name: 'deposits',
            // unique_code & qris_string dihapus — eksklusif QRIS DANA
            create: `CREATE TABLE IF NOT EXISTS deposits (
                id SERIAL PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                reference_id TEXT UNIQUE,
                method TEXT NOT NULL,
                amount BIGINT NOT NULL,
                total_amount BIGINT,
                fee BIGINT DEFAULT 0,
                status TEXT DEFAULT 'pending',
                qris_id TEXT,
                qris_url TEXT,
                payment_reference TEXT,
                paid_at TIMESTAMPTZ,
                expires_at TIMESTAMPTZ,
                notified_at TIMESTAMPTZ,
                last_synced_at TIMESTAMPTZ,
                sync_attempt_count INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            columns: [
                { name: 'total_amount', def: 'BIGINT' },
                { name: 'fee', def: 'BIGINT DEFAULT 0' },
                { name: 'qris_id', def: 'TEXT' },
                { name: 'qris_url', def: 'TEXT' },
                { name: 'payment_reference', def: 'TEXT' },
                { name: 'paid_at', def: 'TIMESTAMPTZ' },
                { name: 'expires_at', def: 'TIMESTAMPTZ' },
                { name: 'notified_at', def: 'TIMESTAMPTZ' },
                { name: 'last_synced_at', def: 'TIMESTAMPTZ' },
                { name: 'sync_attempt_count', def: 'INTEGER DEFAULT 0' },
            ],
        },
        {
            name: 'status_logs',
            create: `CREATE TABLE IF NOT EXISTS status_logs (
                id SERIAL PRIMARY KEY,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                old_status TEXT,
                new_status TEXT NOT NULL,
                reason TEXT,
                metadata JSONB,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            columns: [],
        },
        {
            name: 'token_blacklist',
            create: `CREATE TABLE IF NOT EXISTS token_blacklist (
                jti TEXT PRIMARY KEY,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            columns: [],
        },
        {
            name: 'webhook_events',
            create: `CREATE TABLE IF NOT EXISTS webhook_events (
                id SERIAL PRIMARY KEY,
                source TEXT NOT NULL,
                event_type TEXT,
                signature_valid BOOLEAN DEFAULT FALSE,
                ip_address TEXT,
                user_agent TEXT,
                payload JSONB,
                raw_body TEXT,
                processed BOOLEAN DEFAULT FALSE,
                process_note TEXT,
                related_entity_type TEXT,
                related_entity_id TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            columns: [
                { name: 'event_type', def: 'TEXT' },
                { name: 'signature_valid', def: 'BOOLEAN DEFAULT FALSE' },
                { name: 'ip_address', def: 'TEXT' },
                { name: 'user_agent', def: 'TEXT' },
                { name: 'payload', def: 'JSONB' },
                { name: 'raw_body', def: 'TEXT' },
                { name: 'processed', def: 'BOOLEAN DEFAULT FALSE' },
                { name: 'process_note', def: 'TEXT' },
                { name: 'related_entity_type', def: 'TEXT' },
                { name: 'related_entity_id', def: 'TEXT' },
            ],
        },
    ],
    indexes: [
        'CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC)',
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL',
        'CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id)',
        'CREATE INDEX IF NOT EXISTS idx_orders_otp_id ON orders(otp_id)',
        'CREATE INDEX IF NOT EXISTS idx_orders_status_expiry ON orders(status, expired_at)',
        'CREATE INDEX IF NOT EXISTS idx_orders_refunded ON orders(user_id, refunded_at)',
        'CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_orders_notified ON orders(notified_at, status)',
        'CREATE INDEX IF NOT EXISTS idx_orders_pending_sync ON orders(status, last_synced_at)',
        'CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_deposits_ref ON deposits(reference_id)',
        'CREATE INDEX IF NOT EXISTS idx_deposits_qris ON deposits(qris_id)',
        'CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status, expires_at)',
        'CREATE INDEX IF NOT EXISTS idx_deposits_notified ON deposits(notified_at, status)',
        'CREATE INDEX IF NOT EXISTS idx_deposits_pending_sync ON deposits(status, last_synced_at)',
        'CREATE INDEX IF NOT EXISTS idx_status_logs_entity ON status_logs(entity_type, entity_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_status_logs_user ON status_logs(user_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_status_logs_created ON status_logs(created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_status_logs_admin ON status_logs(entity_type, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at)',
        'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_sessions_refresh ON sessions(refresh_token_hash)',
        'CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(user_id, revoked_at, expires_at)',
        'CREATE INDEX IF NOT EXISTS idx_webhook_events_source ON webhook_events(source, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_webhook_events_entity ON webhook_events(related_entity_type, related_entity_id)',
    ],
};

let schemaEnsured = false;
let schemaPromise = null;

async function ensureSchema() {
    if (schemaEnsured) return;
    if (schemaPromise) return schemaPromise;

    schemaPromise = (async () => {
        const start = Date.now();
        try {
            console.log('🔧 Ensuring schema...');

            await Promise.all(SCHEMA.tables.map(t => pool.query(t.create).catch(err => {
                if (!err.message.includes('already exists')) console.error(`Create ${t.name}:`, err.message);
            })));

            const colPromises = [];
            for (const table of SCHEMA.tables) {
                if (!table.columns || table.columns.length === 0) continue;
                for (const col of table.columns) {
                    colPromises.push(
                        pool.query(`ALTER TABLE ${table.name} ADD COLUMN IF NOT EXISTS ${col.name} ${col.def}`)
                            .catch(err => {
                                if (!err.message.includes('already exists')) {
                                    console.error(`Add col ${table.name}.${col.name}:`, err.message);
                                }
                            })
                    );
                }
            }
            await Promise.all(colPromises);

            await Promise.all(SCHEMA.indexes.map(idxSql =>
                pool.query(idxSql).catch(err => {
                    if (!err.message.includes('already exists')) {
                        console.error('Index error:', err.message);
                    }
                })
            ));

            await pool.query(`
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_otp_id_key') THEN
                        BEGIN
                            ALTER TABLE orders ADD CONSTRAINT orders_otp_id_key UNIQUE (otp_id);
                        EXCEPTION WHEN others THEN NULL;
                        END;
                    END IF;
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_user_code_key') THEN
                        BEGIN
                            ALTER TABLE users ADD CONSTRAINT users_user_code_key UNIQUE (user_code);
                        EXCEPTION WHEN others THEN NULL;
                        END;
                    END IF;
                END $$;
            `);

            await pool.query(`
                CREATE OR REPLACE FUNCTION generate_user_code()
                RETURNS TEXT AS $$
                DECLARE new_code TEXT; exists_check BOOLEAN;
                BEGIN
                    LOOP
                        new_code := 'SRF' || LPAD(FLOOR(RANDOM() * 10000000000)::TEXT, 10, '0');
                        SELECT EXISTS(SELECT 1 FROM users WHERE user_code = new_code) INTO exists_check;
                        EXIT WHEN NOT exists_check;
                    END LOOP;
                    RETURN new_code;
                END;
                $$ LANGUAGE plpgsql;
            `);

            await pool.query(`
                CREATE OR REPLACE FUNCTION set_user_code()
                RETURNS TRIGGER AS $$
                BEGIN
                    IF NEW.user_code IS NULL THEN
                        NEW.user_code := generate_user_code();
                    END IF;
                    RETURN NEW;
                END;
                $$ LANGUAGE plpgsql;
            `);

            await pool.query(`DROP TRIGGER IF EXISTS trigger_set_user_code ON users;`);
            await pool.query(`
                CREATE TRIGGER trigger_set_user_code
                    BEFORE INSERT ON users
                    FOR EACH ROW
                    EXECUTE FUNCTION set_user_code();
            `);

            await pool.query(`UPDATE users SET user_code = generate_user_code() WHERE user_code IS NULL;`).catch(() => {});
            await pool.query(`DELETE FROM token_blacklist WHERE expires_at < NOW()`).catch(() => {});

            // auto-fix data lama yang stale
            await pool.query(`
                UPDATE orders SET status = 'expired', updated_at = NOW()
                WHERE status = 'pending' AND expired_at IS NOT NULL AND expired_at < NOW() - INTERVAL '5 minutes'
            `).catch(err => console.error('Auto-fix expired orders:', err.message));

            await pool.query(`
                UPDATE orders SET status = 'failed', updated_at = NOW()
                WHERE status = 'received' AND (otp_code IS NULL OR TRIM(otp_code) = '')
            `).catch(err => console.error('Auto-fix received no otp:', err.message));

            await pool.query(`
                UPDATE deposits SET status = 'expired', updated_at = NOW()
                WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW() - INTERVAL '5 minutes'
            `).catch(err => console.error('Auto-fix expired deposits:', err.message));

            await pool.query(`
                UPDATE orders SET notified_at = NULL
                WHERE status IN ('received','success','confirmed') AND otp_code IS NOT NULL
                  AND notified_at IS NOT NULL
                  AND notified_at < NOW() - INTERVAL '7 days'
            `).catch(() => {});

            schemaEnsured = true;
            console.log(`✅ Schema ensured in ${Date.now() - start}ms`);
        } catch (err) {
            console.error('❌ Ensure schema failed:', err.message);
            schemaPromise = null;
            throw err;
        }
    })();

    return schemaPromise;
}

// withDB wrapper — pastikan schema siap sebelum handler jalan
function withDB(handler) {
    return async (req, res, next) => {
        if (!schemaEnsured) {
            try {
                await ensureSchema();
            } catch (err) {
                console.error('withDB error:', err.message);
                return res.status(500).json({ error: 'Database tidak siap' });
            }
        }
        return handler(req, res, next);
    };
}

// cron auth
function requireCron(req, res, next) {
    if (!CRON_SECRET) {
        return res.status(500).json({ error: 'CRON_SECRET belum di-set' });
    }
    const provided = req.headers['x-cron-secret'] || req.query.secret;
    if (!provided) return res.status(401).json({ error: 'Cron secret wajib' });
    if (provided !== CRON_SECRET) return res.status(401).json({ error: 'Cron secret invalid' });
    next();
}

// auth middleware
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.replace('Bearer ', '');
    try {
        const decoded = jwt.verify(token, JWT_SECRET_FINAL);

        if (decoded.jti) {
            const blacklisted = await isTokenBlacklisted(decoded.jti);
            if (blacklisted) {
                return res.status(401).json({ error: 'Token sudah di-logout' });
            }
        }

        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token invalid atau expired' });
    }
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
}

// mark deposit paid. dipanggil dari webhook / sync / admin approve
async function markDepositPaid(deposit, receivedAmount, paidAt) {
    const saldoMasuk = Number(deposit.amount);
    const totalBayar = Number(receivedAmount) || Number(deposit.total_amount) || saldoMasuk;

    // fee = gateway + profit kita (digabung biar user lihat 1 angka)
    const gatewayFee = Math.max(0, totalBayar - saldoMasuk);
    const storedFee = Number(deposit.fee) || 0;
    const ourFee = storedFee > 0 ? storedFee : calculateDepositFee(saldoMasuk);
    const fee = gatewayFee + ourFee;

    const paidTime = paidAt ? new Date(paidAt) : new Date();

    const client = await pool.connect();
    let committed = false;
    let userData = null;
    let freshDeposit = null;

    try {
        await client.query('BEGIN');

        const updateRes = await client.query(
            `UPDATE deposits 
             SET status = 'success', paid_at = $1, updated_at = NOW(),
                 total_amount = $2, fee = $3
             WHERE id = $4 AND status = 'pending'
             RETURNING *`,
            [paidTime, totalBayar, fee, deposit.id]
        );

        if (updateRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return { alreadyProcessed: true, saldoMasuk, totalBayar, fee };
        }

        freshDeposit = updateRes.rows[0];

        await client.query(
            `UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
            [saldoMasuk, deposit.user_id]
        );

        await client.query(
            `INSERT INTO transactions (user_id, order_id, service_name, status, price)
             VALUES ($1, $2, $3, $4, $5)`,
            [deposit.user_id, deposit.reference_id, 'Deposit QRIS', 'success', totalBayar]
        );

        await client.query(
            `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            ['deposit', deposit.reference_id, deposit.user_id, deposit.status, 'success', 'payment_received',
             JSON.stringify({ saldoMasuk, totalBayar, fee, gatewayFee, ourFee, method: deposit.method })]
        );

        const userRes = await client.query(
            'SELECT username, name, user_code FROM users WHERE id = $1',
            [deposit.user_id]
        );
        userData = userRes.rows[0] || null;

        await client.query('COMMIT');
        committed = true;
        console.log(`✅ Deposit ${deposit.reference_id} | +${saldoMasuk} | gateway=${gatewayFee} | profit=${ourFee} | total_fee=${fee}`);
    } catch (err) {
        if (!committed) await client.query('ROLLBACK').catch(() => {});
        console.error('markDepositPaid error:', err.message);
        throw err;
    } finally {
        client.release();
    }

    return { alreadyProcessed: false, saldoMasuk, totalBayar, fee, gatewayFee, ourFee, freshDeposit, userData };
}

// sync deposit — qrispy only. qris_dana sudah dihapus.
async function syncDepositStatus(deposit) {
    if (['success', 'cancelled', 'failed', 'refunded'].includes(deposit.status)) return deposit;

    const now = new Date();
    const expiresAt = deposit.expires_at ? new Date(deposit.expires_at) : null;

    if (deposit.method === 'qrispy' && deposit.status === 'pending') {
        // expired dulu, tapi cek dulu ke provider siapa tau udah dibayar
        if (expiresAt && expiresAt < now) {
            if (deposit.qris_id) {
                try {
                    const data = await qrispyFetch(`/api/payment/qris/${deposit.qris_id}/status`);
                    if (data.data?.status === 'paid') {
                        const result = await markDepositPaid(deposit, data.data.received_amount || data.data.amount, data.data.paid_at);
                        if (!result.alreadyProcessed && result.freshDeposit) {
                            notifyDepositSuccess(result.freshDeposit, result.saldoMasuk, result.totalBayar, result.fee, result.userData)
                                .catch(err => console.error('notifyDepositSuccess error:', err.message));
                        }
                        const fresh = await pool.query('SELECT * FROM deposits WHERE id = $1', [deposit.id]);
                        return fresh.rows[0];
                    }
                    if (data.data?.status === 'expired') {
                        const upd = await pool.query(
                            `UPDATE deposits SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *`,
                            [deposit.id]
                        );
                        if (upd.rows[0]) {
                            await logStatusChange({ entityType: 'deposit', entityId: deposit.reference_id, userId: deposit.user_id, oldStatus: 'pending', newStatus: 'expired', reason: 'expired_qrispy' });
                        }
                        return upd.rows[0] || deposit;
                    }
                } catch (err) {}
            }
            const upd = await pool.query(
                `UPDATE deposits SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *`,
                [deposit.id]
            );
            if (upd.rows[0]) {
                await logStatusChange({ entityType: 'deposit', entityId: deposit.reference_id, userId: deposit.user_id, oldStatus: 'pending', newStatus: 'expired', reason: 'expired_fallback' });
            }
            return upd.rows[0] || deposit;
        }

        if (deposit.qris_id) {
            try {
                const data = await qrispyFetch(`/api/payment/qris/${deposit.qris_id}/status`);
                if (data.data?.status === 'paid') {
                    const result = await markDepositPaid(deposit, data.data.received_amount || data.data.amount, data.data.paid_at);
                    if (!result.alreadyProcessed && result.freshDeposit) {
                        notifyDepositSuccess(result.freshDeposit, result.saldoMasuk, result.totalBayar, result.fee, result.userData)
                            .catch(err => console.error('notifyDepositSuccess error:', err.message));
                    }
                    const fresh = await pool.query('SELECT * FROM deposits WHERE id = $1', [deposit.id]);
                    return fresh.rows[0];
                }
                if (data.data?.status === 'expired') {
                    const upd = await pool.query(
                        `UPDATE deposits SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *`,
                        [deposit.id]
                    );
                    if (upd.rows[0]) {
                        await logStatusChange({ entityType: 'deposit', entityId: deposit.reference_id, userId: deposit.user_id, oldStatus: 'pending', newStatus: 'expired', reason: 'expired_qrispy' });
                    }
                    return upd.rows[0] || deposit;
                }
            } catch (err) {}
        }
    }

    return deposit;
}

// refund order. idempotent, aman kalau double-call
async function refundOrder(order, reason = 'auto_refund') {
    const o = order;

    if (o.refunded_at && Number(o.refunded_at) > 0) {
        return { refunded: false, amount: Number(o.refunded_amount) || 0, alreadyProcessed: true };
    }

    if (['received', 'success', 'confirmed'].includes(o.status)) {
        return { refunded: false, amount: 0, alreadyProcessed: true };
    }

    const refundAmount = Number(o.price) || 0;
    if (refundAmount <= 0) return { refunded: false, amount: 0, alreadyProcessed: false };

    const refundTime = Date.now();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const updateRes = await client.query(
            `UPDATE orders 
             SET refunded_at = $1, refunded_amount = $2, refund_reason = $3, updated_at = NOW()
             WHERE id = $4 AND (refunded_at IS NULL OR refunded_at = 0)
             RETURNING *`,
            [refundTime, refundAmount, reason, o.id]
        );

        if (updateRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return { refunded: false, amount: 0, alreadyProcessed: true };
        }

        await client.query(
            `UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
            [refundAmount, o.user_id]
        );

        await client.query(
            `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            ['order', String(o.order_id), o.user_id, o.status, 'refunded', reason,
             JSON.stringify({ refunded_amount: refundAmount, otp_id: o.otp_id, original_status: o.status })]
        );

        await client.query('COMMIT');
        console.log(`💰 Refund ${refundAmount} (order ${o.order_id}, ${reason})`);

        return { refunded: true, amount: refundAmount, alreadyProcessed: false };
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('refundOrder error:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// cancel + refund. dipakai cron, cek-otp, sync
async function autoCancelAndRefund(order) {
    const fresh = await pool.query('SELECT * FROM orders WHERE id = $1', [order.id]);
    if (fresh.rows.length === 0) return { refunded: false };

    const o = fresh.rows[0];

    if (['received', 'success'].includes(o.status)) {
        return { refunded: false, alreadyProcessed: true };
    }

    if (['cancelled', 'refunded', 'expired'].includes(o.status)) {
        if (!o.refunded_at || Number(o.refunded_at) === 0) {
            const refundRes = await refundOrder(o, 'auto_refund_' + o.status);
            return { refunded: refundRes.refunded, refundedAmount: refundRes.amount, orderId: o.order_id, otpId: o.otp_id };
        }
        return { refunded: false, alreadyProcessed: true };
    }

    let providerRefund = 0;
    try {
        const cancelData = await providerCancelOrder(o);
        if (cancelData.refunded && Number(cancelData.refunded) > 0) {
            providerRefund = Number(cancelData.refunded);
        }
    } catch (err) {
        console.error(`Provider cancel ${o.order_id}:`, err.message);
    }

    const updateRes = await pool.query(
        `UPDATE orders SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
        [o.id]
    );

    if (updateRes.rowCount === 0) return { refunded: false, alreadyProcessed: true };

    await pool.query(
        `UPDATE transactions SET status = 'failed', updated_at = NOW() WHERE order_id = $1`,
        [String(o.order_id)]
    );

    const refundRes = await refundOrder({ ...o, status: 'expired' }, 'auto_cancel_expired');

    return { refunded: refundRes.refunded, refundedAmount: refundRes.amount, orderId: o.order_id, otpId: o.otp_id };
}

// cek + refund semua order pending milik user
async function checkAndRefundUserOrders(userId) {
    const refunded = [];

    try {
        const [expiredResult, needRefundResult] = await Promise.all([
            pool.query(
                `SELECT * FROM orders 
                 WHERE user_id = $1 AND status = 'pending'
                   AND expired_at IS NOT NULL AND expired_at < NOW()
                 ORDER BY expired_at ASC LIMIT 50`,
                [userId]
            ),
            pool.query(
                `SELECT * FROM orders 
                 WHERE user_id = $1 AND status IN ('cancelled', 'failed', 'expired')
                   AND (refunded_at IS NULL OR refunded_at = 0) AND price > 0
                 LIMIT 50`,
                [userId]
            ),
        ]);

        for (const order of expiredResult.rows) {
            try {
                const res = await autoCancelAndRefund(order);
                if (res.refunded) {
                    refunded.push({ order_id: res.orderId, otp_id: res.otpId, refunded_amount: res.refundedAmount, reason: 'expired' });
                }
            } catch (err) {}
        }

        for (const order of needRefundResult.rows) {
            try {
                const res = await refundOrder(order, 'auto_refund_' + order.status);
                if (res.refunded) {
                    refunded.push({ order_id: order.order_id, otp_id: order.otp_id, refunded_amount: res.amount, reason: order.status });
                }
            } catch (err) {}
        }
    } catch (err) {
        console.error('checkAndRefundUserOrders error:', err.message);
    }

    return refunded;
}

// cari order user. terima otp_id atau order_id provider
async function findUserOrder(userId, identifier) {
    if (!identifier) return null;
    const idStr = String(identifier).trim();

    let result = await pool.query(
        'SELECT * FROM orders WHERE otp_id = $1 AND user_id = $2 LIMIT 1',
        [idStr, userId]
    );
    if (result.rows.length > 0) return result.rows[0];

    result = await pool.query(
        'SELECT * FROM orders WHERE order_id = $1 AND user_id = $2 LIMIT 1',
        [idStr, userId]
    );
    if (result.rows.length > 0) return result.rows[0];

    return null;
}

// sync 1 order. no-op kalau udah final state
async function autoSyncOrder(order) {
    if (['received', 'success', 'confirmed', 'cancelled', 'failed', 'expired', 'refunded'].includes(order.status)) {
        if (['received', 'success', 'confirmed'].includes(order.status) && order.otp_code && !order.notified_at) {
            try {
                const user = await fetchUserForOrder(order);
                await notifyOtpSuccess(order, user);
            } catch (e) {}
        }
        return null;
    }

    try {
        const data = await providerOrderStatus(order);
        await pool.query(
            `UPDATE orders SET last_synced_at = NOW(), sync_attempt_count = sync_attempt_count + 1 WHERE id = $1`,
            [order.id]
        );

        if (data.status !== order.status || data.otp_code) {
            await pool.query(
                `UPDATE orders 
                 SET status = $1, otp_code = $2, otp_code_2 = $3, full_sms = $4, 
                     received_at = CASE WHEN $1 IN ('received', 'success') THEN NOW() ELSE received_at END, 
                     updated_at = NOW() 
                 WHERE order_id = $5`,
                [data.status, data.otp_code, data.otp_code_2, data.full_sms, String(order.order_id)]
            );
            await pool.query(
                `UPDATE transactions 
                 SET status = CASE 
                    WHEN $1 IN ('received', 'success') THEN 'success' 
                    WHEN $1 IN ('cancelled', 'expired', 'refunded') THEN 'failed' 
                    ELSE status 
                 END, otp_code = $2, updated_at = NOW() 
                 WHERE order_id = $3`,
                [data.status, data.otp_code, String(order.order_id)]
            );

            if (data.status !== order.status) {
                await logStatusChange({
                    entityType: 'order', entityId: String(order.order_id), userId: order.user_id,
                    oldStatus: order.status, newStatus: data.status, reason: 'auto_sync',
                    metadata: { otp_code: data.otp_code || null, otp_id: order.otp_id },
                });
            }

            if (['cancelled', 'expired', 'refunded'].includes(data.status)) {
                const fresh = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [order.order_id]);
                if (fresh.rows[0]) await refundOrder(fresh.rows[0], 'provider_' + data.status);
            }

            const fresh = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [order.order_id]);
            if (fresh.rows[0] && data.otp_code && ['received', 'success', 'confirmed'].includes(data.status)) {
                try {
                    const user = await fetchUserForOrder(fresh.rows[0]);
                    await notifyOtpSuccess(fresh.rows[0], user);
                } catch (e) {}
            }
            return fresh.rows[0] || null;
        }
        return null;
    } catch (err) {
        await pool.query(
            `UPDATE orders SET last_synced_at = NOW(), sync_attempt_count = sync_attempt_count + 1 WHERE id = $1`,
            [order.id]
        ).catch(() => {});
        return null;
    }
}

// webhook logger — simpan event apa pun (valid/invalid) buat audit
async function logWebhookEvent({
    source, eventType, signatureValid, req, payload, processed,
    processNote, relatedEntityType, relatedEntityId
}) {
    try {
        await pool.query(
            `INSERT INTO webhook_events 
             (source, event_type, signature_valid, ip_address, user_agent, payload, raw_body, processed, process_note, related_entity_type, related_entity_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                source,
                eventType || null,
                !!signatureValid,
                req.ip || req.headers['x-forwarded-for'] || null,
                req.headers['user-agent'] || null,
                payload ? JSON.stringify(payload) : null,
                (req.rawBody || '').substring(0, 4000),
                !!processed,
                processNote || null,
                relatedEntityType || null,
                relatedEntityId ? String(relatedEntityId) : null,
            ]
        );
    } catch (err) {
        console.error('logWebhookEvent error:', err.message);
    }
}

// health
app.get('/api/health', withDB(async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() as time');
        const wantsDetail = req.query.detail === '1' && CRON_SECRET && req.headers['x-cron-secret'] === CRON_SECRET;

        const base = { status: 'ok', time: result.rows[0].time };
        if (wantsDetail) {
            Object.assign(base, {
                version: 'v18-depo1-only',
                hasDibananaKey: !!DIBANANA_API_KEY,
                hasPremiumKey: !!PREMIUM_API_KEY,
                hasWebhookSecret: !!QRISPY_WEBHOOK_SECRET,
                hasWebhookOtp1: !!WEBHOOK_OTP1_SECRET,
                hasWebhookOtp2: !!PREMIUM_WEBHOOK_SECRET,
                hasJwtSecret: !!JWT_SECRET,
                hasCronSecret: !!CRON_SECRET,
                hasApiCdn: !!API_CDN,
                hasRecaptcha: !!RECAPTCHA_SECRET,
                hasTelegramToken: !!TELEGRAM_BOT_TOKEN,
                hasTelegramChannel: !!TELEGRAM_CHANNEL_ID,
                telegramChannelOtp: TELEGRAM_CHANNEL_OTP_ID || null,
                telegramChannelDeposit: TELEGRAM_CHANNEL_DEPOSIT_ID || null,
                schemaEnsured,
                poolTotal: pool.totalCount,
                poolIdle: pool.idleCount,
                poolWaiting: pool.waitingCount,
                markupPercent: MARKUP_PERCENT,
                depositFeeMin: DEPOSIT_FEE_MIN,
                depositFeeMax: DEPOSIT_FEE_MAX,
                priceLockSize: priceLockCache.size,
                priceLockMax: PRICE_LOCK_MAX_SIZE,
                servers: Object.keys(SERVER_CONFIG),
            });
        }
        res.json(base);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

// 1. ENDPOINT BUAT MINTA URL LOGIN (Dipanggil dari Frontend)
app.get('/api/auth/google/url', withDB(async (req, res) => {
    try {
        // Bikin code_verifier (string random)
        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        
        // Bikin code_challenge (hash dari verifier)
        const codeChallenge = crypto.createHash('sha256')
            .update(codeVerifier)
            .digest('base64url');

        // Simpen code_verifier ke database sementara (pake tabel sessions atau bikin tabel baru)
        // Di sini gw pake tabel sessions biar simpel
        const stateId = crypto.randomBytes(16).toString('hex');
        await pool.query(
            'INSERT INTO sessions (user_id, refresh_token_hash, jti, expires_at) VALUES (NULL, $1, $2, NOW() + INTERVAL \'5 minutes\')',
            [stateId, codeVerifier] // Simpen verifier di kolom jti sementara
        );

        const clientId = process.env.CLIENT_ID_GOOGLE_LOGIN;
        // PASTIIN INI SAMA DENGAN DI GOOGLE CONSOLE
        const redirectUri = 'https://asyrofotp.vercel.app/api/auth/google/callback';
        
        const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + 
            'client_id=' + encodeURIComponent(clientId) +
            '&redirect_uri=' + encodeURIComponent(redirectUri) +
            '&response_type=code' +
            '&scope=email%20profile' +
            '&prompt=select_account' +
            '&state=' + stateId + // Kirim stateId biar tau verifier mana yang dipake
            '&code_challenge=' + codeChallenge +
            '&code_challenge_method=S256';

        res.json({ url: authUrl });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}));


// 2. ENDPOINT CALLBACK (Yang ditembak sama Google)
app.get('/api/auth/google/callback', withDB(async (req, res) => {
    const { code, state } = req.query;
    if (!code || !state) return res.redirect('/login?error=missing_code');

    try {
        // 1. Ambil code_verifier dari DB berdasarkan state
        const sessionRes = await pool.query('SELECT jti FROM sessions WHERE refresh_token_hash = $1 LIMIT 1', [state]);
        if (sessionRes.rows.length === 0) throw new Error('Sesi verifikasi hilang atau expired.');
        
        const codeVerifier = sessionRes.rows[0].jti;

        // Hapus state dari DB biar gak bisa dipake 2x
        await pool.query('DELETE FROM sessions WHERE refresh_token_hash = $1', [state]);

        const redirectUri = 'https://asyrofotp.vercel.app/api/auth/google/callback'; // HARUS SAMA

        // 2. Tuker Code ke Google
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code: code,
                client_id: process.env.CLIENT_ID_GOOGLE_LOGIN,
                client_secret: process.env.CLIENT_SECRET_GOOGLE_LOGIN,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
                code_verifier: codeVerifier // <--- INI WAJIB
            })
        });

        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
            console.error('Google Error Detail:', tokenData);
            throw new Error('Gagal dapet token dari Google');
        }

        // 3. Pake Access Token buat ngambil data User
        const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const googleUser = await userRes.json();
        
        if (!googleUser.id || !googleUser.email) throw new Error('Gagal dapet email');

        // 4. CARI / SIMPEN USER KE DATABASE
        const googleId = String(googleUser.id);
        const email = String(googleUser.email).toLowerCase();
        const displayName = String(googleUser.name || '').trim() || email.split('@')[0];

        let userResDb = await pool.query('SELECT * FROM users WHERE google_id = $1 LIMIT 1', [googleId]);
        let user = userResDb.rows[0];

        if (!user) {
            // Cek email (kalau user lama login pake password)
            userResDb = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1', [email]);
            user = userResDb.rows[0];
            
            if (user) {
                await pool.query('UPDATE users SET google_id = $1 WHERE id = $2 AND google_id IS NULL', [googleId, user.id]);
            } else {
                // Bikin user baru
                const base = email.split('@')[0].replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
                let candidate = base.length >= 3 ? base : base + '000';
                const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
                
                const ins = await pool.query(
                    `INSERT INTO users (username, password_hash, name, email, google_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
                    [candidate, randomHash, displayName, email, googleId]
                );
                user = ins.rows[0];
            }
        }

        if (user.status === 'banned') return res.redirect('/login?error=banned');

        // 5. BIKIN SESSION JWT & SET COOKIE
        const token = signToken(user);
        
        // Set cookie biar frontend otomatis login
        res.cookie('token', token, { 
            httpOnly: true, 
            secure: true, 
            sameSite: 'lax',
            maxAge: 30 * 60 * 1000 
        });

        // 6. REDIRECT KE DASHBOARD
        res.redirect('/login?token=' + token + '&refresh=' + (user.refresh || ''));

    } catch (err) {
        console.error('Google Redirect Error:', err.message);
        res.redirect('/login?error=failed');
    }
}));

// auth routes
app.post('/api/auth/check-username', rateLimit(30, 60 * 1000), withDB(async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username wajib diisi' });
    if (!isValidUsername(username)) {
        return res.status(400).json({ available: false, error: 'Username hanya boleh huruf, angka, underscore (3-20 karakter)' });
    }
    try {
        const result = await pool.query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [username.toLowerCase()]);
        res.json({ available: result.rows.length === 0 });
    } catch (err) {
        console.error('Check username error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/auth/forgot', withDB(async (req, res) => {
    const { email, cf_token } = req.body;
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const device = req.headers['x-device-id'] || 'unknown';

    // 1. Validasi Input Dasar
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Format email tidak valid' });
    }

    if (!cf_token) {
        return res.status(400).json({ error: 'Verifikasi keamanan (Turnstile) wajib diisi.' });
    }

    try {
        // 2. CEK TURNSTILE TOKEN (Anti Robot)
        const cfForm = new URLSearchParams();
        cfForm.append('secret', process.env.TURNSTILE_SECRET_KEY); 
        cfForm.append('response', cf_token);
        cfForm.append('remoteip', ip);

        const cfRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: cfForm
        });
        const cfData = await cfRes.json();

        if (!cfData.success) {
            return res.status(400).json({ error: 'Verifikasi keamanan gagal. Kamu terdeteksi sebagai robot.' });
        }

        // 3. Cek Rate Limit (Maksimal 3 request per 1 jam berdasarkan IP atau Device)
        const checkLimit = await pool.query(
            `SELECT COUNT(*) as total FROM rate_limits 
             WHERE (ip_address = $1 OR device_id = $2) 
               AND action = 'forgot_password' 
               AND created_at > NOW() - INTERVAL '1 hour'`,
            [ip, device]
        );

        if (Number(checkLimit.rows[0].total) >= 3) {
            return res.status(429).json({ 
                error: 'Batas permintaan habis. Coba lagi 1 jam kemudian.' 
            });
        }

        // 4. Catat request ke DB
        await pool.query(
            `INSERT INTO rate_limits (ip_address, device_id, action) VALUES ($1, $2, $3)`,
            [ip, device, 'forgot_password']
        );

        // 5. Cari user dan kirim email
        const uRes = await pool.query('SELECT id, username FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
        
        if (uRes.rows.length > 0) {
            const user = uRes.rows[0];
            const token = crypto.randomBytes(32).toString('hex');
            
            await pool.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
            await pool.query(
                'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'15 minutes\')',
                [user.id, token]
            );

            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.APP_PASS_RESET_PASSWORD
                }
            });

            const resetLink = `https://asyrofotp.vercel.app/reset.html?token=${token}`;
            
            await transporter.sendMail({
                from: `"AsyrofOTP" <${process.env.EMAIL_USER}>`,
                to: email,
                subject: 'Reset Password Akun AsyrofOTP',
                html: `
                    <div style="font-family:sans-serif;padding:20px;color:#333">
                        <h2>Reset Password</h2>
                        <p>Halo <b>${user.username}</b>,</p>
                        <p>Klik tombol di bawah ini untuk mereset password akunmu:</p>
                        <p><a href="${resetLink}" style="background:#0a84ff;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;display:inline-block;margin:10px 0">Reset Password</a></p>
                        <p style="font-size:12px;color:#888">Link berlaku 15 menit. Abaikan jika kamu tidak meminta reset.</p>
                    </div>
                `
            });
        }

        // Selalu balas sukses biar gak bisa ditebak email mana yang terdaftar
        res.json({ message: 'Jika email terdaftar, link reset telah dikirim.' });

    } catch (err) {
        console.error('Forgot email error:', err.message);
        res.status(500).json({ error: 'Gagal memproses permintaan. Coba lagi nanti.' });
    }
}));

app.post('/api/auth/reset-password', rateLimit(5, 60 * 1000), withDB(async (req, res) => {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
        return res.status(400).json({ error: 'Token dan password baru wajib diisi' });
    }
    if (new_password.length < 6) {
        return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }

    try {
        // Cari token yang valid & belum expired
        const result = await pool.query(
            `SELECT user_id FROM password_resets 
             WHERE token = $1 AND expires_at > NOW() AND used_at IS NULL LIMIT 1`,
            [token]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Token tidak valid atau sudah kedaluwarsa' });
        }

        const userId = result.rows[0].user_id;
        const hash = await bcrypt.hash(new_password, 10);

        // 1. Update password user
        await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, userId]);

        // 2. Tandai token sudah dipakai (biar gak bisa dipake 2x)
        await pool.query('UPDATE password_resets SET used_at = NOW() WHERE token = $1', [token]);

        // 3. Logout semua device (biar aman)
        await revokeAllUserSessions(userId);

        res.json({ message: 'Password berhasil diubah. Silakan login.' });
    } catch (err) {
        console.error('Reset password error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/auth/register', rateLimit(10, 60 * 1000), withDB(async (req, res) => {
    const { username, password, name, recaptcha_token } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });

    const captcha = await verifyRecaptcha(recaptcha_token, { minScore: 0.5, expectedAction: 'register' });
    if (!captcha.success) return res.status(400).json({ error: captcha.error, code: captcha.code });

    if (!isValidUsername(username)) return res.status(400).json({ error: 'Username hanya boleh huruf, angka, underscore (3-20 karakter)' });
    if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
    if (password.length > 100) return res.status(400).json({ error: 'Password maksimal 100 karakter' });

    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (username, password_hash, name)
             VALUES ($1, $2, $3)
             RETURNING username, name, balance, user_code`,
            [username.toLowerCase(), hash, name || username]
        );
        const u = result.rows[0];
        res.json({
            message: 'Registrasi berhasil!',
            user: {
                username: u.username,
                name: u.name,
                balance: Number(u.balance) || 0,
                user_code: u.user_code,
            },
        });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Username sudah dipakai' });
        console.error('Register error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/auth/login', rateLimit(20, 60 * 1000), withDB(async (req, res) => {
    const { username, password, recaptcha_token } = req.body;
    const device = req.headers['x-device-id'] || null;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });

    const captcha = await verifyRecaptcha(recaptcha_token, { minScore: 0.5, expectedAction: 'login' });
    if (!captcha.success) return res.status(400).json({ error: captcha.error, code: captcha.code });

    try {
        const result = await pool.query(
            'SELECT id, username, name, balance, role, status, user_code, password_hash FROM users WHERE username = $1 LIMIT 1',
            [username.toLowerCase()]
        );
        if (result.rows.length === 0) return res.status(401).json({ error: 'Username atau password salah' });

        const user = result.rows[0];
        if (user.status === 'banned') return res.status(403).json({ error: 'Akun kamu diblokir' });

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Username atau password salah' });

        const session = await createSession({
            userId: user.id,
            device,
            userAgent: req.headers['user-agent'] || null,
            ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
        });

        await pool.query(
            `UPDATE users SET last_login_at = NOW(), last_login_ip = $1, last_device = $2 WHERE id = $3`,
            [req.ip || null, device, user.id]
        );

        const token = signToken(user);

        res.json({
            message: 'Login berhasil!',
            session: {
                access_token: token,
                refresh_token: session.rawRefresh,
                expires_in: 30 * 60,
                refresh_expires_at: session.expiresAt.toISOString(),
            },
            user: {
                username: user.username,
                name: user.name,
                balance: Number(user.balance) || 0,
                user_code: user.user_code,
            }
        });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/auth/google', rateLimit(20, 60 * 1000), withDB(async (req, res) => {
    if (!GOOGLE_CLIENT_ID) {
        return res.status(500).json({ error: 'Google login belum dikonfigurasi' });
    }

    const { credential } = req.body || {};
    if (!credential || typeof credential !== 'string') {
        return res.status(400).json({ error: 'credential wajib' });
    }

    const device = req.headers['x-device-id'] || null;

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();

        if (!payload || !payload.sub || !payload.email) {
            return res.status(401).json({ error: 'Token Google tidak valid' });
        }
        if (payload.email_verified === false) {
            return res.status(401).json({ error: 'Email Google belum diverifikasi' });
        }

        const googleId = String(payload.sub);
        const email = String(payload.email).toLowerCase();
        const displayName = String(payload.name || '').trim() || email.split('@')[0];

        let userRes = await pool.query(
            `SELECT id, username, name, balance, role, status, user_code
             FROM users WHERE google_id = $1 LIMIT 1`,
            [googleId]
        );
        let user = userRes.rows[0] || null;
        let isNewUser = false;

        if (!user) {
            userRes = await pool.query(
                `SELECT id, username, name, balance, role, status, user_code
                 FROM users WHERE LOWER(email) = $1 LIMIT 1`,
                [email]
            );
            user = userRes.rows[0] || null;
            if (user) {
                await pool.query(
                    `UPDATE users SET google_id = $1, updated_at = NOW() WHERE id = $2 AND google_id IS NULL`,
                    [googleId, user.id]
                );
            }
        }

        if (!user) {
            const base = email.split('@')[0].replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
            let candidate = base.length >= 3 ? base : base + '000';

            for (let i = 0; i < 5; i++) {
                const exists = await pool.query(
                    'SELECT 1 FROM users WHERE username = $1 LIMIT 1',
                    [candidate]
                );
                if (exists.rows.length === 0) break;
                candidate = base.slice(0, 15) + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
            }

            const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

            const insertRes = await pool.query(
                `INSERT INTO users (username, password_hash, name, email, google_id)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, username, name, balance, role, status, user_code`,
                [candidate, randomHash, displayName, email, googleId]
            );
            user = insertRes.rows[0];
            isNewUser = true;
        }

        if (user.status === 'banned') {
            return res.status(403).json({ error: 'Akun kamu diblokir' });
        }

        const session = await createSession({
            userId: user.id,
            device,
            userAgent: req.headers['user-agent'] || null,
            ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
        });

        await pool.query(
            `UPDATE users SET last_login_at = NOW(), last_login_ip = $1, last_device = $2 WHERE id = $3`,
            [req.ip || null, device, user.id]
        );

        const token = signToken(user);

        res.json({
            message: isNewUser ? 'Akun berhasil dibuat' : 'Login berhasil!',
            is_new_user: isNewUser,
            session: {
                access_token: token,
                refresh_token: session.rawRefresh,
                expires_in: 30 * 60,
                refresh_expires_at: session.expiresAt.toISOString(),
            },
            user: {
                username: user.username,
                name: user.name,
                balance: Number(user.balance) || 0,
                user_code: user.user_code,
            },
        });
    } catch (err) {
        if (/audience|Wrong recipient|Token used too late|Invalid token signature/i.test(err.message || '')) {
            return res.status(401).json({ error: 'Token Google tidak valid atau kedaluwarsa' });
        }
        console.error('Google login error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/auth/refresh', rateLimit(60, 60 * 1000), withDB(async (req, res) => {
    const rawRefresh = req.body?.refresh_token || req.headers['x-refresh-token'];
    if (!rawRefresh) return res.status(400).json({ error: 'refresh_token wajib' });

    try {
        const session = await findActiveSessionByRefresh(rawRefresh);
        if (!session) return res.status(401).json({ error: 'Refresh token invalid atau expired' });

        const userRes = await pool.query('SELECT id, username, role, status FROM users WHERE id = $1 LIMIT 1', [session.user_id]);
        if (userRes.rows.length === 0) return res.status(401).json({ error: 'User tidak ditemukan' });

        const user = userRes.rows[0];
        if (user.status === 'banned') {
            await revokeSession(session.id);
            return res.status(403).json({ error: 'Akun diblokir' });
        }

        await pool.query(`UPDATE sessions SET last_used_at = NOW() WHERE id = $1`, [session.id]);

        const newAccess = signToken(user);
        res.json({ access_token: newAccess, expires_in: 30 * 60 });
    } catch (err) {
        console.error('Refresh error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/auth/logout', requireAuth, withDB(async (req, res) => {
    try {
        const rawRefresh = req.body?.refresh_token || req.headers['x-refresh-token'];
        if (rawRefresh) {
            const session = await findActiveSessionByRefresh(rawRefresh);
            if (session) await revokeSession(session.id);
        }
        if (req.user.jti) {
            const decoded = jwt.decode(req.headers.authorization.replace('Bearer ', ''));
            const exp = decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 30 * 60 * 1000);
            await blacklistToken(req.user.jti, exp);
        }
        res.json({ message: 'Logout berhasil' });
    } catch (err) {
        console.error('Logout error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/auth/logout-all', requireAuth, withDB(async (req, res) => {
    try {
        await revokeAllUserSessions(req.user.id);
        if (req.user.jti) {
            const decoded = jwt.decode(req.headers.authorization.replace('Bearer ', ''));
            const exp = decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 30 * 60 * 1000);
            await blacklistToken(req.user.jti, exp);
        }
        res.json({ message: 'Semua sesi berhasil di-logout' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.get('/api/auth/sessions', requireAuth, withDB(async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, device, user_agent, ip_address, last_used_at, created_at, expires_at
             FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
             ORDER BY last_used_at DESC LIMIT 20`,
            [req.user.id]
        );
        res.json({ sessions: result.rows });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

// user routes
app.get('/api/user', requireAuth, withDB(async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT username, name, balance, role, user_code, status, email, created_at FROM users WHERE id = $1 LIMIT 1',
            [req.user.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }
        
        const u = result.rows[0];
        
        res.set('Content-Type', 'application/json');
        res.end(JSON.stringify({
            username: u.username,
            name: u.name,
            balance: Number(u.balance) || 0,
            role: u.role,
            user_code: u.user_code,
            status: u.status,
            email: u.email || null, // <--- Tambahan
            created_at: u.created_at,
        }));
    } catch (err) {
        console.error('User error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/user/update', requireAuth, userRateLimit(20, 60 * 1000), withDB(async (req, res) => {
    const { name } = req.body;
    
    // Validasi secepat mungkin sebelum nyentuh DB
    if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Nama minimal 2 karakter' });
    if (name.trim().length > 50) return res.status(400).json({ error: 'Nama maksimal 50 karakter' });

    try {
        const result = await pool.query(
            'UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING username, name, balance, user_code',
            [name.trim(), req.user.id]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }
        
        const u = result.rows[0];
        
        res.set('Content-Type', 'application/json');
        res.end(JSON.stringify({
            message: 'Profil berhasil diupdate',
            user: {
                username: u.username,
                name: u.name,
                balance: Number(u.balance) || 0,
                user_code: u.user_code,
            }
        }));
    } catch (err) {
        console.error('Update user error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/user/link-email', requireAuth, userRateLimit(5, 60 * 1000), withDB(async (req, res) => {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Format email tidak valid' });
    }

    const cleanEmail = email.trim().toLowerCase();

    try {
        // 1. Cek apakah email udah dipake user LAIN
        const checkEmail = await pool.query(
            'SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2 LIMIT 1',
            [cleanEmail, req.user.id]
        );
        if (checkEmail.rows.length > 0) {
            return res.status(400).json({ error: 'Email sudah terdaftar di akun lain' });
        }

        // 2. Setup Transporter
        if (!process.env.EMAIL_USER || !process.env.APP_PASS_RESET_PASSWORD) {
            console.error('Email env not set');
            return res.status(500).json({ error: 'Layanan email belum dikonfigurasi' });
        }

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.APP_PASS_RESET_PASSWORD
            }
        });

        // 3. Ambil data user buat nama di email
        const userRes = await pool.query('SELECT username, name FROM users WHERE id = $1 LIMIT 1', [req.user.id]);
        const user = userRes.rows[0];
        const displayName = user.name || user.username || 'User';

        // 4. Kirim email verifikasi / notifikasi
        // Kalau email gak valid, nodemailer bakal throw error (catch di bawah)
        const mailOptions = {
            from: `"AsyrofOTP" <${process.env.EMAIL_USER}>`,
            to: cleanEmail,
            subject: 'Akun Anda Berhasil Tertaut',
            html: `
                <div style="font-family:sans-serif;padding:20px;color:#333;max-width:500px;margin:0 auto;border:1px solid #ddd;border-radius:8px;">
                    <h2 style="color:#0a84ff;">Halo, ${displayName}!</h2>
                    <p>Email ini telah berhasil ditautkan ke akun <b>AsyrofOTP</b> Anda.</p>
                    <p>Dengan email ini, Anda bisa melakukan reset password jika lupa, dan menerima notifikasi penting lainnya.</p>
                    <p style="margin-top:30px;font-size:12px;color:#888;">Jika Anda tidak merasa melakukan ini, segera hubungi support.</p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);

        // 5. Kalau email sukses terkirim, baru update DB
        const oldEmailRes = await pool.query('SELECT email FROM users WHERE id = $1 LIMIT 1', [req.user.id]);
        const oldEmail = oldEmailRes.rows[0] ? oldEmailRes.rows[0].email : null;

        await pool.query(
            'UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2',
            [cleanEmail, req.user.id]
        );

        // 6. Log
        await logStatusChange({
            entityType: 'user',
            entityId: req.user.id,
            userId: req.user.id,
            oldStatus: oldEmail ? 'email_exists' : null,
            newStatus: 'email_linked',
            reason: oldEmail ? 'user_change_email' : 'user_link_email',
            metadata: { old_email: oldEmail, new_email: cleanEmail }
        });

        res.json({ message: 'Email berhasil ditautkan!', email: cleanEmail });
    } catch (err) {
        console.error('Link email error:', err.message);
        
        // Handle error spesifik dari Nodemailer (email gak valid / gak ada)
        if (err.code === 'EENVELOPE' || (err.response && err.response.includes('550'))) {
            return res.status(400).json({ error: 'Email tidak ditemukan atau tidak valid' });
        }
        
        res.status(500).json({ error: 'Gagal memproses email. Coba lagi nanti.' });
    }
}));

app.post('/api/user/change-password', requireAuth, userRateLimit(5, 60 * 1000), withDB(async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Semua field wajib diisi' });
    if (new_password.length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter' });

    try {
        const result = await pool.query('SELECT password_hash FROM users WHERE id = $1 LIMIT 1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });

        const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Password lama salah' });

        const newHash = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);
        await revokeAllUserSessions(req.user.id);
        res.json({ message: 'Password berhasil diubah. Semua sesi lain di-logout.' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.get('/api/dashboard', requireAuth, withDB(async (req, res) => {
    try {
        // 1. Hitung semua statistik langsung di database (1 query)
        const statsRes = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status IN ('success', 'received', 'confirmed')) as success,
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status IN ('canceled', 'cancelled')) as canceled,
                COUNT(*) FILTER (WHERE status IN ('expired', 'failed')) as failed,
                COUNT(*) FILTER (WHERE status = 'refunded') as refunded
            FROM transactions 
            WHERE user_id = $1
        `, [req.user.id]);

        const s = statsRes.rows[0];

        // 2. Tarik 5 transaksi terbaru aja
        const recentRes = await pool.query(`
            SELECT service_name, country, country_flag, phone_number, status, price, otp_code, created_at
            FROM transactions 
            WHERE user_id = $1 
            ORDER BY created_at DESC 
            LIMIT 5
        `, [req.user.id]);

        // 3. Kirim respon
        res.set('Content-Type', 'application/json');
        res.end(JSON.stringify({
            stats: {
                total: Number(s.total) || 0,
                success: Number(s.success) || 0,
                pending: Number(s.pending) || 0,
                canceled: Number(s.canceled) || 0,
                failed: Number(s.failed) || 0,
                refunded: Number(s.refunded) || 0
            },
            transactions: recentRes.rows
        }));

    } catch (err) {
        console.error('Dashboard error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// deposit routes
app.get('/api/deposit/methods', requireAuth, (req, res) => {
    res.json({ methods: DEPOSIT_METHODS });
});

app.get('/api/deposit/presets', requireAuth, (req, res) => {
    res.json(DEPOSIT_PRESETS);
});

app.post('/api/deposit/generate-ref', requireAuth, userRateLimit(20, 60 * 1000), withDB(async (req, res) => {
    try {
        const referenceId = await generateUniqueReferenceId();
        res.json({ reference_id: referenceId });
    } catch (err) {
        res.status(500).json({ error: 'Gagal generate reference ID' });
    }
}));

// simpan deposit QRIS (via depo1). path `/save` biar netral, gak bawa nama provider.
app.post('/api/deposit/save', requireAuth, userRateLimit(10, 60 * 1000), withDB(async (req, res) => {
    const { reference_id, amount, qris_id, qris_url, expired_at, expires_in_seconds } = req.body;

    if (!reference_id || !amount || !qris_id) return res.status(400).json({ error: 'Data tidak lengkap' });
    if (amount < 1000 || amount > 10000000) return res.status(400).json({ error: 'Nominal tidak valid' });

    try {
        const existing = await pool.query('SELECT * FROM deposits WHERE reference_id = $1 LIMIT 1', [reference_id]);
        if (existing.rows.length > 0) {
            const d = existing.rows[0];
            return res.json({
                message: 'Deposit sudah tercatat',
                deposit: {
                    reference_id: d.reference_id,
                    method: d.method,
                    amount: Number(d.amount),
                    qris_id: d.qris_id,
                    qris_url: d.qris_url,
                    expired_at: d.expires_at,
                    expires_in_seconds: expires_in_seconds || 900
                },
            });
        }

        const ourFee = calculateDepositFee(Number(amount));

        await pool.query(
            `INSERT INTO deposits (user_id, reference_id, method, amount, total_amount, fee, status, qris_id, qris_url, payment_reference, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                req.user.id, reference_id, 'qrispy',
                Number(amount),
                Number(amount) + ourFee,
                ourFee,
                'pending', qris_id, qris_url, reference_id, new Date(expired_at)
            ]
        );

        await logStatusChange({
            entityType: 'deposit', entityId: reference_id, userId: req.user.id,
            oldStatus: null, newStatus: 'pending', reason: 'qrispy_created',
            metadata: { amount: Number(amount), method: 'qrispy', qris_id, our_fee: ourFee },
        });

        res.json({
            message: 'Deposit tercatat',
            deposit: {
                reference_id, method: 'qrispy', amount: Number(amount),
                qris_id, qris_url, expired_at,
                total_amount: Number(amount) + ourFee,
                fee: ourFee,
                fee_label: 'Biaya QRIS',
                expires_in_seconds: expires_in_seconds || 900
            },
        });
    } catch (err) {
        console.error('deposit/save error:', err.message);
        res.status(500).json({ error: 'Gagal simpan deposit' });
    }
}));

// /api/deposit/qris-dana DIHAPUS — pakai /api/deposit/save (qrispy via depo1) saja

app.get('/api/deposit/:referenceId/status', requireAuth, withDB(async (req, res) => {
    const { referenceId } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM deposits WHERE reference_id = $1 AND user_id = $2 LIMIT 1',
            [referenceId, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit tidak ditemukan' });

        let deposit = result.rows[0];
        if (deposit.status === 'success') return res.json({ status: 'success', deposit: sanitizeDepositForUser(deposit) });

        deposit = await syncDepositStatus(deposit);
        if (deposit.status === 'success') return res.json({ status: 'success', deposit: sanitizeDepositForUser(deposit) });

        res.json({ status: 'ok', deposit: sanitizeDepositForUser(deposit) });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/deposit/:referenceId/update-fee', requireAuth, withDB(async (req, res) => {
    const { referenceId } = req.params;
    const { total_amount, fee } = req.body;
    try {
        const result = await pool.query(
            'SELECT * FROM deposits WHERE reference_id = $1 AND user_id = $2 LIMIT 1',
            [referenceId, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit tidak ditemukan' });

        const deposit = result.rows[0];
        if (deposit.status !== 'pending') return res.status(400).json({ error: 'Deposit sudah diproses' });

        const ourFee = calculateDepositFee(Number(deposit.amount));
        const finalFee = Math.max(Number(fee), ourFee);

        await pool.query(
            `UPDATE deposits SET total_amount = $1, fee = $2, updated_at = NOW() WHERE id = $3`,
            [Number(total_amount) + ourFee, finalFee, deposit.id]
        );

        res.json({ message: 'Fee updated', fee: finalFee, our_fee: ourFee });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/deposit/:referenceId/expire', requireAuth, withDB(async (req, res) => {
    const { referenceId } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM deposits WHERE reference_id = $1 AND user_id = $2 LIMIT 1',
            [referenceId, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit tidak ditemukan' });

        const deposit = result.rows[0];
        if (deposit.status !== 'pending') return res.status(400).json({ error: 'Deposit tidak bisa di-expire', deposit: sanitizeDepositForUser(deposit) });

        if (deposit.expires_at && new Date(deposit.expires_at) > new Date()) {
            return res.status(400).json({ error: 'Deposit belum expired. Tunggu sampai waktu habis.', expires_at: deposit.expires_at });
        }

        if (deposit.qris_id) {
            try {
                const data = await qrispyFetch(`/api/payment/qris/${deposit.qris_id}/status`);
                if (data.data?.status === 'paid') {
                    const result2 = await markDepositPaid(deposit, data.data.received_amount || data.data.amount, data.data.paid_at);
                    if (!result2.alreadyProcessed && result2.freshDeposit) {
                        notifyDepositSuccess(result2.freshDeposit, result2.saldoMasuk, result2.totalBayar, result2.fee, result2.userData)
                            .catch(err => console.error('notifyDepositSuccess error:', err.message));
                    }
                    const fresh = await pool.query('SELECT * FROM deposits WHERE id = $1', [deposit.id]);
                    return res.json({ message: 'Deposit sudah dibayar', deposit: sanitizeDepositForUser(fresh.rows[0]) });
                }
            } catch (err) {}
        }

        const upd = await pool.query(
            `UPDATE deposits SET status = 'expired', updated_at = NOW() 
             WHERE id = $1 AND status = 'pending' RETURNING *`,
            [deposit.id]
        );

        if (upd.rows[0]) {
            await logStatusChange({
                entityType: 'deposit', entityId: deposit.reference_id, userId: req.user.id,
                oldStatus: 'pending', newStatus: 'expired', reason: 'manual_expire',
            });
        }

        res.json({ message: 'Deposit expired', deposit: sanitizeDepositForUser(upd.rows[0]) });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/deposit/:referenceId/cancel', requireAuth, withDB(async (req, res) => {
    const { referenceId } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM deposits WHERE reference_id = $1 AND user_id = $2 LIMIT 1',
            [referenceId, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit tidak ditemukan' });

        const deposit = result.rows[0];
        if (deposit.status !== 'pending') return res.status(400).json({ error: 'Deposit nggak bisa dibatalkan' });
        if (deposit.expires_at && new Date(deposit.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Deposit sudah kedaluwarsa, tidak bisa dibatalkan' });
        }

        if (deposit.qris_id) {
            try {
                const statusData = await qrispyFetch(`/api/payment/qris/${deposit.qris_id}/status`);
                if (statusData.data?.status === 'paid') {
                    const result2 = await markDepositPaid(deposit, statusData.data.received_amount || statusData.data.amount, statusData.data.paid_at);
                    if (!result2.alreadyProcessed && result2.freshDeposit) {
                        notifyDepositSuccess(result2.freshDeposit, result2.saldoMasuk, result2.totalBayar, result2.fee, result2.userData)
                            .catch(err => console.error('notifyDepositSuccess error:', err.message));
                    }
                    const fresh = await pool.query('SELECT * FROM deposits WHERE id = $1', [deposit.id]);
                    return res.status(400).json({
                        error: 'Deposit sudah dibayar, tidak bisa dibatalkan',
                        deposit: sanitizeDepositForUser(fresh.rows[0])
                    });
                }
            } catch (err) {
                console.error('Check payment before cancel error:', err.message);
            }

            try {
                await qrispyFetch(`/api/payment/qris/${deposit.qris_id}/cancel`, { method: 'POST' });
            } catch (err) {
                console.error('depo1 cancel error:', err.message);
            }
        }

        await pool.query(
            `UPDATE deposits SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
            [deposit.id]
        );

        await logStatusChange({
            entityType: 'deposit', entityId: deposit.reference_id, userId: req.user.id,
            oldStatus: 'pending', newStatus: 'cancelled', reason: 'manual_cancel',
            metadata: { method: deposit.method, amount: Number(deposit.amount) },
        });

        res.json({ message: 'Deposit dibatalkan' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.get('/api/deposit/history', requireAuth, withDB(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 5));
    const status = req.query.status;
    const offset = (page - 1) * limit;

    try {
        let query, countQuery, params, countParams;

        if (status) {
            query = `SELECT * FROM deposits WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`;
            params = [req.user.id, status, limit, offset];
            countQuery = `SELECT COUNT(*) FROM deposits WHERE user_id = $1 AND status = $2`;
            countParams = [req.user.id, status];
        } else {
            query = `SELECT * FROM deposits WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
            params = [req.user.id, limit, offset];
            countQuery = `SELECT COUNT(*) FROM deposits WHERE user_id = $1`;
            countParams = [req.user.id];
        }

        const [result, countRes] = await Promise.all([
            pool.query(query, params),
            pool.query(countQuery, countParams),
        ]);

        const total = Number(countRes.rows[0].count);
        const totalPages = Math.ceil(total / limit);

        res.json({
            deposits: result.rows.map(sanitizeDepositForUser),
            total, page, limit, totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
        });
    } catch (err) {
        console.error('List deposits error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/deposit/sync-batch', requireAuth, withDB(async (req, res) => {
    const { reference_ids } = req.body;
    if (!Array.isArray(reference_ids) || reference_ids.length === 0) {
        return res.json({ updated: [], count: 0 });
    }

    const ids = reference_ids.slice(0, 10);
    try {
        const result = await pool.query(
            `SELECT * FROM deposits WHERE reference_id = ANY($1) AND user_id = $2 AND status = 'pending'`,
            [ids, req.user.id]
        );

        const updated = [];
        const chunks = [];
        for (let i = 0; i < result.rows.length; i += 5) {
            chunks.push(result.rows.slice(i, i + 5));
        }

        for (const chunk of chunks) {
            const results = await Promise.all(chunk.map(d => syncDepositStatus(d).catch(err => d)));
            for (const fresh of results) {
                if (fresh.status !== 'pending') updated.push(sanitizeDepositForUser(fresh));
            }
        }

        res.json({ updated, count: updated.length });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

// webhook depo1 (QRIS)
app.post('/api/webhook/depo1', withDB(async (req, res) => {
    let signatureValid = false;
    try {
        const signature = req.headers['x-depo1-signature'];
        if (!signature) {
            await logWebhookEvent({ source: 'depo1', signatureValid: false, req, payload: req.body, processed: false, processNote: 'NO_SIGNATURE' });
            return res.status(401).json({ error: 'No signature' });
        }
        if (!QRISPY_WEBHOOK_SECRET) {
            await logWebhookEvent({ source: 'depo1', signatureValid: false, req, payload: req.body, processed: false, processNote: 'NO_SECRET' });
            return res.status(500).json({ error: 'Webhook secret not configured' });
        }

        const expectedSignature = crypto
            .createHmac('sha256', QRISPY_WEBHOOK_SECRET)
            .update(req.rawBody || JSON.stringify(req.body))
            .digest('hex');

        const sigBuffer = Buffer.from(signature, 'hex');
        const expectedBuffer = Buffer.from(expectedSignature, 'hex');

        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            await logWebhookEvent({ source: 'depo1', signatureValid: false, req, payload: req.body, processed: false, processNote: 'INVALID_SIGNATURE' });
            return res.status(401).json({ error: 'Invalid signature' });
        }
        signatureValid = true;

        const { event, data } = req.body || {};

        if (event === 'payment.received') {
            const { qris_id, amount, received_amount, payment_reference, paid_at } = data || {};

            const result = await pool.query(
                `SELECT * FROM deposits WHERE qris_id = $1 OR reference_id = $2 OR payment_reference = $2 LIMIT 1`,
                [qris_id, payment_reference]
            );

            if (result.rows.length === 0) {
                await logWebhookEvent({ source: 'depo1', eventType: event, signatureValid: true, req, payload: req.body, processed: false, processNote: 'DEPOSIT_NOT_FOUND' });
                return res.json({ status: 'ok', message: 'Deposit not found' });
            }

            const deposit = result.rows[0];
            const markResult = await markDepositPaid(deposit, received_amount || amount, paid_at);

            if (markResult.alreadyProcessed) {
                await logWebhookEvent({ source: 'depo1', eventType: event, signatureValid: true, req, payload: req.body, processed: true, processNote: 'ALREADY_PROCESSED', relatedEntityType: 'deposit', relatedEntityId: deposit.reference_id });
                return res.json({ status: 'ok', message: 'Already processed' });
            }

            if (markResult.freshDeposit) {
                try {
                    await notifyDepositSuccess(
                        markResult.freshDeposit,
                        markResult.saldoMasuk,
                        markResult.totalBayar,
                        markResult.fee,
                        markResult.userData
                    );
                } catch (err) {
                    console.error('❌ Notif deposit error:', err.message);
                }
            }

            await logWebhookEvent({ source: 'depo1', eventType: event, signatureValid: true, req, payload: req.body, processed: true, processNote: 'DEPOSIT_MARKED_PAID', relatedEntityType: 'deposit', relatedEntityId: deposit.reference_id });
        } else {
            await logWebhookEvent({ source: 'depo1', eventType: event || 'unknown', signatureValid: true, req, payload: req.body, processed: true, processNote: 'EVENT_IGNORED' });
        }

        res.json({ status: 'ok' });
    } catch (err) {
        console.error('Webhook error:', err.message);
        await logWebhookEvent({ source: 'depo1', signatureValid, req, payload: req.body, processed: false, processNote: 'ERROR: ' + err.message }).catch(() => {});
        res.status(500).json({ error: 'Server error' });
    }
}));

// webhook otp1 (server1)
app.post('/api/webhook/otp1', withDB(async (req, res) => {
    let signatureValid = false;
    try {
        if (!WEBHOOK_OTP1_SECRET) {
            await logWebhookEvent({ source: 'otp1', signatureValid: false, req, payload: req.body, processed: false, processNote: 'NO_SECRET' });
            return res.status(500).json({ error: 'Webhook secret not configured' });
        }

        const signature = req.headers['x-server1-signature'] || req.headers['x-otp1-signature'];
        if (!signature) {
            await logWebhookEvent({ source: 'otp1', signatureValid: false, req, payload: req.body, processed: false, processNote: 'NO_SIGNATURE' });
            return res.status(401).json({ error: 'No signature' });
        }

        const rawBody = req.rawBody || JSON.stringify(req.body);
        const expectedSig = 'sha256=' + crypto
            .createHmac('sha256', WEBHOOK_OTP1_SECRET)
            .update(rawBody)
            .digest('hex');

        const sigBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expectedSig);
        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            await logWebhookEvent({ source: 'otp1', signatureValid: false, req, payload: req.body, processed: false, processNote: 'INVALID_SIGNATURE' });
            return res.status(401).json({ error: 'Invalid signature' });
        }
        signatureValid = true;

        const data = req.body;
        console.log('📥 Webhook OTP1:', JSON.stringify({
            order_id: data.order_id || data.orderId || data.reference,
            has_otp: !!(data.otp_code || data.otpCode || data.code || data.otp),
            has_sms: !!(data.full_sms || data.fullSms || data.message),
        }));

        const providerOrderId = data.order_id || data.orderId || data.reference;
        const otpCode = data.otp_code || data.otpCode || data.code || data.otp;
        const fullSms = data.full_sms || data.fullSms || data.message || data.sms || '';
        const otpCode2 = data.otp_code_2 || data.otpCode2 || null;

        if (!providerOrderId) {
            await logWebhookEvent({ source: 'otp1', eventType: 'otp', signatureValid: true, req, payload: req.body, processed: false, processNote: 'MISSING_ORDER_ID' });
            return res.status(400).json({ error: 'Missing order_id' });
        }

        const orderRes = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [String(providerOrderId)]);
        if (orderRes.rows.length === 0) {
            await logWebhookEvent({ source: 'otp1', eventType: 'otp', signatureValid: true, req, payload: req.body, processed: false, processNote: 'ORDER_NOT_FOUND', relatedEntityType: 'order', relatedEntityId: providerOrderId });
            return res.json({ status: 'ok', message: 'Order not found' });
        }

        const order = orderRes.rows[0];
        const isRevivable = ['cancelled', 'refunded', 'expired', 'failed'].includes(order.status);
        let revived = false;

        if (isRevivable && otpCode) {
            const orderAge = Date.now() - new Date(order.created_at).getTime();
            if (orderAge <= REVIVE_GRACE_PERIOD_MS) {
                if (order.refunded_at && Number(order.refunded_at) > 0) {
                    const refundAmount = Number(order.refunded_amount) || Number(order.price);

                    const client = await pool.connect();
                    try {
                        await client.query('BEGIN');

                        const deductRes = await client.query(
                            `UPDATE users SET balance = balance - $1, updated_at = NOW() 
                             WHERE id = $2 AND balance >= $1
                             RETURNING balance`,
                            [refundAmount, order.user_id]
                        );

                        if (deductRes.rowCount === 0) {
                            await client.query('ROLLBACK');
                            console.error(`⚠️ Revive gagal: saldo user ${order.user_id} tidak cukup untuk potong ${refundAmount}`);
                        } else {
                            await client.query(
                                `UPDATE orders 
                                 SET status = 'received',
                                     otp_code = $1,
                                     otp_code_2 = $2,
                                     full_sms = $3,
                                     received_at = NOW(),
                                     refunded_at = NULL,
                                     refunded_amount = NULL,
                                     refund_reason = 'revived_by_webhook',
                                     revived_at = NOW(),
                                     revived_count = COALESCE(revived_count, 0) + 1,
                                     updated_at = NOW()
                                 WHERE id = $4`,
                                [otpCode, otpCode2, fullSms, order.id]
                            );

                            await client.query(
                                `UPDATE transactions SET status = 'success', otp_code = $1, updated_at = NOW() WHERE order_id = $2`,
                                [otpCode, String(order.order_id)]
                            );

                            await client.query(
                                `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
                                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                                ['order', String(order.order_id), order.user_id, order.status, 'received', 'webhook_revive',
                                 JSON.stringify({ otp_code: otpCode, refunded_balance_deducted: refundAmount, revived: true })]
                            );

                            await client.query('COMMIT');
                            revived = true;
                            console.log(`🔄 Order ${order.order_id} revived via webhook`);
                        }
                    } catch (err) {
                        await client.query('ROLLBACK');
                        console.error('Revive error:', err.message);
                    } finally {
                        client.release();
                    }
                } else {
                    await pool.query(
                        `UPDATE orders 
                         SET status = 'received',
                             otp_code = $1,
                             otp_code_2 = $2,
                             full_sms = $3,
                             received_at = NOW(),
                             revived_at = NOW(),
                             revived_count = COALESCE(revived_count, 0) + 1,
                             updated_at = NOW()
                         WHERE id = $4`,
                        [otpCode, otpCode2, fullSms, order.id]
                    );

                    await pool.query(
                        `UPDATE transactions SET status = 'success', otp_code = $1, updated_at = NOW() WHERE order_id = $2`,
                        [otpCode, String(order.order_id)]
                    );

                    await logStatusChange({
                        entityType: 'order', entityId: String(order.order_id), userId: order.user_id,
                        oldStatus: order.status, newStatus: 'received', reason: 'webhook_revive',
                        metadata: { otp_code: otpCode, revived: true },
                    });

                    revived = true;
                    console.log(`🔄 Order ${order.order_id} revived (no refund)`);
                }
            }
        }

        if (!revived) {
            const updateFields = [];
            const updateParams = [];

            if (otpCode) { updateFields.push(`otp_code = $${updateParams.length + 1}`); updateParams.push(otpCode); }
            if (otpCode2) { updateFields.push(`otp_code_2 = $${updateParams.length + 1}`); updateParams.push(otpCode2); }
            if (fullSms) { updateFields.push(`full_sms = $${updateParams.length + 1}`); updateParams.push(fullSms); }

            updateFields.push(`status = $${updateParams.length + 1}`);
            updateParams.push('received');
            updateFields.push(`received_at = NOW()`);
            updateFields.push(`updated_at = NOW()`);
            updateParams.push(order.id);

            await pool.query(
                `UPDATE orders SET ${updateFields.join(', ')} WHERE id = $${updateParams.length}`,
                updateParams
            );

            await pool.query(
                `UPDATE transactions SET status = 'success', otp_code = $1, updated_at = NOW() WHERE order_id = $2`,
                [otpCode || null, String(order.order_id)]
            );

            await logStatusChange({
                entityType: 'order', entityId: String(order.order_id), userId: order.user_id,
                oldStatus: order.status, newStatus: 'received', reason: 'webhook_otp1',
                metadata: { otp_code: otpCode || null, otp_code_2: otpCode2 || null, has_full_sms: !!fullSms, otp_id: order.otp_id },
            });
        }

        if (otpCode) {
            try {
                const freshOrderRes = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [order.id]);
                if (freshOrderRes.rows[0]) {
                    const user = await fetchUserForOrder(freshOrderRes.rows[0]);
                    await notifyOtpSuccess(freshOrderRes.rows[0], user);
                }
            } catch (err) {
                console.error('❌ Notif OTP error:', err.message);
            }
        }

        await logWebhookEvent({ source: 'otp1', eventType: 'otp', signatureValid: true, req, payload: req.body, processed: true, processNote: revived ? 'REVIVED' : 'OTP_UPDATED', relatedEntityType: 'order', relatedEntityId: providerOrderId });

        res.status(200).json({ status: 'ok', message: 'received', revived });
    } catch (err) {
        console.error('Webhook OTP1 error:', err.message);
        await logWebhookEvent({ source: 'otp1', signatureValid, req, payload: req.body, processed: false, processNote: 'ERROR: ' + err.message }).catch(() => {});
        res.status(500).json({ error: 'Server error' });
    }
}));

// webhook otp2 (server2). header x-webhook-signature = "sha256={HMAC(body, secret)}"
app.post('/api/webhook/otp2', withDB(async (req, res) => {
    let signatureValid = false;
    try {
        if (!PREMIUM_WEBHOOK_SECRET) {
            await logWebhookEvent({ source: 'otp2', signatureValid: false, req, payload: req.body, processed: false, processNote: 'NO_SECRET' });
            return res.status(500).json({ error: 'Webhook secret not configured' });
        }

        const signature = req.headers['x-webhook-signature'];
        if (!signature) {
            await logWebhookEvent({ source: 'otp2', signatureValid: false, req, payload: req.body, processed: false, processNote: 'NO_SIGNATURE' });
            return res.status(401).json({ error: 'No signature' });
        }

        const rawBody = req.rawBody || JSON.stringify(req.body);
        const expectedSig = 'sha256=' + crypto
            .createHmac('sha256', PREMIUM_WEBHOOK_SECRET)
            .update(rawBody)
            .digest('hex');

        const sigBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expectedSig);
        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            await logWebhookEvent({ source: 'otp2', signatureValid: false, req, payload: req.body, processed: false, processNote: 'INVALID_SIGNATURE' });
            return res.status(401).json({ error: 'Invalid signature' });
        }
        signatureValid = true;

        const { event, data } = req.body || {};
        if (!data || !data.order_id) {
            await logWebhookEvent({ source: 'otp2', eventType: event, signatureValid: true, req, payload: req.body, processed: false, processNote: 'MISSING_ORDER_ID' });
            return res.status(400).json({ error: 'Missing order_id' });
        }

        const providerOrderId = String(data.order_id);
        const orderRes = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [providerOrderId]);
        if (orderRes.rows.length === 0) {
            await logWebhookEvent({ source: 'otp2', eventType: event, signatureValid: true, req, payload: req.body, processed: false, processNote: 'ORDER_NOT_FOUND', relatedEntityType: 'order', relatedEntityId: providerOrderId });
            return res.json({ status: 'ok', message: 'Order not found' });
        }

        const order = orderRes.rows[0];
        const otpCode = data.otp_code || null;
        const fullSms = data.otp_message || null;

        // otp received
        if (event === 'order.otp_received' && (otpCode || fullSms)) {
            const isRevivable = ['cancelled', 'refunded', 'expired', 'failed'].includes(order.status);
            let revived = false;

            if (isRevivable && otpCode) {
                const orderAge = Date.now() - new Date(order.created_at).getTime();
                if (orderAge <= REVIVE_GRACE_PERIOD_MS) {
                    if (order.refunded_at && Number(order.refunded_at) > 0) {
                        const refundAmount = Number(order.refunded_amount) || Number(order.price);
                        const client = await pool.connect();
                        try {
                            await client.query('BEGIN');
                            const deductRes = await client.query(
                                `UPDATE users SET balance = balance - $1, updated_at = NOW()
                                 WHERE id = $2 AND balance >= $1 RETURNING balance`,
                                [refundAmount, order.user_id]
                            );
                            if (deductRes.rowCount === 0) {
                                await client.query('ROLLBACK');
                                console.error(`⚠️ Revive gagal: saldo user ${order.user_id} tidak cukup`);
                            } else {
                                await client.query(
                                    `UPDATE orders 
                                     SET status = 'received', otp_code = $1, full_sms = $2,
                                         received_at = NOW(), refunded_at = NULL, refunded_amount = NULL,
                                         refund_reason = 'revived_by_webhook',
                                         revived_at = NOW(), revived_count = COALESCE(revived_count, 0) + 1,
                                         updated_at = NOW()
                                     WHERE id = $3`,
                                    [otpCode, fullSms, order.id]
                                );
                                await client.query(
                                    `UPDATE transactions SET status = 'success', otp_code = $1, updated_at = NOW() WHERE order_id = $2`,
                                    [otpCode, String(order.order_id)]
                                );
                                await client.query(
                                    `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
                                     VALUES ('order', $1, $2, $3, 'received', 'webhook_revive', $4)`,
                                    [String(order.order_id), order.user_id, order.status,
                                     JSON.stringify({ otp_code: otpCode, refunded_balance_deducted: refundAmount, revived: true })]
                                );
                                await client.query('COMMIT');
                                revived = true;
                                console.log(`🔄 Order ${order.order_id} revived via webhook (server2)`);
                            }
                        } catch (err) {
                            await client.query('ROLLBACK').catch(() => {});
                            console.error('Revive error:', err.message);
                        } finally {
                            client.release();
                        }
                    } else {
                        await pool.query(
                            `UPDATE orders 
                             SET status = 'received', otp_code = $1, full_sms = $2,
                                 received_at = NOW(), revived_at = NOW(),
                                 revived_count = COALESCE(revived_count, 0) + 1, updated_at = NOW()
                             WHERE id = $3`,
                            [otpCode, fullSms, order.id]
                        );
                        await pool.query(
                            `UPDATE transactions SET status = 'success', otp_code = $1, updated_at = NOW() WHERE order_id = $2`,
                            [otpCode, String(order.order_id)]
                        );
                        await logStatusChange({
                            entityType: 'order', entityId: String(order.order_id), userId: order.user_id,
                            oldStatus: order.status, newStatus: 'received', reason: 'webhook_revive',
                            metadata: { otp_code: otpCode, revived: true },
                        });
                        revived = true;
                        console.log(`🔄 Order ${order.order_id} revived (no refund)`);
                    }
                }
            }

            if (!revived) {
                const updateFields = [];
                const updateParams = [];

                if (otpCode) { updateFields.push(`otp_code = $${updateParams.length + 1}`); updateParams.push(otpCode); }
                if (fullSms) { updateFields.push(`full_sms = $${updateParams.length + 1}`); updateParams.push(fullSms); }

                updateFields.push(`status = $${updateParams.length + 1}`);
                updateParams.push('received');
                updateFields.push(`received_at = NOW()`);
                updateFields.push(`updated_at = NOW()`);
                updateParams.push(order.id);

                await pool.query(
                    `UPDATE orders SET ${updateFields.join(', ')} WHERE id = $${updateParams.length}`,
                    updateParams
                );

                await pool.query(
                    `UPDATE transactions SET status = 'success', otp_code = $1, updated_at = NOW() WHERE order_id = $2`,
                    [otpCode || null, String(order.order_id)]
                );

                await logStatusChange({
                    entityType: 'order', entityId: String(order.order_id), userId: order.user_id,
                    oldStatus: order.status, newStatus: 'received', reason: 'webhook_otp2',
                    metadata: { otp_code: otpCode || null, has_full_sms: !!fullSms, sms_revision: data.sms_revision || null, otp_id: order.otp_id },
                });
            }

            if (otpCode) {
                try {
                    const freshOrderRes = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [order.id]);
                    if (freshOrderRes.rows[0]) {
                        const user = await fetchUserForOrder(freshOrderRes.rows[0]);
                        await notifyOtpSuccess(freshOrderRes.rows[0], user);
                    }
                } catch (err) {
                    console.error('❌ Notif OTP (otp2) error:', err.message);
                }
            }

            await logWebhookEvent({ source: 'otp2', eventType: event, signatureValid: true, req, payload: req.body, processed: true, processNote: revived ? 'REVIVED' : 'OTP_UPDATED', relatedEntityType: 'order', relatedEntityId: providerOrderId });
            return res.status(200).json({ status: 'ok', message: 'received', revived });
        }

        // completed
        if (event === 'order.completed') {
            if (order.status !== 'success' && order.status !== 'received') {
                await pool.query(
                    `UPDATE orders SET status = 'success', updated_at = NOW() WHERE id = $1`,
                    [order.id]
                );
                await logStatusChange({
                    entityType: 'order', entityId: String(order.order_id), userId: order.user_id,
                    oldStatus: order.status, newStatus: 'success', reason: 'webhook_otp2_completed',
                    metadata: { otp_id: order.otp_id },
                });
            }
            await logWebhookEvent({ source: 'otp2', eventType: event, signatureValid: true, req, payload: req.body, processed: true, processNote: 'ORDER_COMPLETED', relatedEntityType: 'order', relatedEntityId: providerOrderId });
            return res.json({ status: 'ok' });
        }

        // expired
        if (event === 'order.expired') {
            if (!['expired', 'refunded'].includes(order.status)) {
                await pool.query(
                    `UPDATE orders SET status = 'expired', updated_at = NOW() WHERE id = $1`,
                    [order.id]
                );
                await pool.query(
                    `UPDATE transactions SET status = 'failed', updated_at = NOW() WHERE order_id = $1`,
                    [String(order.order_id)]
                );
                const fresh = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [order.id]);
                if (fresh.rows[0]) await refundOrder(fresh.rows[0], 'provider_expired');
                await logStatusChange({
                    entityType: 'order', entityId: String(order.order_id), userId: order.user_id,
                    oldStatus: order.status, newStatus: 'expired', reason: 'webhook_otp2_expired',
                    metadata: { otp_id: order.otp_id },
                });
            }
            await logWebhookEvent({ source: 'otp2', eventType: event, signatureValid: true, req, payload: req.body, processed: true, processNote: 'ORDER_EXPIRED', relatedEntityType: 'order', relatedEntityId: providerOrderId });
            return res.json({ status: 'ok' });
        }

        // canceled
        if (event === 'order.canceled') {
            if (!['cancelled', 'refunded'].includes(order.status)) {
                await pool.query(
                    `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
                    [order.id]
                );
                await pool.query(
                    `UPDATE transactions SET status = 'failed', updated_at = NOW() WHERE order_id = $1`,
                    [String(order.order_id)]
                );
                const fresh = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [order.id]);
                if (fresh.rows[0]) await refundOrder(fresh.rows[0], 'provider_cancelled');
                await logStatusChange({
                    entityType: 'order', entityId: String(order.order_id), userId: order.user_id,
                    oldStatus: order.status, newStatus: 'cancelled', reason: 'webhook_otp2_cancelled',
                    metadata: { otp_id: order.otp_id },
                });
            }
            await logWebhookEvent({ source: 'otp2', eventType: event, signatureValid: true, req, payload: req.body, processed: true, processNote: 'ORDER_CANCELLED', relatedEntityType: 'order', relatedEntityId: providerOrderId });
            return res.json({ status: 'ok' });
        }

        await logWebhookEvent({ source: 'otp2', eventType: event || 'unknown', signatureValid: true, req, payload: req.body, processed: true, processNote: 'EVENT_IGNORED' });
        res.json({ status: 'ok' });

    } catch (err) {
        console.error('Webhook OTP2 error:', err.message);
        await logWebhookEvent({ source: 'otp2', signatureValid, req, payload: req.body, processed: false, processNote: 'ERROR: ' + err.message }).catch(() => {});
        res.status(500).json({ error: 'Server error' });
    }
}));

// cek OTP. terima order_id atau otp_id
app.post('/api/cekotp', requireAuth, userRateLimit(60, 60 * 1000), withDB(async (req, res) => {
    const { order_id, otp_id } = req.body;
    if (!order_id && !otp_id) return res.status(400).json({ error: 'order_id atau otp_id wajib' });

    try {
        let query, params;
        if (otp_id) {
            query = 'SELECT * FROM orders WHERE otp_id = $1 AND user_id = $2 LIMIT 1';
            params = [otp_id, req.user.id];
        } else {
            query = 'SELECT * FROM orders WHERE order_id = $1 AND user_id = $2 LIMIT 1';
            params = [String(order_id), req.user.id];
        }

        const orderRes = await pool.query(query, params);
        if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order tidak ditemukan' });

        const order = orderRes.rows[0];

        if (['received', 'success', 'confirmed', 'cancelled', 'failed', 'expired', 'refunded'].includes(order.status)) {
            return res.json({
                order_id: order.order_id, otp_id: order.otp_id,
                status: order.status, phone_number: order.phone_number,
                otp_code: order.otp_code, otp_code_2: order.otp_code_2,
                full_sms: order.full_sms, price_idr: order.price,
                service: order.service, service_name: order.service_name,
                icon_code: order.icon_code,
                country: order.country, country_name: order.country_name,
                operator: order.operator,
                server: order.server,
                received_at: order.received_at, expires_in: 0, expired_at: order.expired_at,
                refunded_at: order.refunded_at, refunded_amount: order.refunded_amount,
                refund_reason: order.refund_reason,
            });
        }

        if (order.expired_at && new Date(order.expired_at) < new Date()) {
            const cancelResult = await autoCancelAndRefund(order);
            const fresh = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [order.id]);
            const o = fresh.rows[0] || order;

            return res.json({
                order_id: o.order_id, otp_id: o.otp_id,
                status: o.status, phone_number: o.phone_number,
                otp_code: o.otp_code, otp_code_2: o.otp_code_2,
                full_sms: o.full_sms, price_idr: o.price,
                service: o.service, service_name: o.service_name,
                icon_code: o.icon_code,
                country: o.country, country_name: o.country_name,
                operator: o.operator,
                server: o.server,
                expired_at: o.expired_at, refunded: cancelResult.refunded,
                refunded_amount: cancelResult.refundedAmount, expires_in: 0,
                refunded_at: o.refunded_at, refund_reason: o.refund_reason,
            });
        }

        try {
            const data = await providerOrderStatus(order);
            await pool.query(`UPDATE orders SET last_checked_at = NOW(), last_synced_at = NOW() WHERE id = $1`, [order.id]);

            if (data.status !== order.status || data.otp_code) {
                await pool.query(
                    `UPDATE orders 
                     SET status = $1, otp_code = $2, otp_code_2 = $3, full_sms = $4, 
                         received_at = CASE WHEN $1 IN ('received', 'success') THEN NOW() ELSE received_at END, 
                         updated_at = NOW() 
                     WHERE order_id = $5`,
                    [data.status, data.otp_code, data.otp_code_2, data.full_sms, String(order.order_id)]
                );
                await pool.query(
                    `UPDATE transactions 
                     SET status = CASE 
                        WHEN $1 IN ('received', 'success') THEN 'success' 
                        WHEN $1 IN ('cancelled', 'expired', 'refunded') THEN 'failed' 
                        ELSE status 
                     END, 
                     otp_code = $2, updated_at = NOW() 
                     WHERE order_id = $3`,
                    [data.status, data.otp_code, String(order.order_id)]
                );

                if (data.status !== order.status) {
                    await logStatusChange({
                        entityType: 'order', entityId: String(order.order_id), userId: order.user_id,
                        oldStatus: order.status, newStatus: data.status, reason: 'polling_provider',
                        metadata: { otp_code: data.otp_code || null, otp_id: order.otp_id },
                    });
                }

                if (['cancelled', 'expired', 'refunded'].includes(data.status)) {
                    const fresh = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [order.order_id]);
                    if (fresh.rows[0]) await refundOrder(fresh.rows[0], 'provider_' + data.status);
                }

                const fresh = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [order.order_id]);

                if (fresh.rows[0] && data.otp_code && ['received', 'success', 'confirmed'].includes(data.status)) {
                    try {
                        const user = await fetchUserForOrder(fresh.rows[0]);
                        await notifyOtpSuccess(fresh.rows[0], user);
                    } catch (err) {
                        console.error('❌ Notif OTP (cekotp) error:', err.message);
                    }
                }

                return res.json({
                    order_id: fresh.rows[0].order_id, otp_id: fresh.rows[0].otp_id,
                    status: fresh.rows[0].status, phone_number: fresh.rows[0].phone_number,
                    otp_code: fresh.rows[0].otp_code, otp_code_2: fresh.rows[0].otp_code_2,
                    full_sms: fresh.rows[0].full_sms, price_idr: fresh.rows[0].price,
                    service: fresh.rows[0].service, service_name: fresh.rows[0].service_name,
                    icon_code: fresh.rows[0].icon_code,
                    country: fresh.rows[0].country, country_name: fresh.rows[0].country_name,
                    operator: fresh.rows[0].operator,
                    server: fresh.rows[0].server,
                    received_at: fresh.rows[0].received_at,
                    expires_in: fresh.rows[0].expired_at ? Math.max(0, Math.floor((new Date(fresh.rows[0].expired_at) - Date.now()) / 1000)) : 0,
                    expired_at: fresh.rows[0].expired_at, updated: true,
                    refunded_at: fresh.rows[0].refunded_at,
                    refunded_amount: fresh.rows[0].refunded_amount,
                    refund_reason: fresh.rows[0].refund_reason,
                });
            }

            res.json({
                order_id: order.order_id, otp_id: order.otp_id,
                status: order.status, phone_number: order.phone_number,
                otp_code: order.otp_code, otp_code_2: order.otp_code_2,
                full_sms: order.full_sms, price_idr: order.price,
                service: order.service, service_name: order.service_name,
                icon_code: order.icon_code,
                country: order.country, country_name: order.country_name,
                operator: order.operator,
                server: order.server,
                received_at: order.received_at,
                expires_in: order.expired_at ? Math.max(0, Math.floor((new Date(order.expired_at) - Date.now()) / 1000)) : 0,
                expired_at: order.expired_at, updated: false,
                refunded_at: order.refunded_at,
                refunded_amount: order.refunded_amount,
                refund_reason: order.refund_reason,
            });
        } catch (err) {
            console.error('Polling provider error:', err.message);
            res.json({
                order_id: order.order_id, otp_id: order.otp_id,
                status: order.status, phone_number: order.phone_number,
                otp_code: order.otp_code, otp_code_2: order.otp_code_2,
                full_sms: order.full_sms, price_idr: order.price,
                service: order.service, service_name: order.service_name,
                icon_code: order.icon_code,
                country: order.country, country_name: order.country_name,
                operator: order.operator,
                server: order.server,
                received_at: order.received_at,
                expires_in: order.expired_at ? Math.max(0, Math.floor((new Date(order.expired_at) - Date.now()) / 1000)) : 0,
                expired_at: order.expired_at, updated: false,
                error: 'Provider ga bisa dihubungi, coba lagi',
                refunded_at: order.refunded_at,
                refunded_amount: order.refunded_amount,
                refund_reason: order.refund_reason,
            });
        }
    } catch (err) {
        console.error('CekOTP error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// nokos stats / check refunds
app.post('/api/nokos/check-refunds', requireAuth, userRateLimit(10, 60 * 1000), withDB(async (req, res) => {
    try {
        const refunded = await checkAndRefundUserOrders(req.user.id);
        const userRes = await pool.query('SELECT balance FROM users WHERE id = $1 LIMIT 1', [req.user.id]);
        res.json({
            refunded,
            count: refunded.length,
            new_balance: userRes.rows[0] ? Number(userRes.rows[0].balance) : null,
        });
    } catch (err) {
        console.error('Check refunds error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.get('/api/nokos/orders/stats', requireAuth, withDB(async (req, res) => {
    try {
        const [ordersResult, depositsResult] = await Promise.all([
            pool.query(
                `SELECT 
                    COUNT(*) as all_count,
                    COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
                    COUNT(*) FILTER (WHERE status IN ('success', 'received', 'confirmed')) as success_count,
                    COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
                    COUNT(*) FILTER (WHERE status = 'expired') as expired_count,
                    COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count
                 FROM orders WHERE user_id = $1`,
                [req.user.id]
            ),
            pool.query('SELECT COUNT(*) FROM deposits WHERE user_id = $1', [req.user.id])
        ]);

        const row = ordersResult.rows[0] || {};
        const nokos = Number(row.all_count || 0);
        const deposit = Number(depositsResult.rows[0]?.count || 0);
        res.json({
            all: nokos + deposit,
            nokos,
            deposit,
            pending: Number(row.pending_count || 0),
            success: Number(row.success_count || 0),
            failed: Number(row.failed_count || 0),
            expired: Number(row.expired_count || 0),
            cancelled: Number(row.cancelled_count || 0),
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.get('/api/status-logs', requireAuth, withDB(async (req, res) => {
    const { entity_type, entity_id, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    try {
        const conditions = ['user_id = $1'];
        const baseParams = [req.user.id];

        if (entity_type) {
            conditions.push(`entity_type = $${baseParams.length + 1}`);
            baseParams.push(entity_type);
        }
        if (entity_id) {
            conditions.push(`entity_id = $${baseParams.length + 1}`);
            baseParams.push(String(entity_id));
        }

        const whereClause = conditions.join(' AND ');

        const [result, countRes] = await Promise.all([
            pool.query(
                `SELECT * FROM status_logs WHERE ${whereClause} 
                 ORDER BY created_at DESC LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}`,
                [...baseParams, limitNum, offset]
            ),
            pool.query(`SELECT COUNT(*) FROM status_logs WHERE ${whereClause}`, baseParams),
        ]);

        res.json({
            logs: result.rows,
            total: Number(countRes.rows[0].count),
            page: pageNum,
            limit: limitNum,
        });
    } catch (err) {
        console.error('Get status logs error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// nokos — servers, services, countries
app.get('/api/nokos/servers', requireAuth, (req, res) => {
    res.json({ servers: SERVERS_LIST });
});

app.get('/api/nokos/services', requireAuth, withDB(async (req, res) => {
    const { server = 'ekonomi' } = req.query;
    if (!SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });

    const cacheKey = `services_${server}`;
    const cached = cacheGet(cacheKey);
    if (cached) { res.set('X-Cache', 'HIT'); return res.json(cached); }

    try {
        let services = [];

        if (server === 'ekonomi') {
            const data = await dibananaFetch(`/services?server=ekonomi`);
            services = await enrichServicesWithCode(data.services || [], 'ekonomi');
            services = services.map(s => s.price_idr
                ? { ...s, price_idr: applyMarkup(Number(s.price_idr)) }
                : s);

        } else if (server === 'premium') {
            const raw = await premiumFetch('/catalog/services');
            services = (raw || []).map(s => {
                const code = String(s.code || '').trim().toLowerCase();
                return {
                    code,
                    name: s.name || code,
                    icon_code: code || null,
                    active: s.active !== false,
                };
            });
        }

        const response = { server, services };
        cacheSet(cacheKey, response, 5 * 60 * 1000);
        res.set('X-Cache', 'MISS');
        res.json(response);
    } catch (err) {
        console.error('Get services error:', err.message);
        const isClientErr = err.status && err.status >= 400 && err.status < 500;
        res.status(isClientErr ? err.status : 500).json({
            error: isClientErr ? err.message : 'Server error',
            code: isClientErr ? err.code : undefined,
        });
    }
}));

app.get('/api/nokos/countries', requireAuth, withDB(async (req, res) => {
    const { server = 'ekonomi', service } = req.query;
    if (!SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });

    const cacheKey = `countries_${server}_${service || 'all'}`;
    const cached = cacheGet(cacheKey);
    if (cached) { res.set('X-Cache', 'HIT'); return res.json(cached); }

    try {
        let countries = [];

        if (server === 'ekonomi') {
            try {
                const params = new URLSearchParams({ server: 'ekonomi' });
                if (service) params.append('service', service);
                const data = await dibananaFetch(`/countries?${params.toString()}`);
                if (data.countries) {
                    const response = {
                        server,
                        countries: data.countries.map(c => ({
                            ...c,
                            min_price: c.min_price != null && Number(c.min_price) > 0
                                ? applyMarkup(Number(c.min_price))
                                : null,
                        })),
                    };
                    cacheSet(cacheKey, response, 5 * 60 * 1000);
                    res.set('X-Cache', 'MISS');
                    return res.json(response);
                }
            } catch (e) { /* fallback */ }
            countries = (SERVER_CONFIG.ekonomi.countries || []).map(c => ({
                code: c,
                name: COUNTRY_NAMES[c] || c.toUpperCase(),
                min_price: null,
            }));

        } else if (server === 'premium') {
            const countriesKey = 'smscode_countries_raw';
            const servicesKey = 'smscode_services_raw';

            let rawCountries = cacheGet(countriesKey);
            let rawServices = cacheGet(servicesKey);

            const needFetch = [];
            if (!rawCountries) needFetch.push(
                premiumFetchPublic('/catalog/countries').then(d => {
                    rawCountries = d;
                    cacheSet(countriesKey, d, 30 * 60 * 1000);
                })
            );
            if (!rawServices) needFetch.push(
                premiumFetchPublic('/catalog/services').then(d => {
                    rawServices = d;
                    cacheSet(servicesKey, d, 30 * 60 * 1000);
                })
            );
            if (needFetch.length > 0) await Promise.allSettled(needFetch);

            const list = (rawCountries || []).map(c => ({
                code: String(c.code || '').toLowerCase(),
                name: c.name || c.code,
                dial_code: c.dial_code || null,
                emoji: c.emoji || null,
                _id: c.id,
            }));

            let minPriceByCountry = {};
            if (service) {
                const serviceObj = (rawServices || []).find(
                    s => String(s.code).toLowerCase() === String(service).toLowerCase()
                );
                if (serviceObj) {
                    try {
                        const params = new URLSearchParams({
                            platform_id: String(serviceObj.id),
                            limit: '10000',
                            page: '1',
                            sort: 'price_asc',
                        });
                        const productsRaw = await premiumFetchPublic(`/catalog/products?${params.toString()}`);
                        const products = (productsRaw || []).filter(p => p.active !== false);
                        for (const p of products) {
                            if (p.country_id == null) continue;
                            const price = Number(p.price) || 0;
                            if (price <= 0) continue;
                            const cid = String(p.country_id);
                            if (!minPriceByCountry[cid] || price < minPriceByCountry[cid]) {
                                minPriceByCountry[cid] = price;
                            }
                        }
                    } catch (e) {
                        console.warn('premium min price fetch error:', e.message);
                    }
                }
            }

            countries = list.map(c => {
                const rawMin = minPriceByCountry[String(c._id)];
                const minPrice = (rawMin != null && rawMin > 0)
                    ? applyMarkup(rawMin)
                    : null;
                return {
                    code: c.code,
                    name: c.name,
                    dial_code: c.dial_code,
                    emoji: c.emoji,
                    min_price: minPrice,
                };
            });
        }

        const response = { server, countries };
        if (countries.length > 0) {
            cacheSet(cacheKey, response, server === 'premium' ? 2 * 60 * 1000 : 5 * 60 * 1000);
        }
        res.set('X-Cache', 'MISS');
        res.json(response);
    } catch (err) {
        console.error('Countries error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));
app.get('/api/nokos/prices', requireAuth, withDB(async (req, res) => {
    const { server = 'ekonomi', service, country } = req.query;
    if (!SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });
    if (!service || !country) return res.status(400).json({ error: 'Service dan country wajib' });

    const cacheKey = `prices_${server}_${service}_${country}`;
    const cached = cacheGet(cacheKey);
    if (cached) { res.set('X-Cache', 'HIT'); return res.json(cached); }

    try {
        let providers = [];

        if (server === 'ekonomi') {
            const data = await dibananaFetch(
                `/prices?server=ekonomi&service=${encodeURIComponent(service)}&country=${encodeURIComponent(country)}`
            );
            providers = (data.providers || []).map(p => {
                const providerPrice = Number(p.price_idr) || 0;
                const sellPrice = applyMarkup(providerPrice);
                const providerId = String(p.id || p.provider_id || '').trim();
                if (providerId && sellPrice > 0) {
                    setPriceLock(providerId, sellPrice, providerPrice, {
                        server, service, country, provider: 'server1',
                    });
                }
                return { ...p, price_idr: sellPrice, _provider_price: providerPrice };
            });

        } else if (server === 'premium') {
            const [countriesRaw, servicesRaw] = await Promise.all([
                premiumFetch('/catalog/countries'),
                premiumFetch('/catalog/services'),
            ]);
            const countryObj = (countriesRaw || []).find(
                c => String(c.code).toLowerCase() === String(country).toLowerCase()
            );
            const serviceObj = (servicesRaw || []).find(
                s => String(s.code).toLowerCase() === String(service).toLowerCase()
            );
            if (!countryObj || !serviceObj) {
                return res.json({ server, service, country, providers: [] });
            }

            const params = new URLSearchParams({
                country_id: String(countryObj.id),
                platform_id: String(serviceObj.id),
                limit: '500',
                page: '1',
            });
            const products = await premiumFetch(`/catalog/products?${params.toString()}`);

            providers = (products || [])
                .filter(p => p.active !== false)
                .map(p => {
                    const providerPrice = premiumMoneyToIdr(p.price);
                    const sellPrice = applyMarkup(providerPrice);
                    const providerId = String(p.id || p.product_id || '').trim();
                    const stockVal = Number(p.available) || 0;

                    if (providerId && sellPrice > 0) {
                        setPriceLock(providerId, sellPrice, providerPrice, {
                            server, service, country, provider: 'server2',
                            product_id: providerId,
                            catalog_product_id: p.catalog_product_id || null,
                            operator_id: p.operator_id || null,
                        });
                    }

                    return {
                        id: providerId,
                        provider_id: providerId,
                        product_id: providerId,
                        catalog_product_id: p.catalog_product_id || null,
                        operator_id: p.operator_id || null,
                        operator_name: p.operator_name || null,
                        name: p.name || `${serviceObj.name} ${countryObj.name}`,
                        available: stockVal,
                        stock: stockVal,
                        active: p.active !== false,
                        price_idr: sellPrice,
                        _provider_price: providerPrice,
                    };
                });
        }

        const response = { server, service, country, providers };
        cacheSet(cacheKey, response, 2 * 60 * 1000);
        res.set('X-Cache', 'MISS');
        res.json(response);
    } catch (err) {
        console.error('Get prices error:', err.message);
        const isClientErr = err.status && err.status >= 400 && err.status < 500;
        res.status(isClientErr ? err.status : 500).json({
            error: isClientErr ? err.message : 'Server error',
            code: isClientErr ? err.code : undefined,
        });
    }
}));

// preview harga. pakai lock kalau ada, fallback kalau gak ada
app.post('/api/nokos/order/preview', requireAuth, userRateLimit(30, 60 * 1000), withDB(async (req, res) => {
    const { id, server, service, country, provider_price } = req.body;

    if (!server || !SERVER_CONFIG[server]) {
        return res.status(400).json({ error: 'Server tidak valid' });
    }

    const isPremium = server === 'premium';

    try {
        let providerPrice = 0;
        let sellPrice = 0;
        let source = 'unknown';

        if (!id) {
            return res.status(400).json({ error: 'ID provider wajib' });
        }

        const locked = getPriceLock(id);
        if (locked && locked.price_idr > 0) {
            providerPrice = locked.provider_price;
            sellPrice = locked.price_idr;
            source = 'locked';
        } else {
            if (!service || !country) {
                return res.status(400).json({ error: 'service dan country wajib' });
            }

            if (isPremium) {
                const [countriesRaw, servicesRaw] = await Promise.all([
                    premiumFetch('/catalog/countries'),
                    premiumFetch('/catalog/services'),
                ]);
                const countryObj = (countriesRaw || []).find(
                    c => String(c.code).toLowerCase() === String(country).toLowerCase()
                );
                const serviceObj = (servicesRaw || []).find(
                    s => String(s.code).toLowerCase() === String(service).toLowerCase()
                );
                if (!countryObj || !serviceObj) {
                    return res.status(404).json({ error: 'Provider tidak ditemukan / stok habis', code: 'PROVIDER_NOT_FOUND' });
                }
                const params = new URLSearchParams({
                    country_id: String(countryObj.id),
                    platform_id: String(serviceObj.id),
                    limit: '500',
                    page: '1',
                });
                const products = await premiumFetch(`/catalog/products?${params.toString()}`);
                const match = (products || []).find(p => String(p.id || p.product_id) === String(id));
                if (!match) {
                    return res.status(404).json({ error: 'Provider tidak ditemukan / stok habis', code: 'PROVIDER_NOT_FOUND' });
                }
                providerPrice = premiumMoneyToIdr(match.price);
                if (providerPrice <= 0) {
                    return res.status(500).json({ error: 'Provider memberikan harga tidak valid', code: 'INVALID_PRICE' });
                }
                sellPrice = applyMarkup(providerPrice);
                setPriceLock(id, sellPrice, providerPrice, {
                    server, service, country, provider: 'server2',
                    product_id: id,
                    catalog_product_id: match.catalog_product_id || null,
                    operator_id: match.operator_id || null,
                });
                source = 'fallback_fresh';
            } else {
                const params = new URLSearchParams({ server, service, country });
                const data = await dibananaFetch(`/prices?${params.toString()}`);
                const match = (data.providers || []).find(p => String(p.id) === String(id));
                if (!match) {
                    return res.status(404).json({ error: 'Provider tidak ditemukan / stok habis', code: 'PROVIDER_NOT_FOUND' });
                }
                providerPrice = Number(match.price_idr) || 0;
                if (providerPrice <= 0) {
                    return res.status(500).json({ error: 'Provider memberikan harga tidak valid', code: 'INVALID_PRICE' });
                }
                sellPrice = applyMarkup(providerPrice);
                setPriceLock(id, sellPrice, providerPrice, { server, service, country, provider: 'server1' });
                source = 'fallback_fresh';
            }
        }

        const profit = sellPrice - providerPrice;

        const userRes = await pool.query('SELECT balance FROM users WHERE id = $1 LIMIT 1', [req.user.id]);
        const userBalance = userRes.rows[0] ? Number(userRes.rows[0].balance) : 0;
        const sufficient = userBalance >= sellPrice;

        console.log(`🔍 Preview [${source}]: provider=${providerPrice}, jual=${sellPrice}, profit=${profit}, user_balance=${userBalance}, cukup=${sufficient}`);

        res.json({
            ok: true,
            provider_id: id || null,
            price_idr: sellPrice,
            markup_percent: MARKUP_PERCENT * 100,
            user_balance: userBalance,
            sufficient_balance: sufficient,
            source,
            server,
            note: 'Harga real-time. Konfirmasi sebelum order.',
        });
    } catch (err) {
        console.error('Order preview error:', err.message);
        const isClientErr = err.status && err.status >= 400 && err.status < 500;
        res.status(isClientErr ? err.status : 500).json({
            error: isClientErr ? err.message : 'Gagal cek harga',
            code: isClientErr ? err.code : 'PREVIEW_ERROR',
        });
    }
}));

// create order. pakai price lock kalau ada
app.post('/api/nokos/order', requireAuth, userRateLimit(15, 60 * 1000), withDB(async (req, res) => {
    const startTime = Date.now();
    const {
        id, server, service, country, service_name, country_flag,
        operator, icon_code, expected_price,
    } = req.body;

    if (!server || !SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });
    if (!id) return res.status(400).json({ error: 'ID produk wajib' });

    const isPremium = server === 'premium';
    const isEkonomi = server === 'ekonomi';

    let providerOrderId = null;
    let price = 0;
    let providerPrice = 0;
    let phoneNumber = null;
    let saldoDeducted = false;
    let finalIconCode = String(icon_code || '').trim() || null;
    let lockedPrice = null;
    let usedLock = false;

    try {
        const userRes = await pool.query('SELECT balance FROM users WHERE id = $1 LIMIT 1', [req.user.id]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });
        const userBalanceAtStart = Number(userRes.rows[0].balance);

        if (userBalanceAtStart <= 0) {
            return res.status(400).json({
                error: 'Saldo kamu kosong. Silakan deposit dulu.',
                code: 'INSUFFICIENT_USER_BALANCE', balance: 0,
            });
        }

        // kirim order ke provider
        let data;
        if (isEkonomi) {
            try {
                data = await dibananaFetch('/order', {
                    method: 'POST',
                    body: JSON.stringify({ id }),
                });
            } catch (err) {
                console.error('Provider order error:', err.message);
                const errCode = err.code || err.data?.error;
                if (errCode === 'INSUFFICIENT_BALANCE' || /saldo tidak cukup/i.test(err.message)) {
                    return res.status(503).json({
                        error: 'Server sedang sibuk, coba lagi nanti.',
                        code: 'INSUFFICIENT_BALANCE',
                    });
                }
                return res.status(err.status || 500).json({
                    error: err.message || 'Gagal order dari provider',
                    code: errCode || 'PROVIDER_ERROR',
                });
            }
            if (!data || !data.order_id) {
                return res.status(500).json({ error: 'Provider response tidak valid', code: 'INVALID_RESPONSE' });
            }
            providerOrderId = data.order_id;
            providerPrice = Number(data.price_idr) || 0;
            phoneNumber = data.phone_number || null;

        } else if (isPremium) {
            const idemKey = 'ord_' + crypto.randomBytes(16).toString('hex');
            try {
                data = await premiumFetch('/orders/create', {
                    method: 'POST',
                    headers: { 'Idempotency-Key': idemKey },
                    body: JSON.stringify({ product_id: Number(id), quantity: 1 }),
                });
            } catch (err) {
                console.error('Premium order error:', err.message);
                return res.status(err.status || 500).json({
                    error: err.message || 'Gagal order dari provider premium',
                    code: err.code || 'PROVIDER_ERROR',
                });
            }
            const firstOrder = data?.orders?.[0];
            if (!firstOrder || !firstOrder.id) {
                return res.status(500).json({ error: 'Provider response tidak valid', code: 'INVALID_RESPONSE' });
            }
            providerOrderId = String(firstOrder.id);
            providerPrice = premiumMoneyToIdr(firstOrder.amount);
            phoneNumber = firstOrder.phone_number || null;
        }

        if (providerPrice <= 0) {
            console.error(`❌ Provider kasih harga invalid: ${providerPrice}`);
            try {
                if (isEkonomi) {
                    await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: providerOrderId }) });
                } else {
                    await premiumFetch('/orders/cancel', { method: 'POST', body: JSON.stringify({ id: Number(providerOrderId) }) });
                }
            } catch (e) {}
            return res.status(500).json({ error: 'Provider memberikan harga tidak valid', code: 'INVALID_PRICE' });
        }

        // ambil harga jual dari lock cache
        const lockKey = String(id || '').trim();
        if (lockKey) {
            const locked = getPriceLock(lockKey);
            if (locked && locked.price_idr > 0) lockedPrice = locked.price_idr;
        }

        if (lockedPrice) {
            price = lockedPrice;
            usedLock = true;

            // provider harga > lock → rugi, cancel
            if (providerPrice > lockedPrice) {
                console.warn(`⚠️ RUGI: provider=${providerPrice} > locked=${lockedPrice}. Cancel order.`);
                try {
                    if (isEkonomi) {
                        await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: providerOrderId }) });
                    } else {
                        await premiumFetch('/orders/cancel', { method: 'POST', body: JSON.stringify({ id: Number(providerOrderId) }) });
                    }
                } catch (e) {}
                return res.status(409).json({
                    error: 'Harga provider naik. Silakan coba provider lain.',
                    code: 'PROVIDER_PRICE_JUMPED',
                    provider_price: providerPrice,
                    locked: lockedPrice,
                });
            }
        } else {
            price = applyMarkup(providerPrice);
        }

        const profit = price - providerPrice;

        console.log(`💰 Order ${providerOrderId} (${server}): provider=${providerPrice}, jual=${price}, profit=${profit} ${usedLock ? '[LOCKED]' : '[FALLBACK]'}`);

        // guard expected_price cuma kalau tidak pakai lock
        if (!usedLock && expected_price && Number(expected_price) > 0) {
            const diff = Math.abs(price - Number(expected_price));
            const tolerance = Number(expected_price) * 0.01;
            if (diff > tolerance) {
                console.warn(`⚠️ Price changed: expected=${expected_price}, actual=${price}, diff=${diff}`);
                try {
                    if (isEkonomi) {
                        await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: providerOrderId }) });
                    } else {
                        await premiumFetch('/orders/cancel', { method: 'POST', body: JSON.stringify({ id: Number(providerOrderId) }) });
                    }
                } catch (e) {}
                return res.status(409).json({
                    error: 'Harga berubah dari yang kamu lihat. Silakan refresh halaman.',
                    code: 'PRICE_CHANGED',
                    expected: Number(expected_price),
                    actual: price,
                    diff,
                });
            }
        }

        if (userBalanceAtStart < price) {
            try {
                if (isEkonomi) {
                    await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: providerOrderId }) });
                } else {
                    await premiumFetch('/orders/cancel', { method: 'POST', body: JSON.stringify({ id: Number(providerOrderId) }) });
                }
            } catch (e) {}
            return res.status(400).json({
                error: 'Saldo kamu tidak cukup. Silakan deposit dulu.',
                code: 'INSUFFICIENT_USER_BALANCE',
                balance: userBalanceAtStart,
                needed: price,
            });
        }

        if (!finalIconCode && service_name) {
            try {
                const codeMap = isPremium
                    ? await getPremiumServiceCodeMap()
                    : await getServiceCodeMap();
                finalIconCode = codeMap[normalizeServiceName(service_name)] || null;
            } catch (e) {}
        }

        const otpId = await generateOtpReferenceId();
        const expiredAt = new Date(Date.now() + ORDER_EXPIRY_MS);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `INSERT INTO orders 
                 (user_id, order_id, otp_id, server, service, service_name, icon_code, country, country_name, country_flag, operator, phone_number, price, provider_price, status, expires_in, expired_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
                [
                    req.user.id, String(providerOrderId), otpId, server,
                    service || null,
                    service_name || null,
                    finalIconCode,
                    country || null,
                    COUNTRY_NAMES[country] || country || null,
                    country_flag || country || null,
                    operator || null,
                    phoneNumber, price, providerPrice, 'pending', 1200, expiredAt
                ]
            );

            const deductRes = await client.query(
                `UPDATE users 
                 SET balance = balance - $1, updated_at = NOW() 
                 WHERE id = $2 AND balance >= $1
                 RETURNING balance`,
                [price, req.user.id]
            );

            if (deductRes.rowCount === 0) {
                await client.query('ROLLBACK');
                try {
                    if (isEkonomi) {
                        await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: providerOrderId }) });
                    } else {
                        await premiumFetch('/orders/cancel', { method: 'POST', body: JSON.stringify({ id: Number(providerOrderId) }) });
                    }
                } catch (e) {}
                return res.status(400).json({
                    error: 'Saldo kamu tidak cukup. Silakan deposit dulu.',
                    code: 'INSUFFICIENT_USER_BALANCE',
                });
            }

            await client.query(
                `INSERT INTO transactions 
                 (user_id, order_id, service_name, country, country_flag, phone_number, status, price)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    req.user.id, String(providerOrderId),
                    service_name || null,
                    country || null,
                    country_flag || country || null,
                    phoneNumber, 'pending', price
                ]
            );

            await client.query(
                `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                ['order', String(providerOrderId), req.user.id, null, 'pending', 'order_created',
                 JSON.stringify({
                     otp_id: otpId,
                     service: service_name || null,
                     country: country || null,
                     price,
                     provider_price: providerPrice,
                     profit,
                     phone_number: phoneNumber,
                     server,
                     operator: operator || null,
                     icon_code: finalIconCode,
                     price_source: usedLock ? 'locked' : 'fallback',
                 })]
            );

            await client.query('COMMIT');
            saldoDeducted = true;

            cacheDelPattern('prices_');

            const newBalance = Number(deductRes.rows[0].balance);

            res.json({
                message: 'Order berhasil!',
                order: {
                    otp_id: otpId,
                    phone_number: phoneNumber,
                    price_idr: price,
                    server,
                    service,
                    service_name: service_name || null,
                    icon_code: finalIconCode,
                    country,
                    operator: operator || null,
                    status: 'pending',
                    expires_in: 1200,
                    expired_at: expiredAt.toISOString(),
                },
                balance: newBalance,
                price_source: usedLock ? 'locked' : 'fallback',
            });

            console.log(`⏱️ Order ${providerOrderId} (${server}) in ${Date.now() - startTime}ms`);
        } catch (dbErr) {
            await client.query('ROLLBACK');
            console.error('DB insert error:', dbErr.message);
            try {
                if (isEkonomi) {
                    await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: providerOrderId }) });
                } else {
                    await premiumFetch('/orders/cancel', { method: 'POST', body: JSON.stringify({ id: Number(providerOrderId) }) });
                }
            } catch (e) {}
            return res.status(500).json({ error: 'Gagal menyimpan order. Coba lagi.' });
        } finally {
            client.release();
        }

    } catch (err) {
        console.error('Create order error:', err.message);
        if (providerOrderId && !saldoDeducted) {
            try {
                if (isPremium) {
                    await premiumFetch('/orders/cancel', { method: 'POST', body: JSON.stringify({ id: Number(providerOrderId) }) });
                } else {
                    await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: providerOrderId }) });
                }
            } catch (e) {}
        }
        const isClientErr = err.status && err.status >= 400 && err.status < 500;
        res.status(isClientErr ? err.status : 500).json({
            error: isClientErr ? err.message : 'Server error',
            code: isClientErr ? err.code : undefined,
        });
    }
}));

// cek status order
app.get('/api/nokos/order/:orderId', requireAuth, withDB(async (req, res) => {
    const { orderId } = req.params;
    try {
        const order = await findUserOrder(req.user.id, orderId);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });

        if (['received', 'success', 'confirmed', 'cancelled', 'failed', 'expired', 'refunded'].includes(order.status)) {
            return res.json({
                otp_id: order.otp_id, status: order.status, phone_number: order.phone_number,
                otp_code: order.otp_code, otp_code_2: order.otp_code_2,
                full_sms: order.full_sms, price_idr: order.price,
                service: order.service, service_name: order.service_name,
                icon_code: order.icon_code,
                country: order.country, country_name: order.country_name, country_flag: order.country_flag,
                operator: order.operator,
                server: order.server,
                received_at: order.received_at, expires_in: 0, expired_at: order.expired_at,
                refunded_at: order.refunded_at, refunded_amount: order.refunded_amount,
                refund_reason: order.refund_reason, created_at: order.created_at,
            });
        }

        const providerOrderId = order.order_id;
        const data = await providerOrderStatus(order);

        if (data.status !== order.status || data.otp_code) {
            await pool.query(
                `UPDATE orders SET status = $1, otp_code = $2, otp_code_2 = $3, full_sms = $4, received_at = CASE WHEN $1 = 'received' THEN NOW() ELSE received_at END, updated_at = NOW() WHERE order_id = $5`,
                [data.status, data.otp_code, data.otp_code_2, data.full_sms, String(providerOrderId)]
            );
            await pool.query(
                `UPDATE transactions SET status = CASE WHEN $1 = 'received' THEN 'success' WHEN $1 IN ('cancelled', 'expired', 'refunded') THEN 'failed' ELSE status END, otp_code = $2, updated_at = NOW() WHERE order_id = $3`,
                [data.status, data.otp_code, String(providerOrderId)]
            );

            if (data.status !== order.status) {
                await logStatusChange({
                    entityType: 'order', entityId: String(providerOrderId), userId: order.user_id,
                    oldStatus: order.status, newStatus: data.status, reason: 'check_status',
                    metadata: { otp_code: data.otp_code || null, otp_id: order.otp_id },
                });
            }

            if (['cancelled', 'expired', 'refunded'].includes(data.status)) {
                const fresh = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [order.id]);
                if (fresh.rows[0]) await refundOrder(fresh.rows[0], 'provider_' + data.status);
            }

            if (data.otp_code && ['received', 'success', 'confirmed'].includes(data.status)) {
                const fresh = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [order.id]);
                if (fresh.rows[0]) {
                    try {
                        const user = await fetchUserForOrder(fresh.rows[0]);
                        await notifyOtpSuccess(fresh.rows[0], user);
                    } catch (err) {
                        console.error('❌ Notif OTP (check status) error:', err.message);
                    }
                }
            }

            const fresh = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [order.id]);
            const o = fresh.rows[0];

            return res.json({
                ...data,
                otp_id: o.otp_id,
                service: o.service,
                service_name: o.service_name,
                icon_code: o.icon_code,
                country: o.country,
                country_name: o.country_name,
                country_flag: o.country_flag,
                operator: o.operator,
                server: o.server,
                refunded_at: o.refunded_at,
                refunded_amount: o.refunded_amount,
                refund_reason: o.refund_reason,
                created_at: o.created_at,
            });
        }

        const fresh = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [order.id]);
        const o = fresh.rows[0];

        res.json({
            ...data,
            otp_id: o.otp_id,
            service: o.service,
            service_name: o.service_name,
            icon_code: o.icon_code,
            country: o.country,
            country_name: o.country_name,
            country_flag: o.country_flag,
            operator: o.operator,
            server: o.server,
            refunded_at: o.refunded_at,
            refunded_amount: o.refunded_amount,
            refund_reason: o.refund_reason,
            created_at: o.created_at,
        });
    } catch (err) {
        console.error('Check status error:', err.message);
        const isClientErr = err.status && err.status >= 400 && err.status < 500;
        res.status(isClientErr ? err.status : 500).json({
            error: isClientErr ? err.message : 'Server error',
            code: isClientErr ? err.code : undefined,
        });
    }
}));

// resend SMS
app.post('/api/nokos/order/:orderId/resend', requireAuth, userRateLimit(10, 60 * 1000), withDB(async (req, res) => {
    const { orderId } = req.params;
    try {
        const order = await findUserOrder(req.user.id, orderId);
        if (!order) {
            const depositRes = await pool.query(
                'SELECT * FROM deposits WHERE reference_id = $1 AND user_id = $2 LIMIT 1',
                [String(orderId), req.user.id]
            );
            if (!depositRes.rows.length) return res.status(404).json({ error: 'Data tidak ditemukan' });
            const d = depositRes.rows[0];
            return res.json({
                order_type: 'deposit', otp_id: null,
                status: `deposit_${d.status}`, service: 'Deposit',
                service_name: 'Deposit QRIS',
                country: null, country_name: 'QRIS',
                phone_number: null, otp_code: null, full_sms: null, price: d.amount,
                qris_id: d.qris_id, qris_url: d.qris_url,
                total_amount: d.total_amount, fee: d.fee,
                created_at: d.created_at, updated_at: d.updated_at, expired_at: d.expires_at,
            });
        }

        if (['received', 'success', 'confirmed'].includes(order.status)) {
            return res.status(400).json({ error: 'Order sudah sukses, tidak perlu resend' });
        }
        if (['cancelled', 'failed', 'expired', 'refunded'].includes(order.status)) {
            return res.status(400).json({ error: 'Order sudah tidak aktif' });
        }
        if (!order.otp_code || order.otp_code.trim() === '') {
            return res.status(400).json({ error: 'Resend hanya bisa setelah OTP pertama masuk' });
        }
        if (order.resend_count >= 3) {
            return res.status(400).json({ error: 'Maksimal 3x resend per order' });
        }

        const data = await providerResendOrder(order);

        await pool.query(
            'UPDATE orders SET resend_count = resend_count + 1, status = $1, updated_at = NOW() WHERE id = $2',
            [data.status || order.status, order.id]
        );

        await logStatusChange({
            entityType: 'order', entityId: String(order.order_id), userId: req.user.id,
            oldStatus: order.status, newStatus: data.status || order.status, reason: 'resend_sms',
            metadata: { resend_count: order.resend_count + 1, otp_id: order.otp_id },
        });

        res.json({ ...data, otp_id: order.otp_id });
    } catch (err) {
        const isClientErr = err.status && err.status >= 400 && err.status < 500;
        res.status(isClientErr ? err.status : 500).json({
            error: isClientErr ? err.message : 'Server error',
            code: isClientErr ? err.code : undefined,
        });
    }
}));

// konfirmasi OTP diterima
app.post('/api/nokos/order/:orderId/confirm', requireAuth, withDB(async (req, res) => {
    const { orderId } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let found = await client.query(
            'SELECT * FROM orders WHERE otp_id = $1 AND user_id = $2 FOR UPDATE',
            [String(orderId), req.user.id]
        );
        if (!found.rows.length) {
            found = await client.query(
                'SELECT * FROM orders WHERE order_id = $1 AND user_id = $2 FOR UPDATE',
                [String(orderId), req.user.id]
            );
        }
        if (!found.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Order tidak ditemukan' });
        }
        const order = found.rows[0];
        if (order.status === 'confirmed') {
            await client.query('COMMIT');
            return res.json({ message: 'Order sudah dikonfirmasi', status: 'confirmed' });
        }
        if (!['pending', 'received', 'success'].includes(order.status)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Order sudah tidak bisa dikonfirmasi' });
        }
        if (!order.otp_code || !String(order.otp_code).trim()) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'OTP belum diterima' });
        }
        await client.query(
            `UPDATE orders SET status = 'confirmed', received_at = COALESCE(received_at, NOW()), updated_at = NOW() WHERE id = $1`,
            [order.id]
        );
        await client.query(
            `UPDATE transactions SET status = 'success', updated_at = NOW() WHERE order_id = $1 AND user_id = $2`,
            [String(order.order_id), req.user.id]
        );
        await client.query(
            `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
             VALUES ('order', $1, $2, $3, 'confirmed', 'user_confirmed', $4)`,
            [String(order.order_id), req.user.id, order.status, JSON.stringify({ otp_id: order.otp_id })]
        );
        await client.query('COMMIT');
        return res.json({ message: 'Order berhasil dikonfirmasi', status: 'confirmed' });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Confirm order error:', err.message);
        return res.status(500).json({ error: 'Gagal mengonfirmasi order' });
    } finally {
        client.release();
    }
}));

// cancel order manual
app.post('/api/nokos/order/:orderId/cancel', requireAuth, userRateLimit(10, 60 * 1000), withDB(async (req, res) => {
    const { orderId } = req.params;
    try {
        const order = await findUserOrder(req.user.id, orderId);
        if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });

        if (['received', 'success', 'confirmed'].includes(order.status)) {
            return res.status(400).json({ error: 'Order sudah sukses, tidak bisa dibatalkan' });
        }
        if (['cancelled', 'expired', 'refunded'].includes(order.status)) {
            return res.status(400).json({ error: 'Order sudah tidak aktif' });
        }

        const data = await providerCancelOrder(order);

        await pool.query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', ['cancelled', order.id]);
        await pool.query('UPDATE transactions SET status = $1, updated_at = NOW() WHERE order_id = $2', ['failed', String(order.order_id)]);

        await logStatusChange({
            entityType: 'order', entityId: String(order.order_id), userId: req.user.id,
            oldStatus: order.status, newStatus: 'cancelled', reason: 'manual_cancel',
            metadata: { refunded_amount: Number(data.refunded) || Number(order.price) || 0, otp_id: order.otp_id },
        });

        const fresh = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [order.id]);
        if (fresh.rows[0]) await refundOrder(fresh.rows[0], 'manual_cancel');

        const userRes = await pool.query('SELECT balance FROM users WHERE id = $1 LIMIT 1', [req.user.id]);

        res.json({
            ...data,
            otp_id: order.otp_id,
            balance: userRes.rows[0] ? Number(userRes.rows[0].balance) : null
        });
    } catch (err) {
        const isClientErr = err.status && err.status >= 400 && err.status < 500;
        res.status(isClientErr ? err.status : 500).json({
            error: isClientErr ? err.message : 'Server error',
            code: isClientErr ? err.code : undefined,
        });
    }
}));

// list orders (nokos + deposit)
app.get('/api/nokos/orders', requireAuth, withDB(async (req, res) => {
    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const status = String(req.query.status || 'all');
    const offset = (pageNum - 1) * limitNum;

    try {
        let orders = [];
        let total = 0;

        if (status === 'deposit' || status === 'all') {
            const [rows, count] = await Promise.all([
                pool.query(
                    `SELECT id, reference_id, method, amount, total_amount, status, qris_url, expires_at, created_at, updated_at
                     FROM deposits WHERE user_id = $1 ORDER BY created_at DESC`,
                    [req.user.id]
                ),
                pool.query('SELECT COUNT(*) FROM deposits WHERE user_id = $1', [req.user.id]),
            ]);
            const mapped = rows.rows.map(d => ({
                order_id: d.reference_id, otp_id: null,
                order_type: 'deposit', server: null, service: 'Deposit',
                service_name: 'Deposit QRIS',
                icon_code: 'qris',
                country: null, country_name: 'QRIS', country_flag: null,
                operator: null, phone_number: null, otp_code: null, otp_code_2: null, full_sms: null,
                price: d.amount, status: `deposit_${d.status}`,
                expires_in: d.expires_at ? Math.max(0, Math.floor((new Date(d.expires_at) - Date.now()) / 1000)) : 0,
                expired_at: d.expires_at, created_at: d.created_at, updated_at: d.updated_at,
            }));
            if (status === 'deposit') { orders = mapped; total = Number(count.rows[0].count); }
            else { orders.push(...mapped); total += Number(count.rows[0].count); }
        }

        if (status === 'nokos' || status === 'all') {
            const [rows, count] = await Promise.all([
                pool.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]),
                pool.query('SELECT COUNT(*) FROM orders WHERE user_id = $1', [req.user.id]),
            ]);
            const mapped = rows.rows.map(o => {
                const { order_id, user_id, payment_reference, notified_at, refund_reason, provider_price, ...rest } = o;
                return {
                    ...rest,
                    order_id: o.otp_id,
                    order_type: 'nokos',
                    expires_in: o.expired_at ? Math.max(0, Math.floor((new Date(o.expired_at) - Date.now()) / 1000)) : 0,
                };
            });
            if (status === 'nokos') { orders = mapped; total = Number(count.rows[0].count); }
            else { orders.push(...mapped); total += Number(count.rows[0].count); }
        }

        if (!['all', 'nokos', 'deposit'].includes(status)) {
            const successFilter = status === 'success';
            const statusCondition = successFilter ? "status IN ('success', 'received', 'confirmed')" : 'status = $2';
            const [rows, count] = await Promise.all([
                pool.query(
                    `SELECT * FROM orders WHERE user_id = $1 AND ${statusCondition} ORDER BY created_at DESC`,
                    successFilter ? [req.user.id] : [req.user.id, status]
                ),
                pool.query(
                    `SELECT COUNT(*) FROM orders WHERE user_id = $1 AND ${statusCondition}`,
                    successFilter ? [req.user.id] : [req.user.id, status]
                ),
            ]);
            orders = rows.rows.map(o => {
                const { order_id, user_id, payment_reference, notified_at, refund_reason, provider_price, ...rest } = o;
                return {
                    ...rest,
                    order_id: o.otp_id,
                    order_type: 'nokos',
                    expires_in: o.expired_at ? Math.max(0, Math.floor((new Date(o.expired_at) - Date.now()) / 1000)) : 0,
                };
            });
            total = Number(count.rows[0].count);
        }

        orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        res.json({ orders: orders.slice(offset, offset + limitNum), total, page: pageNum, limit: limitNum });
    } catch (err) {
        console.error('List orders error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// sync batch order (max 10)
app.post('/api/nokos/sync-batch', requireAuth, userRateLimit(30, 60 * 1000), withDB(async (req, res) => {
    const { order_ids } = req.body;
    if (!Array.isArray(order_ids) || order_ids.length === 0) {
        return res.json({ updated: [], count: 0 });
    }

    const ids = order_ids.slice(0, 10);

    try {
        const result = await pool.query(
            `SELECT * FROM orders WHERE order_id = ANY($1) AND user_id = $2 AND status = 'pending'`,
            [ids, req.user.id]
        );

        const updated = [];
        const chunks = [];
        for (let i = 0; i < result.rows.length; i += 5) {
            chunks.push(result.rows.slice(i, i + 5));
        }

        for (const chunk of chunks) {
            await Promise.all(chunk.map(async (order) => {
                try {
                    const data = await providerOrderStatus(order);

                    if (data.status !== order.status || data.otp_code) {
                        await pool.query(
                            `UPDATE orders SET status = $1, otp_code = $2, otp_code_2 = $3, full_sms = $4, 
                             received_at = CASE WHEN $1 = 'received' THEN NOW() ELSE received_at END, 
                             updated_at = NOW() WHERE order_id = $5`,
                            [data.status, data.otp_code, data.otp_code_2, data.full_sms, String(order.order_id)]
                        );
                        await pool.query(
                            `UPDATE transactions SET status = CASE WHEN $1 = 'received' THEN 'success' 
                             WHEN $1 IN ('cancelled', 'expired', 'refunded') THEN 'failed' 
                             ELSE status END, otp_code = $2, updated_at = NOW() 
                             WHERE order_id = $3`,
                            [data.status, data.otp_code, String(order.order_id)]
                        );

                        if (data.status !== order.status) {
                            await logStatusChange({
                                entityType: 'order', entityId: String(order.order_id), userId: order.user_id,
                                oldStatus: order.status, newStatus: data.status, reason: 'sync_batch',
                                metadata: { otp_code: data.otp_code || null, otp_id: order.otp_id },
                            });
                        }

                        if (['cancelled', 'expired', 'refunded'].includes(data.status)) {
                            const fresh = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [order.order_id]);
                            if (fresh.rows[0]) await refundOrder(fresh.rows[0], 'provider_' + data.status);
                        }

                        const fresh = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [order.order_id]);
                        if (fresh.rows[0]) updated.push(fresh.rows[0]);

                        if (fresh.rows[0] && data.otp_code && ['received', 'success', 'confirmed'].includes(data.status)) {
                            try {
                                const user = await fetchUserForOrder(fresh.rows[0]);
                                await notifyOtpSuccess(fresh.rows[0], user);
                            } catch (err) {
                                console.error('❌ Notif OTP (sync batch) error:', err.message);
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Sync ${order.order_id}:`, err.message);
                }
            }));
        }

        res.json({ updated, count: updated.length });
    } catch (err) {
        console.error('Sync batch error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// admin middleware & helpers
const ADMIN_USERNAMES = ['asyrofc'];
const ADMIN_USER_CODES = ['SRF2667442394'];

function isAdminUser(user) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    const uname = String(user.username || '').toLowerCase();
    const ucode = String(user.user_code || '');
    return ADMIN_USERNAMES.includes(uname) || ADMIN_USER_CODES.includes(ucode);
}

async function requireAdminFlex(req, res, next) {
    try {
        const result = await pool.query(
            'SELECT id, username, role, user_code, status FROM users WHERE id = $1 LIMIT 1',
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'User tidak ditemukan' });
        }
        const user = result.rows[0];
        if (user.status === 'banned') {
            return res.status(403).json({ error: 'Akun diblokir' });
        }
        if (!isAdminUser(user)) {
            return res.status(403).json({ error: 'Admin only' });
        }
        req.admin = user;
        next();
    } catch (err) {
        console.error('requireAdminFlex error:', err.message);
        return res.status(500).json({ error: 'Server error' });
    }
}

async function logAdminAction({ adminId, adminUsername, action, targetType, targetId, metadata = null }) {
    try {
        await pool.query(
            `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                'admin_action',
                String(targetId || ''),
                adminId,
                null,
                action,
                `admin:${adminUsername || adminId}`,
                metadata
                    ? JSON.stringify({ ...metadata, target_type: targetType })
                    : JSON.stringify({ target_type: targetType })
            ]
        );
    } catch (err) {
        console.error('logAdminAction error:', err.message);
    }
}

function parsePagination(req, defaultLimit = 20, maxLimit = 100) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit, 10) || defaultLimit));
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

const ORDER_SUCCESS_STATUSES = ['success', 'received', 'confirmed'];
const ORDER_FAIL_STATUSES = ['cancelled', 'expired', 'failed', 'refunded'];
const DEPOSIT_SUCCESS_STATUSES = ['success'];
const DEPOSIT_FAIL_STATUSES = ['cancelled', 'expired', 'failed', 'refunded'];

function getBalanceAdjustment(type, oldStatus, newStatus, amount) {
    const a = Number(amount) || 0;
    if (a <= 0) return 0;

    if (type === 'order') {
        const oldSuccess = ORDER_SUCCESS_STATUSES.includes(oldStatus);
        const newSuccess = ORDER_SUCCESS_STATUSES.includes(newStatus);
        const oldFail = ORDER_FAIL_STATUSES.includes(oldStatus);
        const newFail = ORDER_FAIL_STATUSES.includes(newStatus);

        if (oldStatus === 'pending' && newFail) return +a;
        if (oldFail && newStatus === 'pending') return -a;
        if (oldSuccess && newFail) return +a;
        if (oldFail && newSuccess) return -a;
        return 0;
    }

    if (type === 'deposit') {
        const oldSuccess = DEPOSIT_SUCCESS_STATUSES.includes(oldStatus);
        const newSuccess = DEPOSIT_SUCCESS_STATUSES.includes(newStatus);
        const oldFail = DEPOSIT_FAIL_STATUSES.includes(oldStatus);
        const newFail = DEPOSIT_FAIL_STATUSES.includes(newStatus);

        if (oldStatus === 'pending' && newSuccess) return +a;
        if (oldSuccess && newFail) return -a;
        if (oldFail && newSuccess) return +a;
        if (oldSuccess && newStatus === 'pending') return -a;
        return 0;
    }

    return 0;
}

async function logBalanceAdjust({ executor, entityId, userId, oldBalance, action, metadata }) {
    await executor.query(
        `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
         VALUES ('admin_action', $1, $2, $3, 'balance_adjust', $4, $5)`,
        [
            String(entityId || ''),
            userId,
            String(oldBalance),
            action,
            JSON.stringify(metadata || {}),
        ]
    );
}

// admin stats
app.get('/api/admin/stats', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    try {
        const [usersRes, ordersRes, depositsRes, balanceRes, pendingDepositsRes, pendingOrdersRes] = await Promise.all([
            pool.query('SELECT COUNT(*) AS c FROM users'),
            pool.query('SELECT COUNT(*) AS c FROM orders'),
            pool.query('SELECT COUNT(*) AS c FROM deposits'),
            pool.query('SELECT COALESCE(SUM(balance), 0) AS total FROM users'),
            pool.query("SELECT COUNT(*) AS c FROM deposits WHERE status = 'pending'"),
            pool.query("SELECT COUNT(*) AS c FROM orders WHERE status = 'pending'"),
        ]);

        res.json({
            total_users: Number(usersRes.rows[0].c) || 0,
            total_orders: Number(ordersRes.rows[0].c) || 0,
            total_deposits: Number(depositsRes.rows[0].c) || 0,
            total_balance: Number(balanceRes.rows[0].total) || 0,
            pending_deposits: Number(pendingDepositsRes.rows[0].c) || 0,
            pending_orders: Number(pendingOrdersRes.rows[0].c) || 0,
            price_lock_size: priceLockCache.size,
            price_lock_max: PRICE_LOCK_MAX_SIZE,
        });
    } catch (err) {
        console.error('Admin stats error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// admin profit report
app.get('/api/admin/profit', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));

    try {
        const [orderProfit, depositProfit] = await Promise.all([
            pool.query(
                `SELECT 
                    COUNT(*) AS total_orders,
                    COALESCE(SUM(price), 0) AS total_revenue,
                    COALESCE(SUM(provider_price), 0) AS total_cost,
                    COALESCE(SUM(price - provider_price), 0) AS total_profit
                 FROM orders
                 WHERE status IN ('success', 'received', 'confirmed')
                   AND created_at > NOW() - make_interval(days => $1::int)`,
                [days]
            ),
            pool.query(
                `SELECT 
                    COUNT(*) AS total_deposits,
                    COALESCE(SUM(fee), 0) AS total_fee,
                    COALESCE(SUM(amount), 0) AS total_deposit_amount
                 FROM deposits
                 WHERE status = 'success'
                   AND created_at > NOW() - make_interval(days => $1::int)`,
                [days]
            ),
        ]);

        const o = orderProfit.rows[0];
        const d = depositProfit.rows[0];

        res.json({
            period_days: days,
            markup_percent: MARKUP_PERCENT * 100,
            nokos: {
                total_orders: Number(o.total_orders),
                total_revenue: Number(o.total_revenue),
                total_cost: Number(o.total_cost),
                total_profit: Number(o.total_profit),
                margin_percent: Number(o.total_revenue) > 0
                    ? ((Number(o.total_profit) / Number(o.total_revenue)) * 100).toFixed(2)
                    : '0.00',
            },
            deposit: {
                total_deposits: Number(d.total_deposits),
                total_deposit_amount: Number(d.total_deposit_amount),
                total_fee: Number(d.total_fee),
            },
            grand_total_profit: Number(o.total_profit) + Number(d.total_fee),
        });
    } catch (err) {
        console.error('Admin profit error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// admin price lock monitor
app.get('/api/admin/price-locks', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));

    try {
        const entries = [];
        let count = 0;
        for (const [key, val] of priceLockCache.entries()) {
            count++;
            if (entries.length < limit) {
                entries.push({
                    provider_id: key,
                    price_idr: val.price_idr,
                    provider_price: val.provider_price,
                    profit: val.price_idr - val.provider_price,
                    locked_at: val.locked_at,
                    server: val.server,
                    provider: val.provider,
                    service: val.service,
                    country: val.country,
                    product_id: val.product_id,
                    catalog_product_id: val.catalog_product_id,
                });
            }
        }

        entries.sort((a, b) => b.locked_at - a.locked_at);

        res.json({
            total: count,
            max: PRICE_LOCK_MAX_SIZE,
            entries,
        });
    } catch (err) {
        console.error('Admin price-locks error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// admin users list
app.get('/api/admin/users', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const { page, limit, offset } = parsePagination(req, 20, 100);
    const search = String(req.query.search || '').trim().toLowerCase();

    try {
        const params = [];
        let where = '';

        if (search) {
            params.push(`%${search}%`);
            where = `WHERE (
                LOWER(username) LIKE $1 OR
                LOWER(COALESCE(name, '')) LIKE $1 OR
                LOWER(COALESCE(user_code, '')) LIKE $1 OR
                CAST(id AS TEXT) LIKE $1
            )`;
        }

        const listQuery = `
            SELECT 
                u.id, u.username, u.name, u.user_code, u.balance, u.role, u.status, u.created_at,
                COALESCE(o.cnt, 0) AS total_orders,
                COALESCE(d.cnt, 0) AS total_deposits
            FROM users u
            LEFT JOIN (
                SELECT user_id, COUNT(*) AS cnt FROM orders GROUP BY user_id
            ) o ON o.user_id = u.id
            LEFT JOIN (
                SELECT user_id, COUNT(*) AS cnt FROM deposits GROUP BY user_id
            ) d ON d.user_id = u.id
            ${where}
            ORDER BY u.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        const countQuery = `SELECT COUNT(*) AS c FROM users ${where}`;

        const [listRes, countRes] = await Promise.all([
            pool.query(listQuery, [...params, limit, offset]),
            pool.query(countQuery, params),
        ]);

        const total = Number(countRes.rows[0].c) || 0;
        const total_pages = Math.ceil(total / limit);

        res.json({
            users: listRes.rows.map(u => ({
                id: u.id,
                username: u.username,
                name: u.name,
                user_code: u.user_code,
                balance: Number(u.balance) || 0,
                role: u.role,
                status: u.status,
                created_at: u.created_at,
                total_orders: Number(u.total_orders) || 0,
                total_deposits: Number(u.total_deposits) || 0,
            })),
            total,
            page,
            limit,
            total_pages,
        });
    } catch (err) {
        console.error('Admin users list error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// admin user detail
app.get('/api/admin/users/:id', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'User ID wajib' });

    try {
        const userRes = await pool.query(
            'SELECT id, username, name, user_code, balance, role, status, created_at, updated_at FROM users WHERE id = $1 LIMIT 1',
            [userId]
        );
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });

        const user = userRes.rows[0];

        const [orderStats, depositStats, balanceLogs] = await Promise.all([
            pool.query(
                `SELECT 
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status IN ('success','received','confirmed')) AS success,
                    COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                    COUNT(*) FILTER (WHERE status IN ('cancelled','expired','failed')) AS failed,
                    COALESCE(SUM(price) FILTER (WHERE status IN ('success','received','confirmed')), 0) AS total_spent,
                    COALESCE(SUM(provider_price) FILTER (WHERE status IN ('success','received','confirmed')), 0) AS total_cost
                 FROM orders WHERE user_id = $1`,
                [userId]
            ),
            pool.query(
                `SELECT 
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'success') AS success,
                    COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                    COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0) AS total_deposit
                 FROM deposits WHERE user_id = $1`,
                [userId]
            ),
            pool.query(
                `SELECT id, old_status, new_status, reason, metadata, created_at
                 FROM status_logs
                 WHERE user_id = $1 
                   AND (
                     (entity_type = 'order' AND reason LIKE 'admin_%') OR
                     (entity_type = 'deposit' AND reason LIKE 'admin_%') OR
                     (entity_type = 'admin_action' AND new_status = 'balance_adjust')
                   )
                 ORDER BY created_at DESC
                 LIMIT 100`,
                [userId]
            ),
        ]);

        const [recentOrders, recentDeposits] = await Promise.all([
            pool.query(
                `SELECT order_id, otp_id, service_name, service, icon_code, country, country_name, phone_number,
                        otp_code, price, provider_price, status, server, created_at, refunded_at, refunded_amount
                 FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
                [userId]
            ),
            pool.query(
                `SELECT reference_id, method, amount, total_amount, fee, status, 
                        qris_url, paid_at, expires_at, created_at
                 FROM deposits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
                [userId]
            ),
        ]);

        res.json({
            user: { ...user, balance: Number(user.balance) || 0 },
            stats: {
                orders: {
                    total: Number(orderStats.rows[0].total) || 0,
                    success: Number(orderStats.rows[0].success) || 0,
                    pending: Number(orderStats.rows[0].pending) || 0,
                    failed: Number(orderStats.rows[0].failed) || 0,
                    total_spent: Number(orderStats.rows[0].total_spent) || 0,
                    total_cost: Number(orderStats.rows[0].total_cost) || 0,
                },
                deposits: {
                    total: Number(depositStats.rows[0].total) || 0,
                    success: Number(depositStats.rows[0].success) || 0,
                    pending: Number(depositStats.rows[0].pending) || 0,
                    total_deposit: Number(depositStats.rows[0].total_deposit) || 0,
                },
            },
            balance_logs: balanceLogs.rows,
            recent_orders: recentOrders.rows.map(o => ({
                ...o,
                price: Number(o.price) || 0,
                provider_price: Number(o.provider_price) || 0,
                profit: (Number(o.price) || 0) - (Number(o.provider_price) || 0),
            })),
            recent_deposits: recentDeposits.rows.map(d => ({
                ...d,
                amount: Number(d.amount) || 0,
                total_amount: Number(d.total_amount) || 0,
                fee: Number(d.fee) || 0,
            })),
        });
    } catch (err) {
        console.error('Admin user detail error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// admin edit user balance
app.post('/api/admin/users/:id/balance', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const userId = String(req.params.id || '').trim();
    const { mode, amount, note } = req.body;

    if (!userId) return res.status(400).json({ error: 'User ID wajib' });
    if (!['set', 'add', 'subtract'].includes(mode)) {
        return res.status(400).json({ error: 'Mode harus set/add/subtract' });
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
        return res.status(400).json({ error: 'Amount harus angka >= 0' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const userRes = await client.query(
            'SELECT id, username, balance FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );
        if (userRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }

        const user = userRes.rows[0];
        const oldBalance = Number(user.balance) || 0;
        let newBalance;

        if (mode === 'set') {
            newBalance = Math.floor(amt);
        } else if (mode === 'add') {
            newBalance = oldBalance + Math.floor(amt);
        } else {
            if (oldBalance < amt) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'Saldo user tidak cukup untuk dikurangi',
                    balance: oldBalance,
                    requested: amt,
                });
            }
            newBalance = oldBalance - Math.floor(amt);
        }

        await client.query(
            'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
            [newBalance, userId]
        );

        await logBalanceAdjust({
            executor: client,
            entityId: userId,
            userId: userId,
            oldBalance: oldBalance,
            action: 'admin_balance_adjust',
            metadata: {
                mode,
                amount: Math.floor(amt),
                old_balance: oldBalance,
                new_balance: newBalance,
                note: note || null,
                admin_id: req.admin.id,
                admin_username: req.admin.username,
            },
        });

        await client.query('COMMIT');

        res.json({
            message: 'Saldo berhasil diupdate',
            user: { id: user.id, username: user.username, balance: newBalance },
            old_balance: oldBalance,
            new_balance: newBalance,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Admin balance update error:', err.message);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
}));

// admin role / status / reset password
app.post('/api/admin/users/:id/role', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const userId = String(req.params.id || '').trim();
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Role harus user/admin' });

    try {
        const result = await pool.query(
            'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, role',
            [role, userId]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'User tidak ditemukan' });

        await logAdminAction({
            adminId: req.admin.id,
            adminUsername: req.admin.username,
            action: 'change_role',
            targetType: 'user',
            targetId: userId,
            metadata: { new_role: role },
        });

        res.json({ message: 'Role berhasil diubah', user: result.rows[0] });
    } catch (err) {
        console.error('Admin change role error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/admin/users/:id/status', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const userId = String(req.params.id || '').trim();
    const { status } = req.body;
    if (!['active', 'banned'].includes(status)) return res.status(400).json({ error: 'Status harus active/banned' });

    try {
        const result = await pool.query(
            'UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, status',
            [status, userId]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'User tidak ditemukan' });

        if (status === 'banned') {
            await revokeAllUserSessions(userId);
        }

        await logAdminAction({
            adminId: req.admin.id,
            adminUsername: req.admin.username,
            action: 'change_status',
            targetType: 'user',
            targetId: userId,
            metadata: { new_status: status },
        });

        res.json({ message: 'Status berhasil diubah', user: result.rows[0] });
    } catch (err) {
        console.error('Admin change status error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const userId = String(req.params.id || '').trim();
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });

    try {
        const hash = await bcrypt.hash(new_password, 10);
        const result = await pool.query(
            'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username',
            [hash, userId]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'User tidak ditemukan' });

        await revokeAllUserSessions(userId);

        await logAdminAction({
            adminId: req.admin.id,
            adminUsername: req.admin.username,
            action: 'reset_password',
            targetType: 'user',
            targetId: userId,
        });

        res.json({ message: 'Password berhasil direset', user: result.rows[0] });
    } catch (err) {
        console.error('Admin reset password error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// admin orders list
app.get('/api/admin/orders', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const { page, limit, offset } = parsePagination(req, 20, 100);
    const status = String(req.query.status || '').trim();
    const serverFilter = String(req.query.server || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();

    try {
        const params = [];
        const conditions = [];

        if (status && status !== 'all') {
            if (status === 'success') {
                conditions.push(`(o.status IN ('success','received','confirmed'))`);
            } else {
                params.push(status);
                conditions.push(`o.status = $${params.length}`);
            }
        }

        if (serverFilter && serverFilter !== 'all') {
            params.push(serverFilter);
            conditions.push(`o.server = $${params.length}`);
        }

        if (search) {
            params.push(`%${search}%`);
            const idx = params.length;
            conditions.push(`(
                LOWER(o.order_id) LIKE $${idx} OR
                LOWER(COALESCE(o.otp_id, '')) LIKE $${idx} OR
                LOWER(COALESCE(o.phone_number, '')) LIKE $${idx} OR
                LOWER(COALESCE(o.service_name, '')) LIKE $${idx} OR
                LOWER(COALESCE(u.username, '')) LIKE $${idx} OR
                LOWER(COALESCE(u.user_code, '')) LIKE $${idx}
            )`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const listQuery = `
            SELECT o.*, u.username, u.user_code, u.name AS user_name
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            ${where}
            ORDER BY o.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        const countQuery = `
            SELECT COUNT(*) AS c 
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            ${where}
        `;

        const [listRes, countRes] = await Promise.all([
            pool.query(listQuery, [...params, limit, offset]),
            pool.query(countQuery, params),
        ]);

        const total = Number(countRes.rows[0].c) || 0;
        const total_pages = Math.ceil(total / limit);

        res.json({
            orders: listRes.rows.map(o => ({
                ...o,
                price: Number(o.price) || 0,
                provider_price: Number(o.provider_price) || 0,
                profit: (Number(o.price) || 0) - (Number(o.provider_price) || 0),
                refunded_amount: o.refunded_amount ? Number(o.refunded_amount) : null,
            })),
            total,
            page,
            limit,
            total_pages,
        });
    } catch (err) {
        console.error('Admin orders list error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// admin order detail
app.get('/api/admin/order/:orderId', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const orderId = String(req.params.orderId || '').trim();

    try {
        const result = await pool.query(
            `SELECT o.*, u.username, u.user_code, u.name AS user_name, u.balance AS user_balance
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             WHERE o.order_id = $1 LIMIT 1`,
            [orderId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Order tidak ditemukan' });

        const o = result.rows[0];

        const logs = await pool.query(
            `SELECT id, old_status, new_status, reason, metadata, created_at
             FROM status_logs
             WHERE entity_type = 'order' AND entity_id = $1
             ORDER BY created_at DESC LIMIT 100`,
            [orderId]
        );

        res.json({
            order: {
                ...o,
                price: Number(o.price) || 0,
                provider_price: Number(o.provider_price) || 0,
                profit: (Number(o.price) || 0) - (Number(o.provider_price) || 0),
                refunded_amount: o.refunded_amount ? Number(o.refunded_amount) : null,
                user_balance: Number(o.user_balance) || 0,
            },
            logs: logs.rows,
        });
    } catch (err) {
        console.error('Admin order detail error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// admin update order status
const ALLOWED_ORDER_STATUSES = [
    'pending', 'success', 'received', 'confirmed',
    'cancelled', 'expired', 'failed', 'refunded'
];

app.post('/api/admin/order/:orderId/status', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const orderId = String(req.params.orderId || '').trim();
    const { status: newStatus, note } = req.body;

    if (!ALLOWED_ORDER_STATUSES.includes(newStatus)) {
        return res.status(400).json({ error: `Status tidak valid. Pilihan: ${ALLOWED_ORDER_STATUSES.join(', ')}` });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const orderRes = await client.query(
            'SELECT * FROM orders WHERE order_id = $1 FOR UPDATE',
            [orderId]
        );
        if (orderRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Order tidak ditemukan' });
        }

        const order = orderRes.rows[0];
        const oldStatus = order.status;

        if (oldStatus === newStatus) {
            await client.query('COMMIT');
            return res.json({
                message: 'Status sama, tidak ada perubahan',
                order: { ...order, price: Number(order.price) || 0 },
                balance_adjustment: 0,
            });
        }

        const price = Number(order.price) || 0;
        const adjustment = getBalanceAdjustment('order', oldStatus, newStatus, price);

        let newBalance = null;

        if (adjustment !== 0) {
            const userRes = await client.query(
                'SELECT id, username, balance FROM users WHERE id = $1 FOR UPDATE',
                [order.user_id]
            );
            if (userRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'User pemilik order tidak ditemukan' });
            }
            const user = userRes.rows[0];
            const oldBalance = Number(user.balance) || 0;

            if (adjustment < 0 && oldBalance < Math.abs(adjustment)) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'Saldo user tidak cukup untuk dikurangi',
                    balance: oldBalance,
                    needed: Math.abs(adjustment),
                });
            }

            newBalance = oldBalance + adjustment;

            await client.query(
                'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
                [newBalance, user.id]
            );

            await logBalanceAdjust({
                executor: client,
                entityId: orderId,
                userId: user.id,
                oldBalance: oldBalance,
                action: 'admin_order_status_change',
                metadata: {
                    order_id: orderId,
                    old_status: oldStatus,
                    new_status: newStatus,
                    adjustment,
                    old_balance: oldBalance,
                    new_balance: newBalance,
                    note: note || null,
                    admin_id: req.admin.id,
                    admin_username: req.admin.username,
                },
            });
        }

        const updateFields = ['status = $1', 'updated_at = NOW()'];
        const updateParams = [newStatus];

        if (ORDER_FAIL_STATUSES.includes(newStatus) && !ORDER_FAIL_STATUSES.includes(oldStatus)) {
            updateFields.push(`refunded_at = $${updateParams.length + 1}`);
            updateParams.push(Date.now());
            updateFields.push(`refunded_amount = $${updateParams.length + 1}`);
            updateParams.push(price);
            updateFields.push(`refund_reason = $${updateParams.length + 1}`);
            updateParams.push(note || 'admin_force_fail');
        }

        if (ORDER_SUCCESS_STATUSES.includes(newStatus) && ORDER_FAIL_STATUSES.includes(oldStatus)) {
            updateFields.push(`refunded_at = NULL`);
            updateFields.push(`refunded_amount = NULL`);
            updateFields.push(`refund_reason = NULL`);
        }

        if (ORDER_SUCCESS_STATUSES.includes(newStatus)) {
            updateFields.push(`received_at = COALESCE(received_at, NOW())`);
        }

        updateParams.push(orderId);
        const updateQuery = `UPDATE orders SET ${updateFields.join(', ')} WHERE order_id = $${updateParams.length} RETURNING *`;

        const updatedOrder = await client.query(updateQuery, updateParams);

        await client.query(
            `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
             VALUES ('order', $1, $2, $3, $4, 'admin_force_status', $5)`,
            [
                orderId,
                order.user_id,
                oldStatus,
                newStatus,
                JSON.stringify({
                    admin_id: req.admin.id,
                    admin_username: req.admin.username,
                    balance_adjustment: adjustment,
                    note: note || null,
                }),
            ]
        );

        await client.query(
            `UPDATE transactions 
             SET status = CASE 
                WHEN $1 IN ('success','received','confirmed') THEN 'success'
                WHEN $1 IN ('cancelled','expired','failed','refunded') THEN 'failed'
                ELSE status
             END,
             updated_at = NOW()
             WHERE order_id = $2`,
            [newStatus, orderId]
        );

        await client.query('COMMIT');

        res.json({
            message: 'Status order berhasil diubah',
            order: {
                ...updatedOrder.rows[0],
                price: Number(updatedOrder.rows[0].price) || 0,
                provider_price: Number(updatedOrder.rows[0].provider_price) || 0,
                profit: (Number(updatedOrder.rows[0].price) || 0) - (Number(updatedOrder.rows[0].provider_price) || 0),
                refunded_amount: updatedOrder.rows[0].refunded_amount
                    ? Number(updatedOrder.rows[0].refunded_amount)
                    : null,
            },
            old_status: oldStatus,
            new_status: newStatus,
            balance_adjustment: adjustment,
            new_balance: newBalance,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Admin order status change error:', err.message);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
}));

// admin deposits list
app.get('/api/admin/deposits', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const { page, limit, offset } = parsePagination(req, 20, 100);
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();

    try {
        const params = [];
        const conditions = [];

        if (status && status !== 'all') {
            params.push(status);
            conditions.push(`d.status = $${params.length}`);
        }

        if (search) {
            params.push(`%${search}%`);
            const idx = params.length;
            conditions.push(`(
                LOWER(d.reference_id) LIKE $${idx} OR
                LOWER(COALESCE(d.method, '')) LIKE $${idx} OR
                LOWER(COALESCE(u.username, '')) LIKE $${idx} OR
                LOWER(COALESCE(u.user_code, '')) LIKE $${idx}
            )`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const listQuery = `
            SELECT d.*, u.username, u.user_code, u.name AS user_name
            FROM deposits d
            LEFT JOIN users u ON u.id = d.user_id
            ${where}
            ORDER BY d.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        const countQuery = `
            SELECT COUNT(*) AS c 
            FROM deposits d
            LEFT JOIN users u ON u.id = d.user_id
            ${where}
        `;

        const [listRes, countRes] = await Promise.all([
            pool.query(listQuery, [...params, limit, offset]),
            pool.query(countQuery, params),
        ]);

        const total = Number(countRes.rows[0].c) || 0;
        const total_pages = Math.ceil(total / limit);

        res.json({
            deposits: listRes.rows.map(d => ({
                ...d,
                amount: Number(d.amount) || 0,
                total_amount: Number(d.total_amount) || 0,
                fee: Number(d.fee) || 0,
            })),
            total,
            page,
            limit,
            total_pages,
        });
    } catch (err) {
        console.error('Admin deposits list error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// admin deposit detail
app.get('/api/admin/deposit/:referenceId', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const referenceId = String(req.params.referenceId || '').trim();

    try {
        const result = await pool.query(
            `SELECT d.*, u.username, u.user_code, u.name AS user_name, u.balance AS user_balance
             FROM deposits d
             LEFT JOIN users u ON u.id = d.user_id
             WHERE d.reference_id = $1 LIMIT 1`,
            [referenceId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit tidak ditemukan' });

        const d = result.rows[0];

        const logs = await pool.query(
            `SELECT id, old_status, new_status, reason, metadata, created_at
             FROM status_logs
             WHERE entity_type = 'deposit' AND entity_id = $1
             ORDER BY created_at DESC LIMIT 100`,
            [referenceId]
        );

        res.json({
            deposit: {
                ...d,
                amount: Number(d.amount) || 0,
                total_amount: Number(d.total_amount) || 0,
                fee: Number(d.fee) || 0,
                user_balance: Number(d.user_balance) || 0,
            },
            logs: logs.rows,
        });
    } catch (err) {
        console.error('Admin deposit detail error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// admin update deposit status
const ALLOWED_DEPOSIT_STATUSES = ['pending', 'success', 'cancelled', 'expired', 'failed', 'refunded'];

app.post('/api/admin/deposit/:referenceId/status', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const referenceId = String(req.params.referenceId || '').trim();
    const { status: newStatus, note } = req.body;

    if (!ALLOWED_DEPOSIT_STATUSES.includes(newStatus)) {
        return res.status(400).json({ error: `Status tidak valid. Pilihan: ${ALLOWED_DEPOSIT_STATUSES.join(', ')}` });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const depositRes = await client.query(
            'SELECT * FROM deposits WHERE reference_id = $1 FOR UPDATE',
            [referenceId]
        );
        if (depositRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Deposit tidak ditemukan' });
        }

        const deposit = depositRes.rows[0];
        const oldStatus = deposit.status;

        if (oldStatus === newStatus) {
            await client.query('COMMIT');
            return res.json({
                message: 'Status sama, tidak ada perubahan',
                deposit: {
                    ...deposit,
                    amount: Number(deposit.amount) || 0,
                    total_amount: Number(deposit.total_amount) || 0,
                },
                balance_adjustment: 0,
            });
        }

        const amount = Number(deposit.amount) || 0;
        const adjustment = getBalanceAdjustment('deposit', oldStatus, newStatus, amount);

        let newBalance = null;

        if (adjustment !== 0) {
            const userRes = await client.query(
                'SELECT id, username, balance FROM users WHERE id = $1 FOR UPDATE',
                [deposit.user_id]
            );
            if (userRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'User pemilik deposit tidak ditemukan' });
            }
            const user = userRes.rows[0];
            const oldBalance = Number(user.balance) || 0;

            if (adjustment < 0 && oldBalance < Math.abs(adjustment)) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'Saldo user tidak cukup untuk dikurangi',
                    balance: oldBalance,
                    needed: Math.abs(adjustment),
                });
            }

            newBalance = oldBalance + adjustment;

            await client.query(
                'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
                [newBalance, user.id]
            );

            await logBalanceAdjust({
                executor: client,
                entityId: referenceId,
                userId: user.id,
                oldBalance: oldBalance,
                action: 'admin_deposit_status_change',
                metadata: {
                    reference_id: referenceId,
                    old_status: oldStatus,
                    new_status: newStatus,
                    adjustment,
                    old_balance: oldBalance,
                    new_balance: newBalance,
                    note: note || null,
                    admin_id: req.admin.id,
                    admin_username: req.admin.username,
                },
            });
        }

        const updateFields = ['status = $1', 'updated_at = NOW()'];
        const updateParams = [newStatus];

        if (newStatus === 'success') {
            updateFields.push(`paid_at = COALESCE(paid_at, NOW())`);
        }

        updateParams.push(referenceId);
        const updateQuery = `UPDATE deposits SET ${updateFields.join(', ')} WHERE reference_id = $${updateParams.length} RETURNING *`;

        const updatedDeposit = await client.query(updateQuery, updateParams);

        await client.query(
            `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
             VALUES ('deposit', $1, $2, $3, $4, 'admin_force_status', $5)`,
            [
                referenceId,
                deposit.user_id,
                oldStatus,
                newStatus,
                JSON.stringify({
                    admin_id: req.admin.id,
                    admin_username: req.admin.username,
                    balance_adjustment: adjustment,
                    note: note || null,
                }),
            ]
        );

        await client.query('COMMIT');

        res.json({
            message: 'Status deposit berhasil diubah',
            deposit: {
                ...updatedDeposit.rows[0],
                amount: Number(updatedDeposit.rows[0].amount) || 0,
                total_amount: Number(updatedDeposit.rows[0].total_amount) || 0,
                fee: Number(updatedDeposit.rows[0].fee) || 0,
            },
            old_status: oldStatus,
            new_status: newStatus,
            balance_adjustment: adjustment,
            new_balance: newBalance,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Admin deposit status change error:', err.message);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
}));

// admin approve deposit (legacy)
app.post('/api/admin/deposit/:referenceId/approve', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const referenceId = String(req.params.referenceId || '').trim();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const depositRes = await client.query(
            'SELECT * FROM deposits WHERE reference_id = $1 FOR UPDATE',
            [referenceId]
        );
        if (depositRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Deposit tidak ditemukan' });
        }

        const deposit = depositRes.rows[0];
        const oldStatus = deposit.status;

        if (oldStatus === 'success') {
            await client.query('COMMIT');
            return res.json({ message: 'Deposit sudah success', deposit });
        }

        const amount = Number(deposit.amount) || 0;
        const adjustment = getBalanceAdjustment('deposit', oldStatus, 'success', amount);

        let newBalance = null;

        if (adjustment !== 0) {
            const userRes = await client.query(
                'SELECT id, balance FROM users WHERE id = $1 FOR UPDATE',
                [deposit.user_id]
            );
            if (userRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'User pemilik deposit tidak ditemukan' });
            }
            const user = userRes.rows[0];
            const oldBalance = Number(user.balance) || 0;
            newBalance = oldBalance + adjustment;

            await client.query(
                'UPDATE users SET balance = $1, updated_at = NOW() WHERE id = $2',
                [newBalance, user.id]
            );

            await logBalanceAdjust({
                executor: client,
                entityId: referenceId,
                userId: user.id,
                oldBalance: oldBalance,
                action: 'admin_approve_deposit',
                metadata: {
                    reference_id: referenceId,
                    old_status: oldStatus,
                    new_status: 'success',
                    adjustment,
                    old_balance: oldBalance,
                    new_balance: newBalance,
                    admin_id: req.admin.id,
                    admin_username: req.admin.username,
                },
            });
        }

        const updated = await client.query(
            `UPDATE deposits SET status = 'success', paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
             WHERE reference_id = $1 RETURNING *`,
            [referenceId]
        );

        await client.query(
            `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
             VALUES ('deposit', $1, $2, $3, 'success', 'admin_approve_deposit', $4)`,
            [
                referenceId,
                deposit.user_id,
                oldStatus,
                JSON.stringify({
                    admin_id: req.admin.id,
                    admin_username: req.admin.username,
                    balance_adjustment: adjustment,
                }),
            ]
        );

        await client.query('COMMIT');

        if (updated.rows[0]) {
            try {
                const userRes2 = await pool.query(
                    'SELECT username, name, user_code FROM users WHERE id = $1',
                    [deposit.user_id]
                );
                await notifyDepositSuccess(
                    updated.rows[0],
                    amount,
                    Number(updated.rows[0].total_amount) || amount,
                    Number(updated.rows[0].fee) || 0,
                    userRes2.rows[0] || null
                );
            } catch (err) {
                console.error('❌ Notif deposit (approve) error:', err.message);
            }
        }

        res.json({
            message: 'Deposit di-approve',
            deposit: updated.rows[0],
            balance_adjustment: adjustment,
            new_balance: newBalance,
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Admin approve deposit error:', err.message);
        res.status(500).json({ error: 'Server error' });
    } finally {
        client.release();
    }
}));

// admin audit log
app.get('/api/admin/audit-log', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const { page, limit, offset } = parsePagination(req, 50, 200);

    try {
        const [listRes, countRes] = await Promise.all([
            pool.query(
                `SELECT sl.*, u.username AS admin_username_real, u.name AS admin_name
                 FROM status_logs sl
                 LEFT JOIN users u ON u.id = sl.user_id
                 WHERE sl.entity_type = 'admin_action'
                 ORDER BY sl.created_at DESC
                 LIMIT $1 OFFSET $2`,
                [limit, offset]
            ),
            pool.query(`SELECT COUNT(*) AS c FROM status_logs WHERE entity_type = 'admin_action'`),
        ]);

        const total = Number(countRes.rows[0].c) || 0;
        const total_pages = Math.ceil(total / limit);

        res.json({ logs: listRes.rows, total, page, limit, total_pages });
    } catch (err) {
        console.error('Admin audit log error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// admin server balance
app.get('/api/admin/server-balance', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    try {
        const provider = String(req.query.provider || 'ekonomi').toLowerCase();

        if (provider === 'premium') {
            const data = await premiumFetch('/balance');
            const balance = Number(data?.balance) || 0;
            return res.json({
                provider: 'server2',
                currency: data?.currency || 'IDR',
                balance,
                raw: data,
            });
        }

        const data = await dibananaFetch('/balance');
        res.json({ provider: 'server1', raw: data });
    } catch (err) {
        const isClientErr = err.status && err.status >= 400 && err.status < 500;
        res.status(isClientErr ? err.status : 500).json({
            error: isClientErr ? err.message : 'Server error',
            code: isClientErr ? err.code : undefined,
        });
    }
}));

// admin test notif
app.post('/api/admin/test-notif', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const { type = 'otp' } = req.body;

    if (!['otp', 'deposit', 'stats'].includes(type)) {
        return res.status(400).json({ error: 'type harus otp/deposit/stats' });
    }

    try {
        if (type === 'stats') {
            const [otpSentCount, otpPendingCount, depositSentCount, depositPendingCount, recentOtp, recentDeposit] = await Promise.all([
                pool.query(`SELECT COUNT(*) FROM orders WHERE notified_at IS NOT NULL`),
                pool.query(`SELECT COUNT(*) FROM orders WHERE status IN ('received','success','confirmed') AND otp_code IS NOT NULL AND notified_at IS NULL`),
                pool.query(`SELECT COUNT(*) FROM deposits WHERE notified_at IS NOT NULL`),
                pool.query(`SELECT COUNT(*) FROM deposits WHERE status = 'success' AND notified_at IS NULL`),
                pool.query(`SELECT otp_id, order_id, notified_at FROM orders WHERE notified_at IS NOT NULL ORDER BY notified_at DESC LIMIT 5`),
                pool.query(`SELECT reference_id, notified_at FROM deposits WHERE notified_at IS NOT NULL ORDER BY notified_at DESC LIMIT 5`),
            ]);

            return res.json({
                otp: {
                    sent: Number(otpSentCount.rows[0].count),
                    pending_backfill: Number(otpPendingCount.rows[0].count),
                    recent: recentOtp.rows,
                },
                deposit: {
                    sent: Number(depositSentCount.rows[0].count),
                    pending_backfill: Number(depositPendingCount.rows[0].count),
                    recent: recentDeposit.rows,
                },
                configured: {
                    bot_token: !!TELEGRAM_BOT_TOKEN,
                    channel_id: TELEGRAM_CHANNEL_ID || null,
                    channel_otp: TELEGRAM_CHANNEL_OTP_ID || null,
                    channel_deposit: TELEGRAM_CHANNEL_DEPOSIT_ID || null,
                },
                price_lock: {
                    size: priceLockCache.size,
                    max: PRICE_LOCK_MAX_SIZE,
                },
            });
        }

        if (type === 'otp') {
            const fakeOrder = {
                id: -1,
                otp_id: `TEST-OTP-${Date.now()}`,
                order_id: `TEST_ORDER_${Date.now()}`,
                service_name: 'WhatsApp (TEST)',
                country_name: 'Indonesia',
                phone_number: '+6281234567890',
                otp_code: '123456',
                otp_code_2: null,
                price: 1500,
                server: 'premium',
                notified_at: null,
            };

            const displayId = fakeOrder.otp_id;
            const text =
                `<b>🔔 [TEST] SUCCESSFULLY GET OTP</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `<u>• OTP ID:</u> <b>${escapeHtmlNotif(displayId)}</b>\n` +
                `<u>• Server:</u> <b>Server 2</b>\n` +
                `<u>• Service:</u> <b>${escapeHtmlNotif(fakeOrder.service_name)}</b>\n` +
                `<u>• Country:</u> <b>${escapeHtmlNotif(fakeOrder.country_name)}</b>\n` +
                `<u>• Phone:</u> <b>${escapeHtmlNotif(censorPhoneNotif(fakeOrder.phone_number))}</b>\n` +
                `<u>• Kode:</u> <b>${escapeHtmlNotif(fakeOrder.otp_code)}</b>\n` +
                `<u>• Harga:</u> <b>${toRupiahNotif(fakeOrder.price)}</b>\n` +
                `<u>• Waktu:</u> <code>${formatWaktuJakarta()}</code>\n\n` +
                `<i>Ini pesan test. Data tidak disimpan ke DB.</i>`;

            const msg = await telegramSendMessage(TELEGRAM_CHANNEL_OTP_ID, text);
            return res.json({ sent: true, message_id: msg.message_id, test_id: displayId });
        }

        if (type === 'deposit') {
            const fakeRef = `TEST-DEP-${Date.now()}`;
            const text =
                `<b>💰 [TEST] SUCCESSFUL DEPOSIT</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━\n` +
                `<u>• User:</u> <b>testuser</b>\n` +
                `<u>• User Code:</u> <code>SRF0000000001</code>\n` +
                `<u>• Reference:</u> <code>${escapeHtmlNotif(fakeRef)}</code>\n` +
                `<u>• Method:</u> <b>QRIS Otomatis</b>\n` +
                `<u>• Nominal Masuk:</u> <b>${toRupiahNotif(10000)}</b>\n` +
                `<u>• Total Bayar:</u> <b>${toRupiahNotif(10000)}</b>\n` +
                `<u>• Fee:</u> <b>${toRupiahNotif(0)}</b>\n` +
                `<u>• Waktu:</u> <code>${formatWaktuJakarta()}</code>\n\n` +
                `<i>Ini pesan test. Data tidak disimpan ke DB.</i>`;

            const msg = await telegramSendMessage(TELEGRAM_CHANNEL_DEPOSIT_ID, text);
            return res.json({ sent: true, message_id: msg.message_id, test_id: fakeRef });
        }

    } catch (err) {
        console.error('test-notif error:', err.message);
        res.status(500).json({ error: err.message });
    }
}));

// admin backfill notif
app.post('/api/admin/backfill-notifs', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const {
        type = 'all',
        days = 30,
        limit = 50,
        dry_run = false,
    } = req.body;

    if (!['otp', 'deposit', 'all'].includes(type)) {
        return res.status(400).json({ error: 'type harus otp/deposit/all' });
    }

    const dayNum = Math.min(365, Math.max(1, parseInt(days) || 30));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));

    const result = {
        dry_run: !!dry_run,
        range_days: dayNum,
        limit: limitNum,
        otp: { checked: 0, sent: 0, failed: 0, skipped: 0, remaining: 0 },
        deposit: { checked: 0, sent: 0, failed: 0, skipped: 0, remaining: 0 },
    };

    try {
        if (type === 'otp' || type === 'all') {
            const otpRes = await pool.query(
                `SELECT * FROM orders
                 WHERE status IN ('received', 'success', 'confirmed')
                   AND otp_code IS NOT NULL
                   AND TRIM(otp_code) <> ''
                   AND notified_at IS NULL
                   AND created_at > NOW() - INTERVAL '${dayNum} days'
                 ORDER BY created_at ASC
                 LIMIT $1`,
                [limitNum]
            );
            result.otp.checked = otpRes.rows.length;

            const remainingOtp = await pool.query(
                `SELECT COUNT(*) FROM orders
                 WHERE status IN ('received', 'success', 'confirmed')
                   AND otp_code IS NOT NULL
                   AND TRIM(otp_code) <> ''
                   AND notified_at IS NULL
                   AND created_at > NOW() - INTERVAL '${dayNum} days'`
            );
            result.otp.remaining = Math.max(0, Number(remainingOtp.rows[0].count) - otpRes.rows.length);

            if (!dry_run) {
                for (const order of otpRes.rows) {
                    try {
                        const user = await fetchUserForOrder(order);
                        const r = await notifyOtpSuccess(order, user);
                        if (r.sent) result.otp.sent++;
                        else if (r.reason === 'ALREADY_NOTIFIED') result.otp.skipped++;
                        else result.otp.failed++;
                    } catch (err) {
                        console.error(`Backfill OTP ${order.otp_id} error:`, err.message);
                        result.otp.failed++;
                    }
                    await new Promise(r => setTimeout(r, 50));
                }
            }
        }

        if (type === 'deposit' || type === 'all') {
            const depRes = await pool.query(
                `SELECT * FROM deposits
                 WHERE status = 'success'
                   AND notified_at IS NULL
                   AND created_at > NOW() - INTERVAL '${dayNum} days'
                 ORDER BY created_at ASC
                 LIMIT $1`,
                [limitNum]
            );
            result.deposit.checked = depRes.rows.length;

            const remainingDep = await pool.query(
                `SELECT COUNT(*) FROM deposits
                 WHERE status = 'success'
                   AND notified_at IS NULL
                   AND created_at > NOW() - INTERVAL '${dayNum} days'`
            );
            result.deposit.remaining = Math.max(0, Number(remainingDep.rows[0].count) - depRes.rows.length);

            if (!dry_run) {
                for (const deposit of depRes.rows) {
                    try {
                        const userRes = await pool.query(
                            'SELECT username, name, user_code FROM users WHERE id = $1',
                            [deposit.user_id]
                        );

                        const saldoMasuk = Number(deposit.amount) || 0;
                        const totalBayar = Number(deposit.total_amount) || saldoMasuk;
                        const fee = Number(deposit.fee) || 0;

                        const r = await notifyDepositSuccess(
                            deposit,
                            saldoMasuk,
                            totalBayar,
                            fee,
                            userRes.rows[0] || null
                        );
                        if (r.sent) result.deposit.sent++;
                        else if (r.reason === 'ALREADY_NOTIFIED') result.deposit.skipped++;
                        else result.deposit.failed++;
                    } catch (err) {
                        console.error(`Backfill deposit ${deposit.reference_id} error:`, err.message);
                        result.deposit.failed++;
                    }
                    await new Promise(r => setTimeout(r, 50));
                }
            }
        }

        res.json({
            message: dry_run ? 'Dry run selesai. Tidak ada notif yang dikirim.' : 'Backfill selesai',
            ...result,
        });
    } catch (err) {
        console.error('backfill-notifs error:', err.message);
        res.status(500).json({ error: err.message });
    }
}));

// admin reset notif
app.post('/api/admin/reset-notif', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const { type, key } = req.body;

    if (!['otp', 'deposit'].includes(type)) {
        return res.status(400).json({ error: 'type harus otp/deposit' });
    }
    if (!key) {
        return res.status(400).json({ error: 'key wajib (otp_id untuk OTP, reference_id untuk deposit)' });
    }

    try {
        let result;
        if (type === 'otp') {
            result = await pool.query(
                `UPDATE orders SET notified_at = NULL WHERE otp_id = $1 RETURNING id, otp_id, order_id`,
                [String(key)]
            );
        } else {
            result = await pool.query(
                `UPDATE deposits SET notified_at = NULL WHERE reference_id = $1 RETURNING id, reference_id`,
                [String(key)]
            );
        }

        if (result.rowCount === 0) {
            return res.status(404).json({ error: `${type} dengan key ${key} tidak ditemukan` });
        }

        res.json({
            message: 'Notif status direset. Bisa dikirim ulang.',
            type,
            key,
            affected: result.rowCount,
            data: result.rows[0],
        });
    } catch (err) {
        console.error('reset-notif error:', err.message);
        res.status(500).json({ error: err.message });
    }
}));

// admin webhook monitor
app.get('/api/admin/webhook-monitor', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const hours = Math.min(168, Math.max(1, parseInt(req.query.hours) || 1));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
    const type = String(req.query.type || 'all');
    const onlyNotified = req.query.only_notified === '1';
    const onlyUnnotified = req.query.only_unnotified === '1';

    try {
        const params = [];
        const whereParts = [];

        if (type === 'otp') {
            whereParts.push(`sl.entity_type = 'order'`);
        } else if (type === 'deposit') {
            whereParts.push(`sl.entity_type = 'deposit'`);
        } else {
            whereParts.push(`sl.entity_type IN ('order', 'deposit')`);
        }

        params.push(hours);
        whereParts.push(`sl.created_at > NOW() - make_interval(hours => $${params.length}::int)`);

        whereParts.push(`(
            (sl.entity_type = 'order' AND (
                sl.new_status IN ('received', 'success', 'confirmed', 'refunded', 'cancelled', 'expired', 'failed')
                OR sl.reason LIKE 'webhook%'
                OR sl.reason LIKE 'polling%'
                OR sl.reason LIKE 'cron_validate%'
                OR sl.reason LIKE 'sync_batch%'
                OR sl.reason LIKE 'check_status%'
                OR sl.reason LIKE 'provider_%'
                OR sl.reason = 'auto_sync'
            ))
            OR
            (sl.entity_type = 'deposit' AND (
                sl.new_status IN ('success', 'expired', 'cancelled', 'failed')
                OR sl.reason LIKE '%payment%'
                OR sl.reason LIKE 'expired_%'
                OR sl.reason LIKE 'manual_%'
            ))
        )`);

        if (onlyNotified) {
            whereParts.push(`(
                (sl.entity_type = 'order' AND (
                    SELECT o2.notified_at FROM orders o2
                    WHERE o2.order_id = sl.entity_id LIMIT 1
                ) IS NOT NULL)
                OR
                (sl.entity_type = 'deposit' AND (
                    SELECT d2.notified_at FROM deposits d2
                    WHERE d2.reference_id = sl.entity_id LIMIT 1
                ) IS NOT NULL)
            )`);
        } else if (onlyUnnotified) {
            whereParts.push(`(
                (sl.entity_type = 'order' AND (
                    SELECT o2.notified_at FROM orders o2
                    WHERE o2.order_id = sl.entity_id
                      AND o2.otp_code IS NOT NULL
                      AND TRIM(o2.otp_code) <> '' LIMIT 1
                ) IS NULL)
                OR
                (sl.entity_type = 'deposit' AND (
                    SELECT d2.notified_at FROM deposits d2
                    WHERE d2.reference_id = sl.entity_id
                      AND d2.status = 'success' LIMIT 1
                ) IS NULL)
            )`);
        }

        params.push(limit);
        const limitPlaceholder = `$${params.length}`;

        const query = `
            SELECT 
                sl.id, sl.entity_type, sl.entity_id, sl.user_id,
                sl.old_status, sl.new_status, sl.reason, sl.metadata, sl.created_at,
                u.username, u.user_code,
                o.otp_id AS order_otp_id,
                o.order_id AS order_provider_id,
                o.service_name AS order_service_name,
                o.phone_number AS order_phone,
                o.otp_code AS order_otp_code,
                o.server AS order_server,
                o.notified_at AS order_notified_at,
                d.reference_id AS deposit_ref,
                d.method AS deposit_method,
                d.amount AS deposit_amount,
                d.notified_at AS deposit_notified_at
            FROM status_logs sl
            LEFT JOIN users u ON u.id = sl.user_id
            LEFT JOIN orders o ON sl.entity_type = 'order' AND o.order_id = sl.entity_id
            LEFT JOIN deposits d ON sl.entity_type = 'deposit' AND d.reference_id = sl.entity_id
            WHERE ${whereParts.join(' AND ')}
            ORDER BY sl.created_at DESC
            LIMIT ${limitPlaceholder}
        `;

        const result = await pool.query(query, params);

        const statsQuery = `
            SELECT 
                DATE_TRUNC('hour', created_at AT TIME ZONE 'Asia/Jakarta') AS hour_bucket,
                entity_type,
                new_status,
                COUNT(*)::int AS count
            FROM status_logs
            WHERE entity_type IN ('order', 'deposit')
              AND created_at > NOW() - make_interval(hours => $1::int)
              AND (
                (entity_type = 'order' AND new_status IN ('received', 'success', 'confirmed'))
                OR (entity_type = 'deposit' AND new_status = 'success')
              )
            GROUP BY hour_bucket, entity_type, new_status
            ORDER BY hour_bucket DESC
            LIMIT 100
        `;
        const statsRes = await pool.query(statsQuery, [hours]);

        res.json({
            hours,
            type,
            total: result.rows.length,
            events: result.rows.map(r => ({
                id: r.id,
                entity_type: r.entity_type,
                entity_id: r.entity_id,
                old_status: r.old_status,
                new_status: r.new_status,
                reason: r.reason,
                metadata: r.metadata || null,
                created_at: r.created_at,
                user: { username: r.username || null, user_code: r.user_code || null },
                order: r.entity_type === 'order' ? {
                    otp_id: r.order_otp_id,
                    order_id: r.order_provider_id,
                    service_name: r.order_service_name,
                    phone: r.order_phone,
                    otp_code: r.order_otp_code,
                    server: r.order_server,
                    notified_at: r.order_notified_at,
                } : null,
                deposit: r.entity_type === 'deposit' ? {
                    reference_id: r.deposit_ref,
                    method: r.deposit_method,
                    amount: Number(r.deposit_amount) || 0,
                    notified_at: r.deposit_notified_at,
                } : null,
            })),
            hourly_stats: statsRes.rows.map(s => ({
                hour: s.hour_bucket,
                entity_type: s.entity_type,
                status: s.new_status,
                count: Number(s.count),
            })),
        });
    } catch (err) {
        console.error('Webhook monitor error:', err.message);
        res.status(500).json({ error: 'Server error', detail: err.message });
    }
}));

// admin kirim ulang notif order
app.post('/api/admin/notif-order/:otpId', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const otpId = String(req.params.otpId || '').trim();
    const forceResend = req.body?.force === true;

    if (!otpId) return res.status(400).json({ error: 'otp_id wajib' });

    try {
        const result = await pool.query('SELECT * FROM orders WHERE otp_id = $1 LIMIT 1', [otpId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Order dengan otp_id tersebut tidak ditemukan' });
        }

        const order = result.rows[0];

        if (!['received', 'success', 'confirmed'].includes(order.status)) {
            return res.status(400).json({
                error: `Order status "${order.status}" tidak bisa dikirim notif. Harus received/success/confirmed.`,
            });
        }
        if (!order.otp_code || !String(order.otp_code).trim()) {
            return res.status(400).json({ error: 'Order belum punya OTP code' });
        }

        if (forceResend && order.notified_at) {
            await pool.query('UPDATE orders SET notified_at = NULL WHERE id = $1', [order.id]);
            order.notified_at = null;
        }

        if (order.notified_at && !forceResend) {
            return res.status(409).json({
                error: 'Notif untuk order ini sudah pernah dikirim',
                notified_at: order.notified_at,
                hint: 'Kirim ulang dengan { "force": true }',
            });
        }

        const user = await fetchUserForOrder(order);
        const r = await notifyOtpSuccess(order, user);

        await logAdminAction({
            adminId: req.admin.id,
            adminUsername: req.admin.username,
            action: 'manual_send_otp_notif',
            targetType: 'order',
            targetId: otpId,
            metadata: { sent: r.sent, reason: r.reason, message_id: r.message_id },
        });

        if (!r.sent) {
            return res.status(500).json({ error: `Gagal kirim notif: ${r.reason}`, detail: r });
        }

        res.json({
            message: 'Notif OTP berhasil dikirim',
            otp_id: otpId,
            message_id: r.message_id,
        });
    } catch (err) {
        console.error('notif-order error:', err.message);
        res.status(500).json({ error: err.message });
    }
}));

// admin kirim ulang notif deposit
app.post('/api/admin/notif-deposit/:referenceId', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const referenceId = String(req.params.referenceId || '').trim();
    const forceResend = req.body?.force === true;

    if (!referenceId) return res.status(400).json({ error: 'reference_id wajib' });

    try {
        const result = await pool.query(
            'SELECT d.*, u.username, u.name AS user_name, u.user_code FROM deposits d LEFT JOIN users u ON u.id = d.user_id WHERE d.reference_id = $1 LIMIT 1',
            [referenceId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Deposit dengan reference_id tersebut tidak ditemukan' });
        }

        const row = result.rows[0];
        const deposit = { ...row };

        if (deposit.status !== 'success') {
            return res.status(400).json({
                error: `Deposit status "${deposit.status}" tidak bisa dikirim notif. Harus success.`,
            });
        }

        if (forceResend && deposit.notified_at) {
            await pool.query('UPDATE deposits SET notified_at = NULL WHERE id = $1', [deposit.id]);
            deposit.notified_at = null;
        }

        if (deposit.notified_at && !forceResend) {
            return res.status(409).json({
                error: 'Notif untuk deposit ini sudah pernah dikirim',
                notified_at: deposit.notified_at,
                hint: 'Kirim ulang dengan { "force": true }',
            });
        }

        const saldoMasuk = Number(deposit.amount) || 0;
        const totalBayar = Number(deposit.total_amount) || saldoMasuk;
        const fee = Number(deposit.fee) || 0;

        const r = await notifyDepositSuccess(
            deposit,
            saldoMasuk,
            totalBayar,
            fee,
            { username: row.username, name: row.user_name, user_code: row.user_code }
        );

        await logAdminAction({
            adminId: req.admin.id,
            adminUsername: req.admin.username,
            action: 'manual_send_deposit_notif',
            targetType: 'deposit',
            targetId: referenceId,
            metadata: { sent: r.sent, reason: r.reason, message_id: r.message_id },
        });

        if (!r.sent) {
            return res.status(500).json({ error: `Gagal kirim notif: ${r.reason}`, detail: r });
        }

        res.json({
            message: 'Notif deposit berhasil dikirim',
            reference_id: referenceId,
            message_id: r.message_id,
        });
    } catch (err) {
        console.error('notif-deposit error:', err.message);
        res.status(500).json({ error: err.message });
    }
}));

// admin batch kirim notif
app.post('/api/admin/batch-send-notif', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const { type, ids } = req.body;

    if (!['otp', 'deposit'].includes(type)) {
        return res.status(400).json({ error: 'type harus otp/deposit' });
    }
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'ids wajib array dan tidak boleh kosong' });
    }

    const limitedIds = ids.slice(0, 20);
    const results = [];

    for (const id of limitedIds) {
        try {
            if (type === 'otp') {
                const orderRes = await pool.query('SELECT * FROM orders WHERE otp_id = $1 LIMIT 1', [String(id)]);
                if (orderRes.rows.length === 0) {
                    results.push({ id, sent: false, reason: 'NOT_FOUND' });
                    continue;
                }
                const order = orderRes.rows[0];
                if (!order.otp_code || !['received', 'success', 'confirmed'].includes(order.status)) {
                    results.push({ id, sent: false, reason: 'INVALID_STATUS_OR_NO_OTP' });
                    continue;
                }
                const user = await fetchUserForOrder(order);
                const r = await notifyOtpSuccess(order, user);
                results.push({ id, sent: r.sent, reason: r.reason, message_id: r.message_id });
            } else {
                const depRes = await pool.query(
                    'SELECT d.*, u.username, u.name AS user_name, u.user_code FROM deposits d LEFT JOIN users u ON u.id = d.user_id WHERE d.reference_id = $1 LIMIT 1',
                    [String(id)]
                );
                if (depRes.rows.length === 0) {
                    results.push({ id, sent: false, reason: 'NOT_FOUND' });
                    continue;
                }
                const row = depRes.rows[0];
                if (row.status !== 'success') {
                    results.push({ id, sent: false, reason: 'NOT_SUCCESS' });
                    continue;
                }
                const r = await notifyDepositSuccess(
                    row,
                    Number(row.amount) || 0,
                    Number(row.total_amount) || Number(row.amount) || 0,
                    Number(row.fee) || 0,
                    { username: row.username, name: row.user_name, user_code: row.user_code }
                );
                results.push({ id, sent: r.sent, reason: r.reason, message_id: r.message_id });
            }
        } catch (err) {
            results.push({ id, sent: false, reason: 'ERROR', error: err.message });
        }

        await new Promise(r => setTimeout(r, 50));
    }

    const sentCount = results.filter(r => r.sent).length;
    const failedCount = results.filter(r => !r.sent).length;

    await logAdminAction({
        adminId: req.admin.id,
        adminUsername: req.admin.username,
        action: 'batch_send_notif',
        targetType: type,
        targetId: `${sentCount}/${limitedIds.length}`,
        metadata: { type, total: limitedIds.length, sent: sentCount, failed: failedCount },
    });

    res.json({
        total: limitedIds.length,
        sent: sentCount,
        failed: failedCount,
        results,
    });
}));

// cron endpoints
app.post('/api/cron/validate-pending-orders', requireCron, withDB(async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM orders 
             WHERE status = 'pending' AND created_at > NOW() - INTERVAL '30 minutes'
             ORDER BY expired_at ASC NULLS LAST
             LIMIT 50`
        );

        let updated = 0, expired = 0, refunded = 0;
        const chunks = [];
        for (let i = 0; i < result.rows.length; i += 10) {
            chunks.push(result.rows.slice(i, i + 10));
        }

        for (const chunk of chunks) {
            await Promise.all(chunk.map(async (order) => {
                try {
                    if (order.expired_at && new Date(order.expired_at) < new Date()) {
                        const cancelRes = await autoCancelAndRefund(order);
                        if (cancelRes.refunded) refunded++;
                        expired++;
                        return;
                    }

                    const data = await providerOrderStatus(order);

                    if (data.status !== order.status || data.otp_code) {
                        await pool.query(
                            `UPDATE orders 
                             SET status = $1, otp_code = $2, otp_code_2 = $3, full_sms = $4, 
                                 received_at = CASE WHEN $1 IN ('received', 'success') THEN NOW() ELSE received_at END, 
                                 last_checked_at = NOW(), updated_at = NOW() 
                             WHERE id = $5`,
                            [data.status, data.otp_code, data.otp_code_2, data.full_sms, order.id]
                        );
                        await pool.query(
                            `UPDATE transactions 
                             SET status = CASE 
                                WHEN $1 IN ('received', 'success') THEN 'success' 
                                WHEN $1 IN ('cancelled', 'expired', 'refunded') THEN 'failed' 
                                ELSE status 
                             END, otp_code = $2, updated_at = NOW() 
                             WHERE order_id = $3`,
                            [data.status, data.otp_code, String(order.order_id)]
                        );

                        if (data.status !== order.status) {
                            await logStatusChange({
                                entityType: 'order', entityId: String(order.order_id), userId: order.user_id,
                                oldStatus: order.status, newStatus: data.status, reason: 'cron_validate',
                                metadata: { otp_code: data.otp_code || null, otp_id: order.otp_id },
                            });
                        }

                        if (['cancelled', 'expired', 'refunded'].includes(data.status)) {
                            const fresh = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [order.id]);
                            if (fresh.rows[0]) {
                                const refundRes = await refundOrder(fresh.rows[0], 'provider_' + data.status);
                                if (refundRes.refunded) refunded++;
                            }
                            expired++;
                        } else {
                            updated++;
                            if (data.otp_code && ['received', 'success', 'confirmed'].includes(data.status)) {
                                const fresh = await pool.query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [order.id]);
                                if (fresh.rows[0]) {
                                    try {
                                        const user = await fetchUserForOrder(fresh.rows[0]);
                                        await notifyOtpSuccess(fresh.rows[0], user);
                                    } catch (err) {
                                        console.error('❌ Notif OTP (cron) error:', err.message);
                                    }
                                }
                            }
                        }
                    } else {
                        await pool.query(`UPDATE orders SET last_checked_at = NOW() WHERE id = $1`, [order.id]);
                    }
                } catch (err) {
                    console.error(`Validate ${order.order_id}:`, err.message);
                }
            }));
        }

        res.json({ checked: result.rows.length, updated, expired, refunded });
    } catch (err) {
        console.error('Auto-validate error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/cron/auto-refund-all', requireCron, withDB(async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM orders 
             WHERE status IN ('cancelled', 'failed', 'expired')
               AND (refunded_at IS NULL OR refunded_at = 0)
               AND price > 0
             LIMIT 100`
        );

        let refunded = 0, totalAmount = 0;
        const chunks = [];
        for (let i = 0; i < result.rows.length; i += 10) {
            chunks.push(result.rows.slice(i, i + 10));
        }

        for (const chunk of chunks) {
            const results = await Promise.all(chunk.map(async (order) => {
                try {
                    return await refundOrder(order, 'cron_auto_refund_' + order.status);
                } catch (err) {
                    console.error(`Refund ${order.order_id}:`, err.message);
                    return { refunded: false, amount: 0 };
                }
            }));

            for (const r of results) {
                if (r.refunded) {
                    refunded++;
                    totalAmount += r.amount;
                }
            }
        }

        res.json({ checked: result.rows.length, refunded, total_amount: totalAmount });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/cron/expire-pending-deposits', requireCron, withDB(async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM deposits 
             WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()
             LIMIT 50`
        );

        let expired = 0, synced = 0;
        const chunks = [];
        for (let i = 0; i < result.rows.length; i += 10) {
            chunks.push(result.rows.slice(i, i + 10));
        }

        for (const chunk of chunks) {
            const results = await Promise.all(chunk.map(d => syncDepositStatus(d).catch(err => d)));
            for (const fresh of results) {
                if (fresh.status === 'success') synced++;
                else if (fresh.status === 'expired') expired++;
            }
        }

        res.json({ checked: result.rows.length, expired, synced });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/cron/sync-pending-qrispy', requireCron, withDB(async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM deposits 
             WHERE method = 'qrispy' AND status = 'pending' AND qris_id IS NOT NULL
               AND created_at > NOW() - INTERVAL '1 hour'
             ORDER BY created_at DESC LIMIT 30`
        );

        let synced = 0, expired = 0;
        const chunks = [];
        for (let i = 0; i < result.rows.length; i += 5) {
            chunks.push(result.rows.slice(i, i + 5));
        }

        for (const chunk of chunks) {
            const results = await Promise.all(chunk.map(d => syncDepositStatus(d).catch(err => d)));
            for (const fresh of results) {
                if (fresh.status === 'success') synced++;
                else if (fresh.status === 'expired') expired++;
            }
        }

        res.json({ checked: result.rows.length, synced, expired });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

// cron auto sync all
app.post('/api/cron/auto-sync', requireCron, withDB(async (req, res) => {
    try {
        await autoSyncAll();
        res.json({ message: 'Auto sync selesai', time: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

// cron sync stats
app.post('/api/cron/sync-stats', requireCron, withDB(async (req, res) => {
    try {
        const [ordersPending, depositsPending, ordersNotified, depositsNotified] = await Promise.all([
            pool.query(`SELECT COUNT(*) FROM orders WHERE status = 'pending'`),
            pool.query(`SELECT COUNT(*) FROM deposits WHERE status = 'pending'`),
            pool.query(`SELECT COUNT(*) FROM orders WHERE status IN ('received','success','confirmed') AND otp_code IS NOT NULL AND notified_at IS NULL`),
            pool.query(`SELECT COUNT(*) FROM deposits WHERE status = 'success' AND notified_at IS NULL`),
        ]);
        res.json({
            pending_orders: Number(ordersPending.rows[0].count),
            pending_deposits: Number(depositsPending.rows[0].count),
            unnotified_orders: Number(ordersNotified.rows[0].count),
            unnotified_deposits: Number(depositsNotified.rows[0].count),
            price_lock_size: priceLockCache.size,
            price_lock_max: PRICE_LOCK_MAX_SIZE,
        });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

// global error handler + 404
app.use((err, req, res, next) => {
    const status = err?.status || 500;
    const safeErr = {
        message: err?.message || 'unknown',
        name: err?.name || 'Error',
        status,
        path: req.path,
        method: req.method,
    };
    console.error('Unhandled error:', JSON.stringify(safeErr));

    res.status(status < 500 ? status : 500).json({
        error: status < 500 ? (err.message || 'Bad request') : 'Internal server error',
    });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

// startup warmup + background auto sync
(async () => {
    try {
        await ensureSchema();
        await getServiceCodeMap().catch(() => {});
        console.log('🚀 Server ready v18 (depo1 only, qris dana removed)');
        console.log(`💰 Markup nokos: ${MARKUP_PERCENT * 100}% PURE (round to rupiah)`);
        console.log(`💰 Fee deposit: Rp${DEPOSIT_FEE_MIN}-${DEPOSIT_FEE_MAX}`);
        console.log(`🔒 Price lock: persistent (no TTL), max ${PRICE_LOCK_MAX_SIZE} entries`);
        console.log(`🌐 Servers: ${Object.keys(SERVER_CONFIG).join(', ')}`);
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHANNEL_ID) {
            console.log(`📢 Telegram notif aktif → channel OTP: ${TELEGRAM_CHANNEL_OTP_ID}, deposit: ${TELEGRAM_CHANNEL_DEPOSIT_ID}`);
        } else {
            console.warn('⚠️  Telegram notif belum aktif (env belum di-set)');
        }
        setInterval(() => {
            autoSyncAll().catch(err => console.error('Background auto-sync error:', err.message));
        }, SYNC_INTERVAL_MS);
        setTimeout(() => { autoSyncAll().catch(() => {}); }, 5000);
    } catch (err) {
        console.error('❌ Startup warmup failed:', err.message);
    }
})();

// cleanup berkala
setInterval(async () => {
    try {
        await pool.query(`DELETE FROM token_blacklist WHERE expires_at < NOW()`);
        await pool.query(`DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '7 days' OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days')`);
        await pool.query(`DELETE FROM webhook_events WHERE created_at < NOW() - INTERVAL '90 days'`);
    } catch (err) {}
}, 60 * 60 * 1000);

module.exports = app;
