// Sauvegardes .zip du journal autonome : exactement le format du serveur (manifest.json, data.json,
// uploads/…), donc une sauvegarde du PC se reprend sur le téléphone et inversement.
import { unzip, zip } from 'fflate';
import {
  checkArchive,
  COUNT_KEYS,
  FORMAT,
  importTables,
  isPristine,
  MAX_DATA,
  MAX_IMAGE,
  MAX_MANIFEST,
  NAME_RE,
  referencedFiles,
  RestoreError,
  snapshot,
  stamp,
  UPLOAD_RE,
} from '../../../server/src/core/backup-data.js';
import { backupFiles } from './platform.js';
import { typeOf, uploads } from './store.js';

export { RestoreError };

const config = { intervalHours: 24, keepDays: 30, keepAtLeast: 5 };
const state = { running: null, last: null, lastError: null };

const zipAsync = (files) => new Promise((resolve, reject) => zip(files, (err, out) => (err ? reject(err) : resolve(out))));
const unzipAsync = (bytes, filter) =>
  new Promise((resolve, reject) => unzip(bytes, { filter }, (err, out) => (err ? reject(err) : resolve(out))));

const json = (value) => new TextEncoder().encode(JSON.stringify(value));

async function buildZip(pool) {
  // Une image changée entre la lecture de la base et celle des fichiers (calque remplacé) :
  // on recommence avec une lecture à jour, comme le serveur.
  for (let attempt = 1; ; attempt++) {
    const snap = await snapshot(pool);
    const names = (await uploads.keys()).filter((n) => UPLOAD_RE.test(`uploads/${n}`));
    const entries = {};
    for (const n of names) {
      const blob = await uploads.get(n);
      if (blob) entries[`uploads/${n}`] = [new Uint8Array(await blob.arrayBuffer()), { level: /\.(jpg|webp)$/.test(n) ? 0 : 6 }];
    }
    const missing = referencedFiles(snap.data.media).filter((f) => !entries[`uploads/${f}`]);
    if (missing.length && attempt < 3) continue;
    if (missing.length) throw new Error(`${missing.length} image(s) introuvable(s)`);
    const manifest = { format: FORMAT, version: 1, schema: snap.schema, created: new Date().toISOString(), counts: snap.counts, files: names.length };
    entries['manifest.json'] = json(manifest);
    entries['data.json'] = json(snap.data);
    return { bytes: await zipAsync(entries), manifest };
  }
}

export async function listBackups() {
  const items = (await backupFiles.list()).filter((i) => NAME_RE.test(i.name));
  return items.sort((a, b) => b.created.localeCompare(a.created) || b.name.localeCompare(a.name));
}

async function freeName() {
  const taken = new Set((await backupFiles.list()).map((i) => i.name));
  const base = `journal_${stamp()}`;
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? `${base}.zip` : `${base}-${i}.zip`;
    if (!taken.has(name)) return name;
  }
  throw new Error('Trop de sauvegardes dans la même seconde');
}

// Ne garde que les sauvegardes récentes, mais jamais moins des 5 dernières.
async function rotate() {
  const limit = Date.now() - config.keepDays * 86400e3;
  for (const it of (await listBackups()).slice(config.keepAtLeast)) {
    if (new Date(it.created).getTime() < limit) await backupFiles.remove(it.name).catch(() => {});
  }
}

export function createBackup(pool, reason = 'manuelle') {
  if (state.running) return state.running;
  state.running = (async () => {
    try {
      const name = await freeName();
      const { bytes, manifest } = await buildZip(pool);
      await backupFiles.save(name, bytes);
      state.last = { name, size: bytes.length, created: manifest.created, counts: manifest.counts, reason };
      state.lastError = null;
      await rotate();
      return state.last;
    } catch (err) {
      state.lastError = { message: err.message, at: new Date().toISOString() };
      throw err;
    }
  })().finally(() => {
    state.running = null;
  });
  return state.running;
}

export async function backupInfo() {
  return {
    dir: backupFiles.where,
    intervalHours: config.intervalHours,
    keepDays: config.keepDays,
    engine: 'telephone',
    items: await listBackups(),
    running: Boolean(state.running),
    last: state.last,
    lastError: state.lastError,
  };
}

export const shareBackup = (name) => (NAME_RE.test(name) ? backupFiles.share(name) : Promise.reject(new Error('Introuvable')));

// Sauvegarde automatique : au lancement si la dernière a plus de 24 h, puis toutes les heures on vérifie.
export function startAutoBackups(pool) {
  const tick = async () => {
    const [latest] = await listBackups().catch(() => []);
    if (!latest || Date.now() - new Date(latest.created).getTime() >= config.intervalHours * 3600e3 - 60e3) {
      await createBackup(pool, 'automatique').catch(() => {});
    }
  };
  setTimeout(tick, 30e3);
  setInterval(tick, 3600e3);
}

// ---------- Restaurer (seulement dans un journal neuf) ----------

let restoring = false;

export async function restoreBackup(pool, file) {
  if (restoring) throw new RestoreError('Une restauration est déjà en cours.');
  restoring = true;
  const copied = [];
  try {
    if (!(await isPristine(pool))) throw new RestoreError('Ce journal contient déjà des données : la restauration est réservée à un journal neuf.');
    let entries;
    try {
      entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()), (f) => {
        const max = f.name === 'manifest.json' ? MAX_MANIFEST : f.name === 'data.json' ? MAX_DATA : UPLOAD_RE.test(f.name) ? MAX_IMAGE : -1;
        if (max < 0) return false; // dossiers, fichiers inconnus : ignorés
        if (f.originalSize > max) throw new RestoreError(`Sauvegarde invalide : ${f.name} est trop gros.`);
        return true;
      });
    } catch (err) {
      if (err instanceof RestoreError) throw err;
      throw new RestoreError('Ce fichier n’est pas une sauvegarde du journal (.zip illisible).');
    }
    const text = (name) => (entries[name] ? JSON.parse(new TextDecoder().decode(entries[name])) : null);
    const manifest = text('manifest.json');
    const data = text('data.json');
    const present = new Set();
    const existing = new Set(await uploads.keys());
    for (const [path, bytes] of Object.entries(entries)) {
      const m = UPLOAD_RE.exec(path);
      if (!m) continue;
      present.add(m[1]);
      if (existing.has(m[1])) continue;
      await uploads.put(m[1], bytes, typeOf(m[1]));
      copied.push(m[1]);
    }
    checkArchive(manifest, data, present);
    if (!COUNT_KEYS.every((k) => Number.isInteger(manifest.counts?.[k]))) throw new RestoreError('Sauvegarde invalide : comptages absents.');
    await importTables(pool, data, manifest.counts);
    return manifest;
  } catch (err) {
    await uploads.remove(...copied).catch(() => {});
    if (err instanceof RestoreError) throw err;
    throw new RestoreError(`Restauration impossible : ${err.message}`);
  } finally {
    restoring = false;
  }
}
