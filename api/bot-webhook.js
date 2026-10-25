const { Telegraf, Markup } = require('telegraf');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = function setupBotWebhook(app, deps) {
    const {
        pool,
        dibananaFetch, premiumFetch, premiumMoneyToIdr, applyMarkup,
        providerOrderStatus, providerCancelOrder,
        notifyOtpSuccess, notifyDepositSuccess,
        calculateDepositFee, COUNTRY_NAMES, SERVER_CONFIG, markDepositPaid
    } = deps;

    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'asyrofotp_bot';
    const FIRE = '5104841245755180586';

    // ==================== HELPERS ====================
    const toRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // State buat nampung input
    const botState = new Map();

    async function getUserByTg(tgId) {
        const r = await pool.query(
            'SELECT id, username, name, balance, user_code, role, status FROM users WHERE telegram_id = $1 LIMIT 1',
            [tgId]
        );
        return r.rows[0] || null;
    }

    async function renderMenu(ctx, text, keyboard) {
        try { await ctx.answerCbQuery().catch(() => {}); } catch {}
        try {
            if (ctx.updateType === 'callback_query' && ctx.callbackQuery?.message) {
                await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard, disable_web_page_preview: true });
            } else {
                await ctx.reply(text, { parse_mode: 'HTML', ...keyboard, disable_web_page_preview: true, message_effect_id: FIRE });
            }
        } catch (e) {
            await ctx.reply(text, { parse_mode: 'HTML', ...keyboard, disable_web_page_preview: true });
        }
    }

    // ==================== /start ====================
    bot.start(async (ctx) => {
        const payload = ctx.startPayload || '';
        
        if (payload.startsWith('link_')) {
            const tokenPayload = payload.replace(/^link_/, '');
            try {
                const decoded = jwt.verify(tokenPayload, process.env.JWT_SECRET);
                await pool.query(
                    `UPDATE users SET telegram_id = $1, telegram_username = $2, telegram_linked_at = NOW(), updated_at = NOW() WHERE id = $3`,
                    [ctx.from.id, ctx.from.username || null, decoded.id]
                );
                await ctx.reply(`✅ Akun Telegram berhasil ditautkan ke akun *@${esc(decoded.username)}*.\n\nKetik /start untuk mulai.`, { parse_mode: 'HTML' });
                return;
            } catch (e) {
                await ctx.reply('❌ Sesi login dari web sudah expired. Silakan lanjutkan dengan Telegram di menu utama.');
            }
        }

        const user = await getUserByTg(ctx.from.id);
        
        if (!user) {
            const text = 
                `👋 <b>Selamat datang di AsyrofOTP!</b>\n\n` +
                `Kamu belum memiliki akun yang tertaut. Klik tombol di bawah untuk membuat akun otomatis menggunakan data Telegram kamu.`;
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('🚀 Lanjutkan dengan Telegram', 'reg_start')]
            ]);
            await renderMenu(ctx, text, keyboard);
            return;
        }

        if (user.status === 'banned') {
            return ctx.reply('❌ Akun kamu diblokir.');
        }

        const text =
            `<b>Sxrf - Jasa Layanan OTP Nomor</b>\n\n` +
            `<u>ID Akun</u> | <code>${esc(user.user_code || user.id)}</code>\n` +
            `<u>Username</u> | <code>@${esc(user.username)}</code>\n` +
            `<u>Total Saldo</u> | <code>${toRp(user.balance)}</code>`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🛒 Beli Nokos', 'menu_otp'), Markup.button.callback('💰 Top Up', 'menu_deposit')],
            [Markup.button.callback('📋 Riwayat', 'menu_riwayat'), Markup.button.callback('❓ Bantuan', 'menu_bantuan')],
            [Markup.button.callback('🚪 Logout', 'menu_logout')],
        ]);

        await renderMenu(ctx, text, keyboard);
    });

    // ==================== REGISTER VIA TELEGRAM ====================
    bot.action('reg_start', async (ctx) => {
        botState.set(ctx.from.id, { step: 'reg_pass' });
        const text = 
            `🔐 <b>Buat Akun</b>\n\n` +
            `Username: <code>${esc(ctx.from.username || 'tg_' + ctx.from.id)}</code>\n` +
            `Nama: <code>${esc(ctx.from.first_name || 'Telegram User')}</code>\n\n` +
            `Silakan ketik <b>Password</b> yang ingin kamu gunakan untuk akun ini (minimal 6 karakter):`;
        
        await renderMenu(ctx, text, Markup.inlineKeyboard([
            [Markup.button.callback('❌ Batal', 'reg_cancel')]
        ]));
    });

    bot.action('reg_cancel', async (ctx) => {
        botState.delete(ctx.from.id);
        ctx.startPayload = '';
        bot.start(ctx);
    });

    // ==================== MENU OTP ====================
    bot.action('menu_otp', async (ctx) => {
        const user = await getUserByTg(ctx.from.id);
        if (!user) return ctx.reply('Ketik /start untuk mendaftar.');
        
        botState.delete(ctx.from.id);
        const text = `🛒 <b>Beli Nokos</b>\n\nPilih server:`;
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🇮🇩 Server 1 (Ekonomi)', 'otp_srv_ekonomi')],
            [Markup.button.callback('🌍 Server 2 (Premium)', 'otp_srv_premium')],
            [Markup.button.callback('🏠 Menu', 'back_home')],
        ]);
        await renderMenu(ctx, text, keyboard);
    });

    bot.action(/^otp_srv_(ekonomi|premium)$/, async (ctx) => {
        const server = ctx.match[1];
        const user = await getUserByTg(ctx.from.id);
        if (!user) return;

        await ctx.answerCbQuery('Mengambil layanan...');

        try {
            let services = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch('/services?server=ekonomi');
                services = (data.services || []).slice(0, 15).map(s => ({
                    code: s.code, name: s.name, price: applyMarkup(Number(s.price_idr) || 0)
                }));
            } else {
                const raw = await premiumFetch('/catalog/services');
                services = (raw || []).slice(0, 15).map(s => ({
                    code: s.code, name: s.name, price: 0
                }));
            }

            if (services.length === 0) {
                return renderMenu(ctx, '❌ Tidak ada layanan tersedia.', Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'back_home')]]));
            }

            const buttons = [];
            for (let i = 0; i < services.length; i += 2) {
                const row = [];
                const s1 = services[i];
                row.push(Markup.button.callback(`${s1.name}`, `otp_svc_${server}_${s1.code}`));
                if (services[i + 1]) {
                    const s2 = services[i + 1];
                    row.push(Markup.button.callback(`${s2.name}`, `otp_svc_${server}_${s2.code}`));
                }
                buttons.push(row);
            }
            buttons.push([Markup.button.callback('🏠 Menu', 'back_home')]);

            await renderMenu(ctx, `📱 <b>Pilih Layanan</b>`, Markup.inlineKeyboard(buttons));
        } catch (e) {
            await renderMenu(ctx, `❌ Error: ${esc(e.message)}`, Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'back_home')]]));
        }
    });

    bot.action(/^otp_svc_(ekonomi|premium)_(.+)$/, async (ctx) => {
        const [, server, code] = ctx.match;
        const user = await getUserByTg(ctx.from.id);
        if (!user) return;

        await ctx.answerCbQuery('Mengambil negara...');

        try {
            let countries = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch(`/countries?server=ekonomi&service=${encodeURIComponent(code)}`);
                countries = (data.countries || []).slice(0, 15);
            } else {
                const countriesRaw = await premiumFetch('/catalog/countries');
                countries = (countriesRaw || []).slice(0, 15).map(c => ({ code: c.code, name: c.name }));
            }

            if (countries.length === 0) {
                return renderMenu(ctx, '❌ Tidak ada negara tersedia.', Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'back_home')]]));
            }

            const buttons = [];
            for (let i = 0; i < countries.length; i += 2) {
                const row = [];
                row.push(Markup.button.callback(`${countries[i].name || countries[i].code}`, `otp_cty_${server}_${code}_${countries[i].code}`));
                if (countries[i + 1]) {
                    row.push(Markup.button.callback(`${countries[i + 1].name || countries[i + 1].code}`, `otp_cty_${server}_${code}_${countries[i + 1].code}`));
                }
                buttons.push(row);
            }
            buttons.push([Markup.button.callback('🏠 Menu', 'back_home')]);

            await renderMenu(ctx, `🌍 <b>Pilih Negara</b>`, Markup.inlineKeyboard(buttons));
        } catch (e) {
            await renderMenu(ctx, `❌ Error: ${esc(e.message)}`, Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'back_home')]]));
        }
    });

    bot.action(/^otp_cty_(ekonomi|premium)_([^_]+)_([a-z]{2})$/, async (ctx) => {
        const [, server, code, country] = ctx.match;
        const user = await getUserByTg(ctx.from.id);
        if (!user) return;

        await ctx.answerCbQuery('Mengambil harga...');

        try {
            let providers = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch(`/prices?server=ekonomi&service=${encodeURIComponent(code)}&country=${encodeURIComponent(country)}`);
                providers = (data.providers || []).slice(0, 5).map(p => ({
                    id: p.id, price: applyMarkup(Number(p.price_idr) || 0), stock: p.stock
                }));
            } else {
                const [cr, sr] = await Promise.all([premiumFetch('/catalog/countries'), premiumFetch('/catalog/services')]);
                const cObj = (cr || []).find(c => c.code === country);
                const sObj = (sr || []).find(s => s.code === code);
                if (cObj && sObj) {
                    const params = new URLSearchParams({ country_id: cObj.id, platform_id: sObj.id, limit: '5', page: '1' });
                    const products = await premiumFetch(`/catalog/products?${params.toString()}`);
                    providers = (products || []).map(p => ({
                        id: p.id, price: applyMarkup(premiumMoneyToIdr(p.price)), stock: p.available
                    }));
                }
            }

            if (providers.length === 0) {
                return renderMenu(ctx, '❌ Stok kosong.', Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'back_home')]]));
            }

            const buttons = providers.map(p => [Markup.button.callback(`${toRp(p.price)} (Stok: ${p.stock})`, `otp_buy_${server}_${code}_${country}_${p.id}`)]);
            buttons.push([Markup.button.callback('🏠 Menu', 'back_home')]);

            await renderMenu(ctx, `💰 <b>Pilih Harga</b>`, Markup.inlineKeyboard(buttons));
        } catch (e) {
            await renderMenu(ctx, `❌ Error: ${esc(e.message)}`, Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'back_home')]]));
        }
    });

    bot.action(/^otp_buy_(ekonomi|premium)_([^_]+)_([a-z]{2})_(.+)$/, async (ctx) => {
        const [, server, code, country, providerId] = ctx.match;
        const user = await getUserByTg(ctx.from.id);
        if (!user) return;

        await ctx.answerCbQuery('Memproses order...', { showAlert: true });

        try {
            let phone = null, price = 0, orderId = null;

            if (server === 'ekonomi') {
                const data = await dibananaFetch('/order', { method: 'POST', body: JSON.stringify({ id: providerId }) });
                if (!data || !data.order_id) throw new Error(data?.message || 'Gagal order');
                phone = data.phone_number;
                price = applyMarkup(Number(data.price_idr) || 0);
                orderId = String(data.order_id);
            } else {
                const data = await premiumFetch('/orders/create', { method: 'POST', body: JSON.stringify({ product_id: Number(providerId), quantity: 1 }) });
                const firstOrder = data?.orders?.[0];
                if (!firstOrder || !firstOrder.id) throw new Error('Gagal order premium');
                phone = firstOrder.phone_number;
                price = applyMarkup(premiumMoneyToIdr(firstOrder.amount));
                orderId = String(firstOrder.id);
            }

            const uRes = await pool.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [user.id]);
            const currentBalance = Number(uRes.rows[0].balance);
            if (currentBalance < price) {
                if (server === 'ekonomi') await dibananaFetch('/cancel', { method: 'POST', body: JSON.stringify({ order_id: orderId }) }).catch(() => {});
                else await premiumFetch('/orders/cancel', { method: 'POST', body: JSON.stringify({ id: Number(orderId) }) }).catch(() => {});
                throw new Error('Saldo tidak cukup. Silakan top up.');
            }

            const expAt = new Date(Date.now() + 15 * 60 * 1000);
            const otpId = `OTP${Date.now().toString().slice(-8)}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(
                    `INSERT INTO orders (user_id, order_id, otp_id, server, service, country, phone_number, price, status, expired_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9)`,
                    [user.id, orderId, otpId, server, code, country, phone, price, expAt]
                );
                await client.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [price, user.id]);
                await client.query('COMMIT');
            } catch (dbErr) {
                await client.query('ROLLBACK');
                throw new Error('DB error: ' + dbErr.message);
            } finally {
                client.release();
            }

            await renderMenu(ctx,
                `✅ <b>Order Berhasil!</b>\n\n<u>No. HP</u>: <code>${esc(phone)}</code>\n<u>Harga</u>: <code>${toRp(price)}</code>\n<u>Status</u>: Menunggu OTP\n\nCek /start untuk melihat OTP jika sudah masuk.`,
                Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'back_home')]])
            );
        } catch (e) {
            await ctx.reply(`❌ Order Gagal: ${esc(e.message)}`);
        }
    });

    // ==================== MENU DEPOSIT ====================
    bot.action('menu_deposit', async (ctx) => {
        const user = await getUserByTg(ctx.from.id);
        if (!user) return ctx.reply('Ketik /start untuk mendaftar.');
        
        const text = `💰 <b>Top Up Saldo</b>\n\nPilih nominal:`;
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Rp 5.000', 'dep_5000'), Markup.button.callback('Rp 10.000', 'dep_10000')],
            [Markup.button.callback('Rp 20.000', 'dep_20000'), Markup.button.callback('Rp 50.000', 'dep_50000')],
            [Markup.button.callback('🏠 Menu', 'back_home')],
        ]);
        await renderMenu(ctx, text, keyboard);
    });

    bot.action(/^dep_(\d+)$/, async (ctx) => {
        const amount = parseInt(ctx.match[1], 10);
        const user = await getUserByTg(ctx.from.id);
        if (!user) return;

        await ctx.answerCbQuery('Membuat QRIS...', { showAlert: true });

        try {
            // Catatan: Pastiin createDeposit di-export dari index.js
            if (!deps.createDeposit) throw new Error('Fitur deposit belum dikonfigurasi (createDeposit missing).');
            const data = await deps.createDeposit(amount);
            if (!data || !data.qr_image) throw new Error('Gagal membuat QRIS.');

            await renderMenu(ctx,
                `💳 <b>Topup QRIS</b>\n\n<u>ID</u>: <code>${esc(data.id)}</code>\n<u>Nominal</u>: <code>${toRp(data.diterima)}</code>\n\nScan QR di bawah:`,
                Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'back_home')]])
            );

            await ctx.replyWithPhoto({ url: data.qr_image }, { caption: `Scan QR di atas. Kadaluarsa dalam 15 menit.` });
        } catch (e) {
            await ctx.reply(`❌ Gagal: ${esc(e.message)}`);
        }
    });

    // ==================== MENU RIWAYAT ====================
    bot.action('menu_riwayat', async (ctx) => {
        const user = await getUserByTg(ctx.from.id);
        if (!user) return ctx.reply('Ketik /start untuk mendaftar.');
        
        const orders = await pool.query(`SELECT otp_id, service, phone_number, otp_code, status, price, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`, [user.id]);
        if (orders.rows.length === 0) return renderMenu(ctx, '📋 Belum ada riwayat order.', Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'back_home')]]));

        let text = `📋 <b>Riwayat Order Terakhir</b>\n\n`;
        orders.rows.forEach(o => {
            text += `• <code>${esc(o.service || '-')}</code> | ${esc(o.phone_number || '-')}\n  Status: ${o.otp_code ? '✅ ' + o.otp_code : o.status}\n  Harga: ${toRp(o.price)}\n\n`;
        });
        await renderMenu(ctx, text, Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'back_home')]]));
    });

    // ==================== MENU BANTUAN ====================
    bot.action('menu_bantuan', async (ctx) => {
        await renderMenu(ctx, `❓ <b>Bantuan</b>\n\nHubungi admin: @asyrofc`, Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'back_home')]]));
    });

    // ==================== MENU LOGOUT ====================
    bot.action('menu_logout', async (ctx) => {
        const user = await getUserByTg(ctx.from.id);
        if (!user) return;
        await pool.query(`UPDATE users SET telegram_id = NULL, telegram_username = NULL, telegram_linked_at = NULL WHERE id = $1`, [user.id]);
        await renderMenu(ctx, '🚪 Akun Telegram berhasil di-logout.', Markup.inlineKeyboard([[Markup.button.callback('🏠 Menu', 'back_home')]]));
    });

    bot.action('back_home', async (ctx) => {
        botState.delete(ctx.from.id);
        ctx.startPayload = '';
        bot.start(ctx);
    });

    // ==================== HANDLE TEXT INPUT (PASSWORD) ====================
    bot.on('text', async (ctx) => {
        const state = botState.get(ctx.from.id);
        if (!state || state.step !== 'reg_pass') return;

        const text = ctx.message.text.trim();
        if (text.startsWith('/')) return;

        if (text.length < 6) {
            return ctx.reply('❌ Password minimal 6 karakter. Coba lagi:');
        }

        botState.delete(ctx.from.id);

        try {
            const tgUsername = ctx.from.username ? ctx.from.username.toLowerCase() : `tg_${ctx.from.id}`;
            const name = ctx.from.first_name || 'Telegram User';
            const hash = await bcrypt.hash(text, 10);
            
            let candidate = tgUsername;
            let isExist = await pool.query('SELECT 1 FROM users WHERE username = $1', [candidate]);
            if (isExist.rows.length > 0) {
                candidate = `tg_${ctx.from.id}_${Math.floor(Math.random()*1000)}`;
            }

            await pool.query(
                `INSERT INTO users (username, name, password_hash, telegram_id, telegram_username) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [candidate, name, hash, ctx.from.id, ctx.from.username || null]
            );

            await ctx.reply('✅ Akun berhasil dibuat dan ditautkan! Ketik /start untuk mulai.');
            ctx.startPayload = '';
            bot.start(ctx);

        } catch (err) {
            console.error('Register TG error:', err.message);
            await ctx.reply('❌ Gagal membuat akun. Silakan coba lagi nanti.');
        }
    });

    // ==================== WEBHOOK ROUTE ====================
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
        const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
        });
        res.json({ telegram: await r.json(), webhook_url: url });
    });

    return bot;
};
