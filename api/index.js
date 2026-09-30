// ============================================
// ASYROFOTP - BACKEND API (FULL FIXED)
// ============================================

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const app = express();

// ===== CORS =====
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-qrispy-signature');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// ===== BODY PARSER =====
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf8');
    },
    limit: '1mb'
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ===== DATABASE =====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
    console.error('Unexpected pool error:', err.message);
});

// ===== JWT =====
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('⚠️  JWT_SECRET belum di-set! Pake default (TIDAK AMAN untuk production).');
}
const JWT_SECRET_FINAL = JWT_SECRET || 'asyrofotp-secret-ganti-di-env';
const JWT_EXPIRES = '7d';

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

// ===== QRIS DANA MANUAL =====
const STATIC_QRIS_DANA = '00020101021126570011ID.DANA.WWW011893600915399681262102099968126210303UMI51440014ID.CO.QRIS.WWW0215ID10254335825880303UMI5204549953033605802ID5912TOKO MoonRed6011KAB. BANTUL6105551856304C670';

// ===== CACHE =====
const cache = new Map();
function cacheGet(key) {
    const item = cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) { cache.delete(key); return null; }
    return item.value;
}
function cacheSet(key, value, ttlMs) { cache.set(key, { value, expiresAt: Date.now() + ttlMs }); }
function cacheDelPattern(prefix) {
    for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

// ===== RATE LIMITER =====
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
    console.log('🌐 QRISPY request:', fullUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

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
            console.error('QRISPY returned non-JSON:', text.substring(0, 300));
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
    const timeout = setTimeout(() => controller.abort(), 20000);

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
            const err = new Error(`Provider error: ${res.status} (response bukan JSON)`);
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

// ============================================
// ===== HELPERS =====
// ============================================
function isValidUsername(username) {
    return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

function signToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET_FINAL,
        { expiresIn: JWT_EXPIRES }
    );
}

function generateUniqueCode() {
    return Math.floor(Math.random() * 900) + 100;
}

function generateReferenceId() {
    return 'DEP' + Date.now() + Math.floor(Math.random() * 1000);
}

// ============================================
// ===== MIDDLEWARE =====
// ============================================
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.replace('Bearer ', '');
    try {
        const decoded = jwt.verify(token, JWT_SECRET_FINAL);
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
// ===== INIT DATABASE =====
// ============================================
let dbInitialized = false;
let dbInitPromise = null;

async function initDatabase() {
    if (dbInitialized) return;
    if (dbInitPromise) return dbInitPromise;

    dbInitPromise = (async () => {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS users (
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
                );
            `);

            await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS user_code TEXT;`);

            await pool.query(`
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_user_code_key') THEN
                        ALTER TABLE users ADD CONSTRAINT users_user_code_key UNIQUE (user_code);
                    END IF;
                END $$;
            `);

            await pool.query(`
                CREATE OR REPLACE FUNCTION generate_user_code()
                RETURNS TEXT AS $$
                DECLARE
                    new_code TEXT;
                    exists_check BOOLEAN;
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

            await pool.query(`UPDATE users SET user_code = generate_user_code() WHERE user_code IS NULL;`);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS orders (
                    id SERIAL PRIMARY KEY,
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    order_id TEXT UNIQUE,
                    server TEXT NOT NULL,
                    service TEXT NOT NULL,
                    service_name TEXT,
                    country TEXT NOT NULL,
                    country_name TEXT,
                    country_flag TEXT,
                    operator TEXT,
                    phone_number TEXT,
                    otp_code TEXT,
                    otp_code_2 TEXT,
                    full_sms TEXT,
                    price BIGINT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    expires_in INTEGER DEFAULT 0,
                    resend_count INTEGER DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW(),
                    received_at TIMESTAMPTZ
                );
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS transactions (
                    id SERIAL PRIMARY KEY,
                    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                    order_id TEXT,
                    service_name TEXT,
                    country TEXT,
                    country_flag TEXT,
                    phone_number TEXT,
                    otp_code TEXT,
                    status TEXT DEFAULT 'pending',
                    price BIGINT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS deposits (
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
                );
            `);

            const depositCols = [
                'unique_code INTEGER',
                'total_amount BIGINT',
                'fee BIGINT DEFAULT 0',
                'qris_id TEXT',
                'qris_url TEXT',
                'qris_string TEXT',
                'payment_reference TEXT',
                'paid_at TIMESTAMPTZ',
                'expires_at TIMESTAMPTZ',
            ];
            for (const col of depositCols) {
                await pool.query(`ALTER TABLE deposits ADD COLUMN IF NOT EXISTS ${col};`);
            }

            await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id, created_at DESC);`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_deposits_ref ON deposits(reference_id);`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_deposits_qris ON deposits(qris_id);`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status, expires_at);`);

            dbInitialized = true;
            console.log('✅ Database initialized');
        } catch (err) {
            console.error('❌ Database init failed:', err.message);
            dbInitPromise = null;
            throw err;
        }
    })();

    return dbInitPromise;
}

