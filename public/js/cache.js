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
// 1. Kasih data lama dari cache dulu (instan)
// 2. Request API di background
// 3. Kalau data baru, panggil callback
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
            window.location.href = '/login';
            return;
        }

        const data = await res.json();

        // 3. Update cache + UI
        CacheManager.set(cacheKey, data);
        onData(data, { fromCache: false });
    } catch (err) {
        console.error('Fetch error:', err);
        // Kalau gagal & nggak ada cache, kasih error
        if (!cached) {
            onData(null, { error: err.message });
        }
    }
}
