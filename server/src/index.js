import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { authStatus, changePassword, initAuth, isAuthed, login, logout, requireAuth, setupPassword } from './auth.js';
import { migrate, pool } from './db.js';
import { apiRouter, errorHandler, readSettings, serveMedia } from './routes.js';

const app = express();
app.disable('x-powered-by');
// Derrière Caddy/nginx, mettre TRUST_PROXY=true pour obtenir la vraie IP (limite de connexion).
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));

app.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// Public : le titre et la couverture s'affichent sur l'écran de connexion.
// Le prénom et l'état de la première configuration ne sont donnés qu'une fois connecté.
app.get('/api/me', async (req, res, next) => {
  try {
    const s = await readSettings();
    const authed = await isAuthed(req);
    res.json({
      authed,
      name: s.title || process.env.JOURNAL_NAME || 'Mon journal',
      cover: s.cover,
      ...(await authStatus()),
      ...(authed && { ownerName: s.ownerName, needsSetup: !s.setupDone }),
    });
  } catch (err) {
    next(err);
  }
});
app.post('/api/login', login);
app.post('/api/setup/password', setupPassword);
app.put('/api/password', requireAuth, changePassword);
app.post('/api/logout', logout);
app.use('/api', requireAuth, apiRouter);
app.get('/media/:name', requireAuth, serveMedia);

// Front React compilé (copié dans ../public par le Dockerfile).
const publicDir = path.resolve(
  process.env.PUBLIC_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
);
if (fs.existsSync(publicDir)) {
  app.use(
    express.static(publicDir, {
      index: false,
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Introuvable' }));
app.use(errorHandler);

await migrate();
await initAuth();
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Journal prêt sur http://localhost:${port}`));
