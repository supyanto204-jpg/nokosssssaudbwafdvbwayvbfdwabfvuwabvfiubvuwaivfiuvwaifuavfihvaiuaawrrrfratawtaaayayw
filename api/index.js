// ============================================
// ASYROFOTP - BACKEND API (FULL FIXED v11)
// + icon_code mapping (code asli tidak tertimpa)
// + Handle INSUFFICIENT_BALANCE dari provider
// + Pre-check saldo user + cache harga
// ============================================

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();

// ===== PERFORMANCE: Disable etag & x-powered-by =====
app.disable('x-powered-by');
app.set('etag', false);

// ===== CORS =====
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-qrispy-signature, x-banana-signature, x-otp1-signature, x-cron-secret');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ===== BODY PARSER =====
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf8');
    },
    limit: '512kb'
}));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

// ===== DATABASE =====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 10000,
    keepAlive: true,
});

pool.on('error', (err) => {
    console.error('Unexpected pool error:', err.message);
});

// ===== JWT =====
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('⚠️  JWT_SECRET belum di-set!');
}
const JWT_SECRET_FINAL = JWT_SECRET || 'asyrofotp-secret-ganti-di-env';
const JWT_EXPIRES = '7d';

// ===== CRON SECRET =====
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
    console.error('⚠️  CRON_SECRET belum di-set!');
}

// ===== REST COUNTRIES API =====
const API_CDN = process.env.API_CDN;

// ===== DIBANANA =====
const DIBANANA_BASE = 'https://dibanana.id/api/v1';
const DIBANANA_API_KEY = process.env.API_SERVER_EKONOMI;

const SERVER_CONFIG = {
    ekonomi: { label: 'Server Ekonomi', desc: 'Harga terjangkau, khusus Indonesia', badge: 'EKONOMI', countries: ['id'] },
    premium: { label: 'Server Premium', desc: 'Bisa pilih operator, kualitas terjamin', badge: 'PREMIUM', countries: ['id'], requiresOperator: true },
    khusus: { label: 'Server Khusus', desc: 'Semua negara, stok lengkap', badge: 'LENGKAP', countries: null },
    wa_luar: { label: 'Server WA Luar', desc: 'WhatsApp luar negeri (non-Indonesia)', badge: 'LUAR', countries: null, excludeCountries: ['id'] },
};

const VALID_OPERATORS = ['any', 'telkomsel', 'indosat', 'axis', 'three', 'smartfren', 'byu'];

const COUNTRY_NAMES = {
    id: 'Indonesia', ru: 'Russia', us: 'United States', my: 'Malaysia',
    vn: 'Vietnam', ph: 'Philippines', th: 'Thailand', sg: 'Singapore',
    in: 'India', cn: 'China', jp: 'Japan', kr: 'South Korea',
    uk: 'United Kingdom', de: 'Germany', fr: 'France', br: 'Brazil', ng: 'Nigeria',
};

// ===== QRISPY =====
const QRISPY_BASE = 'https://cloudflareworkerdeploydidashcloudflarecomexportdef.rahayucahyapurwa.workers.dev';
const QRISPY_WEBHOOK_SECRET = process.env.PW_WEBHOOK;

// ===== WEBHOOK OTP =====
const WEBHOOK_OTP1_SECRET = process.env.WEBHOOK_OTP1;

// ===== AUTO CONFIG =====
const ORDER_EXPIRY_MS = 15 * 60 * 1000;
const REVIVE_GRACE_PERIOD_MS = 60 * 60 * 1000;
const QRIS_DANA_EXPIRY_MS = 30 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 8000;

// ===== QRIS DANA MANUAL =====
const STATIC_QRIS_DANA = '00020101021126570011ID.DANA.WWW011893600915399681262102099968126210303UMI51440014ID.CO.QRIS.WWW0215ID10254335825880303UMI5204549953093605802ID5912TOKO MoonRed6011KAB. BANTUL6105551856304C670';

// ============================================
// ===== IN-MEMORY CACHE =====
// ============================================
const cache = new Map();

function cacheGet(key) {
    const item = cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) { cache.delete(key); return null; }
    return item.value;
}

function cacheSet(key, value, ttlMs) {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function cacheDelPattern(prefix) {
    for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
        if (now > v.expiresAt) cache.delete(k);
    }
}, 5 * 60 * 1000);

// ============================================
// ===== SERVICE NAME → ICON CODE MAPPING =====
// ===== Server ekonomi: code = "wa", "tt", "ig" (huruf → untuk icon)
// ===== Server khusus: code = "1", "2", "3" (angka → untuk API call)
// ===== Kita mapping NAME → kode HURUF untuk icon, tanpa nimpa code asli
// ============================================

/**
 * Normalisasi nama service jadi key lookup.
 * Contoh: "WhatsApp" → "whatsapp", "X (Twitter)" → "xtwitter"
 */
function normalizeServiceName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

/**
 * Ambil mapping name → icon_code HURUF dari server ekonomi.
 * Server ekonomi: kode = "wa", "tt", "ig" (huruf).
 * Cache di memory 5 menit.
 */
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

            // Simpan map by name (normalized)
            const normName = normalizeServiceName(name);
            if (normName) map[normName] = code;

            // Simpan juga map by code itu sendiri (biar bisa cari by code juga)
            const normCode = normalizeServiceName(code);
            if (normCode) map[normCode] = code;
        }
        cacheSet(cacheKey, map, 5 * 60 * 1000);
        console.log(`✅ Service code map loaded: ${Object.keys(map).length} entries`);
        return map;
    } catch (err) {
        console.error('Get service code map error:', err.message);
        return {};
    }
}

/**
 * Enrich services dengan `icon_code` hasil matching dari map ekonomi.
 * - `code` tetap code asli dari provider (angka untuk server khusus, huruf untuk ekonomi)
 * - `icon_code` = kode huruf dari ekonomi (untuk load gambar icon)
 *
 * Tidak menimpa `code` asli — cuma nambah field baru `icon_code`.
 */
async function enrichServicesWithCode(services, server) {
    if (!services || services.length === 0) return services;

    // Server ekonomi = sumber kebenaran, code-nya udah huruf (wa, tt, ig)
    if (server === 'ekonomi') {
        return services.map(s => ({
            ...s,
            icon_code: s.code || null,
        }));
    }

    // Server lain: butuh mapping dari ekonomi berdasarkan NAME
    const codeMap = await getServiceCodeMap();

    return services.map(s => {
        // Cari icon_code berdasarkan name
        const normName = normalizeServiceName(s.name);
        const mappedIconCode = codeMap[normName] || null;

        return {
            ...s,
            // code asli dari provider — JANGAN diubah
            code: s.code,
            // icon_code = kode huruf dari ekonomi, buat load gambar
            icon_code: mappedIconCode,
        };
    });
}

// ============================================
// ===== STATIC DATA =====
// ============================================
const DEPOSIT_METHODS = [
    { id: 'qrispy', label: 'QRIS Otomatis', desc: 'Bayar pakai QRIS, saldo masuk otomatis', icon: 'qrispy', fee: 0 },
    { id: 'qris_dana', label: 'QRIS DANA Manual', desc: 'Scan QR DANA, butuh konfirmasi admin', icon: 'dana', fee: 0, uniqueCode: true },
];

const DEPOSIT_PRESETS = {
    presets: [
        { amount: 10000, label: 'Rp10.000' },
        { amount: 20000, label: 'Rp20.000' },
        { amount: 50000, label: 'Rp50.000' },
        { amount: 100000, label: 'Rp100.000' },
        { amount: 200000, label: 'Rp200.000' },
        { amount: 500000, label: 'Rp500.000' },
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
    requiresOperator: !!config.requiresOperator,
}));

// ============================================
// ===== RATE LIMITER =====
// ============================================
const rateLimitStore = new Map();
function rateLimit(maxRequests, windowMs) {
    return (req, res, next) => {
        const key = req.ip + ':' + req.path;
        const now = Date.now();
        const record = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };

        if (now > record.resetAt) {
            record.count = 0;
            record.resetAt = now + windowMs;
        }

        record.count++;
        rateLimitStore.set(key, record);

        if (record.count > maxRequests) {
            return res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
        }
        next();
    };
}

setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
        if (now > record.resetAt) rateLimitStore.delete(key);
    }
}, 5 * 60 * 1000);

