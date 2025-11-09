# Express + PUG/EJS + Passport + MongoDB Atlas

Проєкт — це навчальний сервер на **Node.js + Express**, який еволюціонував у кілька етапів:

1. REST API (users/articles)
2. Мідлвари (логування, валідація, помилки)
3. Шаблонізатори **PUG** (users) та **EJS** (articles)
4. Cookies, вибір теми, favicon
5. Авторизація через **Passport Local** (email + пароль, сесії)
6. **Інтеграція з MongoDB Atlas** для зберігання та читання статей

Поточна версія зберігає **користувачів** в памʼяті (in-memory), а **статті** — у колекції в MongoDB Atlas, та відображає їх на сторінках сервера.

---

## Зміст

- [Функціональні можливості](#функціональні-можливості)
- [Вимоги](#вимоги)
- [Встановлення](#встановлення)
- [Налаштування середовища](#налаштування-середовища)
  - [MONGODB_URI (MongoDB Atlas)](#mongodb_urimongodb-atlas)
  - [Інші змінні](#інші-змінні)
- [Запуск сервера](#запуск-сервера)
- [Структура проєкту](#структура-проєкту)
- [Зберігання даних](#зберігання-даних)
  - [Users (in-memory)](#users-in-memory)
  - [Articles (MongoDB Atlas)](#articles-mongodb-atlas)
- [Маршрути](#маршрути)
  - [Публічні](#публічні)
  - [Авторизація (Passport)](#авторизація-passport)
  - [Теми та cookies](#теми-та-cookies)
  - [Users (PUG)](#users-pug)
  - [Articles (EJS + MongoDB)](#articles-ejs--mongodb)
  - [MongoDB демо-маршрут](#mongodb-демо-маршрут)
  - [Захищений маршрут](#захищений-маршрут)
  - [Глобальні обробники помилок](#глобальні-обробники-помилок)
- [Content Negotiation (HTML vs text/plain)](#content-negotiation-html-vs-textplain)
- [Приклади запитів](#приклади-запитів)
  - [Робота зі статтями (MongoDB)](#робота-зі-статтями-mongodb)
  - [Авторизація](#авторизація)
- [Примітки до етапу «Інтеграція MongoDB Atlas»](#примітки-до-етапу-інтеграція-mongodb-atlas)

---

## Функціональні можливості

- **Express сервер** на порту **3000**.
- **PUG** для сторінок користувачів (`/users`, `/users/:userId`).
- **EJS** для сторінок статей (`/articles`, `/articles/:articleId`).
- **Passport Local Strategy**:
  - реєстрація/логін по email + пароль;
  - сесії через `express-session` (cookie `sid`, httpOnly).
- **Теми оформлення** (light / dark / auto), збереження вибору в cookies.
- **Favicon** (`/favicon.ico`) і статичні файли (`/public/...`).
- **REST API для users/articles** у форматі `text/plain` (сумісно з початковим завданням).
- **MongoDB Atlas**:
  - підключення через офіційний драйвер `mongodb`;
  - колекція `mongoarticles`;
  - маршрут `/mongo/articles` для читання;
  - сторінка `/articles` (HTML) працює напряму з MongoDB:
    - створення статті з полями `title` + `body`;
    - перегляд списку;
    - перегляд окремої статті.

---

## Вимоги

- **Node.js**: 18+
- **npm** або **yarn**
- Обліковий запис та кластер у **MongoDB Atlas**

---

## Встановлення

У корені проєкту:

```
npm install
# або
yarn install
```

---

## Налаштування середовища
MONGODB_URI (MongoDB Atlas)

Для інтеграції з Atlas потрібно вказати connection string.
```
mongodb+srv://<user>:<password>@cluster0.efmgn8r.mongodb.net/express_passport

set MONGODB_URI=mongodb+srv://ilfcdk_db_user:ilfcdk80mongodb@cluster0.efmgn8r.mongodb.net/express_passport
npm run dev

```

---

## Запуск
```bash
node src/server.mjs
# або автоперезапуск (Node 18+)
node --watch src/server.mjs
```
За замовчуванням сервер слухає **порт 3000**.

Відкрити у браузері:
- Головна: `http://localhost:3000/`
- Реєстрація/Вхід: `http://localhost:3000/auth/register`, `http://localhost:3000/auth/login`
- Users (PUG): `http://localhost:3000/users`
- Articles (EJS): `http://localhost:3000/articles`
- Захищено: `http://localhost:3000/protected`

---

## Структура проєкту
```
src/
├─ server.mjs              # Основний файл сервера
├─ views/
│  ├─ pug/
│  │  ├─ layout.pug        # Спільний макет (header/nav/footer, flash, тема)
│  │  ├─ main.pug          # Головна сторінка
│  │  ├─ auth-login.pug    # Форма логіну
│  │  ├─ auth-register.pug # Форма реєстрації
│  │  ├─ users-index.pug   # Список користувачів + форма створення
│  │  ├─ users-show.pug    # Деталі користувача
│  │  ├─ users-not-found.pug
│  │  └─ mongo-articles.pug# Демо-сторінка читання статей з MongoDB
│  └─ ejs/
│     ├─ layout.ejs        # Макет для EJS
│     ├─ articles-index.ejs# Список статей + форма створення (title + body)
│     ├─ articles-show.ejs # Перегляд однієї статті
│     └─ articles-not-found.ejs
└─ public/
   ├─ css/
   │  └─ styles.css        # Теми, верстка, flash-повідомлення
   └─ favicon.ico          # Favicon для всіх сторінок
```


## Зберігання даних

Users (in-memory)
```
Користувачі для маршруту /users зберігаються в Map в памʼяті.

Структура:
{
  id: Number,
  surname: String,
  firstName: String,
  email: String,
  info: String,
  name: String        // зручне повне імʼя
}

Системний запис id = 0 існує завжди, але не показується у списках.
```

Articles (MongoDB Atlas)
```
Для статей використовується колекція mongoarticles у базі, вказаній у MONGODB_URI.

Один документ статті має вигляд:

{
  "_id": ObjectId("..."),
  "title": "Заголовок статті",
  "body": "Повний текст статті",
  "createdAt": "2025-10-09T18:00:00.000Z"
}


HTML-маршрути /articles та /articles/:id працюють саме з цією колекцією.

REST-текстові відповіді для /articles (GET/POST/PUT/DELETE у форматі text/plain)
залишаються сумісними з початковим завданням і працюють через in-memory Map.
```

---

## Як працює авторизація (Passport + сесії)
1. **Реєстрація** (`/auth/register`): створюється запис у пам’яті — `{ id, email, passHash, role }` (пароль хешується `bcryptjs`).
2. **Вхід** (`/auth/login`): `passport-local` перевіряє `email` та пароль (`bcrypt.compare`).
3. **Сесія**: `passport.serializeUser` зберігає `user.id` у сесії; `passport.deserializeUser` відновлює користувача за `id`.
4. **Cookie `sid`**: браузер зберігає ідентифікатор сесії (httpOnly). За `NODE_ENV=production` — тільки по HTTPS.
5. **Доступ**: мідлвари перевіряють `req.isAuthenticated()` і не пускають незалогінених на HTML-сторінки `/users`, `/articles` та `/protected` (редірект на `/` з повідомленням). Для CLI/API повертається `401 Unauthorize`.

---

## Маршрути

### `/` (головна)
- **GET /**  
  - HTML: `main.pug` (навігація + повідомлення)  
  - text: `Get root route`

### `/auth/*` (реєстрація/вхід/вихід)
- **GET /auth/register** — форма реєстрації (HTML).
- **POST /auth/register** — створює обліковку.  
  HTML: редірект на `/auth/login` · text: `201 Registered`.
- **GET /auth/login** — форма входу (HTML).
- **POST /auth/login** — перевірка email/пароля через Passport, встановлення сесії.  
  HTML: редірект на `/` · text: `200 Logged in`.
- **POST /auth/logout** — очищення сесії та cookie.  
  HTML: редірект на `/` · text: `204`.

> Невдала авторизація (HTML) → редірект на `/` із повідомленням «Unauthorize».  
> Для API/CLI → `401 Unauthorize`.

### `/users` (PUG)
> **HTML-сторінки лише для залогінених** (API GET лишається текстовим).

- **GET /users** — список + форма створення. HTML / text: `Get users route`.
- **POST /users** *(логін)* — HTML-форма або JSON API (`{ "name": "..." }`). HTML → редірект на `/users`; text → `201 Post users route`.
- **GET /users/:userId** *(логін для HTML)* — деталі або 404 (HTML); text → `Get user by Id route: {userId}`.
- **PUT /users/:userId** *(логін)* → `200 Put user by Id route: {userId}`.
- **DELETE /users/:userId** *(логін)* → `204` або `200` (за `DELETE_MODE`).

### `/articles` (EJS)
> **HTML-сторінки лише для залогінених**.

- **GET /articles** — список + форма створення. HTML / text: `Get articles route`.
читає документи з колекції mongoarticles у MongoDB Atlas
- **POST /articles** *(логін)* — HTML → редірект на `/articles`; text → `201 Post articles route`.
додає документ у колекцію mongoarticles
- **GET /articles/:articleId** *(логін для HTML)* — деталі або 404 (HTML); text → `Get article by Id route: {articleId}`.
пробує знайти документ у mongoarticles за _id (ObjectId);
- **PUT /articles/:articleId** *(логін)* → `200 Put article by Id route: {articleId}`.
- **DELETE /articles/:articleId** *(логін)* → `204` або `200` (за `DELETE_MODE`).

### `/protected`
- **GET /protected** — лише для залогінених.  
  HTML: проста сторінка «захищено»; text: `Protected content for <email>`.

### `/preferences/theme`
- **POST /preferences/theme** — зберігає тему `light|dark|auto` у cookie `theme`.  
  HTML: редірект назад; text: `200 Theme saved`.

---

## Валідація, статуси, помилки
- **ID**: позитивне ціле (в т.ч. `0` — системний, у списках прихований).
- **Users**: HTML-форма — `surname`*, `firstName`* (+ `email?`, `info?`); або JSON `{ "name": "..." }`. Некоректні дані → `400`.
- **Articles**: `title`*; некоректні дані → `400`.
- **Статуси**: GET (text) → `200`; POST → `201`; PUT → `200`; DELETE → `204` або `200` (`DELETE_MODE=text`).
- Глобально: `404 Not Found`, `500 Internal Server Error` (міжмаршрутні мідлвари підключені після всіх маршрутів).

---

## Приклади (cURL)

**Реєстрація**
```bash
curl -i -X POST http://localhost:3000/auth/register   -H "Content-Type: application/json"   -d '{"email":"admin@example.com","password":"secret","role":"admin"}'
```

**Вхід** (запам’ятайте cookie `sid`)
```bash
curl -i -X POST http://localhost:3000/auth/login   -H "Content-Type: application/json"   -d '{"email":"admin@example.com","password":"secret"}'
```

**Захищений маршрут (передайте cookie з попередньої відповіді)**
```bash
curl -i http://localhost:3000/protected   -H "Cookie: sid=<СКОПІЙОВАНЕ_З_LOGIN>"
```

**Створення користувача (API)**
```bash
curl -i -X POST http://localhost:3000/users   -H "Content-Type: application/json"   -H "Cookie: sid=<…>"   -d '{"name":"Ada Lovelace"}'
```

**Створення статті (API)**
```bash
curl -i -X POST http://localhost:3000/articles   -H "Content-Type: application/json"   -H "Cookie: sid=<…>"   -d '{"title":"Hello from EJS"}'
```

---