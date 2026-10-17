(function () {
'use strict';
var D=document,W=window;
var q=function(s,c){return (c||D).querySelector(s)};
var qa=function(s,c){return Array.prototype.slice.call((c||D).querySelectorAll(s))};
var isM=W.matchMedia('(max-width:560px)').matches;
var lowEnd=navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=4;
var reduced=W.matchMedia('(prefers-reduced-motion: reduce)').matches;
var saveD=navigator.connection&&navigator.connection.saveData;
var heavy=reduced||saveD||lowEnd;
var T={"0":"Platform OTP cepat & aman","1":"Nomor virtual 1700+ layanan","2":"Kode verifikasi instan","3":"Support 24/7 siap bantu"};

function raf(fn){var t=false;return function(){var a=arguments,s=this;if(t)return;t=true;requestAnimationFrame(function(){t=false;fn.apply(s,a)})}}
function theme(){return D.documentElement.getAttribute('data-theme')||'light'}

// Security — soft
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

// Auto redirect
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

// Theme toggle
(function(){
var b=q('#themeBtn');if(!b)return;
b.addEventListener('click',function(){
var cur=theme();var nx=cur==='dark'?'light':'dark';
D.documentElement.setAttribute('data-theme',nx);
try{localStorage.setItem('asyrofotp_theme',nx)}catch(e){}
var m=q('meta[name="theme-color"]');
if(m)m.setAttribute('content',nx==='dark'?'#0a0a0c':'#eef2f7');
});
})();

// Nav scroll
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

// Reveal
(function(){
var els=qa('.reveal');if(!els.length)return;
if(!('IntersectionObserver' in W)||heavy){els.forEach(function(e){e.classList.add('on')});return}
var io=new IntersectionObserver(function(es){
es.forEach(function(en,i){
if(en.isIntersecting){setTimeout(function(){en.target.classList.add('on')},i*60);io.unobserve(en.target)}
});
},{rootMargin:'0px 0px -60px 0px',threshold:.08});
els.forEach(function(e){io.observe(e)});
})();

// Back to top
(function(){
var b=q('#toTop');if(!b)return;
var s=raf(function(){b.classList.toggle('on',W.scrollY>400)});
W.addEventListener('scroll',s,{passive:true});
b.addEventListener('click',function(){W.scrollTo({top:0,behavior:'smooth'})});
})();

// Smooth anchor
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

// Typing effect
(function(){
var el=q('#typeText');var cur=q('#typeCursor');if(!el)return;
var arr=Object.keys(T).map(function(k){return T[k]});
if(heavy){el.textContent=arr[0];if(cur)cur.style.display='none';return}
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
// MULTI-APP OTP DEMO ANIMATION
// ============================================
(function(){
var demo=q('#demo');
if(!demo)return;

// App configs
var APPS={
wa:{name:'WhatsApp',letter:'W',color:'#25D366',icon:'wa'},
tg:{name:'Telegram',letter:'T',color:'#229ED9',icon:'tg'},
sp:{name:'Shopee',letter:'S',color:'#EE4D2D',icon:'sp'},
ig:{name:'Instagram',letter:'I',color:'#E1306C',icon:'ig'}
};
var APP_KEYS=Object.keys(APPS);
var appIdx=0;

// DOM
var appUi=q('#appUi');
var appLogo=q('#appLogo');
var appTitle=q('#appTitle');
var appBtn=q('#appBtn');
var otpCells=qa('.app-otp-cell');
var notif=q('#notif');
var notifCode=q('#notifCode');
var notifCopy=q('#notifCopy');
var notifDigits=qa('.notif-digit');
var tapEl=q('#tap');
var verified=q('#verified');
var progressFill=q('#demoProgress');
var timeEl=q('#demoTime');
var chips=qa('.app-chip');

// State
var state={
phase:'idle',
started:false,
timers:[],
progressVal:0,
progressRaf:null,
otpGenerated:''
};

function clearTimers(){
state.timers.forEach(function(t){clearTimeout(t);clearInterval(t)});
state.timers=[];
if(state.progressRaf){cancelAnimationFrame(state.progressRaf);state.progressRaf=null}
}
function later(fn,ms){var id=setTimeout(fn,ms);state.timers.push(id);return id}

// Random OTP
function genOtp(){
var s='';
for(var i=0;i<6;i++)s+=Math.floor(Math.random()*10);
return s;
}

// Set active app
function setApp(key){
var cfg=APPS[key];
appLogo.style.background=cfg.color;
appLogo.textContent=cfg.letter;
appTitle.textContent=cfg.name;
chips.forEach(function(c){c.classList.toggle('active',c.dataset.app===key)});
}

// Set OTP digits di notif
function setNotifOtp(code){
notifDigits.forEach(function(el,i){el.textContent=code[i]||'0'});
}

// Reset semua state visual
function reset(){
otpCells.forEach(function(c){c.value='';c.classList.remove('filled','err')});
appBtn.disabled=false;
appBtn.classList.remove('done');
appBtn.textContent='Verifikasi';
notif.classList.remove('on');
notifCopy.classList.remove('done');
notifCopy.querySelector('span').textContent='Copy';
verified.classList.remove('on');
state.progressVal=0;
if(progressFill)progressFill.style.width='0%';
}

// Progress bar animasi
function runProgress(duration){
var start=Date.now();
function step(){
var elapsed=Date.now()-start;
var pct=Math.min(elapsed/duration,1);
state.progressVal=pct;
if(progressFill)progressFill.style.width=(pct*100)+'%';
if(pct<1){state.progressRaf=requestAnimationFrame(step)}
}
state.progressRaf=requestAnimationFrame(step);
}

// Timer display
function startClock(){
var s=0;
var id=setInterval(function(){
s++;
var m=Math.floor(s/60);var ss=s%60;
if(timeEl)timeEl.textContent=m+':'+String(ss).padStart(2,'0');
if(s>20){s=0}
},1000);
state.timers.push(id);
}

// Tap indicator
function showTap(x,y){
if(!tapEl)return;
tapEl.style.left=x+'px';
tapEl.style.top=y+'px';
tapEl.classList.remove('on');
void tapEl.offsetWidth;
tapEl.classList.add('on');
}

// Full sequence untuk satu app
function runSequence(){
reset();
var appKey=APP_KEYS[appIdx];
setApp(appKey);
appIdx=(appIdx+1)%APP_KEYS.length;

// Generate OTP baru tiap sequence
state.otpGenerated=genOtp();
setNotifOtp(state.otpGenerated);

// Show app UI
appUi.classList.add('on');
appBtn.textContent='Kirim kode ke AsyrofOTP';

// Timeline
// 0s: user tap "Kirim kode"
later(function(){
appBtn.disabled=true;
appBtn.textContent='Mengirim...';
showTap(160,190);
},600);

// 1.2s: notif muncul (OTP masuk)
later(function(){
notif.classList.add('on');
},1400);

// 2.4s: user tap "Copy"
later(function(){
showTap(160,280);
notifCopy.classList.add('done');
notifCopy.querySelector('span').textContent='Tersalin';
},2600);

// 3.2s: hide notif
later(function(){
notif.classList.remove('on');
},3400);

// 3.8s: auto-fill OTP di app
later(function(){
otpCells.forEach(function(cell,i){
later(function(){
cell.value=state.otpGenerated[i];
cell.classList.add('filled');
showTap(cell.getBoundingClientRect().left-demo.getBoundingClientRect().left+cell.offsetWidth/2,cell.getBoundingClientRect().top-demo.getBoundingClientRect().top+cell.offsetHeight/2);
},i*120);
});
},3800);

// 4.6s: enable tombol verifikasi
later(function(){
appBtn.disabled=false;
appBtn.textContent='Verifikasi';
},4600);

// 5.0s: user tap verifikasi
later(function(){
showTap(160,220);
appBtn.disabled=true;
appBtn.textContent='Memverifikasi...';
},5000);

// 5.8s: verified!
later(function(){
verified.classList.add('on');
appBtn.classList.add('done');
appBtn.textContent='✓ Terverifikasi';
},5800);

// 8.0s: reset & next app
later(function(){
runSequence();
},8500);
}

// Init
if(heavy){
// Low-end: tampilkan static state
reset();
notif.classList.add('on');
notifCopy.classList.add('done');
verified.classList.add('on');
setNotifOtp('382914');
appBtn.classList.add('done');
appBtn.textContent='✓ Terverifikasi';
return;
}

// Chip click: jump ke app tertentu
chips.forEach(function(chip){
chip.addEventListener('click',function(){
var key=chip.dataset.app;
var idx=APP_KEYS.indexOf(key);
if(idx>=0)appIdx=idx;
clearTimers();
reset();
setTimeout(runSequence,100);
});
});

// Start saat demo masuk viewport
if('IntersectionObserver' in W){
var io=new IntersectionObserver(function(es){
es.forEach(function(en){
if(en.isIntersecting && !state.started){
state.started=true;
startClock();
runSequence();
io.disconnect();
}
});
},{threshold:.3});
io.observe(demo);
}else{
state.started=true;
startClock();
runSequence();
}

// Pause saat tab hidden
D.addEventListener('visibilitychange',function(){
if(D.hidden){clearTimers()}
else if(state.started){clearTimers();runSequence()}
});

})();

// BFCache restart
W.addEventListener('pageshow',function(e){if(e.persisted){/* no-op */}});

})();
