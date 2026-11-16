// Journal — application de bureau.
// Par défaut, le journal tourne DANS l'application : serveur Node et base PostgreSQL embarquée
// (PGlite), sans Docker ni aucun service à installer. Les données sont dans le profil Windows,
// les sauvegardes .zip dans un dossier au choix (OneDrive…).
// Autre possibilité : se connecter à un journal hébergé ailleurs (VPS).
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// --profile=<dossier> : profil séparé (tests, ou plusieurs journaux sur le même PC).
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
if (profileArg) app.setPath('userData', path.resolve(profileArg.slice('--profile='.length)));

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json');
const DEFAULTS = { mode: 'local', serverUrl: '', port: 8080, backupDir: '', startWithWindows: false, bounds: null };
const SETUP_PAGE = path.join(__dirname, 'renderer', 'setup.html');
const DESK = '#1b222d';
// Le serveur et le front compilé : à côté de l'application une fois installée, dans le dépôt sinon.
const SERVER_DIR = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(__dirname, '..', 'server');
const PUBLIC_DIR = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web', 'dist');

// Journal de fonctionnement (dossier du profil) : utile pour comprendre un démarrage raté.
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'journal-desktop.log'), line);
  } catch {
    /* rien de grave */
  }
}
// Les messages du serveur (migrations, sauvegardes…) vont aussi dans ce journal.
for (const level of ['log', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    log(level === 'error' ? '!' : '', ...args.map(String));
  };
}

let win = null;
let config = { ...DEFAULTS };
let firstRun = false;
let local = null; // { origin, server: module index.js, backup: module backup.js } une fois démarré
let starting = null;

// ---------- Configuration (dans le dossier de l'utilisateur, jamais dans l'appli) ----------

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
    // Ancienne version (journal Docker) : un journal « sur ce PC » devient le journal intégré.
    if (!saved.mode) {
      const host = saved.serverUrl ? new URL(saved.serverUrl).hostname : 'localhost';
      saved.mode = saved.composeDir || ['localhost', '127.0.0.1'].includes(host) ? 'local' : 'remote';
      delete saved.composeDir;
    }
    config = { ...DEFAULTS, ...saved };
  } catch {
    firstRun = true;
    config = { ...DEFAULTS };
  }
}

function saveConfig() {
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(config, null, 2));
}

