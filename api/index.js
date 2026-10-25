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

    // === FUNGSI RAW API BUAT RICH MESSAGE ===
    // Hapus pesan lama, kirim pesan baru (buat navigasi Kembali)
    async function sendNewRich(ctx, html, buttons) {
        try { await ctx.deleteMessage(); } catch (e) {}
        await sendRich(ctx, html, buttons, false);
    }

    async function sendRich(ctx, html, buttons, isEdit = false) {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const url = isEdit 
            ? `https://api.telegram.org/bot${token}/editMessageText`
            : `https://api.telegram.org/bot${token}/sendRichMessage`;

        const payload = {
            chat_id: ctx.chat.id,
            rich_message: { html: html }
        };

        if (buttons && buttons.length > 0) {
            payload.reply_markup = { inline_keyboard: buttons };
        }

        if (isEdit) {
            payload.message_id = ctx.callbackQuery.message.message_id;
        } else {
            payload.message_effect_id = FIRE;
        }

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!data.ok) {
                // Kalau edit gagal (pesan lama gak support rich), hapus & kirim baru
                if (isEdit) {
                    try { await ctx.deleteMessage(); } catch (e) {}
                    await sendRich(ctx, html, buttons, false);
                }
            }
        } catch (e) {
            console.error('Fetch Error:', e.message);
        }
    }

    async function getOrCreateUser(ctx) {
        const tgId = ctx.from.id;
        
        let r = await pool.query(
            'SELECT id, username, name, balance, user_code, role, status, telegram_id, telegram_linked_at FROM users WHERE telegram_id = $1 LIMIT 1',
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
            `INSERT INTO users (username, name, password_hash, telegram_id, telegram_username) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id, username, name, balance, user_code, role, status, telegram_id, telegram_linked_at`,
            [candidate, name, randomHash, tgId, ctx.from.username || null]
        );
        
        return r.rows[0];
    }

    // Tombol Warna
    const btnPrimary = (text, data) => ({ text, callback_data: data, style: 'primary' });
    const btnSuccess = (text, data) => ({ text, callback_data: data, style: 'success' });
    const btnDanger  = (text, data) => ({ text, callback_data: data, style: 'danger' });
    const btnNormal  = (text, data) => ({ text, callback_data: data });

    // ==================== START (DASHBOARD) ====================
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
                await sendNewRich(ctx, `<b>✅ AKUN DITAUTKAN</b>\n\nAkun Telegram kamu berhasil dihubungkan dengan akun <b>@${esc(decoded.username)}</b>.\n\nKetik /start untuk melanjutkan.`, []);
                return;
            } catch (e) {
                await sendNewRich(ctx, `<b>❌ GAGAL</b>\n\nSesi login dari web sudah expired. Silakan lanjutkan dengan akun Telegram kamu.`, []);
            }
        }

        const user = await getOrCreateUser(ctx);
        if (user.status === 'banned') return sendNewRich(ctx, '<b>❌ DIBLOKIR</b>\n\nAkun kamu diblokir dari sistem.', []);

        const linkStatus = user.telegram_linked_at ? '✅ Tertaut ke Web' : '⚠️ Guest (Belum Tertaut)';
        
        const text =
            `<b>🏠 Dashboard Layanan Nokos</b>\n` +
            `Halo, @${esc(user.username)}.\n` +
            `Kelola layanan Anda dengan cepat, aman, dan otomatis melalui menu yang tersedia.\n\n` +
            `<b>📊 Ringkasan Akun</b>\n` +
            `<table bordered striped>\n` +
            `  <tr><td>Status</td><td>${user.status === 'active' ? '✅ Aktif' : '❌ Banned'}</td></tr>\n` +
            `  <tr><td>Role</td><td>${esc(user.role)}</td></tr>\n` +
            `  <tr><td>Saldo</td><td><b>${toRp(user.balance)}</b></td></tr>\n` +
            `  <tr><td>ID Akun</td><td><code>${esc(user.user_code || user.id)}</code></td></tr>\n` +
            `  <tr><td>Username</td><td>@${esc(user.username)}</td></tr>\n` +
            `  <tr><td>Status Web</td><td>${linkStatus}</td></tr>\n` +
            `</table>\n\n` +
            `<b>📖 Cara menggunakan bot</b>\n` +
            `<table bordered striped>\n` +
            `  <tr><td>1</td><td>Tekan Isi Saldo, lalu bayar QRIS/VA agar saldo masuk otomatis.</td></tr>\n` +
            `  <tr><td>2</td><td>Tekan Order Nokos, pilih server, aplikasi, lalu negara.</td></tr>\n` +
            `  <tr><td>3</td><td>Kode OTP dikirim ke chat ini begitu masuk.</td></tr>\n` +
            `  <tr><td>4</td><td>Kode tidak masuk? Batalkan, saldo kembali penuh.</td></tr>\n` +
            `</table>`;

        const buttons = [
            [btnPrimary('🛒 Order Nokos', 'menu_otp')],
            [btnSuccess('💰 Isi Saldo', 'menu_deposit')],
            [btnNormal('📋 Riwayat', 'menu_riwayat'), btnNormal('👤 Akun', 'menu_akun')],
            [btnNormal('❓ Bantuan', 'menu_bantuan')],
            [{ text: '🌐 Buka Web', url: 'https://asyrofotp.vercel.app', style: 'primary' }]
        ];

        await sendNewRich(ctx, text, buttons);
    });

    // ==================== MENU AKUN ====================
    bot.action('menu_akun', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        const linkStatus = user.telegram_linked_at ? '✅ Tertaut' : '⚠️ Guest';
        
        const text = 
            `<b>👤 Informasi Akun</b>\n` +
            `<table bordered striped>\n` +
            `  <tr><td>ID Akun</td><td><code>${esc(user.user_code || user.id)}</code></td></tr>\n` +
            `  <tr><td>Username</td><td>@${esc(user.username)}</td></tr>\n` +
            `  <tr><td>Nama</td><td>${esc(user.name)}</td></tr>\n` +
            `  <tr><td>Saldo</td><td><b>${toRp(user.balance)}</b></td></tr>\n` +
            `  <tr><td>Status Web</td><td>${linkStatus}</td></tr>\n` +
            `</table>`;

        const buttons = [];
        if (!user.telegram_linked_at) {
            buttons.push([btnSuccess('🔗 Tautkan Akun Web', 'link_web')]);
        } else {
            buttons.push([btnDanger('🚪 Logout', 'menu_logout')]);
        }
        buttons.push([btnPrimary('🔙 Kembali', 'back_home')]);

        await sendRich(ctx, text, buttons, true);
    });

    bot.action('link_web', async (ctx) => {
        const url = `https://asyrofotp.vercel.app/link-telegram?tg_id=${ctx.from.id}&tg_username=${ctx.from.username || ''}&merge=true`;
        
        await sendRich(ctx, 
            `<b>🔗 Tautkan Akun Web</b>\n\n` +
            `Saat ini kamu memakai akun Guest (dari Telegram).\n` +
            `Jika kamu menautkan akun web, saldo dan riwayat akan digabung otomatis.\n\n` +
            `<i>Klik tombol di bawah untuk membuka halaman penautan.</i>`, 
            [
                [{ text: '🌐 Buka Web Tautkan', url: url, style: 'success' }],
                [btnNormal('🔙 Kembali', 'back_home')]
            ],
            true
        );
    });

    bot.action('menu_logout', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (!user) return;
        await pool.query(`UPDATE users SET telegram_id = NULL, telegram_username = NULL, telegram_linked_at = NULL WHERE id = $1`, [user.id]);
        await sendNewRich(ctx, '<b>✅ LOGOUT BERHASIL</b>\n\nKamu telah keluar dari akun ini.', [[btnPrimary('🔙 Kembali', 'back_home')]]);
    });

    // ==================== MENU OTP ====================
    bot.action('menu_otp', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (user.status === 'banned') return sendNewRich(ctx, 'Akun diblokir.', [], true);
        
        const text = 
            `<b>🛒 Beli Nokos</b>\n` +
            `Pilih server yang tersedia:\n\n` +
            `<table bordered striped>\n` +
            `  <tr><th>Server</th><th>Keterangan</th></tr>\n` +
            `  <tr><td>1</td><td>Ekonomi (Harga Murah)</td></tr>\n` +
            `  <tr><td>2</td><td>Premium (Stok Lengkap)</td></tr>\n` +
            `</table>`;
            
        const keyboard = [
            [btnPrimary('🇮🇩 Server 1 (Ekonomi)', 'otp_srv_ekonomi')],
            [btnPrimary('🌍 Server 2 (Premium)', 'otp_srv_premium')],
            [btnNormal('🔙 Kembali', 'back_home')],
        ];
        await sendRich(ctx, text, keyboard, true);
    });

    bot.action(/^otp_srv_(ekonomi|premium)_?(\d*)$/, async (ctx) => {
        const server = ctx.match[1];
        const page = parseInt(ctx.match[2] || '1', 10);
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

            if (services.length === 0) return sendNewRich(ctx, '❌ Tidak ada layanan.', [[btnPrimary('🔙 Kembali', 'back_home')]]);

            const perPage = 10;
            const totalPages = Math.ceil(services.length / perPage);
            const start = (page - 1) * perPage;
            const current = services.slice(start, start + perPage);

            let text = `<b>📱 Pilih Layanan</b>\nServer ${server === 'ekonomi' ? '1' : '2'}\nHalaman ${page}/${totalPages}\n\n`;
            const buttons = [];
            
            for (let i = 0; i < current.length; i += 2) {
                const row = [btnNormal(current[i].name, `otp_svc_${server}_${current[i].code}`)];
                if (current[i + 1]) row.push(btnNormal(current[i + 1].name, `otp_svc_${server}_${current[i + 1].code}`));
                buttons.push(row);
            }

            const navRow = [];
            if (page > 1) navRow.push(btnPrimary('⬅️ Sebelumnya', `otp_srv_${server}_${page - 1}`));
            if (page < totalPages) navRow.push(btnPrimary('Selanjutnya ➡️', `otp_srv_${server}_${page + 1}`));
            if (navRow.length) buttons.push(navRow);

            buttons.push([btnNormal('🔙 Kembali', 'back_home')]);

            await sendRich(ctx, text, buttons, true);
        } catch (e) {
            await sendNewRich(ctx, `❌ Error: ${esc(e.message)}`, [[btnPrimary('🔙 Kembali', 'back_home')]]);
        }
    });

    bot.action(/^otp_svc_(ekonomi|premium)_(.+?)_?(\d*)$/, async (ctx) => {
        const [, server, code, pageStr] = ctx.match;
        const page = parseInt(pageStr || '1', 10);
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        try {
            let countries = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch(`/countries?server=ekonomi&service=${encodeURIComponent(code)}`);
                countries = (data.countries || []);
            } else {
                const countriesRaw = await premiumFetch('/catalog/countries');
                countries = (countriesRaw || []).map(c => ({ code: c.code, name: c.name }));
            }

            if (countries.length === 0) return sendNewRich(ctx, '❌ Tidak ada negara.', [[btnPrimary('🔙 Kembali', 'back_home')]]);

            const perPage = 10;
            const totalPages = Math.ceil(countries.length / perPage);
            const start = (page - 1) * perPage;
            const current = countries.slice(start, start + perPage);

            let text = `<b>🌍 Pilih Negara</b>\nHalaman ${page}/${totalPages}\n\n`;
            const buttons = [];
            
            for (let i = 0; i < current.length; i += 2) {
                const row = [btnNormal(current[i].name || current[i].code, `otp_cty_${server}_${code}_${current[i].code}`)];
                if (current[i + 1]) row.push(btnNormal(current[i + 1].name || current[i + 1].code, `otp_cty_${server}_${code}_${current[i + 1].code}`));
                buttons.push(row);
            }

            const navRow = [];
            if (page > 1) navRow.push(btnPrimary('⬅️ Sebelumnya', `otp_svc_${server}_${code}_${page - 1}`));
            if (page < totalPages) navRow.push(btnPrimary('Selanjutnya ➡️', `otp_svc_${server}_${code}_${page + 1}`));
            if (navRow.length) buttons.push(navRow);

            buttons.push([btnNormal('🔙 Kembali', `otp_srv_${server}`)]);

            await sendRich(ctx, text, buttons, true);
        } catch (e) {
            await sendNewRich(ctx, `❌ Error: ${esc(e.message)}`, [[btnPrimary('🔙 Kembali', 'back_home')]]);
        }
    });

    bot.action(/^otp_cty_(ekonomi|premium)_([^_]+)_([a-z]{2})_?(\d*)$/, async (ctx) => {
        const [, server, code, country, pageStr] = ctx.match;
        const page = parseInt(pageStr || '1', 10);
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        try {
            let providers = [];
            if (server === 'ekonomi') {
                const data = await dibananaFetch(`/prices?server=ekonomi&service=${encodeURIComponent(code)}&country=${encodeURIComponent(country)}`);
                providers = (data.providers || []).map(p => ({ id: p.id, price: applyMarkup(Number(p.price_idr) || 0), stock: p.stock }));
            } else {
                const [cr, sr] = await Promise.all([premiumFetch('/catalog/countries'), premiumFetch('/catalog/services')]);
                const cObj = (cr || []).find(c => c.code === country);
                const sObj = (sr || []).find(s => s.code === code);
                if (cObj && sObj) {
                    const params = new URLSearchParams({ country_id: cObj.id, platform_id: sObj.id, limit: '100', page: '1' });
                    const products = await premiumFetch(`/catalog/products?${params.toString()}`);
                    providers = (products || []).map(p => ({ id: p.id, price: applyMarkup(premiumMoneyToIdr(p.price)), stock: p.available }));
                }
            }

            if (providers.length === 0) return sendNewRich(ctx, '❌ Stok habis.', [[btnPrimary('🔙 Kembali', 'back_home')]]);

            const perPage = 10;
            const totalPages = Math.ceil(providers.length / perPage);
            const start = (page - 1) * perPage;
            const current = providers.slice(start, start + perPage);

            let text = `<b>💰 Pilih Harga</b>\nHalaman ${page}/${totalPages}\n\n`;
            const buttons = current.map(p => [btnSuccess(`${toRp(p.price)} | Stok: ${p.stock}`, `otp_buy_${server}_${code}_${country}_${p.id}`)]);

            const navRow = [];
            if (page > 1) navRow.push(btnPrimary('⬅️ Sebelumnya', `otp_cty_${server}_${code}_${country}_${page - 1}`));
            if (page < totalPages) navRow.push(btnPrimary('Selanjutnya ➡️', `otp_cty_${server}_${code}_${country}_${page + 1}`));
            if (navRow.length) buttons.push(navRow);

            buttons.push([btnNormal('🔙 Kembali', `otp_svc_${server}_${code}`)]);

            await sendRich(ctx, text, buttons, true);
        } catch (e) {
            await sendNewRich(ctx, `❌ Error: ${esc(e.message)}`, [[btnPrimary('🔙 Kembali', 'back_home')]]);
        }
    });

    bot.action(/^otp_buy_(ekonomi|premium)_([^_]+)_([a-z]{2})_(.+)$/, async (ctx) => {
        const [, server, code, country, providerId] = ctx.match;
        const user = await getOrCreateUser(ctx);
        if (!user) return;

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

            await sendRich(ctx,
                `<b>✅ ORDER BERHASIL</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `<b>Nomor</b>  : <code>${esc(phone)}</code>\n` +
                `<b>Harga</b>  : <b>${toRp(price)}</b>\n` +
                `<b>Status</b> : Menunggu OTP\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n` +
                `Silakan cek menu utama secara berkala untuk melihat kode OTP.`,
                [[btnPrimary('🔙 Menu Utama', 'back_home')]],
                true
            );
        } catch (e) {
            await sendNewRich(ctx, `<b>❌ GAGAL</b>\n\n${esc(e.message)}`, [[btnPrimary('🔙 Kembali', 'back_home')]]);
        }
    });

    // ==================== MENU DEPOSIT ====================
    bot.action('menu_deposit', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (!user) return;
        
        const text = `<b>💰 Top Up Saldo</b>\n\nPilih nominal yang kamu inginkan:`;
        const keyboard = [
            [btnSuccess('Rp 5.000', 'dep_5000'), btnSuccess('Rp 10.000', 'dep_10000')],
            [btnSuccess('Rp 20.000', 'dep_20000'), btnSuccess('Rp 50.000', 'dep_50000')],
            [btnNormal('🔙 Kembali', 'back_home')],
        ];
        await sendRich(ctx, text, keyboard, true);
    });

    bot.action(/^dep_(\d+)$/, async (ctx) => {
        const amount = parseInt(ctx.match[1], 10);
        const user = await getOrCreateUser(ctx);
        if (!user) return;

        try {
            if (!deps.createDeposit) throw new Error('Fitur deposit belum dikonfigurasi.');
            const data = await deps.createDeposit(amount);
            if (!data || !data.qr_image) throw new Error('Gagal membuat QRIS.');

            await sendRich(ctx,
                `<b>💳 TOP UP QRIS</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `<b>ID</b>      : <code>${esc(data.id)}</code>\n` +
                `<b>Nominal</b> : <b>${toRp(data.diterima)}</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n\n` +
                `Silakan scan QR di bawah ini:`,
                [[btnNormal('🔙 Kembali', 'back_home')]],
                true
            );

            await ctx.replyWithPhoto({ url: data.qr_image }, { caption: `<i>QRIS ini berlaku selama 15 menit.</i>`, parse_mode: 'HTML' });
        } catch (e) {
            await sendNewRich(ctx, `<b>❌ GAGAL</b>\n\n${esc(e.message)}`, [[btnPrimary('🔙 Kembali', 'back_home')]]);
        }
    });

    // ==================== MENU RIWAYAT ====================
    bot.action('menu_riwayat', async (ctx) => {
        const user = await getOrCreateUser(ctx);
        if (!user) return;
        
        const orders = await pool.query(`SELECT otp_id, service, phone_number, otp_code, status, price, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`, [user.id]);
        if (orders.rows.length === 0) return sendNewRich(ctx, '<b>📭 KOSONG</b>\n\nBelum ada riwayat order.', [[btnPrimary('🔙 Kembali', 'back_home')]]);

        let text = `<b>📋 Riwayat 5 Terakhir</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        orders.rows.forEach(o => {
            text += `<b>Layanan</b>: ${esc(o.service || '-')}\n`;
            text += `<b>Nomor</b>  : <code>${esc(o.phone_number || '-')}</code>\n`;
            text += `<b>Status</b> : ${o.otp_code ? `<code>✅ ${esc(o.otp_code)}</code>` : o.status}\n`;
            text += `<b>Harga</b>  : ${toRp(o.price)}\n`;
            text += `━━━━━━━━━━━━━━━━━━━━\n`;
        });
        await sendRich(ctx, text, [[btnPrimary('🔙 Kembali', 'back_home')]], true);
    });

    // ==================== MENU BANTUAN ====================
    bot.action('menu_bantuan', async (ctx) => {
        await sendRich(ctx, 
            `<b>❓ BANTUAN</b>\n\n` +
            `Jika kamu mengalami kendala, silakan hubungi admin kami di:\n` +
            `<b>@asyrofc</b>`, 
            [[btnPrimary('🔙 Kembali', 'back_home')]],
            true
        );
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
