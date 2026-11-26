import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { DATA_DIR, engine, pool } from './db.js';
import { backupConfig, backupPath, backupStatus, createBackup, initBackups, listBackups } from './backup.js';
import { createJournal, FILE_RE, HttpError, MAX_SIDE, readSettings as readSettingsCore, THUMB_SIDE } from './core/journal.js';

export { COVERS } from './core/journal.js';

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads'));
await fs.mkdir(UPLOAD_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
// Lu à chaque requête : l'application de bureau démarre LanguageTool après le serveur.
const spellcheckUrl = () => (process.env.SPELLCHECK_URL || '').replace(/\/$/, '');

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- Ce qui est propre au serveur : images sur le disque, traitées par Sharp ----

const files = {
  write: (name, bytes) => fs.writeFile(path.join(UPLOAD_DIR, name), bytes),
  remove: (...names) => Promise.all(names.filter(Boolean).map((n) => fs.rm(path.join(UPLOAD_DIR, n), { force: true }))),
};

const images = {
  // Photo : orientation EXIF appliquée, redimensionnée, JPEG + vignette WebP.
  async photo(buffer) {
    const { data, info } = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(data).resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside' }).webp({ quality: 80 }).toBuffer();
    return { main: data, thumb, width: info.width, height: info.height };
  },
  // Dessin (croquis ou calque d'annotation) : PNG transparent.
  async drawing(buffer, withThumb) {
    const { data, info } = await sharp(buffer, { failOn: 'none' })
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    const thumb = withThumb
      ? await sharp(data).resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside' }).webp({ quality: 85 }).toBuffer()
      : null;
    return { main: data, thumb, width: info.width, height: info.height };
  },
};

// Le cœur du journal (journées, tâches, images, corbeille) : partagé avec l'application Android.
const journal = createJournal({ pool, files, images });

export const readSettings = () => readSettingsCore(pool);

initBackups(UPLOAD_DIR);

export const apiRouter = express.Router();

// ---- Sauvegardes (un .zip : toutes les données + toutes les images) ----

apiRouter.get(
  '/backups',
  ah(async (req, res) => {
    const c = backupConfig();
    res.json({ dir: c.dir, intervalHours: c.intervalHours, keepDays: c.keepDays, engine, items: await listBackups(), ...backupStatus() });
  })
);

apiRouter.post(
  '/backups',
  ah(async (req, res) => res.status(201).json(await createBackup('manuelle')))
);

apiRouter.get('/backups/:name', (req, res) => {
  const file = backupPath(req.params.name);
  if (!file) return res.status(404).json({ error: 'Introuvable' });
  res.download(file, req.params.name, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Introuvable' });
  });
});

// Correcteur : relais vers LanguageTool (service local, le texte ne quitte pas la machine).
// Les mots du dictionnaire personnel ne sont jamais signalés.
apiRouter.post(
  '/spellcheck',
  ah(async (req, res) => {
    const SPELLCHECK_URL = spellcheckUrl();
    if (!SPELLCHECK_URL) throw new HttpError(503, 'Correcteur désactivé');
    const text = String(req.body?.text ?? '').slice(0, 20000);
    if (!text.trim()) return res.json({ matches: [] });
    let response;
    try {
      response = await fetch(`${SPELLCHECK_URL}/v2/check`, {
        method: 'POST',
        body: new URLSearchParams({ text, language: 'fr', disabledCategories: 'TYPOGRAPHY' }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new HttpError(503, 'Correcteur indisponible');
    }
    if (!response.ok) throw new HttpError(503, 'Correcteur indisponible');
    const data = await response.json();
    const { rows } = await pool.query('SELECT word FROM dictionary');
    const dictionary = new Set(rows.map((r) => r.word));
    const matches = data.matches
      .map((m) => ({
        offset: m.offset,
        length: m.length,
        message: m.message,
        word: text.slice(m.offset, m.offset + m.length),
        replacements: m.replacements.slice(0, 6).map((r) => r.value),
        type: m.rule?.issueType === 'misspelling' ? 'spelling' : 'grammar',
      }))
      .filter((m) => !(m.type === 'spelling' && dictionary.has(m.word.toLowerCase())));
    res.json({ matches });
  })
);

// ---- Tout le reste : le cœur partagé ----

apiRouter.use(
  upload.single('file'),
  ah(async (req, res) => {
    const r = await journal.handle(req.method, req.path, { query: req.query, body: req.body || {}, file: req.file?.buffer || null });
    if (r.body === undefined) return res.status(r.status).end();
    res.status(r.status).json(r.body);
  })
);

export function serveMedia(req, res) {
  if (!FILE_RE.test(req.params.name)) return res.status(404).end();
  // Les noms sont uniques (UUID) : le contenu ne change jamais, cache long.
  // `private` : ces images exigent une session, aucun cache partagé ne doit les garder.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(path.join(UPLOAD_DIR, req.params.name), { cacheControl: false }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  // Erreurs 4xx d'Express / body-parser (JSON mal formé, corps trop gros…).
  if (err.expose && err.status >= 400 && err.status < 500) {
    const messages = { 'entity.parse.failed': 'JSON invalide', 'entity.too.large': 'Requête trop lourde' };
    return res.status(err.status).json({ error: messages[err.type] || err.message });
  }
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop lourd (30 Mo max)' : err.message;
    return res.status(400).json({ error: msg });
  }
  if (/unsupported image format|Input buffer/i.test(err.message || '')) {
    return res.status(415).json({ error: "Ce fichier n'est pas une image lisible" });
  }
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
}
