import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';
import { Star } from './Decor.jsx';

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Premier lancement d'un journal vide : repartir d'une sauvegarde (.zip). Le serveur vérifie le
// fichier, recolle tout, compare les comptages, puis on se connecte avec l'ancien mot de passe.
export default function RestoreBackup({ name, codeRequired, onBack, onDone }) {
  const [file, setFile] = useState(null);
  const [code, setCode] = useState('');
  const [progress, setProgress] = useState(null); // null | 0..1 (envoi) | 'import'
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);

  const ready = file && (!codeRequired || code.replace(/\s/g, '').length === 6);

  function pick(f) {
    setError('');
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) return setError('Il faut le fichier .zip d’une sauvegarde du journal (journal_….zip).');
    setFile(f);
  }

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setError('');
    setProgress(0);
    try {
      const r = await api.restore(file, codeRequired ? code : undefined, (p) => setProgress(p < 1 ? p : 'import'));
      setResult(r);
    } catch (err) {
      setError(err.message);
      setProgress(null);
    }
  }

  const busy = progress !== null && !result;

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
            <p>On reprend là où tu t’étais arrêté…</p>
          </div>
        </div>

        {result ? (
          <div className="cover-form restore-done">
            <span className="tape tape-top" />
            <p className="restore-title">Te revoilà ! ✓</p>
            <p>
              {plural(result.counts.journees, 'journée', 'journées')}, {plural(result.counts.taches, 'tâche', 'tâches')},{' '}
              {plural(result.counts.medias, 'photo ou croquis', 'photos et croquis')} : tout est recollé.
            </p>
            <small className="cover-hint">Ton mot de passe est celui de l’ancien journal.</small>
            <motion.button className="ink-button" type="button" whileTap={{ scale: 0.95 }} onClick={onDone}>
              Ouvrir le journal →
            </motion.button>
          </div>
        ) : (
          <form className="cover-form" onSubmit={submit}>
            <span className="tape tape-top" />
            <label
              className={`restore-drop ${over ? 'over' : ''} ${file ? 'has-file' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                pick(e.dataTransfer.files[0]);
              }}
            >
              <input type="file" accept=".zip,application/zip" hidden disabled={busy} onChange={(e) => pick(e.target.files[0])} />
              {file ? (
                <>
                  <span className="restore-file">{file.name}</span>
                  <small>{(file.size / 1e6).toFixed(1).replace(".", ",")} Mo · clique pour en choisir une autre</small>
                </>
              ) : (
                <>
                  <span>Dépose ta sauvegarde ici</span>
                  <small>ou clique pour la choisir (journal_….zip)</small>
                </>
              )}
            </label>
            {codeRequired && (
              <>
                <label htmlFor="restore-code">Le code d’installation :</label>
                <input
                  id="restore-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="123 456"
                  value={code}
                  disabled={busy}
                  onChange={(e) => setCode(e.target.value)}
                />
              </>
            )}
            {busy && (
              <p className="restore-progress" aria-live="polite">
                {progress === 'import' ? 'Je recolle les pages…' : `J’envoie la sauvegarde… ${Math.round(progress * 100)} %`}
              </p>
            )}
            <motion.button className="ink-button" type="submit" disabled={!ready || busy} whileTap={{ scale: 0.95 }}>
              {busy ? 'Patience…' : 'Recoller mon journal →'}
            </motion.button>
            {error && (
              <motion.p className="form-error" initial={{ x: -8 }} animate={{ x: [8, -6, 4, 0] }}>
                {error}
              </motion.p>
            )}
            <button type="button" className="link-button restore-back" disabled={busy} onClick={onBack}>
              ← non, je commence un carnet tout neuf
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