// ============================================
// ===== QRIS EMVCo CONVERTER =====
// ============================================
function crc16(str) {
    let crc = 0xFFFF;
    const poly = 0x1021;
    for (let i = 0; i < str.length; i++) {
        crc ^= str.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ poly) & 0xFFFF : (crc << 1) & 0xFFFF;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

function parseTLV(str) {
    const result = [];
    let i = 0;
    while (i < str.length) {
        const tag = str.substr(i, 2);
        const len = parseInt(str.substr(i + 2, 2), 10);
        const value = str.substr(i + 4, len);
        result.push({ tag, length: len, value });
        i += 4 + len;
    }
    return result;
}

function buildTLV(tlvArray) {
    return tlvArray.map(t => {
        const len = t.value.length.toString().padStart(2, '0');
        return t.tag + len + t.value;
    }).join('');
}

function toDynamicQRIS(staticQRIS, amount) {
    if (!staticQRIS || typeof staticQRIS !== 'string') throw new Error('QRIS string tidak valid');
    if (!amount || amount <= 0) throw new Error('Nominal harus lebih dari 0');

    let payload = staticQRIS;
    const crcIndex = payload.lastIndexOf('6304');
    if (crcIndex === -1) throw new Error('QRIS tidak punya tag CRC (63)');
    payload = payload.substring(0, crcIndex);

    let tlv = parseTLV(payload);

    const tag01 = tlv.find(t => t.tag === '01');
    if (tag01) tag01.value = '12';
    else {
        const idx00 = tlv.findIndex(t => t.tag === '00');
        tlv.splice(idx00 + 1, 0, { tag: '01', value: '12' });
    }

    tlv = tlv.filter(t => t.tag !== '54');
    const tag54 = { tag: '54', value: amount.toString() };

    const idx58 = tlv.findIndex(t => t.tag === '58');
    if (idx58 !== -1) tlv.splice(idx58, 0, tag54);
    else {
        const idx59 = tlv.findIndex(t => t.tag === '59');
        if (idx59 !== -1) tlv.splice(idx59, 0, tag54);
        else tlv.push(tag54);
    }

    const rebuilt = buildTLV(tlv);
    const withCRCHeader = rebuilt + '6304';
    return withCRCHeader + crc16(withCRCHeader);
}

// ============================================
// ===== FETCH HELPERS =====
// ============================================
async function qrispyFetch(endpoint, options = {}) {
    const fullUrl = `${QRISPY_BASE}${endpoint}`;
    console.log('🌐 QRISPY:', fullUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

    try {
        const res = await fetch(fullUrl, {
            ...options,
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        });

        const text = await res.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            const err = new Error(`QRISPY error ${res.status}: response bukan JSON`);
            err.status = res.status;
            err.raw = text.substring(0, 500);
            throw err;
        }

        if (!res.ok || data.status === 'error') {
            const err = new Error(data.message || 'QRISPY error');
            err.status = res.status;
            err.data = data;
            throw err;
        }

        return data;
    } finally {
        clearTimeout(timeout);
    }
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
        try {
            data = await res.json();
        } catch (e) {
            const err = new Error(`Provider error: ${res.status}`);
            err.status = res.status;
            throw err;
        }

        if (!res.ok || data.ok === false) {
            const err = new Error(data.message || data.error || 'Provider error');
            err.status = res.status;
            err.code = data.error;
            err.data = data;
            throw err;
        }

        return data;
    } finally {
        clearTimeout(timeout);
    }
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

// ============================================
// ===== HELPERS =====
// ============================================
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

function generateUniqueCode() {
    return Math.floor(Math.random() * 900) + 100;
}

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

// ============================================
// ===== TOKEN BLACKLIST =====
// ============================================
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

// ============================================
// ===== SCHEMA =====
// ============================================
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
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            columns: [
                { name: 'user_code', def: 'TEXT' },
                { name: 'role', def: "TEXT DEFAULT 'user'" },
                { name: 'status', def: "TEXT DEFAULT 'active'" },
                { name: 'name', def: 'TEXT' },
                { name: 'balance', def: 'BIGINT DEFAULT 0' },
                { name: 'created_at', def: 'TIMESTAMPTZ DEFAULT NOW()' },
                { name: 'updated_at', def: 'TIMESTAMPTZ DEFAULT NOW()' },
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
                status TEXT DEFAULT 'pending',
                expires_in INTEGER DEFAULT 0,
                resend_count INTEGER DEFAULT 0,
                refunded_at BIGINT,
                refunded_amount BIGINT,
                refund_reason TEXT,
                revived_at TIMESTAMPTZ,
                revived_count INTEGER DEFAULT 0,
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
                { name: 'status', def: "TEXT DEFAULT 'pending'" },
                { name: 'expires_in', def: 'INTEGER DEFAULT 0' },
                { name: 'resend_count', def: 'INTEGER DEFAULT 0' },
                { name: 'refunded_at', def: 'BIGINT' },
                { name: 'refunded_amount', def: 'BIGINT' },
                { name: 'refund_reason', def: 'TEXT' },
                { name: 'revived_at', def: 'TIMESTAMPTZ' },
                { name: 'revived_count', def: 'INTEGER DEFAULT 0' },
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
            name: 'deposits',
            create: `CREATE TABLE IF NOT EXISTS deposits (
                id SERIAL PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                reference_id TEXT UNIQUE,
                method TEXT NOT NULL,
                amount BIGINT NOT NULL,
                unique_code INTEGER,
                total_amount BIGINT,
                fee BIGINT DEFAULT 0,
                status TEXT DEFAULT 'pending',
                qris_id TEXT,
                qris_url TEXT,
                qris_string TEXT,
                payment_reference TEXT,
                paid_at TIMESTAMPTZ,
                expires_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            columns: [
                { name: 'unique_code', def: 'INTEGER' },
                { name: 'total_amount', def: 'BIGINT' },
                { name: 'fee', def: 'BIGINT DEFAULT 0' },
                { name: 'qris_id', def: 'TEXT' },
                { name: 'qris_url', def: 'TEXT' },
                { name: 'qris_string', def: 'TEXT' },
                { name: 'payment_reference', def: 'TEXT' },
                { name: 'paid_at', def: 'TIMESTAMPTZ' },
                { name: 'expires_at', def: 'TIMESTAMPTZ' },
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
    ],
    indexes: [
        'CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id)',
        'CREATE INDEX IF NOT EXISTS idx_orders_otp_id ON orders(otp_id)',
        'CREATE INDEX IF NOT EXISTS idx_orders_status_expiry ON orders(status, expired_at)',
        'CREATE INDEX IF NOT EXISTS idx_orders_refunded ON orders(user_id, refunded_at)',
        'CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_deposits_ref ON deposits(reference_id)',
        'CREATE INDEX IF NOT EXISTS idx_deposits_qris ON deposits(qris_id)',
        'CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status, expires_at)',
        'CREATE INDEX IF NOT EXISTS idx_status_logs_entity ON status_logs(entity_type, entity_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_status_logs_user ON status_logs(user_id, created_at DESC)',
        'CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at)',
    ],
};

// ============================================
// ===== ENSURE SCHEMA =====
// ============================================
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

// ============================================
// ===== withDB WRAPPER =====
// ============================================
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

// ===== CRON AUTH =====
function requireCron(req, res, next) {
    if (!CRON_SECRET) {
        return res.status(500).json({ error: 'CRON_SECRET belum di-set' });
    }
    const provided = req.headers['x-cron-secret'] || req.query.secret;
    if (!provided) return res.status(401).json({ error: 'Cron secret wajib' });
    if (provided !== CRON_SECRET) return res.status(401).json({ error: 'Cron secret invalid' });
    next();
}

// ============================================
// ===== MIDDLEWARE =====
// ============================================
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

// ============================================
// ===== MARK DEPOSIT PAID =====
// ============================================
async function markDepositPaid(deposit, receivedAmount, paidAt) {
    const saldoMasuk = Number(deposit.amount);
    const totalBayar = Number(receivedAmount) || Number(deposit.total_amount) || saldoMasuk;
    const fee = Math.max(0, totalBayar - saldoMasuk);
    const paidTime = paidAt ? new Date(paidAt) : new Date();

    const client = await pool.connect();
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

        await client.query(
            `UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
            [saldoMasuk, deposit.user_id]
        );

        await client.query(
            `INSERT INTO transactions (user_id, order_id, service_name, status, price)
             VALUES ($1, $2, $3, $4, $5)`,
            [deposit.user_id, deposit.reference_id, `Deposit ${deposit.method === 'qrispy' ? 'QRIS' : 'QRIS DANA'}`, 'success', totalBayar]
        );

        await client.query(
            `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            ['deposit', deposit.reference_id, deposit.user_id, deposit.status, 'success', 'payment_received',
             JSON.stringify({ saldoMasuk, totalBayar, fee, method: deposit.method })]
        );

        await client.query('COMMIT');
        console.log(`✅ Deposit ${deposit.reference_id} | +${saldoMasuk} | fee ${fee}`);
        return { alreadyProcessed: false, saldoMasuk, totalBayar, fee };
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('markDepositPaid error:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// ============================================
// ===== SYNC DEPOSIT =====
// ============================================
async function syncDepositStatus(deposit) {
    if (['success', 'cancelled', 'failed', 'refunded'].includes(deposit.status)) return deposit;

    const now = new Date();
    const expiresAt = deposit.expires_at ? new Date(deposit.expires_at) : null;

    if (deposit.method === 'qris_dana') {
        if (deposit.status === 'pending' && expiresAt && expiresAt < now) {
            const upd = await pool.query(
                `UPDATE deposits SET status = 'expired', updated_at = NOW() 
                 WHERE id = $1 AND status = 'pending' RETURNING *`,
                [deposit.id]
            );
            if (upd.rows[0]) {
                await logStatusChange({ entityType: 'deposit', entityId: deposit.reference_id, userId: deposit.user_id, oldStatus: 'pending', newStatus: 'expired', reason: 'expired_qris_dana' });
            }
            return upd.rows[0] || deposit;
        }
        return deposit;
    }

    if (deposit.method === 'qrispy' && deposit.status === 'pending') {
        if (expiresAt && expiresAt < now) {
            if (deposit.qris_id) {
                try {
                    const data = await qrispyFetch(`/api/payment/qris/${deposit.qris_id}/status`);
                    if (data.data?.status === 'paid') {
                        await markDepositPaid(deposit, data.data.received_amount || data.data.amount, data.data.paid_at);
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
                    await markDepositPaid(deposit, data.data.received_amount || data.data.amount, data.data.paid_at);
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

// ============================================
// ===== REFUND ORDER =====
// ============================================
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

// ============================================
// ===== AUTO-CANCEL & REFUND =====
// ============================================
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
        const cancelData = await dibananaFetch('/cancel', {
            method: 'POST',
            body: JSON.stringify({ order_id: Number(o.order_id) })
        });
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

// ============================================
// ===== CHECK & REFUND ALL PENDING =====
// ============================================
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

// ============================================
// ===== HEALTH =====
// ============================================
app.get('/api/health', withDB(async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() as time');
        res.json({
            status: 'ok',
            time: result.rows[0].time,
            hasDibananaKey: !!DIBANANA_API_KEY,
            hasWebhookSecret: !!QRISPY_WEBHOOK_SECRET,
            hasWebhookOtp1: !!WEBHOOK_OTP1_SECRET,
            hasJwtSecret: !!JWT_SECRET,
            hasCronSecret: !!CRON_SECRET,
            hasApiCdn: !!API_CDN,
            schemaEnsured,
            poolTotal: pool.totalCount,
            poolIdle: pool.idleCount,
            poolWaiting: pool.waitingCount,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}));

// ============================================
// ===== AUTH =====
// ============================================
app.post('/api/auth/register', rateLimit(10, 60 * 1000), withDB(async (req, res) => {
    const { username, password, name } = req.body;

    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
    if (!isValidUsername(username)) return res.status(400).json({ error: 'Username hanya boleh huruf, angka, underscore (3-20 karakter)' });
    if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });
    if (password.length > 100) return res.status(400).json({ error: 'Password maksimal 100 karakter' });

    try {
        const hash = await bcrypt.hash(password, 8);
        const result = await pool.query(
            `INSERT INTO users (username, password_hash, name)
             VALUES ($1, $2, $3)
             RETURNING id, username, name, balance, user_code`,
            [username.toLowerCase(), hash, name || username]
        );
        res.json({ message: 'Registrasi berhasil!', user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Username sudah dipakai' });
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/auth/login', rateLimit(20, 60 * 1000), withDB(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });

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

        const token = signToken(user);
        res.json({
            message: 'Login berhasil!',
            session: { access_token: token },
            user: { id: user.id, username: user.username, name: user.name, balance: user.balance, user_code: user.user_code }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/auth/logout', requireAuth, withDB(async (req, res) => {
    try {
        if (req.user.jti) {
            const decoded = jwt.decode(req.headers.authorization.replace('Bearer ', ''));
            const exp = decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            await blacklistToken(req.user.jti, exp);
        }
        res.json({ message: 'Logout berhasil' });
    } catch (err) {
        console.error('Logout error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}));

// ============================================
// ===== USER =====
// ============================================
app.get('/api/user', requireAuth, withDB(async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, name, balance, role, user_code, created_at FROM users WHERE id = $1 LIMIT 1',
            [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/user/update', requireAuth, withDB(async (req, res) => {
    const { name } = req.body;
    if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Nama minimal 2 karakter' });
    if (name.trim().length > 50) return res.status(400).json({ error: 'Nama maksimal 50 karakter' });

    try {
        const result = await pool.query(
            'UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, name, balance, user_code',
            [name.trim(), req.user.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'User tidak ditemukan' });
        res.json({ message: 'Profil berhasil diupdate', user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/user/change-password', requireAuth, withDB(async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Semua field wajib diisi' });
    if (new_password.length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter' });

    try {
        const result = await pool.query('SELECT password_hash FROM users WHERE id = $1 LIMIT 1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });

        const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Password lama salah' });

        const newHash = await bcrypt.hash(new_password, 8);
        await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);
        res.json({ message: 'Password berhasil diubah' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.get('/api/dashboard', requireAuth, withDB(async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT order_id, service_name, country, country_flag, phone_number, status, price, otp_code, created_at
             FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
            [req.user.id]
        );
        const transactions = result.rows;
        const stats = {
            total: transactions.length,
            success: transactions.filter(t => t.status === 'success').length,
            pending: transactions.filter(t => t.status === 'pending').length,
            failed: transactions.filter(t => t.status === 'failed').length
        };
        res.json({ stats, transactions: transactions.slice(0, 5) });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

// ============================================
// ===== DEPOSIT =====
// ============================================
app.get('/api/deposit/methods', requireAuth, (req, res) => {
    res.json({ methods: DEPOSIT_METHODS });
});

app.get('/api/deposit/presets', requireAuth, (req, res) => {
    res.json(DEPOSIT_PRESETS);
});

app.post('/api/deposit/generate-ref', requireAuth, withDB(async (req, res) => {
    try {
        const referenceId = await generateUniqueReferenceId();
        res.json({ reference_id: referenceId });
    } catch (err) {
        res.status(500).json({ error: 'Gagal generate reference ID' });
    }
}));

app.post('/api/deposit/qrispy-save', requireAuth, withDB(async (req, res) => {
    const { reference_id, amount, qris_id, qris_url, expired_at, expires_in_seconds } = req.body;

    if (!reference_id || !amount || !qris_id) return res.status(400).json({ error: 'Data tidak lengkap' });
    if (amount < 1000 || amount > 10000000) return res.status(400).json({ error: 'Nominal tidak valid' });

    try {
        const existing = await pool.query('SELECT * FROM deposits WHERE reference_id = $1 LIMIT 1', [reference_id]);
        if (existing.rows.length > 0) {
            const d = existing.rows[0];
            return res.json({
                message: 'Deposit sudah tercatat',
                deposit: { reference_id: d.reference_id, method: d.method, amount: Number(d.amount), qris_id: d.qris_id, qris_url: d.qris_url, expired_at: d.expires_at, expires_in_seconds: expires_in_seconds || 900 },
            });
        }

        await pool.query(
            `INSERT INTO deposits (user_id, reference_id, method, amount, total_amount, fee, status, qris_id, qris_url, payment_reference, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [req.user.id, reference_id, 'qrispy', Number(amount), Number(amount), 0, 'pending', qris_id, qris_url, reference_id, new Date(expired_at)]
        );

        await logStatusChange({
            entityType: 'deposit', entityId: reference_id, userId: req.user.id,
            oldStatus: null, newStatus: 'pending', reason: 'qrispy_created',
            metadata: { amount: Number(amount), method: 'qrispy', qris_id },
        });

        res.json({
            message: 'Deposit tercatat',
            deposit: { reference_id, method: 'qrispy', amount: Number(amount), qris_id, qris_url, expired_at, expires_in_seconds: expires_in_seconds || 900 },
        });
    } catch (err) {
        res.status(500).json({ error: 'Gagal simpan deposit' });
    }
}));

