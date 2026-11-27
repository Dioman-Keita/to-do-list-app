// Journal autonome (application Android) : sert les images « /media/<nom> » depuis IndexedDB,
// où le journal les range (voir src/local/store.js). Ne touche à aucune autre requête.
const FILE_RE = /^\/media\/([0-9a-f-]{36}(-t)?\.(jpg|png|webp))$/;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function readFile(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('journal-fichiers', 1);
    req.onupgradeneeded = () => {
      for (const s of ['uploads', 'sauvegardes']) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('uploads', 'readonly');
      const get = tx.objectStore('uploads').get(name);
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => reject(get.error);
      tx.oncomplete = () => req.result.close();
    };
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const m = FILE_RE.exec(url.pathname);
  if (!m) return;
  event.respondWith(
    readFile(m[1]).then(
      (blob) =>
        blob
          ? new Response(blob, { headers: { 'Content-Type': TYPES[m[3]], 'Cache-Control': 'no-store' } })
          : new Response('', { status: 404 }),
      () => new Response('', { status: 500 })
    )
  );
});