function normalizeUrl(raw) {
  const url = new URL(String(raw).trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Adresse en http:// ou https:// uniquement');
  return url.origin;
}

const defaultBackupDir = () => path.join(app.getPath('documents'), 'Journal', 'Sauvegardes');

// ---------- Journal intégré ----------

function startLocal() {
  if (local) return Promise.resolve(local);
  if (starting) return starting;
  starting = (async () => {
    Object.assign(process.env, {
      DATA_DIR: path.join(app.getPath('userData'), 'journal'),
      BACKUP_DIR: config.backupDir || defaultBackupDir(),
      PUBLIC_DIR,
      JOURNAL_NAME: 'Mon journal',
      SETUP_CODE: 'never', // n'écoute que sur ce PC (127.0.0.1)
    });
    delete process.env.DATABASE_URL;
    delete process.env.PGHOST;
    log('démarrage du journal intégré, données :', process.env.DATA_DIR);
    const server = await import(pathToFileURL(path.join(SERVER_DIR, 'src', 'index.js')).href);
    const backup = await import(pathToFileURL(path.join(SERVER_DIR, 'src', 'backup.js')).href);
    const port = await server.start({ port: config.port, host: '127.0.0.1', portFallback: 20 });
    local = { origin: `http://127.0.0.1:${port}`, server, backup };
    return local;
  })().finally(() => {
    starting = null;
  });
  return starting;
}

// ---------- Journal distant ----------

async function reachable(origin) {
  try {
    const res = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- Fenêtre ----------

function sendStatus(message, state = 'busy') {
  if (win && !win.isDestroyed()) win.webContents.send('status', { message, state });
}

const journalOrigin = () => (config.mode === 'local' ? local?.origin : config.serverUrl);

async function connect() {
  if (config.mode === 'local') {
    sendStatus('J’ouvre le journal…');
    try {
      await startLocal();
    } catch (err) {
      log('échec du journal intégré :', err.stack || err.message);
      sendStatus(`Le journal n’a pas pu démarrer : ${err.message}`, 'error');
      return false;
    }
  } else {
    sendStatus('Je cherche ton journal…');
    const ok = await reachable(config.serverUrl);
    log('serveur', config.serverUrl, ok ? 'joignable' : 'injoignable');
    if (!ok) {
      sendStatus(`Le journal ne répond pas à ${config.serverUrl}.`, 'error');
      return false;
    }
  }
  await win.loadURL(journalOrigin());
  return true;
}

function isJournalUrl(url) {
  try {
    return new URL(url).origin === journalOrigin();
  } catch {
    return false;
  }
}

function showSetup(mode) {
  return win.loadFile(SETUP_PAGE, { query: { mode } });
}

function createWindow() {
  const bounds = config.bounds || { width: 1360, height: 860 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: 'Journal',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: DESK,
    // Barre de titre fondue dans le bureau du carnet (boutons Windows conservés).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: DESK, symbolColor: '#f3ead6', height: 32 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (config.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // Une zone pour déplacer la fenêtre (le journal n'a pas de barre de titre à lui).
  win.webContents.on('did-finish-load', () => {
    if (isJournalUrl(win.webContents.getURL())) {
      win.webContents.insertCSS(
        'body::before{content:"";position:fixed;top:0;left:0;right:150px;height:32px;-webkit-app-region:drag;z-index:2147483647}'
      );
    }
  });

  // Le serveur distant tombe en cours de route : retour à l'écran de connexion.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && isJournalUrl(url)) showSetup('offline');
  });

  // Rien d'autre que le journal dans la fenêtre ; les liens externes s'ouvrent dans le navigateur.
  win.webContents.on('will-navigate', (event, url) => {
    if (isJournalUrl(url) || url.startsWith('file:')) return;
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Les sauvegardes téléchargées depuis Paramètres : demander où les enregistrer.
  win.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ title: 'Enregistrer la sauvegarde', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });

  win.webContents.on('context-menu', (_e, params) => showContextMenu(params));

  win.on('close', () => {
    config.maximized = win.isMaximized();
    if (!config.maximized) config.bounds = win.getBounds();
    saveConfig();
  });

  showSetup(firstRun ? 'first' : 'connect');
}

// Menu du clic droit : suggestions du correcteur Windows (quand LanguageTool n'est pas là)
// et copier / coller. Le journal gère lui-même le clic droit sur les fautes de LanguageTool.
function showContextMenu(params) {
  const items = [];
  if (params.misspelledWord) {
    for (const s of params.dictionarySuggestions.slice(0, 6)) {
      items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    }
    if (!params.dictionarySuggestions.length) items.push({ label: 'Aucune suggestion', enabled: false });
    items.push({
      label: 'Ajouter au dictionnaire',
      click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    });
    items.push({ type: 'separator' });
  }
  if (params.isEditable) {
    items.push(
      { label: 'Couper', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'Copier', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Coller', role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { label: 'Tout sélectionner', role: 'selectAll' }
    );
  } else if (params.selectionText) {
    items.push({ label: 'Copier', role: 'copy' });
  }
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

// ---------- Échanges avec les pages ----------

// Écran de connexion (page locale de l'application).
function fromSetupPage(event) {
  return event.senderFrame?.url?.startsWith('file:');
}

// Le journal intégré lui-même (127.0.0.1), pour ce qui n'existe qu'en version bureau.
function fromLocalJournal(event) {
  try {
    return Boolean(local) && new URL(event.senderFrame?.url).origin === local.origin;
  } catch {
    return false;
  }
}

// Cette page est-elle le journal intégré ? (sinon : pas de bouton « changer de dossier »)
ipcMain.handle('desktop:isLocalJournal', (event) => fromLocalJournal(event));

function handle(channel, allowed, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!allowed(event)) throw new Error('Refusé');
    return fn(...args);
  });
}

handle('config:get', fromSetupPage, () => ({ ...config, firstRun, canAutostart: process.platform === 'win32' }));

handle('config:test', fromSetupPage, async (url) => {
  try {
    const origin = normalizeUrl(url);
    return { ok: await reachable(origin), origin };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

handle('config:save', fromSetupPage, async (values) => {
  config.mode = values.mode === 'remote' ? 'remote' : 'local';
  if (config.mode === 'remote') config.serverUrl = normalizeUrl(values.serverUrl);
  config.startWithWindows = Boolean(values.startWithWindows);
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: config.startWithWindows });
  firstRun = false;
  saveConfig();
  return connect();
});

handle('connect', fromSetupPage, () => connect());

// Paramètres → Sauvegardes → « changer de dossier ».
handle('backup:chooseDir', fromLocalJournal, async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Dossier des sauvegardes du journal',
    defaultPath: config.backupDir || defaultBackupDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled) return false;
  config.backupDir = res.filePaths[0];
  saveConfig();
  local.backup.setBackupDir(config.backupDir);
  log('dossier des sauvegardes :', config.backupDir);
  return true;
});

// ---------- Démarrage et arrêt ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // Le journal n'utilise ni caméra, ni micro, ni notifications, ni géolocalisation.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.setSpellCheckerLanguages(['fr']);
    loadConfig();
    createWindow();
  });

  // Refermer proprement la base embarquée avant de quitter.
  let closing = false;
  app.on('before-quit', (event) => {
    if (closing) return;
    // Quitter pendant le démarrage : attendre que la base soit ouverte pour la refermer proprement.
    if (!local && starting) {
      event.preventDefault();
      starting.catch(() => {}).finally(() => app.quit());
      return;
    }
    if (!local) return;
    closing = true;
    event.preventDefault();
    local.server
      .stop()
      .catch((err) => log('arrêt :', err.message))
      .finally(() => {
        local = null;
        app.quit();
      });
  });

  app.on('window-all-closed', () => app.quit());
}
