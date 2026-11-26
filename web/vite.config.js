import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Deux versions du même front :
//  - par défaut : parle au serveur (Docker, application de bureau, VPS) ;
//  - mode « telephone » (VITE_LOCAL=1, voir .env.telephone) : le journal tourne dans la page
//    (src/local : PGlite, images, sauvegardes), pour l'application Android.
// En version serveur, src/local/server.js est remplacé par une coquille vide : ni PGlite ni son
// WebAssembly (≈ 15 Mo) ne partent avec.
const LOCAL_ENGINE = /[\\/]local[\\/]server\.js$/;

function withoutLocalEngine() {
  return {
    name: 'sans-moteur-telephone',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.endsWith('local/server.js')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && LOCAL_ENGINE.test(resolved.id) ? '\0moteur-telephone-absent' : null;
    },
    load(id) {
      if (id !== '\0moteur-telephone-absent') return null;
      return "const absent = () => { throw new Error('Mode serveur'); };\nexport const localRequest = absent;\nexport const localShareBackup = absent;\n";
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'telephone' ? [] : [withoutLocalEngine()])],
  // PGlite (mode téléphone) charge son WebAssembly lui-même.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
  server: {
    port: 5173,
    // Le mode téléphone importe le cœur du serveur (../server/src/core).
    fs: { allow: ['..'] },
    // Version serveur : l'API tourne à côté (port 3000). Version téléphone : tout est dans la page.
    proxy: mode === 'telephone' ? {} : { '/api': 'http://localhost:3000', '/media': 'http://localhost:3000' },
  },
}));
