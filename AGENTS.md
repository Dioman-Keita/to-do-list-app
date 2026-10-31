# Guide pour les agents

Journal intime auto-hébergé au style « carnet aquarelle », inspiré du journal de Life is Strange
(création de fan, non officielle). Lire ce fichier avant toute modification.

## Avant de toucher à l'interface

**Obligatoire** : lire [`docs/design/`](docs/design/README.md) —
[direction artistique](docs/design/direction-artistique.md),
[système de design](docs/design/systeme-de-design.md),
[ton et textes](docs/design/ton-et-textes.md).
Toute nouvelle interface doit ressembler à un objet de carnet (papier, scotch, sticker, polaroïd),
jamais à une application web générique. Réutiliser les composants et variables existants ;
mettre à jour `docs/design/` dans la même PR si on en ajoute.

Interdit : toute ressource du jeu (images, polices, sons, noms) — on recrée l'ambiance, rien de plus.

## Architecture

| Dossier | Rôle |
| --- | --- |
| `web/` | Front React 18 + Vite + Framer Motion ; éditeur TipTap (`components/JournalEditor.jsx`, `editor/extensions.js`) ; tout le CSS dans `src/styles.css` |
| `server/` | API Express + PostgreSQL (`src/routes.js`, migrations dans `src/db.js`), images traitées par Sharp |
| `desktop/` | Application Electron (fenêtre Windows connectée au serveur) |
| `backup/` | Scripts de sauvegarde / restauration (conteneur `backup`) |
| `.github/workflows/` | CI de l'application de bureau |
| `docker-compose.yml` | `db`, `app`, `languagetool` (correcteur), `backup`, `caddy` (profil https) |

Commandes utiles :

```bash
cd web && npx vite build          # vérifier que le front compile
docker compose build app          # reconstruire l'image
cd desktop && npm run dist        # installateur Windows
```

## Règles de travail (importantes)

1. **Le journal de l'utilisateur est privé.** Ne jamais lire son contenu (textes, photos, base de
   données). Pour tester, utiliser une **instance de démo** séparée, par exemple :
   `docker compose -p journal-demo --env-file <fichier-env-demo> up -d` (autre port, autres volumes,
   autre mot de passe), avec des données fictives. Sur le journal réel, se limiter à des comptages
   (nombre de journées, de médias, de caractères) pour vérifier qu'une mise à jour n'a rien perdu.
2. **Les données sont sacrées.**
   - Migrations **additives uniquement** (`MIGRATIONS` dans `server/src/db.js`) : on ajoute des
     colonnes ou des tables, on ne supprime ni ne réécrit jamais une colonne existante. Ne jamais
     modifier une migration déjà déployée.
   - Avant de déployer sur le journal réel : `docker compose exec backup sh /scripts/backup.sh once`,
     puis comparer les comptages avant / après.
   - Toute suppression côté interface est douce (`deleted_at`) ou limitée à du vide (pages vierges).
3. **Le carnet page par page a des invariants** (voir le système de design) : lignes de 30 px, une
   colonne CSS par page, aucun défilement vertical, la feuille ne bouge jamais pendant la frappe,
   une seule page vierge. Après toute modification de `JournalEditor.jsx`, `extensions.js` ou du CSS
   du carnet, tester : frappe longue (débordement automatique), clic dans le vide d'une page,
   curseur à la frontière de deux pages, zoom 150 %.
4. **Français partout** : interface, messages de commit, descriptions de PR, documentation.
5. Sous Windows / Git Bash : préfixer les commandes Docker qui passent des chemins absolus par
   `MSYS_NO_PATHCONV=1`.
