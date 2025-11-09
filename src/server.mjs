// Реалізація EXPRESS сервера відповідно до завдання, описаного у файлі ASSIGNMENT.md

// Імпортуємо необхідні модулі
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pug from 'pug';
import ejs from 'ejs';
import bcrypt from 'bcryptjs';
import favicon from 'serve-favicon';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { MongoClient, ObjectId } from 'mongodb';

// Створюємо EXPRESS сервер
const app = express();

/**
 * ===== Налаштування режимів =====
 * DELETE_MODE:
 *   - 'text' → DELETE повертає 200 + текст "Delete ... by Id route: {id}"
 *   - інше → DELETE повертає 204 No Content
 */
const DELETE_MODE = process.env.DELETE_MODE === 'text' ? 'text' : '204';

/* ====================== MongoDB Atlas (офіційний драйвер) ===================== */

const MONGODB_URI = process.env.MONGODB_URI || '';
let mongoClient = null;
let mongoDb = null;
const ARTICLES_COLLECTION = 'mongoarticles';

if (!MONGODB_URI) {
  console.warn('[mongo] MONGODB_URI is not set. Mongo routes will show empty data.');
}

async function getMongoDb() {
  if (!MONGODB_URI) return null;
  if (mongoDb) return mongoDb;

  if (!mongoClient) {
    mongoClient = new MongoClient(MONGODB_URI);
  }

  if (!mongoClient.topology || !mongoClient.topology.isConnected()) {
    await mongoClient.connect();
    console.log('[mongo] Connected to MongoDB Atlas');
  }

  mongoDb = mongoClient.db(); // база з URI
  return mongoDb;
}

async function getArticlesCollection() {
  const db = await getMongoDb();
  if (!db) return null;
  return db.collection(ARTICLES_COLLECTION);
}

/* ====================== Базові мідлвари ====================== */

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Акуратний 400 для кривого JSON
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    res.type('text/plain; charset=utf-8');
    return res.status(400).send('Bad Request');
  }
  return next(err);
});

// Сесії (для Passport)
app.use(
  session({
    name: 'sid',
    secret: process.env.SESSION_SECRET || 'dev-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 3600 * 1000,
    },
  })
);

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Кореляційний ID
let rid = 0;
app.use((req, _res, next) => {
  req.id = (++rid).toString().padStart(6, '0');
  next();
});

// View engines + статика
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.resolve(path.dirname(__filename));

app.engine('pug', pug.__express);
app.engine('ejs', ejs.__express);

app.set('views', [
  path.join(__dirname, 'views', 'pug'),
  path.join(__dirname, 'views', 'ejs'),
]);

app.use(
  '/public',
  express.static(path.join(__dirname, 'public'), {
    fallthrough: true,
    maxAge: '7d',
  })
);

// Favicon
const favPath = path.join(__dirname, 'public', 'favicon.ico');
if (fs.existsSync(favPath)) {
  app.use(favicon(favPath));
} else {
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
}

// ---- Контент-неґоціація: HTML vs text/plain ----
function wantsHtml(req) {
  const accept = String(req.headers['accept'] || '').toLowerCase();
  if (accept.includes('text/html')) return true;
  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (/(mozilla|chrome|safari|edg|firefox|opera)/i.test(ua)) return true;
  return false;
}

app.use((req, res, next) => {
  res.type(wantsHtml(req) ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
  next();
});

/* ====================== Утиліти/Валідація ====================== */

function logRequests(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(
      `${new Date().toISOString()} [${req.id}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`
    );
  });
  next();
}

const isPositiveInt = (v) => /^\d+$/.test(String(v));
function validateIdParam(paramName) {
  return (req, res, next) => {
    const id = req.params[paramName];
    if (!isPositiveInt(id)) {
      return res.status(404).send('Not Found');
    }
    next();
  };
}

function validateUserBody(req, res, next) {
  const b = req.body ?? {};
  const hasPerson =
    typeof b.surname === 'string' &&
    b.surname.trim() !== '' &&
    typeof b.firstName === 'string' &&
    b.firstName.trim() !== '';
  const hasName = typeof b.name === 'string' && b.name.trim() !== '';
  if (hasPerson || hasName) return next();
  return res.status(400).send('Bad Request');
}

