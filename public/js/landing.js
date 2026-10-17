(function () {
'use strict';
var D=document,W=window;
var q=function(s,c){return (c||D).querySelector(s)};
var qa=function(s,c){return Array.prototype.slice.call((c||D).querySelectorAll(s))};
var isM=W.matchMedia('(max-width:560px)').matches;
var isT=W.matchMedia('(max-width:900px)').matches;
var lowEnd=navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=4;
var reduced=W.matchMedia('(prefers-reduced-motion: reduce)').matches;
var saveD=navigator.connection&&navigator.connection.saveData;
var heavy=reduced||saveD||lowEnd;
var T={"0":"Platform OTP cepat & aman","1":"Nomor virtual 1700+ layanan","2":"Kode verifikasi instan","3":"Support 24/7 siap bantu"};

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]})}
function raf(fn){var t=false;return function(){var a=arguments,s=this;if(t)return;t=true;requestAnimationFrame(function(){t=false;fn.apply(s,a)})}}
function theme(){return D.documentElement.getAttribute('data-theme')||'light'}

// Security — soft, DevTools boleh
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

// Auto redirect kalau sudah login
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
if(m)m.setAttribute('content',nx==='dark'?'#000':'#0a84ff');
W.dispatchEvent(new CustomEvent('asyrof-theme',{detail:{theme:nx}}));
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

// BFCache & visibility restart
W.addEventListener('pageshow',function(e){if(e.persisted)W.dispatchEvent(new CustomEvent('asyrof-restart'))});
D.addEventListener('visibilitychange',function(){if(!D.hidden)W.dispatchEvent(new CustomEvent('asyrof-restart'))});

})();
