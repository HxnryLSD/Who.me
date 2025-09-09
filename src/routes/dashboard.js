const express = require('express');
const { db } = require('../db');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const router = express.Router();

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  req.flash('error', 'Please log in to access the dashboard');
  return res.redirect('/auth/login');
}

// Queries
const getProfile = db.prepare('SELECT * FROM profiles WHERE user_id = ?');
const updateProfile = db.prepare(
  'UPDATE profiles SET full_name = ?, birthday = ?, city = ?, workplace = ?, bio = ?, theme = ?, custom_css = ?, avatar_path = COALESCE(?, avatar_path) WHERE user_id = ?'
);
const listLinks = db.prepare('SELECT * FROM links WHERE user_id = ? ORDER BY position ASC, label ASC');
const insertLink = db.prepare('INSERT INTO links (id, user_id, label, url, position, tags, group_name, thumb_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const deleteLink = db.prepare('DELETE FROM links WHERE id = ? AND user_id = ?');
const updateLinkOrder = db.prepare('UPDATE links SET position = ? WHERE id = ? AND user_id = ?');
const getLinkById = db.prepare('SELECT * FROM links WHERE id = ? AND user_id = ?');
const getLinkByPosition = db.prepare('SELECT * FROM links WHERE user_id = ? AND position = ?');

// Projects
const listProjects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY position ASC, title ASC');
const insertProject = db.prepare('INSERT INTO projects (id, user_id, title, description, url, position) VALUES (?, ?, ?, ?, ?, ?)');
const deleteProject = db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?');
const getProjectMaxPos = db.prepare('SELECT MAX(position) as maxPos FROM projects WHERE user_id = ?');

// Experiences
const listExperiences = db.prepare('SELECT * FROM experiences WHERE user_id = ? ORDER BY position ASC, start_date DESC');
const insertExperience = db.prepare('INSERT INTO experiences (id, user_id, role, company, start_date, end_date, description, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const deleteExperience = db.prepare('DELETE FROM experiences WHERE id = ? AND user_id = ?');
const getExperienceMaxPos = db.prepare('SELECT MAX(position) as maxPos FROM experiences WHERE user_id = ?');

// Contacts
const listContacts = db.prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY label ASC');
const insertContact = db.prepare('INSERT INTO contacts (id, user_id, label, value) VALUES (?, ?, ?, ?)');
const deleteContact = db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?');

// Sessions
const revokeSessionFlag = db.prepare('UPDATE user_sessions SET active = 0 WHERE session_id = ? AND user_id = ?');

// Vanity/custom domain
const getUserRoute = db.prepare('SELECT * FROM user_routes WHERE user_id = ?');
const upsertRoute = db.prepare(`INSERT INTO user_routes (user_id, vanity_path, custom_domain)
  VALUES (?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET vanity_path = excluded.vanity_path, custom_domain = excluded.custom_domain`);
const isVanityTaken = db.prepare('SELECT 1 FROM user_routes WHERE vanity_path = ? AND user_id != ?');
const isDomainTaken = db.prepare('SELECT 1 FROM user_routes WHERE custom_domain = ? AND user_id != ?');

// Multer for avatar upload
const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'avatars');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadDir); },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.user.id}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) return cb(new Error('Invalid file type'));
    cb(null, true);
  },
});

router.get('/', ensureAuthenticated, (req, res) => {
  const profile = getProfile.get(req.user.id);
  const links = listLinks.all(req.user.id);
  const route = getUserRoute.get(req.user.id) || { vanity_path: '', custom_domain: '' };
  // Sections
  const projects = db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY position ASC, title ASC').all(req.user.id);
  const experiences = db.prepare('SELECT * FROM experiences WHERE user_id = ? ORDER BY position ASC, start_date DESC').all(req.user.id);
  const contacts = db.prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY label ASC').all(req.user.id);
  // Sessions
  const sessions = db.prepare('SELECT * FROM user_sessions WHERE user_id = ? AND active = 1 ORDER BY last_seen DESC').all(req.user.id);
  res.render('dashboard/index', { title: 'Dashboard', profile, links, route, projects, experiences, contacts, sessions });
});