function validateArticleBody(req, res, next) {
  const { title } = req.body ?? {};
  if (typeof title !== 'string' || title.trim() === '') {
    return res.status(400).send('Bad Request');
  }
  next();
}

// Flash helpers
const setFlash = (req, type, text) => {
  req.session.flash = { type, text };
};
const popFlash = (req) => {
  const f = req.session.flash || null;
  delete req.session.flash;
  return f;
};

/* ====================== In-memory моделі ====================== */

const users = new Map();
const articles = new Map();
let userSeq = 1;
let articleSeq = 1;

if (!users.has(0)) {
  users.set(0, {
    id: 0,
    surname: '',
    firstName: '',
    email: '',
    info: '',
    name: 'System User',
  });
}
if (!articles.has(0)) {
  articles.set(0, { id: 0, title: 'System Article' });
}

// In-memory акаунти для Passport
const authUsers = new Map();

/* ====================== Глобальні locals ====================== */

app.use((req, res, next) => {
  res.locals.theme = req.cookies?.theme || 'light';
  next();
});

app.use((req, res, next) => {
  res.locals.currentUser = req.user
    ? { id: req.user.id, email: req.user.email, role: req.user.role }
    : null;
  next();
});

app.use((req, _res, next) => {
  if (req.session?.messages?.length) {
    setFlash(req, 'error', 'Unauthorize');
    req.session.messages = [];
  }
  next();
});

/* ====================== Passport Local Strategy ====================== */

passport.use(
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
    },
    async (email, password, done) => {
      try {
        const rec = authUsers.get(String(email).toLowerCase().trim());
        if (!rec) return done(null, false, { message: 'Невірні облікові дані' });
        const ok = await bcrypt.compare(password, rec.passHash);
        if (!ok) return done(null, false, { message: 'Невірні облікові дані' });
        return done(null, { id: rec.id, email: rec.email, role: rec.role });
      } catch (err) {
        return done(err);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  for (const rec of authUsers.values()) {
    if (rec.id === id) {
      return done(null, { id: rec.id, email: rec.email, role: rec.role });
    }
  }
  return done(null, false);
});

/* ====================== Хелпери доступу ====================== */

function flashAndRedirectHome(req, res, message) {
  if (wantsHtml(req)) {
    setFlash(req, 'error', message);
    return res.redirect(303, '/');
  }
  return res.status(401).send('Unauthorize');
}

function ensureAuthenticatedView(req, res, next) {
  if (!wantsHtml(req)) return next();
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return flashAndRedirectHome(req, res, 'Необхідна авторизація');
}

function ensureAuthenticatedApi(req, res, next) {
  if (wantsHtml(req)) return next();
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.status(401).send('Unauthorize');
}

function ensureAuthenticatedAny(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return flashAndRedirectHome(req, res, 'Необхідна авторизація');
}

/* ====================== Маршрути ====================== */

// Головна
app.get('/', logRequests, (req, res) => {
  if (!wantsHtml(req)) {
    return res.status(200).send('Get root route');
  }
  const flash = popFlash(req);
  const msg = flash && typeof flash === 'object' ? flash.text : flash;
  return res.status(200).render('main.pug', { title: 'Main', msg });
});

/* ---- Auth ---- */

app.get('/auth/login', (req, res) => {
  if (!wantsHtml(req)) return res.status(404).send('Not Found');
  const flash = popFlash(req);
  const msg = flash && typeof flash === 'object' ? flash.text : flash;
  return res.status(200).render('auth-login.pug', { title: 'Login', msg });
});

app.get('/auth/register', (req, res) => {
  if (!wantsHtml(req)) return res.status(404).send('Not Found');
  const flash = popFlash(req);
  const msg = flash && typeof flash === 'object' ? flash.text : flash;
  return res.status(200).render('auth-register.pug', { title: 'Register', msg });
});

