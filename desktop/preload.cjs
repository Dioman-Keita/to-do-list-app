// Pont minimal entre l'écran de connexion (page locale) et l'application.
// Les pages du journal (servies par le serveur) n'en ont pas besoin : le processus
// principal refuse de toute façon les appels qui ne viennent pas d'une page locale.
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('desktop', {
    getConfig: () => ipcRenderer.invoke('config:get'),
    test: (url) => ipcRenderer.invoke('config:test', url),
    save: (values) => ipcRenderer.invoke('config:save', values),
    pickFolder: () => ipcRenderer.invoke('config:pickFolder'),
    connect: () => ipcRenderer.invoke('connect'),
    onStatus: (fn) => ipcRenderer.on('status', (_e, s) => fn(s)),
  });
}
