import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { longDate, todayKey, weekday } from '../lib/date.js';
import { Page, Star, TornLabel } from './Decor.jsx';
import Polaroid from './Polaroid.jsx';
import TaskList from './TaskList.jsx';
import JournalEditor from './JournalEditor.jsx';

export const MOODS = [
  { id: 'joie', emoji: '😄', label: 'Joyeux' },
  { id: 'amour', emoji: '🥰', label: 'Amoureux' },
  { id: 'calme', emoji: '😌', label: 'Serein' },
  { id: 'bof', emoji: '😐', label: 'Bof' },
  { id: 'triste', emoji: '😢', label: 'Triste' },
  { id: 'colere', emoji: '😠', label: 'En colère' },
  { id: 'fatigue', emoji: '😴', label: 'Fatigué' },
  { id: 'reveur', emoji: '😶‍🌫️', label: 'Dans les nuages' },
];
const WEATHER = [
  { id: 'soleil', emoji: '☀️', label: 'Soleil' },
  { id: 'nuages', emoji: '⛅', label: 'Nuageux' },
  { id: 'pluie', emoji: '🌧️', label: 'Pluie' },
  { id: 'orage', emoji: '⛈️', label: 'Orage' },
  { id: 'neige', emoji: '❄️', label: 'Neige' },
  { id: 'brume', emoji: '🌫️', label: 'Brume' },
];

export default function DayView({ day, onOpenMedia, onNewSketch, reloadKey }) {
  const [entry, setEntry] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [media, setMedia] = useState([]);
  const [uploading, setUploading] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(null);
  const timer = useRef(null);
  const fileInput = useRef(null);
  const firstLoad = useRef(true);

  useEffect(() => {
    api
      .getDay(day)
      .then((data) => {
        setEntry(data.entry);
        setTasks(data.tasks);
        setMedia(data.media);
      })
      .catch((err) => setError(err.message));
  }, [day]);

  // Après un dessin/une suppression ailleurs : ne recharger que les images, pas le texte en cours.
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    api.getDay(day).then((data) => setMedia(data.media)).catch(() => {});
  }, [reloadKey, day]);

  async function flush(keepalive = false) {
    clearTimeout(timer.current);
    const patch = pending.current;
    if (!patch) return;
    pending.current = null;
    setStatus('saving');
    try {
      await api.saveDay(day, patch, { keepalive });
      setStatus('saved');
    } catch {
      pending.current = { ...patch, ...pending.current };
      setStatus('error');
    }
  }

  // `display: false` : le texte vit dans l'éditeur, inutile de re-rendre la page à chaque frappe.
  function patchEntry(patch, { display = true } = {}) {
    if (display) setEntry((e) => ({ ...e, ...patch }));
    pending.current = { ...pending.current, ...patch };
    setStatus('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  }

  // Ne rien perdre en changeant de page ou en fermant l'onglet.
  useEffect(() => {
    const onHide = () => flush(true);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flush(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function uploadFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const created = await api.uploadMedia(day, 'photo', file, file.name);
        setMedia((m) => [...m, created]);
      } catch (err) {
        setError(`${file.name} : ${err.message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  if (error && !entry) return <Page side="left" seed={day}><p className="empty">{error}</p></Page>;
  if (!entry) return <Page side="left" seed={day} />;

  const isToday = day === todayKey();
  const toggleMood = (id) =>
    patchEntry({ moods: entry.moods.includes(id) ? entry.moods.filter((m) => m !== id) : [...entry.moods, id] });

  return (
    <>
      <Page side="left" seed={day} className="page-writing">
        <header className="day-header">
          <TornLabel tilt={-2}>
            <span className="day-weekday">{weekday(day)}</span>
            <span className="day-date">{longDate(day)}</span>
          </TornLabel>
          {isToday && <Star className="day-star" size={36} delay={0.4} />}
          <div className="day-stickers">
            <div className="stickers" role="group" aria-label="Humeurs (plusieurs possibles)">
              {MOODS.map((m) => (
                <StickerButton key={m.id} item={m} active={entry.moods.includes(m.id)} onClick={() => toggleMood(m.id)} />
              ))}
            </div>
            <div className="stickers stickers-small" role="group" aria-label="Météo">
              {WEATHER.map((w) => (
                <StickerButton key={w.id} item={w} active={entry.weather === w.id} onClick={() => patchEntry({ weather: entry.weather === w.id ? null : w.id })} />
              ))}
            </div>
          </div>
        </header>

        <input
          className="entry-title"
          value={entry.title}
          placeholder="Le titre de ma journée…"
          maxLength={120}
          onChange={(e) => patchEntry({ title: e.target.value })}
          onBlur={() => flush()}
        />
        <JournalEditor
          content={entry.content}
          legacyBody={entry.body}
          isToday={isToday}
          status={status}
          onChange={(content, text) => patchEntry({ content, content_text: text }, { display: false })}
        />
      </Page>

      <Page side="right" seed={day}>
        <TaskList day={day} tasks={tasks} setTasks={setTasks} />

        <div className="memories-head">
          <h2 className="hand-title">Souvenirs</h2>
          <div className="memories-actions">
            <motion.button type="button" className="sticker-btn" whileHover={{ rotate: -3, scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => fileInput.current.click()}>
              + Photo
            </motion.button>
            <motion.button type="button" className="sticker-btn pink" whileHover={{ rotate: 3, scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={onNewSketch}>
              + Croquis
            </motion.button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {error && <p className="form-error" onClick={() => setError('')}>{error}</p>}

        <div
          className="polaroid-grid"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            uploadFiles(e.dataTransfer.files);
          }}
        >
          <AnimatePresence>
            {media.map((m, i) => (
              <Polaroid key={m.id} media={m} index={i} onClick={() => onOpenMedia(m)} />
            ))}
            {Array.from({ length: uploading }, (_, i) => (
              <Polaroid key={`up-${i}`} media={{ kind: 'photo' }} />
            ))}
          </AnimatePresence>
          {!media.length && !uploading && <p className="empty">Glisse des photos ici, ou dessine quelque chose…</p>}
        </div>
      </Page>
    </>
  );
}

function StickerButton({ item, active, onClick }) {
  return (
    <motion.button
      type="button"
      className={`sticker ${active ? 'active' : ''}`}
      title={item.label}
      aria-pressed={active}
      onClick={onClick}
      whileHover={{ scale: 1.15, rotate: -6 }}
      whileTap={{ scale: 0.9 }}
      animate={active ? { scale: [1, 1.3, 1.1], rotate: [0, 12, -4] } : { scale: 1, rotate: 0 }}
    >
      {item.emoji}
    </motion.button>
  );
}
