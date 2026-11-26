// Le cœur du journal : toutes les opérations sur les journées, tâches, images et la corbeille.
// Partagé par le serveur (Express) et l'application Android (dans le navigateur) : même SQL,
// mêmes règles, mêmes réponses. Aucune dépendance à Node ni au navigateur ; ce qui diffère est
// injecté :
//   pool    interface pg.Pool (query, connect/release) — PostgreSQL ou PGlite
//   files   { write(name, bytes), remove(...names) } — où vivent les images
//   images  { photo(bytes), drawing(bytes, withThumb) } — décodage, rotation, réduction, vignettes
// Chaque route renvoie { status, body } (body absent pour 204).

export const MAX_SIDE = 2400;
export const THUMB_SIDE = 640;
export const COVERS = ['nuit', 'aube', 'foret', 'tempete', 'phare'];
export const FILE_RE = /^[0-9a-f-]{36}(-t)?\.(jpg|png|webp)$/;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEDIA_COLS = 'id, day, kind, file, thumb, overlay, caption, width, height, tilt, created_at';
const ENTRY_COLS = 'day, title, body, moods, weather, content, content_text, updated_at';

export class HttpError extends Error {
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

// Texte d'une tâche : une seule phrase (les retours à la ligne deviennent des espaces), 1000 caractères max.
const TASK_MAX = 1000;
const oneLine = (value) => String(value ?? '').replace(/\s*\n\s*/g, ' ').trim().slice(0, TASK_MAX);

const randomTilt = () => Math.round((Math.random() * 8 - 4) * 10) / 10;

// Vider la corbeille : identifiants envoyés par l'interface (ce qui a été vu au moment de confirmer).
const parseIds = (value) => {
  if (!Array.isArray(value) || value.length > 10000) throw new HttpError(400, 'Liste invalide');
  return value.map(parseId);
};

// Texte brut d'un document du carnet (même forme que getText côté éditeur : un bloc par ligne).
export function docText(node) {
  if (node.type === 'text') return node.text || '';
  const inner = (node.content || []).map(docText);
  return ['doc', 'bulletList', 'orderedList', 'listItem'].includes(node.type) ? inner.join('\n') : inner.join('');
}

// Ancien texte brut (avant l'éditeur) -> document : un paragraphe par ligne.
const legacyDoc = (body) => ({
  type: 'doc',
  content: String(body || '').split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
});

// Verrou du déplacement de journée. Toute écriture qui peut remplir une journée (texte, tâche,
// image, corbeille) le prend en partagé : les écritures ne se bloquent pas entre elles, mais un
// déplacement (verrou exclusif) attend qu'elles finissent et les fait attendre à son tour. Ainsi la
// vérification « le jour d'arrivée est vide » reste vraie jusqu'à la fin du déplacement.
const MOVE_LOCK = "hashtext('journal:move-day')";

// Une transaction : BEGIN … COMMIT, ROLLBACK en cas d'erreur.
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function readSettings(pool) {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    ownerName: s.owner_name || '',
    title: s.title || '',
    cover: COVERS.includes(s.cover) ? s.cover : 'nuit',
    setupDone: s.setup_done === true,
  };
}

// Une journée « vide » : rien d'écrit (titre, texte, humeurs), aucune tâche, aucune image visible.
// La météo seule ou un carnet vierge ne comptent pas.
async function dayIsEmpty(client, day) {
  const { rows } = await client.query(
    `SELECT NOT EXISTS (SELECT 1 FROM entries WHERE day = $1
                          AND (title <> '' OR body <> '' OR content_text ~ '\\S' OR cardinality(moods) > 0))
        AND NOT EXISTS (SELECT 1 FROM tasks WHERE day = $1)
        AND NOT EXISTS (SELECT 1 FROM media WHERE day = $1 AND deleted_at IS NULL) AS empty`,
    [day]
  );
  return rows[0].empty;
}