app.post('/api/deposit/qris-dana', requireAuth, withDB(async (req, res) => {
    const { amount } = req.body;
    if (!amount || amount < 1000) return res.status(400).json({ error: 'Minimal deposit Rp1.000' });
    if (amount > 10000000) return res.status(400).json({ error: 'Maksimal deposit Rp10.000.000' });

    try {
        const uniqueCode = generateUniqueCode();
        const totalAmount = Number(amount) + uniqueCode;
        const referenceId = await generateUniqueReferenceId();
        const dynamicQRIS = toDynamicQRIS(STATIC_QRIS_DANA, totalAmount);
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(dynamicQRIS)}`;

        const expiredAt = new Date(Date.now() + QRIS_DANA_EXPIRY_MS);

        await pool.query(
            `INSERT INTO deposits (user_id, reference_id, method, amount, unique_code, total_amount, fee, status, qris_string, qris_url, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [req.user.id, referenceId, 'qris_dana', Number(amount), uniqueCode, totalAmount, uniqueCode, 'pending', dynamicQRIS, qrImageUrl, expiredAt]
        );

        await logStatusChange({
            entityType: 'deposit', entityId: referenceId, userId: req.user.id,
            oldStatus: null, newStatus: 'pending', reason: 'qris_dana_created',
            metadata: { amount: Number(amount), unique_code: uniqueCode, total_amount: totalAmount },
        });

        res.json({
            message: 'QRIS DANA berhasil dibuat',
            deposit: {
                reference_id: referenceId, method: 'qris_dana',
                amount: Number(amount), unique_code: uniqueCode,
                total_amount: totalAmount, fee: uniqueCode,
                qris_string: dynamicQRIS, qris_url: qrImageUrl,
                expired_at: expiredAt.toISOString(),
                expires_in_seconds: Math.floor(QRIS_DANA_EXPIRY_MS / 1000),
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}));

app.get('/api/deposit/:referenceId/status', requireAuth, withDB(async (req, res) => {
    const { referenceId } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM deposits WHERE reference_id = $1 AND user_id = $2 LIMIT 1',
            [referenceId, req.user.id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit tidak ditemukan' });

        let deposit = result.rows[0];
        if (deposit.status === 'success') return res.json({ status: 'success', deposit });

        deposit = await syncDepositStatus(deposit);
        if (deposit.status === 'success') return res.json({ status: 'success', deposit });

        res.json({ status: 'ok', deposit });
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

        await pool.query(
            `UPDATE deposits SET total_amount = $1, fee = $2, updated_at = NOW() WHERE id = $3`,
            [Number(total_amount), Number(fee), deposit.id]
        );

        res.json({ message: 'Fee updated' });
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
        if (deposit.status !== 'pending') return res.status(400).json({ error: 'Deposit tidak bisa di-expire', deposit });

        if (deposit.expires_at && new Date(deposit.expires_at) > new Date()) {
            return res.status(400).json({
                error: 'Deposit belum expired. Tunggu sampai waktu habis.',
                expires_at: deposit.expires_at
            });
        }

        if (deposit.method === 'qrispy' && deposit.qris_id) {
            try {
                const data = await qrispyFetch(`/api/payment/qris/${deposit.qris_id}/status`);
                if (data.data?.status === 'paid') {
                    await markDepositPaid(deposit, data.data.received_amount || data.data.amount, data.data.paid_at);
                    const fresh = await pool.query('SELECT * FROM deposits WHERE id = $1', [deposit.id]);
                    return res.json({ message: 'Deposit sudah dibayar', deposit: fresh.rows[0] });
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

        res.json({ message: 'Deposit expired', deposit: upd.rows[0] });
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

        if (deposit.method === 'qrispy' && deposit.qris_id) {
            try {
                const statusData = await qrispyFetch(`/api/payment/qris/${deposit.qris_id}/status`);
                if (statusData.data?.status === 'paid') {
                    await markDepositPaid(deposit, statusData.data.received_amount || statusData.data.amount, statusData.data.paid_at);
                    const fresh = await pool.query('SELECT * FROM deposits WHERE id = $1', [deposit.id]);
                    return res.status(400).json({
                        error: 'Deposit sudah dibayar, tidak bisa dibatalkan',
                        deposit: fresh.rows[0]
                    });
                }
            } catch (err) {
                console.error('Check payment before cancel error:', err.message);
            }

            try {
                await qrispyFetch(`/api/payment/qris/${deposit.qris_id}/cancel`, { method: 'POST' });
            } catch (err) {
                console.error('QRISPY cancel error:', err.message);
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
            query = `SELECT * FROM deposits WHERE user_id = $1 AND status = $2 
                     ORDER BY created_at DESC LIMIT $3 OFFSET $4`;
            params = [req.user.id, status, limit, offset];
            countQuery = `SELECT COUNT(*) FROM deposits WHERE user_id = $1 AND status = $2`;
            countParams = [req.user.id, status];
        } else {
            query = `SELECT * FROM deposits WHERE user_id = $1 
                     ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
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
            deposits: result.rows,
            total, page, limit, totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
        });
    } catch (err) {
        console.error('List deposits error:', err);
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
            `SELECT * FROM deposits 
             WHERE reference_id = ANY($1) AND user_id = $2 AND status = 'pending'`,
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
                if (fresh.status !== 'pending') updated.push(fresh);
            }
        }

        res.json({ updated, count: updated.length });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/admin/deposit/:referenceId/approve', requireAuth, requireAdmin, withDB(async (req, res) => {
    const { referenceId } = req.params;

    try {
        const result = await pool.query('SELECT * FROM deposits WHERE reference_id = $1 LIMIT 1', [referenceId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit tidak ditemukan' });

        const deposit = result.rows[0];
        if (deposit.status === 'success') return res.status(400).json({ error: 'Sudah di-approve' });

        const beforeRes = await pool.query('SELECT balance FROM users WHERE id = $1 LIMIT 1', [deposit.user_id]);
        const balanceBefore = Number(beforeRes.rows[0]?.balance || 0);

        const result2 = await markDepositPaid(deposit, deposit.total_amount || deposit.amount, new Date());

        if (result2.alreadyProcessed) {
            return res.status(400).json({ error: 'Sudah diproses sebelumnya' });
        }

        const afterRes = await pool.query('SELECT balance FROM users WHERE id = $1 LIMIT 1', [deposit.user_id]);
        const balanceAfter = Number(afterRes.rows[0]?.balance || 0);
        const credited = balanceAfter - balanceBefore;

        if (credited !== result2.saldoMasuk) {
            console.error(`⚠️ Mismatch credit: expected ${result2.saldoMasuk}, got ${credited}`);
        }

        const updated = await pool.query('SELECT * FROM deposits WHERE id = $1', [deposit.id]);
        res.json({
            message: 'Deposit di-approve',
            deposit: updated.rows[0],
            credit_verified: credited === result2.saldoMasuk,
            credited_amount: credited,
        });
    } catch (err) {
        console.error('Approve error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}));

// ============================================
// ===== WEBHOOK =====
// ============================================
app.post('/api/webhook/qrispy', withDB(async (req, res) => {
    try {
        const signature = req.headers['x-qrispy-signature'];
        if (!signature) return res.status(401).json({ error: 'No signature' });
        if (!QRISPY_WEBHOOK_SECRET) return res.status(500).json({ error: 'Webhook secret not configured' });

        const expectedSignature = crypto
            .createHmac('sha256', QRISPY_WEBHOOK_SECRET)
            .update(req.rawBody || JSON.stringify(req.body))
            .digest('hex');

        const sigBuffer = Buffer.from(signature, 'hex');
        const expectedBuffer = Buffer.from(expectedSignature, 'hex');

        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const { event, data } = req.body;

        if (event === 'payment.received') {
            const { qris_id, amount, received_amount, payment_reference, paid_at } = data;

            const result = await pool.query(
                `SELECT * FROM deposits WHERE qris_id = $1 OR reference_id = $2 OR payment_reference = $2 LIMIT 1`,
                [qris_id, payment_reference]
            );

            if (result.rows.length === 0) return res.json({ status: 'ok', message: 'Deposit not found' });

            const deposit = result.rows[0];
            const { alreadyProcessed } = await markDepositPaid(deposit, received_amount || amount, paid_at);

            if (alreadyProcessed) return res.json({ status: 'ok', message: 'Already processed' });
        }

        res.json({ status: 'ok' });
    } catch (err) {
        console.error('Webhook error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}));

app.post('/api/webhook/otp1', withDB(async (req, res) => {
    try {
        if (!WEBHOOK_OTP1_SECRET) {
            return res.status(500).json({ error: 'Webhook secret not configured' });
        }

        const signature = req.headers['x-banana-signature'] || req.headers['x-otp1-signature'];
        if (!signature) return res.status(401).json({ error: 'No signature' });

        const rawBody = req.rawBody || JSON.stringify(req.body);
        const expectedSig = 'sha256=' + crypto
            .createHmac('sha256', WEBHOOK_OTP1_SECRET)
            .update(rawBody)
            .digest('hex');

        const sigBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expectedSig);
        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const data = req.body;
        console.log('📥 Webhook OTP1:', JSON.stringify(data).substring(0, 300));

        const providerOrderId = data.order_id || data.orderId || data.reference;
        const otpCode = data.otp_code || data.otpCode || data.code || data.otp;
        const fullSms = data.full_sms || data.fullSms || data.message || data.sms || '';
        const otpCode2 = data.otp_code_2 || data.otpCode2 || null;

        if (!providerOrderId) return res.status(400).json({ error: 'Missing order_id' });

        const orderRes = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [String(providerOrderId)]);
        if (orderRes.rows.length === 0) return res.json({ status: 'ok', message: 'Order not found' });

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

        res.status(200).json({ status: 'ok', message: 'received', revived });
    } catch (err) {
        console.error('Webhook OTP1 error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}));

// ============================================
// ===== CEK OTP =====
// ============================================
app.post('/api/cekotp', requireAuth, withDB(async (req, res) => {
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
                expired_at: o.expired_at, refunded: cancelResult.refunded,
                refunded_amount: cancelResult.refundedAmount, expires_in: 0,
                refunded_at: o.refunded_at, refund_reason: o.refund_reason,
            });
        }

        try {
            const data = await dibananaFetch(`/status?order_id=${encodeURIComponent(order.order_id)}`);

            await pool.query(`UPDATE orders SET last_checked_at = NOW() WHERE id = $1`, [order.id]);

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
                    if (fresh.rows[0]) {
                        await refundOrder(fresh.rows[0], 'provider_' + data.status);
                    }
                }

                const fresh = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [order.order_id]);
                return res.json({
                    order_id: fresh.rows[0].order_id, otp_id: fresh.rows[0].otp_id,
                    status: fresh.rows[0].status, phone_number: fresh.rows[0].phone_number,
                    otp_code: fresh.rows[0].otp_code, otp_code_2: fresh.rows[0].otp_code_2,
                    full_sms: fresh.rows[0].full_sms, price_idr: fresh.rows[0].price,
                    service: fresh.rows[0].service, service_name: fresh.rows[0].service_name,
                    icon_code: fresh.rows[0].icon_code,
                    country: fresh.rows[0].country, country_name: fresh.rows[0].country_name,
                    operator: fresh.rows[0].operator,
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
        console.error('CekOTP error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}));

// ============================================
// ===== CHECK & REFUND =====
// ============================================
app.post('/api/nokos/check-refunds', requireAuth, withDB(async (req, res) => {
    try {
        const refunded = await checkAndRefundUserOrders(req.user.id);
        const userRes = await pool.query('SELECT balance FROM users WHERE id = $1 LIMIT 1', [req.user.id]);

        res.json({
            refunded,
            count: refunded.length,
            new_balance: userRes.rows[0] ? Number(userRes.rows[0].balance) : null,
        });
    } catch (err) {
        console.error('Check refunds error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}));

// ============================================
// ===== ORDERS STATS =====
// ============================================
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

// ============================================
// ===== STATUS LOGS =====
// ============================================
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
        console.error('Get status logs error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}));

// ============================================
// ===== CRON =====
// ============================================
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

                    const data = await dibananaFetch(`/status?order_id=${encodeURIComponent(order.order_id)}`);

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
        console.error('Auto-validate error:', err);
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

// ============================================
// ===== NOKOS — SERVERS =====
// ============================================
app.get('/api/nokos/servers', requireAuth, (req, res) => {
    res.json({ servers: SERVERS_LIST });
});

// ===== SERVICES (dengan icon_code mapping) =====
app.get('/api/nokos/services', requireAuth, withDB(async (req, res) => {
    const { server = 'ekonomi' } = req.query;
    if (!SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });

    const cacheKey = `services_${server}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(cached);
    }

    try {
        const data = await dibananaFetch(`/services?server=${encodeURIComponent(server)}`);
        const rawServices = data.services || [];

        // Enrich: inject `icon_code` (huruf) dari ekonomi, tanpa nimpa `code` asli
        const services = await enrichServicesWithCode(rawServices, server);

        const response = { server, services };
        cacheSet(cacheKey, response, 5 * 60 * 1000);
        res.set('X-Cache', 'MISS');
        res.json(response);
    } catch (err) {
        console.error('Get services error:', err.message);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
}));

app.get('/api/nokos/countries', requireAuth, withDB(async (req, res) => {
    const { server = 'ekonomi', service } = req.query;
    if (!SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });

    const cacheKey = `countries_${server}_${service || 'all'}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(cached);
    }

    try {
        const params = new URLSearchParams({ server });
        if (service) params.append('service', service);
        const data = await dibananaFetch(`/countries?${params.toString()}`);
        if (data.countries) {
            const response = { server, countries: data.countries };
            cacheSet(cacheKey, response, 5 * 60 * 1000);
            res.set('X-Cache', 'MISS');
            return res.json(response);
        }
    } catch (err) {
        console.error('Countries error, fallback:', err.message);
    }

    const config = SERVER_CONFIG[server];
    let countries = [];

    if (config.countries) {
        countries = config.countries.map(c => ({ code: c, name: COUNTRY_NAMES[c] || c.toUpperCase() }));
    } else {
        countries = Object.entries(COUNTRY_NAMES).map(([code, name]) => ({ code, name }));
        if (config.excludeCountries) {
            countries = countries.filter(c => !config.excludeCountries.includes(c.code));
        }
    }

    const response = { server, countries };
    cacheSet(cacheKey, response, 5 * 60 * 1000);
    res.json(response);
}));

app.get('/api/nokos/prices', requireAuth, withDB(async (req, res) => {
    const { server = 'ekonomi', service, country } = req.query;
    if (!SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });
    if (!service || !country) return res.status(400).json({ error: 'Service dan country wajib' });

    const cacheKey = `prices_${server}_${service}_${country}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(cached);
    }

    try {
        const data = await dibananaFetch(`/prices?server=${encodeURIComponent(server)}&service=${encodeURIComponent(service)}&country=${encodeURIComponent(country)}`);
        const response = { server, service, country, providers: data.providers || [] };
        cacheSet(cacheKey, response, 2 * 60 * 1000);
        res.set('X-Cache', 'MISS');
        res.json(response);
    } catch (err) {
        console.error('Get prices error:', err.message);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
}));

// ============================================
// ===== NOKOS — CREATE ORDER (v11) =====
// ===== Pre-check saldo + cache harga + icon_code
// ===== Handle INSUFFICIENT_BALANCE dari provider
// ============================================
app.post('/api/nokos/order', requireAuth, withDB(async (req, res) => {
    const startTime = Date.now();
    const { id, server, service, country, service_name, country_flag, provider_id, provider_price, operator, icon_code } = req.body;

    if (!server || !SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });

    const config = SERVER_CONFIG[server];
    const isPremium = !!config.requiresOperator;

    if (isPremium) {
        if (!provider_id || !provider_price || !operator) {
            return res.status(400).json({ error: 'Premium butuh provider_id, provider_price, dan operator' });
        }
        if (!VALID_OPERATORS.includes(operator)) {
            return res.status(400).json({ error: `Operator tidak valid` });
        }
    } else {
        if (!id) return res.status(400).json({ error: 'ID provider wajib' });
    }

    let providerOrderId = null;
    let price = 0;
    let phoneNumber = null;
    let saldoDeducted = false;
    let finalIconCode = String(icon_code || '').trim() || null;

    try {
        // ===== STEP 1: Ambil saldo user DULU =====
        const userRes = await pool.query('SELECT balance FROM users WHERE id = $1 LIMIT 1', [req.user.id]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });
        const userBalanceAtStart = Number(userRes.rows[0].balance);

        // ===== STEP 2: Tentukan estimasi harga =====
        let estimatedPrice = 0;

        if (isPremium) {
            estimatedPrice = Number(provider_price);
        } else {
            const cacheKey = `prices_${server}_${service}_${country}`;
            const cachedPrices = cacheGet(cacheKey);
            if (cachedPrices && Array.isArray(cachedPrices.providers)) {
                const match = cachedPrices.providers.find(p => String(p.id) === String(id));
                if (match && match.price_idr) {
                    estimatedPrice = Number(match.price_idr);
                }
            }
        }

        // ===== STEP 3: Cek saldo user >= estimasi =====
        if (estimatedPrice > 0 && userBalanceAtStart < estimatedPrice) {
            return res.status(400).json({
                error: 'Saldo kamu tidak cukup. Silakan deposit dulu.',
                code: 'INSUFFICIENT_USER_BALANCE',
                balance: userBalanceAtStart,
                needed: estimatedPrice,
            });
        }

        if (userBalanceAtStart <= 0) {
            return res.status(400).json({
                error: 'Saldo kamu kosong. Silakan deposit dulu.',
                code: 'INSUFFICIENT_USER_BALANCE',
                balance: userBalanceAtStart,
                needed: estimatedPrice || 'unknown',
            });
        }

        // ===== STEP 4: Pre-check saldo PROVIDER (khusus premium) =====
        if (isPremium) {
            try {
                const providerBal = await getProviderBalance();
                if (providerBal.ok && providerBal.balance < estimatedPrice) {
                    return res.status(503).json({
                        error: 'Server sedang sibuk, coba lagi nanti.',
                        code: 'INSUFFICIENT_BALANCE',
                    });
                }
            } catch (err) {
                console.warn('Provider balance check skipped:', err.message);
            }
        }

        // ===== STEP 5: Panggil provider order =====
        let orderBody;
        if (isPremium) {
            orderBody = { server, service, country, provider_id, provider_price, operator };
        } else {
            orderBody = { id };
        }

        let data;
        try {
            data = await dibananaFetch('/order', { method: 'POST', body: JSON.stringify(orderBody) });
        } catch (err) {
            console.error('Provider order error:', err.message);

            // Handle INSUFFICIENT_BALANCE dari provider (saldo server kurang)
            const errCode = err.code || err.data?.error;
            if (errCode === 'INSUFFICIENT_BALANCE' || /saldo tidak cukup/i.test(err.message)) {
                return res.status(503).json({
                    error: 'Server sedang sibuk, coba lagi nanti.',
                    code: 'INSUFFICIENT_BALANCE',
                });
            }

            return res.status(err.status || 500).json({
                error: err.message || 'Gagal order dari provider',
                code: errCode || 'PROVIDER_ERROR'
            });
        }

        // ===== STEP 6: Validasi response =====
        if (!data || !data.order_id) {
            return res.status(500).json({ error: 'Provider response tidak valid', code: 'INVALID_RESPONSE' });
        }

        providerOrderId = data.order_id;
        price = Number(data.price_idr) || 0;
        phoneNumber = data.phone_number || null;

        if (price <= 0) {
            try { await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: providerOrderId }) }); } catch (e) {}
            return res.status(500).json({ error: 'Provider memberikan harga tidak valid', code: 'INVALID_PRICE' });
        }

        // ===== STEP 7: Final check saldo user >= price dari provider =====
        if (userBalanceAtStart < price) {
            try { await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: providerOrderId }) }); } catch (e) {}
            return res.status(400).json({
                error: 'Saldo kamu tidak cukup. Silakan deposit dulu.',
                code: 'INSUFFICIENT_USER_BALANCE',
                balance: userBalanceAtStart,
                needed: price,
            });
        }

        // Kalau icon_code belum di-set dari frontend, coba mapping dari service_name
        if (!finalIconCode && service_name) {
            try {
                const codeMap = await getServiceCodeMap();
                const normName = normalizeServiceName(service_name);
                finalIconCode = codeMap[normName] || null;
            } catch (e) {}
        }

        // ===== STEP 8: Insert order + deduct saldo (atomic) =====
        const otpId = await generateOtpReferenceId();
        const expiredAt = new Date(Date.now() + ORDER_EXPIRY_MS);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `INSERT INTO orders 
                 (user_id, order_id, otp_id, server, service, service_name, icon_code, country, country_name, country_flag, operator, phone_number, price, status, expires_in, expired_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
                [
                    req.user.id, String(providerOrderId), otpId, server,
                    service || data.service || null,
                    service_name || null,
                    finalIconCode,
                    country || data.country || null,
                    COUNTRY_NAMES[country] || country || null,
                    country_flag || country || null,
                    operator || null,
                    phoneNumber, price, 'pending', 1200, expiredAt
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
                try { await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: providerOrderId }) }); } catch (e) {}
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
                    service_name || data.service || null,
                    country || data.country || null,
                    country_flag || country || null,
                    phoneNumber, 'pending', price
                ]
            );

            await client.query(
                `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                ['order', String(providerOrderId), req.user.id, null, 'pending', 'order_created',
                 JSON.stringify({ otp_id: otpId, service: service_name || data.service, country: country || data.country, price, phone_number: phoneNumber, server, operator: operator || null, icon_code: finalIconCode })]
            );

            await client.query('COMMIT');
            saldoDeducted = true;

            cacheDelPattern('prices_');

            const newBalance = Number(deductRes.rows[0].balance);

            res.json({
                message: 'Order berhasil!',
                order: {
                    order_id: providerOrderId,
                    otp_id: otpId,
                    phone_number: phoneNumber,
                    price_idr: price,
                    server: data.server || server,
                    service: data.service || service,
                    service_name: service_name || null,
                    icon_code: finalIconCode,
                    country: data.country || country,
                    operator: operator || null,
                    status: data.status || 'pending',
                    expires_in: 1200,
                    expired_at: expiredAt.toISOString(),
                },
                balance: newBalance,
            });

            console.log(`⏱️ Order ${providerOrderId} in ${Date.now() - startTime}ms`);
        } catch (dbErr) {
            await client.query('ROLLBACK');
            console.error('DB insert error:', dbErr.message);
            try { await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: providerOrderId }) }); } catch (e) {}
            return res.status(500).json({ error: 'Gagal menyimpan order. Coba lagi.' });
        } finally {
            client.release();
        }

    } catch (err) {
        console.error('Create order error:', err);
        if (providerOrderId && !saldoDeducted) {
            try { await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: providerOrderId }) }); } catch (e) {}
        }
        res.status(err.status || 500).json({ error: err.message || 'Server error', code: err.code });
    }
}));

