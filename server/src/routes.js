import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { pool } from './db.js';

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'data/uploads');
await fs.mkdir(UPLOAD_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const MAX_SIDE = 2400;
const THUMB_SIDE = 640;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEDIA_COLS = 'id, day, kind, file, thumb, overlay, caption, width, height, tilt, created_at';
const ENTRY_COLS = 'day, title, body, moods, weather, content, content_text, updated_at';
const SPELLCHECK_URL = (process.env.SPELLCHECK_URL || '').replace(/\/$/, '');

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseDay(value) {
  if (!DAY_RE.test(value || '') || Number.isNaN(Date.parse(value))) throw new HttpError(400, 'Date invalide');
  return value;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Identifiant invalide');
  return id;
}

const randomTilt = () => Math.round((Math.random() * 8 - 4) * 10) / 10;

async function writeFile(name, buffer) {
  await fs.writeFile(path.join(UPLOAD_DIR, name), buffer);
  return name;
}

async function removeFiles(...names) {
  await Promise.all(names.filter(Boolean).map((n) => fs.rm(path.join(UPLOAD_DIR, n), { force: true })));
}

// Photo : orientation EXIF appliquée, redimensionnée, JPEG + vignette WebP.
async function storePhoto(buffer) {
  const id = crypto.randomUUID();
  const { data, info } = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const thumb = await sharp(data).resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside' }).webp({ quality: 80 }).toBuffer();
  return {
    file: await writeFile(`${id}.jpg`, data),
    thumb: await writeFile(`${id}-t.webp`, thumb),
    width: info.width,
    height: info.height,
  };
}

// Dessin (croquis ou calque d'annotation) : PNG transparent.
async function storeDrawing(buffer, withThumb) {
  const id = crypto.randomUUID();
  const { data, info } = await sharp(buffer, { failOn: 'none' })
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  const result = { file: await writeFile(`${id}.png`, data), width: info.width, height: info.height };
  if (withThumb) {
    const thumb = await sharp(data).resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside' }).webp({ quality: 85 }).toBuffer();
    result.thumb = await writeFile(`${id}-t.webp`, thumb);
  }
  return result;
}

async function findMedia(id) {
  const { rows } = await pool.query(`SELECT ${MEDIA_COLS} FROM media WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw new HttpError(404, 'Introuvable');
  return rows[0];
}

export const apiRouter = express.Router();

// Résumé des jours remplis sur une période (calendrier).
apiRouter.get(
  '/days',
  ah(async (req, res) => {
    const from = parseDay(req.query.from);
    const to = parseDay(req.query.to);
    const { rows } = await pool.query(
      `WITH d AS (
         SELECT day FROM entries WHERE day BETWEEN $1 AND $2
           AND (title <> '' OR body <> '' OR content_text <> '' OR cardinality(moods) > 0)
         UNION SELECT day FROM tasks WHERE day BETWEEN $1 AND $2
         UNION SELECT day FROM media WHERE day BETWEEN $1 AND $2 AND deleted_at IS NULL
       )
       SELECT d.day, e.title, coalesce(e.moods, '{}') AS moods, e.weather,
         (SELECT count(*)::int FROM tasks t WHERE t.day = d.day) AS tasks,
         (SELECT count(*)::int FROM tasks t WHERE t.day = d.day AND t.done) AS done,
         (SELECT count(*)::int FROM media m WHERE m.day = d.day AND m.deleted_at IS NULL) AS media,
         (SELECT m.thumb FROM media m WHERE m.day = d.day AND m.deleted_at IS NULL AND m.kind = 'photo'
            ORDER BY m.id LIMIT 1) AS cover
       FROM d LEFT JOIN entries e ON e.day = d.day
       ORDER BY d.day`,
      [from, to]
    );
    res.json(rows);
  })
);

apiRouter.get(
  '/days/:day',
  ah(async (req, res) => {
    const day = parseDay(req.params.day);
    const [entry, tasks, media] = await Promise.all([
      pool.query(`SELECT ${ENTRY_COLS} FROM entries WHERE day = $1`, [day]),
      pool.query('SELECT id, day, text, done, position FROM tasks WHERE day = $1 ORDER BY position, id', [day]),
      pool.query(`SELECT ${MEDIA_COLS} FROM media WHERE day = $1 AND deleted_at IS NULL ORDER BY id`, [day]),
    ]);
    res.json({
      day,
      entry: entry.rows[0] || { day, title: '', body: '', moods: [], weather: null, content: null, content_text: '' },
      tasks: tasks.rows,
      media: media.rows,
    });
  })
);

apiRouter.put(
  '/days/:day',
  ah(async (req, res) => {
    const day = parseDay(req.params.day);
    const fields = ['title', 'body', 'moods', 'weather', 'content', 'content_text'].filter((f) => f in (req.body || {}));
    if (!fields.length) throw new HttpError(400, 'Rien à enregistrer');
    const values = fields.map((f) => {
      const v = req.body[f];
      if (f === 'moods') {
        if (!Array.isArray(v)) throw new HttpError(400, 'Humeurs invalides');
        return [...new Set(v.map((m) => String(m).slice(0, 32)))].slice(0, 12);
      }
      if (f === 'content') {
        if (v !== null && (typeof v !== 'object' || v.type !== 'doc')) throw new HttpError(400, 'Contenu invalide');
        return v === null ? null : JSON.stringify(v);
      }
      if (f === 'weather') return v ? String(v).slice(0, 32) : null;
      return String(v ?? '');
    });
    const cast = { moods: '::text[]', content: '::jsonb' };
    const cols = fields.join(', ');
    const params = fields.map((f, i) => `$${i + 2}${cast[f] || ''}`).join(', ');
    const updates = fields.map((f) => `${f} = EXCLUDED.${f}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO entries (day, ${cols}) VALUES ($1, ${params})
       ON CONFLICT (day) DO UPDATE SET ${updates}, updated_at = now()
       RETURNING ${ENTRY_COLS}`,
      [day, ...values]
    );
    res.json(rows[0]);
  })
);

apiRouter.post(
  '/days/:day/tasks',
  ah(async (req, res) => {
    const day = parseDay(req.params.day);
    const text = String(req.body?.text || '').trim();
    if (!text) throw new HttpError(400, 'Tâche vide');
    const { rows } = await pool.query(
      `INSERT INTO tasks (day, text, position)
       VALUES ($1, $2, (SELECT coalesce(max(position), 0) + 1 FROM tasks WHERE day = $1))
       RETURNING id, day, text, done, position`,
      [day, text]
    );
    res.status(201).json(rows[0]);
  })
);

apiRouter.patch(
  '/tasks/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const { text, done } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE tasks SET text = coalesce($2, text), done = coalesce($3, done)
       WHERE id = $1 RETURNING id, day, text, done, position`,
      [id, typeof text === 'string' && text.trim() ? text.trim() : null, typeof done === 'boolean' ? done : null]
    );
    if (!rows[0]) throw new HttpError(404, 'Introuvable');
    res.json(rows[0]);
  })
);

