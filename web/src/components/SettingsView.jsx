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
        <p className="identity-hint">
          Le mot de passe se change dans le fichier <code>.env</code> du serveur (<code>APP_PASSWORD</code>).
        </p>
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
