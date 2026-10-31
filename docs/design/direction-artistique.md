# Direction artistique

> À lire avant toute modification visible de l'interface. Le *comment* (couleurs, composants, animations)
> est dans [systeme-de-design.md](systeme-de-design.md), le *ton des textes* dans [ton-et-textes.md](ton-et-textes.md).

## L'idée en une phrase

**Un vrai carnet intime posé sur un bureau, le soir** : papier crème, taches d'aquarelle, polaroïds
scotchés, écriture à la main, étoiles jaunes, et un papillon bleu qui passe de temps en temps.

L'interface ne doit jamais ressembler à une application web. Chaque élément est un **objet physique**
(une feuille, un bout de scotch, une photo, un sticker, une étiquette déchirée) plutôt qu'un widget.

## Inspiration — et sa limite

Le style s'inspire du journal de Max dans le jeu vidéo **Life is Strange** (Dontnod / Square Enix) :
carnet scrapbook, aquarelles pastel, écriture manuscrite, menus en onglets de papier.

C'est une **création de fan, non officielle**. Règles strictes :

- **Aucune ressource du jeu** : pas d'images, de captures, de polices, de sons, de logos, de noms de
  personnages ou de lieux du jeu dans l'interface, le code ou les données de démo.
- Tout est **recréé** en CSS, SVG ou dessiné à la main. Les polices sont libres (OFL).
- On reprend une *ambiance*, jamais un écran précis. Le crédit au jeu figure dans le README ; ne pas
  l'étendre à l'interface.

## Les cinq piliers

1. **Le papier d'abord.** Fond crème texturé (`--noise`), lignes bleu pâle, marge rose. Le contenu
   est *posé sur* le papier : ombres douces, légères rotations (−4° à +4°).
2. **L'imperfection voulue.** Rien n'est parfaitement droit ni parfaitement rond : bords déchirés,
   coins arrondis inégaux (`border-radius: 14px 10px 16px 9px`), filtre `#rough` sur les tracés SVG,
   taches d'aquarelle aux contours irréguliers (`#watercolor`).
3. **L'écriture à la main.** Deux polices manuscrites seulement : Patrick Hand (texte) et Gochi Hand
   (titres). Pas de police système visible, sauf pour les emojis.
4. **La couleur en aquarelle.** Rose, bleu ciel, jaune, orange, lilas — toujours dilués
   (opacité 0,35–0,6, `mix-blend-mode: multiply`). Les couleurs vives sont réservées aux petits
   accents (étoile jaune, sticker rose, encre rose foncé `#c43d78`).
5. **Le geste, pas l'effet.** Les animations imitent des gestes : une page qu'on tourne, une photo
   qu'on lâche, un sticker qu'on colle, une ligne qu'on écrit. Ressorts doux, jamais de fondu
   « corporate » ni de rebond exagéré.

## Le décor

```
┌──────────────────────── bureau sombre (--desk, dégradés flous) ───────────────────────┐
│   [Journal★] [Photos] [Croquis] [Calendrier] [Paramètres]   ← onglets en papier       │
│  ┌──────────────── couverture (tranche colorée --cover-a/--cover-b) ───────────────┐  │
│  │ ┌────────── page gauche ─────────┐┃┌────────── page droite ──────────┐          │  │
│  │ │ étiquette déchirée + étoile    │┃│ bout de papier scotché (tâches) │          │  │
│  │ │ stickers humeur / météo        │┃│ polaroïds inclinés + scotch     │          │  │
│  │ │ feuille lignée (une page = une │┃│ taches d'aquarelle, éclaboussures│         │  │
│  │ │ colonne, jamais de défilement) │┃│                                  │          │  │
│  │ └────────────────────────────────┘┃└──────────────────────────────────┘          │  │
│  └────────────────────────────── pli central ┃ ───────────────────────────────────┘  │
│   [← Hier  Demain →]                                        [Aujourd'hui  Fermer]    │
│                          bandes de papier SOUS le carnet                              │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Bureau** : bleu nuit presque noir, légèrement flou et vignetté. Il ne prend jamais la vedette.
- **Carnet** : double page sur ordinateur, une page sous l'autre sous 900 px de large.
- **Couverture** : une seule couleur choisie par l'utilisateur (cinq ambiances aquarelle), visible
  sur l'écran de connexion et sur la tranche du carnet.
- Chaque journée a ses propres taches d'aquarelle, générées à partir de la date (même jour = même
  décor, à chaque visite).

## Ce qu'on fait / ce qu'on ne fait pas

| ✅ Oui | ❌ Non |
| --- | --- |
| Étiquette en papier déchiré pour un titre | Bandeau plein écran, barre d'en-tête d'application |
| Bouton « sticker » (bord encré, ombre décalée) | Bouton plat bleu, bouton « material » |
| Petite étoile jaune qui « pop » pour un état spécial | Badge, pastille rouge de notification |
| Message écrit à la main dans la page (« enregistré ✓ ») | Toast, snackbar, modale d'alerte système |
| Rotation légère et irrégulière | Grille parfaitement alignée partout |
| Couleurs diluées, `multiply` | Aplats saturés, dégradés néon |
| Une page de carnet de taille fixe | Défilement infini, zone qui grandit et pousse le reste |
| Émojis comme stickers dans un rond de papier | Icônes d'une bibliothèque (Material, Font Awesome) |
| Icônes griffonnées au stylo en SVG (`Icons.jsx`) | Icônes au trait parfait et régulier |
| Un papillon bleu discret, rare | Confettis, particules, animations en boucle |

## Les grands moments de l'expérience

- **La couverture (connexion)** : un carnet fermé incliné, titre sur une étiquette déchirée,
  « Privé ! Ne pas lire… ». Le mot de passe s'écrit sur un bout de papier scotché.
- **Premier jour (première configuration)** : trois lignes qui s'écrivent à la main, puis le prénom,
  le titre et la couverture, avec un aperçu du carnet.
- **La journée** : la page qu'on ouvre tous les jours. Calme, lisible, rien ne bouge pendant
  l'écriture (règle absolue : la feuille ne doit jamais se déplacer pendant la frappe).
- **Les souvenirs** : polaroïds qui tombent et se « développent », annotations dessinées par-dessus.
- **La fenêtre de bureau (Electron)** : même bureau sombre, barre de titre fondue dans le décor.

## Accessibilité : non négociable

Le style ne passe jamais avant la lisibilité :

- Texte d'écriture ≥ 21 px, contraste encre/papier élevé (`--ink` sur `--paper`).
- Toutes les animations respectent `prefers-reduced-motion` (`MotionConfig reducedMotion="user"` +
  règles CSS dédiées).
- Les éléments décoratifs ont `aria-hidden="true"` ; les stickers ont un `title` et `aria-pressed`.
- Focus clavier visible (`outline: 2px dashed var(--pink)`), jamais supprimé sans remplacement.
- Sur écran tactile (`hover: none`), rien d'essentiel ne dépend du survol.
