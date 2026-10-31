// Génère build/icon.png (512 px) : l'étoile jaune du journal sur une couverture bleue.
// Utilise sharp, déjà installé côté serveur : node build/make-icon.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(path.join(here, '..', '..', 'server', 'package.json'))('sharp');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="c" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#47597a"/><stop offset="1" stop-color="#2d3a52"/>
    </linearGradient>
  </defs>
  <rect x="56" y="24" width="400" height="464" rx="34" fill="url(#c)"/>
  <rect x="56" y="24" width="44" height="464" rx="20" fill="#000" opacity=".2"/>
  <circle cx="150" cy="410" r="38" fill="#f6df4f" stroke="#fff" stroke-opacity=".5" stroke-width="10"/>
  <circle cx="206" cy="370" r="22" fill="#ef6fa6"/>
  <path d="M290 92l38 78 86 12-62 61 15 86-77-41-77 41 15-86-62-61 86-12z"
        fill="#f6df4f" stroke="#33302b" stroke-width="14" stroke-linejoin="round"/>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile(path.join(here, 'icon.png'));
console.log('build/icon.png généré');
