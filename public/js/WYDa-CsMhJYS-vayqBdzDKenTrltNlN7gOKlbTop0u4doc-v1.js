(function(){
'use strict';

function $(id){ return document.getElementById(id); }
function $all(sel){ return document.querySelectorAll(sel); }

// Theme toggle
(function themeInit(){
  var btn = $('themeBtn');
  if (!btn) return;
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function resolve(pref){
    if (pref === 'system') return (mq && mq.matches) ? 'dark' : 'light';
    return pref;
  }
  function setPref(pref, save){
    root.setAttribute('data-theme-pref', pref);
    root.setAttribute('data-theme', resolve(pref));
    if (save) {
      try { localStorage.setItem('asyrofotp_theme_pref', pref); } catch (e) {}
    }
  }

  btn.addEventListener('click', function(){
    var cur = root.getAttribute('data-theme-pref') || 'system';
    var next = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light';
    setPref(next, true);
  });

  if (mq) {
    var onOsChange = function(){
      if (root.getAttribute('data-theme-pref') === 'system') setPref('system', false);
    };
    if (mq.addEventListener) mq.addEventListener('change', onOsChange);
    else if (mq.addListener) mq.addListener(onOsChange);
  }
})();

// Copy button
(function copyInit(){
  $all('.copy-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var text = btn.getAttribute('data-copy') || '';
      if (!text) return;

      function onOk(){
        var orig = btn.textContent;
        btn.classList.add('copied');
        btn.textContent = 'Copied!';
        setTimeout(function(){
          btn.classList.remove('copied');
          btn.textContent = orig;
        }, 1400);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onOk).catch(function(){
          fallbackCopy(text, onOk);
        });
      } else {
        fallbackCopy(text, onOk);
      }
    });
  });

  function fallbackCopy(text, onOk){
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok && onOk) onOk();
    } catch (e) {}
  }
})();

// Scroll-spy pakai IntersectionObserver
(function scrollSpyInit(){
  var links = Array.prototype.slice.call($all('.sidenav-link[href^="#"]'));
  if (links.length === 0) return;

  var map = {};
  links.forEach(function(link){
    var id = link.getAttribute('href').slice(1);
    var el = document.getElementById(id);
    if (el) map[id] = { link: link, el: el };
  });

  var ids = Object.keys(map);
  if (ids.length === 0) return;

  // Set active awal
  var activeId = null;
  function setActive(id){
    if (activeId === id) return;
    ids.forEach(function(i){ map[i].link.classList.remove('active'); });
    if (id && map[id]) map[id].link.classList.add('active');
    activeId = id;
  }

  var observer = new IntersectionObserver(function(entries){
    // Cari entry yang paling atas & intersecting
    var visible = entries.filter(function(e){ return e.isIntersecting; });
    if (visible.length > 0) {
      // Sort berdasarkan posisi top
      visible.sort(function(a,b){ return a.boundingClientRect.top - b.boundingClientRect.top; });
      setActive(visible[0].target.id);
    }
  }, {
    rootMargin: '-80px 0px -60% 0px',
    threshold: 0
  });

  ids.forEach(function(id){ observer.observe(map[id].el); });

  // Fallback kalau user scroll mentok paling bawah, pastikan link terakhir aktif
  window.addEventListener('scroll', function(){
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 50) {
      setActive(ids[ids.length - 1]);
    }
  }, { passive: true });
})();

// Smooth scroll
(function smoothScrollInit(){
  document.addEventListener('click', function(e){
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (href === '#' || href.length < 2) return;
    var id = href.slice(1);
    var el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (history.replaceState) history.replaceState(null, '', '#' + id);
  });
})();

})();