// ============================================
// ===== NOKOS — CHECK ORDER STATUS =====
// ============================================
app.get('/api/nokos/order/:orderId', requireAuth, withDB(async (req, res) => {
    const { orderId } = req.params;

    try {
        const orderRes = await pool.query(
            'SELECT * FROM orders WHERE order_id = $1 AND user_id = $2 LIMIT 1',
            [String(orderId), req.user.id]
        );
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
                country: order.country, country_name: order.country_name, country_flag: order.country_flag,
                operator: order.operator,
                received_at: order.received_at, expires_in: 0, expired_at: order.expired_at,
                refunded_at: order.refunded_at, refunded_amount: order.refunded_amount,
                refund_reason: order.refund_reason, created_at: order.created_at,
            });
        }

        const data = await dibananaFetch(`/status?order_id=${encodeURIComponent(orderId)}`);

        if (data.status !== order.status || data.otp_code) {
            await pool.query(
                `UPDATE orders SET status = $1, otp_code = $2, otp_code_2 = $3, full_sms = $4, received_at = CASE WHEN $1 = 'received' THEN NOW() ELSE received_at END, updated_at = NOW() WHERE order_id = $5`,
                [data.status, data.otp_code, data.otp_code_2, data.full_sms, String(orderId)]
            );
            await pool.query(
                `UPDATE transactions SET status = CASE WHEN $1 = 'received' THEN 'success' WHEN $1 IN ('cancelled', 'expired', 'refunded') THEN 'failed' ELSE status END, otp_code = $2, updated_at = NOW() WHERE order_id = $3`,
                [data.status, data.otp_code, String(orderId)]
            );

            if (data.status !== order.status) {
                await logStatusChange({
                    entityType: 'order', entityId: String(order.order_id), userId: order.user_id,
                    oldStatus: order.status, newStatus: data.status, reason: 'check_status',
                    metadata: { otp_code: data.otp_code || null, otp_id: order.otp_id },
                });
            }

            if (['cancelled', 'expired', 'refunded'].includes(data.status)) {
                const fresh = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [order.order_id]);
                if (fresh.rows[0]) {
                    await refundOrder(fresh.rows[0], 'provider_' + data.status);
                }
            }
        }

        const fresh = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [orderId]);
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
            refunded_at: o.refunded_at,
            refunded_amount: o.refunded_amount,
            refund_reason: o.refund_reason,
            created_at: o.created_at,
        });
    } catch (err) {
        console.error('Check status error:', err);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
}));

