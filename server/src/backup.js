import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { DATA_DIR, MIGRATION_COUNT, pool } from './db.js';

// Sauvegarde = un seul fichier « journal_AAAA-MM-JJ_HHMMSS.zip » :
//   manifest.json  format, version du schéma, date, comptages (pour vérifier une restauration)
//   data.json      toutes les tables, ligne par ligne (le mot de passe n'y est qu'en empreinte)
//   uploads/…      toutes les photos, croquis et calques
// Indépendant du moteur (PGlite ou PostgreSQL) : on peut passer de l'un à l'autre avec.

export const FORMAT = 'journal-sauvegarde';
const TABLES = ['settings', 'entries', 'tasks', 'media', 'dictionary', 'trash'];
// « -2 », « -3 »… si deux sauvegardes tombent dans la même seconde.
const NAME_RE = /^journal_\d{4}-\d{2}-\d{2}_\d{6}(-\d{1,3})?\.zip$/;
const UPLOAD_RE = /^uploads\/([0-9a-f-]{36}(-t)?\.(jpg|png|webp))$/;
const COUNT_KEYS = ['journees', 'taches', 'medias', 'caracteres', 'corbeille'];
// Tailles maximales à la lecture d'une sauvegarde (une archive piégée ne doit pas remplir la mémoire).
const MAX_MANIFEST = 1024 ** 2;
const MAX_DATA = 1024 ** 3;
const MAX_IMAGE = 512 * 1024 ** 2;

const config = {
  dir: path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups')),
  uploads: null, // fixé par routes.js (UPLOAD_DIR)
  intervalHours: Number(process.env.BACKUP_INTERVAL_HOURS) || 24,
  keepDays: Number(process.env.BACKUP_KEEP_DAYS) || 30,
  keepAtLeast: 5,
};
const state = { running: null, last: null, lastError: null, timer: null };

export const backupConfig = () => ({ ...config });
export const isBackupName = (name) => NAME_RE.test(name);

// L'application de bureau change le dossier (OneDrive…) sans redémarrer le serveur.
export function setBackupDir(dir) {
  config.dir = path.resolve(dir);
}

export function initBackups(uploadDir) {
  config.uploads = uploadDir;
}

// ---------- Comptages (vérifier qu'une sauvegarde ou une restauration n'a rien perdu) ----------

export async function counts(client = pool) {
  const { rows } = await client.query(
    `SELECT (SELECT count(*)::int FROM entries) AS journees,
            (SELECT count(*)::int FROM tasks) AS taches,
            (SELECT count(*)::int FROM media) AS medias,
            (SELECT coalesce(sum(length(content_text)), 0)::int FROM entries) AS caracteres,
            (SELECT count(*)::int FROM trash) AS corbeille`
  );
  return rows[0];
}

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// ---------- Créer ----------

async function snapshot() {
  const client = await pool.connect();
  try {
    // Lecture cohérente : toutes les tables au même instant.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const data = {};
    for (const t of TABLES) data[t] = (await client.query(`SELECT * FROM ${t} ORDER BY 1`)).rows;
    const c = await counts(client);
    const schema = (await client.query('SELECT coalesce(max(version), 0)::int AS v FROM schema_migrations')).rows[0].v;
    await client.query('COMMIT');
    return { data, counts: c, schema };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Fichiers d'images cités par les médias (photo, vignette, calque) : ils doivent tous être dans l'archive.
const referencedFiles = (media = []) => media.flatMap((m) => [m.file, m.thumb, m.overlay]).filter(Boolean);

class FilesChanged extends Error {}

async function writeZip(target, { data, counts: c, schema }) {
  const files = (await fsp.readdir(config.uploads).catch(() => [])).filter((f) => UPLOAD_RE.test(`uploads/${f}`));
  const wanted = new Set(referencedFiles(data.media));
  const missing = [...wanted].filter((f) => !files.includes(f));
  if (missing.length) throw new FilesChanged(`${missing.length} image(s) introuvable(s)`);
  const manifest = { format: FORMAT, version: 1, schema, created: new Date().toISOString(), counts: c, files: files.length };
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'manifest.json');
  zip.addBuffer(Buffer.from(JSON.stringify(data)), 'data.json');
  for (const f of files) zip.addFile(path.join(config.uploads, f), `uploads/${f}`, { compress: !/\.(jpg|webp)$/.test(f) });
  zip.end();
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(target);
    // Image disparue pendant l'écriture (calque remplacé, image effacée de la corbeille) : on recommence.
    const fail = (err) => {
      zip.outputStream.unpipe(out);
      out.destroy();
      out.once('close', () => reject(err?.code === 'ENOENT' ? new FilesChanged(err.message) : err));
    };
    zip.on('error', fail);
    zip.outputStream.on('error', fail).pipe(out).on('error', reject).on('close', resolve);
  });
  return manifest;
}

