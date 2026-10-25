const { Telegraf, Markup } = require('telegraf');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

module.exports = function setupBotWebhook(app, deps) {
    const {
        pool, dibananaFetch, premiumFetch, premiumMoneyToIdr, applyMarkup,
        providerOrderStatus, providerCancelOrder,
        calculateDepositFee, COUNTRY_NAMES, SERVER_CONFIG, markDepositPaid,
        qrispyFetch, // ✅ WAJIB: export dari index
    } = deps;

    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const FIRE = '5104841245755180586';
    const SEP = '§'; // separator anti-tabrakan (gak mungkin muncul di code/country/id)

    // ==================== HELPERS ====================
    const toRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const botState = new Map();

    // === RAW API: sendRichMessage / editMessageText ===
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

    // Kirim pesan rich baru (dengan efek api)
    async function sendRich(ctx, html, buttons = [], opts = {}) {
        const payload = {
            chat_id: ctx.chat.id,
            rich_message: { html },
            message_effect_id: opts.effect === false ? undefined : FIRE,
        };
        if (buttons.length) payload.reply_markup = { inline_keyboard: buttons };
        try {
            return await apiCall('sendRichMessage', payload);
        } catch (e) {
            // Fallback ke sendMessage kalau sendRichMessage gak didukung
            console.error('sendRich fallback:', e.message);
            const fb = {
                chat_id: ctx.chat.id,
                text: html.replace(/<table[^>]*>|<\/table>|<tr[^>]*>|<\/tr>|<td[^>]*>|<\/td>|<th[^>]*>|<\/th>/gi, ' ').replace(/<[^>]+>/g, '').trim() || html,
                parse_mode: 'HTML',
            };
            if (buttons.length) fb.reply_markup = { inline_keyboard: buttons };
            return await apiCall('sendMessage', fb);
        }
    }

    // Edit pesan existing (dengan fallback: hapus + kirim baru)
    async function editRich(ctx, html, buttons = []) {
        const msgId = ctx.callbackQuery?.message?.message_id;
        if (!msgId) return sendRich(ctx, html, buttons);

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
                text: html,
                parse_mode: 'HTML',
                ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
            });
        } catch (e) {
            // Kalau edit gagal (pesan lama gak support rich / too old), hapus & kirim baru
            try { await apiCall('deleteMessage', { chat_id: ctx.chat.id, message_id: msgId }); } catch (_) {}
            return sendRich(ctx, html, buttons);
        }
    }

    // Render ulang pesan (buat navigasi "Kembali")
    async function rerender(ctx, html, buttons = []) {
        try {
            if (ctx.callbackQuery?.message?.message_id) {
                // Coba edit dulu
                return await editRich(ctx, html, buttons);
            }
        } catch (_) {}
        // Fallback: hapus + kirim baru
        try { await ctx.deleteMessage(); } catch (_) {}
        return sendRich(ctx, html, buttons);
    }

    // ==================== BUTTON STYLES ====================
    const btnPrimary = (text, data) => ({ text, callback_data: data, style: 'primary' });
    const btnSuccess = (text, data) => ({ text, callback_data: data, style: 'success' });
    const btnDanger  = (text, data) => ({ text, callback_data: data, style: 'danger' });
    const btnNormal  = (text, data) => ({ text, callback_data: data });
    const btnUrl     = (text, url)     => ({ text, url });
    const btnCheck   = (on) => on ? '☑️' : '☐';
    const btnBlink   = () => Math.random() > 0.5 ? '🟢' : '🟡'; // random blink

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

    // ==================== RENDER HELPERS ====================
    function renderHome(user) {
        const linkStatus = user.telegram_linked_at ? '✅ Tertaut' : '⚠️ Guest';
        const html =
            `<b>🏠 Dashboard Layanan Nokos</b>\n` +
            `Halo, @${esc(user.username)}.\n` +
            `Kelola layanan Anda dengan cepat, aman, dan otomatis.\n\n` +
            `<b>📊 Ringkasan Akun</b>\n` +
            `<table bordered striped>\n` +
            `  <tr><th>Kolom</th><th>Nilai</th></tr>\n` +
            `  <tr><td>Status</td><td>${user.status === 'active' ? '✅ Aktif' : '❌ Banned'}</td></tr>\n` +
            `  <tr><td>Role</td><td>${esc(user.role)}</td></tr>\n` +
            `  <tr><td>Saldo</td><td><b>${toRp(user.balance)}</b></td></tr>\n` +
            `  <tr><td>ID Akun</td><td><code>${esc(user.user_code || user.id)}</code></td></tr>\n` +
            `  <tr><td>Username</td><td>@${esc(user.username)}</td></tr>\n` +
            `  <tr><td>Status Web</td><td>${linkStatus}</td></tr>\n` +
            `</table>\n\n` +
            `<b>📖 Cara pakai</b>\n` +
            `<table bordered striped>\n` +
            `  <tr><th>#</th><th>Langkah</th></tr>\n` +
            `  <tr><td>☑️</td><td>Isi Saldo via QRIS.</td></tr>\n` +
            `  <tr><td>☐</td><td>Order Nokos → pilih server → app → negara.</td></tr>\n` +
            `  <tr><td>☐</td><td>OTP masuk ke chat ini.</td></tr>\n` +
            `  <tr><td>☐</td><td>Kalau gagal, saldo refund otomatis.</td></tr>\n` +
            `</table>`;

        const buttons = [
            [btnPrimary(`${btnBlink()} 🛒 Order Nokos`, 'menu_otp')],
            [btnSuccess(`${btnBlink()} 💰 Isi Saldo`, 'menu_deposit')],
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
                    `<b>✅ AKUN DITAUTKAN</b>\n\nBerhasil terhubung ke <b>@${esc(decoded.username)}</b>.\nKetik /start untuk lanjut.`,
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
            return sendRich(ctx, '<b>❌ DIBLOKIR</b>\n\nAkun diblokir dari sistem.', []);

        const { html, buttons } = renderHome(user);
        await sendRich(ctx, html, buttons);
    });

    // ==================== NAVIGASI: BACK HOME ====================
    // ✅ FIX: pakai rerender, bukan bot.start(ctx) yang gak valid di CallbackQueryContext
    bot.action('back_home', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
        botState.delete(ctx.from.id);
        const user = await getOrCreateUser(ctx);
        if (!user) return;
        const { html, buttons } = renderHome(user);
        await rerender(ctx, html, buttons);
    });

    // ==================== MENU AKUN ====================
    bot.action('menu_akun', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        const linkStatus = user.telegram_linked_at ? '✅ Tertaut' : '⚠️ Guest';
        const html =
            `<b>👤 Informasi Akun</b>\n` +
            `<table bordered striped>\n` +
            `  <tr><th>Kolom</th><th>Nilai</th></tr>\n` +
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
            `Kalau ditautkan, saldo & riwayat digabung otomatis.\n\n` +
            `<i>Klik tombol di bawah.</i>`,
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
        await rerender(ctx,
            `<b>✅ LOGOUT BERHASIL</b>\n\nKamu telah keluar.`,
            [[btnPrimary('🏠 Menu Utama', 'back_home')]]
        );
    });

    // ==================== MENU OTP: pilih server ====================
    bot.action('menu_otp', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
        const user = await getOrCreateUser(ctx);
        if (user.status === 'banned') return rerender(ctx, 'Akun diblokir.', []);

        const html =
            `<b>🛒 Beli Nokos</b>\n` +
            `Pilih server:\n\n` +
            `<table bordered striped>\n` +
            `  <tr><th>Server</th><th>Keterangan</th><th>Badge</th></tr>\n` +
            `  <tr><td>1</td><td>Ekonomi (Murah, ID only)</td><td>🟢 MURAH</td></tr>\n` +
            `  <tr><td>2</td><td>Premium (Semua negara)</td><td>🔥 PREMIUM</td></tr>\n` +
            `</table>`;

        await editRich(ctx, html, [
            [btnPrimary('🇮🇩 Server 1 (Ekonomi)', 'srv' + SEP + 'ekonomi' + SEP + '1')],
            [btnPrimary('🌍 Server 2 (Premium)', 'srv' + SEP + 'premium' + SEP + '1')],
            [btnNormal('🔙 Kembali', 'back_home')],
        ]);
    });

    // ==================== STEP 1: LIST SERVICE (pagination) ====================
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
                return rerender(ctx, '❌ Tidak ada layanan.', [[btnPrimary('🔙 Kembali', 'menu_otp')]]);

            const perPage = 8;
            const totalPages = Math.max(1, Math.ceil(services.length / perPage));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * perPage;
            const current = services.slice(start, start + perPage);

            const html =
                `<b>📱 Pilih Layanan</b>\n` +
                `<table bordered striped>\n` +
                `  <tr><th>Server</th><th>Halaman</th><th>Total</th></tr>\n` +
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
            await rerender(ctx, `❌ Error: ${esc(e.message)}`, [[btnPrimary('🔙 Kembali', 'menu_otp')]]);
        }
    });

    // ==================== STEP 2: LIST COUNTRY (pagination) ====================
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
                return rerender(ctx, '❌ Tidak ada negara.', [[btnPrimary('🔙 Kembali', `srv${SEP}${server}${SEP}1`)]]);

            const perPage = 8;
            const totalPages = Math.max(1, Math.ceil(countries.length / perPage));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * perPage;
            const current = countries.slice(start, start + perPage);

            const html =
                `<b>🌍 Pilih Negara</b>\n` +
                `<table bordered striped>\n` +
                `  <tr><th>Service</th><th>Halaman</th><th>Total</th></tr>\n` +
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
            await rerender(ctx, `❌ Error: ${esc(e.message)}`, [[btnPrimary('🔙 Kembali', 'menu_otp')]]);
        }
    });

    // ==================== STEP 3: LIST PRICE (pagination) ====================
    bot.action(new RegExp('^cty' + SEP + '(ekonomi|premium)' + SEP + '([^' + SEP + ']+)' + SEP + '([a-z0-9]+)' + SEP + '(\\d+)$'), async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
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
                providers = (data.providers || []).map(p => ({
                    id: String(p.id),
                    price: applyMarkup(Number(p.price_idr) || 0),
                    stock: p.stock || 0,
                }));
            } else {
                const [cr, sr] = await Promise.all([
                    premiumFetch('/catalog/countries'),
                    premiumFetch('/catalog/services'),
                ]);
                const cObj = (cr || []).find(c => String(c.code).toLowerCase() === country.toLowerCase());
                const sObj = (sr || []).find(s => String(s.code).toLowerCase() === code.toLowerCase());
                if (cObj && sObj) {
                    const params = new URLSearchParams({
                        country_id: cObj.id, platform_id: sObj.id, limit: '100', page: '1',
                    });
                    const products = await premiumFetch(`/catalog/products?${params}`);
                    providers = (products || [])
                        .filter(p => p.active !== false)
                        .map(p => ({
                            id: String(p.id),
                            price: applyMarkup(premiumMoneyToIdr(p.price)),
                            stock: Number(p.available) || 0,
                        }));
                }
            }
            providers = providers.filter(p => p.price > 0);

            if (!providers.length)
                return rerender(ctx, '❌ Stok habis.', [[btnPrimary('🔙 Kembali', `svc${SEP}${server}${SEP}${code}${SEP}1`)]]);

            const perPage = 8;
            const totalPages = Math.max(1, Math.ceil(providers.length / perPage));
            const safePage = Math.min(page, totalPages);
            const start = (safePage - 1) * perPage;
            const current = providers.slice(start, start + perPage);

            const html =
                `<b>💰 Pilih Harga</b>\n` +
                `<table bordered striped>\n` +
                `  <tr><th>Service</th><th>Negara</th><th>Halaman</th></tr>\n` +
                `  <tr><td>${esc(code)}</td><td>${esc(country.toUpperCase())}</td><td>${safePage}/${totalPages}</td></tr>\n` +
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
            await rerender(ctx, `❌ Error: ${esc(e.message)}`, [[btnPrimary('🔙 Kembali', 'menu_otp')]]);
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
                throw new Error('Saldo kurang. Silakan isi saldo dulu.');
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
                `  <tr><th>Kolom</th><th>Nilai</th></tr>\n` +
                `  <tr><td>OTP ID</td><td><code>${esc(otpId)}</code></td></tr>\n` +
                `  <tr><td>Nomor</td><td><code>${esc(phone)}</code></td></tr>\n` +
                `  <tr><td>Harga</td><td><b>${toRp(price)}</b></td></tr>\n` +
                `  <tr><td>Status</td><td>⏳ Menunggu OTP</td></tr>\n` +
                `  <tr><td>Expired</td><td>${expAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td></tr>\n` +
                `</table>\n\n` +
                `Cek menu utama untuk lihat OTP.`;

            await rerender(ctx, html, [
                [btnPrimary('🔄 Cek OTP', `chk${SEP}${otpId}`)],
                [btnNormal('🔙 Menu Utama', 'back_home')],
            ]);
        } catch (e) {
            await rerender(ctx, `<b>❌ GAGAL</b>\n\n${esc(e.message)}`, [[btnPrimary('🔙 Menu Utama', 'back_home')]]);
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

            // Kalau masih pending, poll ke provider
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
                `  <tr><th>Kolom</th><th>Nilai</th></tr>\n` +
                `  <tr><td>OTP ID</td><td><code>${esc(otpId)}</code></td></tr>\n` +
                `  <tr><td>Nomor</td><td><code>${esc(o.phone_number || '-')}</code></td></tr>\n` +
                `  <tr><td>Service</td><td>${esc(o.service || '-')}</td></tr>\n` +
                `  <tr><td>Status</td><td>${otp ? '✅ OTP Diterima' : (status === 'pending' ? '⏳ Menunggu' : esc(status))}</td></tr>\n` +
                `  <tr><td>OTP</td><td>${otp ? `<b><code>${esc(otp)}</code></b>` : '-'}</td></tr>\n` +
                `  <tr><td>Harga</td><td>${toRp(o.price)}</td></tr>\n` +
                `</table>`;

            await rerender(ctx, html, [
                [btnPrimary('🔄 Refresh', `chk${SEP}${otpId}`)],
                [btnNormal('🔙 Menu Utama', 'back_home')],
            ]);
        } catch (e) {
            await rerender(ctx, `❌ ${esc(e.message)}`, [[btnPrimary('🔙 Menu Utama', 'back_home')]]);
        }
    });

    // ==================== MENU DEPOSIT ====================
    bot.action('menu_deposit', async (ctx) => {
        try { await ctx.answerCbQuery(); } catch (_) {}
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        const html =
            `<b>💰 Top Up Saldo</b>\n` +
            `Pilih nominal:\n\n` +
            `<table bordered striped>\n` +
            `  <tr><th>Nominal</th><th>Status</th></tr>\n` +
            `  <tr><td>Rp 5.000</td><td>${btnCheck(false)}</td></tr>\n` +
            `  <tr><td>Rp 10.000</td><td>${btnCheck(false)}</td></tr>\n` +
            `  <tr><td>Rp 20.000</td><td>${btnCheck(false)}</td></tr>\n` +
            `  <tr><td>Rp 50.000</td><td>${btnCheck(false)}</td></tr>\n` +
            `</table>`;

        await editRich(ctx, html, [
            [btnSuccess('Rp 5.000', `dep${SEP}5000`), btnSuccess('Rp 10.000', `dep${SEP}10000`)],
            [btnSuccess('Rp 20.000', `dep${SEP}20000`), btnSuccess('Rp 50.000', `dep${SEP}50000`)],
            [btnNormal('🔙 Kembali', 'back_home')],
        ]);
    });

    // ==================== STEP DEPO: qrispyFetch via deps ====================
    bot.action(new RegExp('^dep' + SEP + '(\\d+)$'), async (ctx) => {
        try { await ctx.answerCbQuery('Membuat QRIS...'); } catch (_) {}
        const amount = parseInt(ctx.match[1], 10);
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        try {
            // ✅ FIX: pakai qrispyFetch dari deps (wajib di-export dari index)
            if (!qrispyFetch) throw new Error('Fitur deposit belum dikonfigurasi (qrispyFetch missing).');

            const data = await qrispyFetch('/api/payment/qris/create', {
                method: 'POST',
                body: JSON.stringify({ amount }),
            });
            const q = data.data;
            if (!q || !q.qr_image) throw new Error('Gagal membuat QRIS.');

            // Catat deposit di DB
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

            // Edit pesan lama → teks info
            await editRich(ctx,
                `<b>💳 TOP UP QRIS</b>\n` +
                `<table bordered striped>\n` +
                `  <tr><th>Kolom</th><th>Nilai</th></tr>\n` +
                `  <tr><td>Ref ID</td><td><code>${esc(referenceId)}</code></td></tr>\n` +
                `  <tr><td>Nominal</td><td><b>${toRp(q.diterima || amount)}</b></td></tr>\n` +
                `  <tr><td>Expired</td><td>${expiresAt.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}</td></tr>\n` +
                `</table>\n\n` +
                `Silakan scan QR di bawah ini:`,
                [
                    [btnPrimary('🔄 Cek Status', `dchk${SEP}${referenceId}`)],
                    [btnNormal('🔙 Menu Utama', 'back_home')],
                ]
            );

            // Kirim QR sebagai foto
            await ctx.replyWithPhoto(
                { url: q.qr_image },
                { caption: `<i>QRIS berlaku 15 menit. Ref: ${esc(referenceId)}</i>`, parse_mode: 'HTML' }
            );
        } catch (e) {
            await rerender(ctx, `<b>❌ GAGAL</b>\n\n${esc(e.message)}`, [[btnPrimary('🔙 Menu Utama', 'back_home')]]);
        }
    });

    // ==================== CEK STATUS DEPOSIT ====================
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
            // Cek ke provider kalau masih pending
            if (status === 'pending' && qrispyFetch) {
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
                `  <tr><th>Kolom</th><th>Nilai</th></tr>\n` +
                `  <tr><td>Ref ID</td><td><code>${esc(ref)}</code></td></tr>\n` +
                `  <tr><td>Nominal</td><td>${toRp(d.amount)}</td></tr>\n` +
                `  <tr><td>Fee</td><td>${toRp(d.fee)}</td></tr>\n` +
                `  <tr><td>Status</td><td>${status === 'success' ? '✅ Sukses' : status === 'pending' ? '⏳ Pending' : esc(status)}</td></tr>\n` +
                `</table>`;

            await rerender(ctx, html, [
                [btnPrimary('🔄 Refresh', `dchk${SEP}${ref}`)],
                [btnNormal('🔙 Menu Utama', 'back_home')],
            ]);
        } catch (e) {
            await rerender(ctx, `❌ ${esc(e.message)}`, [[btnPrimary('🔙 Menu Utama', 'back_home')]]);
        }
    });

    // ==================== MENU RIWAYAT ====================
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
            return rerender(ctx, '<b>📭 KOSONG</b>\n\nBelum ada riwayat order.', [[btnPrimary('🔙 Kembali', 'back_home')]]);

        let html =
            `<b>📋 Riwayat 5 Terakhir</b>\n` +
            `<table bordered striped>\n` +
            `  <tr><th>Service</th><th>Nomor</th><th>OTP</th><th>Harga</th></tr>\n`;
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
