(function(_0x1,_0x2){
'use strict';
var _a=document,_b=window;
var _c=function(s,c){return (c||_a).querySelector(s)};
var _d=function(sel){return Array.prototype.slice.call((_a||document).querySelectorAll(sel))};

var S1='YXN5cm9mbG9naW5jYWNoZV92MTI=';
var S2='c2FsdF9zZWNyZXRfa2V5XzIwMjY=';
var S3='eG9yX2tleV9hc3lyb2Zfc2VjdXJl';
var STORE_KEY=atob(S1);
var SALT=atob(S2);
var XORKEY=atob(S3);

function _enc(str){
var s=String(str||'');
var x='';
for(var i=0;i<s.length;i++){
x+=String.fromCharCode(s.charCodeAt(i)^XORKEY.charCodeAt(i%XORKEY.length));
}
var b=null;
try{b=btoa(unescape(encodeURIComponent(x)));}catch(e){b=btoa(x);}
return btoa(SALT+'.'+b+'.'+SALT.split('').reverse().join(''));
}

function _dec(encoded){
try{
var parts=atob(encoded).split('.');
if(parts.length!==3)return null;
var x='';
try{x=decodeURIComponent(escape(atob(parts[1])));}catch(e){x=atob(parts[1]);}
var out='';
for(var i=0;i<x.length;i++){
out+=String.fromCharCode(x.charCodeAt(i)^XORKEY.charCodeAt(i%XORKEY.length));
}
return out;
}catch(e){return null;}
}

function _read(){
try{
var raw=localStorage.getItem(STORE_KEY);
if(!raw)return null;
var json=_dec(raw);
if(!json)return null;
var obj=JSON.parse(json);
return (obj&&typeof obj==='object')?obj:null;
}catch(e){return null}
}
function _write(obj){
try{localStorage.setItem(STORE_KEY,_enc(JSON.stringify(obj)));return true}catch(e){return false}
}
function _patch(p){return _write(Object.assign({},_read()||{},p))}
function _clear(){try{localStorage.removeItem(STORE_KEY)}catch(e){}}

// redirect kalau sudah login
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

// theme: light -> dark -> system
(function(){
var b=_c('#themeBtn');
if(!b)return;
var root=_a.documentElement;
var mq=_b.matchMedia?_b.matchMedia('(prefers-color-scheme: dark)'):null;

function resolve(p){return p==='system'?(mq&&mq.matches?'dark':'light'):p}
function paintMeta(t){
var m=_c('meta[name="theme-color"]');
if(m)m.setAttribute('content',t==='dark'?'#0a0b0d':'#0a84ff');
}
function setPref(p,save){
root.setAttribute('data-theme-pref',p);
var r=resolve(p);
root.setAttribute('data-theme',r);
paintMeta(r);
if(save){try{localStorage.setItem('asyrofotp_theme_pref',p)}catch(e){}}
}

b.addEventListener('click',function(){
var cur=root.getAttribute('data-theme-pref')||'system';
setPref(cur==='light'?'dark':cur==='dark'?'system':'light',true);
});

if(mq){
var onChange=function(){
if(root.getAttribute('data-theme-pref')==='system')setPref('system',false);
};
if(mq.addEventListener)mq.addEventListener('change',onChange);
else if(mq.addListener)mq.addListener(onChange);
}
})();

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

(function renderCache(){
var c=_read();
if(!c)return;
if(_user&&c.username&&!_user.value)_user.value=c.username;
if(_remember&&c.remember)_remember.checked=true;
})();

if(_remember){
_remember.addEventListener('change',function(){
_patch({remember:!!_remember.checked});
});
}

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
function _hideAlert(){if(_alert)_alert.className='alert'}

function _setStatus(state,label){
if(!_statusRow)return;
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

function _waitRecap(){
return new Promise(function(resolve){
if(_b.grecaptcha&&_b.grecaptcha.execute)return resolve();
var n=0;
var t=setInterval(function(){
n++;
if(_b.grecaptcha&&_b.grecaptcha.execute){clearInterval(t);resolve()}
else if(n>=50){clearInterval(t);resolve()}
},100);
});
}

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
if(_btnIcon&&_btnIcon.parentNode)_btnIcon.outerHTML='<span class="spinner" id="btnIcon"></span>';
_setStatus('running','Memverifikasi kredensial...');

try{
await _waitRecap();
if(!_b.grecaptcha||!_b.grecaptcha.execute)throw new Error('Verifikasi keamanan gagal dimuat. Refresh halaman.');
_setStatus('running','Memeriksa keamanan...');

var recaptchaToken=await new Promise(function(resolve,reject){
_b.grecaptcha.ready(function(){
_b.grecaptcha.execute(_RK,{action:'login'}).then(resolve).catch(reject);
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
if(oldIcon&&origIcon)oldIcon.outerHTML=origIcon;
setTimeout(function(){_setStatus('pending','Menunggu')},3000);
}
});

if(_user){
_user.addEventListener('keydown',function(e){
if(e.key==='Enter'){e.preventDefault();if(_password)_password.focus()}
});
}

})();
