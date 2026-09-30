// ============================================
// ASYROFOTP - MAIN JS (Cache + SWR + UI Utilities)
// ============================================

// ============================================
// ===== CACHE MANAGER =====
// ============================================
const CacheManager = {
    prefix: 'asyrofotp_cache_',
    defaultTTL: 5 * 60 * 1000, // 5 menit

    get(key) {
        try {
            const item = localStorage.getItem(this.prefix + key);
            if (!item) return null;
            const parsed = JSON.parse(item);
            // Auto-expire kalo udah lewat TTL
            if (parsed.timestamp && Date.now() - parsed.timestamp > this.defaultTTL) {
                this.remove(key);
                return null;
            }
            return parsed;
        } catch (err) {
            return null;
        }
    },

    set(key, value) {
        try {
            localStorage.setItem(this.prefix + key, JSON.stringify({
                value,
                timestamp: Date.now()
            }));
        } catch (err) {
            console.error('Cache set error:', err);
        }
    },

    remove(key) {
        localStorage.removeItem(this.prefix + key);
    },

    clear() {
        Object.keys(localStorage)
            .filter(k => k.startsWith(this.prefix))
            .forEach(k => localStorage.removeItem(k));
    }
};

// ============================================
// ===== SWR FETCH =====
// ============================================
async function swrFetch(url, cacheKey, onData, options = {}) {
    const token = localStorage.getItem('access_token');

    // 1. Tampilkan cache dulu (instant)
    const cached = CacheManager.get(cacheKey);
    if (cached) {
        onData(cached.value, { fromCache: true });
    }

    // 2. Request API di background
    try {
        const res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...(options.headers || {})
            }
        });

        if (res.status === 401) {
            localStorage.removeItem('access_token');
            CacheManager.clear();
            window.location.href = '/login';
            return;
        }

        const data = await res.json();

        // 3. Update cache + UI
        CacheManager.set(cacheKey, data);
        onData(data, { fromCache: false });
    } catch (err) {
        console.error('Fetch error:', err);
        if (!cached) {
            onData(null, { error: err.message });
        } else {
            onData(cached.value, { fromCache: true, error: err.message });
        }
    }
}

// ============================================
// ===== SAFE JSON PARSE =====
// ============================================
async function safeJson(res) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        throw new Error(`Server error ${res.status}: ${text.substring(0, 100)}`);
    }
}

// ============================================
// ===== FORMAT HELPERS =====
// ============================================
function formatRupiah(angka) {
    if (!angka && angka !== 0) return 'Rp0';
    return 'Rp' + Number(angka).toLocaleString('id-ID');
}

function formatTanggal(date) {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleString('id-ID', {
        day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatWaktu(date) {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleTimeString('id-ID', {
        hour: '2-digit', minute: '2-digit'
    });
}

function getInitial(name) {
    return name ? name.charAt(0).toUpperCase() : '?';
}

// ============================================
// ===== TWEMOJI FLAG =====
// ============================================
function countryCodeToTwemoji(countryCode) {
    const code = (countryCode || '').toUpperCase();
    if (code.length !== 2) return null;
    const codePoints = code.split('').map(char => {
        return (0x1F1E6 + char.charCodeAt(0) - 65).toString(16);
    });
    return codePoints.join('-');
}

function getFlagUrl(countryCode) {
    const codepoints = countryCodeToTwemoji(countryCode);
    if (!codepoints) return null;
    return `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/${codepoints}.svg`;
}

function renderFlag(countryCode) {
    const url = getFlagUrl(countryCode);
    if (!url) return '';
    return `<img src="${url}" alt="${countryCode}" class="flag-img" onerror="this.style.display='none'">`;
}

// ============================================
// ===== MOBILE SIDEBAR TOGGLE =====
// ============================================
function initSidebar() {
    const mobileToggle = document.querySelector('.mobile-toggle');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    if (!mobileToggle || !sidebar) return;

    function openSidebar() {
        sidebar.classList.add('open');
        if (overlay) overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    mobileToggle.addEventListener('click', () => {
        if (sidebar.classList.contains('open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    });

    if (overlay) {
        overlay.addEventListener('click', closeSidebar);
    }

    // Auto-close pas klik link di sidebar (mobile)
    sidebar.querySelectorAll('.nav-item').forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                closeSidebar();
            }
        });
    });

    // Auto-close pas resize ke desktop
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (window.innerWidth > 768) {
                closeSidebar();
            }
        }, 150);
    });

    // ESC key tutup sidebar
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            closeSidebar();
        }
    });
}

