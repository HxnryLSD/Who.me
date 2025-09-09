const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const passport = require('passport');
const { db } = require('../db');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Basic honeypot middleware
function honeypot(req, res, next) {
  if (req.body && req.body.website) {
    // Likely a bot submission
    return res.status(400).render('404', { title: 'Bad Request' });
  }
  next();
}

// Rate limiters
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false });
const sensitiveLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

const insertUser = db.prepare(
  'INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ? )'
);
const insertProfile = db.prepare('INSERT INTO profiles (user_id, full_name, birthday, city, workplace, bio) VALUES (?, NULL, NULL, NULL, NULL, NULL)');
const getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insertReset = db.prepare('INSERT INTO reset_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)');
const getReset = db.prepare('SELECT * FROM reset_tokens WHERE token = ?');
const markResetUsed = db.prepare('UPDATE reset_tokens SET used = 1 WHERE token = ?');
const updatePassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');

router.get('/login', (req, res) => {
  res.render('auth/login', { title: 'Login' });
});

const insertLoginLog = db.prepare('INSERT INTO login_logs (user_id, ts, ip, user_agent, success) VALUES (?, ?, ?, ?, 1)');
router.post('/login', honeypot, authLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      req.flash('error', info && info.message ? info.message : 'Login failed');
      return res.redirect('/auth/login');
    }
    req.logIn(user, (err2) => {
      if (err2) return next(err2);
      try {
        const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || null;
        const ua = req.headers['user-agent'] || null;
        insertLoginLog.run(user.id, new Date().toISOString(), ip, ua);
      } catch {}
      return res.redirect('/dashboard');
    });
  })(req, res, next);
});

router.get('/register', (req, res) => {
  res.render('auth/register', { title: 'Register' });
});

router.post('/register', honeypot, authLimiter, async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;
    if (!username || !email || !password) {
      req.flash('error', 'All fields are required');
      return res.redirect('/auth/register');
    }
    if (password !== confirmPassword) {
      req.flash('error', 'Passwords do not match');
      return res.redirect('/auth/register');
    }

    const normalizedUsername = String(username).toLowerCase().trim();
    const normalizedEmail = String(email).toLowerCase().trim();

    // Check uniqueness
    const existsUser = db.prepare('SELECT 1 FROM users WHERE username = ? OR email = ?').get(normalizedUsername, normalizedEmail);
    if (existsUser) {
      req.flash('error', 'Username or email already taken');
      return res.redirect('/auth/register');
    }

    const hash = await bcrypt.hash(password, 12);
    const id = uuidv4();
    const createdAt = new Date().toISOString();

    const trx = db.transaction(() => {
      insertUser.run(id, normalizedUsername, normalizedEmail, hash, createdAt);
      insertProfile.run(id);
    });
    trx();

    req.flash('success', 'Registration successful. Please log in.');
    res.redirect('/auth/login');
  } catch (err) {
    console.error('Register error', err);
    req.flash('error', 'Registration failed');
    res.redirect('/auth/register');
  }
});

router.post('/logout', (req, res, next) => {
  req.logout(function (err) {
    if (err) return next(err);
    res.redirect('/');
  });
});

// Forgot password
router.get('/forgot', (req, res) => {
  res.render('auth/forgot', { title: 'Forgot Password' });
});

router.post('/forgot', honeypot, sensitiveLimiter, (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const user = getUserByEmail.get(email);
  if (!user) {
    req.flash('success', 'If that email exists, a reset link has been generated.');
    return res.redirect('/auth/forgot');
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 1000 * 60 * 30).toISOString(); // 30 mins
  insertReset.run(token, user.id, expires);
  const resetUrl = `/auth/reset/${token}`;
  // In a real app, send email with the link. For now, show it as a flash message.
  req.flash('success', `Password reset link: ${resetUrl}`);
  res.redirect('/auth/forgot');
});

// Reset password
router.get('/reset/:token', (req, res) => {
  const token = req.params.token;
  const row = getReset.get(token);
  const now = Date.now();
  if (!row || row.used || new Date(row.expires_at).getTime() < now) {
    req.flash('error', 'Invalid or expired reset link');
    return res.redirect('/auth/forgot');
  }
  res.render('auth/reset', { title: 'Reset Password', token });
});

router.post('/reset/:token', honeypot, sensitiveLimiter, async (req, res) => {
  const token = req.params.token;
  const row = getReset.get(token);
  const now = Date.now();
  if (!row || row.used || new Date(row.expires_at).getTime() < now) {
    req.flash('error', 'Invalid or expired reset link');
    return res.redirect('/auth/forgot');
  }
  const { password, confirmPassword } = req.body;
  if (!password || password !== confirmPassword) {
    req.flash('error', 'Passwords do not match');
    return res.redirect(`/auth/reset/${token}`);
  }
  const hash = await bcrypt.hash(password, 12);
  const tx = db.transaction(() => {
    updatePassword.run(hash, row.user_id);
    markResetUsed.run(token);
  });
  tx();
  req.flash('success', 'Password has been reset. You can now log in.');
  res.redirect('/auth/login');
});

module.exports = router;
