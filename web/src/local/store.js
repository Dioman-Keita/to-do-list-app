// Petit stockage clé → Blob dans IndexedDB (images du journal, sauvegardes en mode navigateur).
// La base de données elle-même est dans PGlite ; ici, seulement des fichiers.
// Le service worker (public/media-sw.js) lit la même base pour afficher les images.

const DB_NAME = 'journal-fichiers';
const STORES = ['uploads', 'sauvegardes'];

let opening = null;
function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    // Une lecture rend son résultat (undefined si la clé n'existe pas), jamais la requête elle-même.
    tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Écriture annulée (stockage plein ?)'));
  });
}

export function fileStore(store) {
  return {
    put: (name, bytes, type) => run(store, 'readwrite', (s) => void s.put(bytes instanceof Blob ? bytes : new Blob([bytes], { type }), name)),
    get: (name) => run(store, 'readonly', (s) => s.get(name)),
    remove: (...names) => run(store, 'readwrite', (s) => names.filter(Boolean).forEach((n) => s.delete(n))),
    keys: () => run(store, 'readonly', (s) => s.getAllKeys()),
  };
}

const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export const typeOf = (name) => TYPES[name.split('.').pop()] || 'application/octet-stream';

export const uploads = fileStore('uploads');
export const backupsStore = fileStore('sauvegardes');

// Interface « files » du cœur du journal.
export const files = {
  write: (name, bytes) => uploads.put(name, bytes, typeOf(name)),
  remove: (...names) => uploads.remove(...names),
};