// ============================================
// ===== TABS =====
// ============================================
function initTabs() {
    document.querySelectorAll('.tabs').forEach(tabGroup => {
        tabGroup.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                tabGroup.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const target = tab.dataset.target;
                if (target) {
                    document.querySelectorAll('[data-tab-content]').forEach(content => {
                        content.style.display = 'none';
                    });
                    const targetEl = document.querySelector(`[data-tab-content="${target}"]`);
                    if (targetEl) targetEl.style.display = 'block';
                }
            });
        });
    });
}

// ============================================
// ===== MODAL =====
// ============================================
function initModals() {
    // Open
    document.querySelectorAll('[data-modal-open]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.modalOpen;
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.add('active');
                document.body.style.overflow = 'hidden';
            }
        });
    });

    // Close button
    document.querySelectorAll('[data-modal-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal-overlay');
            if (modal) {
                modal.classList.remove('active');
                if (!document.querySelector('.modal-overlay.active')) {
                    document.body.style.overflow = '';
                }
            }
        });
    });

    // Click outside
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
                if (!document.querySelector('.modal-overlay.active')) {
                    document.body.style.overflow = '';
                }
            }
        });
    });

    // ESC key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const activeModal = document.querySelector('.modal-overlay.active');
            if (activeModal) {
                activeModal.classList.remove('active');
                if (!document.querySelector('.modal-overlay.active')) {
                    document.body.style.overflow = '';
                }
            }
        }
    });
}

// ============================================
// ===== COPY TO CLIPBOARD =====
// ============================================
function initCopyButtons() {
    document.querySelectorAll('[data-copy]').forEach(btn => {
        btn.addEventListener('click', () => {
            const text = btn.dataset.copy;
            if (!text) return;

            navigator.clipboard.writeText(text).then(() => {
                const original = btn.innerHTML;
                btn.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
                setTimeout(() => {
                    btn.innerHTML = original;
                }, 1500);
            }).catch(err => {
                console.error('Copy error:', err);
            });
        });
    });
}

// ============================================
// ===== LOGOUT HANDLER =====
// ============================================
function initLogout() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (!logoutBtn) return;

    logoutBtn.addEventListener('click', async () => {
        const token = localStorage.getItem('access_token');

        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        } catch (err) {
            console.error('Logout error:', err);
        }

        CacheManager.clear();
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');

        window.location.href = '/landing';
    });
}

// ============================================
// ===== PAGE TRANSITION =====
// ============================================
(function initPageTransition() {
    const supportsViewTransitions = 'startViewTransition' in document;

    if (supportsViewTransitions) {
        return;
    }

    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link) return;

        const href = link.getAttribute('href');

        if (
            !href ||
            href.startsWith('#') ||
            href.startsWith('http') ||
            href.startsWith('mailto:') ||
            href.startsWith('tel:') ||
            href.startsWith('javascript:') ||
            link.target === '_blank' ||
            link.hasAttribute('download') ||
            e.ctrlKey || e.metaKey || e.shiftKey
        ) {
            return;
        }

        e.preventDefault();
        document.body.classList.add('page-exit');

        setTimeout(() => {
            window.location.href = href;
        }, 250);
    });

    window.addEventListener('pageshow', (e) => {
        if (e.persisted) {
            document.body.classList.remove('page-exit');
        }
    });
})();

// ============================================
// ===== INIT ALL =====
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initSidebar();
    initTabs();
    initModals();
    initCopyButtons();
    initLogout();
});

// ============================================
// ===== EXPORT KE WINDOW (biar bisa dipake di script lain) =====
// ============================================
window.CacheManager = CacheManager;
window.swrFetch = swrFetch;
window.safeJson = safeJson;
window.formatRupiah = formatRupiah;
window.formatTanggal = formatTanggal;
window.formatWaktu = formatWaktu;
window.getInitial = getInitial;
window.renderFlag = renderFlag;
window.getFlagUrl = getFlagUrl;