apiRouter.delete(
  '/tasks/:id',
  ah(async (req, res) => {
    await pool.query('DELETE FROM tasks WHERE id = $1', [parseId(req.params.id)]);
    res.status(204).end();
  })
);

// Liste paginée (plus récent d'abord). `before` = "<jour>_<id>" du dernier élément reçu.
apiRouter.get(
  '/media',
  ah(async (req, res) => {
    const kind = ['photo', 'sketch'].includes(req.query.kind) ? req.query.kind : null;
    const asked = Math.trunc(Number(req.query.limit));
    const limit = Number.isFinite(asked) && asked >= 1 ? Math.min(asked, 2000) : 500;
    let beforeDay = null;
    let beforeId = null;
    if (req.query.before) {
      const [d, id] = String(req.query.before).split('_');
      beforeDay = parseDay(d);
      beforeId = parseId(id);
    }
    const { rows } = await pool.query(
      `SELECT ${MEDIA_COLS} FROM media
       WHERE deleted_at IS NULL AND ($1::text IS NULL OR kind = $1)
         AND ($3::date IS NULL OR (day, id) < ($3::date, $4::int))
       ORDER BY day DESC, id DESC LIMIT $2`,
      [kind, limit + 1, beforeDay, beforeId]
    );
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    res.json({ items, next: rows.length > limit ? `${last.day}_${last.id}` : null });
  })
);

