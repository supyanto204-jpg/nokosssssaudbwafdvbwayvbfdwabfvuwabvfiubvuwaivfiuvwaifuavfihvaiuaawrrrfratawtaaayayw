// ===== MOBILE SIDEBAR TOGGLE =====
document.addEventListener('DOMContentLoaded', () => {
    const mobileToggle = document.querySelector('.mobile-toggle');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    if (mobileToggle && sidebar) {
        mobileToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            if (overlay) overlay.classList.toggle('active');
        });

        if (overlay) {
            overlay.addEventListener('click', () => {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
            });
        }
    }

    // ===== TABS =====
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

    // ===== MODAL =====
    document.querySelectorAll('[data-modal-open]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.modalOpen;
            const modal = document.getElementById(modalId);
            if (modal) modal.classList.add('active');
        });
    });

    document.querySelectorAll('[data-modal-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal-overlay');
            if (modal) modal.classList.remove('active');
        });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });

    // ===== COPY TO CLIPBOARD =====
    document.querySelectorAll('[data-copy]').forEach(btn => {
        btn.addEventListener('click', () => {
            const text = btn.dataset.copy;
            navigator.clipboard.writeText(text).then(() => {
                const original = btn.innerHTML;
                btn.innerHTML = '<svg class="icon-svg" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
                setTimeout(() => {
                    btn.innerHTML = original;
                }, 1500);
            });
        });
    });
});

// ===== FORMAT RUPIAH =====
function formatRupiah(angka) {
    return 'Rp' + angka.toLocaleString('id-ID');
}

// ===== FORMAT WAKTU =====
function formatWaktu(date) {
    const d = new Date(date);
    const options = { hour: '2-digit', minute: '2-digit' };
    return d.toLocaleTimeString('id-ID', options);
}