router.post('/profile', ensureAuthenticated, upload.single('avatar'), (req, res) => {
  const { full_name, birthday, city, workplace, bio, theme, custom_css } = req.body;
  const avatarPath = req.file ? `/static/uploads/avatars/${req.file.filename}` : null;
  updateProfile.run(full_name || null, birthday || null, city || null, workplace || null, bio || null, theme || null, custom_css || null, avatarPath, req.user.id);
  req.flash('success', 'Profile updated');
  res.redirect('/dashboard');
});

router.post('/links', ensureAuthenticated, (req, res) => {
  const { label, url, tags, group_name, thumb_url } = req.body;
  if (!label || !url) {
    req.flash('error', 'Both label and URL are required');
    return res.redirect('/dashboard');
  }
  const id = uuidv4();
  const maxPosRow = db.prepare('SELECT MAX(position) as maxPos FROM links WHERE user_id = ?').get(req.user.id);
  const nextPos = (maxPosRow?.maxPos || 0) + 1;
  insertLink.run(id, req.user.id, label.trim(), url.trim(), nextPos, (tags||'').trim()||null, (group_name||'').trim()||null, (thumb_url||'').trim()||null);
  req.flash('success', 'Link added');
  res.redirect('/dashboard');
});

router.post('/links/reorder', ensureAuthenticated, (req, res) => {
  const { order } = req.body; // expects array of link IDs
  if (Array.isArray(order)) {
    const tx = db.transaction((ids) => {
      ids.forEach((linkId, idx) => updateLinkOrder.run(idx, linkId, req.user.id));
    });
    tx(order);
  }
  res.json({ ok: true });
});

router.post('/links/:id/delete', ensureAuthenticated, (req, res) => {
  const { id } = req.params;
  deleteLink.run(id, req.user.id);
  req.flash('success', 'Link removed');
  res.redirect('/dashboard');
});

// Accessible move up/down
router.post('/links/:id/move', ensureAuthenticated, (req, res) => {
  const dir = (req.query.dir || '').toLowerCase();
  const link = getLinkById.get(req.params.id, req.user.id);
  if (!link) return res.redirect('/dashboard');
  let targetPos = dir === 'up' ? link.position - 1 : link.position + 1;
  if (targetPos < 0) targetPos = 0;
  const other = getLinkByPosition.get(req.user.id, targetPos);
  const tx = db.transaction(() => {
    if (other) updateLinkOrder.run(link.position, other.id, req.user.id);
    updateLinkOrder.run(targetPos, link.id, req.user.id);
  });
  tx();
  res.redirect('/dashboard');
});

// Quick-add social links
router.post('/links/quick-add', ensureAuthenticated, (req, res) => {
  const { platform, handle } = req.body;
  const map = {
    github: { label: 'GitHub', url: (h) => `https://github.com/${h}` },
    linkedin: { label: 'LinkedIn', url: (h) => `https://www.linkedin.com/in/${h}` },
    x: { label: 'X', url: (h) => `https://x.com/${h}` },
    instagram: { label: 'Instagram', url: (h) => `https://instagram.com/${h}` },
  };
  const entry = map[platform];
  if (!entry || !handle) {
    req.flash('error', 'Invalid quick-add submission');
    return res.redirect('/dashboard');
  }
  const id = uuidv4();
  const maxPosRow = db.prepare('SELECT MAX(position) as maxPos FROM links WHERE user_id = ?').get(req.user.id);
  const nextPos = (maxPosRow?.maxPos || 0) + 1;
  insertLink.run(id, req.user.id, entry.label, entry.url(handle.trim()), nextPos, null, null, null);
  req.flash('success', `${entry.label} link added`);
  res.redirect('/dashboard');
});

// Save vanity/custom domain
router.post('/routes', ensureAuthenticated, (req, res) => {
  let { vanity_path, custom_domain } = req.body;
  vanity_path = (vanity_path || '').trim().toLowerCase();
  custom_domain = (custom_domain || '').trim().toLowerCase();
  if (vanity_path && /[^a-z0-9-]/.test(vanity_path)) {
    req.flash('error', 'Vanity path can only contain a-z, 0-9, and hyphen');
    return res.redirect('/dashboard');
  }
  if (vanity_path && isVanityTaken.get(vanity_path, req.user.id)) {
    req.flash('error', 'Vanity path already taken');
    return res.redirect('/dashboard');
  }
  if (custom_domain && isDomainTaken.get(custom_domain, req.user.id)) {
    req.flash('error', 'Custom domain already in use');
    return res.redirect('/dashboard');
  }
  upsertRoute.run(req.user.id, vanity_path || null, custom_domain || null);
  req.flash('success', 'Routing settings saved');
  res.redirect('/dashboard');
});

