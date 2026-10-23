(function(){
'use strict';

var D=document,W=window;
var q=function(s,c){return (c||D).querySelector(s)};

var alertEl=q('#alert');
var alertText=q('#alert-text');
var alertIcon=q('#alertIcon');
var statusRow=q('#statusRow');
var statusLabel=q('#statusLabel');
var wrap=q('#googleBtnWrap');

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

// credential handler yang dipanggil GSI
W.handleGoogleCredential=async function(resp){
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

// kalau GSI gagal render dalam 8 detik, tampilkan fallback + pesan
(function(){
if(!wrap)return;
setTimeout(function(){
var hasIframe=wrap.querySelector('iframe');
if(hasIframe)return;

wrap.classList.add('failed');

var btn=D.createElement('button');
btn.type='button';
btn.className='google-fallback';
btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 2"/></svg><span>Muat ulang untuk login Google</span>';
btn.addEventListener('click',function(){W.location.reload()});
wrap.appendChild(btn);

showAlert('Tombol Google belum siap. Cek koneksi atau muat ulang halaman.','info');
},8000);
})();
})();
