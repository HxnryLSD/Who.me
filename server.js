const path = require('path');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const flash = require('express-flash');
const methodOverride = require('method-override');
const passport = require('passport');
const helmet = require('helmet');

// Local modules
const { db } = require('./src/db');
const configurePassport = require('./src/passport');

// Routes
const authRoutes = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const publicRoutes = require('./src/routes/public');

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "img-src": ["'self'", 'data:', 'https://icons.duckduckgo.com'],
      "script-src": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'"],
    },
  },
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));

// Static files
app.use('/static', express.static(path.join(__dirname, 'public')));

// Parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

// Sessions
const sessionStore = new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'data') });
app.locals.sessionStore = sessionStore;
app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 days
  })
);

app.use(flash());
// Expose flash messages helper to views as messages()
app.use((req, res, next) => {
  res.locals.messages = () => req.flash();
  next();
});

// Passport
configurePassport(passport);
app.use(passport.initialize());
app.use(passport.session());

// Expose user to views
app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  next();
});

// Track active sessions last_seen
const upsertSession = db.prepare(`INSERT INTO user_sessions (session_id, user_id, user_agent, ip, created_at, last_seen, active)
  VALUES (?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(session_id) DO UPDATE SET last_seen = excluded.last_seen, active = 1`);
app.use((req, res, next) => {
  if (req.user) {
    const sid = req.sessionID;
    const ua = req.headers['user-agent'] || null;
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || null;
    const now = new Date().toISOString();
    upsertSession.run(sid, req.user.id, ua, ip, now, now);
  }
  next();
});

// Vanity path and custom domain resolution
const getUserByRoute = db.prepare('SELECT u.* FROM user_routes r JOIN users u ON u.id = r.user_id WHERE r.custom_domain = ?');
const getUserByVanity = db.prepare('SELECT u.* FROM user_routes r JOIN users u ON u.id = r.user_id WHERE r.vanity_path = ?');
const getProfileByUser = db.prepare('SELECT * FROM profiles WHERE user_id = ?');
const listLinksByUser = db.prepare('SELECT * FROM links WHERE user_id = ? ORDER BY position ASC, label ASC');

// Custom domain: serve public profile at root for matching Host
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (!host) return next();
  const user = getUserByRoute.get(host);
  if (user) {
    // Avoid intercepting dashboard/auth/static paths on custom domains
    const pathFirst = (req.path.split('/')[1] || '').toLowerCase();
    if (['auth', 'dashboard', 'static'].includes(pathFirst)) return next();
    const profile = getProfileByUser.get(user.id);
    const links = listLinksByUser.all(user.id);
    return res.render('public/profile', { title: `${user.username} • Who.Me`, username: user.username, profile, links, profileTheme: profile?.theme || null, profileCustomCss: profile?.custom_css || null });
  }
  next();
});

// Vanity path: serve /:vanity unless hitting known prefixes
app.get('/:vanity', (req, res, next) => {
  const p = (req.params.vanity || '').toLowerCase();
  if (!p || ['auth', 'dashboard', 'u', 'static'].includes(p)) return next();
  const user = getUserByVanity.get(p);
  if (!user) return next();
  const profile = getProfileByUser.get(user.id);
  const links = listLinksByUser.all(user.id);
  return res.render('public/profile', { title: `${user.username} • Who.Me`, username: user.username, profile, links, profileTheme: profile?.theme || null, profileCustomCss: profile?.custom_css || null });
});

// Home
app.get('/', (req, res) => {
  res.render('home', { title: 'Who.Me' });
});

// Mount routes
app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/', publicRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads', 'avatars');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Initialize DB (tables are created on import)
void db;

app.listen(PORT, () => {
  console.log(`Who.Me running on http://localhost:${PORT}`);
});
