// Écran de connexion de l'application de bureau : premier lancement (journal sur ce PC ou sur
// un serveur), démarrage, ou serveur injoignable.
const $ = (id) => document.getElementById(id);
const mode = new URLSearchParams(location.search).get('mode') || 'connect';
let retryTimer = null;

function show(section) {
  $('waiting').hidden = section !== 'waiting';
  $('form').hidden = section !== 'form';
}

function setStatus({ message, state }) {
  $('status').textContent = message;
  $('status').className = state || '';
  $('waiting').classList.toggle('error', state === 'error');
  $('waiting-actions').hidden = state !== 'error';
}

async function connect() {
  clearTimeout(retryTimer);
  show('waiting');
  setStatus({ message: 'Je cherche ton journal…' });
  const ok = await window.desktop.connect();
  // Serveur injoignable : nouvel essai automatique toutes les 15 s.
  if (!ok) retryTimer = setTimeout(connect, 15000);
}

const remote = () => $('mode-remote').checked;

function syncMode() {
  $('url-box').hidden = !remote();
  $('test').hidden = !remote();
  formStatus('');
}

async function fillForm() {
  const c = await window.desktop.getConfig();
  $('url').value = c.serverUrl;
  $(c.mode === 'remote' ? 'mode-remote' : 'mode-local').checked = true;
  $('autostart').checked = c.startWithWindows;
  $('autostart-box').hidden = !c.canAutostart;
  syncMode();
  show('form');
}

function formStatus(text, kind = '') {
  $('form-status').textContent = text;
  $('form-status').className = kind;
}

window.desktop.onStatus(setStatus);

$('retry').addEventListener('click', connect);
$('edit').addEventListener('click', () => {
  clearTimeout(retryTimer);
  fillForm();
});
$('mode-local').addEventListener('change', syncMode);
$('mode-remote').addEventListener('change', syncMode);
$('test').addEventListener('click', async () => {
  formStatus('Je vérifie…');
  const res = await window.desktop.test($('url').value);
  if (res.error) formStatus(res.error, 'error');
  else formStatus(res.ok ? `Trouvé ✓ (${res.origin})` : 'Pas de journal à cette adresse pour l’instant.', res.ok ? 'ok' : 'error');
});
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (remote() && !$('url').value.trim()) return formStatus('Indique l’adresse du journal.', 'error');
  try {
    show('waiting');
    const ok = await window.desktop.save({
      mode: remote() ? 'remote' : 'local',
      serverUrl: $('url').value,
      startWithWindows: $('autostart').checked,
    });
    if (!ok) retryTimer = setTimeout(connect, 15000);
  } catch (err) {
    show('form');
    formStatus(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
  }
});

if (mode === 'first') fillForm();
else {
  if (mode === 'offline') setStatus({ message: 'Le journal ne répond plus. Je réessaie…' });
  connect();
}
