import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig } from 'framer-motion';
import { api, setUnauthorizedHandler } from './lib/api.js';
import { Butterfly, SvgFilters } from './components/Decor.jsx';
import Journal from './components/Journal.jsx';
import Login from './components/Login.jsx';

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
          (auth.authed ? (
            <Journal key="journal" name={auth.name} onLogout={logout} />
          ) : (
            <Login key="login" name={auth.name} onLogin={() => setAuth((a) => ({ ...a, authed: true }))} />
          ))}
      </AnimatePresence>
    </MotionConfig>
  );
}
