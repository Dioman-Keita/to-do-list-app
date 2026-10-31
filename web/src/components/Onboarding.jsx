import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { applyCover } from '../lib/identity.js';
import { longDate, todayKey } from '../lib/date.js';
import { Page, Star, TornLabel } from './Decor.jsx';
import { CoverChooser, CoverPreview, IdentityFields, useIdentityForm } from './IdentityForm.jsx';

const INTRO = ['Cher journal…', 'Avant d’écrire ta première page,', 'il faut que je sache à qui tu appartiens.'];

// Première ouverture d'un journal neuf : le prénom, le titre et la couverture.
export default function Onboarding({ onDone }) {
  const form = useIdentityForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // La tranche du carnet prend la couleur choisie tout de suite.
  useEffect(() => applyCover(form.cover), [form.cover]);

  async function submit(e) {
    e.preventDefault();
    if (!form.valid) return;
    setBusy(true);
    setError('');
    try {
      onDone(await api.saveSettings(form.values()));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <motion.div className="app-shell" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
      <form className="notebook-wrap onboarding" onSubmit={submit}>
        <div className="notebook">
          <div className="spread">
            <div className="spread-inner">
              <Page side="left" seed="premier-jour">
                <header className="album-header">
                  <TornLabel tilt={-2}>
                    <span className="day-weekday">Premier jour</span>
                    <span className="day-date">{longDate(todayKey())}</span>
                  </TornLabel>
                  <Star size={36} delay={0.9} />
                </header>
                <div className="intro-lines">
                  {INTRO.map((line, i) => (
                    // Chaque ligne « s'écrit » de gauche à droite, comme à la main.
                    <motion.p
                      key={line}
                      initial={{ clipPath: 'inset(0 100% 0 0)' }}
                      animate={{ clipPath: 'inset(0 0% 0 0)' }}
                      transition={{ duration: 0.9, delay: 0.3 + i * 0.85, ease: 'easeInOut' }}
                    >
                      {line}
                    </motion.p>
                  ))}
                </div>
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.8 }}>
                  <IdentityFields form={form} autoFocus />
                </motion.div>
              </Page>
              <Page side="right" seed="premier-jour">
                <h2 className="hand-title">Choisis ta couverture</h2>
                <CoverPreview title={form.title} cover={form.cover} ownerName={form.ownerName} />
                <CoverChooser form={form} />
                {error && <p className="form-error">{error}</p>}
                <motion.button
                  type="submit"
                  className="sticker-btn pink open-journal"
                  disabled={!form.valid || busy}
                  whileHover={{ rotate: -2, scale: 1.04 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {busy ? 'J’ouvre…' : 'Ouvrir mon journal →'}
                </motion.button>
                <p className="identity-hint">Tu pourras tout changer plus tard dans l’onglet Paramètres.</p>
              </Page>
            </div>
          </div>
        </div>
      </form>
    </motion.div>
  );
}
