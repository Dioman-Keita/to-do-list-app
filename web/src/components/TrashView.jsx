import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, mediaUrl } from '../lib/api.js';
import { longDate, shortDate } from '../lib/date.js';
import { Page, TornLabel } from './Decor.jsx';

const when = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

// La corbeille : les pages arrachées et les photos / croquis retirés. Elle ne se vide jamais
// toute seule ; effacer pour toujours se fait élément par élément (ou « Vider »), après confirmation.
export default function TrashView({ onPickDay, onRestoredMedia }) {
  const [trash, setTrash] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [restored, setRestored] = useState(null); // dernière page recollée : { day }
  const [confirm, setConfirm] = useState(null); // 'page-ID' | 'media-ID' | 'all'
  const shown = useRef({ pageIds: [], mediaIds: [] }); // ce que « Vider » effacera : ce qui était affiché

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

  async function erase(key, action, update) {
    setBusy(key);
    setError('');
    try {
      await action();
      setTrash(update);
      setConfirm(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const erasePage = (p) =>
    erase(`page-${p.id}`, () => api.deleteTrash(p.id), (t) => ({ ...t, pages: t.pages.filter((x) => x.id !== p.id) }));
  const eraseMedia = (m) =>
    erase(`media-${m.id}`, () => api.deleteMediaForever(m.id), (t) => ({ ...t, media: t.media.filter((x) => x.id !== m.id) }));
  const eraseAll = () => {
    const { pageIds, mediaIds } = shown.current;
    erase(
      'all',
      () => api.emptyTrash(pageIds, mediaIds),
      (t) => ({ pages: t.pages.filter((p) => !pageIds.includes(p.id)), media: t.media.filter((m) => !mediaIds.includes(m.id)) })
    );
  };
  const askEmpty = () => {
    shown.current = { pageIds: pages.map((p) => p.id), mediaIds: media.map((m) => m.id) };
    setConfirm('all');
  };

  // Petit bout de papier « Effacer pour toujours ? oui / non » (même style que l'arrachage).
  const ask = (key, label, onYes) =>
    confirm === key ? (
      <span className="trash-confirm" role="alertdialog" aria-label={label}>
        {label}
        <button type="button" className="link-button danger-link" disabled={busy === key} onClick={onYes}>
          {busy === key ? 'j’efface…' : 'oui, effacer'}
        </button>
        <button type="button" className="link-button" onClick={() => setConfirm(null)}>
          non
        </button>
      </span>
    ) : null;

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
          {pages.length + media.length > 0 && confirm !== 'all' && (
            <motion.button type="button" className="sticker-btn plain" whileTap={{ scale: 0.95 }} onClick={askEmpty}>
              Vider la corbeille
            </motion.button>
          )}
        </header>
        {ask('all', `Tout effacer pour toujours (${pages.length + media.length}) ?`, eraseAll)}
        <p className="trash-hint">Rien ne s’efface tout seul ici : seulement si tu le décides. Effacé, c’est pour toujours.</p>
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
                  {ask(`page-${p.id}`, 'Effacer cette page pour toujours ?', () => erasePage(p))}
                  <div className="trash-actions">
                    <button type="button" className="link-button trash-erase" onClick={() => setConfirm(`page-${p.id}`)}>
                      effacer
                    </button>
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
                {confirm === `media-${m.id}` ? (
                  ask(`media-${m.id}`, 'Pour toujours ?', () => eraseMedia(m))
                ) : (
                  <button type="button" className="link-button trash-erase" onClick={() => setConfirm(`media-${m.id}`)}>
                    effacer
                  </button>
                )}
              </motion.figure>
            ))}
          </AnimatePresence>
        </div>
      </Page>
    </>
  );
}
