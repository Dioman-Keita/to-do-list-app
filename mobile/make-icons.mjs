// Génère les icônes et l'écran de démarrage Android : la couverture bleue à l'étoile jaune,
// comme l'application de bureau (desktop/build/make-icon.mjs). Utilise sharp, installé côté serveur :
//   node make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(path.join(here, '..', 'server', 'package.json'))('sharp');
const res = path.join(here, 'android', 'app', 'src', 'main', 'res');
const DESK = '#1b222d';

// Le carnet, dessiné sur 512 × 512.
const notebook = `
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
        fill="#f6df4f" stroke="#33302b" stroke-width="14" stroke-linejoin="round"/>`;

// Carnet centré, réduit à `scale` de la largeur, sur un fond optionnel.
const svg = (w, h, scale, background, round = false) => {
  const size = Math.min(w, h) * scale;
  const k = size / 512;
  const x = (w - size) / 2;
  const y = (h - size) / 2;
  const bg = background
    ? round
      ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2}" fill="${background}"/>`
      : `<rect width="${w}" height="${h}" fill="${background}"/>`
    : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${bg}<g transform="translate(${x} ${y}) scale(${k})">${notebook}</g></svg>`
  );
};

const write = (file, buf) => sharp(buf).png({ compressionLevel: 9 }).toFile(file);

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  const dir = path.join(res, `mipmap-${d}`);
  const icon = Math.round(48 * k);
  const fg = Math.round(108 * k);
  await write(path.join(dir, 'ic_launcher.png'), svg(icon, icon, 0.86, DESK));
  await write(path.join(dir, 'ic_launcher_round.png'), svg(icon, icon, 0.72, DESK, true));
  // Icône adaptative : le dessin reste dans la zone sûre (66/108 du côté).
  await write(path.join(dir, 'ic_launcher_foreground.png'), svg(fg, fg, 0.58, null));
}

fs.writeFileSync(
  path.join(res, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${DESK}</color>\n</resources>\n`
);

// Écrans de démarrage : le bureau sombre et le carnet au milieu, à la taille de chaque image existante.
for (const dir of fs.readdirSync(res).filter((d) => d.startsWith('drawable'))) {
  const file = path.join(res, dir, 'splash.png');
  if (!fs.existsSync(file)) continue;
  const { width, height } = await sharp(fs.readFileSync(file)).metadata();
  await write(file, svg(width, height, 0.32, DESK));
}
console.log('Icônes et écrans de démarrage générés');
