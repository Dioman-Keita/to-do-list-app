import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.js';

const size = (bytes) => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} Ko` : `${(bytes / 1e6).toFixed(1).replace('.', ',')} Mo`);
const when = (iso) =>
  new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

// Paramètres → Sauvegardes : une sauvegarde à la demande, la liste des dernières, et (dans
// l'application de bureau) le choix du dossier, par exemple un dossier OneDrive.
export default function BackupSection() {
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const desktop = window.journalDesktop;

  const load = () =>
    api
      .listBackups()
      .then(setInfo)
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  async function backupNow() {
    setStatus('saving');
    setError('');
    try {
      await api.createBackup();
      setStatus('saved');
      await load();
    } catch (err) {
      setStatus('');
      setError(`La sauvegarde a échoué : ${err.message}`);
    }
  }

  async function chooseDir() {
    setError('');
    try {
      if (await desktop.chooseBackupDir()) await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const latest = info?.items[0];
  return (
    <section className="backup-section">
      <h2 className="hand-title">Sauvegardes</h2>
      {info && (
        <p className="backup-where">
          {info.intervalHours > 0 ? `Toute seule toutes les ${info.intervalHours} h, ` : 'Seulement à la main, '}
          dans <code title={info.dir}>{info.dir}</code>
          {desktop?.chooseBackupDir && (
            <>
              {' '}
              <button type="button" className="link-button" onClick={chooseDir}>
                changer de dossier
              </button>
            </>
          )}
        </p>
      )}
      <div className="backup-actions">
        <motion.button type="button" className="sticker-btn blue" whileTap={{ scale: 0.95 }} disabled={status === 'saving' || info?.running} onClick={backupNow}>
          {status === 'saving' || info?.running ? 'Je photocopie le carnet…' : 'Faire une sauvegarde maintenant'}
        </motion.button>
        {status === 'saved' && latest && <span className="settings-saved">sauvegardé ✓</span>}
      </div>
      {info?.lastError && <p className="form-error">Dernière sauvegarde automatique ratée : {info.lastError.message}</p>}
      {error && <p className="form-error">{error}</p>}
      {info && !info.items.length && <p className="identity-hint">Aucune sauvegarde pour l’instant.</p>}
      {info?.items.length > 0 && (
        <ul className="backup-list">
          {info.items.slice(0, 5).map((b) => (
            <li key={b.name}>
              <span>{when(b.created)}</span>
              <small>{size(b.size)}</small>
              <a className="link-button" href={api.backupUrl(b.name)} download={b.name}>
                télécharger
              </a>
            </li>
          ))}
        </ul>
      )}
      {info && (
        <p className="identity-hint">
          Garde une copie ailleurs (clé USB, OneDrive…) : sur un autre ordinateur, l’application te proposera de la reprendre au
          premier lancement. Les sauvegardes de plus de {info.keepDays} jours sont rangées, les 5 dernières restent toujours.
        </p>
      )}
    </section>
  );
}