// Nom libre : jamais celui d'une sauvegarde existante.
function freeName() {
  const base = `journal_${stamp()}`;
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? `${base}.zip` : `${base}-${i}.zip`;
    if (!fs.existsSync(path.join(config.dir, name))) return name;
  }
  throw new Error('Trop de sauvegardes dans la même seconde');
}

export function createBackup(reason = 'manuelle') {
  // Une seule à la fois : une deuxième demande attend la première et la renvoie.
  if (state.running) return state.running;
  state.running = (async () => {
    await fsp.mkdir(config.dir, { recursive: true });
    const name = freeName();
    const target = path.join(config.dir, name);
    const part = `${target}.part`;
    try {
      // Une image modifiée pendant la sauvegarde : on recommence avec une photo à jour de la base.
      let manifest;
      for (let attempt = 1; !manifest; attempt++) {
        try {
          manifest = await writeZip(part, await snapshot());
        } catch (err) {
          if (!(err instanceof FilesChanged) || attempt >= 3) throw err;
        }
      }
      await fsp.rename(part, target);
      const { size } = await fsp.stat(target);
      state.last = { name, size, created: manifest.created, counts: manifest.counts, reason };
      state.lastError = null;
      console.log(`Sauvegarde ${reason} : ${name} (${(size / 1e6).toFixed(1)} Mo)`);
      await rotate();
      return state.last;
    } catch (err) {
      await fsp.rm(part, { force: true });
      state.lastError = { message: err.message, at: new Date().toISOString() };
      console.error(`Échec de la sauvegarde ${reason} : ${err.message}`);
      throw err;
    }
  })().finally(() => {
    state.running = null;
  });
  return state.running;
}

// Ne garde que les sauvegardes récentes, mais jamais moins des `keepAtLeast` dernières.
async function rotate() {
  const items = await listBackups();
  const limit = Date.now() - config.keepDays * 86400e3;
  for (const it of items.slice(config.keepAtLeast)) {
    if (new Date(it.created).getTime() < limit) await fsp.rm(path.join(config.dir, it.name), { force: true });
  }
}

export async function listBackups() {
  const names = (await fsp.readdir(config.dir).catch(() => [])).filter(isBackupName);
  const items = await Promise.all(
    names.map(async (name) => {
      const st = await fsp.stat(path.join(config.dir, name));
      return { name, size: st.size, created: st.mtime.toISOString() };
    })
  );
  return items.sort((a, b) => b.created.localeCompare(a.created));
}

export const backupPath = (name) => (isBackupName(name) ? path.join(config.dir, name) : null);

export function backupStatus() {
  return { running: Boolean(state.running), last: state.last, lastError: state.lastError };
}

// Sauvegarde automatique : au démarrage si la dernière est trop vieille, puis à intervalle régulier.
export async function startAutoBackups() {
  if (config.intervalHours <= 0) return;
  const every = config.intervalHours * 3600e3;
  const tick = async () => {
    const [latest] = await listBackups();
    if (!latest || Date.now() - new Date(latest.created).getTime() >= every - 60e3) {
      await createBackup('automatique').catch(() => {});
    }
  };
  setTimeout(tick, 30e3).unref();
  state.timer = setInterval(tick, Math.min(every, 3600e3)).unref();
}

// ---------- Restaurer (seulement dans un journal neuf) ----------

function openZip(file) {
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip)))
  );
}

function readEntries(zip, onEntry) {
  return new Promise((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', (entry) => {
      Promise.resolve(onEntry(entry))
        .then(() => zip.readEntry())
        .catch(reject);
    });
    zip.readEntry();
  });
}

function entryStream(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (err, s) => (err ? reject(err) : resolve(s))));
}

async function entryBuffer(zip, entry, max) {
  // yauzl vérifie que la taille annoncée est la vraie : refuser d'après elle suffit.
  if (entry.uncompressedSize > max) throw new RestoreError(`Sauvegarde invalide : ${entry.fileName} est trop gros.`);
  const chunks = [];
  for await (const c of await entryStream(zip, entry)) chunks.push(c);
  return Buffer.concat(chunks);
}

export class RestoreError extends Error {}

// Lit et vérifie le fichier, copie les images, puis importe toutes les tables dans UNE transaction
// et compare les comptages avec ceux de la sauvegarde. En cas de problème, rien n'est gardé.
// Une seule restauration à la fois (les images sont copiées avant l'import des tables).
let restoring = false;

export async function restoreBackup(file) {
  if (restoring) throw new RestoreError('Une restauration est déjà en cours.');
  restoring = true;
  try {
    return await restoreOnce(file);
  } finally {
    restoring = false;
  }
}

