import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { api, mediaUrl } from '../lib/api.js';
import { fromKey, monthLabel, toKey, todayKey } from '../lib/date.js';
import { Page, TornLabel } from './Decor.jsx';
import { MOODS } from './DayView.jsx';

const WEEKDAYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const moodEmoji = (id) => MOODS.find((m) => m.id === id)?.emoji;

export default function CalendarView({ currentDay, onPickDay }) {
  const [month, setMonth] = useState(() => {
    const d = fromKey(currentDay);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [days, setDays] = useState([]);
  const [loadError, setLoadError] = useState('');

  const cells = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7; // semaine qui commence le lundi
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => toKey(new Date(month.getFullYear(), month.getMonth(), i + 1)))];
  }, [month]);

  useEffect(() => {
    // Ignorer la réponse d'un mois quitté entre-temps (navigation rapide).
    let current = true;
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    setLoadError('');
    api
      .listDays(toKey(month), toKey(last))
      .then((d) => current && setDays(d))
      .catch((err) => {
        if (!current) return;
        setDays([]);
        setLoadError(err.message);
      });
    return () => {
      current = false;
    };
  }, [month]);

  const byDay = Object.fromEntries(days.map((d) => [d.day, d]));
  const today = todayKey();
  const shift = (n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <>
      <Page side="left" seed={`cal-${toKey(month)}`}>
        <header className="album-header">
          <TornLabel tilt={-1.5}>
            <span className="day-weekday">{monthLabel(month)}</span>
          </TornLabel>
          <div className="month-nav">
            <button type="button" onClick={() => shift(-1)} aria-label="Mois précédent">←</button>
            <button type="button" onClick={() => shift(1)} aria-label="Mois suivant">→</button>
          </div>
        </header>
        <div className="calendar">
          {WEEKDAYS.map((w) => (
            <span key={w} className="cal-head">{w}</span>
          ))}
          {cells.map((key, i) =>
            key ? (
              <motion.button
                key={key}
                type="button"
                className={`cal-day ${byDay[key] ? 'filled' : ''} ${key === today ? 'today' : ''}`}
                onClick={() => onPickDay(key)}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.012 }}
                whileHover={{ scale: 1.12, rotate: -4 }}
              >
                <span>{fromKey(key).getDate()}</span>
                {byDay[key] && (
                  <svg className="cal-circle" viewBox="0 0 60 60" aria-hidden="true">
                    <motion.path
                      d="M30 5 C 50 4, 57 20, 55 32 C 53 48, 38 56, 26 55 C 10 53, 3 40, 6 25 C 9 12, 22 6, 36 8"
                      fill="none"
                      stroke="#ef6fa6"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.6, delay: 0.2 + i * 0.015 }}
                    />
                  </svg>
                )}
                {moodEmoji(byDay[key]?.mood) && <span className="cal-mood">{moodEmoji(byDay[key].mood)}</span>}
              </motion.button>
            ) : (
              <span key={`e${i}`} />
            )
          )}
        </div>
      </Page>

      <Page side="right" seed={`cal-${toKey(month)}`}>
        <h2 className="hand-title">Ce mois-ci</h2>
        {loadError && <p className="form-error">Impossible de charger ce mois : {loadError}</p>}
        {!days.length && !loadError && <p className="empty">Rien d’écrit ce mois-là… pour l’instant.</p>}
        <ul className="month-list">
          {days.map((d, i) => (
            <motion.li key={d.day} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
              <button type="button" onClick={() => onPickDay(d.day)}>
                {d.cover ? <img src={mediaUrl(d.cover)} alt="" loading="lazy" /> : <span className="month-list-num">{fromKey(d.day).getDate()}</span>}
                <span className="month-list-text">
                  <strong>
                    {fromKey(d.day).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })} {moodEmoji(d.mood)}
                  </strong>
                  <span>{d.title || 'sans titre'}</span>
                  <small>
                    {[d.tasks > 0 && `${d.done}/${d.tasks} tâches`, d.media > 0 && `${d.media} image${d.media > 1 ? 's' : ''}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
              </button>
            </motion.li>
          ))}
        </ul>
      </Page>
    </>
  );
}
