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

// Tangkap error dari Google (kalau user batalin login atau ada error di URL)
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
    var clientId = "557968626394-ln6638b8opijdn46bc8e8e97249l4je6.apps.googleusercontent.com";
    
    // Arahin ke endpoint backend lo (BUKAN ke halaman /login)
    var redirectUri = W.location.origin + "/api/auth/google/callback";
    
    // Bikin URL Authorization Google
    var authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + 
      "client_id=" + encodeURIComponent(clientId) +
      "&redirect_uri=" + encodeURIComponent(redirectUri) +
      "&response_type=code" +
      "&scope=email%20profile" +
      "&prompt=select_account";

    // Lempar user ke halaman login Google
    W.location.href = authUrl;
  });
}

})();
