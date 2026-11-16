// Créer une sauvegarde .zip en ligne de commande (même format que le bouton des Paramètres).
//   node src/backup-cli.js                        (journal sans Docker : fermer l'application avant)
//   docker compose exec app node src/backup-cli.js
// Sert aussi à passer d'un journal Docker (PostgreSQL) à l'application de bureau : la sauvegarde
// produite se restaure au premier lancement de celle-ci.
import { createBackup, initBackups } from './backup.js';
import { migrate, pool } from './db.js';
import { UPLOAD_DIR } from './routes.js';

try {
  await migrate();
  initBackups(UPLOAD_DIR);
  const made = await createBackup('en ligne de commande');
  const c = made.counts; // ceux de la sauvegarde elle-même
  console.log(`Sauvegarde : ${made.name} (${(made.size / 1e6).toFixed(1)} Mo)`);
  console.log(`Contenu : ${c.journees} journées, ${c.taches} tâches, ${c.medias} médias, ${c.caracteres} caractères, ${c.corbeille} page(s) à la corbeille`);
} catch (err) {
  console.error(`Échec : ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
