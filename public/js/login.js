(function(){
'use strict';

var D=document,W=window;
var q=function(s,c){return (c||D).querySelector(s)};
var isLite=D.documentElement.getAttribute('data-perf')==='lite';

// ============================================
// ANTI-BYPASS (soft — F12 boleh)
// ============================================
(function(){
try{
console.log('%c⚠️ STOP!','color:#ff3b30;font-size:20px;font-weight:900');
console.log('%cJangan paste apapun di sini. Itu SCAM.','color:#8e8e93;font-size:12px');
}catch(e){}
D.addEventListener('contextmenu',function(e){e.preventDefault()});
D.addEventListener('keydown',function(e){
var k=e.key;
if(e.ctrlKey&&(k==='u'||k==='U'||k==='s'||k==='S')){e.preventDefault()}
},true);
D.addEventListener('copy',function(e){
var t=e.target;
if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
e.preventDefault();
});
D.addEventListener('cut',function(e){
var t=e.target;
if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
e.preventDefault();
});
try{
var u=W.location.origin+W.location.pathname;
if(W.location.search)history.replaceState(null,'',u);
}catch(e){}
})();

// ============================================
// SESSION STORAGE — Remember Me
// ============================================
var STORE_KEY='asyrof_login_cache_v1';

function readCache(){
try{
var raw=localStorage.getItem(STORE_KEY);
if(!raw)return null;
return JSON.parse(raw);
}catch(e){return null}
}
function writeCache(data){
try{localStorage.setItem(STORE_KEY,JSON.stringify(data))}catch(e){}
}
function clearCache(){
try{localStorage.removeItem(STORE_KEY)}catch(e){}
}
function updateCache(patch){
var c=readCache()||{};
var next=Object.assign({},c,patch);
writeCache(next);
return next;
}

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
if(r.ok){W.location.replace('/dashboard');return}
if(r.status===401||r.status===403){
try{
localStorage.removeItem('access_token');
localStorage.removeItem('user');
}catch(e){}
}
})
.catch(function(){clearTimeout(timer)});
})();

// ============================================
// THEME
// ============================================
(function(){
var b=q('#themeBtn');
if(!b)return;
b.addEventListener('click',function(){
var cur=D.documentElement.getAttribute('data-theme')||'light';
var nx=cur==='dark'?'light':'dark';
D.documentElement.setAttribute('data-theme',nx);
try{localStorage.setItem('asyrofotp_theme',nx)}catch(e){}
var m=q('meta[name="theme-color"]');
if(m)m.setAttribute('content',nx==='dark'?'#0a0a0c':'#eef2f7');
});
})();

// ============================================
// ELEMENTS
// ============================================
var form=q('#loginForm');
var alertEl=q('#alert');
var alertText=q('#alert-text');
var alertIcon=q('#alertIcon');
var submitBtn=q('#submitBtn');
var btnText=q('#btnText');
var btnIcon=q('#btnIcon');
var passwordInput=q('#password');
var togglePassword=q('#togglePassword');
var eyeIcon=q('#eyeIcon');
var usernameInput=q('#username');
var rememberInput=q('#rememberMe');
var statusRow=q('#statusRow');
var statusMark=q('#statusMark');
var statusLabel=q('#statusLabel');
var cacheInfo=q('#cacheInfo');
var cacheLastLogin=q('#cacheLastLogin');
var cacheUserId=q('#cacheUserId');
var cacheBalance=q('#cacheBalance');
var cacheClearBtn=q('#cacheClear');

if(!form)return;

