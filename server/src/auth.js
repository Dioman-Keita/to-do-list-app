import crypto from 'node:crypto';

const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET =
  process.env.SESSION_SECRET ||
  (() => {
    console.warn('SESSION_SECRET absent : les sessions seront perdues à chaque redémarrage.');
    return crypto.randomBytes(32).toString('hex');
  })();
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';
const COOKIE = 'journal_session';
const MAX_AGE_S = 30 * 24 * 3600;

if (!PASSWORD) console.warn('APP_PASSWORD absent : personne ne pourra ouvrir le journal.');

const hmac = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${hmac(data)}`;
}

function verify(token) {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(data));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
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

function passwordMatches(input) {
  // Comparaison à temps constant sur des empreintes de même longueur.
  const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return PASSWORD.length > 0 && crypto.timingSafeEqual(a, b);
}

export const isAuthed = (req) => verify(readCookie(req, COOKIE)) !== null;

export function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: 'Non connecté' });
}

// Limite simple : 10 échecs par IP sur 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;

export function login(req, res) {
  const ip = req.ip;
  const now = Date.now();
  const recent = (failures.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= 10) {
    return res.status(429).json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' });
  }
  if (!passwordMatches(req.body?.password)) {
    recent.push(now);
    failures.set(ip, recent);
    return res.status(401).json({ error: 'Mauvais mot de passe…' });
  }
  failures.delete(ip);
  setCookie(res, sign({ exp: now + MAX_AGE_S * 1000 }), MAX_AGE_S);
  res.json({ ok: true });
}

export function logout(req, res) {
  setCookie(res, '', 0);
  res.json({ ok: true });
}