// ============================================
// ===== MARK DEPOSIT PAID (IDEMPOTENT) =====
// ============================================
async function markDepositPaid(deposit, receivedAmount, paidAt) {
    const saldoMasuk = Number(deposit.amount);
    const totalBayar = Number(receivedAmount) || Number(deposit.total_amount) || saldoMasuk;
    const fee = Math.max(0, totalBayar - saldoMasuk);
    const paidTime = paidAt ? new Date(paidAt) : new Date();

    const updateRes = await pool.query(
        `UPDATE deposits 
         SET status = 'success', paid_at = $1, updated_at = NOW(),
             total_amount = $2, fee = $3
         WHERE id = $4 AND status = 'pending'`,
        [paidTime, totalBayar, fee, deposit.id]
    );

    if (updateRes.rowCount === 0) {
        console.log(`⚠️  Deposit ${deposit.reference_id} sudah diproses sebelumnya`);
        return { alreadyProcessed: true, saldoMasuk, totalBayar, fee };
    }

    await pool.query(
        `UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
        [saldoMasuk, deposit.user_id]
    );

    await pool.query(
        `INSERT INTO transactions (user_id, order_id, service_name, status, price)
         VALUES ($1, $2, $3, $4, $5)`,
        [
            deposit.user_id,
            deposit.reference_id,
            `Deposit ${deposit.method === 'qrispy' ? 'QRIS' : 'QRIS DANA'}`,
            'success',
            totalBayar
        ]
    );

    console.log(`✅ Deposit ${deposit.reference_id} sukses | Saldo +${saldoMasuk} | Fee ${fee}`);
    return { alreadyProcessed: false, saldoMasuk, totalBayar, fee };
}

// ============================================
// ===== HEALTH =====
// ============================================
app.get('/api/health', async (req, res) => {
    try {
        await initDatabase();
        const result = await pool.query('SELECT NOW() as time');
        res.json({
            status: 'ok',
            time: result.rows[0].time,
            hasDibananaKey: !!DIBANANA_API_KEY,
            hasWebhookSecret: !!QRISPY_WEBHOOK_SECRET,
            hasJwtSecret: !!JWT_SECRET,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// ===== AUTH =====
// ============================================
app.post('/api/auth/register', rateLimit(10, 60 * 1000), async (req, res) => {
    try {
        await initDatabase();
    } catch (err) {
        return res.status(500).json({ error: 'Database belum siap' });
    }

    const { username, password, name } = req.body;

    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });
    if (!isValidUsername(username)) return res.status(400).json({ error: 'Username hanya boleh huruf, angka, underscore (3-20 karakter)' });
    if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });

    try {
        const hash = await bcrypt.hash(password, 10);
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
});

app.post('/api/auth/login', rateLimit(20, 60 * 1000), async (req, res) => {
    try {
        await initDatabase();
    } catch (err) {
        return res.status(500).json({ error: 'Database belum siap' });
    }

    const { username, password } = req.body;

    if (!username || !password) return res.status(400).json({ error: 'Username dan password wajib diisi' });

    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
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
});

app.get('/api/user', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, name, balance, role, user_code, created_at FROM users WHERE id = $1',
            [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/user/update', requireAuth, async (req, res) => {
    const { name } = req.body;
    if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Nama minimal 2 karakter' });
    if (name.trim().length > 50) return res.status(400).json({ error: 'Nama maksimal 50 karakter' });

    try {
        const result = await pool.query(
            'UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, name, balance, user_code',
            [name.trim(), req.user.id]
        );
        res.json({ message: 'Profil berhasil diupdate', user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/user/change-password', requireAuth, async (req, res) => {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Semua field wajib diisi' });
    if (new_password.length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter' });

    try {
        const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });

        const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Password lama salah' });

        const newHash = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);
        res.json({ message: 'Password berhasil diubah' });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/dashboard', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
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
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
    res.json({ message: 'Logout berhasil' });
});

// ============================================
// ===== DEPOSIT — METODE & PRESETS =====
// ============================================
app.get('/api/deposit/methods', requireAuth, (req, res) => {
    res.json({
        methods: [
            {
                id: 'qrispy',
                label: 'QRIS Otomatis',
                desc: 'Bayar pakai QRIS, saldo masuk otomatis',
                icon: 'qrispy',
                fee: 0,
            },
            {
                id: 'qris_dana',
                label: 'QRIS DANA Manual',
                desc: 'Scan QR DANA, butuh konfirmasi admin',
                icon: 'dana',
                fee: 0,
                uniqueCode: true,
            },
        ],
    });
});

app.get('/api/deposit/presets', requireAuth, (req, res) => {
    res.json({
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
    });
});

// ============================================
// ===== DEPOSIT — SAVE QRISPY =====
// ============================================
app.post('/api/deposit/qrispy-save', requireAuth, async (req, res) => {
    try {
        await initDatabase();
    } catch (err) {
        return res.status(500).json({ error: 'Database belum siap' });
    }

    const { reference_id, amount, qris_id, qris_url, expired_at, expires_in_seconds } = req.body;

    if (!reference_id || !amount || !qris_id) {
        return res.status(400).json({ error: 'Data tidak lengkap' });
    }

    if (amount < 1000 || amount > 10000000) {
        return res.status(400).json({ error: 'Nominal tidak valid (Rp1.000 - Rp10.000.000)' });
    }

    try {
        const existing = await pool.query(
            'SELECT * FROM deposits WHERE reference_id = $1',
            [reference_id]
        );

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
                    expires_in_seconds: expires_in_seconds || 900,
                },
            });
        }

        await pool.query(
            `INSERT INTO deposits (user_id, reference_id, method, amount, total_amount, fee, status, qris_id, qris_url, payment_reference, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                req.user.id,
                reference_id,
                'qrispy',
                Number(amount),
                Number(amount),
                0,
                'pending',
                qris_id,
                qris_url,
                reference_id,
                new Date(expired_at),
            ]
        );

        res.json({
            message: 'Deposit tercatat',
            deposit: {
                reference_id,
                method: 'qrispy',
                amount: Number(amount),
                qris_id,
                qris_url,
                expired_at,
                expires_in_seconds: expires_in_seconds || 900,
            },
        });
    } catch (err) {
        console.error('Save deposit error:', err);
        res.status(500).json({ error: 'Gagal simpan deposit' });
    }
});