async function restoreOnce(file) {
  if (!(await isPristine())) throw new RestoreError('Ce journal contient déjà des données : la restauration est réservée à un journal neuf.');
  let zip;
  try {
    zip = await openZip(file);
  } catch {
    throw new RestoreError('Ce fichier n’est pas une sauvegarde du journal (.zip illisible).');
  }
  let manifest = null;
  let data = null;
  const copied = [];
  const present = new Set(); // images disponibles après la copie
  try {
    await fsp.mkdir(config.uploads, { recursive: true });
    await readEntries(zip, async (entry) => {
      if (entry.fileName === 'manifest.json') manifest = JSON.parse(await entryBuffer(zip, entry, MAX_MANIFEST));
      else if (entry.fileName === 'data.json') data = JSON.parse(await entryBuffer(zip, entry, MAX_DATA));
      else {
        const m = UPLOAD_RE.exec(entry.fileName);
        if (!m) return; // dossiers, fichiers inconnus : ignorés (jamais écrits hors du dossier des images)
        if (entry.uncompressedSize > MAX_IMAGE) throw new RestoreError(`Sauvegarde invalide : ${m[1]} est trop gros.`);
        const target = path.join(config.uploads, m[1]);
        present.add(m[1]);
        if (fs.existsSync(target)) return;
        const part = `${target}.part`;
        await pipeline(await entryStream(zip, entry), fs.createWriteStream(part));
        await fsp.rename(part, target);
        copied.push(target);
      }
    });
    if (manifest?.format !== FORMAT || !data) throw new RestoreError('Ce fichier n’est pas une sauvegarde du journal.');
    if (manifest.schema > MIGRATION_COUNT) {
      throw new RestoreError('Cette sauvegarde vient d’une version plus récente du journal : mets d’abord le journal à jour.');
    }
    const missing = referencedFiles(data.media).filter((f) => !present.has(f));
    if (missing.length) throw new RestoreError(`Sauvegarde incomplète : ${missing.length} image(s) manquante(s). Rien n’a été importé.`);
    await importTables(data, manifest.counts);
    return manifest;
  } catch (err) {
    await Promise.all(copied.map((f) => fsp.rm(f, { force: true })));
    if (err instanceof RestoreError) throw err;
    throw new RestoreError(`Restauration impossible : ${err.message}`);
  } finally {
    zip?.close();
  }
}

async function importTables(data, expected) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (!(await isPristine(client))) throw new RestoreError('Ce journal contient déjà des données : la restauration est réservée à un journal neuf.');
    await client.query('DELETE FROM settings'); // secret de session tout neuf : remplacé par celui de la sauvegarde
    for (const t of TABLES) {
      const rows = data[t] || [];
      if (!rows.length) continue;
      const { rows: colRows } = await client.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
        [t]
      );
      const known = new Set(colRows.map((r) => r.column_name));
      // Colonnes présentes dans la sauvegarde : une sauvegarde plus ancienne laisse les nouvelles à leur valeur par défaut.
      const cols = [...new Set(rows.flatMap(Object.keys))].filter((c) => known.has(c)).map((c) => `"${c}"`).join(', ');
      for (let i = 0; i < rows.length; i += 500) {
        await client.query(`INSERT INTO ${t} (${cols}) SELECT ${cols} FROM json_populate_recordset(NULL::${t}, $1::json)`, [
          JSON.stringify(rows.slice(i, i + 500)),
        ]);
      }
      if (known.has('id')) {
        await client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), coalesce(max(id), 1), max(id) IS NOT NULL) FROM ${t}`);
      }
    }
    const got = await counts(client);
    if (!COUNT_KEYS.every((k) => Number.isInteger(expected?.[k]))) throw new RestoreError('Sauvegarde invalide : comptages absents.');
    const diff = COUNT_KEYS.filter((k) => expected[k] !== got[k]);
    if (diff.length) throw new RestoreError(`Les comptages ne correspondent pas (${diff.join(', ')}) : rien n’a été importé.`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Journal neuf : aucun mot de passe et aucune donnée.
export async function isPristine(client = pool) {
  const { rows } = await client.query(
    `SELECT NOT EXISTS (SELECT 1 FROM settings WHERE key = 'password_hash')
        AND NOT EXISTS (SELECT 1 FROM entries) AND NOT EXISTS (SELECT 1 FROM tasks)
        AND NOT EXISTS (SELECT 1 FROM media) AND NOT EXISTS (SELECT 1 FROM trash)
        AND NOT EXISTS (SELECT 1 FROM dictionary) AS pristine`
  );
  return rows[0].pristine;
}
