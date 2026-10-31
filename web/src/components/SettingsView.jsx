import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { Page, TornLabel } from './Decor.jsx';
import { CoverChooser, CoverPreview, IdentityFields, useIdentityForm } from './IdentityForm.jsx';

// Onglet Paramètres : changer son prénom, le titre et la couverture du journal.
export default function SettingsView({ currentTitle, onSaved }) {
  const [initial, setInitial] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    // Journal installé avant les Paramètres : on reprend le titre affiché jusqu'ici (JOURNAL_NAME).
    api
      .getSettings()
      .then((s) => setInitial({ ...s, title: s.title || (currentTitle !== 'Mon journal' ? currentTitle : '') }))
      .catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!initial) {
    return (
      <Page side="left" seed="parametres">
        {error && <p className="form-error">{error}</p>}
      </Page>
    );
  }
  return <SettingsForm initial={initial} onSaved={onSaved} />;
}

// Changer le mot de passe : l'ancien est demandé ; les autres appareils sont déconnectés.
function PasswordChange() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = current && next.length >= 8 && next === confirm;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setStatus('saving');
    setError('');
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setStatus('saved');
      setOpen(false);
    } catch (err) {
      setError(err.message);
      setStatus('');
    }
  }

  if (!open) {
    return (
      <div className="password-change">
        <button type="button" className="ink-button" onClick={() => setOpen(true)}>
          Changer le mot de passe
        </button>
        {status === 'saved' && <span className="settings-saved"> nouveau mot de passe noté ✓</span>}
      </div>
    );
  }
  return (
    <form className="password-change identity-fields" onSubmit={submit}>
      <label className="identity-field">
        <span>Le mot de passe actuel</span>
        <input type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label className="identity-field">
        <span>Le nouveau (au moins 8 caractères)</span>
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      <label className="identity-field">
        <span>{mismatch ? 'Les deux ne sont pas pareils…' : 'Encore une fois'}</span>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {error && <p className="form-error">{error}</p>}
      <p className="identity-hint">Tes autres appareils devront se reconnecter avec le nouveau mot de passe.</p>
      <div className="settings-actions">
        <button type="button" className="link-button" onClick={() => setOpen(false)}>
          Annuler
        </button>
        <motion.button type="submit" className="sticker-btn" disabled={!ready || status === 'saving'} whileTap={{ scale: 0.95 }}>
          {status === 'saving' ? 'Je change…' : 'Changer le mot de passe'}
        </motion.button>
      </div>
    </form>
  );
}

function SettingsForm({ initial, onSaved }) {
  const form = useIdentityForm(initial);
  const [saved, setSaved] = useState(initial); // dernière version enregistrée
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const values = form.values();
  const changed = values.ownerName !== saved.ownerName || values.title !== saved.title || values.cover !== saved.cover;

  async function submit(e) {
    e.preventDefault();
    if (!form.valid) return;
    setStatus('saving');
    setError('');
    try {
      const result = await api.saveSettings(values);
      setSaved(result);
      onSaved(result);
      setStatus('saved');
    } catch (err) {
      setError(err.message);
      setStatus('');
    }
  }

  return (
    <>
      <Page side="left" seed="parametres">
        <header className="album-header">
          <TornLabel tilt={-2}>
            <span className="day-weekday">Paramètres</span>
            <span className="day-date">ce carnet et moi</span>
          </TornLabel>
        </header>
        <form id="settings-form" onSubmit={submit}>
          <IdentityFields form={form} />
        </form>
        <PasswordChange />
      </Page>
      <Page side="right" seed="parametres">
        <h2 className="hand-title">La couverture</h2>
        <CoverPreview title={form.title} cover={form.cover} ownerName={form.ownerName} />
        <CoverChooser form={form} />
        {error && <p className="form-error">{error}</p>}
        <div className="settings-actions">
          <motion.button
            type="submit"
            form="settings-form"
            className="sticker-btn pink"
            disabled={!form.valid || !changed || status === 'saving'}
            whileTap={{ scale: 0.95 }}
          >
            {status === 'saving' ? 'J’enregistre…' : 'Enregistrer'}
          </motion.button>
          <AnimatePresence>
            {status === 'saved' && !changed && (
              <motion.span className="settings-saved" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                c’est noté ✓
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </Page>
    </>
  );
}