export function createJournal({ pool, files, images }) {
  const routes = [];
  const route = (method, pattern, fn) =>
    routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });
  const ok = (body, status = 200) => ({ status, body });
  const noContent = () => ({ status: 204 });

  const newId = () => globalThis.crypto.randomUUID();

  const dayWrite = (fn) =>
    transaction(pool, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock_shared(${MOVE_LOCK})`);
      return fn(client);
    });

  async function findMedia(id) {
    const { rows } = await pool.query(`SELECT ${MEDIA_COLS} FROM media WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!rows[0]) throw new HttpError(404, 'Introuvable');
    return rows[0];
  }

  // Photo : orientation EXIF appliquée, redimensionnée, JPEG + vignette WebP.
  async function storePhoto(bytes) {
    const id = newId();
    const img = await images.photo(bytes);
    await files.write(`${id}.jpg`, img.main);
    await files.write(`${id}-t.webp`, img.thumb);
    return { file: `${id}.jpg`, thumb: `${id}-t.webp`, width: img.width, height: img.height };
  }

  // Dessin (croquis ou calque d'annotation) : PNG transparent.
  async function storeDrawing(bytes, withThumb) {
    const id = newId();
    const img = await images.drawing(bytes, withThumb);
    await files.write(`${id}.png`, img.main);
    const result = { file: `${id}.png`, width: img.width, height: img.height };
    if (withThumb) {
      await files.write(`${id}-t.webp`, img.thumb);
      result.thumb = `${id}-t.webp`;
    }
    return result;
  }

  async function purgeMedia(where, params) {
    const { rows } = await pool.query(`DELETE FROM media WHERE deleted_at IS NOT NULL AND ${where} RETURNING file, thumb, overlay`, params);
    for (const m of rows) await files.remove(m.file, m.thumb, m.overlay);
    return rows.length;
  }

  // ---- Personnalisation ----

  route('GET', '/settings', async () => ok(await readSettings(pool)));

  // Enregistre le prénom, le titre et la couverture ; marque la première configuration comme faite.
  route('PUT', '/settings', async ({ body }) => {
    const ownerName = String(body.ownerName ?? '').trim().slice(0, 40);
    const title = String(body.title ?? '').trim().slice(0, 60);
    if (!ownerName) throw new HttpError(400, 'Le prénom est obligatoire');
    if (!title) throw new HttpError(400, 'Le titre est obligatoire');
    if (!COVERS.includes(body.cover)) throw new HttpError(400, 'Couverture inconnue');
    const values = { owner_name: ownerName, title, cover: body.cover, setup_done: true };
    await transaction(pool, async (client) => {
      for (const [key, value] of Object.entries(values)) {
        await client.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, JSON.stringify(value)]
        );
      }
    });
    return ok(await readSettings(pool));
  });

  // ---- Journées ----

  // Résumé des jours remplis sur une période (calendrier).
  route('GET', '/days', async ({ query }) => {
    const from = parseDay(query.from);
    const to = parseDay(query.to);
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
    return ok(rows);
  });

  route('GET', '/days/:day', async ({ params }) => {
    const day = parseDay(params.day);
    const [entry, tasks, media] = await Promise.all([
      pool.query(`SELECT ${ENTRY_COLS} FROM entries WHERE day = $1`, [day]),
      pool.query('SELECT id, day, text, done, position FROM tasks WHERE day = $1 ORDER BY position, id', [day]),
      pool.query(`SELECT ${MEDIA_COLS} FROM media WHERE day = $1 AND deleted_at IS NULL ORDER BY id`, [day]),
    ]);
    return ok({
      day,
      entry: entry.rows[0] || { day, title: '', body: '', moods: [], weather: null, content: null, content_text: '' },
      tasks: tasks.rows,
      media: media.rows,
    });
  });

  route('PUT', '/days/:day', async ({ params, body }) => {
    const day = parseDay(params.day);
    const fields = ['title', 'body', 'moods', 'weather', 'content', 'content_text'].filter((f) => f in body);
    if (!fields.length) throw new HttpError(400, 'Rien à enregistrer');
    const values = fields.map((f) => {
      const v = body[f];
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
    const placeholders = fields.map((f, i) => `$${i + 2}${cast[f] || ''}`).join(', ');
    const updates = fields.map((f) => `${f} = EXCLUDED.${f}`).join(', ');
    const { rows } = await dayWrite((c) =>
      c.query(
        `INSERT INTO entries (day, ${cols}) VALUES ($1, ${placeholders})
         ON CONFLICT (day) DO UPDATE SET ${updates}, updated_at = now()
         RETURNING ${ENTRY_COLS}`,
        [day, ...values]
      )
    );
    return ok(rows[0]);
  });

  route('GET', '/days/:day/empty', async ({ params }) => ok({ empty: await dayIsEmpty(pool, parseDay(params.day)) }));

  // Déplacer une journée écrite au mauvais jour vers une journée vide : tout part ensemble
  // (texte, humeurs, météo, tâches, images, et ce qui en est à la corbeille). Rien n'est effacé.
  route('POST', '/days/:day/move', async ({ params, body }) => {
    const from = parseDay(params.day);
    const to = parseDay(body.to);
    if (from === to) throw new HttpError(400, 'C’est déjà ce jour-là');
    return transaction(pool, async (client) => {
      // Exclusif : ni autre déplacement ni écriture sur une journée pendant ce temps (voir dayWrite).
      await client.query(`SELECT pg_advisory_xact_lock(${MOVE_LOCK})`);
      if (await dayIsEmpty(client, from)) throw new HttpError(400, 'Cette journée est vide : rien à déplacer');
      if (!(await dayIsEmpty(client, to))) throw new HttpError(409, 'Ce jour-là a déjà des choses écrites : je ne mélange pas deux journées');
      // La journée d'arrivée n'a au plus qu'une ligne vide (météo, carnet vierge) : elle laisse la place.
      // Les conditions sont répétées : jamais une ligne écrite n'est effacée ici.
      await client.query(
        `DELETE FROM entries WHERE day = $1
           AND title = '' AND body = '' AND content_text !~ '\\S' AND cardinality(moods) = 0`,
        [to]
      );
      await client.query('UPDATE entries SET day = $2, updated_at = now() WHERE day = $1', [from, to]);
      const tasks = await client.query('UPDATE tasks SET day = $2 WHERE day = $1', [from, to]);
      const media = await client.query('UPDATE media SET day = $2, updated_at = now() WHERE day = $1', [from, to]);
      await client.query('UPDATE trash SET day = $2 WHERE day = $1', [from, to]);
      return ok({ day: to, tasks: tasks.rowCount, media: media.rowCount });
    });
  });

  // ---- Tâches ----

  route('POST', '/days/:day/tasks', async ({ params, body }) => {
    const day = parseDay(params.day);
    const text = oneLine(body.text);
    if (!text) throw new HttpError(400, 'Tâche vide');
    const { rows } = await dayWrite((c) =>
      c.query(
        `INSERT INTO tasks (day, text, position)
         VALUES ($1, $2, (SELECT coalesce(max(position), 0) + 1 FROM tasks WHERE day = $1))
         RETURNING id, day, text, done, position`,
        [day, text]
      )
    );
    return ok(rows[0], 201);
  });

  route('PATCH', '/tasks/:id', async ({ params, body }) => {
    const id = parseId(params.id);
    const { text, done } = body;
    const { rows } = await pool.query(
      `UPDATE tasks SET text = coalesce($2, text), done = coalesce($3, done)
       WHERE id = $1 RETURNING id, day, text, done, position`,
      [id, typeof text === 'string' && oneLine(text) ? oneLine(text) : null, typeof done === 'boolean' ? done : null]
    );
    if (!rows[0]) throw new HttpError(404, 'Introuvable');
    return ok(rows[0]);
  });

  route('DELETE', '/tasks/:id', async ({ params }) => {
    await pool.query('DELETE FROM tasks WHERE id = $1', [parseId(params.id)]);
    return noContent();
  });

  // ---- Images ----

  // Liste paginée (plus récent d'abord). `before` = "<jour>_<id>" du dernier élément reçu.
  route('GET', '/media', async ({ query }) => {
    const kind = ['photo', 'sketch'].includes(query.kind) ? query.kind : null;
    const asked = Math.trunc(Number(query.limit));
    const limit = Number.isFinite(asked) && asked >= 1 ? Math.min(asked, 2000) : 500;
    let beforeDay = null;
    let beforeId = null;
    if (query.before) {
      const [d, id] = String(query.before).split('_');
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
    return ok({ items, next: rows.length > limit ? `${last.day}_${last.id}` : null });
  });

  route('POST', '/days/:day/media', async ({ params, body, file }) => {
    const day = parseDay(params.day);
    const kind = body.kind === 'sketch' ? 'sketch' : 'photo';
    if (!file) throw new HttpError(400, 'Aucun fichier');
    const stored = kind === 'photo' ? await storePhoto(file) : await storeDrawing(file, true);
    const { rows } = await dayWrite((c) =>
      c.query(
        `INSERT INTO media (day, kind, file, thumb, width, height, tilt, caption)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${MEDIA_COLS}`,
        [day, kind, stored.file, stored.thumb, stored.width, stored.height, randomTilt(), String(body.caption || '')]
      )
    );
    return ok(rows[0], 201);
  });

  // Enregistre un dessin : remplace le croquis, ou le calque d'annotation d'une photo.
  route('PUT', '/media/:id/drawing', async ({ params, file }) => {
    const media = await findMedia(parseId(params.id));
    if (!file) throw new HttpError(400, 'Aucun fichier');
    let rows;
    if (media.kind === 'sketch') {
      const stored = await storeDrawing(file, true);
      ({ rows } = await pool.query(
        `UPDATE media SET file = $2, thumb = $3, width = $4, height = $5, updated_at = now()
         WHERE id = $1 RETURNING ${MEDIA_COLS}`,
        [media.id, stored.file, stored.thumb, stored.width, stored.height]
      ));
      await files.remove(media.file, media.thumb);
    } else {
      const stored = await storeDrawing(file, false);
      ({ rows } = await pool.query(`UPDATE media SET overlay = $2, updated_at = now() WHERE id = $1 RETURNING ${MEDIA_COLS}`, [
        media.id,
        stored.file,
      ]));
      await files.remove(media.overlay);
    }
    return ok(rows[0]);
  });

  route('PATCH', '/media/:id', async ({ params, body }) => {
    const id = parseId(params.id);
    const { caption, day } = body;
    const { rows } = await dayWrite((c) =>
      c.query(
        `UPDATE media SET caption = coalesce($2, caption), day = coalesce($3, day), updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL RETURNING ${MEDIA_COLS}`,
        [id, typeof caption === 'string' ? caption.slice(0, 200) : null, day ? parseDay(day) : null]
      )
    );
    if (!rows[0]) throw new HttpError(404, 'Introuvable');
    return ok(rows[0]);
  });

  // Suppression douce : le fichier reste (et dans les sauvegardes).
  route('DELETE', '/media/:id', async ({ params }) => {
    await pool.query('UPDATE media SET deleted_at = now() WHERE id = $1', [parseId(params.id)]);
    return noContent();
  });

  route('POST', '/media/:id/restore', async ({ params }) => {
    const { rows } = await dayWrite((c) =>
      c.query(`UPDATE media SET deleted_at = NULL, updated_at = now() WHERE id = $1 AND deleted_at IS NOT NULL RETURNING ${MEDIA_COLS}`, [
        parseId(params.id),
      ])
    );
    if (!rows[0]) throw new HttpError(404, 'Déjà remise ou introuvable');
    return ok(rows[0]);
  });

  route('DELETE', '/media/:id/forever', async ({ params }) => {
    if (!(await purgeMedia('id = $1', [parseId(params.id)]))) throw new HttpError(404, 'Introuvable');
    return noContent();
  });

  // ---- Dictionnaire personnel (mots jamais signalés par le correcteur) ----

  route('POST', '/dictionary', async ({ body }) => {
    const word = String(body.word ?? '').trim().toLowerCase().slice(0, 64);
    if (!word) throw new HttpError(400, 'Mot vide');
    await pool.query('INSERT INTO dictionary (word) VALUES ($1) ON CONFLICT DO NOTHING', [word]);
    return ok({ word }, 201);
  });

  // ---- Corbeille (jamais vidée automatiquement) ----

  // Une page arrachée : le client envoie les blocs retirés AVANT de les effacer de la journée.
  route('POST', '/days/:day/trash', async ({ params, body }) => {
    const day = parseDay(params.day);
    const { blocks, blockIndex } = body;
    if (!Array.isArray(blocks) || !blocks.length || blocks.some((b) => !b || typeof b.type !== 'string')) {
      throw new HttpError(400, 'Page invalide');
    }
    const preview = docText({ type: 'doc', content: blocks }).replace(/\s+/g, ' ').trim().slice(0, 280);
    const index = Number.isInteger(blockIndex) && blockIndex >= 0 ? blockIndex : 0;
    const { rows } = await dayWrite((c) =>
      c.query(
        `INSERT INTO trash (day, content, preview, block_index) VALUES ($1, $2::jsonb, $3, $4)
         RETURNING id, day, preview, created_at`,
        [day, JSON.stringify(blocks), preview, index]
      )
    );
    return ok(rows[0], 201);
  });

  route('GET', '/trash', async () => {
    const [pages, media] = await Promise.all([
      pool.query(`SELECT id, day, preview, created_at FROM trash WHERE restored_at IS NULL ORDER BY created_at DESC, id DESC`),
      pool.query(`SELECT ${MEDIA_COLS}, deleted_at FROM media WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC`),
    ]);
    return ok({ pages: pages.rows, media: media.rows });
  });

  // Recoller une page à sa place d'origine, sur une page à elle (sauts de page autour).
  route('POST', '/trash/:id/restore', async ({ params }) => {
    const id = parseId(params.id);
    return transaction(pool, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock_shared(${MOVE_LOCK})`);
      const { rows } = await client.query('SELECT * FROM trash WHERE id = $1 AND restored_at IS NULL FOR UPDATE', [id]);
      const item = rows[0];
      if (!item) throw new HttpError(404, 'Déjà recollée ou introuvable');
      const entry = (await client.query('SELECT content, body FROM entries WHERE day = $1 FOR UPDATE', [item.day])).rows[0];
      const doc = entry?.content || legacyDoc(entry?.body);
      const blocks = [...(doc.content || [])];
      // Une journée vide = un seul paragraphe vide : on le remplace.
      if (blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].content?.length) blocks.length = 0;
      const at = Math.min(item.block_index, blocks.length);
      const isBreak = (b) => b?.type === 'pageBreak';
      const piece = [...item.content];
      if (at > 0 && !isBreak(blocks[at - 1]) && !isBreak(piece[0])) piece.unshift({ type: 'pageBreak' });
      if (at < blocks.length && !isBreak(blocks[at]) && !isBreak(piece[piece.length - 1])) piece.push({ type: 'pageBreak' });
      blocks.splice(at, 0, ...piece);
      const content = { ...doc, type: 'doc', content: blocks };
      await client.query(
        `INSERT INTO entries (day, content, content_text) VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (day) DO UPDATE SET content = EXCLUDED.content, content_text = EXCLUDED.content_text, updated_at = now()`,
        [item.day, JSON.stringify(content), docText(content)]
      );
      await client.query('UPDATE trash SET restored_at = now() WHERE id = $1', [id]);
      return ok({ day: item.day });
    });
  });

  // Effacer pour toujours (seulement depuis la corbeille, sur demande explicite).
  route('DELETE', '/trash/:id', async ({ params }) => {
    const { rowCount } = await pool.query('DELETE FROM trash WHERE id = $1 AND restored_at IS NULL', [parseId(params.id)]);
    if (!rowCount) throw new HttpError(404, 'Introuvable');
    return noContent();
  });

  // Vider la corbeille : seulement les éléments affichés quand on a confirmé.
  route('POST', '/trash/empty', async ({ body }) => {
    const pageIds = parseIds(body.pageIds);
    const mediaIds = parseIds(body.mediaIds);
    const { rowCount } = await pool.query('DELETE FROM trash WHERE restored_at IS NULL AND id = ANY($1::int[])', [pageIds]);
    const media = await purgeMedia('id = ANY($1::int[])', [mediaIds]);
    return ok({ pages: rowCount, media });
  });

  return {
    // Traite une requête « /chemin » (sans le préfixe /api). Lève HttpError(404) si aucune route.
    async handle(method, path, { query = {}, body = {}, file = null } = {}) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(path);
        if (!m) continue;
        const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
        return r.fn({ params, query, body: body || {}, file });
      }
      throw new HttpError(404, 'Introuvable');
    },
  };
}
