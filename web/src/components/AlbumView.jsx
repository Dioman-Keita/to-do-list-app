import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { Page, TornLabel } from './Decor.jsx';
import Polaroid from './Polaroid.jsx';

const PER_PAGE = 4;

// Album photos / carnet de croquis : 4 polaroïds par page, comme un vrai album.
export default function AlbumView({ kind, onOpenMedia, onNewSketch, reloadKey }) {
  const [items, setItems] = useState(null);
  const [spread, setSpread] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listMedia(kind).then(setItems).catch((err) => setError(err.message));
  }, [kind, reloadKey]);

  const isPhoto = kind === 'photo';
  const list = items || [];
  const spreads = Math.max(1, Math.ceil(list.length / (PER_PAGE * 2)));
  const current = Math.min(spread, spreads - 1);
  const start = current * PER_PAGE * 2;
  const left = list.slice(start, start + PER_PAGE);
  const right = list.slice(start + PER_PAGE, start + PER_PAGE * 2);

  const grid = (subset, offset) => (
    <AnimatePresence mode="popLayout">
      <motion.div key={current} className="polaroid-grid album-grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        {subset.map((m, i) => (
          <Polaroid key={m.id} media={m} index={i + offset} showDate onClick={() => onOpenMedia(m)} />
        ))}
      </motion.div>
    </AnimatePresence>
  );

  return (
    <>
      <Page side="left" seed={`album-${kind}-${current}`}>
        <header className="album-header">
          <TornLabel tilt={-2}>
            <span className="day-weekday">{isPhoto ? 'Mes photos' : 'Mes croquis'}</span>
            <span className="day-date">
              {items ? `${list.length} souvenir${list.length > 1 ? 's' : ''}` : '…'}
            </span>
          </TornLabel>
          {!isPhoto && (
            <motion.button type="button" className="sticker-btn pink" whileHover={{ rotate: 3, scale: 1.05 }} onClick={onNewSketch}>
              + Nouveau croquis
            </motion.button>
          )}
        </header>
        {error && <p className="form-error">{error}</p>}
        {items && !list.length && (
          <p className="empty">
            {isPhoto ? 'Aucune photo pour l’instant… ajoute-en depuis une journée.' : 'Pas encore de croquis. Lance-toi !'}
          </p>
        )}
        {grid(left, 0)}
      </Page>
      <Page side="right" seed={`album-${kind}-${current}`}>
        {grid(right, PER_PAGE)}
        {spreads > 1 && (
          <div className="album-pager">
            <button type="button" disabled={current === 0} onClick={() => setSpread(current - 1)}>
              ← page précédente
            </button>
            <span>
              {current + 1} / {spreads}
            </span>
            <button type="button" disabled={current >= spreads - 1} onClick={() => setSpread(current + 1)}>
              page suivante →
            </button>
          </div>
        )}
      </Page>
    </>
  );
}
