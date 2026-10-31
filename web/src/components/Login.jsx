import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { Star } from './Decor.jsx';

export default function Login({ name, onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      await onLogin();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <motion.div
        className="cover"
        initial={{ opacity: 0, y: 60, rotate: -6, rotateY: -25 }}
        animate={{ opacity: 1, y: 0, rotate: -2, rotateY: 0 }}
        exit={{ opacity: 0, rotateY: -90, x: -200, transition: { duration: 0.6, ease: 'easeIn' } }}
        transition={{ type: 'spring', stiffness: 90, damping: 16 }}
      >
        <span className="cover-sticker cover-sticker-1" />
        <span className="cover-sticker cover-sticker-2" />
        <Star className="cover-star" delay={0.6} size={52} />
        <div className="torn-wrap cover-title">
          <div className="torn">
            <h1>{name}</h1>
            <p>Privé ! Ne pas lire…</p>
          </div>
        </div>
        <form className="cover-form" onSubmit={submit}>
          <span className="tape tape-top" />
          <label htmlFor="pw">Le mot de passe secret :</label>
          <input
            id="pw"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <motion.button className="ink-button" type="submit" disabled={busy || !password} whileTap={{ scale: 0.95 }}>
            {busy ? 'J’ouvre…' : 'Ouvrir le journal →'}
          </motion.button>
          {error && (
            <motion.p className="form-error" initial={{ x: -8 }} animate={{ x: [8, -6, 4, 0] }}>
              {error}
            </motion.p>
          )}
        </form>
      </motion.div>
    </div>
  );
}
