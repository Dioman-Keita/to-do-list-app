// Le journal autonome (application Android) : le « serveur » tourne dans la page.
// Même base (PGlite = PostgreSQL), mêmes migrations et même cœur que le serveur du PC
// (server/src/core) ; api.js lui envoie les requêtes au lieu de faire des fetch.
import { PGlite } from '@electric-sql/pglite';
import { createJournal, HttpError, readSettings, transaction } from '../../../server/src/core/journal.js';
import { applyMigrations } from '../../../server/src/core/migrations.js';
import { PGLITE_PARSERS, pglitePool } from '../../../server/src/core/pglite-pool.js';
import { isPristine } from '../../../server/src/core/backup-data.js';
import { checkNewPassword, clearFailures, hashPassword, recordFailure, tooManyAttempts, verifyPassword } from './auth.js';
import { backupInfo, createBackup, RestoreError, restoreBackup, shareBackup, startAutoBackups } from './backup.js';
import { images } from './images.js';
import { files } from './store.js';

let ready = null;
let pool = null;
let journal = null;
let unlocked = false;

// Démarre une seule fois : base dans IndexedDB, migrations, sauvegardes automatiques.
export function boot() {
  ready ??= (async () => {
    // Demande au navigateur de ne jamais vider ce stockage pour faire de la place.
    await navigator.storage?.persist?.().catch(() => {});
    const db = new PGlite('idb://journal', { parsers: PGLITE_PARSERS, relaxedDurability: false });
    await db.waitReady;
    pool = pglitePool(db);
    await applyMigrations(pool, () => {});
    journal = createJournal({ pool, files, images });
    await registerMediaWorker();
    startAutoBackups(pool);
  })();
  return ready;
}

// Les images (<img src="/media/…">) sont servies depuis IndexedDB par un service worker.
async function registerMediaWorker() {
  if (!('serviceWorker' in navigator)) throw new Error('Service worker indisponible');
  await navigator.serviceWorker.register('/media-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  // Premier lancement : la page n'est pas encore contrôlée. On attend que le worker la prenne.
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      setTimeout(resolve, 3000);
    });
    if (!navigator.serviceWorker.controller) location.reload();
  }
}

const readKey = async (key) => (await pool.query('SELECT value FROM settings WHERE key = $1', [key])).rows[0]?.value ?? null;
const ok = (body, status = 200) => ({ status, body });
const fail = (status, error) => ({ status, body: { error } });

async function me() {
  const s = await readSettings(pool);
  const hash = await readKey('password_hash');
  const authed = unlocked && hash !== null;
  return ok({
    authed,
    name: s.title || 'Mon journal',
    cover: s.cover,
    needsPassword: !hash,
    ...(!hash && { setupCodeRequired: false, canRestore: await isPristine(pool) }),
    ...(authed && { ownerName: s.ownerName, needsSetup: !s.setupDone }),
  });
}

async function login(body) {
  if (tooManyAttempts()) return fail(429, 'Trop de tentatives, réessaie dans quelques minutes.');
  const hash = await readKey('password_hash');
  if (!hash) return fail(409, 'Le mot de passe n’a pas encore été choisi.');
  if (!(await verifyPassword(body.password, hash))) {
    recordFailure();
    return fail(401, 'Mauvais mot de passe…');
  }
  clearFailures();
  unlocked = true;
  return ok({ ok: true });
}

async function setupPassword(body) {
  const problem = checkNewPassword(body.password);
  if (problem) return fail(400, problem);
  const hash = await hashPassword(body.password);
  const { rowCount } = await pool.query(
    "INSERT INTO settings (key, value) VALUES ('password_hash', $1::jsonb) ON CONFLICT (key) DO NOTHING",
    [JSON.stringify(hash)]
  );
  if (!rowCount) return fail(409, 'Le mot de passe a déjà été choisi.');
  unlocked = true;
  return ok({ ok: true }, 201);
}

async function changePassword(body) {
  if (tooManyAttempts()) return fail(429, 'Trop de tentatives, réessaie dans quelques minutes.');
  if (!(await verifyPassword(body.current, await readKey('password_hash')))) {
    recordFailure();
    return fail(403, 'Le mot de passe actuel n’est pas le bon.');
  }
  const problem = checkNewPassword(body.next);
  if (problem) return fail(400, problem);
  const hash = await hashPassword(body.next);
  await transaction(pool, async (client) => {
    for (const [key, value] of [['password_hash', hash]]) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)]
      );
    }
    await client.query(
      `INSERT INTO settings (key, value) VALUES ('password_version', '1'::jsonb)
       ON CONFLICT (key) DO UPDATE
         SET value = to_jsonb(coalesce((settings.value #>> '{}')::int, 0) + 1), updated_at = now()`
    );
  });
  return ok({ ok: true });
}

// Une requête « comme au serveur » : méthode, URL (/api/…), corps JSON ou { fields, file }.
export async function localRequest(method, url, body) {
  await boot();
  const u = new URL(url, 'http://journal');
  const path = u.pathname;
  try {
    if (path === '/api/me') return await me();
    if (path === '/api/login') return await login(body || {});
    if (path === '/api/logout') {
      unlocked = false;
      return ok({ ok: true });
    }
    if (path === '/api/setup/password') return await setupPassword(body || {});
    if (path === '/api/restore') {
      if (!(await isPristine(pool))) return fail(409, 'Ce journal contient déjà des données.');
      if (!body?.file) return fail(400, 'Aucun fichier');
      const manifest = await restoreBackup(pool, body.file);
      return ok({ restored: true, created: manifest.created, counts: manifest.counts });
    }
    if (!unlocked) return fail(401, 'Non connecté');
    if (path === '/api/password') return await changePassword(body || {});
    if (path === '/api/backups' && method === 'GET') return ok(await backupInfo());
    if (path === '/api/backups' && method === 'POST') return ok(await createBackup(pool, 'manuelle'), 201);
    if (path === '/api/spellcheck') return fail(503, 'Correcteur du clavier');
    const isForm = body && body.file instanceof Blob;
    return await journal.handle(method, path.replace(/^\/api/, ''), {
      query: Object.fromEntries(u.searchParams),
      body: isForm ? body.fields : body || {},
      file: isForm ? new Uint8Array(await body.file.arrayBuffer()) : null,
    });
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message);
    if (err instanceof RestoreError) return fail(400, err.message);
    console.error(err);
    return fail(500, err.message || 'Erreur');
  }
}

export async function localShareBackup(name) {
  await boot();
  if (!unlocked) throw new Error('Non connecté');
  return shareBackup(name);
}

// Comptages pour les tests (jamais le contenu).
export async function localCounts() {
  await boot();
  const { counts } = await import('../../../server/src/core/backup-data.js');
  return counts(pool);
}
