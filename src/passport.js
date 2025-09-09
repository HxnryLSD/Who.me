const bcrypt = require('bcryptjs');
const { db } = require('./db');

function configurePassport(passport) {
  const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
  const getUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?');

  const LocalStrategy = require('passport-local').Strategy;
  passport.use(
    new LocalStrategy(async function verify(username, password, done) {
      try {
        const user = getUserByUsername.get(username.toLowerCase());
        if (!user) return done(null, false, { message: 'Invalid username or password' });
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return done(null, false, { message: 'Invalid username or password' });
        return done(null, { id: user.id, username: user.username, email: user.email });
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser((id, done) => {
    try {
      const user = getUserById.get(id);
      if (!user) return done(null, false);
      done(null, { id: user.id, username: user.username, email: user.email });
    } catch (err) {
      done(err);
    }
  });
}

module.exports = configurePassport;
