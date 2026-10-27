import pg from 'pg';

// Garder les colonnes "date" sous forme "YYYY-MM-DD" (pas de décalage de fuseau).
pg.types.setTypeParser(1082, (v) => v);

// Sans DATABASE_URL, pg lit PGHOST, PGUSER, PGPASSWORD… (cas de docker-compose).
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Une connexion inactive coupée (redémarrage de Postgres) ne doit pas faire planter l'app.
pool.on('error', (err) => console.error('Connexion Postgres perdue :', err.message));

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
];

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
