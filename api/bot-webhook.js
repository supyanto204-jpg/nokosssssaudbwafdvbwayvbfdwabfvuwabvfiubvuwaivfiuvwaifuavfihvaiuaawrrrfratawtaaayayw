const { Telegraf, Markup } = require('telegraf');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
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
    const BOT_USERNAME = 'otpmurahsxrfbot';
    const FIRE = '5104841245755180586';

    // ==================== HELPERS ====================
    const toRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    const botState = new Map();

    async function getOrCreateUser(ctx) {
        const tgId = ctx.from.id;
        let r = await pool.query(
            'SELECT id, username, name, balance, user_code, role, status, telegram_id FROM users WHERE telegram_id = $1 LIMIT 1',
            [tgId]
        );
        
        if (r.rows.length > 0) return r.rows[0];

        let baseUsername = ctx.from.username ? ctx.from.username.toLowerCase() : `tg_${tgId}`;
        baseUsername = baseUsername.replace(/[^a-z0-9_]/g, '').slice(0, 16) || `tg_${tgId}`;
        
        const name = ctx.from.first_name || ctx.from.last_name || 'Telegram User';
        const randomHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
        
        let candidate = baseUsername;
        let isExist = await pool.query('SELECT 1 FROM users WHERE username = $1', [candidate]);
        
        if (isExist.rows.length > 0) {
            candidate = `${baseUsername}_${crypto.randomBytes(2).toString('hex')}`;
        }

        r = await pool.query(
            `INSERT INTO users (username, name, password_hash) 
             VALUES ($1, $2, $3) RETURNING id, username, name, balance, user_code, role, status`,
            [candidate, name, randomHash]
        );
        
        return r.rows[0];
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

    // ==================== START ====================
    bot.start(async (ctx) => {
        const payload = ctx.startPayload || '';
        
        if (payload.startsWith('link_')) {
            const tokenPayload = payload.replace(/^link_/, '');
            try {
                const decoded = jwt.verify(tokenPayload, process.env.JWT_SECRET);
                await pool.query(
                    `UPDATE users SET telegram_id = $1, telegram_username = $2, telegram_linked_at = NOW() WHERE id = $3`,
                    [ctx.from.id, ctx.from.username || null, decoded.id]
                );
                await ctx.reply(`Akun Telegram ditautkan ke akun <b>@${esc(decoded.username)}</b>.\nKetik /start untuk mulai.`, { parse_mode: 'HTML' });
                return;
            } catch (e) {
                await ctx.reply('Sesi login dari web expired. Lanjutkan tanpa login.');
            }
        }

        const user = await getOrCreateUser(ctx);
        if (user.status === 'banned') return ctx.reply('Akun diblokir.');

        const text =
            `<b>ASyrofOTP BOT</b>\n\n` +
            `ID: <code>${esc(user.user_code || user.id)}</code>\n` +
            `Username: <code>@${esc(user.username)}</code>\n` +
            `Nama: <code>${esc(user.name)}</code>\n` +
            `Saldo: <b>${toRp(user.balance)}</b>\n\n` +
            `Pilih menu:`;

        const buttons = [
            [Markup.button.callback('Beli Nokos', 'menu_otp'), Markup.button.callback('Top Up Saldo', 'menu_deposit')],
            [Markup.button.callback('Riwayat Order', 'menu_riwayat'), Markup.button.callback('Bantuan', 'menu_bantuan')]
        ];

        if (!user.telegram_linked_at) {
            buttons.push([Markup.button.callback('Tautkan Akun Web', 'link_web')]);
        } else {
            buttons.push([Markup.button.callback('Logout', 'menu_logout')]);
        }

        await renderMenu(ctx, text, Markup.inlineKeyboard(buttons));
    });

    // ==================== ALUR TAUTKAN ====================
    bot.action('link_web', async (ctx) => {
        const url = `https://asyrofotp.vercel.app/link-telegram?tg_id=${ctx.from.id}&tg_username=${ctx.from.username || ''}&merge=true`;
        
        await renderMenu(ctx, 
            `Tautkan Akun Web\n\n` +
            `Kamu memakai akun Guest (dari Telegram).\n` +
            `Jika ditautkan, saldo dan riwayat akan digabung.\n\n` +
            `Klik tombol di bawah:`, 
            Markup.inlineKeyboard([
                [Markup.button.url('Buka Web Tautkan', url)],
                [Markup.button.callback('Kembali', 'back_home')]
            ])
        );
    });

    // ==================== MENU OTP ====================
    bot.action('menu_otp', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (user.status === 'banned') return ctx.reply('Akun diblokir.');
        
        const text = `Beli Nokos\n\nPilih server:`;
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Server 1 (Ekonomi)', 'otp_srv_ekonomi')],
            [Markup.button.callback('Server 2 (Premium)', 'otp_srv_premium')],
            [Markup.button.callback('Kembali ke Menu', 'back_home')],
        ]);
        await renderMenu(ctx, text, keyboard);
    });

    bot.action(/^otp_srv_(ekonomi|premium)$/, async (ctx) => {
        const server = ctx.match[1];
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        await ctx.answerCbQuery('Memuat...');

        try {
            let services = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch('/services?server=ekonomi');
                services = (data.services || []).slice(0, 15).map(s => ({ code: s.code, name: s.name }));
            } else {
                const raw = await premiumFetch('/catalog/services');
                services = (raw || []).slice(0, 15).map(s => ({ code: s.code, name: s.name }));
            }

            if (services.length === 0) return renderMenu(ctx, 'Tidak ada layanan.', Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));

            const buttons = [];
            for (let i = 0; i < services.length; i += 2) {
                const row = [Markup.button.callback(services[i].name, `otp_svc_${server}_${services[i].code}`)];
                if (services[i + 1]) row.push(Markup.button.callback(services[i + 1].name, `otp_svc_${server}_${services[i + 1].code}`));
                buttons.push(row);
            }
            buttons.push([Markup.button.callback('Kembali', 'back_home')]);

            await renderMenu(ctx, `Pilih Layanan\nServer: ${server === 'ekonomi' ? '1' : '2'}`, Markup.inlineKeyboard(buttons));
        } catch (e) {
            await renderMenu(ctx, `Error: ${esc(e.message)}`, Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));
        }
    });

    bot.action(/^otp_svc_(ekonomi|premium)_(.+)$/, async (ctx) => {
        const [, server, code] = ctx.match;
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        await ctx.answerCbQuery('Memuat...');

        try {
            let countries = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch(`/countries?server=ekonomi&service=${encodeURIComponent(code)}`);
                countries = (data.countries || []).slice(0, 15);
            } else {
                const countriesRaw = await premiumFetch('/catalog/countries');
                countries = (countriesRaw || []).slice(0, 15).map(c => ({ code: c.code, name: c.name }));
            }

            if (countries.length === 0) return renderMenu(ctx, 'Tidak ada negara.', Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));

            const buttons = [];
            for (let i = 0; i < countries.length; i += 2) {
                const row = [Markup.button.callback(countries[i].name || countries[i].code, `otp_cty_${server}_${code}_${countries[i].code}`)];
                if (countries[i + 1]) row.push(Markup.button.callback(countries[i + 1].name || countries[i + 1].code, `otp_cty_${server}_${code}_${countries[i + 1].code}`));
                buttons.push(row);
            }
            buttons.push([Markup.button.callback('Kembali', 'back_home')]);

            await renderMenu(ctx, `Pilih Negara`, Markup.inlineKeyboard(buttons));
        } catch (e) {
            await renderMenu(ctx, `Error: ${esc(e.message)}`, Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));
        }
    });

    bot.action(/^otp_cty_(ekonomi|premium)_([^_]+)_([a-z]{2})$/, async (ctx) => {
        const [, server, code, country] = ctx.match;
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        await ctx.answerCbQuery('Memuat...');

        try {
            let providers = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch(`/prices?server=ekonomi&service=${encodeURIComponent(code)}&country=${encodeURIComponent(country)}`);
                providers = (data.providers || []).slice(0, 5).map(p => ({ id: p.id, price: applyMarkup(Number(p.price_idr) || 0), stock: p.stock }));
            } else {
                const [cr, sr] = await Promise.all([premiumFetch('/catalog/countries'), premiumFetch('/catalog/services')]);
                const cObj = (cr || []).find(c => c.code === country);
                const sObj = (sr || []).find(s => s.code === code);
                if (cObj && sObj) {
                    const params = new URLSearchParams({ country_id: cObj.id, platform_id: sObj.id, limit: '5', page: '1' });
                    const products = await premiumFetch(`/catalog/products?${params.toString()}`);
                    providers = (products || []).map(p => ({ id: p.id, price: applyMarkup(premiumMoneyToIdr(p.price)), stock: p.available }));
                }
            }

            if (providers.length === 0) return renderMenu(ctx, 'Stok habis.', Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));

            const buttons = providers.map(p => [Markup.button.callback(`${toRp(p.price)} | Stok ${p.stock}`, `otp_buy_${server}_${code}_${country}_${p.id}`)]);
            buttons.push([Markup.button.callback('Kembali', 'back_home')]);

            await renderMenu(ctx, `Pilih Harga`, Markup.inlineKeyboard(buttons));
        } catch (e) {
            await renderMenu(ctx, `Error: ${esc(e.message)}`, Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));
        }
    });

    bot.action(/^otp_buy_(ekonomi|premium)_([^_]+)_([a-z]{2})_(.+)$/, async (ctx) => {
        const [, server, code, country, providerId] = ctx.match;
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        await ctx.answerCbQuery('Proses...', { showAlert: true });

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
                throw new Error('Saldo kurang.');
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
                `Order Berhasil\n\n` +
                `Nomor: <code>${esc(phone)}</code>\n` +
                `Harga: <b>${toRp(price)}</b>\n` +
                `Status: Menunggu OTP\n\n` +
                `Cek menu utama untuk kode OTP.`,
                Markup.inlineKeyboard([[Markup.button.callback('Menu Utama', 'back_home')]])
            );
        } catch (e) {
            await ctx.reply(`Gagal: ${esc(e.message)}`);
        }
    });

    // ==================== MENU DEPOSIT ====================
    bot.action('menu_deposit', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (!user) return;
        
        const text = `Top Up Saldo\n\nPilih nominal:`;
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Rp 5.000', 'dep_5000'), Markup.button.callback('Rp 10.000', 'dep_10000')],
            [Markup.button.callback('Rp 20.000', 'dep_20000'), Markup.button.callback('Rp 50.000', 'dep_50000')],
            [Markup.button.callback('Kembali ke Menu', 'back_home')],
        ]);
        await renderMenu(ctx, text, keyboard);
    });

    bot.action(/^dep_(\d+)$/, async (ctx) => {
        const amount = parseInt(ctx.match[1], 10);
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        await ctx.answerCbQuery('Membuat QRIS...', { showAlert: true });

        try {
            if (!deps.createDeposit) throw new Error('Fitur deposit belum dikonfigurasi.');
            const data = await deps.createDeposit(amount);
            if (!data || !data.qr_image) throw new Error('Gagal membuat QRIS.');

            await renderMenu(ctx,
                `Top Up QRIS\n\n` +
                `ID: <code>${esc(data.id)}</code>\n` +
                `Nominal: <b>${toRp(data.diterima)}</b>\n\n` +
                `Scan QR di bawah ini:`,
                Markup.inlineKeyboard([[Markup.button.callback('Kembali ke Menu', 'back_home')]])
            );

            await ctx.replyWithPhoto({ url: data.qr_image }, { caption: `QRIS berlaku 15 menit.` });
        } catch (e) {
            await ctx.reply(`Gagal: ${esc(e.message)}`);
        }
    });

    // ==================== MENU RIWAYAT ====================
    bot.action('menu_riwayat', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (!user) return;
        
        const orders = await pool.query(`SELECT otp_id, service, phone_number, otp_code, status, price, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`, [user.id]);
        if (orders.rows.length === 0) return renderMenu(ctx, 'Belum ada riwayat.', Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));

        let text = `Riwayat 5 Terakhir\n\n`;
        orders.rows.forEach(o => {
            text += `Layanan: ${esc(o.service || '-')}\n`;
            text += `Nomor: ${esc(o.phone_number || '-')}\n`;
            text += `Status: ${o.otp_code ? o.otp_code : o.status}\n`;
            text += `Harga: ${toRp(o.price)}\n`;
            text += `------------------------\n`;
        });
        await renderMenu(ctx, text, Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));
    });

    // ==================== MENU BANTUAN ====================
    bot.action('menu_bantuan', async (ctx) => {
        await renderMenu(ctx, `Bantuan\n\nHubungi admin: @asyrofc`, Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));
    });

    // ==================== MENU LOGOUT ====================
    bot.action('menu_logout', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (!user) return;
        await pool.query(`UPDATE users SET telegram_id = NULL, telegram_username = NULL, telegram_linked_at = NULL WHERE id = $1`, [user.id]);
        await renderMenu(ctx, 'Logout berhasil.', Markup.inlineKeyboard([[Markup.button.callback('Kembali ke Menu', 'back_home')]]));
    });

    bot.action('back_home', async (ctx) => {
        botState.delete(ctx.from.id);
        ctx.startPayload = '';
        bot.start(ctx);
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
