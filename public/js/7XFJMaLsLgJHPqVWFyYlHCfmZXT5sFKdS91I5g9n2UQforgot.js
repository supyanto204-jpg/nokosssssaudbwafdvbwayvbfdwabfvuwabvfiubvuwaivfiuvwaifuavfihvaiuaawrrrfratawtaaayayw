(function(){
'use strict';

var D=document, W=window;
var q=function(s){return D.querySelector(s)};

// theme toggle
(function(){
  var b=q('#themeBtn'); if(!b)return;
  var root=D.documentElement;
  var mq=W.matchMedia?W.matchMedia('(prefers-color-scheme: dark)'):null;
  function resolve(p){return p==='system'?(mq&&mq.matches?'dark':'light'):p}
  function setPref(p){
    root.setAttribute('data-theme-pref',p);
    root.setAttribute('data-theme',resolve(p));
    try{localStorage.setItem('asyrofotp_theme_pref',p)}catch(e){}
  }
  b.addEventListener('click',function(){
    var cur=root.getAttribute('data-theme-pref')||'system';
    setPref(cur==='light'?'dark':cur==='dark'?'system':'light');
  });
})();

// Device ID (buat rate limit)
(function(){
  try {
    if(!localStorage.getItem('asyrofotp_device_id')){
      var id = Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem('asyrofotp_device_id', id);
    }
  } catch(e){}
})();

// Elements
var form=q('#forgotForm');
var emailIn=q('#email');
var submitBtn=q('#submitBtn');
var btnText=q('#btnText');
var btnIcon=q('#btnIcon');
var statusRow=q('#statusRow');
var statusLabel=q('#statusLabel');
var statusFill=q('#statusBarFill');
var alertEl=q('#alert');
var alertText=q('#alert-text');
var alertIcon=q('#alertIcon');

var turnstileToken = null;
var isVerified = false;

function showAlert(msg, type){
  alertEl.className='alert show '+(type||'error');
  alertText.textContent=msg;
  if(type==='success'){ alertIcon.innerHTML='<polyline points="20 6 9 17 4 12"/>'; }
  else{ alertIcon.innerHTML='<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'; }
}
function hideAlert(){alertEl.className='alert'}

function setStatus(state, label){
  statusRow.dataset.state=state;
  if(label)statusLabel.textContent=label;
  if(state==='pending'){ statusRow.classList.remove('visible'); }
  else{ statusRow.classList.add('visible'); }
}

// Callback Cloudflare
window.onTurnstileSuccess = function(token) {
  turnstileToken = token;
  isVerified = true;
  submitBtn.disabled = false;
  hideAlert();
};

window.onTurnstileExpire = function() {
  turnstileToken = null;
  isVerified = false;
  submitBtn.disabled = true;
  showAlert('Verifikasi keamanan kedaluwarsa. Centang ulang.', 'error');
};

// Submit
if(!form)return;

form.addEventListener('submit', async function(e){
  e.preventDefault();
  hideAlert();

  if (!isVerified || !turnstileToken) {
    showAlert('Selesaikan verifikasi keamanan dulu.', 'error');
    return;
  }

  var email=emailIn.value.trim();
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    showAlert('Masukkan alamat email yang valid.', 'error');
    setStatus('failed', 'Email tidak valid');
    return;
  }

  submitBtn.disabled=true;
  btnText.textContent='Mengirim...';
  var origIcon=btnIcon?btnIcon.outerHTML:'';
  if(btnIcon)btnIcon.outerHTML='<span class="spinner" id="btnIcon"></span>';
  setStatus('running', 'Memproses permintaan...');
  if(statusFill)statusFill.style.width='40%';

  try{
    var deviceId = 'unknown';
    try { deviceId = localStorage.getItem('asyrofotp_device_id') || 'unknown'; } catch(e){}

    var res=await fetch('/api/auth/forgot', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-device-id': deviceId
      },
      body:JSON.stringify({
        email: email,
        cf_token: turnstileToken
      })
    });

    var data=await res.json();
    if(!res.ok)throw new Error(data.error || 'Gagal mengirim permintaan');

    setStatus('done', 'Terkirim!');
    if(statusFill)statusFill.style.width='100%';
    showAlert(data.message || 'Jika email terdaftar, link reset telah dikirim.', 'success');
    btnText.textContent='Terkirim';

  }catch(err){
    setStatus('failed', 'Gagal');
    if(statusFill)statusFill.style.width='100%';
    showAlert(err.message || 'Terjadi kesalahan sistem.', 'error');
    
    submitBtn.disabled=false;
    btnText.textContent='Kirim Link Reset';
    if(q('#btnIcon') && origIcon) q('#btnIcon').outerHTML=origIcon;
    
    // Reset Turnstile biar user harus centang ulang
    if (window.turnstile) {
      window.turnstile.reset();
    }
    isVerified = false;
    submitBtn.disabled = true;
  }
});

emailIn.addEventListener('keydown', function(e){
  if(e.key==='Enter'){e.preventDefault(); form.dispatchEvent(new Event('submit'));}
});

})();
