import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import {
  authStatus,
  changePassword,
  firstLaunchProblem,
  initAuth,
  isAuthed,
  login,
  logout,
  refreshAuth,
  requireAuth,
  setupPassword,
} from './auth.js';
import { isPristine, restoreBackup, RestoreError, startAutoBackups } from './backup.js';
import { DATA_DIR, engine, migrate, pool } from './db.js';
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
    const status = await authStatus();
    res.json({
      authed,
      name: s.title || process.env.JOURNAL_NAME || 'Mon journal',
      cover: s.cover,
      ...status,
      // Journal tout neuf : on propose de repartir d'une sauvegarde.
      ...(status.needsPassword && { canRestore: await isPristine() }),
      ...(authed && { ownerName: s.ownerName, needsSetup: !s.setupDone }),
    });
  } catch (err) {
    next(err);
  }
});
app.post('/api/login', login);
app.post('/api/setup/password', setupPassword);

// Premier lancement : repartir d'une sauvegarde (.zip). Fermé dès que le journal a des données
// ou un mot de passe ; code d'installation exigé si le journal est joignable d'ailleurs.
const restoreUpload = multer({ dest: path.join(DATA_DIR, 'tmp'), limits: { fileSize: 20 * 1024 ** 3 } });
app.post(
  '/api/restore',
  async (req, res, next) => {
    try {
      if (!(await isPristine())) return res.status(409).json({ error: 'Ce journal contient déjà des données.' });
      // Code vérifié AVANT de recevoir le fichier (en-tête) : rien n'est écrit sur le disque sans lui.
      const refused = firstLaunchProblem(req, req.get('x-setup-code'));
      if (refused) return res.status(refused.status).json({ error: refused.error });
      next();
    } catch (err) {
      next(err);
    }
  },
  restoreUpload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
      const manifest = await restoreBackup(req.file.path);
      await refreshAuth();
      res.json({ restored: true, created: manifest.created, counts: manifest.counts });
    } catch (err) {
      if (err instanceof RestoreError) return res.status(400).json({ error: err.message });
      next(err);
    } finally {
      if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    }
  }
);
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

function listen(port, host) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

let running = null;

// Démarre le journal. `portFallback` : si le port est pris (l'ancien journal Docker tourne encore,
// par exemple), essayer les suivants. Renvoie le port réellement utilisé.
export async function start({ port = Number(process.env.PORT) || 3000, host = process.env.HOST || undefined, portFallback = 0 } = {}) {
  await migrate();
  await initAuth();
  startAutoBackups();
  for (let p = port; ; p++) {
    try {
      running = await listen(p, host);
      console.log(`Journal prêt sur http://localhost:${p} (base ${engine === 'embedded' ? `embarquée : ${DATA_DIR}` : 'PostgreSQL'})`);
      return p;
    } catch (err) {
      if (err.code !== 'EADDRINUSE' || p >= port + portFallback) throw err;
      console.log(`Port ${p} déjà utilisé, j'essaie ${p + 1}`);
    }
  }
}

// Arrêt propre (application de bureau) : la base embarquée est refermée correctement.
export async function stop() {
  await new Promise((resolve) => (running ? running.close(() => resolve()) : resolve()));
  await pool.end();
}

// Lancé directement (`node src/index.js`, Docker) plutôt qu'importé par l'application de bureau.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await start();
