import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, mediaUrl } from '../lib/api.js';
import { longDate, shortDate } from '../lib/date.js';
import { Page, TornLabel } from './Decor.jsx';

const when = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

// La corbeille : les pages arrachées et les photos / croquis retirés. Rien n'y est jamais
// effacé (ni automatiquement, ni à la main) : on peut toujours recoller ou remettre.
export default function TrashView({ onPickDay, onRestoredMedia }) {
  const [trash, setTrash] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [restored, setRestored] = useState(null); // dernière page recollée : { day }

  useEffect(() => {
    api.listTrash().then(setTrash).catch((err) => setError(err.message));
  }, []);

  async function restorePage(item) {
    setBusy(`page-${item.id}`);
    setError('');
    try {
      const { day } = await api.restoreTrash(item.id);
      setTrash((t) => ({ ...t, pages: t.pages.filter((p) => p.id !== item.id) }));
      setRestored({ day });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function restoreMedia(m) {
    setBusy(`media-${m.id}`);
    setError('');
    try {
      await api.restoreMedia(m.id);
      setTrash((t) => ({ ...t, media: t.media.filter((x) => x.id !== m.id) }));
      onRestoredMedia();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const pages = trash?.pages || [];
  const media = trash?.media || [];

  return (
    <>
      <Page side="left" seed="corbeille">
        <header className="album-header">
          <TornLabel tilt={-2}>
            <span className="day-weekday">La corbeille</span>
            <span className="day-date">{trash ? `${pages.length} page${pages.length > 1 ? 's' : ''} arrachée${pages.length > 1 ? 's' : ''}` : '…'}</span>
          </TornLabel>
        </header>
        <p className="trash-hint">Rien ne s’efface tout seul ici : tout peut être recollé, même dans des années.</p>
        {error && <p className="form-error">{error}</p>}
        <AnimatePresence>
          {restored && (
            <motion.p className="trash-restored" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              Recollée dans la journée du {longDate(restored.day)} ✓{' '}
              <button type="button" className="link-button" onClick={() => onPickDay(restored.day)}>
                y aller →
              </button>
            </motion.p>
          )}
        </AnimatePresence>
        {trash && !pages.length && <p className="empty">Aucune page arrachée.</p>}
        <ul className="trash-pages">
          <AnimatePresence initial={false}>
            {pages.map((p, i) => (
              <motion.li
                key={p.id}
                className="trash-scrap"
                style={{ '--tilt': `${((p.id * 37) % 5) - 2}deg` }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.04 } }}
                exit={{ opacity: 0, x: -60, rotate: -6 }}
              >
                <div className="torn">
                  <p className="trash-meta">
                    {longDate(p.day)} <small>· arrachée le {when(p.created_at)}</small>
                  </p>
                  <p className="trash-preview">{p.preview || '(page sans texte)'}</p>
                  <div className="trash-actions">
                    <button type="button" className="link-button" onClick={() => onPickDay(p.day)}>
                      voir la journée
                    </button>
                    <motion.button
                      type="button"
                      className="sticker-btn"
                      whileTap={{ scale: 0.95 }}
                      disabled={busy === `page-${p.id}`}
                      onClick={() => restorePage(p)}
                    >
                      {busy === `page-${p.id}` ? 'Je recolle…' : 'Recoller'}
                    </motion.button>
                  </div>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Page>
      <Page side="right" seed="corbeille">
        <h2 className="hand-title">Photos et croquis retirés</h2>
        {trash && !media.length && <p className="empty">Aucune photo ni croquis retiré.</p>}
        <div className="trash-media">
          <AnimatePresence initial={false}>
            {media.map((m) => (
              <motion.figure
                key={m.id}
                className={`polaroid trash-polaroid ${m.kind === 'sketch' ? 'is-sketch' : ''}`}
                style={{ rotate: m.tilt }}
                exit={{ opacity: 0, y: -30, scale: 0.9 }}
              >
                <span className="polaroid-img">
                  <img src={mediaUrl(m.thumb)} alt="" loading="lazy" draggable={false} />
                  {m.overlay && <img className="overlay-img" src={mediaUrl(m.overlay)} alt="" loading="lazy" draggable={false} />}
                </span>
                <figcaption className="polaroid-caption">{m.caption || shortDate(m.day)}</figcaption>
                <button
                  type="button"
                  className="sticker-btn blue trash-putback"
                  disabled={busy === `media-${m.id}`}
                  onClick={() => restoreMedia(m)}
                  aria-label={`Remettre ${m.kind === 'sketch' ? 'le croquis' : 'la photo'} du ${shortDate(m.day)}`}
                >
                  Remettre
                </button>
              </motion.figure>
            ))}
          </AnimatePresence>
        </div>
      </Page>
    </>
  );
}