app.post('/auth/register', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const password = String(req.body?.password || '');
    const role = String(req.body?.role || 'user').toLowerCase().trim();
    if (!email || !password) return res.status(400).send('Bad Request');
    if (authUsers.has(email)) return res.status(400).send('Bad Request');
    const passHash = await bcrypt.hash(password, 10);
    const id = `auth-${authUsers.size + 1}`;
    authUsers.set(email, { id, email, passHash, role });

    if (wantsHtml(req)) {
      setFlash(req, 'success', 'Registered');
      return res.redirect(303, '/auth/login');
    }
    return res.status(201).send('Registered');
  } catch (e) {
    next(e);
  }
});

app.post(
  '/auth/login',
  passport.authenticate('local', { failureRedirect: '/', failureMessage: true }),
  (req, res) => {
    if (wantsHtml(req)) {
      setFlash(req, 'success', 'Logged in');
      return res.redirect(303, '/');
    }
    return res.status(200).send('Logged in');
  }
);

app.post('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie('sid');
      if (wantsHtml(req)) return res.redirect(303, '/');
      return res.status(204).end();
    });
  });
});

/* ---- Тема ---- */

app.post('/preferences/theme', (req, res) => {
  const allowed = new Set(['light', 'dark', 'auto']);
  const theme = String(req.body?.theme || '').toLowerCase().trim();
  if (!allowed.has(theme)) return res.status(400).send('Bad Request');

  res.cookie('theme', theme, {
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 90 * 24 * 3600 * 1000,
  });

  const back = req.get('referer') || '/';
  if (wantsHtml(req)) return res.redirect(303, back);
  return res.status(200).send('Theme saved');
});

/* ---- Users (PUG) ---- */

const usersRouter = express.Router();

usersRouter.get('/', ensureAuthenticatedView, (req, res) => {
  if (!wantsHtml(req)) {
    return res.status(200).send('Get users route');
  }
  const list = Array.from(users.values())
    .filter((u) => u.id !== 0)
    .sort((a, b) => a.id - b.id);

  const flash = popFlash(req);
  const msg = flash && typeof flash === 'object' ? flash.text : flash;

  return res.status(200).render('users-index.pug', {
    title: 'Users',
    users: list,
    msg,
  });
});

usersRouter.post('/', ensureAuthenticatedApi, validateUserBody, (req, res) => {
  const b = req.body ?? {};
  const id = userSeq++;

  let record;
  if ((b.surname && b.firstName) || wantsHtml(req)) {
    const surname = String(b.surname || '').trim();
    const firstName = String(b.firstName || '').trim();
    const email = String(b.email || '').trim();
    const info = String(b.info || '').trim();
    const displayName = `${surname} ${firstName}`.trim() || String(b.name || '').trim();
    record = { id, surname, firstName, email, info, name: displayName };
  } else {
    const name = String(b.name || '').trim();
    record = { id, name };
  }

  users.set(id, record);

  if (wantsHtml(req)) {
    setFlash(req, 'success', 'Post users route');
    return res.redirect(303, '/users');
  }
  return res.status(201).send('Post users route');
});

usersRouter.get('/:userId', ensureAuthenticatedView, validateIdParam('userId'), (req, res) => {
  const { userId } = req.params;
  const id = Number(userId);
  const exists = users.has(id);

  if (!wantsHtml(req)) {
    return res.status(200).send(`Get user by Id route: ${userId}`);
  }

  if (!exists) {
    return res.status(404).render('users-not-found.pug', {
      title: 'User not found',
      userId: id,
    });
  }

  const entity = users.get(id);
  return res.status(200).render('users-show.pug', {
    title: `User ${id}`,
    user: entity,
  });
});

usersRouter.put(
  '/:userId',
  ensureAuthenticatedApi,
  validateIdParam('userId'),
  validateUserBody,
  (req, res) => {
    const { userId } = req.params;
    const b = req.body ?? {};
    const id = Number(userId);

    if (b.surname && b.firstName) {
      const surname = String(b.surname || '').trim();
      const firstName = String(b.firstName || '').trim();
      const email = String(b.email || '').trim();
      const info = String(b.info || '').trim();
      const displayName = `${surname} ${firstName}`.trim();
      users.set(id, { id, surname, firstName, email, info, name: displayName });
    } else {
      const name = String(b.name || '').trim();
      users.set(id, { id, name });
    }

    res.status(200).send(`Put user by Id route: ${userId}`);
  }
);

