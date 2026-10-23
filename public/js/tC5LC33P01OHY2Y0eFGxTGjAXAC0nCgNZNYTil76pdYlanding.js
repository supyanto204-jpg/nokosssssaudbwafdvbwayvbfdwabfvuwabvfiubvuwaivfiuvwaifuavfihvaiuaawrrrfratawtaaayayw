(function () {
'use strict';

var D=document,W=window;
var q=function(s,c){return (c||D).querySelector(s)};
var qa=function(s,c){return Array.prototype.slice.call((c||D).querySelectorAll(s))};
var reduced=W.matchMedia&&W.matchMedia('(prefers-reduced-motion: reduce)').matches;
var isLite=D.documentElement.getAttribute('data-perf')==='lite';
var T={"0":"Tanpa nomor pribadi","1":"1.700+ aplikasi siap verifikasi","2":"OTP masuk rata-rata 5 detik","3":"Refund otomatis kalau gagal"};

function raf(fn){var t=false;return function(){var a=arguments,s=this;if(t)return;t=true;requestAnimationFrame(function(){t=false;fn.apply(s,a)})}}

// ============================================
// SECURITY (soft)
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
// THEME TOGGLE
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
// NAV SCROLL
// ============================================
(function(){
var n=q('#nav');
if(!n)return;
var s=raf(function(){n.classList.toggle('scrolled',W.scrollY>10)});
W.addEventListener('scroll',s,{passive:true});
})();

// ============================================
// FAQ ACCORDION
// ============================================
(function(){
qa('.faq-q').forEach(function(b){
b.addEventListener('click',function(){
var it=b.parentElement;
if(!it)return;
var on=it.classList.contains('active');
qa('.faq-item').forEach(function(i){i.classList.remove('active')});
if(!on)it.classList.add('active');
});
});
})();

// ============================================
// REVEAL ON SCROLL
// ============================================
(function(){
var els=qa('.reveal');
if(!els.length)return;
if(!('IntersectionObserver' in W)){
els.forEach(function(e){e.classList.add('on')});
return;
}
var io=new IntersectionObserver(function(es){
es.forEach(function(en,i){
if(en.isIntersecting){
setTimeout(function(){en.target.classList.add('on')},i*50);
io.unobserve(en.target);
}
});
},{rootMargin:'0px 0px -60px 0px',threshold:.06});
els.forEach(function(e){io.observe(e)});
})();

// ============================================
// TO TOP
// ============================================
(function(){
var b=q('#toTop');
if(!b)return;
var s=raf(function(){b.classList.toggle('on',W.scrollY>400)});
W.addEventListener('scroll',s,{passive:true});
b.addEventListener('click',function(){W.scrollTo({top:0,behavior:'smooth'})});
})();

// ============================================
// SMOOTH ANCHOR
// ============================================
(function(){
D.addEventListener('click',function(e){
var a=e.target.closest('a[href^="#"]');
if(!a)return;
var h=a.getAttribute('href');
if(!h||h==='#'||h.length<2)return;
var t=D.querySelector(h);
if(!t)return;
e.preventDefault();
var n=q('#nav');
var nh=n?n.offsetHeight:0;
var top=t.getBoundingClientRect().top+W.scrollY-nh-12;
W.scrollTo({top:top,behavior:'smooth'});
});
})();

// ============================================
// TYPING EFFECT
// ============================================
(function(){
var el=q('#typeText');
var cur=q('#typeCursor');
if(!el)return;
var arr=Object.keys(T).map(function(k){return T[k]});
if(reduced){
el.textContent=arr[0];
if(cur)cur.style.display='none';
return;
}
var i=0,ci=0,del=false,tm=null,started=false;
var TY=55,DL=28,PAUSE=1700;
function tick(){
var s=arr[i];
if(!del){
if(ci<s.length){
el.textContent=s.slice(0,++ci);
tm=setTimeout(tick,TY);
}else{
tm=setTimeout(function(){del=true;tick()},PAUSE);
}
}else{
if(ci>0){
el.textContent=s.slice(0,--ci);
tm=setTimeout(tick,DL);
}else{
del=false;
i=(i+1)%arr.length;
tm=setTimeout(tick,350);
}
}
}
function start(){
if(started)return;
started=true;
tm=setTimeout(tick,300);
}
if('IntersectionObserver' in W){
var io=new IntersectionObserver(function(es){
es.forEach(function(en){
if(en.isIntersecting){start();io.disconnect()}
});
},{threshold:.3});
io.observe(el);
}else start();
D.addEventListener('visibilitychange',function(){
if(D.hidden)clearTimeout(tm);
else if(started){clearTimeout(tm);tick()}
});
})();

// ============================================
// DEMO WHATSAPP VERIFICATION
// ============================================
(function(){
var demo=q('#demo');
if(!demo)return;

var appBtn=q('#appBtn');
var otpCells=qa('.app-otp-cell');
var notif=q('#notif');
var notifCopy=q('#notifCopy');
var notifDigits=qa('.notif-digit');
var verified=q('#verified');
var progressFill=q('#demoProgress');
var timeEl=q('#demoTime');

if(!appBtn||!notif||!notifCopy||!verified)return;

var state={started:false,timers:[],progressRaf:null,otp:'',running:false};

function clearT(){
state.timers.forEach(function(t){clearTimeout(t)});
state.timers=[];
if(state.progressRaf){cancelAnimationFrame(state.progressRaf);state.progressRaf=null}
}
function later(fn,ms){
var id=setTimeout(fn,ms);
state.timers.push(id);
return id;
}
function genOtp(){
var s='';
for(var i=0;i<6;i++)s+=Math.floor(Math.random()*10);
return s;
}
function setOtp(c){
notifDigits.forEach(function(el,i){el.textContent=c[i]||'0'});
}

function reset(){
otpCells.forEach(function(c){c.textContent='';c.classList.remove('filled')});
appBtn.disabled=true;
appBtn.classList.remove('done');
appBtn.textContent='Verifikasi';
notif.classList.remove('on');
notifCopy.classList.remove('done');
var copySpan=notifCopy.querySelector('span');
if(copySpan)copySpan.textContent='Salin Kode';
verified.classList.remove('on');
if(progressFill)progressFill.style.width='0%';
}

function runProgress(dur){
if(!progressFill)return;
var st=Date.now();
function step(){
var e=Date.now()-st;
var p=Math.min(e/dur,1);
progressFill.style.width=(p*100)+'%';
if(p<1)state.progressRaf=requestAnimationFrame(step);
}
state.progressRaf=requestAnimationFrame(step);
}

function startClock(){
var s=0;
var id=setInterval(function(){
s=(s+1)%600;
var m=Math.floor(s/60);
var ss=s%60;
if(timeEl)timeEl.textContent=m+':'+String(ss).padStart(2,'0');
},1000);
state.timers.push(id);
}

function runSeq(){
if(state.running)return;
state.running=true;
reset();
state.otp=genOtp();
setOtp(state.otp);
runProgress(8500);

later(function(){
appBtn.disabled=true;
appBtn.textContent='Mengirim...';
},500);
later(function(){notif.classList.add('on')},1500);
later(function(){
notifCopy.classList.add('done');
var copySpan=notifCopy.querySelector('span');
if(copySpan)copySpan.textContent='Tersalin';
},2600);
later(function(){notif.classList.remove('on')},3400);
later(function(){
otpCells.forEach(function(cell,i){
later(function(){
cell.textContent=state.otp[i];
cell.classList.add('filled');
},i*120);
});
},3800);
later(function(){
appBtn.disabled=false;
appBtn.textContent='Verifikasi';
},4800);
later(function(){
appBtn.disabled=true;
appBtn.textContent='Memverifikasi...';
},5200);
later(function(){
verified.classList.add('on');
appBtn.classList.add('done');
appBtn.textContent='✓ Terverifikasi';
},6000);
later(function(){
state.running=false;
runSeq();
},8500);
}

// Fallback kalau reduced motion
if(reduced||isLite){
reset();
notif.classList.add('on');
notifCopy.classList.add('done');
var copySpan=notifCopy.querySelector('span');
if(copySpan)copySpan.textContent='Tersalin';
setOtp('382914');
otpCells.forEach(function(c,i){c.textContent='382914'[i];c.classList.add('filled')});
verified.classList.add('on');
appBtn.classList.add('done');
appBtn.textContent='✓ Terverifikasi';
if(timeEl)timeEl.textContent='0:09';
return;
}

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
},{threshold:.2});
io.observe(demo);
}else{
state.started=true;
startClock();
runSeq();
}

D.addEventListener('visibilitychange',function(){
if(D.hidden){
clearT();
state.running=false;
}else if(state.started){
clearT();
state.running=false;
runSeq();
}
});
})();

