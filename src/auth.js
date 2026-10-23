const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const { sql, query } = require('./db');

const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

async function findUserByEmail(email) {
  const rows = await query('SELECT * FROM dbo.Users WHERE Email = @email', {
    email: [sql.NVarChar(255), email],
  });
  return rows[0];
}

async function findUserById(id) {
  const rows = await query(
    'SELECT Id, Email, Name, AvatarUrl, GoogleId, CASE WHEN PasswordHash IS NULL THEN 0 ELSE 1 END AS HasPassword, CreatedAt FROM dbo.Users WHERE Id = @id',
    { id: [sql.Int, id] }
  );
  return rows[0];
}

async function createLocalUser({ name, email, password }) {
  const hash = await bcrypt.hash(password, 12);
  const rows = await query(
    `INSERT INTO dbo.Users (Email, Name, PasswordHash)
     OUTPUT INSERTED.Id
     VALUES (@email, @name, @hash)`,
    {
      email: [sql.NVarChar(255), email],
      name: [sql.NVarChar(100), name],
      hash: [sql.NVarChar(255), hash],
    }
  );
  return rows[0].Id;
}

// ---- Вход по email и паролю ----
passport.use(
  new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const user = await findUserByEmail(email.trim().toLowerCase());
      if (!user) return done(null, false, { message: 'Неверный email или пароль' });
      if (!user.PasswordHash) {
        return done(null, false, { message: 'Этот аккаунт создан через Google — войдите через Google' });
      }
      const ok = await bcrypt.compare(password, user.PasswordHash);
      if (!ok) return done(null, false, { message: 'Неверный email или пароль' });
      return done(null, { Id: user.Id });
    } catch (err) {
      return done(err);
    }
  })
);

// ---- Вход через Google ----
if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const googleId = profile.id;
          const email = (profile.emails?.[0]?.value || '').toLowerCase();
          const name = profile.displayName || email;
          const avatar = profile.photos?.[0]?.value || null;
          if (!email) return done(null, false, { message: 'Google не передал email' });

          // 1) уже входил через Google
          let rows = await query('SELECT Id FROM dbo.Users WHERE GoogleId = @gid', {
            gid: [sql.NVarChar(64), googleId],
          });
          if (rows[0]) return done(null, { Id: rows[0].Id });

          // 2) есть аккаунт с таким email — привязываем Google
          const existing = await findUserByEmail(email);
          if (existing) {
            await query(
              'UPDATE dbo.Users SET GoogleId = @gid, AvatarUrl = COALESCE(AvatarUrl, @avatar) WHERE Id = @id',
              {
                gid: [sql.NVarChar(64), googleId],
                avatar: [sql.NVarChar(500), avatar],
                id: [sql.Int, existing.Id],
              }
            );
            return done(null, { Id: existing.Id });
          }

          // 3) новый пользователь
          rows = await query(
            `INSERT INTO dbo.Users (Email, Name, GoogleId, AvatarUrl)
             OUTPUT INSERTED.Id
             VALUES (@email, @name, @gid, @avatar)`,
            {
              email: [sql.NVarChar(255), email],
              name: [sql.NVarChar(100), name.slice(0, 100)],
              gid: [sql.NVarChar(64), googleId],
              avatar: [sql.NVarChar(500), avatar],
            }
          );
          return done(null, { Id: rows[0].Id });
        } catch (err) {
          return done(err);
        }
      }
    )
  );
}

passport.serializeUser((user, done) => done(null, user.Id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await findUserById(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  req.session.flash = { type: 'info', text: 'Войдите, чтобы продолжить' };
  return res.redirect('/login');
}

module.exports = { passport, googleEnabled, findUserByEmail, createLocalUser, requireAuth };
