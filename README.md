# Gourmet's City · Gestion

Application privée pour iPhone et iPad : commandes, produits, dépenses, acomptes, reste à encaisser et export CSV.

## Mise en route

1. Ouvrir `https://gestion.gourmetscity.com` dans Safari.
2. Utiliser Partager → Sur l'écran d'accueil.
3. Ouvrir l'icône installée, puis se connecter avec l'identifiant et le mot de passe du compte.
4. Sur le second appareil, répéter les étapes 1 à 3.
5. Faire une sauvegarde chiffrée depuis Réglages au moins une fois par mois et la conserver dans Fichiers/iCloud Drive. Il faut garder le mot de passe pour restaurer.

Le navigateur chiffre les données avec le mot de passe avant la synchronisation vers Cloudflare D1. Une connexion Internet est nécessaire pour enregistrer les modifications. Si les deux appareils modifient simultanément les données, la seconde écriture est refusée : il faut recharger l'application et refaire la modification. Un appareil perdu ne supprime pas la copie en ligne.

L'adresse `adjafatou@gourmetcity.com` est un **identifiant**, pas une boîte e-mail. Aucun e-mail de récupération ne peut donc être envoyé. La création du compte affiche un code de récupération à conserver séparément. Il permet de créer un nouveau mot de passe si l'ancien est oublié. Conservez aussi le mot de passe dans un gestionnaire de mots de passe.

## Déploiement

Le site statique est hébergé sur GitHub Pages, branche `main`, dossier `/`, domaine `gestion.gourmetscity.com`. Le DNS OVH a un CNAME `gestion` vers `aba667.github.io.`.

L'API Cloudflare Worker est dans `sync-worker/worker.js` et la structure D1 dans `sync-worker/schema.sql`. Le service doit être nommé `gourmetscity-gestion-api` dans le compte Cloudflare dont le sous-domaine Workers est `footmaster-web.workers.dev`. Il faut lier la base D1 à la variable `DB`, définir `ALLOWED_ORIGIN=https://gestion.gourmetscity.com` et définir un secret `SETUP_CODE` avant la première création de compte. Ne mettez jamais ce code dans GitHub. Le code de création ne fonctionne qu'une fois ; aucun compte public supplémentaire ne peut être ouvert.
