const { Telegraf } = require('telegraf');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

module.exports = function setupBotWebhook(app, deps) {
    // Minimal deps yang WAJIB dari index.js
    const { pool } = deps;

    // ============================================================
    // CLONE SEMUA FUNC DARI INDEX.JS (biar gak depend _deps)
    // ============================================================
    const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const FIRE = '5104841245755180586';
    const SEP = '§';

    const DIBANANA_BASE = process.env.DIBANANA_BASE;
    const DIBANANA_API_KEY = process.env.API_SERVER_EKONOMI;
    const PREMIUM_BASE = process.env.PREMIUM_BASE;
    const PREMIUM_API_KEY = process.env.API_SERVER_PREMIUM;
    const SMScode_PUBLIC_KEY = process.env.SMScode_PUBLIC_KEY;
    const QRISPY_BASE = 'https://cloudflareworkerdeploydidashcloudflarecomexportdef.rahayucahyapurwa.workers.dev';
    const PROVIDER_TIMEOUT_MS = 8000;

    // ---- dibananaFetch (clone) ----
    async function dibananaFetch(endpoint, options = {}) {
        if (!DIBANANA_API_KEY) throw new Error('API_SERVER_EKONOMI belum di-set');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
        try {
            const res = await fetch(`${DIBANANA_BASE}${endpoint}`, {
                ...options,
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${DIBANANA_API_KEY}`,
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

    // ---- premiumFetch (clone) ----
    async function premiumFetch(endpoint, options = {}) {
        if (!PREMIUM_API_KEY) throw new Error('API_SERVER_PREMIUM belum di-set');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
        try {
            const res = await fetch(`${PREMIUM_BASE}${endpoint}`, {
                ...options,
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${PREMIUM_API_KEY}`,
                    'Content-Type': 'application/json',
                    ...(options.headers || {}),
                },
            });
            let data;
            try { data = await res.json(); }
            catch (e) { const err = new Error(`Provider error: ${res.status}`); err.status = res.status; throw err; }
            if (!res.ok || data.success === false) {
                const err = new Error(data.error?.message || data.message || 'Provider error');
                err.status = res.status; err.code = data.error?.code || data.code; err.data = data; throw err;
            }
            return data.data;
        } finally { clearTimeout(timeout); }
    }

    // ---- premiumMoneyToIdr (clone) ----
    function premiumMoneyToIdr(money) {
        if (money == null) return 0;
        return Math.round(Number(money) || 0);
    }

    // ---- applyMarkup (clone, sama persis) ----
    const MARKUP_PERCENT = 0.10;
    function applyMarkup(providerPrice) {
        const p = Number(providerPrice) || 0;
        if (p <= 0) return 0;
        return Math.round(p * (1 + MARKUP_PERCENT));
    }

    // ---- calculateDepositFee (clone) ----
    const DEPOSIT_FEE_MIN = 50;
    const DEPOSIT_FEE_MAX = 100;
    const DEPOSIT_FEE_PERCENT = 0.005;
    function calculateDepositFee(amount) {
        const a = Number(amount) || 0;
        if (a <= 0) return DEPOSIT_FEE_MIN;
        const fee = Math.round(a * DEPOSIT_FEE_PERCENT);
        return Math.max(DEPOSIT_FEE_MIN, Math.min(DEPOSIT_FEE_MAX, fee));
    }

    // ---- qrispyFetch (clone) ----
    async function qrispyFetch(endpoint, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
        try {
            const res = await fetch(`${QRISPY_BASE}${endpoint}`, {
                ...options,
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            });
            const text = await res.text();
            let data;
            try { data = JSON.parse(text); }
            catch (e) { const err = new Error(`depo1 error ${res.status}: response bukan JSON`); err.status = res.status; throw err; }
            if (!res.ok || data.status === 'error') {
                const err = new Error(data.message || 'depo1 error');
                err.status = res.status; err.data = data; throw err;
            }
            return data;
        } finally { clearTimeout(timeout); }
    }

    // ---- providerOrderStatus (clone) ----
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

    // ---- providerCancelOrder (clone) ----
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

    // ---- markDepositPaid (clone versi ringkas) ----
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

    const toRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // === RAW API ===
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

    // Kirim pesan rich BARU (hanya untuk /start dan kirim pertama kali)
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
            console.error('sendRichMessage failed:', e.message);
            // Fallback ke sendMessage biasa
            const fb = {
                chat_id: ctx.chat.id,
                text: html.replace(/<[^>]+>/g, '').trim() || html,
                parse_mode: 'HTML',
            };
            if (buttons.length) fb.reply_markup = { inline_keyboard: buttons };
            return await apiCall('sendMessage', fb);
        }
    }

    // ✅ EDIT MURNI — no delete, no resend. Kalau gagal, biarkan.
    async function editRich(ctx, html, buttons = []) {
        const msgId = ctx.callbackQuery?.message?.message_id;
        if (!msgId) {
            // gak ada message → ini bukan callback (misal dari /start), kirim baru
            return sendRich(ctx, html, buttons);
        }
        const payload = {
            chat_id: ctx.chat.id,
            message_id: msgId,
            rich_message: { html },
        };
        if (buttons.length) payload.reply_markup = { inline_keyboard: buttons };
        try {
            return await apiCall('editMessageText', {
                chat_id: ctx.chat.id,
                message_id: msgId,
                rich_message: { html },
                ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
            });
        } catch (e) {
            // Coba fallback editMessageText biasa (text/html)
            try {
                return await apiCall('editMessageText', {
                    chat_id: ctx.chat.id,
                    message_id: msgId,
                    text: html.replace(/<[^>]+>/g, '').trim() || html,
                    parse_mode: 'HTML',
                    ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
                });
            } catch (e2) {
                console.error('editRich failed:', e2.message);
                // JANGAN delete, JANGAN resend. Cukup throw biar keliatan errornya di log.
                throw e2;
            }
        }
    }

    // ==================== BUTTONS ====================
    const btnPrimary = (t, d) => ({ text: t, callback_data: d, style: 'primary' });
    const btnSuccess = (t, d) => ({ text: t, callback_data: d, style: 'success' });
    const btnDanger  = (t, d) => ({ text: t, callback_data: d, style: 'danger' });
    const btnNormal  = (t, d) => ({ text: t, callback_data: d });
    const btnUrl     = (t, u) => ({ text: t, url: u });

    // ==================== USER ====================
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

    // ==================== RENDER HOME ====================
    function renderHome(user) {
        const linkStatus = user.telegram_linked_at ? '✅ Tertaut' : '⚠️ Guest';
        const html =
            `<b>🏠 Dashboard Layanan Nokos</b>\n` +
            `Halo, @${esc(user.username)}.\n` +
            `Kelola layanan Anda dengan cepat, aman, dan otomatis.\n\n` +
            `<b>📊 Ringkasan Akun</b>\n` +
            `<table bordered striped>\n` +
            `  <thead><tr><th>Kolom</th><th>Nilai</th></tr></thead>\n` +
            `  <tr><td>Status</td><td>${user.status === 'active' ? '✅ Aktif' : '❌ Banned'}</td></tr>\n` +
            `  <tr><td>Role</td><td>${esc(user.role)}</td></tr>\n` +
            `  <tr><td>Saldo</td><td><b>${toRp(user.balance)}</b></td></tr>\n` +
            `  <tr><td>ID Akun</td><td><code>${esc(user.user_code || user.id)}</code></td></tr>\n` +
            `  <tr><td>Username</td><td>@${esc(user.username)}</td></tr>\n` +
            `  <tr><td>Status Web</td><td>${linkStatus}</td></tr>\n` +
            `</table>\n\n` +
            `<b>📖 Cara pakai</b>\n` +
            `<ul checklist>\n` +
            `  <li checked>Isi Saldo via QRIS</li>\n` +
            `  <li>Order Nokos → pilih server → app → negara</li>\n` +
            `  <li>OTP masuk ke chat ini</li>\n` +
            `  <li>Kalau gagal, saldo refund otomatis</li>\n` +
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

    // ==================== /start ====================
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
                    `<b>✅ AKUN DITAUTKAN</b>\n\nBerhasil terhubung ke <b>@${esc(decoded.username)}</b>.`,
                    [[btnPrimary('🏠 Menu Utama', 'back_home')]]
                );
            } catch (e) {
                return sendRich(ctx,
                    `<b>❌ GAGAL</b>\n\nSesi login web sudah expired.`,
                    [[btnPrimary('🏠 Menu Utama', 'back_home')]]
                );
            }
        }

        const user = await getOrCreateUser(ctx);
        if (user.status === 'banned')
            return sendRich(ctx, '<b>❌ DIBLOKIR</b>\n\nAkun diblokir.', []);

        const { html, buttons } = renderHome(user);
        await sendRich(ctx, html, buttons);
    });

    // ==================== BACK HOME ====================
    bot.action('back_home', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
        const user = await getOrCreateUser(ctx);
        if (!user) return;
        const { html, buttons } = renderHome(user);
        await editRich(ctx, html, buttons);
    });

    // ==================== AKUN ====================
    bot.action('menu_akun', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        const linkStatus = user.telegram_linked_at ? '✅ Tertaut' : '⚠️ Guest';
        const html =
            `<b>👤 Informasi Akun</b>\n` +
            `<table bordered striped>\n` +
            `  <thead><tr><th>Kolom</th><th>Nilai</th></tr></thead>\n` +
            `  <tr><td>ID Akun</td><td><code>${esc(user.user_code || user.id)}</code></td></tr>\n` +
            `  <tr><td>Username</td><td>@${esc(user.username)}</td></tr>\n` +
            `  <tr><td>Nama</td><td>${esc(user.name)}</td></tr>\n` +
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
        try { await ctx.answerCbQuery(); } catch (_) {}
        const url = `https://asyrofotp.vercel.app/link-telegram?tg_id=${ctx.from.id}&tg_username=${ctx.from.username || ''}&merge=true`;
        await editRich(ctx,
            `<b>🔗 Tautkan Akun Web</b>\n\n` +
            `Kamu sedang pakai akun Guest.\n` +
            `Kalau ditautkan, saldo & riwayat digabung otomatis.`,
            [
                [btnUrl('🌐 Buka Web Tautkan', url)],
                [btnNormal('🔙 Kembali', 'back_home')],
            ]
        );
    });

    bot.action('menu_logout', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
        const user = await getOrCreateUser(ctx);
        if (!user) return;
        await pool.query(
            `UPDATE users SET telegram_id = NULL, telegram_username = NULL,
                    telegram_linked_at = NULL WHERE id = $1`,
            [user.id]
        );
        await editRich(ctx,
            `<b>✅ LOGOUT BERHASIL</b>\n\nKamu telah keluar.`,
            [[btnPrimary('🏠 Menu Utama', 'back_home')]]
        );
    });

    // ==================== MENU OTP ====================
    bot.action('menu_otp', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
        const user = await getOrCreateUser(ctx);
        if (user.status === 'banned') return editRich(ctx, 'Akun diblokir.', []);

        const html =
            `<b>🛒 Beli Nokos</b>\n` +
            `Pilih server:\n\n` +
            `<table bordered striped>\n` +
            `  <thead><tr><th>Server</th><th>Keterangan</th><th>Badge</th></tr></thead>\n` +
            `  <tr><td>1</td><td>Ekonomi (Murah, ID only)</td><td>🟢 MURAH</td></tr>\n` +
            `  <tr><td>2</td><td>Premium (Semua negara)</td><td>🔥 PREMIUM</td></tr>\n` +
            `</table>`;

        await editRich(ctx, html, [
            [btnPrimary('🇮🇩 Server 1 (Ekonomi)', `srv${SEP}ekonomi${SEP}1`)],
            [btnPrimary('🌍 Server 2 (Premium)', `srv${SEP}premium${SEP}1`)],
            [btnNormal('🔙 Kembali', 'back_home')],
        ]);
    });

    // ==================== STEP 1: LIST SERVICE ====================
    bot.action(new RegExp('^srv' + SEP + '(ekonomi|premium)' + SEP + '(\\d+)$'), async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
        const server = ctx.match[1];
        const page = parseInt(ctx.match[2], 10) || 1;
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        try {
            let services = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch('/services?server=ekonomi');
                services = (data.services || []).map(s => ({ code: s.code, name: s.name }));
            } else {
                const raw = await premiumFetch('/catalog/services');
                services = (raw || []).map(s => ({ code: s.code, name: s.name }));
            }
            if (!services.length)
                return editRich(ctx, '❌ Tidak ada layanan.', [[btnPrimary('🔙 Kembali', 'menu_otp')]]);

            const perPage = 8;
            const totalPages = Math.max(1, Math.ceil(services.length / perPage));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * perPage;
            const current = services.slice(start, start + perPage);

            const html =
                `<b>📱 Pilih Layanan</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Server</th><th>Halaman</th><th>Total</th></tr></thead>\n` +
                `  <tr><td>${server === 'ekonomi' ? '1 (Ekonomi)' : '2 (Premium)'}</td><td>${safePage}/${totalPages}</td><td>${services.length} layanan</td></tr>\n` +
                `</table>`;

            const buttons = [];
            for (let i = 0; i < current.length; i += 2) {
                const row = [btnNormal(current[i].name, `svc${SEP}${server}${SEP}${current[i].code}${SEP}${safePage}`)];
                if (current[i + 1]) row.push(btnNormal(current[i + 1].name, `svc${SEP}${server}${SEP}${current[i + 1].code}${SEP}${safePage}`));
                buttons.push(row);
            }

            const nav = [];
            if (safePage > 1) nav.push(btnPrimary('⬅️ Prev', `srv${SEP}${server}${SEP}${safePage - 1}`));
            if (safePage < totalPages) nav.push(btnPrimary('Next ➡️', `srv${SEP}${server}${SEP}${safePage + 1}`));
            if (nav.length) buttons.push(nav);

            buttons.push([btnNormal('🔙 Kembali', 'menu_otp')]);
            await editRich(ctx, html, buttons);
        } catch (e) {
            await editRich(ctx, `❌ Error: ${esc(e.message)}`, [[btnPrimary('🔙 Kembali', 'menu_otp')]]);
        }
    });

    // ==================== STEP 2: LIST COUNTRY ====================
    bot.action(new RegExp('^svc' + SEP + '(ekonomi|premium)' + SEP + '([^' + SEP + ']+)' + SEP + '(\\d+)$'), async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
        const server = ctx.match[1];
        const code = ctx.match[2];
        const page = parseInt(ctx.match[3], 10) || 1;
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        try {
            let countries = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch(`/countries?server=ekonomi&service=${encodeURIComponent(code)}`);
                countries = (data.countries || []).map(c => ({ code: c.code, name: c.name || c.code }));
            } else {
                const raw = await premiumFetch('/catalog/countries');
                countries = (raw || []).map(c => ({ code: c.code, name: c.name || c.code }));
            }
            if (!countries.length)
                return editRich(ctx, '❌ Tidak ada negara.', [[btnPrimary('🔙 Kembali', `srv${SEP}${server}${SEP}1`)]]);

            const perPage = 8;
            const totalPages = Math.max(1, Math.ceil(countries.length / perPage));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * perPage;
            const current = countries.slice(start, start + perPage);

            const html =
                `<b>🌍 Pilih Negara</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Service</th><th>Halaman</th><th>Total</th></tr></thead>\n` +
                `  <tr><td>${esc(code)}</td><td>${safePage}/${totalPages}</td><td>${countries.length} negara</td></tr>\n` +
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
            await editRich(ctx, `❌ Error: ${esc(e.message)}`, [[btnPrimary('🔙 Kembali', 'menu_otp')]]);
        }
    });

    // ==================== STEP 3: LIST HARGA ====================
    bot.action(new RegExp('^cty' + SEP + '(ekonomi|premium)' + SEP + '([^' + SEP + ']+)' + SEP + '([a-z0-9]+)' + SEP + '(\\d+)$'), async (ctx) => {
        try { await ctx.answerCbQuery('Memuat harga...'); } catch (_) {}
        const server = ctx.match[1];
        const code = ctx.match[2];
        const country = ctx.match[3];
        const page = parseInt(ctx.match[4], 10) || 1;
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        try {
            let providers = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch(`/prices?server=ekonomi&service=${encodeURIComponent(code)}&country=${encodeURIComponent(country)}`);
                providers = (data.providers || []).map(p => {
                    const raw = Number(p.price_idr) || 0;
                    return {
                        id: String(p.id),
                        raw_price: raw,
                        price: applyMarkup(raw),
                        stock: p.stock || 0,
                    };
                });
            } else {
                const [cr, sr] = await Promise.all([
                    premiumFetch('/catalog/countries'),
                    premiumFetch('/catalog/services'),
                ]);
                const cObj = (cr || []).find(c => String(c.code).toLowerCase() === country.toLowerCase());
                const sObj = (sr || []).find(s => String(s.code).toLowerCase() === code.toLowerCase());
                if (cObj && sObj) {
                    const params = new URLSearchParams({
                        country_id: String(cObj.id), platform_id: String(sObj.id), limit: '100', page: '1',
                    });
                    const products = await premiumFetch(`/catalog/products?${params}`);
                    providers = (products || [])
                        .filter(p => p.active !== false)
                        .map(p => {
                            const raw = premiumMoneyToIdr(p.price);
                            return {
                                id: String(p.id),
                                raw_price: raw,
                                price: applyMarkup(raw),
                                stock: Number(p.available) || 0,
                            };
                        });
                }
            }

            // ✅ filter harga valid setelah markup
            providers = providers.filter(p => p.price > 0 && p.raw_price > 0);

            if (!providers.length) {
                return editRich(ctx,
                    `<b>❌ Stok habis</b>\n\n` +
                    `<table bordered striped>\n` +
                    `  <thead><tr><th>Service</th><th>Negara</th><th>Status</th></tr></thead>\n` +
                    `  <tr><td>${esc(code)}</td><td>${esc(country.toUpperCase())}</td><td>Kosong</td></tr>\n` +
                    `</table>`,
                    [[btnPrimary('🔙 Kembali', `svc${SEP}${server}${SEP}${code}${SEP}1`)]]
                );
            }

            const perPage = 8;
            const totalPages = Math.max(1, Math.ceil(providers.length / perPage));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * perPage;
            const current = providers.slice(start, start + perPage);

            const html =
                `<b>💰 Pilih Harga</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Service</th><th>Negara</th><th>Halaman</th><th>Stok</th></tr></thead>\n` +
                `  <tr><td>${esc(code)}</td><td>${esc(country.toUpperCase())}</td><td>${safePage}/${totalPages}</td><td>${providers.reduce((a, b) => a + b.stock, 0)}</td></tr>\n` +
                `</table>`;

            const buttons = current.map(p => [
                btnSuccess(`${toRp(p.price)} | Stok: ${p.stock}`, `buy${SEP}${server}${SEP}${code}${SEP}${country}${SEP}${p.id}`),
            ]);

            const nav = [];
            if (safePage > 1) nav.push(btnPrimary('⬅️ Prev', `cty${SEP}${server}${SEP}${code}${SEP}${country}${SEP}${safePage - 1}`));
            if (safePage < totalPages) nav.push(btnPrimary('Next ➡️', `cty${SEP}${server}${SEP}${code}${SEP}${country}${SEP}${safePage + 1}`));
            if (nav.length) buttons.push(nav);

            buttons.push([btnNormal('🔙 Kembali', `svc${SEP}${server}${SEP}${code}${SEP}1`)]);
            await editRich(ctx, html, buttons);
        } catch (e) {
            console.error('cty handler error:', e.message);
            await editRich(ctx, `❌ Error: ${esc(e.message)}`, [[btnPrimary('🔙 Kembali', `svc${SEP}${server}${SEP}${code}${SEP}1`)]]);
        }
    });

    // ==================== STEP 4: BELI ====================
    bot.action(new RegExp('^buy' + SEP + '(ekonomi|premium)' + SEP + '([^' + SEP + ']+)' + SEP + '([a-z0-9]+)' + SEP + '(.+)$'), async (ctx) => {
        try { await ctx.answerCbQuery('Memproses order...'); } catch (_) {}
        const server = ctx.match[1];
        const code = ctx.match[2];
        const country = ctx.match[3];
        const providerId = ctx.match[4];
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        let phone = null, price = 0, orderId = null;
        try {
            if (server === 'ekonomi') {
                const data = await dibananaFetch('/order', { method: 'POST', body: JSON.stringify({ id: providerId }) });
                if (!data || !data.order_id) throw new Error(data?.message || 'Gagal order');
                phone = data.phone_number;
                price = applyMarkup(Number(data.price_idr) || 0);
                orderId = String(data.order_id);
            } else {
                const data = await premiumFetch('/orders/create', {
                    method: 'POST',
                    headers: { 'Idempotency-Key': 'bot_' + crypto.randomBytes(16).toString('hex') },
                    body: JSON.stringify({ product_id: Number(providerId), quantity: 1 }),
                });
                const first = data?.orders?.[0];
                if (!first || !first.id) throw new Error('Gagal order premium');
                phone = first.phone_number;
                price = applyMarkup(premiumMoneyToIdr(first.amount));
                orderId = String(first.id);
            }

            const uRes = await pool.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [user.id]);
            const balance = Number(uRes.rows[0].balance);
            if (balance < price) {
                if (server === 'ekonomi') await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: orderId }) }).catch(() => {});
                else await premiumFetch('/orders/cancel', { method: 'POST', body: JSON.stringify({ id: Number(orderId) }) }).catch(() => {});
                throw new Error('Saldo kurang. Isi saldo dulu.');
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
                if (server === 'ekonomi') await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: orderId }) }).catch(() => {});
                else await premiumFetch('/orders/cancel', { method: 'POST', body: JSON.stringify({ id: Number(orderId) }) }).catch(() => {});
                throw new Error('DB error: ' + dbErr.message);
            } finally {
                client.release();
            }

            const html =
                `<b>✅ ORDER BERHASIL</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Kolom</th><th>Nilai</th></tr></thead>\n` +
                `  <tr><td>OTP ID</td><td><code>${esc(otpId)}</code></td></tr>\n` +
                `  <tr><td>Nomor</td><td><code>${esc(phone)}</code></td></tr>\n` +
                `  <tr><td>Harga</td><td><b>${toRp(price)}</b></td></tr>\n` +
                `  <tr><td>Status</td><td>⏳ Menunggu OTP</td></tr>\n` +
                `  <tr><td>Expired</td><td>${expAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td></tr>\n` +
                `</table>\n\n` +
                `<b>📖 Langkah selanjutnya</b>\n` +
                `<ul checklist>\n` +
                `  <li checked>Order dibuat</li>\n` +
                `  <li>Saldo terpotong</li>\n` +
                `  <li>Tunggu OTP masuk</li>\n` +
                `  <li>Klik "Cek OTP" untuk refresh</li>\n` +
                `</ul>`;

            await editRich(ctx, html, [
                [btnPrimary('🔄 Cek OTP', `chk${SEP}${otpId}`)],
                [btnNormal('🔙 Menu Utama', 'back_home')],
            ]);
        } catch (e) {
            await editRich(ctx, `<b>❌ GAGAL</b>\n\n${esc(e.message)}`, [[btnPrimary('🔙 Menu Utama', 'back_home')]]);
        }
    });

    // ==================== CEK OTP ====================
    bot.action(new RegExp('^chk' + SEP + '(.+)$'), async (ctx) => {
        try { await ctx.answerCbQuery('Cek...'); } catch (_) {}
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
                `  <tr><td>OTP ID</td><td><code>${esc(otpId)}</code></td></tr>\n` +
                `  <tr><td>Nomor</td><td><code>${esc(o.phone_number || '-')}</code></td></tr>\n` +
                `  <tr><td>Service</td><td>${esc(o.service || '-')}</td></tr>\n` +
                `  <tr><td>Status</td><td>${otp ? '✅ OTP Diterima' : (status === 'pending' ? '⏳ Menunggu' : esc(status))}</td></tr>\n` +
                `  <tr><td>OTP</td><td>${otp ? `<b><code>${esc(otp)}</code></b>` : '-'}</td></tr>\n` +
                `  <tr><td>Harga</td><td>${toRp(o.price)}</td></tr>\n` +
                `</table>`;

            await editRich(ctx, html, [
                [btnPrimary('🔄 Refresh', `chk${SEP}${otpId}`)],
                [btnNormal('🔙 Menu Utama', 'back_home')],
            ]);
        } catch (e) {
            await editRich(ctx, `❌ ${esc(e.message)}`, [[btnPrimary('🔙 Menu Utama', 'back_home')]]);
        }
    });

    // ==================== DEPOSIT ====================
    bot.action('menu_deposit', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        const html =
            `<b>💰 Top Up Saldo</b>\n` +
            `Pilih nominal:\n\n` +
            `<b>📖 Cara isi saldo</b>\n` +
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
        try { await ctx.answerCbQuery('Membuat QRIS...'); } catch (_) {}
        const amount = parseInt(ctx.match[1], 10);
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        try {
            const data = await qrispyFetch('/api/payment/qris/create', {
                method: 'POST',
                body: JSON.stringify({ amount }),
            });
            const q = data.data;
            if (!q || !q.qr_image) throw new Error('Gagal membuat QRIS.');

            const referenceId = `BOT${Date.now()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
            const ourFee = calculateDepositFee(amount);
            const expiresAt = q.expires_at ? new Date(q.expires_at) : new Date(Date.now() + 15 * 60 * 1000);

            await pool.query(
                `INSERT INTO deposits
                 (user_id, reference_id, method, amount, total_amount, fee, status, qris_id, qris_url, payment_reference, expires_at)
                 VALUES ($1, $2, 'qrispy', $3, $4, $5, 'pending', $6, $7, $8, $9)`,
                [
                    user.id, referenceId, amount, amount + ourFee, ourFee,
                    String(q.id || q.qris_id || referenceId),
                    q.qr_image, referenceId, expiresAt,
                ]
            );

            // Edit pesan lama → info deposit (bukan delete)
            await editRich(ctx,
                `<b>💳 TOP UP QRIS</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Kolom</th><th>Nilai</th></tr></thead>\n` +
                `  <tr><td>Ref ID</td><td><code>${esc(referenceId)}</code></td></tr>\n` +
                `  <tr><td>Nominal</td><td><b>${toRp(q.diterima || amount)}</b></td></tr>\n` +
                `  <tr><td>Expired</td><td>${expiresAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td></tr>\n` +
                `</table>\n\n` +
                `<b>📖 Langkah</b>\n` +
                `<ul checklist>\n` +
                `  <li checked>QRIS dibuat</li>\n` +
                `  <li>Scan & bayar</li>\n` +
                `  <li>Saldo masuk otomatis</li>\n` +
                `</ul>\n\n` +
                `QR dikirim sebagai foto di bawah.`,
                [
                    [btnPrimary('🔄 Cek Status', `dchk${SEP}${referenceId}`)],
                    [btnNormal('🔙 Menu Utama', 'back_home')],
                ]
            );

            // Kirim QR (foto terpisah, ini WAJIB — gak bisa di-edit)
            await ctx.replyWithPhoto(
                { url: q.qr_image },
                { caption: `QRIS 15 menit. Ref: ${esc(referenceId)}`, parse_mode: 'HTML' }
            );
        } catch (e) {
            await editRich(ctx, `<b>❌ GAGAL</b>\n\n${esc(e.message)}`, [[btnPrimary('🔙 Menu Utama', 'back_home')]]);
        }
    });

    bot.action(new RegExp('^dchk' + SEP + '(.+)$'), async (ctx) => {
        try { await ctx.answerCbQuery('Cek...'); } catch (_) {}
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
                    if (s.data?.status === 'paid') {
                        await markDepositPaid(d, s.data.received_amount || s.data.amount, s.data.paid_at);
                        status = 'success';
                    } else if (s.data?.status === 'expired') {
                        await pool.query(`UPDATE deposits SET status = 'expired', updated_at = NOW() WHERE id = $1`, [d.id]);
                        status = 'expired';
                    }
                } catch (_) {}
            }

            const html =
                `<b>💳 Status Deposit</b>\n` +
                `<table bordered striped>\n` +
                `  <thead><tr><th>Kolom</th><th>Nilai</th></tr></thead>\n` +
                `  <tr><td>Ref ID</td><td><code>${esc(ref)}</code></td></tr>\n` +
                `  <tr><td>Nominal</td><td>${toRp(d.amount)}</td></tr>\n` +
                `  <tr><td>Fee</td><td>${toRp(d.fee)}</td></tr>\n` +
                `  <tr><td>Status</td><td>${status === 'success' ? '✅ Sukses' : status === 'pending' ? '⏳ Pending' : esc(status)}</td></tr>\n` +
                `</table>`;

            await editRich(ctx, html, [
                [btnPrimary('🔄 Refresh', `dchk${SEP}${ref}`)],
                [btnNormal('🔙 Menu Utama', 'back_home')],
            ]);
        } catch (e) {
            await editRich(ctx, `❌ ${esc(e.message)}`, [[btnPrimary('🔙 Menu Utama', 'back_home')]]);
        }
    });

    // ==================== RIWAYAT ====================
    bot.action('menu_riwayat', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
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
            html += `  <tr><td>${esc(o.service || '-')}</td><td><code>${esc(o.phone_number || '-')}</code></td><td>${o.otp_code ? `<code>${esc(o.otp_code)}</code>` : '⏳'}</td><td>${toRp(o.price)}</td></tr>\n`;
        });
        html += `</table>`;

        await editRich(ctx, html, [[btnPrimary('🔙 Kembali', 'back_home')]]);
    });

    // ==================== BANTUAN ====================
    bot.action('menu_bantuan', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
        await editRich(ctx,
            `<b>❓ BANTUAN</b>\n\n` +
            `Kendala? Hubungi admin:\n` +
            `<b>@asyrofc</b>`,
            [[btnPrimary('🔙 Kembali', 'back_home')]]
        );
    });

    // ==================== WEBHOOK ====================
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

    return bot;
};
