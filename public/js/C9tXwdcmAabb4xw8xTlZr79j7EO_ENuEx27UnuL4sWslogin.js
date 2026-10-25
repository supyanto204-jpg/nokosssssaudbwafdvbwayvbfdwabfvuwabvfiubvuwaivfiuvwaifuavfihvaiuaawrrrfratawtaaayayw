(function(){
'use strict';
var D=document,W=window;
var q=function(s,c){return (c||D).querySelector(s)};

var STORE_KEY=atob('YXN5cm9mbG9naW5jYWNoZV92MTI=');
var SALT=atob('c2FsdF9zZWNyZXRfa2V5XzIwMjY=');
var XORKEY=atob('eG9yX2tleV9hc3lyb2Zfc2VjdXJl');

function enc(str){
var s=String(str||''),x='';
for(var i=0;i<s.length;i++)x+=String.fromCharCode(s.charCodeAt(i)^XORKEY.charCodeAt(i%XORKEY.length));
var b;
try{b=btoa(unescape(encodeURIComponent(x)))}catch(e){b=btoa(x)}
return btoa(SALT+'.'+b+'.'+SALT.split('').reverse().join(''));
}
function dec(v){
try{
var p=atob(v).split('.');
if(p.length!==3)return null;
var x;
try{x=decodeURIComponent(escape(atob(p[1])))}catch(e){x=atob(p[1])}
var o='';
for(var i=0;i<x.length;i++)o+=String.fromCharCode(x.charCodeAt(i)^XORKEY.charCodeAt(i%XORKEY.length));
return o;
}catch(e){return null}
}
function readCache(){
try{
var raw=localStorage.getItem(STORE_KEY);
if(!raw)return null;
var j=dec(raw);
if(!j)return null;
var o=JSON.parse(j);
return (o&&typeof o==='object')?o:null;
}catch(e){return null}
}
function writeCache(o){
try{localStorage.setItem(STORE_KEY,enc(JSON.stringify(o)));return true}catch(e){return false}
}
function patchCache(p){return writeCache(Object.assign({},readCache()||{},p))}

// redirect kalau sudah login (jalan instan di background)
(function(){
var tk;try{tk=localStorage.getItem('access_token')}catch(e){}
if(!tk)return;
fetch('/api/user',{headers:{Authorization:'Bearer '+tk}})
.then(function(r){
if(r.ok){W.location.replace('/dashboard');return}
if(r.status===401||r.status===403){
try{localStorage.removeItem('access_token');localStorage.removeItem('user');}catch(e){}
}
}).catch(function(){});
})();

// theme
(function(){
var b=q('#themeBtn');if(!b)return;
var root=D.documentElement;
var mq=W.matchMedia?W.matchMedia('(prefers-color-scheme: dark)'):null;
function resolve(p){return p==='system'?(mq&&mq.matches?'dark':'light'):p}
function paintMeta(t){
var m=q('meta[name="theme-color"]');
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

var form=q('#loginForm');
if(!form)return;

var alertEl=q('#alert');
var alertText=q('#alert-text');
var alertIcon=q('#alertIcon');
var submitBtn=q('#submitBtn');
var btnText=q('#btnText');
var btnIcon=q('#btnIcon');
var passIn=q('#password');
var eyeBtn=q('#togglePassword');
var eyeIcon=q('#eyeIcon');
var userIn=q('#username');
var rememberIn=q('#rememberMe');
var statusRow=q('#statusRow');
var statusLabel=q('#statusLabel');

(function(){
var c=readCache();
if(!c)return;
if(userIn&&c.username&&!userIn.value)userIn.value=c.username;
if(rememberIn&&c.remember)rememberIn.checked=true;
})();

if(rememberIn){
rememberIn.addEventListener('change',function(){
patchCache({remember:!!rememberIn.checked});
});
}

var ICONS={
info:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
error:'<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
success:'<polyline points="20 6 9 17 4 12"/>'
};
function showAlert(msg,type){
type=type||'error';
if(!alertEl)return;
alertEl.className='alert show '+type;
if(alertText)alertText.textContent=msg;
if(alertIcon)alertIcon.innerHTML=ICONS[type]||ICONS.info;
}
function hideAlert(){if(alertEl)alertEl.className='alert'}

function setStatus(state,label){
if(!statusRow)return;
statusRow.dataset.state=state;
if(statusLabel&&label)statusLabel.textContent=label;
if(state==='pending'){statusRow.classList.remove('visible');statusRow.setAttribute('aria-hidden','true');}
else{statusRow.classList.add('visible');statusRow.setAttribute('aria-hidden','false');}
}

var EYE_OPEN='<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
var EYE_CLOSED='<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
var passVisible=false;
if(eyeBtn){
eyeBtn.addEventListener('click',function(){
passVisible=!passVisible;
passIn.type=passVisible?'text':'password';
if(eyeIcon)eyeIcon.innerHTML=passVisible?EYE_CLOSED:EYE_OPEN;
});
}

var RECAPTCHA_KEY='6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg';
function waitRecaptcha(){
return new Promise(function(resolve){
if(W.grecaptcha&&W.grecaptcha.execute)return resolve();
var n=0;
var t=setInterval(function(){
n++;
if(W.grecaptcha&&W.grecaptcha.execute){clearInterval(t);resolve()}
else if(n>=50){clearInterval(t);resolve()}
},50); // 50ms aja, biar cepet
});
}

form.addEventListener('submit',async function(e){
e.preventDefault();
hideAlert();

// Trim input
var u=userIn?userIn.value.trim():'';
var p=passIn?passIn.value:'';

// Jika user memasukkan email, pastikan lowercase. Jika username, juga lowercase.
var isEmail = u.includes('@');
var finalUser = isEmail ? u.toLowerCase() : u; // Backend pakai .toLowerCase() juga sih, tapi biar aman

if(!finalUser||!p){
showAlert('Username/Email dan password wajib diisi','error');
setStatus('failed','Data belum lengkap');
return;
}

submitBtn.disabled=true;
if(btnText)btnText.textContent='Memproses...';
var origIcon=btnIcon?btnIcon.outerHTML:'';
if(btnIcon&&btnIcon.parentNode)btnIcon.outerHTML='<span class="spinner" id="btnIcon"></span>';
setStatus('running','Memverifikasi...');

try{
await waitRecaptcha();
if(!W.grecaptcha||!W.grecaptcha.execute)throw new Error('Gagal memuat keamanan. Refresh.');

var token=await new Promise(function(resolve,reject){
W.grecaptcha.ready(function(){
W.grecaptcha.execute(RECAPTCHA_KEY,{action:'login'}).then(resolve).catch(reject);
});
setTimeout(function(){reject(new Error('Timeout'))},8000);
});

var res=await fetch('/api/auth/login',{
method:'POST',
headers:{'Content-Type':'application/json'},
body:JSON.stringify({username:finalUser,password:p,recaptcha_token:token}) // Kirim finalUser
});

var data=await res.json();
if(!res.ok)throw new Error(data.error||'Login gagal');

try{
localStorage.setItem('access_token',data.session.access_token);
if(data.session.refresh_token)localStorage.setItem('refresh_token',data.session.refresh_token);
localStorage.setItem('user',JSON.stringify(data.user));
}catch(e){}

var cacheNow={
username:finalUser,
remember:rememberIn?!!rememberIn.checked:true,
lastLogin:new Date().toISOString(),
userId:(data.user&&data.user.user_code)?data.user.user_code:((data.user&&data.user.username)||null),
balance:(data.user&&data.user.balance!=null)?Number(data.user.balance):null,
name:(data.user&&data.user.name)?data.user.name:null
};
if(rememberIn&&!rememberIn.checked){
cacheNow.remember=false;
cacheNow.balance=null;
cacheNow.userId=null;
}
patchCache(cacheNow);

setStatus('done','Login berhasil!');
showAlert('Login berhasil! Mengalihkan...','success');

// LANGSUNG PINDAH TANPA DELAY
W.location.replace('/dashboard');

}catch(err){
setStatus('failed','Gagal login');
showAlert(err&&err.message?err.message:'Terjadi kesalahan','error');
if(submitBtn)submitBtn.disabled=false;
if(btnText)btnText.textContent='Masuk';
var oldIcon=q('#btnIcon');
if(oldIcon&&origIcon)oldIcon.outerHTML=origIcon;
setTimeout(function(){setStatus('pending','Menunggu')},3000);
}
});

if(userIn){
userIn.addEventListener('keydown',function(e){
if(e.key==='Enter'){e.preventDefault();if(passIn)passIn.focus()}
});
}
})();