// ============================================
// ===== NOKOS — RESEND =====
// ============================================
app.post('/api/nokos/order/:orderId/resend', requireAuth, withDB(async (req, res) => {
    const { orderId } = req.params;

    try {
        const orderRes = await pool.query(
            'SELECT * FROM orders WHERE order_id = $1 AND user_id = $2 LIMIT 1',
            [String(orderId), req.user.id]
        );
        if (orderRes.rows.length === 0) {
            const depositRes = await pool.query(
                'SELECT * FROM deposits WHERE reference_id = $1 AND user_id = $2 LIMIT 1',
                [String(orderId), req.user.id]
            );
            if (!depositRes.rows.length) return res.status(404).json({ error: 'Data tidak ditemukan' });
            const d = depositRes.rows[0];
            return res.json({
                order_id: d.reference_id, order_type: 'deposit', otp_id: null,
                status: `deposit_${d.status}`, service: 'Deposit',
                service_name: `Deposit ${d.method === 'qrispy' ? 'QRIS' : 'QRIS DANA'}`,
                country: null, country_name: d.method === 'qrispy' ? 'QRIS' : 'DANA',
                phone_number: null, otp_code: null, full_sms: null, price: d.amount,
                qris_id: d.qris_id, qris_url: d.qris_url, qris_string: d.qris_string,
                total_amount: d.total_amount, fee: d.fee,
                created_at: d.created_at, updated_at: d.updated_at, expired_at: d.expires_at,
            });
        }

        const order = orderRes.rows[0];

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

        const data = await dibananaFetch('/resend', {
            method: 'POST',
            body: JSON.stringify({ order_id: Number(orderId) })
        });

        await pool.query(
            'UPDATE orders SET resend_count = resend_count + 1, status = $1, updated_at = NOW() WHERE order_id = $2',
            [data.status, String(orderId)]
        );

        await logStatusChange({
            entityType: 'order', entityId: String(orderId), userId: req.user.id,
            oldStatus: order.status, newStatus: data.status || order.status, reason: 'resend_sms',
            metadata: { resend_count: order.resend_count + 1, otp_id: order.otp_id },
        });

        res.json(data);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
}));

// ===== CONFIRM OTP ORDER =====
app.post('/api/nokos/order/:orderId/confirm', requireAuth, withDB(async (req, res) => {
    const { orderId } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const found = await client.query(
            'SELECT * FROM orders WHERE order_id = $1 AND user_id = $2 FOR UPDATE',
            [String(orderId), req.user.id]
        );
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

// ============================================
// ===== NOKOS — CANCEL ORDER =====
// ============================================
app.post('/api/nokos/order/:orderId/cancel', requireAuth, withDB(async (req, res) => {
    const { orderId } = req.params;
    try {
        const orderRes = await pool.query(
            'SELECT * FROM orders WHERE order_id = $1 AND user_id = $2 LIMIT 1',
            [String(orderId), req.user.id]
        );
        if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order tidak ditemukan' });

        const order = orderRes.rows[0];

        if (['received', 'success', 'confirmed'].includes(order.status)) {
            return res.status(400).json({ error: 'Order sudah sukses, tidak bisa dibatalkan' });
        }

        if (['cancelled', 'expired', 'refunded'].includes(order.status)) {
            return res.status(400).json({ error: 'Order sudah tidak aktif' });
        }

        const data = await dibananaFetch('/cancel', {
            method: 'POST',
            body: JSON.stringify({ order_id: Number(orderId) })
        });

        await pool.query('UPDATE orders SET status = $1, updated_at = NOW() WHERE order_id = $2', ['cancelled', String(orderId)]);
        await pool.query('UPDATE transactions SET status = $1, updated_at = NOW() WHERE order_id = $2', ['failed', String(orderId)]);

        await logStatusChange({
            entityType: 'order', entityId: String(orderId), userId: req.user.id,
            oldStatus: order.status, newStatus: 'cancelled', reason: 'manual_cancel',
            metadata: { refunded_amount: Number(data.refunded) || Number(order.price) || 0, otp_id: order.otp_id },
        });

        const fresh = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [orderId]);
        if (fresh.rows[0]) {
            await refundOrder(fresh.rows[0], 'manual_cancel');
        }

        const userRes = await pool.query('SELECT balance FROM users WHERE id = $1 LIMIT 1', [req.user.id]);

        res.json({
            ...data,
            balance: userRes.rows[0] ? Number(userRes.rows[0].balance) : null
        });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
}));

// ============================================
// ===== NOKOS — LIST ORDERS =====
// ============================================
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
                pool.query(`SELECT id, reference_id, method, amount, total_amount, status, qris_id, qris_url, qris_string, expires_at, created_at, updated_at
                            FROM deposits WHERE user_id = $1 ORDER BY created_at DESC`, [req.user.id]),
                pool.query('SELECT COUNT(*) FROM deposits WHERE user_id = $1', [req.user.id]),
            ]);
            const mapped = rows.rows.map(d => ({
                id: `deposit-${d.id}`, order_id: d.reference_id, otp_id: null,
                order_type: 'deposit', server: null, service: 'Deposit',
                service_name: `Deposit ${d.method === 'qrispy' ? 'QRIS' : 'QRIS DANA'}`,
                icon_code: d.method === 'qrispy' ? 'qris' : 'dana',
                country: null, country_name: d.method === 'qrispy' ? 'QRIS' : 'DANA', country_flag: null,
                operator: null, phone_number: null, otp_code: null, otp_code_2: null, full_sms: null,
                price: d.amount, status: `deposit_${d.status}`, expires_in: d.expires_at ? Math.max(0, Math.floor((new Date(d.expires_at) - Date.now()) / 1000)) : 0,
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
            const mapped = rows.rows.map(o => ({ ...o, order_type: 'nokos', expires_in: o.expired_at ? Math.max(0, Math.floor((new Date(o.expired_at) - Date.now()) / 1000)) : 0 }));
            if (status === 'nokos') { orders = mapped; total = Number(count.rows[0].count); }
            else { orders.push(...mapped); total += Number(count.rows[0].count); }
        }
        if (!['all', 'nokos', 'deposit'].includes(status)) {
            const successFilter = status === 'success';
            const statusCondition = successFilter ? "status IN ('success', 'received', 'confirmed')" : 'status = $2';
            const [rows, count] = await Promise.all([
                pool.query(`SELECT * FROM orders WHERE user_id = $1 AND ${statusCondition} ORDER BY created_at DESC`, successFilter ? [req.user.id] : [req.user.id, status]),
                pool.query(`SELECT COUNT(*) FROM orders WHERE user_id = $1 AND ${statusCondition}`, successFilter ? [req.user.id] : [req.user.id, status]),
            ]);
            orders = rows.rows.map(o => ({ ...o, order_type: 'nokos', expires_in: o.expired_at ? Math.max(0, Math.floor((new Date(o.expired_at) - Date.now()) / 1000)) : 0 }));
            total = Number(count.rows[0].count);
        }
        orders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        res.json({ orders: orders.slice(offset, offset + limitNum), total, page: pageNum, limit: limitNum });
    } catch (err) {
        console.error('List orders error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// ============================================
// ===== NOKOS — SYNC BATCH =====
// ============================================
app.post('/api/nokos/sync-batch', requireAuth, withDB(async (req, res) => {
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
                    const data = await dibananaFetch(`/status?order_id=${encodeURIComponent(order.order_id)}`);

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
                            if (fresh.rows[0]) {
                                await refundOrder(fresh.rows[0], 'provider_' + data.status);
                            }
                        }

                        const fresh = await pool.query('SELECT * FROM orders WHERE order_id = $1 LIMIT 1', [order.order_id]);
                        if (fresh.rows[0]) updated.push(fresh.rows[0]);
                    }
                } catch (err) {
                    console.error(`Sync ${order.order_id}:`, err.message);
                }
            }));
        }

        res.json({ updated, count: updated.length });
    } catch (err) {
        console.error('Sync batch error:', err);
        res.status(500).json({ error: 'Server error' });
    }
}));

