(function () {
'use strict';
var D=document,W=window;
var q=function(s,c){return (c||D).querySelector(s)};
var qa=function(s,c){return Array.prototype.slice.call((c||D).querySelectorAll(s))};
var PERF=D.documentElement.getAttribute('data-perf')||'full';
var isStatic=PERF==='static';
var isLite=PERF==='lite';
var T={"0":"Platform OTP cepat & aman","1":"Nomor virtual 1700+ layanan","2":"Kode verifikasi instan","3":"Support 24/7 siap bantu"};

function raf(fn){var t=false;return function(){var a=arguments,s=this;if(t)return;t=true;requestAnimationFrame(function(){t=false;fn.apply(s,a)})}}

// SECURITY
(function(){
try{console.log('%c⚠️ STOP!','color:#ff3b30;font-size:20px;font-weight:900');console.log('%cJangan paste apapun di sini. Itu SCAM.','color:#8e8e93;font-size:12px')}catch(e){}
D.addEventListener('contextmenu',function(e){e.preventDefault()});
D.addEventListener('keydown',function(e){
var k=e.key;
if(e.ctrlKey&&(k==='u'||k==='U'||k==='s'||k==='S')){e.preventDefault()}
},true);
D.addEventListener('copy',function(e){var t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;e.preventDefault()});
D.addEventListener('cut',function(e){var t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;e.preventDefault()});
try{var u=W.location.origin+W.location.pathname;if(W.location.search)history.replaceState(null,'',u)}catch(e){}
})();

// AUTO REDIRECT
(async function(){
var tk=null;try{tk=localStorage.getItem('access_token')}catch(e){}
if(!tk)return;
try{
var c=new AbortController();
var t=setTimeout(function(){c.abort()},5000);
var r=await fetch('/api/user',{headers:{Authorization:'Bearer '+tk},signal:c.signal});
clearTimeout(t);
if(r.ok){W.location.replace('/dashboard');return}
if(r.status===401||r.status===403){localStorage.removeItem('access_token');localStorage.removeItem('user')}
}catch(e){}
})();

// THEME
(function(){
var b=q('#themeBtn');if(!b)return;
b.addEventListener('click',function(){
var cur=D.documentElement.getAttribute('data-theme')||'light';
var nx=cur==='dark'?'light':'dark';
D.documentElement.setAttribute('data-theme',nx);
try{localStorage.setItem('asyrofotp_theme',nx)}catch(e){}
var m=q('meta[name="theme-color"]');
if(m)m.setAttribute('content',nx==='dark'?'#0a0a0c':'#eef2f7');
});
})();

// NAV SCROLL
(function(){
var n=q('#nav');if(!n)return;
var s=raf(function(){n.classList.toggle('scrolled',W.scrollY>10)});
W.addEventListener('scroll',s,{passive:true});
})();

// FAQ
(function(){
qa('.faq-q').forEach(function(b){
b.addEventListener('click',function(){
var it=b.parentElement;var on=it.classList.contains('active');
qa('.faq-item').forEach(function(i){i.classList.remove('active')});
if(!on)it.classList.add('active');
});
});
})();

// REVEAL
(function(){
var els=qa('.reveal');if(!els.length)return;
if(!('IntersectionObserver' in W)||isStatic){els.forEach(function(e){e.classList.add('on')});return}
var io=new IntersectionObserver(function(es){
es.forEach(function(en,i){
if(en.isIntersecting){setTimeout(function(){en.target.classList.add('on')},i*60);io.unobserve(en.target)}
});
},{rootMargin:'0px 0px -60px 0px',threshold:.08});
els.forEach(function(e){io.observe(e)});
})();

// TO TOP
(function(){
var b=q('#toTop');if(!b)return;
var s=raf(function(){b.classList.toggle('on',W.scrollY>400)});
W.addEventListener('scroll',s,{passive:true});
b.addEventListener('click',function(){W.scrollTo({top:0,behavior:'smooth'})});
})();

// SMOOTH ANCHOR
(function(){
D.addEventListener('click',function(e){
var a=e.target.closest('a[href^="#"]');if(!a)return;
var h=a.getAttribute('href');if(!h||h==='#'||h.length<2)return;
var t=D.querySelector(h);if(!t)return;
e.preventDefault();
var n=q('#nav');var nh=n?n.offsetHeight:0;
var top=t.getBoundingClientRect().top+W.scrollY-nh-12;
W.scrollTo({top:top,behavior:'smooth'});
});
})();

// TYPING
(function(){
var el=q('#typeText');var cur=q('#typeCursor');if(!el)return;
var arr=Object.keys(T).map(function(k){return T[k]});
if(isStatic){el.textContent=arr[0];if(cur)cur.style.display='none';return}
var i=0,ci=0,del=false,tm=null,started=false;
var TY=60,DL=30,PAUSE=1800;
function tick(){
var s=arr[i];
if(!del){
if(ci<s.length){el.textContent=s.slice(0,++ci);tm=setTimeout(tick,TY)}
else{tm=setTimeout(function(){del=true;tick()},PAUSE)}
}else{
if(ci>0){el.textContent=s.slice(0,--ci);tm=setTimeout(tick,DL)}
else{del=false;i=(i+1)%arr.length;tm=setTimeout(tick,400)}
}
}
function start(){if(started)return;started=true;tm=setTimeout(tick,400)}
if('IntersectionObserver' in W){
var io=new IntersectionObserver(function(es){
es.forEach(function(en){if(en.isIntersecting){start();io.disconnect()}});
},{threshold:.3});
io.observe(el);
}else start();
D.addEventListener('visibilitychange',function(){
if(D.hidden)clearTimeout(tm);else if(started){clearTimeout(tm);tick()}
});
})();

// ============================================
// DEMO MULTI-APP OTP ANIMATION
// ============================================
(function(){
var demo=q('#demo');if(!demo)return;
var APPS={
wa:{name:'WhatsApp',letter:'W',color:'#25D366'},
tg:{name:'Telegram',letter:'T',color:'#229ED9'},
sp:{name:'Shopee',letter:'S',color:'#EE4D2D'},
ig:{name:'Instagram',letter:'I',color:'#E1306C'}
};
var APP_KEYS=Object.keys(APPS);
var appIdx=0;

var appUi=q('#appUi');
var appLogo=q('#appLogo');
var appTitle=q('#appTitle');
var appBtn=q('#appBtn');
var otpCells=qa('.app-otp-cell');
var notif=q('#notif');
var notifCode=q('#notifCode');
var notifCopy=q('#notifCopy');
var notifDigits=qa('.notif-digit');
var verified=q('#verified');
var progressFill=q('#demoProgress');
var timeEl=q('#demoTime');
var chips=qa('.app-chip');

var state={started:false,timers:[],progressRaf:null,otp:''};

function clearT(){
state.timers.forEach(function(t){clearTimeout(t)});state.timers=[];
if(state.progressRaf){cancelAnimationFrame(state.progressRaf);state.progressRaf=null}
}
function later(fn,ms){var id=setTimeout(fn,ms);state.timers.push(id);return id}

function genOtp(){var s='';for(var i=0;i<6;i++)s+=Math.floor(Math.random()*10);return s}

function setApp(k){
var c=APPS[k];
appLogo.style.background=c.color;
appLogo.textContent=c.letter;
appTitle.textContent=c.name;
chips.forEach(function(ch){ch.classList.toggle('active',ch.dataset.app===k)});
}
function setOtp(code){notifDigits.forEach(function(el,i){el.textContent=code[i]||'0'})}

function reset(){
otpCells.forEach(function(c){c.textContent='';c.classList.remove('filled')});
appBtn.disabled=false;appBtn.classList.remove('done');
notif.classList.remove('on');notifCopy.classList.remove('done');
notifCopy.querySelector('span').textContent='Copy';
verified.classList.remove('on');
if(progressFill)progressFill.style.width='0%';
}

function runProgress(dur){
var st=Date.now();
function step(){
var e=Date.now()-st;var p=Math.min(e/dur,1);
if(progressFill)progressFill.style.width=(p*100)+'%';
if(p<1)state.progressRaf=requestAnimationFrame(step);
}
state.progressRaf=requestAnimationFrame(step);
}

function startClock(){
var s=0;
var id=setInterval(function(){
s=(s+1)%600;
var m=Math.floor(s/60);var ss=s%60;
if(timeEl)timeEl.textContent=m+':'+String(ss).padStart(2,'0');
},1000);
state.timers.push(id);
}

function runSeq(){
reset();
var key=APP_KEYS[appIdx];
setApp(key);
appIdx=(appIdx+1)%APP_KEYS.length;
state.otp=genOtp();
setOtp(state.otp);
appUi.classList.add('on');
appBtn.textContent='Kirim kode ke AsyrofOTP';

later(function(){appBtn.disabled=true;appBtn.textContent='Mengirim...'},600);
later(function(){notif.classList.add('on')},1500);
later(function(){notifCopy.classList.add('done');notifCopy.querySelector('span').textContent='Tersalin'},2600);
later(function(){notif.classList.remove('on')},3400);

later(function(){
otpCells.forEach(function(cell,i){
later(function(){cell.textContent=state.otp[i];cell.classList.add('filled')},i*120);
});
},3800);

later(function(){appBtn.disabled=false;appBtn.textContent='Verifikasi'},4600);
later(function(){appBtn.disabled=true;appBtn.textContent='Memverifikasi...'},5000);
later(function(){verified.classList.add('on');appBtn.classList.add('done');appBtn.textContent='✓ Terverifikasi'},5800);
later(function(){runSeq()},8500);
}

// Static fallback
if(isStatic){
reset();
notif.classList.add('on');
notifCopy.classList.add('done');
notifCopy.querySelector('span').textContent='Tersalin';
setOtp('382914');
otpCells.forEach(function(c,i){c.textContent='382914'[i];c.classList.add('filled')});
verified.classList.add('on');
appBtn.classList.add('done');appBtn.textContent='✓ Terverifikasi';
setApp('wa');
if(timeEl)timeEl.textContent='0:09';
return;
}

// Chip click
chips.forEach(function(ch){
ch.addEventListener('click',function(){
var k=ch.dataset.app;
var idx=APP_KEYS.indexOf(k);
if(idx>=0)appIdx=idx;
clearT();reset();setTimeout(runSeq,80);
});
});

// Start saat viewport
if('IntersectionObserver' in W){
var io=new IntersectionObserver(function(es){
es.forEach(function(en){
if(en.isIntersecting && !state.started){
state.started=true;
startClock();
runSeq();
io.disconnect();
}
});
},{threshold:.3});
io.observe(demo);
}else{
state.started=true;
startClock();
runSeq();
}

// Pause saat hidden
D.addEventListener('visibilitychange',function(){
if(D.hidden)clearT();
else if(state.started){clearT();runSeq()}
});
})();

// ============================================
// HOW ANIMATION — Cursor interaktif
// ============================================
(function(){
var wrap=q('#howDemo');if(!wrap)return;
if(isStatic){
qa('.how-step-row').forEach(function(r){r.classList.add('active')});
qa('.how-scr').forEach(function(s){s.classList.add('on')});
return;
}

var cursor=q('#howCursor');
var tap=q('#howTap');
var preview=q('#howPreview');
var steps=qa('.how-step-row');
var scrs=qa('.how-scr');
var previewRect=null;
var state={started:false,timers:[]};

function clearT(){state.timers.forEach(function(t){clearTimeout(t)});state.timers=[]}
function later(fn,ms){var id=setTimeout(fn,ms);state.timers.push(id);return id}

function moveCursor(x,y,ms){
if(!cursor)return;
cursor.style.transition='left .6s cubic-bezier(.4,0,.2,1),top .6s cubic-bezier(.4,0,.2,1),transform .15s,opacity .3s';
cursor.style.left=x+'px';
cursor.style.top=y+'px';
}

function pressCursor(){
if(!cursor)return;
cursor.classList.add('press');
setTimeout(function(){cursor.classList.remove('press')},150);
}

function showTap(x,y){
if(!tap)return;
tap.style.left=x+'px';tap.style.top=y+'px';
tap.classList.remove('on');void tap.offsetWidth;tap.classList.add('on');
}

function setStep(n){
steps.forEach(function(s){s.classList.toggle('active',s.dataset.step==String(n))});
scrs.forEach(function(s){s.classList.toggle('on',s.dataset.scr==String(n))});
}

function getRel(el){
if(!el||!previewRect)return null;
var r=el.getBoundingClientRect();
return {x:r.left-previewRect.left+r.width/2,y:r.top-previewRect.top+r.height/2};
}

function runLoop(){
if(!preview)return;
previewRect=preview.getBoundingClientRect();
if(!previewRect.width)return;

if(cursor)cursor.classList.add('on');

// STEP 1: Pilih Layanan
setStep(1);
later(function(){
var items=qa('.how-app-item');
var target=items[0];
var p=getRel(target);
if(p){moveCursor(p.x,p.y,600);later(function(){pressCursor();showTap(p.x,p.y);target.classList.add('picked')},650)}
},300);

// STEP 2: Pilih Negara
later(function(){
setStep(2);
},2200);
later(function(){
var items=qa('.how-country-item');
var target=items[3];
var p=getRel(target);
if(p){moveCursor(p.x,p.y,600);later(function(){pressCursor();showTap(p.x,p.y);target.classList.add('picked')},650)}
},2500);

// STEP 3: Isi Nomor
later(function(){
setStep(3);
},4400);
later(function(){
var hint=qa('.how-paste-hint')[0];
var p=getRel(hint);
if(p){moveCursor(p.x,p.y,600);later(function(){pressCursor();showTap(p.x,p.y)},650)}
},4700);

// STEP 4: Terima OTP
later(function(){
setStep(4);
},6400);
later(function(){
var note=qa('.how-otp-note')[0];
var p=getRel(note);
if(p){moveCursor(p.x,p.y,600);later(function(){pressCursor();showTap(p.x,p.y)},650)}
},6700);

// Reset & loop
later(function(){
qa('.how-app-item').forEach(function(i){i.classList.remove('picked')});
qa('.how-country-item').forEach(function(i){i.classList.remove('picked')});
runLoop();
},9500);
}

// Start saat viewport
if('IntersectionObserver' in W){
var io=new IntersectionObserver(function(es){
es.forEach(function(en){
if(en.isIntersecting && !state.started){
state.started=true;
setTimeout(runLoop,300);
io.disconnect();
}
});
},{threshold:.25});
io.observe(wrap);
}else{
state.started=true;
setTimeout(runLoop,300);
}

// Resize: recalc
W.addEventListener('resize',function(){
previewRect=preview?preview.getBoundingClientRect():null;
});

// Pause saat hidden
D.addEventListener('visibilitychange',function(){
if(D.hidden)clearT();
else if(state.started){clearT();setTimeout(runLoop,300)}
});
})();

// BFCACHE
W.addEventListener('pageshow',function(e){if(e.persisted){}});

})();
