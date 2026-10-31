import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db.js';

// Le mot de passe et le secret des sessions vivent dans la table `settings` :
//   password_hash     empreinte scrypt (jamais le mot de passe lui-même)
//   password_version  incrémenté à chaque changement : invalide les sessions ouvertes ailleurs
//   session_secret    clé de signature des cookies
// Anciennes installations : APP_PASSWORD / SESSION_SECRET du .env sont importés une seule fois.

const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';
const COOKIE = 'journal_session';
const MAX_AGE_S = 30 * 24 * 3600;
const MIN_LENGTH = 8;
const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };

const state = { secret: null, hash: null, version: 0, loadedAt: 0, setupCode: null };

// ---------- Empreintes ----------

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algo, N, r, p, salt, key] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(String(password ?? ''), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// ---------- Réglages en base ----------

async function readKeys() {
  const { rows } = await pool.query(
    "SELECT key, value FROM settings WHERE key IN ('password_hash', 'password_version', 'session_secret')"
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

const upsert = (client, key, value) =>
  client.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );

async function reload() {
  const s = await readKeys();
  state.hash = s.password_hash || null;
  state.version = Number(s.password_version || 0);
  state.loadedAt = Date.now();
}

// Le mot de passe peut changer dans un autre processus (commande de secours) : relecture fréquente.
async function current() {
  if (Date.now() - state.loadedAt > 5000) await reload();
  return state;
}

// Code d'installation : exigé quand le journal est joignable par d'autres machines
// (VPS, réseau local), inutile quand il n'écoute que sur ce PC.
export function setupCodeRequired() {
  const mode = (process.env.SETUP_CODE || 'auto').trim().toLowerCase();
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  const bind = (process.env.APP_BIND || '127.0.0.1').trim();
  const localOnly = ['127.0.0.1', 'localhost', '::1'].includes(bind);
  const exposed = Boolean(process.env.DOMAIN) || SECURE_COOKIE || process.env.TRUST_PROXY === 'true';
  return !localOnly || exposed;
}

export async function initAuth() {
  const s = await readKeys();
  const client = await pool.connect();
  try {
    if (!s.session_secret) {
      // Reprendre SESSION_SECRET s'il existe : les sessions déjà ouvertes restent valides.
      state.secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
      await upsert(client, 'session_secret', state.secret);
    } else {
      state.secret = s.session_secret;
    }
    if (!s.password_hash && process.env.APP_PASSWORD) {
      await upsert(client, 'password_hash', await hashPassword(process.env.APP_PASSWORD));
      console.log('Mot de passe importé depuis APP_PASSWORD : il est maintenant en base, la ligne peut être retirée du .env.');
    }
  } finally {
    client.release();
  }
  await reload();
  if (!state.hash) {
    if (setupCodeRequired()) {
      state.setupCode = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      console.log('┌───────────────────────────────────────────────────────────┐');
      console.log(`│  Code d'installation du journal : ${state.setupCode.slice(0, 3)} ${state.setupCode.slice(3)}                     │`);
      console.log('│  À saisir au premier lancement, avec le mot de passe.      │');
      console.log('└───────────────────────────────────────────────────────────┘');
    } else {
      console.log('Aucun mot de passe : il sera choisi au premier lancement du journal.');
    }
  }
}

// État public pour l'écran d'accueil.
export async function authStatus() {
  const s = await current();
  return { needsPassword: !s.hash, ...(!s.hash && { setupCodeRequired: setupCodeRequired() }) };
}

// ---------- Cookies de session ----------

const hmac = (data) => crypto.createHmac('sha256', state.secret).update(data).digest('base64url');

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${hmac(data)}`;
}

function verifyToken(token, version) {
  if (!token || !state.secret) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(data));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    // Les cookies d'avant le passage en base n'ont pas de version : ils valent la version 0.
    return payload.exp > Date.now() && (payload.pv ?? 0) === version ? payload : null;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setCookie(res, value, maxAge) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (SECURE_COOKIE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function openSession(res) {
  setCookie(res, sign({ exp: Date.now() + MAX_AGE_S * 1000, pv: state.version }), MAX_AGE_S);
}

export async function isAuthed(req) {
  const s = await current();
  return s.hash !== null && verifyToken(readCookie(req, COOKIE), s.version) !== null;
}

export async function requireAuth(req, res, next) {
  try {
    if (await isAuthed(req)) return next();
    res.status(401).json({ error: 'Non connecté' });
  } catch (err) {
    next(err);
  }
}

// ---------- Limite des essais (mot de passe, code d'installation) ----------

const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;

function tooManyAttempts(req) {
  const now = Date.now();
  const recent = (failures.get(req.ip) || []).filter((t) => now - t < WINDOW_MS);
  failures.set(req.ip, recent);
  return recent.length >= 10;
}

const recordFailure = (req) => failures.get(req.ip).push(Date.now());

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

function checkNewPassword(password) {
  const p = String(password ?? '');
  if (p.length < MIN_LENGTH) return `Le mot de passe doit faire au moins ${MIN_LENGTH} caractères.`;
  if (p.length > 200) return 'Le mot de passe est trop long.';
  return null;
}

// ---------- Routes ----------

export const login = wrap(async (req, res) => {
  if (tooManyAttempts(req)) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' });
  await reload();
  if (!state.hash) return res.status(409).json({ error: 'Le mot de passe n’a pas encore été choisi.' });
  if (!(await verifyPassword(req.body?.password, state.hash))) {
    recordFailure(req);
    return res.status(401).json({ error: 'Mauvais mot de passe…' });
  }
  failures.delete(req.ip);
  openSession(res);
  res.json({ ok: true });
});

export function logout(req, res) {
  setCookie(res, '', 0);
  res.json({ ok: true });
}

// Premier lancement : choisir le mot de passe (une seule fois, tant qu'il n'existe pas).
export const setupPassword = wrap(async (req, res) => {
  if (tooManyAttempts(req)) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' });
  if (setupCodeRequired()) {
    const given = Buffer.from(String(req.body?.code ?? '').replace(/\s/g, ''));
    const expected = Buffer.from(state.setupCode || '');
    if (!state.setupCode || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      recordFailure(req);
      return res.status(403).json({ error: 'Code d’installation incorrect. Il est affiché dans les journaux du serveur.' });
    }
  }
  const problem = checkNewPassword(req.body?.password);
  if (problem) return res.status(400).json({ error: problem });
  const hash = await hashPassword(req.body.password);
  // Insertion atomique : si quelqu'un a choisi le mot de passe entre-temps, on refuse.
  const { rowCount } = await pool.query(
    "INSERT INTO settings (key, value) VALUES ('password_hash', $1::jsonb) ON CONFLICT (key) DO NOTHING",
    [JSON.stringify(hash)]
  );
  if (!rowCount) return res.status(409).json({ error: 'Le mot de passe a déjà été choisi.' });
  state.setupCode = null;
  await reload();
  openSession(res);
  res.status(201).json({ ok: true });
});

// Paramètres : changer le mot de passe (l'ancien est demandé). Déconnecte les autres appareils.
export const changePassword = wrap(async (req, res) => {
  if (tooManyAttempts(req)) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' });
  await reload();
  if (!(await verifyPassword(req.body?.current, state.hash))) {
    recordFailure(req);
    return res.status(403).json({ error: 'Le mot de passe actuel n’est pas le bon.' });
  }
  const problem = checkNewPassword(req.body?.next);
  if (problem) return res.status(400).json({ error: problem });
  await setPassword(req.body.next);
  openSession(res); // cet appareil reste connecté
  res.json({ ok: true });
});

// Utilisé par le changement de mot de passe et par la commande de secours.
export async function setPassword(password) {
  const hash = await hashPassword(password);
  const s = await readKeys();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await upsert(client, 'password_hash', hash);
    await upsert(client, 'password_version', Number(s.password_version || 0) + 1);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await reload();
}

export { checkNewPassword };