apiRouter.post(
  '/days/:day/media',
  upload.single('file'),
  ah(async (req, res) => {
    const day = parseDay(req.params.day);
    const kind = req.body?.kind === 'sketch' ? 'sketch' : 'photo';
    if (!req.file) throw new HttpError(400, 'Aucun fichier');
    const stored = kind === 'photo' ? await storePhoto(req.file.buffer) : await storeDrawing(req.file.buffer, true);
    const { rows } = await pool.query(
      `INSERT INTO media (day, kind, file, thumb, width, height, tilt, caption)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${MEDIA_COLS}`,
      [day, kind, stored.file, stored.thumb, stored.width, stored.height, randomTilt(), String(req.body?.caption || '')]
    );
    res.status(201).json(rows[0]);
  })
);

// Enregistre un dessin : remplace le croquis, ou le calque d'annotation d'une photo.
apiRouter.put(
  '/media/:id/drawing',
  upload.single('file'),
  ah(async (req, res) => {
    const media = await findMedia(parseId(req.params.id));
    if (!req.file) throw new HttpError(400, 'Aucun fichier');
    let rows;
    if (media.kind === 'sketch') {
      const stored = await storeDrawing(req.file.buffer, true);
      ({ rows } = await pool.query(
        `UPDATE media SET file = $2, thumb = $3, width = $4, height = $5, updated_at = now()
         WHERE id = $1 RETURNING ${MEDIA_COLS}`,
        [media.id, stored.file, stored.thumb, stored.width, stored.height]
      ));
      await removeFiles(media.file, media.thumb);
    } else {
      const stored = await storeDrawing(req.file.buffer, false);
      ({ rows } = await pool.query(
        `UPDATE media SET overlay = $2, updated_at = now() WHERE id = $1 RETURNING ${MEDIA_COLS}`,
        [media.id, stored.file]
      ));
      await removeFiles(media.overlay);
    }
    res.json(rows[0]);
  })
);

apiRouter.patch(
  '/media/:id',
  ah(async (req, res) => {
    const id = parseId(req.params.id);
    const { caption, day } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE media SET caption = coalesce($2, caption), day = coalesce($3, day), updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL RETURNING ${MEDIA_COLS}`,
      [id, typeof caption === 'string' ? caption.slice(0, 200) : null, day ? parseDay(day) : null]
    );
    if (!rows[0]) throw new HttpError(404, 'Introuvable');
    res.json(rows[0]);
  })
);

// Correcteur : relais vers LanguageTool (service local, le texte ne quitte pas la machine).
// Les mots du dictionnaire personnel ne sont jamais signalés.
apiRouter.post(
  '/spellcheck',
  ah(async (req, res) => {
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

apiRouter.post(
  '/dictionary',
  ah(async (req, res) => {
    const word = String(req.body?.word ?? '').trim().toLowerCase().slice(0, 64);
    if (!word) throw new HttpError(400, 'Mot vide');
    await pool.query('INSERT INTO dictionary (word) VALUES ($1) ON CONFLICT DO NOTHING', [word]);
    res.status(201).json({ word });
  })
);

// Suppression douce : le fichier reste sur le disque (et dans les sauvegardes).
apiRouter.delete(
  '/media/:id',
  ah(async (req, res) => {
    await pool.query('UPDATE media SET deleted_at = now() WHERE id = $1', [parseId(req.params.id)]);
    res.status(204).end();
  })
);

const FILE_RE = /^[0-9a-f-]{36}(-t)?\.(jpg|png|webp)$/;

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
