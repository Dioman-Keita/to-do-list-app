# Système de design

Référence pratique pour construire ou modifier une interface du journal. Le *pourquoi* est dans
[direction-artistique.md](direction-artistique.md). Tout le style vit dans
[`web/src/styles.css`](../../web/src/styles.css) (un seul fichier, organisé en sections
`/* ---------- Nom ---------- */`) ; les éléments décoratifs réutilisables dans
[`web/src/components/Decor.jsx`](../../web/src/components/Decor.jsx).

**Règle n° 1 : réutiliser avant de créer.** Une nouvelle interface s'assemble avec les briques
ci-dessous (page, étiquette déchirée, scotch, sticker, polaroïd, étoile). Si une brique manque,
la créer dans le même esprit et la documenter ici.

---

## 1. Couleurs

Variables CSS définies dans `:root` (`web/src/styles.css`). **Toujours utiliser la variable**, jamais la valeur.

| Variable | Valeur | Usage |
| --- | --- | --- |
| `--paper` | `#f3ead6` | Fond des pages |
| `--paper-light` | `#faf5e8` | Bouts de papier posés sur la page (étiquettes, tâches, champs) |
| `--paper-edge` | `#dccdab` | Bords, séparations discrètes |
| `--ink` | `#33302b` | Texte, contours encrés des boutons |
| `--ink-soft` | `#6f675b` | Texte secondaire, légendes, aides |
| `--pink` | `#ef6fa6` | Accent principal, focus clavier, aquarelle |
| `--blue` | `#5fbfe6` | Aquarelle, papillon |
| `--yellow` | `#f6df4f` | Étoiles, onglet actif, bouton/état actif, surligneur |
| `--orange` | `#f4a35a` | Aquarelle |
| `--line` | `#b4c6dc` | Lignes du papier |
| `--margin` | `#e9a0a0` | Ligne de marge rouge des feuilles |
| `--tape` | `rgba(238,224,180,.82)` | Scotch |
| `--desk` | `#1b222d` | Bureau (fond de l'appli, fenêtre de bureau) |
| `--cover-a` / `--cover-b` | selon la couverture | Couverture et tranche du carnet (posées par `applyCover()`) |

Couleurs récurrentes **pas encore en variable** (à tokeniser si on les réutilise) :

| Valeur | Usage |
| --- | --- |
| `#c43d78` | Encre rose foncé : « Chapitre N », liens au survol, sous-titre de couverture |
| `#f7a8c9` | Sticker rose (bouton principal d'une page) |
| `#9fd8f0` | Sticker bleu |
| `#fbfaf5` | Cadre blanc des polaroïds |
| `#b5302c` | Texte d'erreur (`.form-error`) |
| `#d6332b` / `#2f6fd6` | Soulignement ondulé : faute d'orthographe / de grammaire |
| `#11233d` | Contour du papillon |

**Couvertures** ([`web/src/lib/identity.js`](../../web/src/lib/identity.js)) — ajouter une ambiance =
une entrée dans `COVERS` côté front **et** son `id` dans `COVERS` côté serveur
([`server/src/routes.js`](../../server/src/routes.js)) :

| id | Libellé | `a` → `b` |
| --- | --- | --- |
| `nuit` | Nuit bleue (défaut) | `#47597a` → `#2d3a52` |
| `aube` | Aube rose | `#b0688d` → `#6d3a5a` |
| `foret` | Forêt de pins | `#55745f` → `#2d4435` |
| `tempete` | Tempête | `#6b5a86` → `#3a2f50` |
| `phare` | Coucher de soleil | `#d08b52` → `#8a4b3a` |

## 2. Typographie

| Variable | Police | Usage |
| --- | --- | --- |
| `--font-hand` | Patrick Hand | Tout le texte |
| `--font-title` | Gochi Hand | Titres, jour de la semaine, titre de la journée, chapitres, « A » de la barre d'outils |

- Polices auto-hébergées via Fontsource (`web/src/main.jsx`) ; jamais de Google Fonts en ligne.
- Tailles usuelles : corps 20 px (18 px sous 900 px), écriture du carnet 21 px, légendes 16–18 px,
  aides 14–16 px, titres de section (`.hand-title`) 30 px, jour de la semaine 28–34 px.
- `font-weight` reste à 400 : le gras manuscrit se fait avec la mise en forme du carnet, pas en CSS.
- Les emojis (stickers) utilisent une pile emoji dédiée (`'Segoe UI Emoji', 'Apple Color Emoji', …`).

## 3. Textures et matières

| Matière | Comment | Où |
| --- | --- | --- |
| Grain du papier | `background: var(--paper) var(--noise)` | `.page`, couvertures, bouts de papier |
| Feuille lignée | `linear-gradient(transparent 29px, var(--line) 29px)` en tuile de 30 px + marge rose à 38–40 px | `.journal-pages`, `.scrap` |
| Aquarelle | `<span class="blob">` : `radial-gradient` + `filter: url(#watercolor)` + `mix-blend-mode: multiply` + opacité 0,42 | `Page` dans `Decor.jsx` |
| Éclaboussures | petits ronds `.dot`, opacité 0,45 | `Page` |
| Papier déchiré | `clip-path: polygon(...)` en dents irrégulières + `drop-shadow` sur un parent | `.torn` / `TornLabel` |
| Scotch | `.tape` : rectangle `--tape` avec bords `clip-path` irréguliers, légère rotation | polaroïds, bouts de papier |
| Trait « fait main » | `filter="url(#rough)"` sur un SVG | icônes, étoiles, cases à cocher |

Les filtres SVG `#watercolor` et `#rough` sont déclarés une seule fois par `<SvgFilters />` (`App.jsx`).

⚠️ Préférer des **dégradés en tuile** (`background-size`) aux `repeating-linear-gradient` : ces
derniers créent des lignes manquantes ou pointillées à certains zooms.

## 4. Composants

| Composant | Fichier | À utiliser pour |
| --- | --- | --- |
| `Page` (`side`, `seed`) | `Decor.jsx` | Toute page du carnet. `seed` fixe le décor (une date, un nom d'onglet) |
| `TornLabel` | `Decor.jsx` | Titre d'une page (« Mercredi / 28 octobre », « Mes photos », « Paramètres ») |
| `Star` | `Decor.jsx` | Marquer l'actif / le spécial (onglet actif, aujourd'hui). Avec parcimonie |
| `Butterfly` | `Decor.jsx` | Unique, global. Ne pas en ajouter d'autres |
| Icônes griffonnées | `Icons.jsx` | Icônes d'onglets ; nouvelle icône = même `Doodle`, trait 2,2 px, `#rough` |
| `.sticker-btn` (+ `.pink`, `.blue`, `.plain`, `.danger`) | `styles.css` | Boutons d'action : bord `--ink` 2 px, ombre `2px 3px 0`, coins inégaux |
| `.sticker` | `styles.css` / `DayView.jsx` | Choix d'un emoji (humeur, météo) : rond de papier, actif = bord rose pointillé |
| `.ink-button` (web), `.link` (bureau) | `styles.css`, `desktop/renderer/setup.css` | Action secondaire : texte souligné à la main |
| `.scrap` + `.tape-top` | `styles.css` | Bout de papier ligné scotché (liste de tâches, formulaire) |
| `Polaroid` | `Polaroid.jsx` | Toute image : cadre blanc, scotch, inclinaison `tilt`, légende manuscrite |
| `.footer-strip` | `styles.css` | Navigation sous le carnet (jamais par-dessus les pages) |
| `.fmt-bar` / `.fmt` | `JournalEditor.jsx` | Barre de mise en forme du carnet |
| `.spell-menu`, `.toc` | `styles.css` | Petits menus flottants : papier, bord encré, ombre décalée |
| `CoverPreview`, `CoverChooser` | `IdentityForm.jsx` | Aperçu et choix de couverture |

Messages d'état : écrits **dans la page**, en `--ink-soft` (« enregistré ✓ ») ou `.form-error` pour
une erreur. Jamais de toast ni d'`alert()` (seule exception tolérée : la confirmation native
« Abandonner ce dessin ? »).

## 5. Mise en page

- **Carnet** : largeur max 1320 px ; hauteur `clamp(560px, 100dvh − 200px, 860px)` ; deux pages en
  grille + pli central. Sous **900 px** (seul point de rupture) : une page sous l'autre.
- **Marges des pages** : 36 px 44 px (24 px en haut sur la page d'écriture) ; 26 px 18 px sur mobile.
- **Rien ne recouvre une page** : la navigation est sous le carnet, les statuts hors du flux
  (`position: absolute`).

### Le carnet page par page (`JournalEditor.jsx`)

Invariants à ne jamais casser :

- Une **ligne = 30 px** (`LINE` en JS = `line-height` / tuile de fond en CSS). Tout bloc (paragraphe,
  chapitre de 2 lignes, texte « grand ») doit garder une hauteur multiple de 30 px.
- Une **page = une colonne CSS** de taille fixe (`column-count: 1`, hauteur arrondie à un nombre entier
  de lignes) ; la vue glisse par `scrollLeft`. **Jamais de défilement vertical** dans l'écriture.
- **La feuille ne bouge jamais pendant la frappe** : aucun élément au-dessus d'elle ne doit changer
  de taille (statut, barre d'outils, sommaire). Tout ajout près de la feuille doit avoir une hauteur fixe.
- Une **seule page vierge** à la fois ; les pages suivantes se créent en écrivant.

## 6. Mouvement

Bibliothèque : **Framer Motion**, enveloppée dans `<MotionConfig reducedMotion="user">`.

| Geste | Réglage de référence | Exemple |
| --- | --- | --- |
| Tourner une page / changer d'onglet | ressort `stiffness 140, damping 22`, `rotateY ±18°`, `x ±70` | `flip` dans `Journal.jsx` |
| Lâcher un polaroïd | ressort `260 / 20`, part de `y −40`, `rotate tilt−10`, décalage 0,05 s par élément | `Polaroid.jsx` |
| Coller une étiquette | ressort `200 / 18`, glisse de la gauche avec rotation | `TornLabel` |
| Faire « pop » une étoile | ressort `400 / 14`, `scale 0 → 1`, `rotate −40 → 0` | `Star` |
| Écrire une ligne | `clipPath: inset(0 100% 0 0) → inset(0 0 0 0)`, 0,9 s | `Onboarding.jsx` |
| Cocher / barrer | `pathLength 0 → 1`, 0,35–0,4 s | `TaskList.jsx` |
| Ouvrir une visionneuse | ressort `180 / 20`, part de `scale 0.7, rotate −10` | `MediaViewer.jsx` |
| Survol d'un objet | `y −6`, `rotate 0` (se redresse), `scale 1.03–1.05` | polaroïds, stickers |
| Papillon | traversée de 16 s, ailes 0,32 s, toutes les 35–80 s | `Butterfly` |

Règles :

- Ressorts plutôt que durées ; aucune animation en boucle visible en permanence (sauf le papillon,
  rare, et le « développement » d'un polaroïd pendant un envoi).
- Pas de fondu qui laisse un trou : remplacer un élément sur place (cf. `CoverPreview`).
- Rien ne bouge pendant que l'utilisateur écrit.
- Toute animation CSS a sa variante `@media (prefers-reduced-motion: reduce)`.

## 7. Écrans hors du navigateur

L'appli de bureau ([`desktop/renderer/`](../../desktop/renderer/)) reprend le même système dans un
fichier autonome (`setup.css`, polices embarquées) : bureau `--desk`, carte de papier lignée
scotchée, étoile, papillon d'attente. La barre de titre Windows est masquée et remplacée par une
zone de déplacement de 32 px en haut (`-webkit-app-region: drag`) : ne rien y placer de cliquable.

## 8. Checklist avant de livrer une interface

- [ ] Uniquement des variables de couleur et les deux polices manuscrites
- [ ] Construite avec les composants existants (page, étiquette, scotch, sticker, polaroïd)
- [ ] Au moins une petite imperfection volontaire (rotation, bord déchiré) — mais lisible
- [ ] Fonctionne sous 900 px (une page sous l'autre) et sur écran tactile (rien ne dépend du survol)
- [ ] Animations en ressort, `prefers-reduced-motion` respecté
- [ ] Rien ne bouge ni ne recouvre la page pendant l'écriture
- [ ] Textes en français, au ton du journal ([ton-et-textes.md](ton-et-textes.md))
- [ ] Vérifiée visuellement sur une **instance de démo** (jamais sur le journal réel de l'utilisateur)