// ===== GLOBAL ERROR HANDLER =====
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ===== PROXY COUNTRIES API =====
app.get('/api/countries/:code', requireAuth, withDB(async (req, res) => {
    if (!API_CDN) return res.status(500).json({ error: 'API_CDN belum di-set' });

    const code = String(req.params.code || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return res.status(400).json({ error: 'Kode negara tidak valid' });

    const cacheKey = `country_${code}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const resp = await fetch(
            `https://api.restcountries.com/countries/v5?codes=${code}&pretty=1`,
            {
                signal: controller.signal,
                headers: { 'Authorization': `Bearer ${API_CDN}` }
            }
        );
        clearTimeout(timeout);

        if (!resp.ok) throw new Error(`REST Countries error ${resp.status}`);
        const data = await resp.json();

        cacheSet(cacheKey, data, 24 * 60 * 60 * 1000);
        res.json(data);
    } catch (err) {
        console.error('Countries API error:', err.message);
        res.status(500).json({ error: 'Gagal fetch data negara' });
    }
}));

// ============================================
// ===== ADMIN API — MIDDLEWARE =====
// ============================================
const ADMIN_USERNAMES = ['asyrofc'];
const ADMIN_USER_CODES = ['SRF2667442394'];

function isAdminUser(user) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    const uname = String(user.username || '').toLowerCase();
    const ucode = String(user.user_code || '');
    return ADMIN_USERNAMES.includes(uname) || ADMIN_USER_CODES.includes(ucode);
}

