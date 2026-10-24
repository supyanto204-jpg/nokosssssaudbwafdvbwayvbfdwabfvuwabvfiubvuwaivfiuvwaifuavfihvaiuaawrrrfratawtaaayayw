(function(){
'use strict';

var D = document, W = window;
var q = function(s, c){ return (c || D).querySelector(s); };

// 1. Tangkap token dari URL (jika backend redirect balik ke /login?token=...)
(function checkToken() {
    var urlParams = new URLSearchParams(W.location.search);
    var token = urlParams.get('token');
    if (token) {
        try {
            localStorage.setItem('access_token', token);
            var refresh = urlParams.get('refresh');
            if (refresh) localStorage.setItem('refresh_token', refresh);
            W.history.replaceState(null, '', W.location.pathname);
            W.location.replace('/dashboard');
        } catch(e) {}
    }
})();

var customBtn = q('#customGoogleBtn');
var alertEl = q('#alert');
var alertText = q('#alert-text');
var alertIcon = q('#alertIcon');

var ICONS = {
    error: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    success: '<polyline points="20 6 9 17 4 12"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
};

function showAlert(msg, type) {
    type = type || 'error';
    if (!alertEl) return;
    alertEl.className = 'alert show ' + type;
    if (alertText) alertText.textContent = msg;
    if (alertIcon) alertIcon.innerHTML = ICONS[type] || ICONS.error;
}

// Tangkap error dari URL (jika callback balik dengan ?error=...)
W.addEventListener('load', function() {
    var urlParams = new URLSearchParams(W.location.search);
    var error = urlParams.get('error');
    if (error) {
        if (error === 'banned') {
            showAlert('Akun kamu diblokir.', 'error');
        } else if (error === 'failed' || error === 'missing_code') {
            showAlert('Login Google gagal. Coba lagi.', 'error');
        } else if (error === 'access_denied') {
            showAlert('Login Google dibatalkan.', 'error');
        } else {
            showAlert('Terjadi kesalahan saat login Google.', 'error');
        }
        W.history.replaceState(null, '', W.location.pathname);
    }
});

// 2. Klik tombol -> Minta URL dari backend -> Redirect ke Google
if (customBtn) {
    customBtn.addEventListener('click', async function() {
        var originalHTML = customBtn.innerHTML;
        
        // Loading state
        customBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border:2px solid rgba(0,0,0,0.2);border-top-color:currentColor;border-radius:50%;animation:spin .7s linear infinite; display:inline-block; vertical-align:middle; margin-right:8px;"></span> <span>Menghubungkan...</span>';
        customBtn.disabled = true;

        try {
            var res = await fetch('/api/auth/google/url', {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });

            var data = await res.json().catch(function() { return {}; });

            if (!res.ok || !data.url) {
                throw new Error(data.error || 'Gagal mendapatkan URL login Google');
            }

            // Lempar ke Google
            W.location.href = data.url;

        } catch (err) {
            // Balikin tombol ke semula
            customBtn.innerHTML = originalHTML;
            customBtn.disabled = false;
            showAlert(err.message || 'Gagal login Google. Coba lagi.', 'error');
        }
    });
}

})();
