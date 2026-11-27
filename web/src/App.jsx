import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { api, LOCAL, setUnauthorizedHandler } from './lib/api.js';
import { Butterfly, SvgFilters } from './components/Decor.jsx';
import Journal from './components/Journal.jsx';
import Login from './components/Login.jsx';
import Onboarding from './components/Onboarding.jsx';
import PasswordSetup from './components/PasswordSetup.jsx';
import RestoreBackup from './components/RestoreBackup.jsx';
import { applyCover } from './lib/identity.js';

export default function App() {
  const [auth, setAuth] = useState(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth((a) => ({ ...a, authed: false })));
    api
      .me()
      .then(setAuth)
      // Téléphone : le journal est dans l'application ; une erreur ici n'est pas « serveur injoignable ».
      .catch((err) => setAuth({ authed: false, name: 'Mon journal', startError: LOCAL ? err.message : '' }));
  }, []);

  useEffect(() => {
    if (auth?.name) document.title = auth.name;
  }, [auth?.name]);

  useEffect(() => {
    applyCover(auth?.cover);
  }, [auth?.cover]);

  // Après connexion : relire /api/me pour savoir si la première configuration est à faire.
  // En cas d'échec on reste sur la couverture (l'écran de connexion affiche l'erreur et permet
  // de réessayer) : ouvrir le journal sans cette information sauterait le « Premier jour ».
  const refresh = async () => {
    let me;
    try {
      me = await api.me();
    } catch {
      throw new Error('Le journal ne répond pas, réessaie dans un instant.');
    }
    if (!me.authed) throw new Error('La connexion n’a pas tenu, réessaie.');
    setAuth(me);
  };

  // Prénom, titre ou couverture enregistrés (première configuration ou Paramètres).
  const applySettings = (s) => setAuth((a) => ({ ...a, name: s.title, cover: s.cover, ownerName: s.ownerName, needsSetup: false }));

  async function logout() {
    await api.logout().catch(() => {});
    setAuth((a) => ({ ...a, authed: false }));
  }

  return (
    <MotionConfig reducedMotion="user">
      <SvgFilters />
      <div className="desk" aria-hidden="true" />
      <Butterfly />
      <AnimatePresence mode="wait">
        {auth &&
          (auth.needsPassword && restoring ? (
            <RestoreBackup
              key="restore"
              name={auth.name}
              codeRequired={auth.setupCodeRequired}
              onBack={() => setRestoring(false)}
              onDone={async () => {
                setRestoring(false);
                setAuth(await api.me().catch(() => ({ authed: false, name: 'Mon journal' })));
              }}
            />
          ) : auth.needsPassword ? (
            <PasswordSetup
              key="password"
              name={auth.name}
              codeRequired={auth.setupCodeRequired}
              onRestore={auth.canRestore ? () => setRestoring(true) : null}
              onDone={refresh}
            />
          ) : !auth.authed ? (
            <Login key="login" name={auth.name} startError={auth.startError} onLogin={refresh} />
          ) : auth.needsSetup ? (
            <Onboarding key="onboarding" onDone={applySettings} />
          ) : (
            <Journal key="journal" name={auth.name} onLogout={logout} onSettingsSaved={applySettings} />
          ))}
      </AnimatePresence>
    </MotionConfig>
  );
}