// ============================================
// HOW ANIMATION — cursor akurat, pilihan bervariasi
// ============================================
(function(){
var wrap=q('#howDemo');
if(!wrap)return;

var cursor=q('#howCursor');
var tap=q('#howTap');
var steps=qa('.how-step-row');
var scrs=qa('.how-scr');

if(!cursor||!tap||!steps.length||!scrs.length)return;

var state={
started:false,
timers:[],
loopId:0,
lastApp:null,
lastCountry:null,
running:false
};

function clearT(){
state.timers.forEach(function(t){clearTimeout(t)});
state.timers=[];
}
function later(fn,ms){
var id=setTimeout(fn,ms);
state.timers.push(id);
return id;
}

function moveCursor(x,y){
cursor.style.left=x+'px';
cursor.style.top=y+'px';
}
function pressCursor(){
cursor.classList.add('press');
setTimeout(function(){cursor.classList.remove('press')},180);
}
function showTap(x,y){
tap.style.left=x+'px';
tap.style.top=y+'px';
tap.classList.remove('on');
void tap.offsetWidth;
tap.classList.add('on');
}
function setStep(n){
steps.forEach(function(s){s.classList.toggle('active',s.dataset.step==String(n))});
scrs.forEach(function(s){s.classList.toggle('on',s.dataset.scr==String(n))});
}

// Hitung posisi relatif terhadap .how-demo
function getRel(el){
if(!el)return null;
var wrapRect=wrap.getBoundingClientRect();
var r=el.getBoundingClientRect();
if(r.width===0||r.height===0)return null;
return {
x:r.left-wrapRect.left+r.width/2,
y:r.top-wrapRect.top+r.height/2
};
}

function hideCursor(){cursor.classList.remove('on')}
function showCursor(){cursor.classList.add('on')}

// Pilih random tapi hindari repeat dari loop sebelumnya
function pickRandom(items,lastKey,keyAttr){
if(!items||items.length===0)return null;
if(items.length===1)return items[0];
var filtered=items.filter(function(el){return el.dataset[keyAttr]!==lastKey});
if(filtered.length===0)filtered=items;
return filtered[Math.floor(Math.random()*filtered.length)];
}

function runLoop(){
if(!state.running){
state.running=true;
}
var loopToken=++state.loopId;

var appItems=qa('.how-app-item');
var countryItems=qa('.how-country-item');

if(!appItems.length||!countryItems.length){state.running=false;return}

var chosenApp=pickRandom(appItems,state.lastApp,'app');
var chosenCountry=pickRandom(countryItems,state.lastCountry,'cc');

if(chosenApp)state.lastApp=chosenApp.dataset.app;
if(chosenCountry)state.lastCountry=chosenCountry.dataset.cc;

// Update screen 3 dan 4 sesuai pilihan user
var appMeta={
wa:{name:'WhatsApp',icon:'whatsapp',color:'#25D366'},
tg:{name:'Telegram',icon:'telegram',color:'#229ED9'},
sp:{name:'Shopee',icon:'shopee',color:'#EE4D2D'},
ig:{name:'Instagram',icon:'instagram',color:'#E1306C'}
};
var countryMeta={
id:{name:'Indonesia',code:'+62',flag:'id'},
us:{name:'United States',code:'+1',flag:'us'},
gb:{name:'United Kingdom',code:'+44',flag:'gb'},
ru:{name:'Russia',code:'+7',flag:'ru'}
};

var appData=chosenApp?appMeta[chosenApp.dataset.app]:null;
var countryData=chosenCountry?countryMeta[chosenCountry.dataset.cc]:null;

// Update target app di screen 3
var targetIcon=q('#howTargetIcon');
var targetImg=q('#howTargetImg');
var targetName=q('#howTargetName');
var targetCode=q('#howTargetCode');
var otpNote=q('#howOtpNote');

if(appData){
if(targetIcon)targetIcon.style.setProperty('--c',appData.color);
if(targetImg)targetImg.src='https://cdn.jsdelivr.net/npm/simple-icons@13/icons/'+appData.icon+'.svg';
if(targetName)targetName.textContent=appData.name;
if(otpNote)otpNote.textContent='Salin ke aplikasi '+appData.name;
}
if(countryData&&targetCode){
targetCode.textContent=countryData.code+' 812 3456 7890';
}

// Bersihkan picked state
qa('.how-app-item').forEach(function(i){i.classList.remove('picked')});
qa('.how-country-item').forEach(function(i){i.classList.remove('picked')});

function nextStep(fn,delay){
if(loopToken!==state.loopId)return;
later(fn,delay);
}

// STEP 1 — Pilih App
setStep(1);
hideCursor();
nextStep(function(){
var target=chosenApp;
if(!target)return;
var p=getRel(target);
if(!p)return;
showCursor();
moveCursor(p.x,p.y);
nextStep(function(){
pressCursor();
showTap(p.x,p.y);
target.classList.add('picked');
},720);
},400);

// STEP 2 — Pilih Country
nextStep(function(){setStep(2)},2600);
nextStep(function(){
var target=chosenCountry;
if(!target)return;
var p=getRel(target);
if(!p)return;
moveCursor(p.x,p.y);
nextStep(function(){
pressCursor();
showTap(p.x,p.y);
target.classList.add('picked');
},720);
},3000);

// STEP 3 — Paste Nomor
nextStep(function(){setStep(3)},5200);
nextStep(function(){
var hint=qa('.how-paste-hint')[0];
var p=getRel(hint);
if(!p)return;
moveCursor(p.x,p.y);
nextStep(function(){
pressCursor();
showTap(p.x,p.y);
},720);
},5600);

// STEP 4 — Terima OTP
nextStep(function(){setStep(4)},7800);
nextStep(function(){
var note=qa('.how-otp-note')[0];
var p=getRel(note);
if(!p)return;
moveCursor(p.x,p.y);
nextStep(function(){
pressCursor();
showTap(p.x,p.y);
},720);
},8200);

// Reset & loop
nextStep(function(){
if(loopToken!==state.loopId)return;
runLoop();
},10800);
}

// Recalc + restart saat resize biar cursor tetap akurat
var resizeTm=null;
W.addEventListener('resize',function(){
clearTimeout(resizeTm);
resizeTm=setTimeout(function(){
if(state.started){
clearT();
state.loopId++;
state.running=false;
setTimeout(runLoop,300);
}
},250);
});

if('IntersectionObserver' in W){
var io=new IntersectionObserver(function(es){
es.forEach(function(en){
if(en.isIntersecting && !state.started){
state.started=true;
setTimeout(runLoop,400);
io.disconnect();
}
});
},{threshold:.2});
io.observe(wrap);
}else{
state.started=true;
setTimeout(runLoop,400);
}

D.addEventListener('visibilitychange',function(){
if(D.hidden){
clearT();
state.loopId++;
state.running=false;
}else if(state.started){
clearT();
state.loopId++;
setTimeout(runLoop,300);
}
});
})();

})();
