import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api, mediaUrl } from '../lib/api.js';
import { longDate } from '../lib/date.js';

export default function MediaViewer({ media, onClose, onChanged, onDeleted, onDraw, onGoToDay }) {
  const [caption, setCaption] = useState(media.caption);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function saveCaption() {
    if (caption === media.caption) return;
    onChanged(await api.updateMedia(media.id, { caption }));
  }

  async function remove() {
    await api.deleteMedia(media.id);
    onDeleted();
  }

  const isSketch = media.kind === 'sketch';

  return (
    <motion.div className="overlay" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.figure
        className={`viewer polaroid-frame ${isSketch ? 'is-sketch' : ''}`}
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.7, rotate: -10, y: 60, opacity: 0 }}
        animate={{ scale: 1, rotate: media.tilt / 2, y: 0, opacity: 1 }}
        exit={{ scale: 0.8, rotate: 8, y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 180, damping: 20 }}
      >
        <span className="tape tape-top" />
        <div className="viewer-img" style={{ aspectRatio: `${media.width} / ${media.height}` }}>
          <img src={mediaUrl(media.file)} alt={caption} draggable={false} />
          {media.overlay && <img className="overlay-img" src={mediaUrl(media.overlay)} alt="" draggable={false} />}
        </div>
        <figcaption>
          <input
            className="viewer-caption"
            value={caption}
            placeholder="écrire une légende…"
            maxLength={200}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={saveCaption}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <span className="viewer-date">{longDate(media.day)}</span>
        </figcaption>
      </motion.figure>

      <motion.div className="viewer-actions" onClick={(e) => e.stopPropagation()} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }}>
        <button type="button" className="sticker-btn" onClick={onDraw}>
          ✎ {isSketch ? 'Continuer le dessin' : 'Dessiner dessus'}
        </button>
        {onGoToDay && (
          <button type="button" className="sticker-btn blue" onClick={onGoToDay}>
            Voir la journée
          </button>
        )}
        {confirmDelete ? (
          <button type="button" className="sticker-btn danger" onClick={remove}>
            Vraiment supprimer ?
          </button>
        ) : (
          <button type="button" className="sticker-btn pink" onClick={() => setConfirmDelete(true)}>
            Supprimer
          </button>
        )}
        <button type="button" className="sticker-btn plain" onClick={onClose}>
          Fermer
        </button>
      </motion.div>
    </motion.div>
  );
}
