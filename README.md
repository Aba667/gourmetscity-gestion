# Gourmet's City · Gestion

Application de gestion installable sur iPhone/iPad : commandes, produits, dépenses, acomptes, reste à encaisser et export CSV. Les données sont chiffrées avec le mot de passe choisi sur l'appareil, stockées dans IndexedDB et disponibles hors connexion après installation.

## Mise en route

1. Ouvrir `https://gestion.gourmetscity.com` dans Safari.
2. Utiliser Partager → Sur l'écran d'accueil.
3. Ouvrir l'icône installée, puis créer un mot de passe d'au moins 8 caractères.
4. Faire une sauvegarde chiffrée depuis Réglages au moins une fois par mois et la conserver dans Fichiers/iCloud Drive. Il faut garder le mot de passe pour restaurer.

Les données saisies dans Safari et dans l'application installée peuvent être séparées sur iOS. Elles ne sont pas synchronisées entre iPhone et iPad. Les données locales peuvent être perdues si l'application ou les données du navigateur sont effacées, ou si le téléphone est perdu ; la sauvegarde est le moyen de récupération.

## Déploiement

Site statique prévu pour GitHub Pages, branche `main`, dossier `/`, domaine `gestion.gourmetscity.com`. Le DNS OVH doit avoir un CNAME `gestion` vers `aba667.github.io.`. Ne pas saisir de données avant que le domaine définitif soit actif : le stockage dépend du domaine.
