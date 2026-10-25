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

    // Sesuaikan dengan nama bot lo
    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    const BOT_USERNAME = 'otpmurahsxrfbot';
    const FIRE = '5104841245755180586';

    // ==================== HELPERS ====================
    const toRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
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

    // ==================== START ====================
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
                await ctx.reply(`[ SUKSES ]\n\nAkun Telegram berhasil ditautkan ke akun <b>@${esc(decoded.username)}</b>.\nKetik /start untuk mulai.`, { parse_mode: 'HTML' });
                return;
            } catch (e) {
                await ctx.reply('[ GAGAL ]\n\nSesi login dari web sudah expired. Silakan login manual.');
            }
        }

        const user = await getUserByTg(ctx.from.id);
        
        if (!user) {
            const text = 
                `<b>ASyrofOTP BOT</b>\n\n` +
                `Selamat datang. Kamu belum login ke sistem kami.\n` +
                `Silakan klik tombol di bawah untuk masuk menggunakan akun AsyrofOTP kamu.`;
            const keyboard = Markup.inlineKeyboard([
                [Markup.button.callback('Login Manual', 'login_start')]
            ]);
            await renderMenu(ctx, text, keyboard);
            return;
        }

        if (user.status === 'banned') {
            return ctx.reply('[ DIBLOKIR ]\n\nAkun kamu diblokir dari sistem.');
        }

        const text =
            `<b>ASyrofOTP BOT</b>\n\n` +
            `ID Akun  : <code>${esc(user.user_code || user.id)}</code>\n` +
            `Username : <code>@${esc(user.username)}</code>\n` +
            `Saldo    : <b>${toRp(user.balance)}</b>\n\n` +
            `Silakan pilih menu di bawah:`;

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Beli Nokos', 'menu_otp'), Markup.button.callback('Top Up Saldo', 'menu_deposit')],
            [Markup.button.callback('Riwayat Order', 'menu_riwayat'), Markup.button.callback('Bantuan', 'menu_bantuan')],
            [Markup.button.callback('Logout', 'menu_logout')],
        ]);

        await renderMenu(ctx, text, keyboard);
    });

    // ==================== LOGIN MANUAL ====================
    bot.action('login_start', async (ctx) => {
        botState.set(ctx.from.id, { step: 'login_user' });
        await renderMenu(ctx, 
            `<b>LOGIN MANUAL</b>\n\nSilakan ketik <b>Username</b> atau <b>Email</b> akun AsyrofOTP kamu:`, 
            Markup.inlineKeyboard([[Markup.button.callback('Batal', 'back_home')]])
        );
    });

    bot.on('text', async (ctx) => {
        const state = botState.get(ctx.from.id);
        if (!state) return;

        const text = ctx.message.text.trim();
        if (text.startsWith('/')) return;

        if (state.step === 'login_user') {
            state.username = text;
            state.step = 'login_pass';
            botState.set(ctx.from.id, state);
            await ctx.reply('<b>PASSWORD</b>\n\nSekarang ketik <b>Password</b> kamu:', { parse_mode: 'HTML' });
            return;
        }

        if (state.step === 'login_pass') {
            const password = text;
            botState.delete(ctx.from.id);

            try {
                const r = await pool.query(
                    'SELECT id, username, password_hash FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1',
                    [state.username]
                );
                if (r.rows.length === 0) throw new Error('Username/Email tidak ditemukan');

                const user = r.rows[0];
                const valid = await bcrypt.compare(password, user.password_hash);
                if (!valid) throw new Error('Password salah');

                const check = await pool.query('SELECT id FROM users WHERE telegram_id = $1 AND id != $2 LIMIT 1', [ctx.from.id, user.id]);
                if (check.rows.length > 0) throw new Error('Telegram ini sudah tertaut ke akun lain.');

                await pool.query(
                    `UPDATE users SET telegram_id = $1, telegram_username = $2, telegram_linked_at = NOW(), updated_at = NOW() WHERE id = $3`,
                    [ctx.from.id, ctx.from.username || null, user.id]
                );

                await ctx.reply('[ SUKSES ]\n\nLogin berhasil. Ketik /start untuk mulai.');
            } catch (err) {
                await ctx.reply(`[ GAGAL ]\n\n${esc(err.message)}\n\nKetik /start untuk coba lagi.`);
            }
        }
    });

    // ==================== MENU OTP ====================
    bot.action('menu_otp', async (ctx) => {
        const user = await getUserByTg(ctx.from.id);
        if (!user) return ctx.reply('Ketik /start untuk login.');
        
        const text = `<b>BELI NOKOS</b>\n\nPilih server yang tersedia:`;
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Server 1 (Ekonomi)', 'otp_srv_ekonomi')],
            [Markup.button.callback('Server 2 (Premium)', 'otp_srv_premium')],
            [Markup.button.callback('Kembali ke Menu', 'back_home')],
        ]);
        await renderMenu(ctx, text, keyboard);
    });

    bot.action(/^otp_srv_(ekonomi|premium)$/, async (ctx) => {
        const server = ctx.match[1];
        const user = await getUserByTg(ctx.from.id);
        if (!user) return;

        await ctx.answerCbQuery('Memuat layanan...');

        try {
            let services = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch('/services?server=ekonomi');
                services = (data.services || []).slice(0, 15).map(s => ({ code: s.code, name: s.name }));
            } else {
                const raw = await premiumFetch('/catalog/services');
                services = (raw || []).slice(0, 15).map(s => ({ code: s.code, name: s.name }));
            }

            if (services.length === 0) return renderMenu(ctx, '[ KOSONG ]\n\nTidak ada layanan tersedia.', Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));

            const buttons = [];
            for (let i = 0; i < services.length; i += 2) {
                const row = [Markup.button.callback(services[i].name, `otp_svc_${server}_${services[i].code}`)];
                if (services[i + 1]) row.push(Markup.button.callback(services[i + 1].name, `otp_svc_${server}_${services[i + 1].code}`));
                buttons.push(row);
            }
            buttons.push([Markup.button.callback('Kembali', 'back_home')]);

            await renderMenu(ctx, `<b>PILIH LAYANAN</b>\n\nServer: ${server === 'ekonomi' ? 'Ekonomi' : 'Premium'}`, Markup.inlineKeyboard(buttons));
        } catch (e) {
            await renderMenu(ctx, `[ ERROR ]\n\n${esc(e.message)}`, Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));
        }
    });

    bot.action(/^otp_svc_(ekonomi|premium)_(.+)$/, async (ctx) => {
        const [, server, code] = ctx.match;
        const user = await getUserByTg(ctx.from.id);
        if (!user) return;

        await ctx.answerCbQuery('Memuat negara...');

        try {
            let countries = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch(`/countries?server=ekonomi&service=${encodeURIComponent(code)}`);
                countries = (data.countries || []).slice(0, 15);
            } else {
                const countriesRaw = await premiumFetch('/catalog/countries');
                countries = (countriesRaw || []).slice(0, 15).map(c => ({ code: c.code, name: c.name }));
            }

            if (countries.length === 0) return renderMenu(ctx, '[ KOSONG ]\n\nTidak ada negara tersedia.', Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));

            const buttons = [];
            for (let i = 0; i < countries.length; i += 2) {
                const row = [Markup.button.callback(countries[i].name || countries[i].code, `otp_cty_${server}_${code}_${countries[i].code}`)];
                if (countries[i + 1]) row.push(Markup.button.callback(countries[i + 1].name || countries[i + 1].code, `otp_cty_${server}_${code}_${countries[i + 1].code}`));
                buttons.push(row);
            }
            buttons.push([Markup.button.callback('Kembali', 'back_home')]);

            await renderMenu(ctx, `<b>PILIH NEGARA</b>`, Markup.inlineKeyboard(buttons));
        } catch (e) {
            await renderMenu(ctx, `[ ERROR ]\n\n${esc(e.message)}`, Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));
        }
    });

    bot.action(/^otp_cty_(ekonomi|premium)_([^_]+)_([a-z]{2})$/, async (ctx) => {
        const [, server, code, country] = ctx.match;
        const user = await getUserByTg(ctx.from.id);
        if (!user) return;

        await ctx.answerCbQuery('Memuat harga...');

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

            if (providers.length === 0) return renderMenu(ctx, '[ KOSONG ]\n\nStok habis di negara ini.', Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));

            const buttons = providers.map(p => [Markup.button.callback(`${toRp(p.price)} - Stok ${p.stock}`, `otp_buy_${server}_${code}_${country}_${p.id}`)]);
            buttons.push([Markup.button.callback('Kembali', 'back_home')]);

            await renderMenu(ctx, `<b>PILIH HARGA</b>`, Markup.inlineKeyboard(buttons));
        } catch (e) {
            await renderMenu(ctx, `[ ERROR ]\n\n${esc(e.message)}`, Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));
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
                throw new Error('Saldo tidak cukup. Silakan top up terlebih dahulu.');
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
                `<b>ORDER BERHASIL</b>\n\n` +
                `Nomor HP : <code>${esc(phone)}</code>\n` +
                `Harga    : <b>${toRp(price)}</b>\n` +
                `Status   : Menunggu OTP\n\n` +
                `Silakan cek menu utama secara berkala untuk melihat kode OTP.`,
                Markup.inlineKeyboard([[Markup.button.callback('Menu Utama', 'back_home')]])
            );
        } catch (e) {
            await ctx.reply(`[ GAGAL ]\n\n${esc(e.message)}`);
        }
    });

    // ==================== MENU DEPOSIT ====================
    bot.action('menu_deposit', async (ctx) => {
        const user = await getUserByTg(ctx.from.id);
        if (!user) return ctx.reply('Ketik /start untuk login.');
        
        const text = `<b>TOP UP SALDO</b>\n\nPilih nominal:`;
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('Rp 5.000', 'dep_5000'), Markup.button.callback('Rp 10.000', 'dep_10000')],
            [Markup.button.callback('Rp 20.000', 'dep_20000'), Markup.button.callback('Rp 50.000', 'dep_50000')],
            [Markup.button.callback('Kembali ke Menu', 'back_home')],
        ]);
        await renderMenu(ctx, text, keyboard);
    });

    bot.action(/^dep_(\d+)$/, async (ctx) => {
        const amount = parseInt(ctx.match[1], 10);
        const user = await getUserByTg(ctx.from.id);
        if (!user) return;

        await ctx.answerCbQuery('Membuat QRIS...', { showAlert: true });

        try {
            if (!deps.createDeposit) throw new Error('Fitur deposit belum dikonfigurasi.');
            const data = await deps.createDeposit(amount);
            if (!data || !data.qr_image) throw new Error('Gagal membuat QRIS.');

            await renderMenu(ctx,
                `<b>TOP UP QRIS</b>\n\n` +
                `ID      : <code>${esc(data.id)}</code>\n` +
                `Nominal : <b>${toRp(data.diterima)}</b>\n\n` +
                `Silakan scan QR di bawah ini:`,
                Markup.inlineKeyboard([[Markup.button.callback('Kembali ke Menu', 'back_home')]])
            );

            await ctx.replyWithPhoto({ url: data.qr_image }, { caption: `QRIS ini berlaku selama 15 menit.` });
        } catch (e) {
            await ctx.reply(`[ GAGAL ]\n\n${esc(e.message)}`);
        }
    });

    // ==================== MENU RIWAYAT ====================
    bot.action('menu_riwayat', async (ctx) => {
        const user = await getUserByTg(ctx.from.id);
        if (!user) return ctx.reply('Ketik /start untuk login.');
        
        const orders = await pool.query(`SELECT otp_id, service, phone_number, otp_code, status, price, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`, [user.id]);
        if (orders.rows.length === 0) return renderMenu(ctx, '[ KOSONG ]\n\nBelum ada riwayat order.', Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));

        let text = `<b>RIWAYAT ORDER (5 TERAKHIR)</b>\n\n`;
        orders.rows.forEach(o => {
            text += `Layanan : ${esc(o.service || '-')}\n`;
            text += `Nomor   : ${esc(o.phone_number || '-')}\n`;
            text += `Status  : ${o.otp_code ? o.otp_code : o.status}\n`;
            text += `Harga   : ${toRp(o.price)}\n`;
            text += `------------------------\n`;
        });
        await renderMenu(ctx, text, Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));
    });

    // ==================== MENU BANTUAN ====================
    bot.action('menu_bantuan', async (ctx) => {
        await renderMenu(ctx, `<b>BANTUAN</b>\n\nJika ada kendala, silakan hubungi admin di @asyrofc.`, Markup.inlineKeyboard([[Markup.button.callback('Kembali', 'back_home')]]));
    });

    // ==================== MENU LOGOUT ====================
    bot.action('menu_logout', async (ctx) => {
        const user = await getUserByTg(ctx.from.id);
        if (!user) return;
        await pool.query(`UPDATE users SET telegram_id = NULL, telegram_username = NULL, telegram_linked_at = NULL WHERE id = $1`, [user.id]);
        await renderMenu(ctx, '[ SUKSES ]\n\nKamu berhasil logout dari bot ini.', Markup.inlineKeyboard([[Markup.button.callback('Kembali ke Menu', 'back_home')]]));
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
