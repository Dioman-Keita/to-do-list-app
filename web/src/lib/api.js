// Application Android (build en mode « telephone ») : le journal tourne dans la page (src/local),
// sans serveur. Même décision que vite.config.js (le mode), donc jamais l'un sans l'autre.
export const LOCAL = import.meta.env.MODE === 'telephone';
// En version serveur, vite.config.js remplace ce module par une coquille vide.
// Si le moteur ne se charge pas (navigateur trop ancien…), on le dit au lieu de faire croire
// à un mot de passe à saisir.
const local = () =>
  import('../local/server.js').catch((err) => {
    globalThis.__journalDemarrage = `module : ${err?.message || err}`;
    throw new Error(`Le journal ne peut pas démarrer sur cet appareil (${err?.message || err}).`);
  });

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

// FormData -> { fields, file } pour le journal autonome.
function formToObject(form) {
  const fields = {};
  let file = null;
  for (const [k, v] of form.entries()) {
    if (v instanceof Blob) file = v;
    else fields[k] = v;
  }
  return { fields, file };
}

async function localRequest(method, url, body) {
  const { localRequest } = await local();
  const res = await localRequest(method, url, body instanceof FormData ? formToObject(body) : body);
  if (res.status === 401 && url !== '/api/login') {
    onUnauthorized();
    throw new Error('Session expirée');
  }
  if (res.status >= 400) throw Object.assign(new Error(res.body?.error || `Erreur ${res.status}`), { status: res.status });
  return res.body ?? null;
}

// Mode téléphone : le texte d'une journée est d'abord noté dans le stockage de la page (synchrone),
// puis écrit dans la base. Si l'application est fermée entre les deux, il est rejoué au lancement
// suivant (src/local/server.js). Une fois l'écriture confirmée, seuls les champs envoyés ET restés
// identiques sont retirés : un champ plus récent, ou d'une écriture ratée, reste noté.
const DRAFTS_KEY = 'journal-brouillons';
const readDrafts = () => {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
  } catch {
    return {};
  }
};
const writeDrafts = (drafts) => {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    /* stockage plein : l'écriture dans la base reste la seule copie */
  }
};
function noteDraft(day, patch) {
  const drafts = readDrafts();
  drafts[day] = { patch: { ...(drafts[day]?.patch || {}), ...patch } };
  writeDrafts(drafts);
}
function dropSaved(day, sent) {
  const drafts = readDrafts();
  const kept = drafts[day]?.patch;
  if (!kept) return;
  for (const [field, value] of Object.entries(sent)) {
    if (field in kept && JSON.stringify(kept[field]) === JSON.stringify(value)) delete kept[field];
  }
  if (Object.keys(kept).length) drafts[day] = { patch: kept };
  else delete drafts[day];
  writeDrafts(drafts);
}

async function request(method, url, body, { keepalive = false } = {}) {
  if (LOCAL) {
    const day = method === 'PUT' && /^\/api\/days\/(\d{4}-\d{2}-\d{2})$/.exec(url)?.[1];
    if (!day) return localRequest(method, url, body);
    noteDraft(day, body);
    const res = await localRequest(method, url, body);
    dropSaved(day, body);
    return res;
  }
  const opts = { method, headers: {}, keepalive };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401 && url !== '/api/login') {
    onUnauthorized();
    throw new Error('Session expirée');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error(data?.error || `Erreur ${res.status}`), { status: res.status });
  return data;
}

const fileForm = (blob, name, extra = {}) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  form.append('file', blob, name);
  return form;
};

export const api = {
  me: () => request('GET', '/api/me'),
  login: (password) => request('POST', '/api/login', { password }),
  logout: () => request('POST', '/api/logout'),

  listDays: (from, to) => request('GET', `/api/days?from=${from}&to=${to}`),
  getDay: (day) => request('GET', `/api/days/${day}`),
  saveDay: (day, patch, opts) => request('PUT', `/api/days/${day}`, patch, opts),
  dayEmpty: (day) => request('GET', `/api/days/${day}/empty`),
  moveDay: (day, to) => request('POST', `/api/days/${day}/move`, { to }),

  addTask: (day, text) => request('POST', `/api/days/${day}/tasks`, { text }),
  updateTask: (id, patch) => request('PATCH', `/api/tasks/${id}`, patch),
  deleteTask: (id) => request('DELETE', `/api/tasks/${id}`),

  listMediaPage: (kind, before) =>
    request('GET', `/api/media?kind=${kind}&limit=200${before ? `&before=${encodeURIComponent(before)}` : ''}`),
  // Récupère toutes les pages (quelques Ko de JSON par page ; les images restent chargées à la demande).
  async listMedia(kind) {
    const all = [];
    let before = null;
    do {
      const page = await api.listMediaPage(kind, before);
      all.push(...page.items);
      before = page.next;
    } while (before);
    return all;
  },
  uploadMedia: (day, kind, blob, name) => request('POST', `/api/days/${day}/media`, fileForm(blob, name, { kind })),
  saveDrawing: (id, blob) => request('PUT', `/api/media/${id}/drawing`, fileForm(blob, 'dessin.png')),
  updateMedia: (id, patch) => request('PATCH', `/api/media/${id}`, patch),
  deleteMedia: (id) => request('DELETE', `/api/media/${id}`),
  restoreMedia: (id) => request('POST', `/api/media/${id}/restore`),

  trashPage: (day, page) => request('POST', `/api/days/${day}/trash`, page),
  listTrash: () => request('GET', '/api/trash'),
  restoreTrash: (id) => request('POST', `/api/trash/${id}/restore`),
  deleteTrash: (id) => request('DELETE', `/api/trash/${id}`),
  deleteMediaForever: (id) => request('DELETE', `/api/media/${id}/forever`),
  emptyTrash: (pageIds, mediaIds) => request('POST', '/api/trash/empty', { pageIds, mediaIds }),

  // Sauvegardes
  listBackups: () => request('GET', '/api/backups'),
  createBackup: () => request('POST', '/api/backups'),
  backupUrl: (name) => `/api/backups/${encodeURIComponent(name)}`,
  // Téléphone : partager la sauvegarde (Drive, WhatsApp, clé USB…) au lieu d'un lien de téléchargement.
  shareBackup: async (name) => (await local()).localShareBackup(name),
  // Premier lancement : envoi d'une sauvegarde (peut être gros : XHR pour suivre l'envoi).
  restore(file, code, onProgress) {
    if (LOCAL) {
      onProgress?.(1);
      return localRequest('POST', '/api/restore', { fields: {}, file });
    }
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file, file.name);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/restore');
      if (code) xhr.setRequestHeader('X-Setup-Code', code.replace(/\s/g, ''));
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.upload.onload = () => onProgress?.(1);
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* réponse non JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data?.error || `Erreur ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Le journal ne répond pas.'));
      xhr.send(form);
    });
  },

  getSettings: () => request('GET', '/api/settings'),
  saveSettings: (settings) => request('PUT', '/api/settings', settings),
  setupPassword: (body) => request('POST', '/api/setup/password', body),
  changePassword: (current, next) => request('PUT', '/api/password', { current, next }),

  spellcheck: (text) => request('POST', '/api/spellcheck', { text }),
  addWord: (word) => request('POST', '/api/dictionary', { word }),
};

export const mediaUrl = (name) => (name ? `/media/${name}` : null);