// Middleware requireAdmin: cek role / username / user_code
async function requireAdminFlex(req, res, next) {
    try {
        // Ambil data user fresh dari DB
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

// Helper: log admin action ke status_logs
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

// Helper: parse pagination
function parsePagination(req, defaultLimit = 20, maxLimit = 100) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit, 10) || defaultLimit));
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

// Helper: cek status sukses untuk order/deposit
const ORDER_SUCCESS_STATUSES = ['success', 'received', 'confirmed'];
const ORDER_FAIL_STATUSES = ['cancelled', 'expired', 'failed', 'refunded'];
const DEPOSIT_SUCCESS_STATUSES = ['success'];
const DEPOSIT_FAIL_STATUSES = ['cancelled', 'expired', 'failed', 'refunded'];

// Helper: apakah transisi status butuh adjust saldo
function getBalanceAdjustment(type, oldStatus, newStatus, amount) {
    const a = Number(amount) || 0;
    if (a <= 0) return 0;

    if (type === 'order') {
        // Order: user sudah bayar di awal, jadi:
        // - sukses → fail: refund (+a)
        // - fail → sukses: tarik balik refund (-a)
        // - pending → fail: refund (+a)
        // - fail → pending: tarik balik (-a)
        const oldSuccess = ORDER_SUCCESS_STATUSES.includes(oldStatus);
        const newSuccess = ORDER_SUCCESS_STATUSES.includes(newStatus);
        const oldFail = ORDER_FAIL_STATUSES.includes(oldStatus);
        const newFail = ORDER_FAIL_STATUSES.includes(newStatus);

        if (oldStatus === 'pending' && newFail) return +a; // refund
        if (oldFail && newStatus === 'pending') return -a; // tarik balik refund
        if (oldSuccess && newFail) return +a; // refund
        if (oldFail && newSuccess) return -a; // tarik balik
        return 0;
    }

    if (type === 'deposit') {
        // Deposit: uang masuk ke user
        // - pending → success: +a
        // - success → fail: -a
        // - fail → success: +a
        // - success → pending: -a
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

// ============================================
// ===== ADMIN — STATS =====
// ============================================
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
        });
    } catch (err) {
        console.error('Admin stats error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// ============================================
// ===== ADMIN — USERS LIST =====
// ============================================
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

        const countQuery = `SELECT COUNT(*) AS c FROM users ${where ? where.replace(/LIKE \$1/g, 'LIKE $1') : ''}`;

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

// ============================================
// ===== ADMIN — USER DETAIL =====
// ============================================
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

        // Stats
        const [orderStats, depositStats, balanceLogs] = await Promise.all([
            pool.query(
                `SELECT 
                    COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status IN ('success','received','confirmed')) AS success,
                    COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                    COUNT(*) FILTER (WHERE status IN ('cancelled','expired','failed')) AS failed,
                    COALESCE(SUM(price) FILTER (WHERE status IN ('success','received','confirmed')), 0) AS total_spent
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
            // Aktivitas saldo dari status_logs
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

        // Recent orders & deposits
        const [recentOrders, recentDeposits] = await Promise.all([
            pool.query(
                `SELECT order_id, otp_id, service_name, service, icon_code, country, country_name, phone_number,
                        otp_code, price, status, created_at, refunded_at, refunded_amount
                 FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
                [userId]
            ),
            pool.query(
                `SELECT reference_id, method, amount, total_amount, unique_code, fee, status, 
                        qris_url, paid_at, expires_at, created_at
                 FROM deposits WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
                [userId]
            ),
        ]);

        res.json({
            user: {
                ...user,
                balance: Number(user.balance) || 0,
            },
            stats: {
                orders: {
                    total: Number(orderStats.rows[0].total) || 0,
                    success: Number(orderStats.rows[0].success) || 0,
                    pending: Number(orderStats.rows[0].pending) || 0,
                    failed: Number(orderStats.rows[0].failed) || 0,
                    total_spent: Number(orderStats.rows[0].total_spent) || 0,
                },
                deposits: {
                    total: Number(depositStats.rows[0].total) || 0,
                    success: Number(depositStats.rows[0].success) || 0,
                    pending: Number(depositStats.rows[0].pending) || 0,
                    total_deposit: Number(depositStats.rows[0].total_deposit) || 0,
                },
            },
            balance_logs: balanceLogs.rows,
            recent_orders: recentOrders.rows.map(o => ({ ...o, price: Number(o.price) || 0 })),
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

// ============================================
// ===== ADMIN — EDIT USER BALANCE =====
// ===== mode: 'set' | 'add' | 'subtract' =====
// ============================================
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
        } else { // subtract
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

        await client.query(
            `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
             VALUES ('admin_action', $1, $1, $2, 'balance_adjust', 'admin_balance_adjust', $3)`,
            [
                userId,
                String(oldBalance),
                JSON.stringify({
                    mode,
                    amount: Math.floor(amt),
                    old_balance: oldBalance,
                    new_balance: newBalance,
                    note: note || null,
                    admin_id: req.admin.id,
                    admin_username: req.admin.username,
                }),
            ]
        );

        await client.query('COMMIT');

        res.json({
            message: 'Saldo berhasil diupdate',
            user: {
                id: user.id,
                username: user.username,
                balance: newBalance,
            },
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

// ============================================
// ===== ADMIN — CHANGE ROLE =====
// ============================================
app.post('/api/admin/users/:id/role', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const userId = String(req.params.id || '').trim();
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Role harus user/admin' });
    }

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

// ============================================
// ===== ADMIN — CHANGE STATUS (ban/unban) =====
// ============================================
app.post('/api/admin/users/:id/status', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const userId = String(req.params.id || '').trim();
    const { status } = req.body;

    if (!['active', 'banned'].includes(status)) {
        return res.status(400).json({ error: 'Status harus active/banned' });
    }

    try {
        const result = await pool.query(
            'UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, status',
            [status, userId]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'User tidak ditemukan' });

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

// ============================================
// ===== ADMIN — RESET PASSWORD =====
// ============================================
app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const userId = String(req.params.id || '').trim();
    const { new_password } = req.body;

    if (!new_password || new_password.length < 6) {
        return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }

    try {
        const hash = await bcrypt.hash(new_password, 8);
        const result = await pool.query(
            'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username',
            [hash, userId]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'User tidak ditemukan' });

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

// ============================================
// ===== ADMIN — ORDERS LIST =====
// ============================================
app.get('/api/admin/orders', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    const { page, limit, offset } = parsePagination(req, 20, 100);
    const status = String(req.query.status || '').trim();
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
            SELECT 
                o.*,
                u.username, u.user_code, u.name AS user_name
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

// ============================================
// ===== ADMIN — ORDER DETAIL =====
// ============================================
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

        // Riwayat status order
        const logs = await pool.query(
            `SELECT id, old_status, new_status, reason, metadata, created_at
             FROM status_logs
             WHERE entity_type = 'order' AND entity_id = $1
             ORDER BY created_at DESC
             LIMIT 100`,
            [orderId]
        );

        res.json({
            order: {
                ...o,
                price: Number(o.price) || 0,
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

// ============================================
// ===== ADMIN — UPDATE ORDER STATUS =====
// ===== Auto adjust saldo user =====
// ============================================
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
            // Lock user
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

            // Log balance adjust
            await client.query(
                `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
                 VALUES ('admin_action', $1, $2, $3, 'balance_adjust', 'admin_order_status_change', $4)`,
                [
                    orderId,
                    user.id,
                    String(oldBalance),
                    JSON.stringify({
                        order_id: orderId,
                        old_status: oldStatus,
                        new_status: newStatus,
                        adjustment,
                        old_balance: oldBalance,
                        new_balance: newBalance,
                        note: note || null,
                        admin_id: req.admin.id,
                        admin_username: req.admin.username,
                    }),
                ]
            );
        }

        // Update order status
        const updateFields = ['status = $1', 'updated_at = NOW()'];
        const updateParams = [newStatus];

        // Kalau jadi fail → set refunded_at & refunded_amount
        if (ORDER_FAIL_STATUSES.includes(newStatus) && !ORDER_FAIL_STATUSES.includes(oldStatus)) {
            updateFields.push(`refunded_at = $${updateParams.length + 1}`);
            updateParams.push(Date.now());
            updateFields.push(`refunded_amount = $${updateParams.length + 1}`);
            updateParams.push(price);
            updateFields.push(`refund_reason = $${updateParams.length + 1}`);
            updateParams.push(note || 'admin_force_fail');
        }

        // Kalau dari fail → sukses → hapus refunded
        if (ORDER_SUCCESS_STATUSES.includes(newStatus) && ORDER_FAIL_STATUSES.includes(oldStatus)) {
            updateFields.push(`refunded_at = NULL`);
            updateFields.push(`refunded_amount = NULL`);
            updateFields.push(`refund_reason = NULL`);
        }

        // Set received_at kalau jadi sukses
        if (ORDER_SUCCESS_STATUSES.includes(newStatus)) {
            updateFields.push(`received_at = COALESCE(received_at, NOW())`);
        }

        updateParams.push(orderId);
        const updateQuery = `UPDATE orders SET ${updateFields.join(', ')} WHERE order_id = $${updateParams.length} RETURNING *`;

        const updatedOrder = await client.query(updateQuery, updateParams);

        // Log status change
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

        // Sync ke transactions
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

// ============================================
// ===== ADMIN — DEPOSITS LIST =====
// ============================================
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
            SELECT 
                d.*,
                u.username, u.user_code, u.name AS user_name
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
                unique_code: d.unique_code ? Number(d.unique_code) : null,
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

// ============================================
// ===== ADMIN — DEPOSIT DETAIL =====
// ============================================
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
             ORDER BY created_at DESC
             LIMIT 100`,
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

// ============================================
// ===== ADMIN — UPDATE DEPOSIT STATUS =====
// ===== Auto adjust saldo user =====
// ============================================
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

            await client.query(
                `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
                 VALUES ('admin_action', $1, $2, $3, 'balance_adjust', 'admin_deposit_status_change', $4)`,
                [
                    referenceId,
                    user.id,
                    String(oldBalance),
                    JSON.stringify({
                        reference_id: referenceId,
                        old_status: oldStatus,
                        new_status: newStatus,
                        adjustment,
                        old_balance: oldBalance,
                        new_balance: newBalance,
                        note: note || null,
                        admin_id: req.admin.id,
                        admin_username: req.admin.username,
                    }),
                ]
            );
        }

        // Update deposit status
        const updateFields = ['status = $1', 'updated_at = NOW()'];
        const updateParams = [newStatus];

        // Kalau jadi success → set paid_at
        if (newStatus === 'success') {
            updateFields.push(`paid_at = COALESCE(paid_at, NOW())`);
        }

        updateParams.push(referenceId);
        const updateQuery = `UPDATE deposits SET ${updateFields.join(', ')} WHERE reference_id = $${updateParams.length} RETURNING *`;

        const updatedDeposit = await client.query(updateQuery, updateParams);

        // Log status change
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

// ============================================
// ===== ADMIN — APPROVE DEPOSIT (legacy wrapper) =====
// ===== Tetap ada untuk kompatibilitas. Panggil status change ke 'success' =====
// ============================================
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

            await client.query(
                `INSERT INTO status_logs (entity_type, entity_id, user_id, old_status, new_status, reason, metadata)
                 VALUES ('admin_action', $1, $2, $3, 'balance_adjust', 'admin_approve_deposit', $4)`,
                [
                    referenceId,
                    user.id,
                    String(oldBalance),
                    JSON.stringify({
                        reference_id: referenceId,
                        old_status: oldStatus,
                        new_status: 'success',
                        adjustment,
                        old_balance: oldBalance,
                        new_balance: newBalance,
                        admin_id: req.admin.id,
                        admin_username: req.admin.username,
                    }),
                ]
            );
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

// ============================================
// ===== ADMIN — AUDIT LOG =====
// ============================================
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
            pool.query(
                `SELECT COUNT(*) AS c FROM status_logs WHERE entity_type = 'admin_action'`
            ),
        ]);

        const total = Number(countRes.rows[0].c) || 0;
        const total_pages = Math.ceil(total / limit);

        res.json({
            logs: listRes.rows,
            total,
            page,
            limit,
            total_pages,
        });
    } catch (err) {
        console.error('Admin audit log error:', err.message);
        res.status(500).json({ error: 'Server error' });
    }
}));

// ============================================
// ===== ADMIN — SERVER BALANCE =====
// ============================================
app.get('/api/admin/server-balance', requireAuth, requireAdminFlex, withDB(async (req, res) => {
    try {
        const data = await dibananaFetch('/balance');
        res.json(data);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
}));

// ============================================
// ===== STARTUP WARMUP =====
// ============================================
(async () => {
    try {
        await ensureSchema();
        await getServiceCodeMap().catch(() => {});
        console.log('🚀 Server ready');
    } catch (err) {
        console.error('❌ Startup warmup failed:', err.message);
    }
})();

// ===== CLEANUP INTERVAL =====
setInterval(async () => {
    try {
        await pool.query(`DELETE FROM token_blacklist WHERE expires_at < NOW()`);
    } catch (err) {}
}, 60 * 60 * 1000);

module.exports = app;
