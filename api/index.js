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
    ssl: { rejectUnauthorized: false }
});

// ===== JWT SECRET =====
const JWT_SECRET = process.env.JWT_SECRET || 'asyrofotp-secret-ganti-di-env';
const JWT_EXPIRES = '7d';

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

// ===== MIDDLEWARE AUTH =====
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

// ===== INIT DATABASE (auto-migrate) =====
let dbInitialized = false;

async function initDatabase() {
    if (dbInitialized) return;

    try {
        // 1. Tabel users
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT,
                balance BIGINT DEFAULT 0,
                role TEXT DEFAULT 'user',
                status TEXT DEFAULT 'active',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // 2. Tambah kolom user_code (kalau belum ada)
        await pool.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS user_code TEXT;
        `);

        // 3. Unique constraint untuk user_code (kalau belum ada)
        await pool.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'users_user_code_key'
                ) THEN
                    ALTER TABLE users ADD CONSTRAINT users_user_code_key UNIQUE (user_code);
                END IF;
            END $$;
        `);

        // 4. Fungsi generate user_code
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

        // 5. Fungsi trigger set_user_code
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

        // 6. Trigger
        await pool.query(`
            DROP TRIGGER IF EXISTS trigger_set_user_code ON users;
        `);

        await pool.query(`
            CREATE TRIGGER trigger_set_user_code
                BEFORE INSERT ON users
                FOR EACH ROW
                EXECUTE FUNCTION set_user_code();
        `);

        // 7. Backfill user_code yang masih NULL
        await pool.query(`
            UPDATE users SET user_code = generate_user_code() WHERE user_code IS NULL;
        `);

        // 8. Tabel transactions
        await pool.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
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

        // 9. Tabel deposits
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

        dbInitialized = true;
        console.log('✅ Database initialized');
    } catch (err) {
        console.error('❌ Database init failed:', err.message);
    }
}

// ===== ROUTE: HEALTH =====
app.get('/api/health', async (req, res) => {
    try {
        await initDatabase();
        const result = await pool.query('SELECT NOW() as time');
        res.json({
            status: 'ok',
            time: result.rows[0].time,
            hasDatabaseUrl: !!process.env.DATABASE_URL,
            hasJwtSecret: !!process.env.JWT_SECRET
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== ROUTE: REGISTER =====
app.post('/api/auth/register', async (req, res) => {
    await initDatabase();

    const { username, password, name } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username dan password wajib diisi' });
    }

    if (!isValidUsername(username)) {
        return res.status(400).json({
            error: 'Username hanya boleh huruf, angka, underscore (3-20 karakter)'
        });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);

        const result = await pool.query(
            `INSERT INTO users (username, password_hash, name)
             VALUES ($1, $2, $3)
             RETURNING id, username, name, balance, user_code`,
            [username.toLowerCase(), hash, name || username]
        );

        res.json({
            message: 'Registrasi berhasil! Silakan login.',
            user: result.rows[0]
        });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Username sudah dipakai' });
        }
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== ROUTE: LOGIN =====
app.post('/api/auth/login', async (req, res) => {
    await initDatabase();

    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username dan password wajib diisi' });
    }

    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1',
            [username.toLowerCase()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Username atau password salah' });
        }

        const user = result.rows[0];

        if (user.status === 'banned') {
            return res.status(403).json({ error: 'Akun kamu diblokir' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Username atau password salah' });
        }

        const token = signToken(user);

        res.json({
            message: 'Login berhasil!',
            session: { access_token: token },
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                balance: user.balance,
                user_code: user.user_code
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== ROUTE: GET CURRENT USER =====
app.get('/api/user', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, name, balance, role, user_code, created_at FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Get user error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== ROUTE: UPDATE PROFILE (nama) =====
app.post('/api/user/update', requireAuth, async (req, res) => {
    const { name } = req.body;

    if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: 'Nama minimal 2 karakter' });
    }

    try {
        const result = await pool.query(
            'UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, username, name, balance, user_code',
            [name.trim(), req.user.id]
        );

        res.json({ message: 'Profil berhasil diupdate', user: result.rows[0] });
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== ROUTE: CHANGE PASSWORD =====
app.post('/api/user/change-password', requireAuth, async (req, res) => {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
        return res.status(400).json({ error: 'Semua field wajib diisi' });
    }

    if (new_password.length < 6) {
        return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
    }

    try {
        const result = await pool.query(
            'SELECT password_hash FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }

        const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Password lama salah' });
        }

        const newHash = await bcrypt.hash(new_password, 10);

        await pool.query(
            'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
            [newHash, req.user.id]
        );

        res.json({ message: 'Password berhasil diubah' });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== ROUTE: DASHBOARD STATS =====
app.get('/api/dashboard', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM transactions
             WHERE user_id = $1
             ORDER BY created_at DESC`,
            [req.user.id]
        );

        const transactions = result.rows;

        const stats = {
            total: transactions.length,
            success: transactions.filter(t => t.status === 'success').length,
            pending: transactions.filter(t => t.status === 'pending').length,
            failed: transactions.filter(t => t.status === 'failed').length
        };

        res.json({
            stats,
            transactions: transactions.slice(0, 5)
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ===== ROUTE: LOGOUT =====
app.post('/api/auth/logout', requireAuth, (req, res) => {
    res.json({ message: 'Logout berhasil' });
});

// ===== EXPORT =====
module.exports = app;
