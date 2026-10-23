require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const { sql, query, getPool } = require('./db');
const { passport, googleEnabled, findUserByEmail, createLocalUser, requireAuth } = require('./auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Общие переменные для всех шаблонов + одноразовые сообщения (flash)
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.googleEnabled = googleEnabled;
  res.locals.path = req.path;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const flash = (req, type, text) => { req.session.flash = { type, text }; };

// ---------- Страницы ----------
app.get('/', asyncH(async (req, res) => {
  const featured = await query(
    'SELECT TOP 4 * FROM dbo.MenuItems WHERE IsFeatured = 1 ORDER BY Category, SortOrder'
  );
  res.render('home', { title: 'FoodZero — Healthy Eating', featured });
}));

app.get('/menu', asyncH(async (req, res) => {
  const items = await query('SELECT * FROM dbo.MenuItems ORDER BY SortOrder, Name');
  const order = ['Starters', 'Main Dish', 'Desserts', 'Drinks'];
  const groups = {};
  for (const it of items) (groups[it.Category] ||= []).push(it);
  const categories = Object.keys(groups).sort(
    (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)
  );
  res.render('menu', { title: 'Menu — FoodZero', groups, categories });
}));

app.get('/about', (req, res) => res.render('about', { title: 'About — FoodZero' }));

// ---------- Бронирование ----------
app.get('/reservation', (req, res) => {
  res.render('reservation', { title: 'Book a table — FoodZero', form: {}, errors: [] });
});

app.post('/reservation', asyncH(async (req, res) => {
  const form = {
    name: (req.body.name || '').trim(),
    email: (req.body.email || '').trim().toLowerCase(),
    phone: (req.body.phone || '').trim(),
    guests: Number(req.body.guests),
    date: req.body.date || '',
    time: req.body.time || '',
    comment: (req.body.comment || '').trim(),
  };
  const errors = [];
  if (!form.name || form.name.length > 100) errors.push('Укажите имя');
  if (!EMAIL_RE.test(form.email)) errors.push('Укажите корректный email');
  if (!/^[+\d\s()-]{6,30}$/.test(form.phone)) errors.push('Укажите корректный телефон');
  if (!Number.isInteger(form.guests) || form.guests < 1 || form.guests > 20) errors.push('Гостей: от 1 до 20');
  const when = new Date(`${form.date}T${form.time}`);
  if (Number.isNaN(when.getTime())) errors.push('Укажите дату и время');
  else if (when < new Date()) errors.push('Дата должна быть в будущем');
  if (form.comment.length > 500) errors.push('Комментарий до 500 символов');

  if (errors.length) {
    return res.status(400).render('reservation', { title: 'Book a table — FoodZero', form, errors });
  }

  await query(
    `INSERT INTO dbo.Reservations (UserId, Name, Email, Phone, Guests, ReservedAt, Comment)
     VALUES (@uid, @name, @email, @phone, @guests, @at, @comment)`,
    {
      uid: [sql.Int, req.user ? req.user.Id : null],
      name: [sql.NVarChar(100), form.name],
      email: [sql.NVarChar(255), form.email],
      phone: [sql.NVarChar(30), form.phone],
      guests: [sql.Int, form.guests],
      at: [sql.DateTime2, when],
      comment: [sql.NVarChar(500), form.comment || null],
    }
  );
  flash(req, 'success', 'Столик забронирован! Мы ждём вас.');
  res.redirect(req.user ? '/profile' : '/reservation');
}));

// ---------- Регистрация и вход по email ----------
app.get('/register', (req, res) => {
  if (req.user) return res.redirect('/profile');
  res.render('register', { title: 'Sign up — FoodZero', form: {}, errors: [] });
});

app.post('/register', asyncH(async (req, res, next) => {
  const form = {
    name: (req.body.name || '').trim(),
    email: (req.body.email || '').trim().toLowerCase(),
  };
  const { password = '', password2 = '' } = req.body;
  const errors = [];
  if (!form.name || form.name.length > 100) errors.push('Укажите имя');
  if (!EMAIL_RE.test(form.email)) errors.push('Укажите корректный email');
  if (password.length < 8) errors.push('Пароль — минимум 8 символов');
  if (password !== password2) errors.push('Пароли не совпадают');
  if (!errors.length && (await findUserByEmail(form.email))) errors.push('Пользователь с таким email уже есть');

  if (errors.length) {
    return res.status(400).render('register', { title: 'Sign up — FoodZero', form, errors });
  }

  const id = await createLocalUser({ ...form, password });
  req.login({ Id: id }, (err) => {
    if (err) return next(err);
    flash(req, 'success', `Добро пожаловать, ${form.name}!`);
    res.redirect('/profile');
  });
}));

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/profile');
  res.render('login', { title: 'Log in — FoodZero', email: '' });
});

app.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      res.locals.flash = { type: 'error', text: info?.message || 'Ошибка входа' };
      return res.status(401).render('login', { title: 'Log in — FoodZero', email: req.body.email || '' });
    }
    const returnTo = req.session.returnTo || '/profile';
    req.login(user, (e) => {
      if (e) return next(e);
      res.redirect(returnTo);
    });
  })(req, res, next);
});

// ---------- Вход через Google ----------
app.get('/auth/google', (req, res, next) => {
  if (!googleEnabled) {
    flash(req, 'error', 'Вход через Google не настроен: заполните GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET в .env');
    return res.redirect('/login');
  }
  passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      flash(req, 'error', info?.message || 'Не удалось войти через Google');
      return res.redirect('/login');
    }
    const returnTo = req.session.returnTo || '/profile';
    req.login(user, (e) => (e ? next(e) : res.redirect(returnTo)));
  })(req, res, next);
});

app.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => res.redirect('/'));
  });
});

// ---------- Личный кабинет ----------
app.get('/profile', requireAuth, asyncH(async (req, res) => {
  const reservations = await query(
    'SELECT * FROM dbo.Reservations WHERE UserId = @uid ORDER BY ReservedAt DESC',
    { uid: [sql.Int, req.user.Id] }
  );
  res.render('profile', { title: 'My account — FoodZero', reservations });
}));

// ---------- Ошибки ----------
app.use((req, res) => res.status(404).render('error', { title: 'Not found', code: 404, message: 'Страница не найдена' }));
app.use((err, req, res, _next) => {
  console.error(err);
  const dbDown = /ConnectionError|ESOCKET|ETIMEOUT|ELOGIN|EINSTLOOKUP/.test(`${err.name} ${err.code}`);
  res.status(500).render('error', {
    title: 'Error',
    code: 500,
    message: dbDown ? 'Нет подключения к базе данных SQL Server. Проверьте настройки в .env' : 'Что-то пошло не так',
  });
});

app.listen(PORT, async () => {
  console.log(`FoodZero запущен: http://localhost:${PORT}`);
  console.log(`Вход через Google: ${googleEnabled ? 'включён' : 'выключен (нет ключей в .env)'}`);
  try {
    await getPool();
    console.log('SQL Server: подключено');
  } catch (e) {
    console.error('SQL Server: НЕ удалось подключиться —', e.message);
    console.error('Смотрите README.md, раздел «Если не подключается к базе».');
  }
});
