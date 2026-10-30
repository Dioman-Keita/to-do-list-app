import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, mediaUrl } from '../lib/api.js';
import { addDays, isDayKey, todayKey } from '../lib/date.js';
import { Star } from './Decor.jsx';
import { IconBook, IconCalendar, IconCamera, IconPencil } from './Icons.jsx';
import DayView from './DayView.jsx';
import AlbumView from './AlbumView.jsx';
import CalendarView from './CalendarView.jsx';
import MediaViewer from './MediaViewer.jsx';
import DrawingEditor from './DrawingEditor.jsx';

const TABS = [
  { id: 'jour', label: 'Journal', Icon: IconBook },
  { id: 'photos', label: 'Photos', Icon: IconCamera },
  { id: 'croquis', label: 'Croquis', Icon: IconPencil },
  { id: 'calendrier', label: 'Calendrier', Icon: IconCalendar },
];
const TAB_ORDER = TABS.map((t) => t.id);
const NEW_SKETCH = { width: 1600, height: 1100 };

// Navigation par hash : #/jour/2026-10-27, #/photos, #/croquis, #/calendrier
function readHash() {
  const [, tab, day] = window.location.hash.split('/');
  if (TAB_ORDER.includes(tab)) return { tab, day: isDayKey(day) ? day : todayKey() };
  return { tab: 'jour', day: todayKey() };
}

const flip = {
  enter: (dir) => ({ opacity: 0, x: dir * 70, rotateY: dir * 18 }),
  center: { opacity: 1, x: 0, rotateY: 0, transition: { type: 'spring', stiffness: 140, damping: 22 } },
  exit: (dir) => ({ opacity: 0, x: dir * -70, rotateY: dir * -18, transition: { duration: 0.22, ease: 'easeIn' } }),
};

export default function Journal({ name, onLogout }) {
  const [{ tab, day }, setRoute] = useState(readHash);
  const [dir, setDir] = useState(1);
  const [viewer, setViewer] = useState(null);
  const [editor, setEditor] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback(
    (nextTab, nextDay = day) => {
      const sameTab = nextTab === tab;
      setDir(sameTab ? (nextDay >= day ? 1 : -1) : TAB_ORDER.indexOf(nextTab) >= TAB_ORDER.indexOf(tab) ? 1 : -1);
      const hash = nextTab === 'jour' ? `#/jour/${nextDay}` : `#/${nextTab}`;
      if (window.location.hash !== hash) window.history.pushState(null, '', hash);
      setRoute({ tab: nextTab, day: nextDay });
    },
    [tab, day]
  );

  const reload = () => setReloadKey((k) => k + 1);

  // Raccourcis : flèches gauche/droite pour changer de jour.
  useEffect(() => {
    const onKey = (e) => {
      if (tab !== 'jour' || viewer || editor) return;
      // Jamais pendant l'écriture : le carnet (contenteditable) n'est ni un INPUT ni un TEXTAREA.
      const active = document.activeElement;
      if (['INPUT', 'TEXTAREA'].includes(active?.tagName) || active?.isContentEditable) return;
      if (e.key === 'ArrowLeft') go('jour', addDays(day, -1));
      if (e.key === 'ArrowRight') go('jour', addDays(day, 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, day, viewer, editor, go]);

  function openEditorFor(media) {
    setViewer(null);
    setEditor(
      media.kind === 'photo'
        ? { media, baseSrc: mediaUrl(media.file), initialSrc: mediaUrl(media.overlay), width: media.width, height: media.height }
        : { media, initialSrc: mediaUrl(media.file), width: media.width, height: media.height }
    );
  }

  async function saveDrawing(blob) {
    if (editor.media) {
      const updated = await api.saveDrawing(editor.media.id, blob);
      setEditor(null);
      setViewer(updated);
    } else {
      await api.uploadMedia(editor.day, 'sketch', blob, 'croquis.png');
      setEditor(null);
    }
    reload();
  }

  const shared = { onOpenMedia: setViewer, reloadKey };

  return (
    <motion.div
      className="app-shell"
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      transition={{ type: 'spring', stiffness: 80, damping: 18 }}
    >
      <div className="notebook-wrap">
        <nav className="tabs" aria-label="Sections">
          {TABS.map(({ id, label, Icon }) => (
            <motion.button
              key={id}
              type="button"
              className={`tab ${tab === id ? 'active' : ''}`}
              onClick={() => go(id, id === 'jour' ? day : day)}
              animate={{ y: tab === id ? -6 : 0 }}
              whileHover={{ y: -8 }}
              aria-current={tab === id ? 'page' : undefined}
            >
              <Icon />
              <span>{label}</span>
              {tab === id && <Star className="tab-star" size={22} />}
            </motion.button>
          ))}
        </nav>

        <div className="notebook">
          <div className="spread">
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div
                key={tab === 'jour' ? `jour-${day}` : tab}
                className="spread-inner"
                custom={dir}
                variants={flip}
                initial="enter"
                animate="center"
                exit="exit"
              >
                {tab === 'jour' && (
                  <DayView
                    day={day}
                    {...shared}
                    onNewSketch={() => setEditor({ day, ...NEW_SKETCH })}
                  />
                )}
                {(tab === 'photos' || tab === 'croquis') && (
                  <AlbumView
                    kind={tab === 'photos' ? 'photo' : 'sketch'}
                    {...shared}
                    onNewSketch={() => setEditor({ day: todayKey(), ...NEW_SKETCH })}
                  />
                )}
                {tab === 'calendrier' && <CalendarView currentDay={day} onPickDay={(d) => go('jour', d)} />}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="notebook-footer">
            {tab === 'jour' ? (
              <div className="footer-strip footer-left">
                <button type="button" onClick={() => go('jour', addDays(day, -1))}>← Hier</button>
                <button type="button" onClick={() => go('jour', addDays(day, 1))}>Demain →</button>
              </div>
            ) : (
              <span />
            )}
            <div className="footer-strip footer-right">
              <button type="button" onClick={() => go('jour', todayKey())}>Aujourd’hui</button>
              <button type="button" onClick={onLogout}>Fermer</button>
            </div>
          </div>
        </div>
        <p className="journal-owner">{name}</p>
      </div>

      <AnimatePresence>
        {viewer && (
          <MediaViewer
            key={`viewer-${viewer.id}`}
            media={viewer}
            onClose={() => setViewer(null)}
            onChanged={(m) => {
              setViewer(m);
              reload();
            }}
            onDeleted={() => {
              setViewer(null);
              reload();
            }}
            onDraw={() => openEditorFor(viewer)}
            onGoToDay={tab !== 'jour' ? () => (setViewer(null), go('jour', viewer.day)) : null}
          />
        )}
        {editor && (
          <DrawingEditor
            key="editor"
            title={editor.media?.kind === 'photo' ? 'Annoter la photo' : 'Croquis'}
            baseSrc={editor.baseSrc}
            initialSrc={editor.initialSrc}
            width={editor.width}
            height={editor.height}
            onCancel={() => setEditor(null)}
            onSave={saveDrawing}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
