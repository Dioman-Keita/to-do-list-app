import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { applyMigrations, MIGRATION_COUNT } from './core/migrations.js';
import { PGLITE_PARSERS, pglitePool } from './core/pglite-pool.js';

// Deux moteurs, exactement le même SQL (PostgreSQL 17) :
//  - « embarqué » (par défaut) : PGlite, PostgreSQL compilé en WebAssembly, dans DATA_DIR/db.
//    Aucun service à installer : c'est ce qu'utilisent l'application de bureau et `node src/index.js`.
//  - « postgres » : un serveur PostgreSQL classique si DATABASE_URL ou PGHOST est défini
//    (ancien docker-compose avec son conteneur `db`).
export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const engine = process.env.DATABASE_URL || process.env.PGHOST ? 'postgres' : 'embedded';

// Garder les colonnes "date" sous forme "YYYY-MM-DD" (pas de décalage de fuseau), et les
// bigint en texte, comme le fait pg.
pg.types.setTypeParser(1082, (v) => v);

function postgresPool() {
  // Sans DATABASE_URL, pg lit PGHOST, PGUSER, PGPASSWORD… (cas de docker-compose).
  const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  // Une connexion inactive coupée (redémarrage de Postgres) ne doit pas faire planter l'app.
  p.on('error', (err) => console.error('Connexion Postgres perdue :', err.message));
  return p;
}

async function embeddedPool() {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(DATA_DIR, 'db');
  fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir, { parsers: PGLITE_PARSERS });
  await db.waitReady;
  return pglitePool(db);
}

export const pool = engine === 'postgres' ? postgresPool() : await embeddedPool();

export { MIGRATION_COUNT };

async function waitForDatabase() {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (attempt >= 30) throw err;
      console.log(`Postgres indisponible (${err.code || err.message}), nouvel essai ${attempt}/30…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export async function migrate() {
  await waitForDatabase();
  await applyMigrations(pool);
}
