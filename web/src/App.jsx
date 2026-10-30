import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { api, setUnauthorizedHandler } from './lib/api.js';
import { Butterfly, SvgFilters } from './components/Decor.jsx';
import Journal from './components/Journal.jsx';
import Login from './components/Login.jsx';
import Onboarding from './components/Onboarding.jsx';
import { applyCover } from './lib/identity.js';

export default function App() {
  const [auth, setAuth] = useState(null);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth((a) => ({ ...a, authed: false })));
    api
      .me()
      .then(setAuth)
      .catch(() => setAuth({ authed: false, name: 'Mon journal' }));
  }, []);

  useEffect(() => {
    if (auth?.name) document.title = auth.name;
  }, [auth?.name]);

  useEffect(() => {
    applyCover(auth?.cover);
  }, [auth?.cover]);

  // Après connexion : relire /api/me pour savoir si la première configuration est à faire.
  const refresh = () =>
    api
      .me()
      .then(setAuth)
      .catch(() => setAuth((a) => ({ ...a, authed: true })));

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
          (!auth.authed ? (
            <Login key="login" name={auth.name} onLogin={refresh} />
          ) : auth.needsSetup ? (
            <Onboarding key="onboarding" onDone={applySettings} />
          ) : (
            <Journal key="journal" name={auth.name} onLogout={logout} onSettingsSaved={applySettings} />
          ))}
      </AnimatePresence>
    </MotionConfig>
  );
}
