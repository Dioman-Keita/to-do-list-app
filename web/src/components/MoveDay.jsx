import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { addDays, longDate, weekday } from '../lib/date.js';

// « Ce n'était pas le bon jour » : déplacer toute la journée vers un jour encore vide.
// `release` enregistre ce qui est en cours d'écriture et bloque les nouveaux enregistrements
// (sinon le texte arrivé après coup recréerait la journée de départ) ; `thaw` les débloque.
export default function MoveDay({ day, release, thaw, onMoved, onClose }) {
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
    setBusy(true);
    setError('');
    try {
      await release();
      await api.moveDay(day, to);
      onMoved(to);
    } catch (err) {
      thaw();
      setError(err.message);
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
