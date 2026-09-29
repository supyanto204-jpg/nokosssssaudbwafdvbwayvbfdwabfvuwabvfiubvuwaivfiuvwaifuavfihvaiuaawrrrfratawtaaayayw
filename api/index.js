const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== DATABASE POOL =====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

// ===== JWT =====
const JWT_SECRET = process.env.JWT_SECRET || 'asyrofotp-secret-ganti-di-env';
const JWT_EXPIRES = '7d';

// ===== DIBANANA API =====
const DIBANANA_BASE = 'https://dibanana.id/api/v1';
const DIBANANA_API_KEY = process.env.API_SERVER_EKONOMI; // 1 key buat semua server

// Config tiap server
const SERVER_CONFIG = {
    ekonomi: {
        label: 'Server Ekonomis',
        desc: 'Harga terjangkau, khusus Indonesia',
        badge: 'EKONOMI',
        countries: ['id'],
    },
    premium: {
        label: 'Server Premium',
        desc: 'Bisa pilih operator, kualitas terjamin',
        badge: 'PREMIUM',
        countries: ['id'],
        requiresOperator: true,
    },
    khusus: {
        label: 'Server Khusus',
        desc: 'Semua negara, stok lengkap',
        badge: 'LENGKAP',
        countries: null, // semua negara
    },
    wa_luar: {
        label: 'Server WA Luar',
        desc: 'WhatsApp luar negeri (non-Indonesia)',
        badge: 'LUAR',
        countries: null,
        excludeCountries: ['id'],
    },
};

// Operator valid (khusus premium)
const VALID_OPERATORS = ['any', 'telkomsel', 'indosat', 'axis', 'three', 'smartfren', 'byu'];

// Country names (fallback kalau provider nggak kasih nama)
const COUNTRY_NAMES = {
    id: 'Indonesia',
    ru: 'Russia',
    us: 'United States',
    my: 'Malaysia',
    vn: 'Vietnam',
    ph: 'Philippines',
    th: 'Thailand',
    sg: 'Singapore',
    in: 'India',
    cn: 'China',
    jp: 'Japan',
    kr: 'South Korea',
    uk: 'United Kingdom',
    de: 'Germany',
    fr: 'France',
    br: 'Brazil',
    ng: 'Nigeria',
};

// Helper: call dibanana API
async function dibananaFetch(endpoint, options = {}) {
    if (!DIBANANA_API_KEY) {
        throw new Error('API_SERVER_EKONOMI belum di-set');
    }

    const res = await fetch(`${DIBANANA_BASE}${endpoint}`, {
        ...options,
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
        throw new Error(`Provider error: ${res.status}`);
    }

    if (!res.ok || data.ok === false) {
        const err = new Error(data.message || data.error || 'Provider error');
        err.status = res.status;
        err.code = data.error;
        err.data = data;
        throw err;
    }

    return data;
}

// ===== HELPERS =====
function isValidUsername(username) {
    return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

function signToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
}

// ===== MIDDLEWARE =====
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token invalid atau expired' });
    }
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin only' });
    }
    next();
}

// ===== INIT DATABASE =====
let dbInitialized = false;

async function initDatabase() {
    if (dbInitialized) return;

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
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'users_user_code_key'
                ) THEN
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

        // Tabel orders
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

        // Tabel transactions
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

        // Tabel deposits
        await pool.query(`
            CREATE TABLE IF NOT EXISTS deposits (
                id SERIAL PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                amount BIGINT NOT NULL,
                method TEXT,
                status TEXT DEFAULT 'pending',
                reference_id TEXT UNIQUE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        await pool.query(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_id, created_at DESC);`);

        dbInitialized = true;
        console.log('✅ Database initialized');
    } catch (err) {
        console.error('❌ Database init failed:', err.message);
    }
}