usersRouter.delete('/:userId', ensureAuthenticatedApi, validateIdParam('userId'), (req, res) => {
  const { userId } = req.params;
  const id = Number(userId);
  if (id !== 0) users.delete(id);
  if (DELETE_MODE === 'text') {
    return res.status(200).send(`Delete user by Id route: ${userId}`);
  }
  return res.status(204).end();
});

app.use('/users', usersRouter);

/* ---- Articles (EJS + Mongo для HTML, in-memory для text/plain) ---- */

const articlesRouter = express.Router();

// GET /articles
articlesRouter.get('/', ensureAuthenticatedView, async (req, res) => {
  if (!wantsHtml(req)) {
    return res.status(200).send('Get articles route');
  }

  try {
    const collection = await getArticlesCollection();

    const flash = popFlash(req);
    const msg = flash && typeof flash === 'object' ? flash.text : flash;

    if (!collection) {
      const contentHtml = await new Promise((resolve, reject) => {
        ejs.renderFile(
          path.join(__dirname, 'views', 'ejs', 'articles-index.ejs'),
          {
            title: 'Articles',
            articles: [],
            msg: msg || 'Немає підключення до MongoDB або MONGODB_URI не задано.',
          },
          (err, html) => (err ? reject(err) : resolve(html))
        );
      });

      return res
        .status(200)
        .render('layout.ejs', { title: 'Articles', body: contentHtml, msg });
    }

    const docs = await collection.find({}).sort({ createdAt: -1 }).toArray();

    const contentHtml = await new Promise((resolve, reject) => {
      ejs.renderFile(
        path.join(__dirname, 'views', 'ejs', 'articles-index.ejs'),
        {
          title: 'Articles',
          articles: docs,
          msg,
        },
        (err, html) => (err ? reject(err) : resolve(html))
      );
    });

    return res
      .status(200)
      .render('layout.ejs', { title: 'Articles', body: contentHtml, msg });
  } catch (err) {
    console.error('[GET /articles] render error:', err);
    if (!wantsHtml(req)) return res.status(500).send('Internal Server Error');
    return res.status(500).send('Internal Server Error');
  }
});

// POST /articles
articlesRouter.post(
  '/',
  ensureAuthenticatedApi,
  validateArticleBody,
  async (req, res, next) => {
    const { title } = req.body;
    const trimmed = String(title || '').trim();
    const bodyText = String(req.body?.body || '').trim(); // НОВЕ

    // text/plain — старий in-memory режим (для тестів/CLI)
    if (!wantsHtml(req)) {
      const id = articleSeq++;
      articles.set(id, { id, title: trimmed });
      return res.status(201).send('Post articles route');
    }

    try {
      const collection = await getArticlesCollection();
      if (!collection) {
        setFlash(req, 'error', 'Немає підключення до MongoDB.');
        return res.redirect(303, '/articles');
      }

      await collection.insertOne({
        title: trimmed,
        body: bodyText,        // ← тепер зберігаємо текст статті
        createdAt: new Date(),
      });

      setFlash(req, 'success', 'Post articles route');
      return res.redirect(303, '/articles');
    } catch (err) {
      return next(err);
    }
  }
);