// ============================================
// CACHE RENDER + PREFILL
// ============================================
function fmtRupiah(n){
var num=Number(n)||0;
return 'Rp'+num.toLocaleString('id-ID');
}
function fmtDate(iso){
if(!iso)return '—';
try{
return new Date(iso).toLocaleString('id-ID',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}catch(e){return '—'}
}

function renderCache(){
var c=readCache();
if(!c){
if(cacheInfo)cacheInfo.hidden=true;
return;
}
if(cacheInfo)cacheInfo.hidden=false;
if(cacheLastLogin)cacheLastLogin.textContent=fmtDate(c.lastLogin);
if(cacheUserId)cacheUserId.textContent=c.userId||'—';
if(cacheBalance)cacheBalance.textContent=c.balance!=null?fmtRupiah(c.balance):'—';
if(usernameInput&&c.username&&!usernameInput.value){
usernameInput.value=c.username;
}
if(rememberInput&&c.remember)rememberInput.checked=true;
}
renderCache();

if(rememberInput){
rememberInput.addEventListener('change',function(){
updateCache({remember:!!rememberInput.checked});
});
}

if(cacheClearBtn){
cacheClearBtn.addEventListener('click',function(){
clearCache();
if(cacheInfo)cacheInfo.hidden=true;
if(usernameInput)usernameInput.value='';
if(rememberInput)rememberInput.checked=false;
hideAlert();
});
}

// ============================================
// ALERT
// ============================================
var ALERT_ICONS={
info:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
error:'<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
success:'<polyline points="20 6 9 17 4 12"/>'
};
function showAlert(msg,type){
type=type||'error';
if(!alertEl)return;
alertEl.className='alert show '+type;
if(alertText)alertText.textContent=msg;
if(alertIcon)alertIcon.innerHTML=ALERT_ICONS[type]||ALERT_ICONS.info;
}
function hideAlert(){
if(alertEl)alertEl.className='alert';
}

// ============================================
// STATUS MARK
// ============================================
function setStatus(status,labelText){
if(!statusMark)return;
statusMark.setAttribute('data-status',status);
if(statusLabel&&labelText)statusLabel.textContent=labelText;
if(!statusRow)return;
if(status==='pending'){
statusRow.classList.remove('visible');
statusRow.setAttribute('aria-hidden','true');
}else{
statusRow.classList.add('visible');
statusRow.setAttribute('aria-hidden','false');
}
}

// ============================================
// PASSWORD TOGGLE
// ============================================
var EYE_OPEN='<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
var EYE_CLOSED='<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
var pwdVisible=false;
if(togglePassword){
togglePassword.addEventListener('click',function(){
pwdVisible=!pwdVisible;
passwordInput.type=pwdVisible?'text':'password';
if(eyeIcon)eyeIcon.innerHTML=pwdVisible?EYE_CLOSED:EYE_OPEN;
});
}

// ============================================
// RECAPTCHA WAIT
// ============================================
function waitForRecaptcha(){
return new Promise(function(resolve){
if(W.grecaptcha&&W.grecaptcha.execute)return resolve();
var attempts=0;
var timer=setInterval(function(){
attempts++;
if(W.grecaptcha&&W.grecaptcha.execute){
clearInterval(timer);resolve();
}else if(attempts>=50){
clearInterval(timer);resolve();
}
},100);
});
}

// ============================================
// SUBMIT
// ============================================
var RECAPTCHA_SITE_KEY='6LdLK9wtAAAAAEkN8PXmZ732lfM-YOSSCF1F7pbg';

form.addEventListener('submit',async function(e){
e.preventDefault();
hideAlert();

var username=usernameInput?usernameInput.value.trim():'';
var password=passwordInput?passwordInput.value:'';

if(!username||!password){
showAlert('Username dan password wajib diisi','error');
setStatus('failed','Data belum lengkap');
return;
}

submitBtn.disabled=true;
if(btnText)btnText.textContent='Memproses...';
var originalIconHTML=btnIcon?btnIcon.outerHTML:'';
if(btnIcon&&btnIcon.parentNode){
btnIcon.outerHTML='<span class="spinner" id="btnIcon"></span>';
}
setStatus('running','Memverifikasi kredensial...');

try{
await waitForRecaptcha();
if(!W.grecaptcha||!W.grecaptcha.execute){
throw new Error('Verifikasi keamanan gagal dimuat. Refresh halaman.');
}
setStatus('running','Memeriksa keamanan...');

var recaptchaToken=await new Promise(function(resolve,reject){
W.grecaptcha.ready(function(){
W.grecaptcha.execute(RECAPTCHA_SITE_KEY,{action:'login'})
.then(resolve)
.catch(reject);
});
setTimeout(function(){reject(new Error('Timeout verifikasi keamanan'))},10000);
});

setStatus('running','Menghubungi server...');

var res=await fetch('/api/auth/login',{
method:'POST',
headers:{'Content-Type':'application/json'},
body:JSON.stringify({username:username,password:password,recaptcha_token:recaptchaToken})
});

var data=await res.json();
if(!res.ok)throw new Error(data.error||'Login gagal');

// Save token & user
try{
localStorage.setItem('access_token',data.session.access_token);
if(data.session.refresh_token)localStorage.setItem('refresh_token',data.session.refresh_token);
localStorage.setItem('user',JSON.stringify(data.user));
}catch(e){}

// Update cache
var cacheNow={
username:username,
remember:rememberInput?!!rememberInput.checked:true,
lastLogin:new Date().toISOString(),
userId:data.user&&data.user.user_code?data.user.user_code:(data.user&&data.user.username)||null,
balance:data.user&&data.user.balance!=null?Number(data.user.balance):null,
name:data.user&&data.user.name?data.user.name:null
};
if(rememberInput&&!rememberInput.checked){
cacheNow.remember=false;
cacheNow.balance=null;
cacheNow.userId=null;
}
updateCache(cacheNow);

setStatus('done','Login berhasil!');
showAlert('Login berhasil! Mengalihkan...','success');

setTimeout(function(){W.location.replace('/dashboard')},800);

}catch(err){
setStatus('failed','Gagal login');
showAlert(err&&err.message?err.message:'Terjadi kesalahan','error');
if(submitBtn)submitBtn.disabled=false;
if(btnText)btnText.textContent='Masuk';
var oldIcon=q('#btnIcon');
if(oldIcon&&originalIconHTML){
oldIcon.outerHTML=originalIconHTML;
}
setTimeout(function(){setStatus('pending','Menunggu')},3000);
}
});

// ============================================
// ENTER KEY — biar submit tetap ke-handle
// ============================================
usernameInput&&usernameInput.addEventListener('keydown',function(e){
if(e.key==='Enter'){e.preventDefault();passwordInput&&passwordInput.focus()}
});

})();
