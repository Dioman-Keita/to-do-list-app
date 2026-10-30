import { useState } from 'react';
import { motion } from 'framer-motion';
import { COVERS, coverById, defaultTitle } from '../lib/identity.js';
import { Star } from './Decor.jsx';

// État partagé par la première configuration et l'onglet Paramètres.
export function useIdentityForm(initial = {}) {
  const [ownerName, setOwnerName] = useState(initial.ownerName || '');
  const [title, setTitle] = useState(initial.title || '');
  const [titleTouched, setTitleTouched] = useState(Boolean(initial.title));
  const [cover, setCover] = useState(initial.cover || 'nuit');
  // Tant que le titre n'a pas été modifié à la main, il suit le prénom.
  const shownTitle = titleTouched ? title : defaultTitle(ownerName);
  return {
    ownerName,
    title: shownTitle,
    cover,
    valid: ownerName.trim().length > 0 && shownTitle.trim().length > 0,
    setOwnerName,
    setTitle: (t) => {
      setTitleTouched(true);
      setTitle(t);
    },
    setCover,
    values: () => ({ ownerName: ownerName.trim(), title: shownTitle.trim(), cover }),
  };
}

export function IdentityFields({ form, autoFocus = false }) {
  return (
    <div className="identity-fields">
      <label className="identity-field">
        <span>Je m’appelle…</span>
        <input
          value={form.ownerName}
          autoFocus={autoFocus}
          maxLength={40}
          placeholder="ton prénom"
          autoComplete="given-name"
          onChange={(e) => form.setOwnerName(e.target.value)}
        />
      </label>
      <label className="identity-field">
        <span>Et ce carnet s’appellera…</span>
        <input value={form.title} maxLength={60} onChange={(e) => form.setTitle(e.target.value)} />
      </label>
    </div>
  );
}

export function CoverChooser({ form }) {
  return (
    <div className="cover-chooser" role="radiogroup" aria-label="Couverture">
      {COVERS.map((c) => (
        <motion.button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={form.cover === c.id}
          className={`cover-swatch ${form.cover === c.id ? 'active' : ''}`}
          style={{ background: `linear-gradient(135deg, ${c.a}, ${c.b})` }}
          title={c.label}
          whileHover={{ rotate: -6, scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => form.setCover(c.id)}
        >
          <span>{c.label}</span>
        </motion.button>
      ))}
    </div>
  );
}

// Mini couverture : ce que l'on verra sur l'écran de connexion.
export function CoverPreview({ title, cover, ownerName }) {
  const c = coverById(cover);
  // Changement de couverture : remplacement immédiat avec un petit balancement (pas de fondu,
  // qui laissait un trou pendant la transition).
  return (
    <motion.div
      key={cover}
      className="cover-mini"
      style={{ background: `linear-gradient(135deg, ${c.a}, ${c.b})` }}
      initial={{ rotate: -7, y: 8, scale: 0.97 }}
      animate={{ rotate: -2, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 16 }}
    >
      <Star className="cover-mini-star" size={30} delay={0.2} />
      <span className="cover-sticker cover-sticker-1" />
      <span className="cover-sticker cover-sticker-2" />
      <div className="torn-wrap cover-mini-title">
        <div className="torn">
          <strong>{title || 'Mon journal'}</strong>
          <small>Privé ! Ne pas lire…{ownerName.trim() ? ` — ${ownerName.trim()}` : ''}</small>
        </div>
      </div>
    </motion.div>
  );
}
