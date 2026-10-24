(function(){
'use strict';

var D=document, W=window;
var q=function(s,c){return (c||D).querySelector(s)};

// 1. Tangkap token dari URL (jika backend redirect balik ke /login?token=...)
(function checkToken() {
    var urlParams = new URLSearchParams(W.location.search);
    var token = urlParams.get('token');
    if (token) {
        try {
            localStorage.setItem('access_token', token);
            var refresh = urlParams.get('refresh');
            if(refresh) localStorage.setItem('refresh_token', refresh);
            W.history.replaceState(null, '', W.location.pathname);
            W.location.replace('/dashboard'); // Langsung pindah
        } catch(e) {}
    }
})();

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

// Tangkap error dari URL
W.addEventListener('load', function() {
  var urlParams = new URLSearchParams(W.location.search);
  var error = urlParams.get('error');
  if (error) {
    if(error === 'banned') { showAlert('Akun kamu diblokir.', 'error'); }
    else if (error === 'failed') { showAlert('Login Google gagal. Coba lagi.', 'error'); }
    else { showAlert('Terjadi kesalahan saat login Google.', 'error'); }
    W.history.replaceState(null, '', W.location.pathname);
  }
});

// 2. Klik tombol -> Langsung ke Google (Tanpa fetch /api/auth/google/url)
if (customBtn) {
  customBtn.addEventListener('click', function() {
    var clientId = "557968626394-ln6638b8opijdn46bc8e8e97249l4je6.apps.googleusercontent.com";
    // Paksa pakai domain production atau localhost
    var redirectUri = W.location.origin + "/api/auth/google/callback"; 
    
    var authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + 
      "client_id=" + encodeURIComponent(clientId) +
      "&redirect_uri=" + encodeURIComponent(redirectUri) +
      "&response_type=code" +
      "&scope=email%20profile" +
      "&prompt=select_account";

    // Ubah tombol jadi loading bentar
    var originalText = customBtn.innerHTML;
    customBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border:2px solid rgba(0,0,0,0.2);border-top-color:currentColor;border-radius:50%;animation:spin .7s linear infinite; display:inline-block; vertical-align:middle; margin-right:8px;"></span> <span>Menghubungkan...</span>';
    customBtn.disabled = true;

    // Lempar langsung
    W.location.href = authUrl;
  });
}

})();
