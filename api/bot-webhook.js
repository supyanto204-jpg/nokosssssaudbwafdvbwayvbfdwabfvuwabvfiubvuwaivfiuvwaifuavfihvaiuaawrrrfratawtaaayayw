const { Telegraf } = require('telegraf');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

module.exports = function setupBotWebhook(app, deps) {
    const { pool } = deps;

    // ============================================================
    // ENV & CONST
    // ============================================================
    const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const FIRE = '5104841245755180586';
    const SEP = '§';

    const DIBANANA_BASE = process.env.DIBANANA_BASE || 'https://dibanana.id/api/v1';
    const DIBANANA_API_KEY = process.env.API_SERVER_EKONOMI;
    const PREMIUM_BASE = process.env.PREMIUM_BASE;
    const PREMIUM_API_KEY = process.env.API_SERVER_PREMIUM;
    const QRISPY_BASE = process.env.QRISPY_BASE || 'https://cloudflareworkerdeploydidashcloudflarecomexportdef.rahayucahyapurwa.workers.dev';
    const QRISPY_API_TOKEN = process.env.QRISPY_API_TOKEN || '';
    const QRISPY_AUTH_MODE = (process.env.QRISPY_AUTH_MODE || 'x-api-token').toLowerCase();
    const PROVIDER_TIMEOUT_MS = 10000;
    const MARKUP_PERCENT = 0.10;
    const DEPOSIT_FEE_MIN = 50;
    const DEPOSIT_FEE_MAX = 100;
    const DEPOSIT_FEE_PERCENT = 0.005;

    // ============================================================
    // DEBUG HELPER
    // ============================================================
    const DEBUG = process.env.BOT_DEBUG !== 'false';

    function dbg(tag, obj) {
        if (!DEBUG) return;
        try {
            const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
            console.log(`[BOT ${tag}]`, s.length > 2000 ? s.slice(0, 2000) + '...' : s);
        } catch (_) {
            console.log(`[BOT ${tag}]`, String(obj));
        }
    }

    const escapeHtml = (s) => String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const toRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

    function fmtErr(e) {
        let msg = `❌ <b>${escapeHtml(e.message || 'Error')}</b>`;
        const meta = [];
        if (e.status) meta.push(`status: ${e.status}`);
        if (e.code) meta.push(`code: ${e.code}`);
        if (e.endpoint) meta.push(`endpoint: ${e.endpoint}`);
        if (meta.length) msg += `\n<code>${meta.join(' | ')}</code>`;

        const raw = e.raw ?? e.data ?? e.details;
        if (raw) {
            let s;
            try { s = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2); }
            catch (_) { s = String(raw); }
            if (s.length > 3500) s = s.slice(0, 3500) + '\n... (truncated)';
            msg += `\n\n<b>🔍 Raw response:</b>\n<pre>${escapeHtml(s)}</pre>`;
        }
        return msg;
    }

    // Strip tag rich yang gak didukung Bot API biasa
    function stripRichTags(html) {
        return String(html || '')
            .replace(/<\/?(table|thead|tbody|tr|th|td|ul|ol|li|details|summary)[^>]*>/gi, '')
            .replace(/<\/td>\s*<td[^>]*>/gi, ' | ')
            .replace(/<\/th>\s*<th[^>]*>/gi, ' | ')
            .replace(/<(?!\/?(b|i|u|s|code|pre|a)(\s|>|\/))/gi, '&lt;')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    // ============================================================
    // PROVIDER FETCH
    // ============================================================
    async function dibananaFetch(endpoint, options = {}) {
        if (!DIBANANA_API_KEY) throw new Error('API_SERVER_EKONOMI belum di-set');
        if (!DIBANANA_BASE) throw new Error('DIBANANA_BASE belum di-set');

        const url = `${DIBANANA_BASE}${endpoint}`;
        dbg('dibanana:req', { url, method: options.method || 'GET', body: options.body });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${DIBANANA_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'AsyrofOTP-Bot/1.0',
                    ...(options.headers || {}),
                },
            });
            const text = await res.text();
            dbg('dibanana:res', { status: res.status, body: text.slice(0, 1500) });

            let data;
            try { data = JSON.parse(text); }
            catch (_) {
                const err = new Error(`dibanana: response bukan JSON`);
                err.status = res.status;
                err.endpoint = url;
                err.raw = text.slice(0, 1000);
                throw err;
            }

            if (!res.ok || data.ok === false) {
                const err = new Error(data.message || data.error || `dibanana HTTP ${res.status}`);
                err.status = res.status;
                err.code = data.error;
                err.endpoint = url;
                err.data = data;
                throw err;
            }
            return data;
        } finally { clearTimeout(timeout); }
    }

    async function premiumFetch(endpoint, options = {}) {
        if (!PREMIUM_API_KEY) throw new Error('API_SERVER_PREMIUM belum di-set');
        if (!PREMIUM_BASE) throw new Error('PREMIUM_BASE belum di-set');

        const url = `${PREMIUM_BASE}${endpoint}`;
        dbg('premium:req', { url, method: options.method || 'GET', body: options.body });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${PREMIUM_API_KEY}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'User-Agent': 'AsyrofOTP-Bot/1.0',
                    ...(options.headers || {}),
                },
            });
            const text = await res.text();
            dbg('premium:res', { status: res.status, body: text.slice(0, 1500) });

            let data;
            try { data = JSON.parse(text); }
            catch (_) {
                const err = new Error(`premium: response bukan JSON`);
                err.status = res.status;
                err.endpoint = url;
                err.raw = text.slice(0, 1000);
                throw err;
            }

            if (!res.ok || data.success === false) {
                const err = new Error(data.error?.message || data.message || `premium HTTP ${res.status}`);
                err.status = res.status;
                err.code = data.error?.code || data.code;
                err.endpoint = url;
                err.data = data;
                throw err;
            }
            return data.data;
        } finally { clearTimeout(timeout); }
    }

    // ============================================================
    // QRISPY FETCH — auth mode configurable
    // ============================================================
    async function qrispyFetch(endpoint, options = {}) {
        const url = `${QRISPY_BASE}${endpoint}`;
        dbg('qrispy:req', { url, method: options.method || 'GET', body: options.body });

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'AsyrofOTP-Bot/1.0',
            ...(options.headers || {}),
        };
        if (QRISPY_API_TOKEN) {
            if (QRISPY_AUTH_MODE === 'bearer') headers['Authorization'] = `Bearer ${QRISPY_API_TOKEN}`;
            else if (QRISPY_AUTH_MODE === 'x-api-token') headers['X-API-Token'] = QRISPY_API_TOKEN;
            else if (QRISPY_AUTH_MODE === 'x-qrispy-token') headers['X-Qrispy-Token'] = QRISPY_API_TOKEN;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
        try {
            const res = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers,
            });
            const text = await res.text();
            dbg('qrispy:res', { status: res.status, body: text.slice(0, 1500) });

            let data;
            try { data = JSON.parse(text); }
            catch (_) {
                const err = new Error(`qrispy error ${res.status}: response bukan JSON`);
                err.status = res.status;
                err.endpoint = url;
                err.raw = text.slice(0, 1000);
                throw err;
            }
            if (!res.ok || data.status === 'error') {
                const err = new Error(data.message || `qrispy HTTP ${res.status}`);
                err.status = res.status;
                err.endpoint = url;
                err.data = data;
                throw err;
            }
            return data;
        } finally { clearTimeout(timeout); }
    }

    // ============================================================
    // HELPERS
    // ============================================================
    function premiumMoneyToIdr(money) {
        if (money == null) return 0;
        return Math.round(Number(money) || 0);
    }
    function applyMarkup(providerPrice) {
        const p = Number(providerPrice) || 0;
        if (p <= 0) return 0;
        return Math.round(p * (1 + MARKUP_PERCENT));
    }
    function calculateDepositFee(amount) {
        const a = Number(amount) || 0;
        if (a <= 0) return DEPOSIT_FEE_MIN;
        const fee = Math.round(a * DEPOSIT_FEE_PERCENT);
        return Math.max(DEPOSIT_FEE_MIN, Math.min(DEPOSIT_FEE_MAX, fee));
    }

    // === UNIVERSAL PARSER ===
    function pickArray(data, ...keys) {
        for (const k of keys) {
            if (Array.isArray(data?.[k])) return data[k];
            if (Array.isArray(data?.data?.[k])) return data.data[k];
            if (Array.isArray(data?.result?.[k])) return data.result[k];
        }
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.data)) return data.data;
        if (Array.isArray(data?.result)) return data.result;
        return [];
    }

    function pickPrice(p) {
        const candidates = [
            p.price_idr, p.priceIdr, p.price_IDR, p.sell_price, p.sellPrice,
            p.price, p.amount, p.cost, p.harga, p.rate,
        ];
        for (const v of candidates) {
            if (v != null && Number(v) > 0) return Number(v);
        }
        return 0;
    }
    function pickStock(p) {
        const candidates = [p.stock, p.available, p.qty, p.quantity, p.stok, p.count];
        for (const v of candidates) {
            if (v != null && !isNaN(Number(v))) return Number(v);
        }
        return 0;
    }
    function pickId(p) {
        const candidates = [p.id, p.provider_id, p.providerId, p.product_id, p.productId, p.pid, p.code];
        for (const v of candidates) {
            if (v != null && String(v).trim()) return String(v);
        }
        return null;
    }
    function pickName(p) {
        const candidates = [p.name, p.provider_name, p.label, p.title, p.service_name];
        for (const v of candidates) {
            if (v != null && String(v).trim()) return String(v);
        }
        return '-';
    }
    function pickCode(p) {
        const candidates = [p.code, p.service_code, p.serviceCode, p.slug, p.key];
        for (const v of candidates) {
            if (v != null && String(v).trim()) return String(v).toLowerCase();
        }
        return null;
    }

    // ============================================================
    // PROVIDER OPERATIONS
    // ============================================================
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

    async function markDepositPaid(deposit, receivedAmount, paidAt) {
        const saldoMasuk = Number(deposit.amount);
        const totalBayar = Number(receivedAmount) || Number(deposit.total_amount) || saldoMasuk;
        const gatewayFee = Math.max(0, totalBayar - saldoMasuk);
        const storedFee = Number(deposit.fee) || 0;
        const ourFee = storedFee > 0 ? storedFee : calculateDepositFee(saldoMasuk);
        const fee = gatewayFee + ourFee;
        const paidTime = paidAt ? new Date(paidAt) : new Date();

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const upd = await client.query(
                `UPDATE deposits SET status = 'success', paid_at = $1, updated_at = NOW(),
                        total_amount = $2, fee = $3
                 WHERE id = $4 AND status = 'pending' RETURNING *`,
                [paidTime, totalBayar, fee, deposit.id]
            );
            if (upd.rowCount === 0) {
                await client.query('ROLLBACK');
                return { alreadyProcessed: true, saldoMasuk, totalBayar, fee };
            }
            await client.query(
                'UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
                [saldoMasuk, deposit.user_id]
            );
            await client.query(
                `INSERT INTO transactions (user_id, order_id, service_name, status, price)
                 VALUES ($1, $2, 'Deposit QRIS', 'success', $3)`,
                [deposit.user_id, deposit.reference_id, totalBayar]
            );
            await client.query('COMMIT');
            return { alreadyProcessed: false, saldoMasuk, totalBayar, fee };
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            client.release();
        }
    }

    // ============================================================
    // BOT SETUP
    // ============================================================
    const bot = new Telegraf(TOKEN);

    async function apiCall(method, payload) {
        const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(`${method}: ${data.description}`);
        return data.result;
    }

    async function sendRich(ctx, html, buttons = []) {
        const payload = {
            chat_id: ctx.chat.id,
            rich_message: { html },
            message_effect_id: FIRE,
        };
        if (buttons.length) payload.reply_markup = { inline_keyboard: buttons };
        try {
            return await apiCall('sendRichMessage', payload);
        } catch (e) {
            dbg('sendRich:fail', e.message);
            const fb = {
                chat_id: ctx.chat.id,
                text: stripRichTags(html),
                parse_mode: 'HTML',
            };
            if (buttons.length) fb.reply_markup = { inline_keyboard: buttons };
            try {
                return await apiCall('sendMessage', fb);
            } catch (e2) {
                const fb2 = {
                    chat_id: ctx.chat.id,
                    text: stripRichTags(html).replace(/<[^>]+>/g, ''),
                };
                if (buttons.length) fb2.reply_markup = { inline_keyboard: buttons };
                return await apiCall('sendMessage', fb2);
            }
        }
    }

    // EDIT MURNI — no delete, no resend
    async function editRich(ctx, html, buttons = []) {
        const msgId = ctx.callbackQuery?.message?.message_id;
        if (!msgId) return sendRich(ctx, html, buttons);

        const mk = () => buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {};

        // 1. Coba rich_message dulu (support <table>)
        try {
            return await apiCall('editMessageText', {
                chat_id: ctx.chat.id,
                message_id: msgId,
                rich_message: { html },
                ...mk(),
            });
        } catch (e) {
            dbg('editRich:rich-fail', e.message);
        }

        // 2. Fallback: text + HTML (strip tag rich)
        try {
            return await apiCall('editMessageText', {
                chat_id: ctx.chat.id,
                message_id: msgId,
                text: stripRichTags(html),
                parse_mode: 'HTML',
                ...mk(),
            });
        } catch (e) {
            dbg('editRich:text-fail', e.message);
        }

        // 3. Fallback plain text
        try {
            return await apiCall('editMessageText', {
                chat_id: ctx.chat.id,
                message_id: msgId,
                text: stripRichTags(html).replace(/<[^>]+>/g, ''),
                ...mk(),
            });
        } catch (e2) {
            dbg('editRich:plain-fail', e2.message);
            throw e2;
        }
    }

    const btnPrimary = (t, d) => ({ text: t, callback_data: d, style: 'primary' });
    const btnSuccess = (t, d) => ({ text: t, callback_data: d, style: 'success' });
    const btnDanger  = (t, d) => ({ text: t, callback_data: d, style: 'danger' });
    const btnNormal  = (t, d) => ({ text: t, callback_data: d });
    const btnUrl     = (t, u) => ({ text: t, url: u });

    // ============================================================
    // USER
    // ============================================================
    async function getOrCreateUser(ctx) {
        const tgId = ctx.from.id;
        let r = await pool.query(
            `SELECT id, username, name, balance, user_code, role, status,
                    telegram_id, telegram_linked_at
             FROM users WHERE telegram_id = $1 LIMIT 1`,
            [tgId]
        );
        if (r.rows.length > 0) return r.rows[0];

        let base = (ctx.from.username || `tg_${tgId}`).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || `tg_${tgId}`;
        const name = ctx.from.first_name || ctx.from.last_name || 'Telegram User';
        const hash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);

        let candidate = base;
        const exists = await pool.query('SELECT 1 FROM users WHERE username = $1', [candidate]);
        if (exists.rows.length) candidate = `${base}_${crypto.randomBytes(2).toString('hex')}`;

        r = await pool.query(
            `INSERT INTO users (username, name, password_hash, telegram_id, telegram_username)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, username, name, balance, user_code, role, status, telegram_id, telegram_linked_at`,
            [candidate, name, hash, tgId, ctx.from.username || null]
        );
        return r.rows[0];
    }

    // ============================================================
    // RENDER HOME
    // ============================================================
    function renderHome(user) {
        const linkStatus = user.telegram_linked_at ? '✅ Tertaut' : '⚠️ Guest';
        const html =
            `<b>🏠 Dashboard Layanan Nokos</b>\n` +
            `Halo, @${escapeHtml(user.username)}.\n\n` +
            `<b>📊 Ringkasan Akun</b>\n` +
            `<table bordered striped>\n` +
            `  <thead><tr><th>Kolom</th><th>Nilai</th></tr></thead>\n` +
            `  <tr><td>Status</td><td>${user.status === 'active' ? '✅ Aktif' : '❌ Banned'}</td></tr>\n` +
            `  <tr><td>Role</td><td>${escapeHtml(user.role)}</td></tr>\n` +
            `  <tr><td>Saldo</td><td><b>${toRp(user.balance)}</b></td></tr>\n` +
            `  <tr><td>ID Akun</td><td><code>${escapeHtml(user.user_code || user.id)}</code></td></tr>\n` +
            `  <tr><td>Username</td><td>@${escapeHtml(user.username)}</td></tr>\n` +
            `  <tr><td>Status Web</td><td>${linkStatus}</td></tr>\n` +
            `</table>\n\n` +
            `<b>📖 Cara pakai</b>\n` +
            `<ul checklist>\n` +
            `  <li checked>Isi Saldo via QRIS</li>\n` +
            `  <li>Order Nokos → server → app → negara</li>\n` +
            `  <li>OTP masuk ke chat</li>\n` +
            `  <li>Gagal → saldo refund otomatis</li>\n` +
            `</ul>`;

        const buttons = [
            [btnPrimary('🛒 Order Nokos', 'menu_otp')],
            [btnSuccess('💰 Isi Saldo', 'menu_deposit')],
            [btnNormal('📋 Riwayat', 'menu_riwayat'), btnNormal('👤 Akun', 'menu_akun')],
            [btnNormal('❓ Bantuan', 'menu_bantuan')],
            [btnUrl('🌐 Buka Web', 'https://asyrofotp.vercel.app')],
        ];
        return { html, buttons };
    }

    // ============================================================
    // /start
    // ============================================================
    bot.start(async (ctx) => {
        const payload = ctx.startPayload || '';
        if (payload.startsWith('link_')) {
            const tokenPayload = payload.replace(/^link_/, '');
            try {
                const decoded = jwt.verify(tokenPayload, process.env.JWT_SECRET);
                await pool.query(
                    `UPDATE users SET telegram_id = $1, telegram_username = $2,
                            telegram_linked_at = NOW() WHERE id = $3`,
                    [ctx.from.id, ctx.from.username || null, decoded.id]
                );
                return sendRich(ctx,
                    `<b>✅ AKUN DITAUTKAN</b>\n\nBerhasil ke <b>@${escapeHtml(decoded.username)}</b>.`,
                    [[btnPrimary('🏠 Menu Utama', 'back_home')]]
                );
            } catch (e) {
                return sendRich(ctx,
                    `<b>❌ GAGAL</b>\n\nSesi login expired.`,
                    [[btnPrimary('🏠 Menu Utama', 'back_home')]]
                );
            }
        }
        const user = await getOrCreateUser(ctx);
        if (user.status === 'banned') return sendRich(ctx, '<b>❌ DIBLOKIR</b>', []);
        const { html, buttons } = renderHome(user);
        await sendRich(ctx, html, buttons);
    });

    // ============================================================
    // GLOBAL MIDDLEWARE: answer callback
    // ============================================================
    bot.use(async (ctx, next) => {
        if (ctx.callbackQuery) {
            try { await ctx.answerCbQuery(); } catch (_) {}
        }
        return next();
    });

    // ============================================================
    // BACK HOME
    // ============================================================
    bot.action('back_home', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (!user) return;
        const { html, buttons } = renderHome(user);
        try { await editRich(ctx, html, buttons); }
        catch (e) { await editRich(ctx, fmtErr(e), [[btnPrimary('🔙 Kembali', 'back_home')]]); }
    });

    // ============================================================
    // AKUN
    // ============================================================
    bot.action('menu_akun', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (!user) return;
        const linkStatus = user.telegram_linked_at ? '✅ Tertaut' : '⚠️ Guest';
        const html =
            `<b>👤 Informasi Akun</b>\n` +
            `<table bordered striped>\n` +
            `  <thead><tr><th>Kolom</th><th>Nilai</th></tr></thead>\n` +
            `  <tr><td>ID Akun</td><td><code>${escapeHtml(user.user_code || user.id)}</code></td></tr>\n` +
            `  <tr><td>Username</td><td>@${escapeHtml(user.username)}</td></tr>\n` +
            `  <tr><td>Nama</td><td>${escapeHtml(user.name)}</td></tr>\n` +
            `  <tr><td>Saldo</td><td><b>${toRp(user.balance)}</b></td></tr>\n` +
            `  <tr><td>Status Web</td><td>${linkStatus}</td></tr>\n` +
            `</table>`;
        const buttons = [];
        if (!user.telegram_linked_at) buttons.push([btnSuccess('🔗 Tautkan Akun Web', 'link_web')]);
        else buttons.push([btnDanger('🚪 Logout', 'menu_logout')]);
        buttons.push([btnPrimary('🔙 Kembali', 'back_home')]);
        await editRich(ctx, html, buttons);
    });

    bot.action('link_web', async (ctx) => {
        const url = `https://asyrofotp.vercel.app/link-telegram?tg_id=${ctx.from.id}&tg_username=${ctx.from.username || ''}&merge=true`;
        await editRich(ctx,
            `<b>🔗 Tautkan Akun Web</b>\n\nKlik tombol di bawah.`,
            [
                [btnUrl('🌐 Buka Web Tautkan', url)],
                [btnNormal('🔙 Kembali', 'back_home')],
            ]
        );
    });

    bot.action('menu_logout', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (!user) return;
        await pool.query(
            `UPDATE users SET telegram_id = NULL, telegram_username = NULL,
                    telegram_linked_at = NULL WHERE id = $1`,
            [user.id]
        );
        await editRich(ctx,
            `<b>✅ LOGOUT BERHASIL</b>`,
            [[btnPrimary('🏠 Menu Utama', 'back_home')]]
        );
    });

    // ============================================================
    // MENU OTP: pilih server
    // ============================================================
    bot.action('menu_otp', async (ctx) => {
        const html =
            `<b>🛒 Beli Nokos</b>\n` +
            `<table bordered striped>\n` +
            `  <thead><tr><th>Server</th><th>Keterangan</th></tr></thead>\n` +
            `  <tr><td>1</td><td>Ekonomi (Murah, ID only)</td></tr>\n` +
            `  <tr><td>2</td><td>Premium (Semua negara)</td></tr>\n` +
            `</table>`;

        await editRich(ctx, html, [
            [btnPrimary('🇮🇩 Server 1 (Ekonomi)', `srv${SEP}ekonomi${SEP}1`)],
            [btnPrimary('🌍 Server 2 (Premium)', `srv${SEP}premium${SEP}1`)],
            [btnNormal('🔙 Kembali', 'back_home')],
        ]);
    });

    // ============================================================
    // STEP 1: LIST SERVICE
    // Ekonomi: langsung ke harga (country=id), skip pilih negara
    // Premium: lanjut ke pilih negara
    // ============================================================
    bot.action(new RegExp('^srv' + SEP + '(ekonomi|premium)' + SEP + '(\\d+)$'), async (ctx) => {
        const server = ctx.match[1];
        const page = parseInt(ctx.match[2], 10) || 1;

        try {
            let services = [];
            if (server === 'ekonomi') {
                try {
                    const data = await dibananaFetch('/services?server=ekonomi');
                    services = pickArray(data, 'services', 'items', 'list').map(s => ({
                        code: pickCode(s) || String(s.code || '').toLowerCase(),
                        name: pickName(s),
                    })).filter(s => s.code);
                } catch (e) {
                    dbg('services:fail-try-php', e.message);
                    const data = await dibananaFetch('/services.php?server=ekonomi');
                    services = pickArray(data, 'services', 'items', 'list').map(s => ({
                        code: pickCode(s) || String(s.code || '').toLowerCase(),
                        name: pickName(s),
                    })).filter(s => s.code);
                }
            } else {
                const raw = await premiumFetch('/catalog/services');
                services = pickArray(raw, 'services', 'items', 'list').map(s => ({
                    code: pickCode(s) || String(s.code || '').toLowerCase(),
                    name: pickName(s),
                })).filter(s => s.code);
            }

            dbg(`services:${server}`, { count: services.length, sample: services.slice(0, 3) });

            if (!services.length) {
                return editRich(ctx,
                    `<b>❌ Tidak ada layanan</b>`,
                    [[btnPrimary('🔙 Kembali', 'menu_otp')]]
                );
            }

            const perPage = 8;
            const totalPages = Math.max(1, Math.ceil(services.length / perPage));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * perPage;
            const current = services.slice(start, start + perPage);

            const html =
                `<b>📱 Pilih Layanan</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Server</th><th>Halaman</th><th>Total</th></tr></thead>\n` +
                `  <tr><td>${server === 'ekonomi' ? '1 (Ekonomi)' : '2 (Premium)'}</td><td>${safePage}/${totalPages}</td><td>${services.length}</td></tr>\n` +
                `</table>`;

            const buttons = [];
            for (let i = 0; i < current.length; i += 2) {
                // ✅ Ekonomi: langsung ke cty (skip country picker), country = 'id'
                // Premium: ke svc (pilih negara)
                const mkCb = (svcCode) => server === 'ekonomi'
                    ? `cty${SEP}${server}${SEP}${svcCode}${SEP}id${SEP}${safePage}`
                    : `svc${SEP}${server}${SEP}${svcCode}${SEP}${safePage}`;

                const row = [btnNormal(current[i].name, mkCb(current[i].code))];
                if (current[i + 1]) row.push(btnNormal(current[i + 1].name, mkCb(current[i + 1].code)));
                buttons.push(row);
            }
            const nav = [];
            if (safePage > 1) nav.push(btnPrimary('⬅️ Prev', `srv${SEP}${server}${SEP}${safePage - 1}`));
            if (safePage < totalPages) nav.push(btnPrimary('Next ➡️', `srv${SEP}${server}${SEP}${safePage + 1}`));
            if (nav.length) buttons.push(nav);
            buttons.push([btnNormal('🔙 Kembali', 'menu_otp')]);

            await editRich(ctx, html, buttons);
        } catch (e) {
            await editRich(ctx, fmtErr(e), [[btnPrimary('🔙 Kembali', 'menu_otp')]]);
        }
    });

    // ============================================================
    // STEP 2: LIST COUNTRY (premium only)
    // Kalau ekonomi masuk sini, redirect ke harga country=id
    // ============================================================
    bot.action(new RegExp('^svc' + SEP + '(ekonomi|premium)' + SEP + '([^' + SEP + ']+)' + SEP + '(\\d+)$'), async (ctx) => {
        const server = ctx.match[1];
        const code = ctx.match[2];
        const page = parseInt(ctx.match[3], 10) || 1;

        // ✅ Ekonomi gak pakai negara, redirect ke cty country=id
        if (server === 'ekonomi') {
            return editRich(ctx,
                `<b>ℹ️ Server 1 (Ekonomi) cuma support Indonesia</b>\n\n` +
                `<i>Lanjut ke harga...</i>`,
                [[btnPrimary('🛒 Lihat Harga', `cty${SEP}ekonomi${SEP}${code}${SEP}id${SEP}1`)]]
            );
        }

        try {
            let countries = [];
            const raw = await premiumFetch('/catalog/countries');
            const arr = pickArray(raw, 'countries', 'items', 'list');
            countries = arr.map(c => ({
                code: String(c.code || c.iso || '').toLowerCase(),
                name: String(c.name || c.code || '').toUpperCase(),
            })).filter(c => c.code);

            dbg(`countries:premium:${code}`, { count: countries.length });

            if (!countries.length) {
                return editRich(ctx,
                    `<b>❌ Tidak ada negara</b>`,
                    [[btnPrimary('🔙 Kembali', `srv${SEP}${server}${SEP}1`)]]
                );
            }

            const perPage = 8;
            const totalPages = Math.max(1, Math.ceil(countries.length / perPage));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * perPage;
            const current = countries.slice(start, start + perPage);

            const html =
                `<b>🌍 Pilih Negara</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Service</th><th>Halaman</th><th>Total</th></tr></thead>\n` +
                `  <tr><td>${escapeHtml(code)}</td><td>${safePage}/${totalPages}</td><td>${countries.length}</td></tr>\n` +
                `</table>`;

            const buttons = [];
            for (let i = 0; i < current.length; i += 2) {
                const row = [btnNormal(current[i].name, `cty${SEP}${server}${SEP}${code}${SEP}${current[i].code}${SEP}${safePage}`)];
                if (current[i + 1]) row.push(btnNormal(current[i + 1].name, `cty${SEP}${server}${SEP}${code}${SEP}${current[i + 1].code}${SEP}${safePage}`));
                buttons.push(row);
            }
            const nav = [];
            if (safePage > 1) nav.push(btnPrimary('⬅️ Prev', `svc${SEP}${server}${SEP}${code}${SEP}${safePage - 1}`));
            if (safePage < totalPages) nav.push(btnPrimary('Next ➡️', `svc${SEP}${server}${SEP}${code}${SEP}${safePage + 1}`));
            if (nav.length) buttons.push(nav);
            buttons.push([btnNormal('🔙 Kembali', `srv${SEP}${server}${SEP}1`)]);

            await editRich(ctx, html, buttons);
        } catch (e) {
            await editRich(ctx, fmtErr(e), [[btnPrimary('🔙 Kembali', `srv${SEP}${server}${SEP}1`)]]);
        }
    });

    // ============================================================
    // STEP 3: LIST HARGA
    // ============================================================
    bot.action(new RegExp('^cty' + SEP + '(ekonomi|premium)' + SEP + '([^' + SEP + ']+)' + SEP + '([a-z0-9]+)' + SEP + '(\\d+)$'), async (ctx) => {
        const server = ctx.match[1];
        const code = ctx.match[2];
        const country = ctx.match[3];
        const page = parseInt(ctx.match[4], 10) || 1;

        try {
            let providers = [];

            if (server === 'ekonomi') {
                let data;
                try {
                    data = await dibananaFetch(`/prices?server=ekonomi&service=${encodeURIComponent(code)}&country=${encodeURIComponent(country)}`);
                } catch (e) {
                    dbg('prices:ekonomi:no-country', e.message);
                    data = await dibananaFetch(`/prices?server=ekonomi&service=${encodeURIComponent(code)}`);
                }
                dbg('prices:ekonomi:raw', { keys: Object.keys(data || {}), sample: JSON.stringify(data).slice(0, 800) });

                const arr = pickArray(data, 'providers', 'prices', 'items', 'list', 'products');
                providers = arr.map(p => ({
                    id: pickId(p),
                    raw_price: pickPrice(p),
                    price: applyMarkup(pickPrice(p)),
                    stock: pickStock(p),
                    name: pickName(p),
                })).filter(p => p.id && p.price > 0);
            } else {
                const [cr, sr] = await Promise.all([
                    premiumFetch('/catalog/countries'),
                    premiumFetch('/catalog/services'),
                ]);
                const cArr = pickArray(cr, 'countries');
                const sArr = pickArray(sr, 'services');
                const cObj = cArr.find(c => String(c.code).toLowerCase() === country.toLowerCase());
                const sObj = sArr.find(s => String(s.code).toLowerCase() === code.toLowerCase());

                dbg('premium:cty', { cFound: !!cObj, sFound: !!sObj });

                if (cObj && sObj) {
                    const params = new URLSearchParams({
                        country_id: String(cObj.id),
                        platform_id: String(sObj.id),
                        limit: '100',
                        page: '1',
                    });
                    const products = await premiumFetch(`/catalog/products?${params}`);
                    dbg('premium:products:raw', { keys: Object.keys(products || {}), sample: JSON.stringify(products).slice(0, 800) });

                    const pArr = pickArray(products, 'products', 'items', 'list', 'prices', 'providers');
                    providers = pArr
                        .filter(p => p.active !== false)
                        .map(p => {
                            const raw = pickPrice(p) || premiumMoneyToIdr(p.price);
                            return {
                                id: pickId(p),
                                raw_price: raw,
                                price: applyMarkup(raw),
                                stock: pickStock(p),
                                name: pickName(p),
                            };
                        })
                        .filter(p => p.id && p.price > 0);
                }
            }

            dbg(`providers:${server}:${code}:${country}`, { count: providers.length, sample: providers.slice(0, 3) });

            if (!providers.length) {
                return editRich(ctx,
                    `<b>❌ Harga tidak tersedia</b>\n\n` +
                    `<table bordered striped>\n` +
                    `  <thead><tr><th>Service</th><th>Negara</th><th>Status</th></tr></thead>\n` +
                    `  <tr><td>${escapeHtml(code)}</td><td>${escapeHtml(country.toUpperCase())}</td><td>Kosong</td></tr>\n` +
                    `</table>\n\n` +
                    `<i>Cek log Vercel untuk raw response provider.</i>`,
                    [[btnPrimary('🔙 Kembali', `srv${SEP}${server}${SEP}1`)]]
                );
            }

            const perPage = 8;
            const totalPages = Math.max(1, Math.ceil(providers.length / perPage));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * perPage;
            const current = providers.slice(start, start + perPage);

            const totalStock = providers.reduce((a, b) => a + b.stock, 0);
            const html =
                `<b>💰 Pilih Harga</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Service</th><th>Negara</th><th>Halaman</th><th>Total Stok</th></tr></thead>\n` +
                `  <tr><td>${escapeHtml(code)}</td><td>${escapeHtml(country.toUpperCase())}</td><td>${safePage}/${totalPages}</td><td>${totalStock}</td></tr>\n` +
                `</table>`;

            const buttons = current.map(p => [
                btnSuccess(`${toRp(p.price)} | Stok: ${p.stock}`, `buy${SEP}${server}${SEP}${code}${SEP}${country}${SEP}${p.id}`),
            ]);
            const nav = [];
            if (safePage > 1) nav.push(btnPrimary('⬅️ Prev', `cty${SEP}${server}${SEP}${code}${SEP}${country}${SEP}${safePage - 1}`));
            if (safePage < totalPages) nav.push(btnPrimary('Next ➡️', `cty${SEP}${server}${SEP}${code}${SEP}${country}${SEP}${safePage + 1}`));
            if (nav.length) buttons.push(nav);

            // ✅ Kembali: ekonomi ke srv, premium ke svc
            const backCb = server === 'ekonomi'
                ? `srv${SEP}${server}${SEP}1`
                : `svc${SEP}${server}${SEP}${code}${SEP}1`;
            buttons.push([btnNormal('🔙 Kembali', backCb)]);

            await editRich(ctx, html, buttons);
        } catch (e) {
            const backCb = server === 'ekonomi'
                ? `srv${SEP}${server}${SEP}1`
                : `svc${SEP}${server}${SEP}${code}${SEP}1`;
            await editRich(ctx, fmtErr(e), [[btnPrimary('🔙 Kembali', backCb)]]);
        }
    });

    // ============================================================
    // STEP 4: BELI
    // ============================================================
    bot.action(new RegExp('^buy' + SEP + '(ekonomi|premium)' + SEP + '([^' + SEP + ']+)' + SEP + '([a-z0-9]+)' + SEP + '(.+)$'), async (ctx) => {
        const server = ctx.match[1];
        const code = ctx.match[2];
        const country = ctx.match[3];
        const providerId = ctx.match[4];
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        let phone = null, price = 0, orderId = null;
        try {
            if (server === 'ekonomi') {
                const data = await dibananaFetch('/order', {
                    method: 'POST',
                    body: JSON.stringify({ id: providerId }),
                });
                dbg('order:ekonomi:raw', data);
                if (!data) throw new Error('Response kosong');
                orderId = String(data.order_id || data.id || '');
                phone = data.phone_number || data.phone || data.number;
                const rawPrice = Number(data.price_idr || data.price || 0);
                price = applyMarkup(rawPrice);
                if (!orderId) {
                    const err = new Error('order_id gak ada di response');
                    err.raw = data;
                    throw err;
                }
            } else {
                const data = await premiumFetch('/orders/create', {
                    method: 'POST',
                    headers: { 'Idempotency-Key': 'bot_' + crypto.randomBytes(16).toString('hex') },
                    body: JSON.stringify({ product_id: Number(providerId), quantity: 1 }),
                });
                dbg('order:premium:raw', data);
                const first = data?.orders?.[0] || data;
                orderId = String(first?.id || '');
                phone = first?.phone_number;
                const rawPrice = premiumMoneyToIdr(first?.amount || first?.price || 0);
                price = applyMarkup(rawPrice);
                if (!orderId) throw new Error('order id gak ada di response');
            }

            if (price <= 0) throw new Error(`Provider kasih harga invalid: ${price}`);

            const uRes = await pool.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [user.id]);
            const balance = Number(uRes.rows[0].balance);
            if (balance < price) {
                try {
                    if (server === 'ekonomi') {
                        await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: Number(orderId) }) });
                    } else {
                        await premiumFetch('/orders/cancel', { method: 'POST', body: JSON.stringify({ id: Number(orderId) }) });
                    }
                } catch (_) {}
                const err = new Error(`Saldo kurang. Butuh ${toRp(price)}, saldo kamu ${toRp(balance)}`);
                err.code = 'INSUFFICIENT_BALANCE';
                throw err;
            }

            const expAt = new Date(Date.now() + 15 * 60 * 1000);
            const otpId = `OTP${Date.now().toString().slice(-8)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(
                    `INSERT INTO orders
                     (user_id, order_id, otp_id, server, service, country, phone_number, price, status, expires_in, expired_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', 900, $9)`,
                    [user.id, orderId, otpId, server, code, country, phone, price, expAt]
                );
                await client.query('UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2', [price, user.id]);
                await client.query(
                    `INSERT INTO transactions (user_id, order_id, service_name, country, phone_number, status, price)
                     VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
                    [user.id, orderId, code, country, phone, price]
                );
                await client.query('COMMIT');
            } catch (dbErr) {
                await client.query('ROLLBACK').catch(() => {});
                try {
                    if (server === 'ekonomi') {
                        await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: Number(orderId) }) });
                    } else {
                        await premiumFetch('/orders/cancel', { method: 'POST', body: JSON.stringify({ id: Number(orderId) }) });
                    }
                } catch (_) {}
                throw new Error('DB error: ' + dbErr.message);
            } finally {
                client.release();
            }

            const html =
                `<b>✅ ORDER BERHASIL</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Kolom</th><th>Nilai</th></tr></thead>\n` +
                `  <tr><td>OTP ID</td><td><code>${escapeHtml(otpId)}</code></td></tr>\n` +
                `  <tr><td>Nomor</td><td><code>${escapeHtml(phone)}</code></td></tr>\n` +
                `  <tr><td>Harga</td><td><b>${toRp(price)}</b></td></tr>\n` +
                `  <tr><td>Status</td><td>⏳ Menunggu OTP</td></tr>\n` +
                `  <tr><td>Expired</td><td>${expAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td></tr>\n` +
                `</table>\n\n` +
                `<ul checklist>\n` +
                `  <li checked>Order dibuat</li>\n` +
                `  <li checked>Saldo terpotong</li>\n` +
                `  <li>Tunggu OTP masuk</li>\n` +
                `  <li>Klik "Cek OTP" untuk refresh</li>\n` +
                `</ul>`;

            await editRich(ctx, html, [
                [btnPrimary('🔄 Cek OTP', `chk${SEP}${otpId}`)],
                [btnNormal('🔙 Menu Utama', 'back_home')],
            ]);
        } catch (e) {
            await editRich(ctx, fmtErr(e), [[btnPrimary('🔙 Menu Utama', 'back_home')]]);
        }
    });

    // ============================================================
    // CEK OTP
    // ============================================================
    bot.action(new RegExp('^chk' + SEP + '(.+)$'), async (ctx) => {
        const otpId = ctx.match[1];
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        try {
            const r = await pool.query(
                'SELECT * FROM orders WHERE otp_id = $1 AND user_id = $2 LIMIT 1',
                [otpId, user.id]
            );
            if (!r.rows.length) throw new Error('Order tidak ditemukan.');
            const o = r.rows[0];

            let otp = o.otp_code, status = o.status;
            if (status === 'pending' && !otp) {
                try {
                    const data = await providerOrderStatus(o);
                    if (data.otp_code) {
                        otp = data.otp_code;
                        status = data.status || 'received';
                        await pool.query(
                            `UPDATE orders SET status = $1, otp_code = $2, otp_code_2 = $3, full_sms = $4,
                                    received_at = NOW(), updated_at = NOW() WHERE id = $5`,
                            [status, data.otp_code, data.otp_code_2, data.full_sms, o.id]
                        );
                    }
                } catch (_) {}
            }

            const html =
                `<b>📨 Status Order</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Kolom</th><th>Nilai</th></tr></thead>\n` +
                `  <tr><td>OTP ID</td><td><code>${escapeHtml(otpId)}</code></td></tr>\n` +
                `  <tr><td>Nomor</td><td><code>${escapeHtml(o.phone_number || '-')}</code></td></tr>\n` +
                `  <tr><td>Service</td><td>${escapeHtml(o.service || '-')}</td></tr>\n` +
                `  <tr><td>Status</td><td>${otp ? '✅ OTP Diterima' : (status === 'pending' ? '⏳ Menunggu' : escapeHtml(status))}</td></tr>\n` +
                `  <tr><td>OTP</td><td>${otp ? `<b><code>${escapeHtml(otp)}</code></b>` : '-'}</td></tr>\n` +
                `  <tr><td>Harga</td><td>${toRp(o.price)}</td></tr>\n` +
                `</table>`;

            await editRich(ctx, html, [
                [btnPrimary('🔄 Refresh', `chk${SEP}${otpId}`)],
                [btnNormal('🔙 Menu Utama', 'back_home')],
            ]);
        } catch (e) {
            await editRich(ctx, fmtErr(e), [[btnPrimary('🔙 Menu Utama', 'back_home')]]);
        }
    });

    // ============================================================
    // DEPOSIT
    // ============================================================
    bot.action('menu_deposit', async (ctx) => {
        const html =
            `<b>💰 Top Up Saldo</b>\n` +
            `<ul checklist>\n` +
            `  <li>Pilih nominal</li>\n` +
            `  <li>Scan QRIS</li>\n` +
            `  <li>Saldo masuk otomatis</li>\n` +
            `</ul>`;
        await editRich(ctx, html, [
            [btnSuccess('Rp 5.000', `dep${SEP}5000`), btnSuccess('Rp 10.000', `dep${SEP}10000`)],
            [btnSuccess('Rp 20.000', `dep${SEP}20000`), btnSuccess('Rp 50.000', `dep${SEP}50000`)],
            [btnNormal('🔙 Kembali', 'back_home')],
        ]);
    });

    bot.action(new RegExp('^dep' + SEP + '(\\d+)$'), async (ctx) => {
        const amount = parseInt(ctx.match[1], 10);
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        try {
            const referenceId = `BOT${Date.now()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

            // Coba dua endpoint: /generate (qrispy asli) dan /create (worker lama)
            let data, q;
            const endpoints = [
                { path: '/api/payment/qris/generate', body: { amount, payment_reference: referenceId } },
                { path: '/api/payment/qris/create', body: { amount } },
            ];
            let lastErr;
            for (const ep of endpoints) {
                try {
                    data = await qrispyFetch(ep.path, { method: 'POST', body: JSON.stringify(ep.body) });
                    q = data.data || data;
                    if (q && (q.qris_image_url || q.qr_image || q.qris_image_base64)) break;
                    lastErr = new Error(`Response ${ep.path} gak ada qr image`);
                    lastErr.raw = data;
                } catch (e) {
                    lastErr = e;
                    dbg('dep:try-fail', { path: ep.path, err: e.message });
                }
            }
            if (!q || (!q.qris_image_url && !q.qr_image && !q.qris_image_base64)) {
                throw lastErr || new Error('Gagal bikin QRIS');
            }

            const qrisId = String(q.qris_id || q.id || q.qr_id || referenceId);
            const qrisUrl = q.qris_image_url || q.qr_image;
            const expiresAt = q.expired_at
                ? new Date(q.expired_at)
                : new Date(Date.now() + 15 * 60 * 1000);

            const ourFee = calculateDepositFee(amount);
            await pool.query(
                `INSERT INTO deposits
                 (user_id, reference_id, method, amount, total_amount, fee, status, qris_id, qris_url, payment_reference, expires_at)
                 VALUES ($1, $2, 'qrispy', $3, $4, $5, 'pending', $6, $7, $8, $9)`,
                [user.id, referenceId, amount, amount + ourFee, ourFee, qrisId, qrisUrl, referenceId, expiresAt]
            );

            await editRich(ctx,
                `<b>💳 TOP UP QRIS</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Kolom</th><th>Nilai</th></tr></thead>\n` +
                `  <tr><td>Ref ID</td><td><code>${escapeHtml(referenceId)}</code></td></tr>\n` +
                `  <tr><td>Nominal</td><td><b>${toRp(q.amount || amount)}</b></td></tr>\n` +
                `  <tr><td>Expired</td><td>${expiresAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td></tr>\n` +
                `</table>\n\nQR dikirim sebagai foto di bawah.`,
                [
                    [btnPrimary('🔄 Cek Status', `dchk${SEP}${referenceId}`)],
                    [btnNormal('🔙 Menu Utama', 'back_home')],
                ]
            );

            const photo = q.qris_image_base64 || (qrisUrl ? { url: qrisUrl } : null);
            if (photo) {
                await ctx.replyWithPhoto(photo, {
                    caption: `QRIS 15 menit. Ref: ${escapeHtml(referenceId)}`,
                    parse_mode: 'HTML',
                });
            }
        } catch (e) {
            await editRich(ctx, fmtErr(e), [[btnPrimary('🔙 Menu Utama', 'back_home')]]);
        }
    });

    bot.action(new RegExp('^dchk' + SEP + '(.+)$'), async (ctx) => {
        const ref = ctx.match[1];
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        try {
            const r = await pool.query(
                'SELECT * FROM deposits WHERE reference_id = $1 AND user_id = $2 LIMIT 1',
                [ref, user.id]
            );
            if (!r.rows.length) throw new Error('Deposit tidak ditemukan.');
            const d = r.rows[0];

            let status = d.status;
            if (status === 'pending') {
                try {
                    const s = await qrispyFetch(`/api/payment/qris/${d.qris_id}/status`);
                    const inner = s.data || s;
                    if (inner.status === 'paid') {
                        await markDepositPaid(d, inner.amount || d.amount, inner.paid_at || inner.paid_time);
                        status = 'success';
                    } else if (inner.status === 'expired') {
                        await pool.query(`UPDATE deposits SET status = 'expired', updated_at = NOW() WHERE id = $1`, [d.id]);
                        status = 'expired';
                    }
                } catch (_) {}
            }

            const html =
                `<b>💳 Status Deposit</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Kolom</th><th>Nilai</th></tr></thead>\n` +
                `  <tr><td>Ref ID</td><td><code>${escapeHtml(ref)}</code></td></tr>\n` +
                `  <tr><td>Nominal</td><td>${toRp(d.amount)}</td></tr>\n` +
                `  <tr><td>Fee</td><td>${toRp(d.fee)}</td></tr>\n` +
                `  <tr><td>Status</td><td>${status === 'success' ? '✅ Sukses' : status === 'pending' ? '⏳ Pending' : escapeHtml(status)}</td></tr>\n` +
                `</table>`;

            await editRich(ctx, html, [
                [btnPrimary('🔄 Refresh', `dchk${SEP}${ref}`)],
                [btnNormal('🔙 Menu Utama', 'back_home')],
            ]);
        } catch (e) {
            await editRich(ctx, fmtErr(e), [[btnPrimary('🔙 Menu Utama', 'back_home')]]);
        }
    });

    // ============================================================
    // RIWAYAT
    // ============================================================
    bot.action('menu_riwayat', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        const r = await pool.query(
            `SELECT otp_id, service, phone_number, otp_code, status, price, created_at
             FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`,
            [user.id]
        );
        if (!r.rows.length)
            return editRich(ctx, '<b>📭 KOSONG</b>\n\nBelum ada riwayat order.', [[btnPrimary('🔙 Kembali', 'back_home')]]);

        let html =
            `<b>📋 Riwayat 5 Terakhir</b>\n` +
            `<table bordered striped>\n` +
            `  <thead><tr><th>Service</th><th>Nomor</th><th>OTP</th><th>Harga</th></tr></thead>\n`;
        r.rows.forEach(o => {
            html += `  <tr><td>${escapeHtml(o.service || '-')}</td><td><code>${escapeHtml(o.phone_number || '-')}</code></td><td>${o.otp_code ? `<code>${escapeHtml(o.otp_code)}</code>` : '⏳'}</td><td>${toRp(o.price)}</td></tr>\n`;
        });
        html += `</table>`;

        await editRich(ctx, html, [[btnPrimary('🔙 Kembali', 'back_home')]]);
    });

    // ============================================================
    // BANTUAN
    // ============================================================
    bot.action('menu_bantuan', async (ctx) => {
        await editRich(ctx,
            `<b>❓ BANTUAN</b>\n\nKendala? Hubungi admin:\n<b>@asyrofc</b>`,
            [[btnPrimary('🔙 Kembali', 'back_home')]]
        );
    });

    // ============================================================
    // DEBUG ACTION
    // ============================================================
    bot.action('menu_debug', async (ctx) => {
        const lines = [];
        lines.push(`<b>🔧 DEBUG INFO</b>`);
        lines.push(`DIBANANA_BASE: ${DIBANANA_BASE ? '✅ ' + DIBANANA_BASE : '❌'}`);
        lines.push(`API_SERVER_EKONOMI: ${DIBANANA_API_KEY ? '✅' : '❌'}`);
        lines.push(`PREMIUM_BASE: ${PREMIUM_BASE ? '✅ ' + PREMIUM_BASE : '❌'}`);
        lines.push(`API_SERVER_PREMIUM: ${PREMIUM_API_KEY ? '✅' : '❌'}`);
        lines.push(`QRISPY_BASE: ✅ ${QRISPY_BASE}`);
        lines.push(`QRISPY_API_TOKEN: ${QRISPY_API_TOKEN ? '✅' : '❌'}`);
        lines.push(`QRISPY_AUTH_MODE: ${QRISPY_AUTH_MODE}`);
        lines.push(`TELEGRAM_BOT_TOKEN: ${TOKEN ? '✅' : '❌'}`);
        await editRich(ctx, lines.join('\n'), [[btnNormal('🔙 Kembali', 'back_home')]]);
    });

    // ============================================================
    // WEBHOOK
    // ============================================================
    app.post('/api/botwebhook', async (req, res) => {
        try {
            await bot.handleUpdate(req.body);
            res.status(200).send('OK');
        } catch (err) {
            console.error('Bot webhook error:', err.message);
            res.status(200).send('OK');
        }
    });

    app.get('/api/botwebhook/set', async (req, res) => {
        if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
        const baseUrl = process.env.BASE_URL || 'https://asyrofotp.vercel.app';
        const url = `${baseUrl}/api/botwebhook`;
        const r = await fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });
        res.json({ telegram: await r.json(), webhook_url: url });
    });

    // ============================================================
    // DEBUG ENDPOINTS
    // ============================================================
    app.get('/api/botwebhook/test', async (req, res) => {
        if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
        const target = req.query.target || 'dibanana';
        const endpoint = req.query.endpoint || '/balance';
        try {
            let data;
            if (target === 'dibanana') data = await dibananaFetch(endpoint);
            else if (target === 'premium') data = await premiumFetch(endpoint);
            else if (target === 'qrispy') data = await qrispyFetch(endpoint);
            else return res.status(400).json({ error: 'target: dibanana|premium|qrispy' });
            res.json({ ok: true, target, endpoint, data });
        } catch (e) {
            res.status(500).json({
                ok: false, target, endpoint,
                message: e.message, status: e.status, code: e.code,
                raw: e.raw, data: e.data,
            });
        }
    });

    app.get('/api/botwebhook/test-qrispy', async (req, res) => {
        if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

        const endpoint = req.query.endpoint || '/api/payment/balance';
        const variants = [
            { name: 'X-API-Token', headers: { 'X-API-Token': QRISPY_API_TOKEN } },
            { name: 'Authorization Bearer', headers: { 'Authorization': `Bearer ${QRISPY_API_TOKEN}` } },
            { name: 'X-Qrispy-Token', headers: { 'X-Qrispy-Token': QRISPY_API_TOKEN } },
            { name: 'No Auth', headers: {} },
        ];

        const results = [];
        for (const v of variants) {
            try {
                const r = await fetch(`${QRISPY_BASE}${endpoint}`, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'User-Agent': 'AsyrofOTP-Bot/1.0',
                        ...v.headers,
                    },
                });
                const text = await r.text();
                results.push({ variant: v.name, status: r.status, body: text.slice(0, 500) });
            } catch (e) {
                results.push({ variant: v.name, status: 0, error: e.message });
            }
        }
        res.json({
            base: QRISPY_BASE,
            endpoint,
            token_present: !!QRISPY_API_TOKEN,
            token_prefix: QRISPY_API_TOKEN ? QRISPY_API_TOKEN.slice(0, 10) + '...' : null,
            results,
        });
    });

    return bot;
};
