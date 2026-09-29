const express = require('express');
const path = require('path');
const app = express();

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== SERVE STATIC FILES =====
// File HTML, CSS, JS, gambar di folder public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// ===== ROUTES =====

// Root → redirect ke /landing
app.get('/', (req, res) => {
    res.redirect('/landing');
});

// /landing → serve landing.html
app.get('/landing', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'landing.html'));
});

// /dashboard → serve dashboard.html (nanti)
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

// ===== API ROUTES (contoh) =====
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/list', (req, res) => {
    res.json({ services: [] });
});

// ===== 404 HANDLER =====
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

// ===== EXPORT UNTUK VERCEL =====
module.exports = app;
