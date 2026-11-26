// Test de l'APK dans un téléphone Android simulé (CI) : on pilote la WebView par le protocole
// DevTools (ouvert seulement dans les versions de test). Usage : node smoke-test.mjs <étape>
//   premier   : journal neuf -> écran du mot de passe ; images servies par le service worker ;
//               choix d'un mot de passe -> écran « Je m'appelle… » (PGlite écrit vraiment).
//   relance   : après redémarrage de l'application, le journal demande le mot de passe
//               (la base a survécu) et l'accepte.
const step = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function page() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
      const t = targets.find((x) => x.type === 'page' && x.url.startsWith('https://localhost'));
      if (t) return t.webSocketDebuggerUrl;
    } catch {}
    await wait(1000);
  }
  throw new Error('WebView introuvable');
}

const ws = new WebSocket(await page());
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
async function evaluate(expression) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  const msg = await new Promise((r) => pending.set(id, r));
  if (msg.result?.exceptionDetails) throw new Error(msg.result.exceptionDetails.exception?.description || 'erreur dans la page');
  return msg.result?.result?.value;
}
async function waitForText(text, seconds = 90) {
  for (let i = 0; i < seconds; i++) {
    if (await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`).catch(() => false)) return;
    await wait(1000);
  }
  throw new Error(`Texte jamais affiché : « ${text} »\n--- page ---\n${await evaluate('document.body.innerText').catch(() => '?')}`);
}
const ok = (label) => console.log(`OK  ${label}`);

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
  await wait(3000);
  for (let i = 0; i < 90; i++) {
    const n = await evaluate(`document.querySelectorAll('input[type=password]').length`).catch(() => -1);
    const fresh = await evaluate(`document.body.innerText.includes('Choisis ton mot de passe secret')`).catch(() => false);
    if (fresh) throw new Error('Après relance, le journal est redevenu neuf : la base n’a pas été gardée');
    if (n === 1) break;
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
ws.close();
process.exit(0);
