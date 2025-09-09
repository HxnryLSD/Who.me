const express = require('express');
const { db } = require('../db');

const router = express.Router();

const getUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const getProfileByUser = db.prepare('SELECT * FROM profiles WHERE user_id = ?');
const listLinksByUser = db.prepare('SELECT * FROM links WHERE user_id = ? ORDER BY position ASC, label ASC');
const getLinkById = db.prepare('SELECT * FROM links WHERE id = ?');
const incLinkClicks = db.prepare('UPDATE links SET clicks = clicks + 1 WHERE id = ?');
const insertClick = db.prepare('INSERT INTO link_clicks (link_id, user_id, ts, ip, user_agent) VALUES (?, ?, ?, ?, ?)');
const listProjects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY position ASC, title ASC');
const listExperiences = db.prepare('SELECT * FROM experiences WHERE user_id = ? ORDER BY position ASC, start_date DESC');
const listContacts = db.prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY label ASC');

// Public profile page e.g., /u/jdoe
router.get('/u/:username', (req, res) => {
  const username = String(req.params.username || '').toLowerCase();
  const user = getUserByUsername.get(username);
  if (!user) return res.status(404).render('404', { title: 'User Not Found' });
  const profile = getProfileByUser.get(user.id);
  const links = listLinksByUser.all(user.id);
  const projects = listProjects.all(user.id);
  const experiences = listExperiences.all(user.id);
  const contacts = listContacts.all(user.id);
  res.render('public/profile', {
    title: `${user.username} • Who.Me`,
    username: user.username,
    profile,
    links,
    projects,
    experiences,
    contacts,
    profileTheme: profile?.theme || null,
    profileCustomCss: profile?.custom_css || null,
  });
});

// Link redirect with click tracking
router.get('/l/:id', (req, res) => {
  const id = req.params.id;
  const link = getLinkById.get(id);
  if (!link) return res.status(404).render('404', { title: 'Link Not Found' });
  const ts = new Date().toISOString();
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || null;
  const ua = req.headers['user-agent'] || null;
  const tx = db.transaction(() => {
    incLinkClicks.run(id);
    insertClick.run(id, link.user_id, ts, ip, ua);
  });
  tx();
  res.redirect(link.url);
});

module.exports = router;
