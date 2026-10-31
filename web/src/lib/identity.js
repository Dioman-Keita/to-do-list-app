// Couvertures du journal : des ambiances d'aquarelle, de la nuit au coucher de soleil.
export const COVERS = [
  { id: 'nuit', label: 'Nuit bleue', a: '#47597a', b: '#2d3a52' },
  { id: 'aube', label: 'Aube rose', a: '#b0688d', b: '#6d3a5a' },
  { id: 'foret', label: 'Forêt de pins', a: '#55745f', b: '#2d4435' },
  { id: 'tempete', label: 'Tempête', a: '#6b5a86', b: '#3a2f50' },
  { id: 'phare', label: 'Coucher de soleil', a: '#d08b52', b: '#8a4b3a' },
];

export const coverById = (id) => COVERS.find((c) => c.id === id) || COVERS[0];

// « Journal de Max » / « Journal d’Anaïs » (élision devant une voyelle ou un h).
export function defaultTitle(name) {
  const n = name.trim();
  if (!n) return 'Mon journal';
  return /^[aeiouyhàâäéèêëîïôöûüœ]/i.test(n) ? `Journal d’${n}` : `Journal de ${n}`;
}

// Applique la couleur de couverture à toute l'appli (écran de connexion, tranche du carnet).
export function applyCover(id) {
  const c = coverById(id);
  const root = document.documentElement;
  root.style.setProperty('--cover-a', c.a);
  root.style.setProperty('--cover-b', c.b);
}
