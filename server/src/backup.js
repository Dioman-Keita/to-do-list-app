import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { DATA_DIR, pool } from './db.js';
import * as core from './core/backup-data.js';
import { checkArchive, FORMAT, MAX_DATA, MAX_IMAGE, MAX_MANIFEST, NAME_RE, referencedFiles, RestoreError, stamp, UPLOAD_RE } from './core/backup-data.js';

export { FORMAT, RestoreError };
export const counts = (client = pool) => core.counts(client);
export const isPristine = (client = pool) => core.isPristine(client);
const snapshot = () => core.snapshot(pool);
const importTables = (data, expected) => core.importTables(pool, data, expected);

// Sauvegarde = un seul fichier « journal_AAAA-MM-JJ_HHMMSS.zip » :
//   manifest.json  format, version du schéma, date, comptages (pour vérifier une restauration)
//   data.json      toutes les tables, ligne par ligne (le mot de passe n'y est qu'en empreinte)
//   uploads/…      toutes les photos, croquis et calques
// Indépendant du moteur (PGlite ou PostgreSQL) : on peut passer de l'un à l'autre avec.

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



// ---------- Créer ----------



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
    checkArchive(manifest, data, present);
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



