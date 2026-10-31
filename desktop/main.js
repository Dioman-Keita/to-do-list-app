// Journal — application de bureau.
// Une fenêtre Windows sur le serveur du journal (ce PC avec Docker, ou un VPS) :
// le journal lui-même (données, sauvegardes, correcteur) reste côté serveur.
const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// --profile=<dossier> : profil séparé (tests, ou plusieurs journaux sur le même PC).
const profileArg = process.argv.find((a) => a.startsWith('--profile='));
if (profileArg) app.setPath('userData', path.resolve(profileArg.slice('--profile='.length)));

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json');
const DEFAULTS = { serverUrl: 'http://localhost:8080', composeDir: '', startWithWindows: false, bounds: null };
const SETUP_PAGE = path.join(__dirname, 'renderer', 'setup.html');
const DESK = '#1b222d';
// Emplacements habituels de Docker Desktop (installation par machine ou par utilisateur).
const DOCKER_DESKTOP = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DockerDesktop', 'Docker Desktop.exe'),
];

// Journal de fonctionnement (dossier du profil) : utile pour comprendre un démarrage raté.
function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'journal-desktop.log'), line);
  } catch {
    /* rien de grave */
  }
}

let win = null;
let config = { ...DEFAULTS };
let firstRun = false;

// ---------- Configuration (dans le dossier de l'utilisateur, jamais dans l'appli) ----------

function loadConfig() {
  try {
    config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8')) };
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

// ---------- Serveur ----------

async function reachable(origin) {
  try {
    const res = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, windowsHide: true, timeout: 180000 }, (err, stdout, stderr) => {
      const res = { ok: !err, out: `${stdout}${stderr}`.trim() || String(err?.message || '') };
      log(cmd, args.join(' '), '->', res.ok ? 'ok' : `échec : ${res.out.split('\n').pop()}`);
      resolve(res);
    });
  });
}

async function waitFor(check, seconds) {
  for (let i = 0; i < seconds; i += 2) {
    if (await check()) return true;
    await sleep(2000);
  }
  return false;
}

// Le journal tourne sur ce PC : réveiller Docker Desktop si besoin, puis « docker compose up -d ».
async function startLocalServer(status) {
  const dir = config.composeDir;
  log('démarrage local, dossier :', dir);
  if (!dir || !fs.existsSync(path.join(dir, 'docker-compose.yml'))) {
    log('pas de docker-compose.yml dans ce dossier');
    return false;
  }
  if (!(await run('docker', ['info'], dir)).ok) {
    const exe = DOCKER_DESKTOP.find((p) => fs.existsSync(p));
    log('Docker Desktop :', exe || 'introuvable');
    if (!exe) return false;
    status('Je réveille Docker…');
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    if (!(await waitFor(async () => (await run('docker', ['info'], dir)).ok, 150))) return false;
  }
  status('J’ouvre le journal…');
  const up = await run('docker', ['compose', 'up', '-d'], dir);
  if (!up.ok) {
    status(`Docker a refusé de démarrer le journal : ${up.out.split('\n').pop()}`);
    return false;
  }
  return waitFor(() => reachable(config.serverUrl), 90);
}

// ---------- Fenêtre ----------

function sendStatus(message, state = 'busy') {
  if (win && !win.isDestroyed()) win.webContents.send('status', { message, state });
}

async function connect() {
  sendStatus('Je cherche ton journal…');
  let ok = await reachable(config.serverUrl);
  log('serveur', config.serverUrl, ok ? 'joignable' : 'injoignable', '| dossier local :', config.composeDir || '(aucun)');
  if (!ok && config.composeDir) ok = await startLocalServer((m) => sendStatus(m));
  if (!ok) {
    sendStatus(`Le journal ne répond pas à ${config.serverUrl}.`, 'error');
    return false;
  }
  await win.loadURL(config.serverUrl);
  return true;
}

function isJournalUrl(url) {
  try {
    return new URL(url).origin === config.serverUrl;
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

  // Le serveur tombe en cours de route : retour à l'écran de connexion.
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

// ---------- Échanges avec l'écran de connexion (pages locales uniquement) ----------

function fromSetupPage(event) {
  return event.senderFrame?.url?.startsWith('file:');
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromSetupPage(event)) throw new Error('Refusé');
    return fn(...args);
  });
}

handle('config:get', () => ({ ...config, firstRun, canAutostart: process.platform === 'win32' }));

handle('config:test', async (url) => {
  try {
    const origin = normalizeUrl(url);
    return { ok: await reachable(origin), origin };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

handle('config:save', async (values) => {
  config.serverUrl = normalizeUrl(values.serverUrl);
  config.composeDir = values.composeDir ? String(values.composeDir) : '';
  config.startWithWindows = Boolean(values.startWithWindows);
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: config.startWithWindows });
  firstRun = false;
  saveConfig();
  return connect();
});

handle('config:pickFolder', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Dossier du journal (celui qui contient docker-compose.yml)',
    properties: ['openDirectory'],
  });
  if (res.canceled) return null;
  const dir = res.filePaths[0];
  return { dir, valid: fs.existsSync(path.join(dir, 'docker-compose.yml')) };
});

handle('connect', () => connect());

// ---------- Démarrage ----------

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

  app.on('window-all-closed', () => app.quit());
}