// ============================================
// ===== DEPOSIT — QRIS DANA MANUAL =====
// ============================================
app.post('/api/deposit/qris-dana', requireAuth, async (req, res) => {
    try {
        await initDatabase();
    } catch (err) {
        return res.status(500).json({ error: 'Database belum siap' });
    }

    const { amount } = req.body;

    if (!amount || amount < 1000) {
        return res.status(400).json({ error: 'Minimal deposit Rp1.000' });
    }
    if (amount > 10000000) {
        return res.status(400).json({ error: 'Maksimal deposit Rp10.000.000' });
    }

    try {
        const uniqueCode = generateUniqueCode();
        const totalAmount = Number(amount) + uniqueCode;
        const referenceId = generateReferenceId();

        const dynamicQRIS = toDynamicQRIS(STATIC_QRIS_DANA, totalAmount);
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(dynamicQRIS)}`;

        await pool.query(
            `INSERT INTO deposits (user_id, reference_id, method, amount, unique_code, total_amount, fee, status, qris_string, qris_url, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                req.user.id,
                referenceId,
                'qris_dana',
                Number(amount),
                uniqueCode,
                totalAmount,
                uniqueCode,
                'pending',
                dynamicQRIS,
                qrImageUrl,
                new Date(Date.now() + 30 * 60 * 1000),
            ]
        );

        res.json({
            message: 'QRIS DANA berhasil dibuat',
            deposit: {
                reference_id: referenceId,
                method: 'qris_dana',
                amount: Number(amount),
                unique_code: uniqueCode,
                total_amount: totalAmount,
                fee: uniqueCode,
                qris_string: dynamicQRIS,
                qris_url: qrImageUrl,
                expired_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                expires_in_seconds: 1800,
            },
        });
    } catch (err) {
        console.error('QRIS DANA deposit error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// ===== DEPOSIT — CEK STATUS (POLLING) =====
// ============================================
app.get('/api/deposit/:referenceId/status', requireAuth, async (req, res) => {
    const { referenceId } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM deposits WHERE reference_id = $1 AND user_id = $2',
            [referenceId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Deposit tidak ditemukan' });
        }

        const deposit = result.rows[0];

        if (deposit.status === 'success') {
            return res.json({ status: 'success', deposit });
        }

        // Auto-expire kalo udah lewat
        if (deposit.status === 'pending' && deposit.expires_at && new Date(deposit.expires_at) < new Date()) {
            await pool.query(
                `UPDATE deposits SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
                [deposit.id]
            );
            const updated = await pool.query('SELECT * FROM deposits WHERE id = $1', [deposit.id]);
            return res.json({ status: 'ok', deposit: updated.rows[0] });
        }

        if (deposit.method === 'qrispy' && deposit.status === 'pending' && deposit.qris_id) {
            try {
                const data = await qrispyFetch(`/api/payment/qris/${deposit.qris_id}/status`);

                if (data.data && data.data.status === 'paid') {
                    await markDepositPaid(deposit, data.data.received_amount || data.data.amount, data.data.paid_at);

                    const updated = await pool.query('SELECT * FROM deposits WHERE id = $1', [deposit.id]);
                    return res.json({ status: 'success', deposit: updated.rows[0] });
                }

                if (data.data && data.data.status === 'expired') {
                    await pool.query(
                        `UPDATE deposits SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
                        [deposit.id]
                    );
                    const updated = await pool.query('SELECT * FROM deposits WHERE id = $1', [deposit.id]);
                    return res.json({ status: 'ok', deposit: updated.rows[0] });
                }
            } catch (err) {
                console.error('QRISPY status check error:', err.message);
            }
        }

        res.json({ status: 'ok', deposit });
    } catch (err) {
        console.error('Check deposit status error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// ===== DEPOSIT — UPDATE FEE =====
// ============================================
app.post('/api/deposit/:referenceId/update-fee', requireAuth, async (req, res) => {
    const { referenceId } = req.params;
    const { total_amount, fee } = req.body;

    try {
        const result = await pool.query(
            'SELECT * FROM deposits WHERE reference_id = $1 AND user_id = $2',
            [referenceId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Deposit tidak ditemukan' });
        }

        const deposit = result.rows[0];
        if (deposit.status !== 'pending') {
            return res.status(400).json({ error: 'Deposit sudah diproses' });
        }

        await pool.query(
            `UPDATE deposits SET total_amount = $1, fee = $2, updated_at = NOW() WHERE id = $3`,
            [Number(total_amount), Number(fee), deposit.id]
        );

        res.json({ message: 'Fee updated' });
    } catch (err) {
        console.error('Update fee error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// ===== DEPOSIT — MARK EXPIRED =====
// ============================================
app.post('/api/deposit/:referenceId/expire', requireAuth, async (req, res) => {
    const { referenceId } = req.params;

    try {
        const result = await pool.query(
            `UPDATE deposits 
             SET status = 'expired', updated_at = NOW() 
             WHERE reference_id = $1 AND user_id = $2 AND status = 'pending'
             RETURNING *`,
            [referenceId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Deposit tidak bisa di-expire' });
        }

        res.json({ message: 'Deposit expired', deposit: result.rows[0] });
    } catch (err) {
        console.error('Expire deposit error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// ===== DEPOSIT — CANCEL =====
// ============================================
app.post('/api/deposit/:referenceId/cancel', requireAuth, async (req, res) => {
    const { referenceId } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM deposits WHERE reference_id = $1 AND user_id = $2',
            [referenceId, req.user.id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit tidak ditemukan' });

        const deposit = result.rows[0];
        if (deposit.status !== 'pending') return res.status(400).json({ error: 'Deposit nggak bisa dibatalkan' });

        if (deposit.method === 'qrispy' && deposit.qris_id) {
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

        res.json({ message: 'Deposit dibatalkan' });
    } catch (err) {
        console.error('Cancel deposit error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// ===== DEPOSIT — LIST TRANSAKSI (PAGINATION) =====
// ============================================
app.get('/api/deposit/history', requireAuth, async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 5));
    const status = req.query.status;

    try {
        let query = 'SELECT * FROM deposits WHERE user_id = $1';
        const params = [req.user.id];

        if (status) {
            query += ` AND status = $${params.length + 1}`;
            params.push(status);
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, (page - 1) * limit);

        const result = await pool.query(query, params);
        const countRes = await pool.query('SELECT COUNT(*) FROM deposits WHERE user_id = $1', [req.user.id]);
        const total = Number(countRes.rows[0].count);
        const totalPages = Math.ceil(total / limit);

        res.json({
            deposits: result.rows,
            total,
            page,
            limit,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
        });
    } catch (err) {
        console.error('List deposits error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// ===== ADMIN — APPROVE DEPOSIT MANUAL =====
// ============================================
app.post('/api/admin/deposit/:referenceId/approve', requireAuth, requireAdmin, async (req, res) => {
    const { referenceId } = req.params;

    try {
        const result = await pool.query('SELECT * FROM deposits WHERE reference_id = $1', [referenceId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Deposit tidak ditemukan' });

        const deposit = result.rows[0];
        if (deposit.status === 'success') return res.status(400).json({ error: 'Sudah di-approve' });

        await markDepositPaid(deposit, deposit.total_amount || deposit.amount, new Date());

        const updated = await pool.query('SELECT * FROM deposits WHERE id = $1', [deposit.id]);
        res.json({ message: 'Deposit di-approve', deposit: updated.rows[0] });
    } catch (err) {
        console.error('Approve error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// ===== WEBHOOK QRISPY =====
// ============================================
app.post('/api/webhook/qrispy', async (req, res) => {
    try {
        const signature = req.headers['x-qrispy-signature'];
        if (!signature) {
            console.error('Webhook: no signature');
            return res.status(401).json({ error: 'No signature' });
        }

        if (!QRISPY_WEBHOOK_SECRET) {
            console.error('Webhook: PW_WEBHOOK not set');
            return res.status(500).json({ error: 'Webhook secret not configured' });
        }

        const expectedSignature = crypto
            .createHmac('sha256', QRISPY_WEBHOOK_SECRET)
            .update(req.rawBody || JSON.stringify(req.body))
            .digest('hex');

        const sigBuffer = Buffer.from(signature, 'hex');
        const expectedBuffer = Buffer.from(expectedSignature, 'hex');

        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
            console.error('Webhook: invalid signature');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        const { event, data } = req.body;
        console.log('Webhook received:', event);

        if (event === 'payment.received') {
            const { qris_id, amount, received_amount, payment_reference, paid_at } = data;

            const result = await pool.query(
                `SELECT * FROM deposits WHERE qris_id = $1 OR reference_id = $2 OR payment_reference = $2 LIMIT 1`,
                [qris_id, payment_reference]
            );

            if (result.rows.length === 0) {
                console.error('Webhook: deposit not found');
                return res.json({ status: 'ok', message: 'Deposit not found' });
            }

            const deposit = result.rows[0];

            const { alreadyProcessed } = await markDepositPaid(
                deposit,
                received_amount || amount,
                paid_at
            );

            if (alreadyProcessed) {
                return res.json({ status: 'ok', message: 'Already processed' });
            }
        }

        res.json({ status: 'ok' });
    } catch (err) {
        console.error('Webhook error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// ===== CRON: AUTO-EXPIRE PENDING DEPOSITS =====
// ============================================
app.post('/api/cron/expire-pending-deposits', async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE deposits 
             SET status = 'expired', updated_at = NOW() 
             WHERE status = 'pending' 
               AND expires_at IS NOT NULL 
               AND expires_at < NOW()
             RETURNING id, reference_id`
        );

        console.log(`⏰ Auto-expired ${result.rowCount} deposits`);
        res.json({ 
            message: `Expired ${result.rowCount} deposits`,
            count: result.rowCount,
            deposits: result.rows
        });
    } catch (err) {
        console.error('Cron expire error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// ===== CRON: SYNC PENDING QRISPY =====
// ============================================
app.post('/api/cron/sync-pending-qrispy', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM deposits 
             WHERE method = 'qrispy' 
               AND status = 'pending' 
               AND qris_id IS NOT NULL
               AND created_at > NOW() - INTERVAL '1 hour'
             ORDER BY created_at DESC LIMIT 20`
        );

        let synced = 0;
        let expired = 0;

        for (const deposit of result.rows) {
            try {
                const data = await qrispyFetch(`/api/payment/qris/${deposit.qris_id}/status`);

                if (data.data && data.data.status === 'paid') {
                    await markDepositPaid(deposit, data.data.received_amount || data.data.amount, data.data.paid_at);
                    synced++;
                } else if (data.data && data.data.status === 'expired') {
                    await pool.query(
                        `UPDATE deposits SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status = 'pending'`,
                        [deposit.id]
                    );
                    expired++;
                }
            } catch (err) {
                console.error(`Sync deposit ${deposit.reference_id} error:`, err.message);
            }
        }

        res.json({ 
            message: `Synced ${synced}, expired ${expired}`,
            checked: result.rows.length,
            synced,
            expired
        });
    } catch (err) {
        console.error('Cron sync error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// ===== NOKOS — SERVERS =====
// ============================================
app.get('/api/nokos/servers', requireAuth, (req, res) => {
    const servers = Object.entries(SERVER_CONFIG).map(([key, config]) => ({
        id: key,
        label: config.label,
        desc: config.desc,
        badge: config.badge,
        countries: config.countries,
        requiresOperator: !!config.requiresOperator,
    }));
    res.json({ servers });
});

app.get('/api/nokos/services', requireAuth, async (req, res) => {
    const { server = 'ekonomi' } = req.query;
    if (!SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });

    const cacheKey = `services_${server}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        const data = await dibananaFetch(`/services?server=${server}`);
        const response = { server, services: data.services || [] };
        cacheSet(cacheKey, response, 5 * 60 * 1000);
        res.json(response);
    } catch (err) {
        console.error('Get services error:', err.message);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

app.get('/api/nokos/countries', requireAuth, async (req, res) => {
    const { server = 'ekonomi', service } = req.query;
    if (!SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });

    const cacheKey = `countries_${server}_${service || 'all'}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        const params = new URLSearchParams({ server });
        if (service) params.append('service', service);
        const data = await dibananaFetch(`/countries?${params.toString()}`);
        if (data.countries) {
            const response = { server, countries: data.countries };
            cacheSet(cacheKey, response, 5 * 60 * 1000);
            return res.json(response);
        }
    } catch (err) {
        console.error('Dibanana countries error, fallback to static:', err.message);
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
});

app.get('/api/nokos/prices', requireAuth, async (req, res) => {
    const { server = 'ekonomi', service, country } = req.query;
    if (!SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });
    if (!service || !country) return res.status(400).json({ error: 'Service dan country wajib' });

    const cacheKey = `prices_${server}_${service}_${country}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        const data = await dibananaFetch(`/prices?server=${server}&service=${service}&country=${country}`);
        const response = { server, service, country, providers: data.providers || [] };
        cacheSet(cacheKey, response, 2 * 60 * 1000);
        res.json(response);
    } catch (err) {
        console.error('Get prices error:', err.message);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

app.post('/api/nokos/order', requireAuth, async (req, res) => {
    try {
        await initDatabase();
    } catch (err) {
        return res.status(500).json({ error: 'Database belum siap' });
    }

    const { id, server, service, country, service_name, country_flag, provider_id, provider_price, operator } = req.body;

    if (!server || !SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });

    const config = SERVER_CONFIG[server];
    const isPremium = !!config.requiresOperator;

    if (isPremium) {
        if (!provider_id || !provider_price || !operator) return res.status(400).json({ error: 'Premium butuh provider_id, provider_price, dan operator' });
        if (!VALID_OPERATORS.includes(operator)) return res.status(400).json({ error: `Operator tidak valid` });
    } else {
        if (!id) return res.status(400).json({ error: 'ID provider wajib' });
    }

    try {
        const userRes = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });
        const userBalance = Number(userRes.rows[0].balance);

        let orderBody;
        if (isPremium) {
            orderBody = { server, service, country, provider_id, provider_price, operator };
        } else {
            orderBody = { id };
        }

        const data = await dibananaFetch('/order', { method: 'POST', body: JSON.stringify(orderBody) });
        const price = data.price_idr;

        if (userBalance < price) {
            try { await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: data.order_id }) }); } catch (e) {}
            return res.status(400).json({ error: 'Saldo kamu tidak cukup. Silakan deposit dulu.' });
        }

        await pool.query('UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2', [price, req.user.id]);

        await pool.query(
            `INSERT INTO orders (user_id, order_id, server, service, service_name, country, country_name, country_flag, operator, phone_number, price, status, expires_in)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [req.user.id, String(data.order_id), server, service || data.service, service_name || null, country || data.country, COUNTRY_NAMES[country] || country, country_flag || null, operator || null, data.phone_number, price, 'pending', 1200]
        );

        await pool.query(
            `INSERT INTO transactions (user_id, order_id, service_name, country, country_flag, phone_number, status, price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [req.user.id, String(data.order_id), service_name || data.service, country || data.country, country_flag || null, data.phone_number, 'pending', price]
        );

        cacheDelPattern('prices_');

        res.json({
            message: 'Order berhasil!',
            order: { order_id: data.order_id, phone_number: data.phone_number, price_idr: data.price_idr, server: data.server, service: data.service, country: data.country, operator: operator || null, status: data.status, expires_in: 1200 },
        });
    } catch (err) {
        console.error('Create order error:', err);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

app.get('/api/nokos/order/:orderId', requireAuth, async (req, res) => {
    const { orderId } = req.params;

    try {
        const orderRes = await pool.query('SELECT * FROM orders WHERE order_id = $1 AND user_id = $2', [String(orderId), req.user.id]);
        if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order tidak ditemukan' });

        const order = orderRes.rows[0];
        if (['received', 'cancelled', 'failed', 'expired', 'refunded'].includes(order.status)) {
            return res.json({ order_id: order.order_id, status: order.status, phone_number: order.phone_number, otp_code: order.otp_code, otp_code_2: order.otp_code_2, full_sms: order.full_sms, price_idr: order.price, service: order.service, country: order.country, operator: order.operator, received_at: order.received_at, expires_in: 0 });
        }

        const data = await dibananaFetch(`/status?order_id=${orderId}`);

        if (data.status !== order.status || data.otp_code) {
            await pool.query(
                `UPDATE orders SET status = $1, otp_code = $2, otp_code_2 = $3, full_sms = $4, received_at = CASE WHEN $1 = 'received' THEN NOW() ELSE received_at END, updated_at = NOW() WHERE order_id = $5`,
                [data.status, data.otp_code, data.otp_code_2, data.full_sms, String(orderId)]
            );
            await pool.query(
                `UPDATE transactions SET status = CASE WHEN $1 = 'received' THEN 'success' WHEN $1 IN ('cancelled', 'expired', 'refunded') THEN 'failed' ELSE status END, otp_code = $2, updated_at = NOW() WHERE order_id = $3`,
                [data.status, data.otp_code, String(orderId)]
            );
        }

        res.json(data);
    } catch (err) {
        console.error('Check status error:', err);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

app.post('/api/nokos/order/:orderId/resend', requireAuth, async (req, res) => {
    const { orderId } = req.params;
    try {
        const orderRes = await pool.query('SELECT * FROM orders WHERE order_id = $1 AND user_id = $2', [String(orderId), req.user.id]);
        if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order tidak ditemukan' });
        const data = await dibananaFetch('/resend', { method: 'POST', body: JSON.stringify({ order_id: Number(orderId) }) });
        await pool.query('UPDATE orders SET resend_count = resend_count + 1, status = $1, updated_at = NOW() WHERE order_id = $2', [data.status, String(orderId)]);
        res.json(data);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

app.post('/api/nokos/order/:orderId/cancel', requireAuth, async (req, res) => {
    const { orderId } = req.params;
    try {
        const orderRes = await pool.query('SELECT * FROM orders WHERE order_id = $1 AND user_id = $2', [String(orderId), req.user.id]);
        if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order tidak ditemukan' });
        const data = await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: Number(orderId) }) });
        if (data.refunded) {
            await pool.query('UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2', [data.refunded, req.user.id]);
        }
        await pool.query('UPDATE orders SET status = $1, updated_at = NOW() WHERE order_id = $2', ['cancelled', String(orderId)]);
        await pool.query('UPDATE transactions SET status = $1, updated_at = NOW() WHERE order_id = $2', ['failed', String(orderId)]);
        res.json(data);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

app.get('/api/nokos/orders', requireAuth, async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    try {
        let query = 'SELECT * FROM orders WHERE user_id = $1';
        const params = [req.user.id];
        if (status) { query += ` AND status = $${params.length + 1}`; params.push(status); }
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(Number(limit), (Number(page) - 1) * Number(limit));
        const result = await pool.query(query, params);
        const countRes = await pool.query('SELECT COUNT(*) FROM orders WHERE user_id = $1', [req.user.id]);
        res.json({ orders: result.rows, total: Number(countRes.rows[0].count), page: Number(page), limit: Number(limit) });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/server-balance', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = await dibananaFetch('/balance');
        res.json(data);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

// ===== GLOBAL ERROR HANDLER =====
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
