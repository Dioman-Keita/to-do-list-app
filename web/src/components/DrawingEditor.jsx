import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const COLORS = ['#2b2a28', '#2f5d9e', '#5fbfe6', '#c8423b', '#ef6fa6', '#f6df4f', '#f4a35a', '#4f9a62', '#ffffff'];
const SIZES = [2, 5, 10, 22];
const TOOLS = [
  { id: 'pen', label: 'Stylo' },
  { id: 'marker', label: 'Feutre', alpha: 0.4 },
  { id: 'eraser', label: 'Gomme' },
];
const MAX_SIDE = 2000;
const MAX_HISTORY = 15;

/**
 * Éditeur de dessin. Les traits sont sur un calque transparent : posé sur une photo
 * (annotation, l'original reste intact) ou sur du papier (croquis).
 */
export default function DrawingEditor({ title, baseSrc, initialSrc, width, height, onCancel, onSave }) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const W = Math.round(width * scale);
  const H = Math.round(height * scale);

  const mainRef = useRef(null);
  const previewRef = useRef(null);
  const stroke = useRef(null);
  const history = useRef([]);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(5);
  const [canUndo, setCanUndo] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initialSrc) return;
    const img = new Image();
    img.onload = () => mainRef.current?.getContext('2d').drawImage(img, 0, 0, W, H);
    img.src = initialSrc;
  }, [initialSrc, W, H]);

  function snapshot() {
    const copy = document.createElement('canvas');
    copy.width = W;
    copy.height = H;
    copy.getContext('2d').drawImage(mainRef.current, 0, 0);
    history.current.push(copy);
    if (history.current.length > MAX_HISTORY) history.current.shift();
    setCanUndo(true);
    setDirty(true);
  }

  function undo() {
    const prev = history.current.pop();
    if (!prev) return;
    const ctx = mainRef.current.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(prev, 0, 0);
    setCanUndo(history.current.length > 0);
  }

  function clearAll() {
    snapshot();
    mainRef.current.getContext('2d').clearRect(0, 0, W, H);
  }

  function point(e) {
    const r = mainRef.current.getBoundingClientRect();
    const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height, w: pressure * 2 * size * (W / r.width) };
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    snapshot();
    const isMarker = tool === 'marker';
    const ctx = (isMarker ? previewRef.current : mainRef.current).getContext('2d');
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (isMarker) previewRef.current.style.opacity = TOOLS[1].alpha;
    const p = point(e);
    const w = tool === 'eraser' ? p.w * 3 : isMarker ? p.w * 2.5 : p.w;
    ctx.beginPath();
    ctx.arc(p.x, p.y, w / 2, 0, Math.PI * 2);
    ctx.fill();
    stroke.current = { ctx, last: p, lastMid: p, widthFactor: w / p.w };
  }

  function onPointerMove(e) {
    const s = stroke.current;
    if (!s) return;
    const events = e.nativeEvent.getCoalescedEvents?.() || [e.nativeEvent];
    for (const ev of events) {
      const p = point(ev);
      const mid = { x: (s.last.x + p.x) / 2, y: (s.last.y + p.y) / 2 };
      s.ctx.lineWidth = p.w * s.widthFactor;
      s.ctx.beginPath();
      s.ctx.moveTo(s.lastMid.x, s.lastMid.y);
      s.ctx.quadraticCurveTo(s.last.x, s.last.y, mid.x, mid.y);
      s.ctx.stroke();
      s.last = p;
      s.lastMid = mid;
    }
  }

  function onPointerUp() {
    const s = stroke.current;
    if (!s) return;
    stroke.current = null;
    s.ctx.globalCompositeOperation = 'source-over';
    if (tool === 'marker') {
      // Le feutre est tracé opaque sur un calque, puis fusionné en transparence : pas de surépaisseurs.
      const main = mainRef.current.getContext('2d');
      main.globalAlpha = TOOLS[1].alpha;
      main.drawImage(previewRef.current, 0, 0);
      main.globalAlpha = 1;
      previewRef.current.getContext('2d').clearRect(0, 0, W, H);
    }
  }

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function cancel() {
    if (dirty && !window.confirm('Abandonner ce dessin ?')) return;
    onCancel();
  }

  function save() {
    setSaving(true);
    setError('');
    mainRef.current.toBlob(async (blob) => {
      try {
        await onSave(blob);
      } catch (err) {
        setError(err.message);
        setSaving(false);
      }
    }, 'image/png');
  }

  return (
    <motion.div className="editor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="editor-toolbar" initial={{ y: -40 }} animate={{ y: 0 }}>
        <span className="editor-title">{title}</span>
        <div className="tool-group">
          {TOOLS.map((t) => (
            <button key={t.id} type="button" className={`tool ${tool === t.id ? 'active' : ''}`} onClick={() => setTool(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="tool-group">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch ${color === c ? 'active' : ''}`}
              style={{ background: c }}
              aria-label={`Couleur ${c}`}
              onClick={() => {
                setColor(c);
                if (tool === 'eraser') setTool('pen');
              }}
            />
          ))}
        </div>
        <div className="tool-group">
          {SIZES.map((s) => (
            <button key={s} type="button" className={`size ${size === s ? 'active' : ''}`} aria-label={`Taille ${s}`} onClick={() => setSize(s)}>
              <span style={{ width: Math.max(4, s), height: Math.max(4, s) }} />
            </button>
          ))}
        </div>
        <div className="tool-group">
          <button type="button" className="tool" onClick={undo} disabled={!canUndo}>
            ↶ Annuler
          </button>
          <button type="button" className="tool" onClick={clearAll}>
            Tout effacer
          </button>
        </div>
        <div className="tool-group end">
          <button type="button" className="tool" onClick={cancel}>
            Fermer
          </button>
          <button type="button" className="tool primary" onClick={save} disabled={saving}>
            {saving ? 'Collage…' : 'Coller dans le journal'}
          </button>
        </div>
      </motion.div>
      {error && <p className="form-error editor-error">{error}</p>}

      <div className="editor-stage-wrap">
        <motion.div
          className={`editor-stage ${baseSrc ? '' : 'sketch-paper'}`}
          style={{ aspectRatio: `${W} / ${H}`, width: `min(96vw, calc((100dvh - 150px) * ${W / H}))` }}
          initial={{ scale: 0.9, rotate: -2 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 160, damping: 18 }}
        >
          {baseSrc && <img src={baseSrc} alt="" draggable={false} />}
          <canvas ref={mainRef} width={W} height={H} />
          <canvas
            ref={previewRef}
            width={W}
            height={H}
            className={`draw-surface tool-${tool}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </motion.div>
      </div>
    </motion.div>
  );
}
