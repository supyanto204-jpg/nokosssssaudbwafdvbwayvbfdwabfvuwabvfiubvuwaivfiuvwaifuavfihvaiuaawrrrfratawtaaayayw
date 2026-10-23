(function(){
'use strict';

var D=document, W=window;
var q=function(s,c){return (c||D).querySelector(s)};

var customBtn = q('#customGoogleBtn');
var alertEl = q('#alert');
var alertText = q('#alert-text');

// Fungsi buat nampilin alert
function showAlert(msg, type){
  if(!alertEl) return;
  alertEl.className = 'alert show ' + (type || 'error');
  if(alertText) alertText.textContent = msg;
}

// Tangkap error dari Google di URL (kalau user nolak/batalin login)
W.addEventListener('load', function() {
  var urlParams = new URLSearchParams(W.location.search);
  var error = urlParams.get('error');
  if (error) {
    showAlert('Login Google dibatalkan atau gagal. Silakan coba lagi.', 'error');
    // Bersihin URL biar gak error terus
    W.history.replaceState(null, '', W.location.pathname);
  }
});

// Pas tombol Google diklik
if (customBtn) {
  customBtn.addEventListener('click', function() {
    // 1. Client ID lo
    var clientId = "557968626394-ln6638b8opijdn46bc8e8e97249l4je6.apps.googleusercontent.com";
    
    // 2. URL Callback (HARUS SAMA PERSIS dengan yang di Google Cloud Console)
    // Kita arahin ke halaman login lagi, nanti backend yang nangkep parameter ?code=
    var redirectUri = W.location.origin + "/login";
    
    // 3. Bikin URL Authorization Google
    var authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + 
      "client_id=" + encodeURIComponent(clientId) +
      "&redirect_uri=" + encodeURIComponent(redirectUri) +
      "&response_type=code" +
      "&scope=email%20profile" +
      "&prompt=select_account";

    // 4. Redirect user ke Google (tab baru / halaman baru)
    W.location.href = authUrl;
  });
}

})();
