let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

async function request(method, url, body, { keepalive = false } = {}) {
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
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
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

  getSettings: () => request('GET', '/api/settings'),
  saveSettings: (settings) => request('PUT', '/api/settings', settings),

  spellcheck: (text) => request('POST', '/api/spellcheck', { text }),
  addWord: (word) => request('POST', '/api/dictionary', { word }),
};

export const mediaUrl = (name) => (name ? `/media/${name}` : null);
