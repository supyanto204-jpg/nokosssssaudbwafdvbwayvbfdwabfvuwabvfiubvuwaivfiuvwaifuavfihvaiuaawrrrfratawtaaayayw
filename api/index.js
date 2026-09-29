const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== SUPABASE CLIENT =====
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// ===== HELPER: username → email palsu =====
function usernameToEmail(username) {
    return `${username.toLowerCase()}@asyrofotp.local`;
}

// ===== HELPER: validasi username =====
function isValidUsername(username) {
    return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

// ===== MIDDLEWARE: verify token =====
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        return res.status(401).json({ error: 'Token invalid atau expired' });
    }

    req.user = user;
    req.token = token;
    next();
}

// ===== ROUTE: REGISTER =====
app.post('/api/auth/register', async (req, res) => {
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

    const email = usernameToEmail(username);

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                username: username.toLowerCase(),
                name: name || username
            }
        }
    });

    if (error) {
        if (error.message.includes('already registered')) {
            return res.status(400).json({ error: 'Username sudah dipakai' });
        }
        return res.status(400).json({ error: error.message });
    }

    res.json({
        message: 'Registrasi berhasil! Silakan login.',
        user: {
            id: data.user.id,
            username: username.toLowerCase(),
            name: name || username
        }
    });
});

// ===== ROUTE: LOGIN =====
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username dan password wajib diisi' });
    }

    const email = usernameToEmail(username);

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        return res.status(401).json({ error: 'Username atau password salah' });
    }

    res.json({
        message: 'Login berhasil!',
        session: {
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at
        },
        user: {
            id: data.user.id,
            username: data.user.user_metadata?.username,
            name: data.user.user_metadata?.name
        }
    });
});

// ===== ROUTE: GET CURRENT USER (dengan saldo dari public.users) =====
app.get('/api/user', requireAuth, async (req, res) => {
    const { data: profile, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.user.id)
        .single();

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.json({
        id: profile.id,
        username: profile.username,
        name: profile.name,
        balance: profile.balance,
        role: profile.role,
        created_at: profile.created_at
    });
});

// ===== ROUTE: GET DASHBOARD STATS =====
app.get('/api/dashboard', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;

        // Stats transaksi
        const { data: transactions, error: txError } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (txError) throw txError;

        const stats = {
            total: transactions.length,
            success: transactions.filter(t => t.status === 'success').length,
            pending: transactions.filter(t => t.status === 'pending').length,
            failed: transactions.filter(t => t.status === 'failed').length
        };

        // 5 transaksi terakhir
        const recent = transactions.slice(0, 5);

        res.json({ stats, transactions: recent });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===== ROUTE: LOGOUT =====
app.post('/api/auth/logout', requireAuth, async (req, res) => {
    const { error } = await supabase.auth.signOut();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ message: 'Logout berhasil' });
});

// ===== EXPORT =====
module.exports = app;
