import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { addDays, longDate, weekday } from '../lib/date.js';

// « Ce n'était pas le bon jour » : déplacer toute la journée vers un jour encore vide.
// `control()` donne la journée affichée : `release` enregistre ce qui est en cours et la gèle
// (sinon un enregistrement tardif recréerait la journée de départ), `thaw` la dégèle.
export default function MoveDay({ day, control, onMoved, onClose }) {
  const [to, setTo] = useState(addDays(day, -1));
  const [empty, setEmpty] = useState(null); // null = je regarde, true / false
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setEmpty(null);
    setError('');
    if (!to || to === day) return undefined;
    api
      .dayEmpty(to)
      .then((r) => alive && setEmpty(r.empty))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [to, day]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function move() {
    // La journée gelée par CE déplacement : c'est elle, et seulement elle, qu'on dégèlera.
    const released = control();
    if (!released) return setError('La journée n’est pas encore chargée.');
    setBusy(true);
    setError('');
    try {
      await released.release();
    } catch (err) {
      setError(err.message);
      return setBusy(false);
    }
    try {
      await api.moveDay(day, to);
      return onMoved(to);
    } catch (err) {
      if (err.status) {
        // Refus certain du serveur : rien n'a bougé.
        released.thaw();
        setError(err.message);
        return setBusy(false);
      }
      // Réponse perdue (réseau) : on regarde où est la journée avant de rien débloquer.
      try {
        if ((await api.dayEmpty(day)).empty) return onMoved(to);
        released.thaw();
        setError(`Le déplacement n’a pas eu lieu (${err.message}). Réessaie.`);
      } catch {
        setError('Je ne sais pas si la journée a été déplacée : recharge la page pour vérifier.');
      }
      setBusy(false);
    }
  }

  const status =
    !to || to === day
      ? 'Choisis un autre jour.'
      : empty === null
        ? 'je regarde ce jour-là…'
        : empty
          ? `Le ${weekday(to)} ${longDate(to)} est vide ✓`
          : `Le ${weekday(to)} ${longDate(to)} a déjà des choses écrites : je ne mélange pas deux journées.`;

  return (
    <motion.div
      className="move-day"
      role="dialog"
      aria-label="Déplacer cette journée"
      initial={{ opacity: 0, y: 10, rotate: -2 }}
      animate={{ opacity: 1, y: 0, rotate: -1 }}
      exit={{ opacity: 0, y: 10 }}
    >
      <span className="tape tape-top" />
      <label className="move-day-field">
        <span>Ce n’était pas le bon jour ? Tout déplacer au :</span>
        <input type="date" value={to} max="2999-12-31" onChange={(e) => setTo(e.target.value)} disabled={busy} autoFocus />
      </label>
      <p className={`move-day-status ${empty === false ? 'form-error' : ''}`} aria-live="polite">
        {status}
      </p>
      <p className="move-day-hint">Texte, humeurs, météo, tâches, photos et croquis partent ensemble.</p>
      {error && <p className="form-error">{error}</p>}
      <div className="move-day-actions">
        <button type="button" className="link-button" onClick={onClose} disabled={busy}>
          annuler
        </button>
        <motion.button type="button" className="sticker-btn pink" whileTap={{ scale: 0.95 }} disabled={busy || empty !== true} onClick={move}>
          {busy ? 'Je déplace…' : 'Déplacer la journée'}
        </motion.button>
      </div>
    </motion.div>
  );
}
