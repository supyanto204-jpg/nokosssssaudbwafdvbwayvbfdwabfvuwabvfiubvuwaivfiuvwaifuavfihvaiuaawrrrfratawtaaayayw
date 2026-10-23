(function(){
'use strict';

var D=document, W=window;
var q=function(s,c){return (c||D).querySelector(s)};

var customBtn = q('#customGoogleBtn');
var alertEl = q('#alert');
var alertText = q('#alert-text');
var alertIcon = q('#alertIcon');

var ICONS={
error:'<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
success:'<polyline points="20 6 9 17 4 12"/>',
info:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
};

function showAlert(msg,type){
  type=type||'error';
  if(!alertEl)return;
  alertEl.className='alert show '+type;
  if(alertText)alertText.textContent=msg;
  if(alertIcon)alertIcon.innerHTML=ICONS[type]||ICONS.error;
}

// Tangkap error dari backend kalau redirect gagal
W.addEventListener('load', function() {
  var urlParams = new URLSearchParams(W.location.search);
  var error = urlParams.get('error');
  if (error) {
    if(error === 'banned') {
        showAlert('Akun kamu diblokir.', 'error');
    } else if (error === 'failed') {
        showAlert('Login Google gagal. Silakan coba lagi.', 'error');
    } else {
        showAlert('Terjadi kesalahan saat login Google.', 'error');
    }
    // Bersihin URL biar gak error terus
    W.history.replaceState(null, '', W.location.pathname);
  }
});

// Pas tombol Google diklik
if (customBtn) {
  customBtn.addEventListener('click', async function() {
    // Ubah teks tombol sebentar
    var originalText = customBtn.innerHTML;
    customBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border:2px solid rgba(0,0,0,0.2);border-top-color:currentColor;border-radius:50%;animation:spin .7s linear infinite;"></span> <span>Menghubungkan...</span>';
    customBtn.disabled = true;

    try {
        // Minta URL login ke backend
        var res = await fetch('/api/auth/google/url');
        var data = await res.json();
        
        if (data.url) {
            // Lempar user ke halaman login Google
            W.location.href = data.url;
        } else {
            throw new Error('Gagal memuat URL login Google.');
        }
    } catch (e) {
        alert(e.message || 'Terjadi kesalahan sistem.');
        customBtn.innerHTML = originalText;
        customBtn.disabled = false;
    }
  });
}

})();
