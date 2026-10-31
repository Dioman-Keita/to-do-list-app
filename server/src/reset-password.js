// Commande de secours : définir un nouveau mot de passe quand on l'a oublié.
//   docker compose exec app node src/reset-password.js
// Il faut un accès à la machine qui héberge le journal : c'est ce qui protège cette commande.
// Toutes les sessions ouvertes sont déconnectées.
import readline from 'node:readline';
import { checkNewPassword, setPassword } from './auth.js';
import { migrate, pool } from './db.js';

function askHidden(rl, question) {
  return new Promise((resolve) => {
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => write(s.startsWith(question) ? s : '');
    rl.question(question, (answer) => {
      rl._writeToOutput = write;
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPasswords() {
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const first = await askHidden(rl, 'Nouveau mot de passe : ');
    const second = await askHidden(rl, 'Encore une fois : ');
    rl.close();
    return [first, second];
  }
  // Sans terminal (script, tests) : le mot de passe sur la première ligne de l'entrée standard.
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const line = input.split(/\r?\n/)[0];
  return [line, line];
}

try {
  await migrate();
  const [password, confirm] = await readPasswords();
  if (password !== confirm) throw new Error('Les deux mots de passe ne sont pas identiques.');
  const problem = checkNewPassword(password);
  if (problem) throw new Error(problem);
  await setPassword(password);
  console.log('Nouveau mot de passe enregistré. Toutes les sessions ouvertes sont déconnectées.');
} catch (err) {
  console.error(`Échec : ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