// GET /articles/:articleId
articlesRouter.get('/:articleId', ensureAuthenticatedView, async (req, res) => {
  const { articleId } = req.params;

  if (!wantsHtml(req)) {
    return res.status(200).send(`Get article by Id route: ${articleId}`);
  }

  try {
    const collection = await getArticlesCollection();
    if (!collection) {
      return ejs.renderFile(
        path.join(__dirname, 'views', 'ejs', 'articles-not-found.ejs'),
        { title: 'Article not found', articleId },
        (err, html) => {
          if (err) {
            console.error(err);
            return res.status(500).send('Internal Server Error');
          }
          return res.status(500).render('layout.ejs', {
            title: 'Article not found',
            body: html,
          });
        }
      );
    }

    let doc = null;
    try {
      doc = await collection.findOne({ _id: new ObjectId(articleId) });
    } catch (_e) {
      doc = null;
    }

    if (!doc) {
      return ejs.renderFile(
        path.join(__dirname, 'views', 'ejs', 'articles-not-found.ejs'),
        { title: 'Article not found', articleId },
        (err, html) => {
          if (err) {
            console.error(err);
            return res.status(500).send('Internal Server Error');
          }
          return res.status(404).render('layout.ejs', {
            title: 'Article not found',
            body: html,
          });
        }
      );
    }

    return ejs.renderFile(
      path.join(__dirname, 'views', 'ejs', 'articles-show.ejs'),
      { title: 'Article', article: doc },
      (err, html) => {
        if (err) {
          console.error(err);
          return res.status(500).send('Internal Server Error');
        }
        return res.status(200).render('layout.ejs', { title: 'Article', body: html });
      }
    );
  } catch (err) {
    console.error('[GET /articles/:id] error:', err);
    return res.status(500).send('Internal Server Error');
  }
});

// PUT /articles/:articleId — лишаємо старий in-memory режим для text/plain
articlesRouter.put(
  '/:articleId',
  ensureAuthenticatedApi,
  validateIdParam('articleId'),
  validateArticleBody,
  (req, res) => {
    const { articleId } = req.params;
    const { title } = req.body;
    const id = Number(articleId);
    articles.set(id, { id, title: String(title || '').trim() });
    res.status(200).send(`Put article by Id route: ${articleId}`);
  }
);

// DELETE /articles/:articleId — in-memory, text/plain
articlesRouter.delete(
  '/:articleId',
  ensureAuthenticatedApi,
  validateIdParam('articleId'),
  (req, res) => {
    const { articleId } = req.params;
    const id = Number(articleId);
    if (id !== 0) articles.delete(id);
    if (DELETE_MODE === 'text') {
      return res.status(200).send(`Delete article by Id route: ${articleId}`);
    }
    return res.status(204).end();
  }
);

app.use('/articles', articlesRouter);

/* ---- Protected ---- */

app.get('/protected', ensureAuthenticatedAny, (req, res) => {
  if (!wantsHtml(req)) {
    return res.status(200).send(`Protected content for ${req.user.email}`);
  }
  return res
    .status(200)
    .render('main.pug', { title: 'Protected', msg: `Вітаю, ${req.user.email}! Це захищена сторінка.` });
});

/* ---- MongoDB: читання з mongoarticles ---- */

app.get('/mongo/articles', async (req, res) => {
  try {
    const collection = await getArticlesCollection();

    if (!collection) {
      if (!wantsHtml(req)) {
        return res
          .status(200)
          .send('Mongo articles route (немає підключення до MongoDB)');
      }
      return res.status(200).render('mongo-articles.pug', {
        title: 'Mongo Articles',
        docs: [],
        info: 'Немає підключення до MongoDB або MONGODB_URI не задано.',
      });
    }

    const docs = await collection.find({}).sort({ createdAt: -1 }).toArray();

    if (!wantsHtml(req)) {
      const lines =
        docs.map((d) => `#${d._id}: ${d.title || '(без назви)'}`).join('\n') ||
        'Документів немає.';
      return res.status(200).send(lines);
    }

    return res.status(200).render('mongo-articles.pug', {
      title: 'Mongo Articles',
      docs,
      info: null,
    });
  } catch (err) {
    console.error('[GET /mongo/articles] error:', err);
    if (!wantsHtml(req)) return res.status(500).send('Internal Server Error');
    return res.status(500).render('mongo-articles.pug', {
      title: 'Mongo Articles – Error',
      docs: [],
      info: 'Сталася помилка при читанні з бази даних.',
    });
  }
});

/* ====================== Глобальні обробники ====================== */

app.use((req, res) => {
  res.status(404).send('Not Found');
});

app.use((err, req, res, next) => {
  console.error(err?.stack || err);
  res.status(500).send('Internal Server Error');
});

/* ====================== Старт сервера ====================== */

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || '0.0.0.0';
const server = app.listen(PORT, HOST, () => {
  console.log(`[boot] server listening on http://${HOST}:${PORT}`);
});

// Експорт для тестів
export { server, app };
