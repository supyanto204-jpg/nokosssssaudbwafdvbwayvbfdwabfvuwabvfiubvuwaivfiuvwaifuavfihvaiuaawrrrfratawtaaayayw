(function(_0x1,_0x2){
'use strict';
var _a=document,_b=window;
var _c=function(s,c){return (c||_a).querySelector(s)};
var _d=function(sel){return Array.prototype.slice.call((_a||document).querySelectorAll(sel))};

// ============================================
// CONSTANTS (base64 encoded untuk anti-tebak)
// ============================================
var S1='YXN5cm9mbG9naW5jYWNoZV92MTI='; // "asyrof_login_cache_v12"
var S2='c2FsdF9zZWNyZXRfa2V5XzIwMjY='; // "salt_secret_key_2026"
var S3='eG9yX2tleV9hc3lyb2Zfc2VjdXJl'; // "xor_key_asyrof_secure"
var STORE_KEY=atob(S1);
var SALT=atob(S2);
var XORKEY=atob(S3);

// ============================================
// UTIL: base64 + xor + salt + hash ringan
// ============================================
function _enc(str){
var s=String(str||'');
var x='';
for(var i=0;i<s.length;i++){
var ch=s.charCodeAt(i);
var k=XORKEY.charCodeAt(i%XORKEY.length);
x+=String.fromCharCode(ch^k);
}
var b=null;
try{
b=btoa(unescape(encodeURIComponent(x)));
}catch(e){
b=btoa(x);
}
var mixed=SALT+'.'+b+'.'+SALT.split('').reverse().join('');
return btoa(mixed);
}

function _dec(encoded){
try{
var raw=atob(encoded);
var parts=raw.split('.');
if(parts.length!==3)return null;
var b=parts[1];
var x='';
try{
x=decodeURIComponent(escape(atob(b)));
}catch(e){
x=atob(b);
}
var out='';
for(var i=0;i<x.length;i++){
var ch=x.charCodeAt(i);
var k=XORKEY.charCodeAt(i%XORKEY.length);
out+=String.fromCharCode(ch^k);
}
return out;
}catch(e){
return null;
}
}

// ============================================
// CACHE
// ============================================
function _read(){
try{
var raw=localStorage.getItem(STORE_KEY);
if(!raw)return null;
var json=_dec(raw);
if(!json)return null;
var obj=JSON.parse(json);
if(!obj||typeof obj!=='object')return null;
return obj;
}catch(e){return null}
}
function _write(obj){
try{
var json=JSON.stringify(obj);
var encoded=_enc(json);
localStorage.setItem(STORE_KEY,encoded);
return true;
}catch(e){return false}
}
function _patch(p){
var c=_read()||{};
var next=Object.assign({},c,p);
return _write(next);
}
function _clear(){
try{localStorage.removeItem(STORE_KEY)}catch(e){}
}

// ============================================
// ANTI-BYPASS
// ============================================
(function(){
try{
var a='%c⚠️ STOP!';
var b='%cJangan paste apapun di sini. Itu SCAM.';
console.log(a,'color:#ff3b30;font-size:20px;font-weight:900');
console.log(b,'color:#8e8e93;font-size:12px');
}catch(e){}

_a.addEventListener('contextmenu',function(e){e.preventDefault()});
_a.addEventListener('keydown',function(e){
var k=e.key;
if(e.ctrlKey&&(k==='u'||k==='U'||k==='s'||k==='S')){e.preventDefault()}
},true);
_a.addEventListener('copy',function(e){
var t=e.target;
if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
e.preventDefault();
});
_a.addEventListener('cut',function(e){
var t=e.target;
if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
e.preventDefault();
});

try{
var clean=_b.location.origin+_b.location.pathname;
if(_b.location.search)history.replaceState(null,'',clean);
}catch(e){}

// Deteksi iframe embed
if(_b.top!==_b.self){
try{_b.top.location=_b.self.location}catch(e){}
_a.documentElement.innerHTML='<body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;"><h1>⛔</h1></div></body>';
}
})();

// ============================================
// AUTO REDIRECT kalau sudah login
// ============================================
(function(){
var tk=null;
try{tk=localStorage.getItem('access_token')}catch(e){}
if(!tk)return;
var ctrl=new AbortController();
var timer=setTimeout(function(){ctrl.abort()},5000);
fetch('/api/user',{headers:{Authorization:'Bearer '+tk},signal:ctrl.signal})
.then(function(r){
clearTimeout(timer);
if(r.ok){_b.location.replace('/dashboard');return}
if(r.status===401||r.status===403){
try{
localStorage.removeItem('access_token');
localStorage.removeItem('user');
localStorage.removeItem('refresh_token');
}catch(e){}
}
})
.catch(function(){clearTimeout(timer)});
})();

// ============================================
// THEME
// ============================================
(function(){
var b=_c('#themeBtn');
if(!b)return;
b.addEventListener('click',function(){
var cur=_a.documentElement.getAttribute('data-theme')||'light';
var nx=cur==='dark'?'light':'dark';
_a.documentElement.setAttribute('data-theme',nx);
try{localStorage.setItem('asyrofotp_theme',nx)}catch(e){}
var m=_c('meta[name="theme-color"]');
if(m)m.setAttribute('content',nx==='dark'?'#0a0a0c':'#eef2f7');
});
})();

// ============================================
// ELEMENTS
// ============================================
var _form=_c('#loginForm');
var _alert=_c('#alert');
var _alertText=_c('#alert-text');
var _alertIcon=_c('#alertIcon');
var _submit=_c('#submitBtn');
var _btnText=_c('#btnText');
var _btnIcon=_c('#btnIcon');
var _password=_c('#password');
var _eye=_c('#togglePassword');
var _eyeIcon=_c('#eyeIcon');
var _user=_c('#username');
var _remember=_c('#rememberMe');
var _statusRow=_c('#statusRow');
var _statusLabel=_c('#statusLabel');

if(!_form)return;

// ============================================
// CACHE RENDER (hanya prefill, tidak tampilkan card)
// ============================================
function _renderCache(){
var c=_read();
if(!c)return;
if(_user&&c.username&&!_user.value){
_user.value=c.username;
}
if(_remember&&c.remember)_remember.checked=true;
}
_renderCache();

if(_remember){
_remember.addEventListener('change',function(){
_patch({remember:!!_remember.checked});
});
}

// ============================================
// ALERT
// ============================================
var _ai={
info:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
error:'<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
success:'<polyline points="20 6 9 17 4 12"/>'
};
function _showAlert(msg,type){
type=type||'error';
if(!_alert)return;
_alert.className='alert show '+type;
if(_alertText)_alertText.textContent=msg;
if(_alertIcon)_alertIcon.innerHTML=_ai[type]||_ai.info;
}
function _hideAlert(){
if(_alert)_alert.className='alert';
}

// ============================================
// STATUS
// ============================================
function _setStatus(state,label){
if(!_statusRow)return;
if(!_statusRow.dataset)_statusRow.dataset={};
_statusRow.dataset.state=state;
if(_statusLabel&&label)_statusLabel.textContent=label;
if(state==='pending'){
_statusRow.classList.remove('visible');
_statusRow.setAttribute('aria-hidden','true');
}else{
_statusRow.classList.add('visible');
_statusRow.setAttribute('aria-hidden','false');
}
}

// ============================================
// PASSWORD TOGGLE
// ============================================
var _eo='<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
var _ec='<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
var _pv=false;
if(_eye){
_eye.addEventListener('click',function(){
_pv=!_pv;
_password.type=_pv?'text':'password';
if(_eyeIcon)_eyeIcon.innerHTML=_pv?_ec:_eo;
});
}

// ============================================
// RECAPTCHA WAIT
// ============================================
function _waitRecap(){
return new Promise(function(resolve){
if(_b.grecaptcha&&_b.grecaptcha.execute)return resolve();
var n=0;
var t=setInterval(function(){
n++;
if(_b.grecaptcha&&_b.grecaptcha.execute){
clearInterval(t);resolve();
}else if(n>=50){
clearInterval(t);resolve();
}
},100);
});
}

// ============================================
// SUBMIT
// ============================================
var _RK='6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg';

_form.addEventListener('submit',async function(e){
e.preventDefault();
_hideAlert();

var u=_user?_user.value.trim():'';
var p=_password?_password.value:'';

if(!u||!p){
_showAlert('Username dan password wajib diisi','error');
_setStatus('failed','Data belum lengkap');
return;
}

_submit.disabled=true;
if(_btnText)_btnText.textContent='Memproses...';
var origIcon=_btnIcon?_btnIcon.outerHTML:'';
if(_btnIcon&&_btnIcon.parentNode){
_btnIcon.outerHTML='<span class="spinner" id="btnIcon"></span>';
}
_setStatus('running','Memverifikasi kredensial...');

try{
await _waitRecap();
if(!_b.grecaptcha||!_b.grecaptcha.execute){
throw new Error('Verifikasi keamanan gagal dimuat. Refresh halaman.');
}
_setStatus('running','Memeriksa keamanan...');

var recaptchaToken=await new Promise(function(resolve,reject){
_b.grecaptcha.ready(function(){
_b.grecaptcha.execute(_RK,{action:'login'})
.then(resolve)
.catch(reject);
});
setTimeout(function(){reject(new Error('Timeout verifikasi keamanan'))},10000);
});

_setStatus('running','Menghubungi server...');

var res=await fetch('/api/auth/login',{
method:'POST',
headers:{'Content-Type':'application/json'},
body:JSON.stringify({username:u,password:p,recaptcha_token:recaptchaToken})
});

var data=await res.json();
if(!res.ok)throw new Error(data.error||'Login gagal');

try{
localStorage.setItem('access_token',data.session.access_token);
if(data.session.refresh_token)localStorage.setItem('refresh_token',data.session.refresh_token);
localStorage.setItem('user',JSON.stringify(data.user));
}catch(e){}

// CACHE (encoded)
var cacheNow={
username:u,
remember:_remember?!!_remember.checked:true,
lastLogin:new Date().toISOString(),
userId:(data.user&&data.user.user_code)?data.user.user_code:((data.user&&data.user.username)||null),
balance:(data.user&&data.user.balance!=null)?Number(data.user.balance):null,
name:(data.user&&data.user.name)?data.user.name:null
};
if(_remember&&!_remember.checked){
cacheNow.remember=false;
cacheNow.balance=null;
cacheNow.userId=null;
}
_patch(cacheNow);

_setStatus('done','Login berhasil!');
_showAlert('Login berhasil! Mengalihkan...','success');

setTimeout(function(){_b.location.replace('/dashboard')},800);

}catch(err){
_setStatus('failed','Gagal login');
_showAlert(err&&err.message?err.message:'Terjadi kesalahan','error');
if(_submit)_submit.disabled=false;
if(_btnText)_btnText.textContent='Masuk';
var oldIcon=_c('#btnIcon');
if(oldIcon&&origIcon){
oldIcon.outerHTML=origIcon;
}
setTimeout(function(){_setStatus('pending','Menunggu')},3000);
}
});

// Enter di username
if(_user){
_user.addEventListener('keydown',function(e){
if(e.key==='Enter'){e.preventDefault();if(_password)_password.focus()}
});
}

})();
