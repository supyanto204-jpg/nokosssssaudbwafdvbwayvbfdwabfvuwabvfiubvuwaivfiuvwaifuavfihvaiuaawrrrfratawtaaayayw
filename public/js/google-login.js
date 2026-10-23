(function () {
  'use strict';

  function alertBox(msg, type) {
    var el = document.getElementById('alert');
    var txt = document.getElementById('alert-text');
    var icon = document.getElementById('alertIcon');
    if (!el || !txt) return;

    var icons = {
      error: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
      success: '<polyline points="20 6 9 17 4 12"/>',
      info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
    };

    el.className = 'alert show ' + (type || 'error');
    txt.textContent = msg;
    if (icon) icon.innerHTML = icons[type] || icons.error;
  }

  function setStatus(state, label) {
    var row = document.getElementById('statusRow');
    var lbl = document.getElementById('statusLabel');
    if (!row) return;
    row.dataset.state = state;
    if (lbl && label) lbl.textContent = label;
    if (state === 'pending') {
      row.classList.remove('visible');
      row.setAttribute('aria-hidden', 'true');
    } else {
      row.classList.add('visible');
      row.setAttribute('aria-hidden', 'false');
    }
  }

  window.handleGoogleCredential = async function (response) {
    if (!response || !response.credential) {
      alertBox('Login Google gagal. Coba lagi.', 'error');
      return;
    }

    setStatus('running', 'Memverifikasi akun Google...');

    try {
      var res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });

      var data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login Google gagal');

      try {
        localStorage.setItem('access_token', data.session.access_token);
        if (data.session.refresh_token) {
          localStorage.setItem('refresh_token', data.session.refresh_token);
        }
        localStorage.setItem('user', JSON.stringify(data.user));
      } catch (e) {}

      setStatus('done', 'Login berhasil!');
      alertBox('Login berhasil! Mengalihkan...', 'success');

      setTimeout(function () {
        location.replace('/dashboard');
      }, 800);
    } catch (err) {
      setStatus('failed', 'Gagal login');
      alertBox(err && err.message ? err.message : 'Login Google gagal', 'error');

      setTimeout(function () {
        setStatus('pending', 'Menunggu');
      }, 3000);
    }
  };
})();
