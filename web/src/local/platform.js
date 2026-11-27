// Où ranger les sauvegardes .zip du journal autonome :
//  - dans l'application Android : Documents/Journal/Sauvegardes du téléphone (elles survivent à une
//    désinstallation de l'application), partage par la feuille de partage d'Android ;
//  - dans un navigateur (essais) : IndexedDB, téléchargement classique.
// Les modules natifs (Filesystem, Share) sont fournis par l'application Capacitor : rien à installer côté web.
import { backupsStore } from './store.js';

const cap = globalThis.Capacitor;
export const isNative = Boolean(cap?.isNativePlatform?.());
const Filesystem = isNative ? cap.registerPlugin('Filesystem') : null;
const Share = isNative ? cap.registerPlugin('Share') : null;

const DIR = 'Journal/Sauvegardes';
const DIRECTORY = 'DOCUMENTS';

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Écriture par morceaux de 3 Mo (multiple de 3 : le Base64 de chaque morceau se recolle tel quel),
// pour ne jamais avoir toute la sauvegarde en Base64 en mémoire. Fichier « .part », renommé à la fin.
const CHUNK = 3 * 1024 * 1024;

const nativeStore = {
  where: 'Documents/Journal/Sauvegardes',
  async ensurePermission() {
    // Android 10 et avant : autorisation d'écrire dans Documents. Après : rien à demander.
    try {
      const p = await Filesystem.checkPermissions();
      if (p.publicStorage !== 'granted') await Filesystem.requestPermissions();
    } catch {
      /* plateformes sans cette notion */
    }
  },
  async save(name, bytes) {
    await this.ensurePermission();
    const part = `${DIR}/${name}.part`;
    try {
      await Filesystem.writeFile({ path: part, directory: DIRECTORY, data: toBase64(bytes.subarray(0, CHUNK)), recursive: true });
      for (let i = CHUNK; i < bytes.length; i += CHUNK) {
        await Filesystem.appendFile({ path: part, directory: DIRECTORY, data: toBase64(bytes.subarray(i, i + CHUNK)) });
      }
      await Filesystem.rename({ from: part, to: `${DIR}/${name}`, directory: DIRECTORY, toDirectory: DIRECTORY });
    } catch (err) {
      await Filesystem.deleteFile({ path: part, directory: DIRECTORY }).catch(() => {});
      throw err;
    }
  },
  async list() {
    try {
      const { files } = await Filesystem.readdir({ path: DIR, directory: DIRECTORY });
      return files.filter((f) => f.type !== 'directory' && !f.name.endsWith('.part')).map((f) => ({ name: f.name, size: f.size, created: new Date(Number(f.mtime)).toISOString() }));
    } catch {
      return []; // dossier pas encore créé
    }
  },
  remove: (name) => Filesystem.deleteFile({ path: `${DIR}/${name}`, directory: DIRECTORY }),
  async share(name) {
    const { uri } = await Filesystem.getUri({ path: `${DIR}/${name}`, directory: DIRECTORY });
    await Share.share({ title: name, files: [uri], dialogTitle: 'Garder une copie de la sauvegarde' });
  },
};

const browserStore = {
  where: 'ce navigateur',
  async save(name, bytes) {
    await backupsStore.put(name, bytes, 'application/zip');
  },
  async list() {
    const names = await backupsStore.keys();
    return Promise.all(
      names.map(async (name) => {
        const blob = await backupsStore.get(name);
        const m = /^journal_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(name);
        const created = m ? new Date(m[1], m[2] - 1, m[3], m[4], m[5], m[6]) : new Date(0);
        return { name, size: blob?.size || 0, created: created.toISOString() };
      })
    );
  },
  remove: (name) => backupsStore.remove(name),
  async share(name) {
    const blob = await backupsStore.get(name);
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
};

export const backupFiles = isNative ? nativeStore : browserStore;
