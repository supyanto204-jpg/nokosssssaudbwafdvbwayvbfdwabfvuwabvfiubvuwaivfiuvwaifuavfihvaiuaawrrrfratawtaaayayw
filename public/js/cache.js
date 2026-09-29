// ============================================
// ASYROFOTP CACHE + SWR + PAGE TRANSITION
// ============================================

// ===== CACHE MANAGER =====
const CacheManager = {
    prefix: 'asyrofotp_cache_',

    get(key) {
        try {
            const item = localStorage.getItem(this.prefix + key);
            if (!item) return null;
            return JSON.parse(item);
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

// ===== SWR FETCH =====
// 1. Tampilkan cache dulu (instant)
// 2. Request API di background
// 3. Update cache + UI kalau data baru
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
        }
    }
}

// ===== PAGE TRANSITION =====
(function() {
    // Cek support View Transitions API (Chrome/Edge)
    const supportsViewTransitions = 'startViewTransition' in document;

    // Kalau browser support View Transitions API,
    // CSS @view-transition yang handle, JS nggak perlu intervensi
    if (supportsViewTransitions) {
        return;
    }

    // Fallback: manual fade out untuk Firefox/Safari
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (!link) return;

        const href = link.getAttribute('href');

        // Skip kalau bukan link internal
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

        // Animasi exit
        e.preventDefault();
        document.body.classList.add('page-exit');

        setTimeout(() => {
            window.location.href = href;
        }, 250);
    });

    // Handle back/forward browser (pageshow dari cache)
    window.addEventListener('pageshow', (e) => {
        if (e.persisted) {
            document.body.classList.remove('page-exit');
        }
    });
})();

// ===== AUTO CLEAR CACHE ON LOGOUT =====
document.addEventListener('DOMContentLoaded', () => {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        // Biar nggak dobel, kita nggak override handler,
        // cuma nambahin clear cache setelah click
        logoutBtn.addEventListener('click', () => {
            setTimeout(() => CacheManager.clear(), 100);
        });
    }
});
