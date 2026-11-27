// Test de l'APK dans un téléphone Android simulé (CI) : on pilote la WebView par le protocole
// DevTools (ouvert seulement dans les versions de test). Usage : node smoke-test.mjs <étape>
//   premier   : journal neuf -> écran du mot de passe ; images servies par le service worker ;
//               choix d'un mot de passe -> écran « Je m'appelle… » (PGlite écrit vraiment).
//   relance   : après redémarrage de l'application, le journal demande le mot de passe
//               (la base a survécu) et l'accepte.
// La page peut se recharger (activation du service worker) : on se reconnecte alors.
const step = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + 240e3;
const log = (...a) => console.log(...a);

let ws = null;
let seq = 0;
const pending = new Map();

async function connect() {
  for (;;) {
    if (Date.now() > deadline) {
      const seen = await fetch('http://127.0.0.1:9222/json').then((r) => r.text(), (e) => e.message);
      throw new Error(`WebView introuvable (cibles DevTools : ${seen.slice(0, 500)})`);
    }
    try {
      const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
      const t = targets.find((x) => x.type === 'page' && x.url.startsWith('https://localhost'));
      if (t) {
        ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((r, j) => {
          ws.onopen = r;
          ws.onerror = j;
        });
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.method === 'Runtime.consoleAPICalled') {
            log(`  [console.${msg.params.type}]`, msg.params.args.map((a) => a.value ?? a.description).join(' '));
          } else if (msg.method === 'Runtime.exceptionThrown') {
            log('  [exception]', msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text);
          } else if (pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
          }
        };
        ws.onclose = () => {
          for (const fn of pending.values()) fn({ closed: true });
          pending.clear();
          ws = null;
        };
        send('Runtime.enable', {});
        return;
      }
    } catch {}
    await wait(1000);
  }
}

function send(method, params) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return id;
}

// Évalue dans la page ; si elle se recharge pendant ce temps, on se reconnecte et on recommence.
async function evaluate(expression, timeoutMs = 30000) {
  for (;;) {
    if (Date.now() > deadline) throw new Error('Délai dépassé');
    if (!ws) await connect();
    const id = send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    const msg = await new Promise((r) => {
      pending.set(id, r);
      setTimeout(() => r({ timeout: true }), timeoutMs);
    });
    if (msg.closed || msg.timeout) {
      log(msg.closed ? '  (page rechargée : reconnexion)' : '  (pas de réponse : reconnexion)');
      ws?.close();
      ws = null;
      await wait(1000);
      continue;
    }
    if (msg.result?.exceptionDetails) throw new Error(msg.result.exceptionDetails.exception?.description || 'erreur dans la page');
    return msg.result?.result?.value;
  }
}

// Ce que l'on sait de la page au moment d'un échec : étape du démarrage, texte affiché.
let lastState = '?';

async function waitForText(text) {
  while (Date.now() < deadline - 15e3) {
    lastState = await evaluate(
      `JSON.stringify({ demarrage: globalThis.__journalDemarrage ?? null, texte: document.body.innerText.slice(0, 300), sw: Boolean(navigator.serviceWorker?.controller) })`
    ).catch((e) => `erreur : ${e.message}`);
    if (await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`).catch(() => false)) return;
    await wait(1000);
  }
  throw new Error(`Texte jamais affiché : « ${text} »`);
}
const ok = (label) => log(`OK  ${label}`);

try {
  await connect();
  if (step === 'premier') {
    await waitForText('Choisis ton mot de passe secret');
    ok('journal neuf : la base PGlite a démarré, écran du mot de passe');
    const sw = await evaluate(`(async () => {
      const c = Boolean(navigator.serviceWorker.controller);
      // Une image rangée comme le fait le journal, puis demandée comme le fait <img>.
      const db = await new Promise((r, j) => { const q = indexedDB.open('journal-fichiers', 1); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
      const name = '00000000-0000-4000-8000-000000000000.png';
      await new Promise((r, j) => { const tx = db.transaction('uploads', 'readwrite'); tx.objectStore('uploads').put(new Blob([new Uint8Array([1,2,3,4,5])], { type: 'image/png' }), name); tx.oncomplete = r; tx.onerror = () => j(tx.error); });
      const res = await fetch('/media/' + name);
      const size = (await res.arrayBuffer()).byteLength;
      await new Promise((r) => { const tx = db.transaction('uploads', 'readwrite'); tx.objectStore('uploads').delete(name); tx.oncomplete = r; });
      return { controller: c, status: res.status, size };
    })()`);
    if (!sw.controller || sw.status !== 200 || sw.size !== 5) throw new Error(`Service worker des images : ${JSON.stringify(sw)}`);
    ok('images servies par le service worker dans la WebView');
    await evaluate(`(() => { const [a, b] = document.querySelectorAll('input[type=password]');
      for (const el of [a, b]) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'demo-demo'); el.dispatchEvent(new Event('input', { bubbles: true })); }
      document.querySelector('form button[type=submit]').click(); })()`);
    await waitForText('Je m’appelle');
    ok('mot de passe choisi (scrypt + PGlite) : écran « Je m’appelle… »');
  } else if (step === 'relance') {
    for (;;) {
      if (Date.now() > deadline) throw new Error('Écran de connexion jamais affiché');
      if (await evaluate(`document.body.innerText.includes('Choisis ton mot de passe secret')`).catch(() => false)) {
        throw new Error('Après relance, le journal est redevenu neuf : la base n’a pas été gardée');
      }
      if ((await evaluate(`document.querySelectorAll('input[type=password]').length`).catch(() => -1)) === 1) break;
      await wait(1000);
    }
    ok('après relance : la base a survécu, le mot de passe est demandé');
    await evaluate(`(() => { const el = document.querySelector('input[type=password]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'demo-demo'); el.dispatchEvent(new Event('input', { bubbles: true }));
      el.form.requestSubmit(); })()`);
    await waitForText('Je m’appelle');
    ok('connexion avec le mot de passe choisi au premier lancement');
  } else {
    throw new Error('Étape inconnue');
  }
  ws?.close();
  process.exit(0);
} catch (err) {
  console.error(`ÉCHEC : ${err.message}`);
  console.error(`État de la page : ${lastState}`);
  process.exit(1);
}