// ===== HEALTH =====
app.get('/api/health', async (req, res) => {
    await initDatabase();
    try {
        const result = await pool.query('SELECT NOW() as time');
        res.json({
            status: 'ok',
            time: result.rows[0].time,
            hasDibananaKey: !!DIBANANA_API_KEY,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== REGISTER =====
app.post('/api/auth/register', async (req, res) => {
    await initDatabase();
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

// ===== LOGIN =====
app.post('/api/auth/login', async (req, res) => {
    await initDatabase();
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

// ===== GET USER =====
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

// ===== UPDATE PROFILE =====
app.post('/api/user/update', requireAuth, async (req, res) => {
    const { name } = req.body;
    if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Nama minimal 2 karakter' });

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

// ===== CHANGE PASSWORD =====
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

// ===== DASHBOARD =====
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

// ===== LOGOUT =====
app.post('/api/auth/logout', requireAuth, (req, res) => {
    res.json({ message: 'Logout berhasil' });
});

// ============================================
// ===== NOKOS ROUTES =====
// ============================================

// ===== GET SERVERS =====
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

// ===== GET SERVICES (per server) =====
app.get('/api/nokos/services', requireAuth, async (req, res) => {
    const { server = 'ekonomi' } = req.query;

    if (!SERVER_CONFIG[server]) {
        return res.status(400).json({ error: 'Server tidak valid' });
    }

    try {
        const data = await dibananaFetch(`/services?server=${server}`);
        res.json({
            server,
            services: data.services || [],
        });
    } catch (err) {
        console.error('Get services error:', err);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

// ===== GET COUNTRIES (per server) =====
app.get('/api/nokos/countries', requireAuth, async (req, res) => {
    const { server = 'ekonomi', service } = req.query;

    if (!SERVER_CONFIG[server]) {
        return res.status(400).json({ error: 'Server tidak valid' });
    }

    // Coba ambil dari provider dulu
    try {
        const params = new URLSearchParams({ server });
        if (service) params.append('service', service);

        const data = await dibananaFetch(`/countries?${params.toString()}`);
        if (data.countries) {
            return res.json({ server, countries: data.countries });
        }
    } catch (err) {
        // Fallback: pakai config lokal
    }

    // Fallback: daftar negara dari config
    const config = SERVER_CONFIG[server];
    let countries = [];

    if (config.countries) {
        countries = config.countries.map(c => ({
            code: c,
            name: COUNTRY_NAMES[c] || c.toUpperCase(),
        }));
    } else {
        // Semua negara
        countries = Object.entries(COUNTRY_NAMES).map(([code, name]) => ({
            code,
            name,
        }));

        // Kecuali exclude
        if (config.excludeCountries) {
            countries = countries.filter(c => !config.excludeCountries.includes(c.code));
        }
    }

    res.json({ server, countries });
});

// ===== GET PRICES =====
app.get('/api/nokos/prices', requireAuth, async (req, res) => {
    const { server = 'ekonomi', service, country } = req.query;

    if (!SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });
    if (!service || !country) return res.status(400).json({ error: 'Service dan country wajib' });

    try {
        const data = await dibananaFetch(
            `/prices?server=${server}&service=${service}&country=${country}`
        );
        res.json({
            server,
            service,
            country,
            providers: data.providers || [],
        });
    } catch (err) {
        console.error('Get prices error:', err);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

// ===== CREATE ORDER =====
app.post('/api/nokos/order', requireAuth, async (req, res) => {
    await initDatabase();

    const {
        id,                 // provider id (buat ekonomi/khusus/wa_luar)
        server = 'ekonomi',
        service,
        country,
        service_name,
        country_flag,
        provider_id,        // khusus premium
        provider_price,     // khusus premium
        operator,           // khusus premium
    } = req.body;

    if (!SERVER_CONFIG[server]) return res.status(400).json({ error: 'Server tidak valid' });

    const config = SERVER_CONFIG[server];

    // Validasi khusus premium
    if (config.requiresOperator) {
        if (!provider_id || !provider_price || !operator) {
            return res.status(400).json({ error: 'Premium butuh provider_id, provider_price, dan operator' });
        }
        if (!VALID_OPERATORS.includes(operator)) {
            return res.status(400).json({ error: `Operator tidak valid. Pilih: ${VALID_OPERATORS.join(', ')}` });
        }
    } else {
        if (!id) {
            return res.status(400).json({ error: 'ID provider wajib' });
        }
    }

    try {
        // Cek saldo user
        const userRes = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });

        const userBalance = Number(userRes.rows[0].balance);

        // Build body buat dibanana
        let orderBody;
        if (config.requiresOperator) {
            orderBody = {
                server,
                service,
                country,
                provider_id,
                provider_price,
                operator,
            };
        } else {
            orderBody = { id };
        }

        // Order ke dibanana
        const data = await dibananaFetch('/order', {
            method: 'POST',
            body: JSON.stringify(orderBody),
        });

        const price = data.price_idr;

        // Cek saldo user cukup
        if (userBalance < price) {
            // Cancel order
            try {
                await dibananaFetch('/cancel', {
                    method: 'POST',
                    body: JSON.stringify({ order_id: data.order_id }),
                });
            } catch (e) {}

            return res.status(400).json({ error: 'Saldo kamu tidak cukup. Silakan deposit dulu.' });
        }

        // Potong saldo user
        await pool.query(
            'UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
            [price, req.user.id]
        );

        // Simpan order
        await pool.query(
            `INSERT INTO orders (user_id, order_id, server, service, service_name, country, country_name, country_flag, operator, phone_number, price, status, expires_in)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                req.user.id,
                String(data.order_id),
                server,
                service || data.service,
                service_name || null,
                country || data.country,
                COUNTRY_NAMES[country] || country,
                country_flag || null,
                operator || null,
                data.phone_number,
                price,
                'pending',
                1200,
            ]
        );

        // Simpan ke transactions
        await pool.query(
            `INSERT INTO transactions (user_id, order_id, service_name, country, country_flag, phone_number, status, price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                req.user.id,
                String(data.order_id),
                service_name || data.service,
                country || data.country,
                country_flag || null,
                data.phone_number,
                'pending',
                price,
            ]
        );

        res.json({
            message: 'Order berhasil!',
            order: {
                order_id: data.order_id,
                phone_number: data.phone_number,
                price_idr: data.price_idr,
                server: data.server,
                service: data.service,
                country: data.country,
                operator: operator || null,
                status: data.status,
                expires_in: 1200,
            },
        });
    } catch (err) {
        console.error('Create order error:', err);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

// ===== CHECK ORDER STATUS =====
app.get('/api/nokos/order/:orderId', requireAuth, async (req, res) => {
    const { orderId } = req.params;

    try {
        const orderRes = await pool.query(
            'SELECT * FROM orders WHERE order_id = $1 AND user_id = $2',
            [String(orderId), req.user.id]
        );

        if (orderRes.rows.length === 0) {
            return res.status(404).json({ error: 'Order tidak ditemukan' });
        }

        const order = orderRes.rows[0];

        // Kalau final, return dari DB
        if (['received', 'cancelled', 'failed', 'expired', 'refunded'].includes(order.status)) {
            return res.json({
                order_id: order.order_id,
                status: order.status,
                phone_number: order.phone_number,
                otp_code: order.otp_code,
                otp_code_2: order.otp_code_2,
                full_sms: order.full_sms,
                price_idr: order.price,
                service: order.service,
                country: order.country,
                server: order.server,
                operator: order.operator,
                received_at: order.received_at,
                expires_in: 0,
            });
        }

        // Cek ke dibanana
        const data = await dibananaFetch(`/status?order_id=${orderId}`);

        // Update DB kalau status berubah
        if (data.status !== order.status || data.otp_code) {
            await pool.query(
                `UPDATE orders
                 SET status = $1, otp_code = $2, otp_code_2 = $3, full_sms = $4,
                     received_at = CASE WHEN $1 = 'received' THEN NOW() ELSE received_at END,
                     updated_at = NOW()
                 WHERE order_id = $5`,
                [data.status, data.otp_code, data.otp_code_2, data.full_sms, String(orderId)]
            );

            await pool.query(
                `UPDATE transactions
                 SET status = CASE WHEN $1 = 'received' THEN 'success'
                                   WHEN $1 IN ('cancelled', 'expired', 'refunded') THEN 'failed'
                                   ELSE status END,
                     otp_code = $2,
                     updated_at = NOW()
                 WHERE order_id = $3`,
                [data.status, data.otp_code, String(orderId)]
            );
        }

        res.json(data);
    } catch (err) {
        console.error('Check status error:', err);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

// ===== RESEND OTP =====
app.post('/api/nokos/order/:orderId/resend', requireAuth, async (req, res) => {
    const { orderId } = req.params;

    try {
        const orderRes = await pool.query(
            'SELECT * FROM orders WHERE order_id = $1 AND user_id = $2',
            [String(orderId), req.user.id]
        );

        if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order tidak ditemukan' });

        const data = await dibananaFetch('/resend', {
            method: 'POST',
            body: JSON.stringify({ order_id: Number(orderId) }),
        });

        await pool.query(
            'UPDATE orders SET resend_count = resend_count + 1, status = $1, updated_at = NOW() WHERE order_id = $2',
            [data.status, String(orderId)]
        );

        res.json(data);
    } catch (err) {
        console.error('Resend error:', err);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

// ===== CANCEL ORDER =====
app.post('/api/nokos/order/:orderId/cancel', requireAuth, async (req, res) => {
    const { orderId } = req.params;

    try {
        const orderRes = await pool.query(
            'SELECT * FROM orders WHERE order_id = $1 AND user_id = $2',
            [String(orderId), req.user.id]
        );

        if (orderRes.rows.length === 0) return res.status(404).json({ error: 'Order tidak ditemukan' });

        const order = orderRes.rows[0];

        const data = await dibananaFetch('/cancel', {
            method: 'POST',
            body: JSON.stringify({ order_id: Number(orderId) }),
        });

        // Refund saldo user
        if (data.refunded) {
            await pool.query(
                'UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
                [data.refunded, req.user.id]
            );
        }

        await pool.query(
            'UPDATE orders SET status = $1, updated_at = NOW() WHERE order_id = $2',
            ['cancelled', String(orderId)]
        );
        await pool.query(
            'UPDATE transactions SET status = $1, updated_at = NOW() WHERE order_id = $2',
            ['failed', String(orderId)]
        );

        res.json(data);
    } catch (err) {
        console.error('Cancel error:', err);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

// ===== LIST ORDERS (buat pesanan aktif + inbox) =====
app.get('/api/nokos/orders', requireAuth, async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;

    try {
        let query = 'SELECT * FROM orders WHERE user_id = $1';
        const params = [req.user.id];

        if (status) {
            query += ` AND status = $${params.length + 1}`;
            params.push(status);
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(Number(limit), (Number(page) - 1) * Number(limit));

        const result = await pool.query(query, params);

        const countRes = await pool.query(
            'SELECT COUNT(*) FROM orders WHERE user_id = $1',
            [req.user.id]
        );

        res.json({
            orders: result.rows,
            total: Number(countRes.rows[0].count),
            page: Number(page),
            limit: Number(limit),
        });
    } catch (err) {
        console.error('List orders error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== ADMIN: SALDO SERVER =====
app.get('/api/admin/server-balance', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = await dibananaFetch('/balance');
        res.json(data);
    } catch (err) {
        console.error('Server balance error:', err);
        res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
});

// ===== EXPORT =====
module.exports = app;
