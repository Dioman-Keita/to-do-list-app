// Pont minimal entre les pages et l'application. Le processus principal vérifie de son côté
// d'où vient chaque appel (écran de connexion local, ou journal intégré sur 127.0.0.1).
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  // Écran de connexion.
  contextBridge.exposeInMainWorld('desktop', {
    getConfig: () => ipcRenderer.invoke('config:get'),
    test: (url) => ipcRenderer.invoke('config:test', url),
    save: (values) => ipcRenderer.invoke('config:save', values),
    connect: () => ipcRenderer.invoke('connect'),
    onStatus: (fn) => ipcRenderer.on('status', (_e, s) => fn(s)),
  });
} else if (location.hostname === '127.0.0.1') {
  // Journal intégré : ce qui n'existe qu'en version bureau (choisir un dossier sur ce PC).
  contextBridge.exposeInMainWorld('journalDesktop', {
    chooseBackupDir: () => ipcRenderer.invoke('backup:chooseDir'),
  });
}
