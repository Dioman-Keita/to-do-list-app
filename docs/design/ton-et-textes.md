# Ton et textes

Le journal parle comme **une personne qui écrit dans son carnet**, pas comme un logiciel.

## Principes

- **Français**, **tutoiement**, phrases courtes.
- **Première personne pour le journal** quand il agit : « J’ouvre… », « Je réveille Docker… »,
  « j’écris… ». L'utilisateur est « tu ».
- **Points de suspension** pour les invitations et les attentes : « Cher journal, aujourd’hui… ».
- **Typographie française** : apostrophe typographique `’`, espaces avant `: ; ! ?` dans les phrases,
  guillemets « … », points de suspension `…` (un seul caractère).
- **Pas de jargon technique** dans l'interface (pas de « requête », « serveur 503 », « token »).
  Les détails techniques vont dans les logs.
- **Pas de majuscules criardes**, pas de « ERREUR ! ». Une erreur reste calme et dit quoi faire.
- Pas d'emoji dans les phrases (les emojis sont des stickers à part entière).

## Exemples de référence (déjà dans l'appli)

| Situation | Texte |
| --- | --- |
| Zone d'écriture vide | Cher journal, aujourd’hui… |
| Titre vide | Le titre de ma journée… |
| Enregistrement | … → j’écris… → enregistré ✓ |
| Échec d'enregistrement | pas enregistré ✗ |
| Couverture de connexion | Privé ! Ne pas lire… |
| Mot de passe | Le mot de passe secret : / Ouvrir le journal → |
| Choix du mot de passe | Choisis ton mot de passe secret : / Encore une fois, pour être sûr : / Fermer le cadenas → |
| Mots de passe différents | Les deux ne sont pas pareils… |
| Premier jour | Cher journal… Avant d’écrire ta première page, il faut que je sache à qui tu appartiens. |
| Champs d'identité | Je m’appelle… / Et ce carnet s’appellera… |
| Polaroïd en cours d'envoi | développement… |
| Album vide | Aucune photo pour l’instant… ajoute-en depuis une journée. |
| Page vierge | Écris d’abord sur la page vierge : la suivante se créera toute seule |
| Paramètres enregistrés | c’est noté ✓ |
| Arracher une page | Arracher la page 2 ? / oui, à la corbeille / non → je l’arrache… |
| Corbeille | Rien ne s’efface tout seul ici : seulement si tu le décides. Effacé, c’est pour toujours. |
| Effacer pour toujours | Effacer cette page pour toujours ? / Tout effacer pour toujours (3) ? → oui, effacer / non |
| Recoller / remettre | Recoller → Recollée dans la journée du 16 octobre 2026 ✓ y aller → ; Remettre |
| Appli de bureau, attente | Je cherche ton journal… / Je réveille Docker… / J’ouvre le journal… |
| Serveur injoignable | Le journal ne répond pas à http://localhost:8080. |

## Écrire un nouveau texte

1. Est-ce que ça pourrait être écrit à la main dans un carnet ? Sinon, reformuler.
2. Plus court ? Presque toujours possible.
3. Une erreur dit **ce qui s'est passé** et **ce qu'on peut faire** : « Tâche non ajoutée : … » plutôt
   que « Erreur ».
4. Les libellés de boutons sont des verbes ou des gestes : « Ouvrir mon journal → », « + Photo »,
   « Coller dans le journal », « Enregistrer ».
5. Les textes d'aide (`title`, infobulles) peuvent être plus longs, mais restent dans le même ton.
