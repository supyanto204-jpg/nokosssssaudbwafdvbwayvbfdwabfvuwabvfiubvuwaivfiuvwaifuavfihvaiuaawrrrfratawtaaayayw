const { Telegraf, Markup } = require('telegraf');
const crypto = require('crypto');

module.exports = function setupBotWebhook(app, deps) {
    const {
        pool, withDB, requireAuth,
        dibananaFetch, premiumFetch, premiumMoneyToIdr, applyMarkup,
        providerOrderStatus, providerCancelOrder,
        notifyOtpSuccess, notifyDepositSuccess,
        calculateDepositFee, COUNTRY_NAMES, SERVER_CONFIG, markDepositPaid,
        cancelDeposit: qrispyCancel, createDeposit: qrispyCreate,
        checkDepositStatus: qrispyCheck,
    } = deps;

    const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'asyrofotp_bot';
    const FIRE = '5104841245755180586';

    // ==================== HELPERS ====================
    const toRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const fmtDate = (d) => new Date(d).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit',
        year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    async function getUserByTg(tgId) {
        const r = await pool.query(
            'SELECT id, username, name, balance, user_code, role, status FROM users WHERE telegram_id = $1 LIMIT 1',
            [tgId]
        );
        return r.rows[0] || null;
    }

    async function requireLinked(ctx) {
        const user = await getUserByTg(ctx.from.id);
        if (!user) {
            const linkUrl = `https://asyrofotp.vercel.app/link-telegram`;
            await ctx.reply(
                `🔗 <b>Akun belum tertaut</b>\n\n` +
                `Buka tautan berikut untuk menghubungkan akun Telegram kamu:\n${linkUrl}`,
                { parse_mode: 'HTML', disable_web_page_preview: true }
            );
            return null;
        }
        if (user.status === 'banned') {
            await ctx.reply('❌ Akun kamu diblokir.');
            return null;
        }
        return user;
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
        const arg = payload.split('_')[0];
        const tokenPayload = payload.replace(/^link_/, '');

        // Kalau datang dari link-telegram.html, token = JWT user
        if (tokenPayload && tokenPayload !== payload) {
            // Skenario linking: user udah login di web, buka bot, bot minta konfirmasi
            try {
                const jwt = require('jsonwebtoken');
                const decoded = jwt.verify(tokenPayload, process.env.JWT_SECRET);
                // Simpan sementara di tabel sessions/redis? Gampangnya: simpan di Map memory per-chat
                // Biar aman: kirim pesan konfirmasi dengan tombol, lalu saat diklik, link
                pendingLink.set(ctx.from.id, decoded.id);
                await ctx.reply(
                    `🔗 <b>Konfirmasi Tautkan</b>\n\n` +
                    `Login sebagai <b>@${esc(decoded.username)}</b>.\n` +
                    `Klik tombol di bawah untuk menautkan akun ini:`,
                    {
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '✅ Tautkan', callback_data: 'do_link' },
                                { text: '❌ Batal', callback_data: 'cancel_link' }
                            ]]
                        }
                    }
                );
                return;
            } catch (e) {
                await ctx.reply('❌ Sesi login kamu sudah expired. Buka web lagi.');
                return;
            }
        }

        const user = await requireLinked(ctx);
        if (!user) return;

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

    // Memory: pending link (chat_id -> user_id)
    const pendingLink = new Map();

    bot.action('do_link', async (ctx) => {
        const userId = pendingLink.get(ctx.from.id);
        if (!userId) return ctx.answerCbQuery('❌ Sesi kadaluarsa', { showAlert: true });

        try {
            const existing = await pool.query(
                'SELECT id, username FROM users WHERE telegram_id = $1 AND id != $2 LIMIT 1',
                [ctx.from.id, userId]
            );
            if (existing.rows.length > 0) {
                await ctx.answerCbQuery('Telegram ini sudah tertaut ke akun lain', { showAlert: true });
                pendingLink.delete(ctx.from.id);
                return;
            }

            const tgUsername = ctx.from.username || null;
            await pool.query(
                `UPDATE users SET telegram_id = $1, telegram_username = $2,
                    telegram_linked_at = NOW(), updated_at = NOW()
                 WHERE id = $3`,
                [ctx.from.id, tgUsername, userId]
            );
            pendingLink.delete(ctx.from.id);
            await ctx.answerCbQuery('✅ Berhasil', { showAlert: true });
            await ctx.editMessageText(`✅ Akun Telegram kamu berhasil ditautkan.\n\nKetik /start untuk mulai.`);
        } catch (e) {
            console.error('do_link error:', e.message);
            await ctx.answerCbQuery('❌ Gagal menautkan', { showAlert: true });
        }
    });

    bot.action('cancel_link', async (ctx) => {
        pendingLink.delete(ctx.from.id);
        await ctx.editMessageText('❌ Penautan dibatalkan.');
    });

    // ==================== MENU: OTP ====================
    bot.action('menu_otp', async (ctx) => {
        const user = await requireLinked(ctx);
        if (!user) return;

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
        const user = await requireLinked(ctx);
        if (!user) return;

        try {
            let services = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch('/services?server=ekonomi');
                services = (data.services || []).slice(0, 10).map(s => ({
                    code: s.code, name: s.name, price: applyMarkup(Number(s.price_idr) || 0)
                }));
            } else {
                const raw = await premiumFetch('/catalog/services');
                services = (raw || []).slice(0, 10).map(s => ({
                    code: s.code, name: s.name, price: 0
                }));
            }

            if (services.length === 0) {
                return renderMenu(ctx, '❌ Tidak ada layanan tersedia.', Markup.inlineKeyboard([
                    [Markup.button.callback('🏠 Menu', 'back_home')]
                ]));
            }

            const buttons = services.map(s => [Markup.button.callback(
                `${s.name}${s.price ? ' - ' + toRp(s.price) : ''}`,
                `otp_svc_${server}_${s.code}`
            )]);
            buttons.push([Markup.button.callback('🏠 Menu', 'back_home')]);

            await renderMenu(
                ctx,
                `📱 <b>Pilih Layanan — Server ${server === 'ekonomi' ? '1' : '2'}</b>`,
                Markup.inlineKeyboard(buttons)
            );
        } catch (e) {
            await renderMenu(ctx, `❌ Error: ${esc(e.message)}`, Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Menu', 'back_home')]
            ]));
        }
    });

    bot.action(/^otp_svc_(ekonomi|premium)_(.+)$/, async (ctx) => {
        const [, server, code] = ctx.match;
        const user = await requireLinked(ctx);
        if (!user) return;

        try {
            let countries = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch(`/countries?server=ekonomi&service=${encodeURIComponent(code)}`);
                countries = (data.countries || []).slice(0, 10);
            } else {
                const countriesRaw = await premiumFetch('/catalog/countries');
                countries = (countriesRaw || []).slice(0, 10).map(c => ({ code: c.code, name: c.name }));
            }

            if (countries.length === 0) {
                return renderMenu(ctx, '❌ Tidak ada negara tersedia.', Markup.inlineKeyboard([
                    [Markup.button.callback('🏠 Menu', 'back_home')]
                ]));
            }

            const buttons = countries.map(c => [Markup.button.callback(
                `${c.name || c.code}`,
                `otp_cty_${server}_${code}_${c.code}`
            )]);
            buttons.push([Markup.button.callback('🏠 Menu', 'back_home')]);

            await renderMenu(ctx, `🌍 <b>Pilih Negara</b>`, Markup.inlineKeyboard(buttons));
        } catch (e) {
            await renderMenu(ctx, `❌ Error: ${esc(e.message)}`, Markup.inlineKeyboard([
                [Markup.button.callback('🏠 Menu', 'back_home')]
            ]));
        }
    });

    // ... (lanjutan: prices, preview, konfirmasi order, deposit, riwayat, bantuan, logout)
    // Bagian ini panjang. Simpan di file yang sama, gw lanjutkan di bawah.

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
        if (req.query.secret !== process.env.CRON_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const baseUrl = process.env.BASE_URL || 'https://asyrofotp.vercel.app';
        const url = `${baseUrl}/api/botwebhook`;
        const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        res.json({ telegram: await r.json(), webhook_url: url });
    });

    return bot;
};