// Projects: create
router.post('/projects', ensureAuthenticated, (req, res) => {
  try {
    const { title, description, url } = req.body;
    if (!title) {
      req.flash('error', 'Project title is required');
      return res.redirect('/dashboard');
    }
    const id = uuidv4();
    const maxPosRow = getProjectMaxPos.get(req.user.id);
    const nextPos = (maxPosRow?.maxPos || 0) + 1;
    insertProject.run(id, req.user.id, String(title).trim(), (description||'').trim()||null, (url||'').trim()||null, nextPos);
    req.flash('success', 'Project added');
  } catch (e) {
    req.flash('error', 'Failed to add project');
  }
  res.redirect('/dashboard');
});

// Projects: delete
router.post('/projects/:id/delete', ensureAuthenticated, (req, res) => {
  try {
    deleteProject.run(req.params.id, req.user.id);
    req.flash('success', 'Project removed');
  } catch (e) {
    req.flash('error', 'Failed to remove project');
  }
  res.redirect('/dashboard');
});

// Experiences: create
router.post('/experiences', ensureAuthenticated, (req, res) => {
  try {
    const { role, company, start_date, end_date, description } = req.body;
    if (!role) {
      req.flash('error', 'Role is required');
      return res.redirect('/dashboard');
    }
    const id = uuidv4();
    const maxPosRow = getExperienceMaxPos.get(req.user.id);
    const nextPos = (maxPosRow?.maxPos || 0) + 1;
    insertExperience.run(
      id,
      req.user.id,
      String(role).trim(),
      (company||'').trim()||null,
      start_date || null,
      end_date || null,
      (description||'').trim()||null,
      nextPos
    );
    req.flash('success', 'Experience added');
  } catch (e) {
    req.flash('error', 'Failed to add experience');
  }
  res.redirect('/dashboard');
});

// Experiences: delete
router.post('/experiences/:id/delete', ensureAuthenticated, (req, res) => {
  try {
    deleteExperience.run(req.params.id, req.user.id);
    req.flash('success', 'Experience removed');
  } catch (e) {
    req.flash('error', 'Failed to remove experience');
  }
  res.redirect('/dashboard');
});

// Contacts: create
router.post('/contacts', ensureAuthenticated, (req, res) => {
  try {
    const { label, value } = req.body;
    if (!label || !value) {
      req.flash('error', 'Both label and value are required');
      return res.redirect('/dashboard');
    }
    const id = uuidv4();
    insertContact.run(id, req.user.id, String(label).trim(), String(value).trim());
    req.flash('success', 'Contact added');
  } catch (e) {
    req.flash('error', 'Failed to add contact');
  }
  res.redirect('/dashboard');
});

// Contacts: delete
router.post('/contacts/:id/delete', ensureAuthenticated, (req, res) => {
  try {
    deleteContact.run(req.params.id, req.user.id);
    req.flash('success', 'Contact removed');
  } catch (e) {
    req.flash('error', 'Failed to remove contact');
  }
  res.redirect('/dashboard');
});

// Sessions: revoke
router.post('/sessions/:sid/revoke', ensureAuthenticated, (req, res) => {
  const sid = req.params.sid;
  try {
    revokeSessionFlag.run(sid, req.user.id);
    const store = req.app?.locals?.sessionStore;
    if (store && typeof store.destroy === 'function') {
      store.destroy(sid, (err) => {
        if (err) console.error('Session destroy error', err);
      });
    }
    if (sid === req.sessionID) {
      req.logout?.(() => {});
      req.session?.regenerate?.(() => {});
    }
    req.flash('success', 'Session revoked');
  } catch (e) {
    console.error('Revoke session error', e);
    req.flash('error', 'Failed to revoke session');
  }
  res.redirect('/dashboard');
});

module.exports = router;
