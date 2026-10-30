// Écran de connexion de l'application de bureau : premier lancement, attente du serveur,
// ou serveur injoignable.
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

async function fillForm() {
  const c = await window.desktop.getConfig();
  $('url').value = c.serverUrl;
  $('local').checked = Boolean(c.composeDir);
  $('dir').value = c.composeDir;
  $('local-box').hidden = !c.composeDir;
  $('autostart').checked = c.startWithWindows;
  $('autostart-box').hidden = !c.canAutostart;
  show('form');
  $('url').focus();
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
$('local').addEventListener('change', () => {
  $('local-box').hidden = !$('local').checked;
});
$('pick').addEventListener('click', async () => {
  const res = await window.desktop.pickFolder();
  if (!res) return;
  $('dir').value = res.dir;
  formStatus(res.valid ? '' : 'Ce dossier ne contient pas de docker-compose.yml.', res.valid ? '' : 'error');
});
$('test').addEventListener('click', async () => {
  formStatus('Je vérifie…');
  const res = await window.desktop.test($('url').value);
  if (res.error) formStatus(res.error, 'error');
  else formStatus(res.ok ? `Trouvé ✓ (${res.origin})` : 'Pas de journal à cette adresse pour l’instant.', res.ok ? 'ok' : 'error');
});
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('local').checked && !$('dir').value) return formStatus('Choisis le dossier du journal, ou décoche la case.', 'error');
  try {
    show('waiting');
    const ok = await window.desktop.save({
      serverUrl: $('url').value,
      composeDir: $('local').checked ? $('dir').value : '',
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
