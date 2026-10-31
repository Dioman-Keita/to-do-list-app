import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { Star } from './Decor.jsx';

const MIN_LENGTH = 8;

// Tout premier lancement : choisir le mot de passe secret du journal.
// Si le journal est joignable depuis d'autres machines, le serveur exige aussi le code
// d'installation affiché dans ses journaux (docker compose logs app).
export default function PasswordSetup({ name, codeRequired, onDone }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= MIN_LENGTH && password === confirm && (!codeRequired || code.replace(/\s/g, '').length === 6);

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      await api.setupPassword({ password, code: codeRequired ? code : undefined });
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <motion.div
        className="cover"
        initial={{ opacity: 0, y: 60, rotate: -6, rotateY: -25 }}
        animate={{ opacity: 1, y: 0, rotate: -2, rotateY: 0 }}
        exit={{ opacity: 0, rotateY: -90, x: -200, transition: { duration: 0.6, ease: 'easeIn' } }}
        transition={{ type: 'spring', stiffness: 90, damping: 16 }}
      >
        <span className="cover-sticker cover-sticker-1" />
        <span className="cover-sticker cover-sticker-2" />
        <Star className="cover-star" delay={0.6} size={52} />
        <div className="torn-wrap cover-title">
          <div className="torn">
            <h1>{name}</h1>
            <p>Un carnet tout neuf…</p>
          </div>
        </div>
        <form className="cover-form" onSubmit={submit}>
          <span className="tape tape-top" />
          {codeRequired && (
            <>
              <label htmlFor="setup-code">Le code d’installation :</label>
              <input
                id="setup-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={7}
                placeholder="123 456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <small className="cover-hint">
                Il s’affiche sur le serveur : <code>docker compose logs app</code>
              </small>
            </>
          )}
          <label htmlFor="new-pw">Choisis ton mot de passe secret :</label>
          <input
            id="new-pw"
            type="password"
            autoFocus={!codeRequired}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label htmlFor="new-pw2">Encore une fois, pour être sûr :</label>
          <input
            id="new-pw2"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <small className={`cover-hint ${mismatch ? 'form-error' : ''}`}>
            {mismatch ? 'Les deux ne sont pas pareils…' : `Au moins ${MIN_LENGTH} caractères. Personne d’autre ne doit le connaître.`}
          </small>
          <motion.button className="ink-button" type="submit" disabled={busy || !ready} whileTap={{ scale: 0.95 }}>
            {busy ? 'Je ferme le cadenas…' : 'Fermer le cadenas →'}
          </motion.button>
          {error && (
            <motion.p className="form-error" initial={{ x: -8 }} animate={{ x: [8, -6, 4, 0] }}>
              {error}
            </motion.p>
          )}
        </form>
      </motion.div>
    </div>
  );
}
