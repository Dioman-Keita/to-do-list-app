// Format des sauvegardes .zip, partagé par le serveur et l'application Android :
//   manifest.json  format, version du schéma, date, comptages (pour vérifier une restauration)
//   data.json      toutes les tables, ligne par ligne (le mot de passe n'y est qu'en empreinte)
//   uploads/…      toutes les photos, croquis et calques
// Ici : ce qui ne touche que la base (lecture cohérente, import vérifié). La lecture et l'écriture
// du .zip et des images dépendent de la plateforme (fichiers sur disque, ou stockage du téléphone).
import { MIGRATION_COUNT } from './migrations.js';

export const FORMAT = 'journal-sauvegarde';
export const TABLES = ['settings', 'entries', 'tasks', 'media', 'dictionary', 'trash'];
// « -2 », « -3 »… si deux sauvegardes tombent dans la même seconde.
export const NAME_RE = /^journal_\d{4}-\d{2}-\d{2}_\d{6}(-\d{1,3})?\.zip$/;
export const UPLOAD_RE = /^uploads\/([0-9a-f-]{36}(-t)?\.(jpg|png|webp))$/;
export const COUNT_KEYS = ['journees', 'taches', 'medias', 'caracteres', 'corbeille'];
// Tailles maximales à la lecture d'une sauvegarde (une archive piégée ne doit pas remplir la mémoire).
export const MAX_MANIFEST = 1024 ** 2;
export const MAX_DATA = 1024 ** 3;
export const MAX_IMAGE = 512 * 1024 ** 2;

export class RestoreError extends Error {}

export async function counts(client) {
  const { rows } = await client.query(
    `SELECT (SELECT count(*)::int FROM entries) AS journees,
            (SELECT count(*)::int FROM tasks) AS taches,
            (SELECT count(*)::int FROM media) AS medias,
            (SELECT coalesce(sum(length(content_text)), 0)::int FROM entries) AS caracteres,
            (SELECT count(*)::int FROM trash) AS corbeille`
  );
  return rows[0];
}

// Nom d'une sauvegarde : journal_AAAA-MM-JJ_HHMMSS (heure locale).
export const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

// Lecture cohérente : toutes les tables au même instant.
export async function snapshot(pool) {
  const client = await pool.connect();
  try {
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
export const referencedFiles = (media = []) => media.flatMap((m) => [m.file, m.thumb, m.overlay]).filter(Boolean);

// Vérifie le contenu lu dans une archive avant import (format, version, images présentes).
export function checkArchive(manifest, data, presentFiles) {
  if (manifest?.format !== FORMAT || !data) throw new RestoreError('Ce fichier n’est pas une sauvegarde du journal.');
  if (manifest.schema > MIGRATION_COUNT) {
    throw new RestoreError('Cette sauvegarde vient d’une version plus récente du journal : mets d’abord le journal à jour.');
  }
  const missing = referencedFiles(data.media).filter((f) => !presentFiles.has(f));
  if (missing.length) throw new RestoreError(`Sauvegarde incomplète : ${missing.length} image(s) manquante(s). Rien n’a été importé.`);
}

// Importe toutes les tables dans UNE transaction, puis compare les comptages avec ceux de la
// sauvegarde. Au moindre écart, rien n'est gardé.
export async function importTables(pool, data, expected) {
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
export async function isPristine(client) {
  const { rows } = await client.query(
    `SELECT NOT EXISTS (SELECT 1 FROM settings WHERE key = 'password_hash')
        AND NOT EXISTS (SELECT 1 FROM entries) AND NOT EXISTS (SELECT 1 FROM tasks)
        AND NOT EXISTS (SELECT 1 FROM media) AND NOT EXISTS (SELECT 1 FROM trash)
        AND NOT EXISTS (SELECT 1 FROM dictionary) AS pristine`
  );
  return rows[0].pristine;
}
