(function () {
'use strict';
var D=document,W=window;
var q=function(s,c){return (c||D).querySelector(s)};
var qa=function(s,c){return Array.prototype.slice.call((c||D).querySelectorAll(s))};
var isMobile=W.innerWidth<=900;
var T={"0":"Tanpa nomor pribadi","1":"1.700+ aplikasi siap verifikasi","2":"OTP masuk rata-rata 5 detik","3":"Refund otomatis kalau gagal"};

function raf(fn){var t=false;return function(){var a=arguments,s=this;if(t)return;t=true;requestAnimationFrame(function(){t=false;fn.apply(s,a)})}}

(function(){
try{console.log('%c⚠️ STOP!','color:#ff3b30;font-size:20px;font-weight:900');console.log('%cJangan paste apapun di sini. Itu SCAM.','color:#8e8e93;font-size:12px')}catch(e){}
D.addEventListener('contextmenu',function(e){e.preventDefault()});
D.addEventListener('keydown',function(e){var k=e.key;if(e.ctrlKey&&(k==='u'||k==='U'||k==='s'||k==='S')){e.preventDefault()}},true);
D.addEventListener('copy',function(e){var t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;e.preventDefault()});
D.addEventListener('cut',function(e){var t=e.target;if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;e.preventDefault()});
try{var u=W.location.origin+W.location.pathname;if(W.location.search)history.replaceState(null,'',u)}catch(e){}
})();

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

(function(){
var n=q('#nav');if(!n)return;
var s=raf(function(){n.classList.toggle('scrolled',W.scrollY>10)});
W.addEventListener('scroll',s,{passive:true});
})();

(function(){
qa('.faq-q').forEach(function(b){
b.addEventListener('click',function(){
var it=b.parentElement;var on=it.classList.contains('active');
qa('.faq-item').forEach(function(i){i.classList.remove('active')});
if(!on)it.classList.add('active');
});
});
})();

(function(){
var els=qa('.reveal');if(!els.length)return;
if(!('IntersectionObserver' in W)){els.forEach(function(e){e.classList.add('on')});return}
var io=new IntersectionObserver(function(es){
es.forEach(function(en,i){
if(en.isIntersecting){setTimeout(function(){en.target.classList.add('on')},i*50);io.unobserve(en.target)}
});
},{rootMargin:'0px 0px -60px 0px',threshold:.06});
els.forEach(function(e){io.observe(e)});
})();

(function(){
var b=q('#toTop');if(!b)return;
var s=raf(function(){b.classList.toggle('on',W.scrollY>400)});
W.addEventListener('scroll',s,{passive:true});
b.addEventListener('click',function(){W.scrollTo({top:0,behavior:'smooth'})});
})();

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

(function(){
var el=q('#typeText');var cur=q('#typeCursor');if(!el)return;
var arr=Object.keys(T).map(function(k){return T[k]});
var i=0,ci=0,del=false,tm=null,started=false;
var TY=55,DL=28,PAUSE=1700;
function tick(){
var s=arr[i];
if(!del){
if(ci<s.length){el.textContent=s.slice(0,++ci);tm=setTimeout(tick,TY)}
else{tm=setTimeout(function(){del=true;tick()},PAUSE)}
}else{
if(ci>0){el.textContent=s.slice(0,--ci);tm=setTimeout(tick,DL)}
else{del=false;i=(i+1)%arr.length;tm=setTimeout(tick,350)}
}
}
function start(){if(started)return;started=true;tm=setTimeout(tick,300)}
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

// DEMO WHATSAPP — hanya jalan kalau demo visible (desktop/tablet)
(function(){
var demo=q('#demo');if(!demo)return;
var appBtn=q('#appBtn');
var otpCells=qa('.app-otp-cell');
var notif=q('#notif');
var notifCopy=q('#notifCopy');
var notifDigits=qa('.notif-digit');
var verified=q('#verified');
var progressFill=q('#demoProgress');
var timeEl=q('#demoTime');
var state={started:false,timers:[],progressRaf:null,otp:''};

function clearT(){state.timers.forEach(function(t){clearTimeout(t)});state.timers=[];if(state.progressRaf){cancelAnimationFrame(state.progressRaf);state.progressRaf=null}}
function later(fn,ms){var id=setTimeout(fn,ms);state.timers.push(id);return id}
function genOtp(){var s='';for(var i=0;i<6;i++)s+=Math.floor(Math.random()*10);return s}
function setOtp(c){notifDigits.forEach(function(el,i){el.textContent=c[i]||'0'})}

function reset(){
otpCells.forEach(function(c){c.textContent='';c.classList.remove('filled')});
appBtn.disabled=true;appBtn.classList.remove('done');appBtn.textContent='Verifikasi';
notif.classList.remove('on');
notifCopy.classList.remove('done');
notifCopy.querySelector('span').textContent='Salin Kode';
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
state.otp=genOtp();
setOtp(state.otp);
runProgress(8500);
later(function(){appBtn.disabled=true;appBtn.textContent='Mengirim...'},500);
later(function(){notif.classList.add('on')},1500);
later(function(){notifCopy.classList.add('done');notifCopy.querySelector('span').textContent='Tersalin'},2600);
later(function(){notif.classList.remove('on')},3400);
later(function(){
otpCells.forEach(function(cell,i){
later(function(){cell.textContent=state.otp[i];cell.classList.add('filled')},i*120);
});
},3800);
later(function(){appBtn.disabled=false;appBtn.textContent='Verifikasi'},4800);
later(function(){appBtn.disabled=true;appBtn.textContent='Memverifikasi...'},5200);
later(function(){verified.classList.add('on');appBtn.classList.add('done');appBtn.textContent='✓ Terverifikasi'},6000);
later(function(){runSeq()},8500);
}

if('IntersectionObserver' in W){
var io=new IntersectionObserver(function(es){
es.forEach(function(en){
if(en.isIntersecting && !state.started){state.started=true;startClock();runSeq();io.disconnect()}
});
},{threshold:.2});
io.observe(demo);
}else{state.started=true;startClock();runSeq()}

D.addEventListener('visibilitychange',function(){
if(D.hidden)clearT();
else if(state.started){clearT();runSeq()}
});
})();

// HOW — cursor animation (semua device)
(function(){
var wrap=q('#howDemo');if(!wrap)return;
var cursor=q('#howCursor');
var tap=q('#howTap');
var preview=q('#howPreview');
var steps=qa('.how-step-row');
var scrs=qa('.how-scr');
var previewRect=null;
var state={started:false,timers:[]};

function clearT(){state.timers.forEach(function(t){clearTimeout(t)});state.timers=[]}
function later(fn,ms){var id=setTimeout(fn,ms);state.timers.push(id);return id}
function moveCursor(x,y){if(cursor){cursor.style.left=x+'px';cursor.style.top=y+'px'}}
function pressCursor(){if(cursor){cursor.classList.add('press');setTimeout(function(){cursor.classList.remove('press')},150)}}
function showTap(x,y){if(tap){tap.style.left=x+'px';tap.style.top=y+'px';tap.classList.remove('on');void tap.offsetWidth;tap.classList.add('on')}}
function setStep(n){steps.forEach(function(s){s.classList.toggle('active',s.dataset.step==String(n))});scrs.forEach(function(s){s.classList.toggle('on',s.dataset.scr==String(n))})}
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

setStep(1);
later(function(){
var t=qa('.how-app-item')[0];var p=getRel(t);
if(p){moveCursor(p.x,p.y);later(function(){pressCursor();showTap(p.x,p.y);t.classList.add('picked')},600)}
},250);

later(function(){setStep(2)},2300);
later(function(){
var t=qa('.how-country-item')[3];var p=getRel(t);
if(p){moveCursor(p.x,p.y);later(function(){pressCursor();showTap(p.x,p.y);t.classList.add('picked')},600)}
},2600);

later(function(){setStep(3)},4600);
later(function(){
var h=qa('.how-paste-hint')[0];var p=getRel(h);
if(p){moveCursor(p.x,p.y);later(function(){pressCursor();showTap(p.x,p.y)},600)}
},4900);

later(function(){setStep(4)},6800);
later(function(){
var n=qa('.how-otp-note')[0];var p=getRel(n);
if(p){moveCursor(p.x,p.y);later(function(){pressCursor();showTap(p.x,p.y)},600)}
},7100);

later(function(){
qa('.how-app-item').forEach(function(i){i.classList.remove('picked')});
qa('.how-country-item').forEach(function(i){i.classList.remove('picked')});
runLoop();
},9800);
}

if('IntersectionObserver' in W){
var io=new IntersectionObserver(function(es){
es.forEach(function(en){
if(en.isIntersecting && !state.started){
state.started=true;
setTimeout(runLoop,250);
io.disconnect();
}
});
},{threshold:.2});
io.observe(wrap);
}else{state.started=true;setTimeout(runLoop,250)}

W.addEventListener('resize',function(){previewRect=preview?preview.getBoundingClientRect():null});
D.addEventListener('visibilitychange',function(){
if(D.hidden)clearT();
else if(state.started){clearT();setTimeout(runLoop,250)}
});
})();

})();
