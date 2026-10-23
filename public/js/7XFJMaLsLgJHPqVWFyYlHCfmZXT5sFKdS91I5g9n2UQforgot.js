(function(){
'use strict';

var D=document, W=window;
var q=function(s){return D.querySelector(s)};

// theme toggle
(function(){
  var b=q('#themeBtn'); if(!b)return;
  var root=D.documentElement;
  var mq=W.matchMedia?W.matchMedia('(prefers-color-scheme: dark)'):null;
  function resolve(p){return p==='system'?(mq&&mq.matches?'dark':'light'):p}
  function setPref(p){
    root.setAttribute('data-theme-pref',p);
    root.setAttribute('data-theme',resolve(p));
    try{localStorage.setItem('asyrofotp_theme_pref',p)}catch(e){}
  }
  b.addEventListener('click',function(){
    var cur=root.getAttribute('data-theme-pref')||'system';
    setPref(cur==='light'?'dark':cur==='dark'?'system':'light');
  });
})();

// Device ID
(function(){
  try {
    if(!localStorage.getItem('asyrofotp_device_id')){
      var id = Math.random().toString(36).substring(2) + Date.now().toString(36);
      localStorage.setItem('asyrofotp_device_id', id);
    }
  } catch(e){}
})();

// Elements
var form=q('#forgotForm');
var emailIn=q('#email');
var submitBtn=q('#submitBtn');
var btnText=q('#btnText');
var btnIcon=q('#btnIcon');
var statusRow=q('#statusRow');
var statusLabel=q('#statusLabel');
var statusFill=q('#statusBarFill');
var alertEl=q('#alert');
var alertText=q('#alert-text');
var alertIcon=q('#alertIcon');

var puzzleWrap=q('#puzzleWrap');
var puzzleBox=q('#puzzleBox');
var canvasBg=q('#canvasBg');
var canvasBlock=q('#canvasBlock');
var sliderWrap=q('#sliderWrap');
var slider=q('#slider');
var sliderProgress=q('#sliderProgress');
var sliderText=q('#sliderText');
var sliderBtn=q('#sliderBtn');
var puzzleLoading=q('#puzzleLoading');

var isVerified = false;
var targetX = 0;
var blockY = 0;
var blockSize = 50;
var ctxBg = canvasBg.getContext('2d');
var ctxBlock = canvasBlock.getContext('2d');

function showAlert(msg, type){
  alertEl.className='alert show '+(type||'error');
  alertText.textContent=msg;
  if(type==='success'){ alertIcon.innerHTML='<polyline points="20 6 9 17 4 12"/>'; }
  else{ alertIcon.innerHTML='<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'; }
}
function hideAlert(){alertEl.className='alert'}

function setStatus(state, label){
  statusRow.dataset.state=state;
  if(label)statusLabel.textContent=label;
  if(state==='pending'){ statusRow.classList.remove('visible'); }
  else{ statusRow.classList.add('visible'); }
}

// ==========================================
// PUZZLE CAPTCHA LOGIC
// ==========================================
function initPuzzle() {
  // Reset UI
  puzzleLoading.classList.add('show');
  slider.disabled = true;
  isVerified = false;
  submitBtn.disabled = true;
  slider.value = 0;
  sliderProgress.style.width = '0%';
  sliderBtn.style.left = '0px';
  sliderText.textContent = 'Memuat...';
  canvasBlock.style.opacity = 0;

  // Load image
  var imgNum = Math.floor(Math.random() * 5) + 1;
  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = '/puzzle/img' + imgNum + '.png';

  img.onload = function() {
    // Setup ukuran canvas
    var w = puzzleBox.clientWidth;
    var h = puzzleBox.clientHeight;
    canvasBg.width = w;
    canvasBg.height = h;
    canvasBlock.width = w;
    canvasBlock.height = h;

    // Generate target posisi (X dan Y)
    targetX = Math.floor(Math.random() * (w - blockSize - 60)) + 40; // 40px min, 60px max
    blockY = Math.floor(Math.random() * (h - blockSize - 20)) + 10;

    // Gambar ke background
    ctxBg.clearRect(0, 0, w, h);
    ctxBg.drawImage(img, 0, 0, w, h);

    // Gambar "Lubang" (potongan yang hilang)
    ctxBg.fillStyle = 'rgba(0, 0, 0, 0.6)'; // Warna gelap
    ctxBg.fillRect(targetX, blockY, blockSize, blockSize);

    // Gambar potongan puzzle ke canvas atasnya
    ctxBlock.clearRect(0, 0, w, h);
    ctxBlock.drawImage(img, targetX, blockY, blockSize, blockSize, 0, 0, blockSize, blockSize);
    
    // Pastikan gambar puzzle punya efek bayangan
    ctxBlock.shadowColor = 'rgba(0,0,0,0.5)';
    ctxBlock.shadowBlur = 6;
    // (Opsional) Kalau mau ada border potongan
    // ctxBlock.strokeStyle = '#fff';
    // ctxBlock.lineWidth = 2;
    // ctxBlock.strokeRect(0, 0, blockSize, blockSize);

    // Selesai loading
    puzzleLoading.classList.remove('show');
    slider.disabled = false;
    sliderText.textContent = 'Geser untuk verifikasi';
    canvasBlock.style.opacity = 1;
  };

  img.onerror = function() {
    puzzleLoading.classList.remove('show');
    sliderText.textContent = 'Gagal memuat gambar';
  };
}

// Event Slider
if(slider) {
  slider.addEventListener('input', function(e) {
    var val = parseInt(e.target.value);
    
    // Update UI
    sliderProgress.style.width = val + 'px';
    sliderBtn.style.left = val + 'px';
    canvasBlock.style.transform = 'translateX(' + val + 'px)';
  });

  slider.addEventListener('change', function(e) {
    var val = parseInt(e.target.value);
    
    // Validasi
    if(Math.abs(val - targetX) <= 5) {
      // BERHASIL
      isVerified = true;
      slider.disabled = true;
      submitBtn.disabled = false;
      sliderText.textContent = 'Terverifikasi';
      sliderText.style.color = 'var(--ok)';
      sliderWrap.style.borderColor = 'var(--ok)';
      canvasBlock.style.transform = 'translateX(' + targetX + 'px)';
      sliderBtn.style.left = targetX + 'px';
      sliderProgress.style.width = targetX + 'px';
      hideAlert();
    } else {
      // GAGAL
      isVerified = false;
      submitBtn.disabled = true;
      slider.disabled = true;
      showAlert('Posisi salah. Memuat ulang...', 'error');
      
      // Animasi balik ke 0
      canvasBlock.style.transition = 'transform .3s';
      sliderBtn.style.transition = 'left .3s';
      sliderProgress.style.transition = 'width .3s';
      
      canvasBlock.style.transform = 'translateX(0)';
      sliderBtn.style.left = '0px';
      sliderProgress.style.width = '0%';
      slider.value = 0;
      
      setTimeout(function(){
        canvasBlock.style.transition = '';
        sliderBtn.style.transition = '';
        sliderProgress.style.transition = '';
        initPuzzle();
      }, 800);
    }
  });
}

initPuzzle();

// ==========================================
// FORM SUBMIT
// ==========================================
if(!form)return;

form.addEventListener('submit', async function(e){
  e.preventDefault();
  hideAlert();

  if (!isVerified) {
    showAlert('Selesaikan verifikasi keamanan dulu.', 'error');
    return;
  }

  var email=emailIn.value.trim();
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    showAlert('Masukkan alamat email yang valid.', 'error');
    setStatus('failed', 'Email tidak valid');
    return;
  }

  submitBtn.disabled=true;
  btnText.textContent='Mengirim...';
  var origIcon=btnIcon?btnIcon.outerHTML:'';
  if(btnIcon)btnIcon.outerHTML='<span class="spinner" id="btnIcon"></span>';
  setStatus('running', 'Memproses permintaan...');
  if(statusFill)statusFill.style.width='40%';

  try{
    var deviceId = 'unknown';
    try { deviceId = localStorage.getItem('asyrofotp_device_id') || 'unknown'; } catch(e){}

    var res=await fetch('/api/auth/forgot', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-device-id': deviceId
      },
      body:JSON.stringify({
        email: email,
        puzzle_x: targetX
      })
    });

    var data=await res.json();
    if(!res.ok)throw new Error(data.error || 'Gagal mengirim permintaan');

    setStatus('done', 'Terkirim!');
    if(statusFill)statusFill.style.width='100%';
    showAlert(data.message || 'Jika email terdaftar, link reset telah dikirim.', 'success');
    btnText.textContent='Terkirim';

  }catch(err){
    setStatus('failed', 'Gagal');
    if(statusFill)statusFill.style.width='100%';
    showAlert(err.message || 'Terjadi kesalahan sistem.', 'error');
    
    submitBtn.disabled=false;
    btnText.textContent='Kirim Link Reset';
    if(q('#btnIcon') && origIcon) q('#btnIcon').outerHTML=origIcon;
    
    isVerified = false;
    initPuzzle();
  }
});

emailIn.addEventListener('keydown', function(e){
  if(e.key==='Enter'){e.preventDefault(); form.dispatchEvent(new Event('submit'));}
});

})();
