import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Deux moteurs, exactement le même SQL (PostgreSQL 17) :
//  - « embarqué » (par défaut) : PGlite, PostgreSQL compilé en WebAssembly, dans DATA_DIR/db.
//    Aucun service à installer : c'est ce qu'utilisent l'application de bureau et `node src/index.js`.
//  - « postgres » : un serveur PostgreSQL classique si DATABASE_URL ou PGHOST est défini
//    (ancien docker-compose avec son conteneur `db`).
export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const engine = process.env.DATABASE_URL || process.env.PGHOST ? 'postgres' : 'embedded';

// Garder les colonnes "date" sous forme "YYYY-MM-DD" (pas de décalage de fuseau), et les
// bigint en texte, comme le fait pg.
const DATE = 1082;
const INT8 = 20;
pg.types.setTypeParser(DATE, (v) => v);

function postgresPool() {
  // Sans DATABASE_URL, pg lit PGHOST, PGUSER, PGPASSWORD… (cas de docker-compose).
  const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  // Une connexion inactive coupée (redémarrage de Postgres) ne doit pas faire planter l'app.
  p.on('error', (err) => console.error('Connexion Postgres perdue :', err.message));
  return p;
}

// PGlite n'a qu'une connexion : on la prête à un seul « client » à la fois, comme un pool
// d'une connexion. Une transaction (connect … release) l'a donc pour elle seule, et une requête
// isolée (pool.query) attend qu'elle soit finie : jamais une requête au milieu de la
// transaction d'un autre.
async function embeddedPool() {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(DATA_DIR, 'db');
  fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir, { parsers: { [DATE]: (v) => v, [INT8]: (v) => v } });
  await db.waitReady;

  let queue = Promise.resolve();
  const acquire = () => {
    let release;
    const turn = new Promise((resolve) => (release = resolve));
    const ready = queue.then(() => release);
    queue = queue.then(() => turn);
    return ready;
  };
  const run = async (text, params) => {
    // Sans paramètres, plusieurs instructions sont possibles (migrations) : exec.
    if (params === undefined) {
      const results = await db.exec(text);
      const last = results[results.length - 1] || { rows: [], affectedRows: 0 };
      return { rows: last.rows, rowCount: Math.max(last.affectedRows ?? 0, last.rows.length) };
    }
    const r = await db.query(text, params);
    return { rows: r.rows, rowCount: Math.max(r.affectedRows ?? 0, r.rows.length) };
  };
  return {
    async query(text, params) {
      const release = await acquire();
      try {
        return await run(text, params);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await acquire();
      return { query: run, release };
    },
    end: () => db.close(),
    on() {},
  };
}

export const pool = engine === 'postgres' ? postgresPool() : await embeddedPool();

// Chaque entrée est appliquée une seule fois, dans l'ordre. Ne jamais modifier
// une migration déjà déployée : en ajouter une nouvelle à la fin.
const MIGRATIONS = [
  `CREATE TABLE entries (
     day date PRIMARY KEY,
     title text NOT NULL DEFAULT '',
     body text NOT NULL DEFAULT '',
     mood text,
     weather text,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE TABLE tasks (
     id serial PRIMARY KEY,
     day date NOT NULL,
     text text NOT NULL,
     done boolean NOT NULL DEFAULT false,
     position integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX tasks_day_idx ON tasks (day);
   CREATE TABLE media (
     id serial PRIMARY KEY,
     day date NOT NULL,
     kind text NOT NULL CHECK (kind IN ('photo', 'sketch')),
     file text NOT NULL,
     thumb text NOT NULL,
     overlay text,
     caption text NOT NULL DEFAULT '',
     width integer NOT NULL,
     height integer NOT NULL,
     tilt real NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now(),
     deleted_at timestamptz
   );
   CREATE INDEX media_day_idx ON media (day) WHERE deleted_at IS NULL;`,

  // Pages, chapitres et humeurs multiples. Migration purement additive : les colonnes
  // `body` (ancien texte brut) et `mood` restent intactes, rien n'est supprimé.
  `ALTER TABLE entries ADD COLUMN moods text[] NOT NULL DEFAULT '{}';
   UPDATE entries SET moods = ARRAY[mood] WHERE mood IS NOT NULL;
   ALTER TABLE entries ADD COLUMN content jsonb;
   ALTER TABLE entries ADD COLUMN content_text text NOT NULL DEFAULT '';
   CREATE TABLE dictionary (
     word text PRIMARY KEY,
     created_at timestamptz NOT NULL DEFAULT now()
   );`,

  // Personnalisation (prénom, titre, couverture). Un journal déjà utilisé est considéré
  // comme configuré : la première configuration ne s'affiche que sur une installation neuve.
  `CREATE TABLE settings (
     key text PRIMARY KEY,
     value jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   );
   INSERT INTO settings (key, value)
     SELECT 'setup_done', 'true'::jsonb
     WHERE EXISTS (SELECT 1 FROM entries) OR EXISTS (SELECT 1 FROM tasks) OR EXISTS (SELECT 1 FROM media);`,

  // Corbeille : les pages arrachées y sont gardées pour toujours (jamais vidée automatiquement).
  // `content` = les blocs du carnet retirés (JSON TipTap), `block_index` = où les recoller.
  `CREATE TABLE trash (
     id serial PRIMARY KEY,
     day date NOT NULL,
     kind text NOT NULL DEFAULT 'page',
     content jsonb NOT NULL,
     preview text NOT NULL DEFAULT '',
     block_index integer NOT NULL DEFAULT 0,
     created_at timestamptz NOT NULL DEFAULT now(),
     restored_at timestamptz
   );
   CREATE INDEX trash_waiting_idx ON trash (created_at) WHERE restored_at IS NULL;`,
];

export const MIGRATION_COUNT = MIGRATIONS.length;

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
  const client = await pool.connect();
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'
    );
    const { rows } = await client.query('SELECT coalesce(max(version), 0) AS v FROM schema_migrations');
    for (let i = rows[0].v; i < MIGRATIONS.length; i++) {
      await client.query('BEGIN');
      try {
        await client.query(MIGRATIONS[i]);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [i + 1]);
        await client.query('COMMIT');
        console.log(`Migration ${i + 1} appliquée`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
  }
}
