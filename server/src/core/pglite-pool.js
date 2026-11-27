// PGlite n'a qu'une connexion : on la prête à un seul « client » à la fois, comme un pool
// d'une connexion. Une transaction (connect … release) l'a donc pour elle seule, et une requête
// isolée (pool.query) attend qu'elle soit finie : jamais une requête au milieu de la
// transaction d'un autre. Même interface que pg.Pool (query, connect/release, end).
// Partagé par le serveur et l'application Android.
export const DATE_OID = 1082;
export const INT8_OID = 20;
// Garder les dates "YYYY-MM-DD" (pas de décalage de fuseau) et les bigint en texte, comme pg.
export const PGLITE_PARSERS = { [DATE_OID]: (v) => v, [INT8_OID]: (v) => v };

export function pglitePool(db) {
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
