(function(){
'use strict';

var D=document, W=window;
var q=function(s,c){return (c||D).querySelector(s)};

var alertEl=q('#alert');
var alertText=q('#alert-text');
var alertIcon=q('#alertIcon');
var statusRow=q('#statusRow');
var statusLabel=q('#statusLabel');
var customBtn=q('#customGoogleBtn');

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
function hideAlert(){if(alertEl)alertEl.className='alert'}

function setStatus(state,label){
  if(!statusRow)return;
  statusRow.dataset.state=state;
  if(statusLabel&&label)statusLabel.textContent=label;
  if(state==='pending'){
    statusRow.classList.remove('visible');
    statusRow.setAttribute('aria-hidden','true');
  }else{
    statusRow.classList.add('visible');
    statusRow.setAttribute('aria-hidden','false');
  }
}

// Callback dari Google (dapet credential / JWT)
W.handleGoogleCredential = async function(resp){
  if(!resp||!resp.credential){
    showAlert('Login Google gagal. Coba lagi.','error');
    return;
  }

  hideAlert();
  setStatus('running','Memverifikasi akun Google...');

  try{
    var res=await fetch('/api/auth/google',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({credential:resp.credential})
    });

    var data=await res.json();
    if(!res.ok)throw new Error(data.error||'Login Google gagal');

    try{
      localStorage.setItem('access_token',data.session.access_token);
      if(data.session.refresh_token)localStorage.setItem('refresh_token',data.session.refresh_token);
      localStorage.setItem('user',JSON.stringify(data.user));
    }catch(e){}

    setStatus('done','Login berhasil!');
    showAlert('Login berhasil! Mengalihkan...','success');

    setTimeout(function(){W.location.replace('/dashboard')},800);

  }catch(err){
    setStatus('failed','Gagal login');
    showAlert(err&&err.message?err.message:'Login Google gagal','error');
    setTimeout(function(){setStatus('pending','Menunggu')},3000);
  }
};

// Inisialisasi Google One Tap
(function initGoogle(){
  if (typeof google === 'undefined' || !google.accounts) {
    setTimeout(initGoogle, 100);
    return;
  }

  google.accounts.id.initialize({
    client_id: "557968626394-ln6638b8opijdn46bc8e8e97249l4je6.apps.googleusercontent.com",
    callback: handleGoogleCredential,
    use_fedcm_for_prompt: true // <--- INI TAMBAHANNYA BIAR GAK ERROR
  });

  // Pas tombol custom diklik, munculin popup One Tap
  if (customBtn) {
    customBtn.addEventListener('click', function() {
      google.accounts.id.prompt();
    });
  }
})();

})();
