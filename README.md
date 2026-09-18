# ShopFlow Counter

Compteur de passages utilisant la webcam du PC, sans installation sur le poste.
Interface en français, traitement vidéo local dans Chrome ou Edge et export CSV compatible Excel.
**Prototype à tester avec votre webcam ; précision de comptage non certifiée.**

## Activer le site (une seule fois)

1. Dans ce dépôt, ouvrir **Settings → Pages**.
2. Sous **Build and deployment**, choisir **Deploy from a branch**.
3. Choisir **main**, puis **/ (root)**, et cliquer sur **Save**.
4. Attendre la fin du déploiement et utiliser **Visit site** sur cette page.

L'application fonctionne sur l'adresse HTTPS de GitHub Pages. Ouvrir directement
`index.html` depuis le disque n'est pas une méthode prise en charge.
Aucun abonnement IA, clé API ou Node.js n'est nécessaire sur le PC utilisateur.

## Premier essai avec la webcam du PC

1. Ouvrir le site dans Chrome ou Edge et cliquer sur **Démarrer le comptage**.
2. Autoriser uniquement la caméra ; le micro n'est jamais demandé.
3. Attendre le chargement du modèle (Internet nécessaire au chargement).
4. Reculer pour que le buste soit bien visible dans un cadre vert.
5. Avec les réglages initiaux, traverser la ligne verticale de gauche à droite
   **dans l'image affichée** : le centre du cadre vert doit franchir la ligne.
6. Revenir dans l'autre sens pour compter une sortie. Espacer les passages d'au moins deux secondes.
7. Utiliser **Arrêter** pour libérer la webcam.

La ligne peut être horizontale ou verticale, déplacée et inversée. L'effet miroir
agit sur l'image affichée et sur les coordonnées de comptage ensemble.
Une personne immobile n'est pas une entrée. Les boutons **+ 1 entrée / + 1 sortie**
ajoutent des événements manuels explicitement marqués dans le journal.

**Garder l'onglet visible et le PC éveillé.** Le comptage s'arrête lorsque l'onglet
est masqué, lorsque la caméra est débranchée ou quand la page est quittée.
Il ne fonctionne pas quand le navigateur est fermé ou le PC en veille.

## Fonctionnalités disponibles

- sélection de la webcam ;
- détection de personnes avec COCO-SSD et TensorFlow.js ;
- suivi temporaire du centre des cadres et franchissement avec bande de tolérance ;
- entrées, sorties et présence estimée du jour (base zéro en début de journée) ;
- graphique horaire et dernier historique ;
- stockage local de 5 000 événements au maximum ; les plus anciens sont remplacés ;
- export CSV de l'historique retenu et remise à zéro ;
- arrêt de la caméra même si le chargement ou une analyse est en cours.

La présence estimée suppose un magasin vide au début de la journée. Ce n'est pas
un dispositif de sécurité ni une jauge réglementaire. Les totaux quotidiens sont
calculés depuis l'historique retenu, y compris les événements manuels.

## Données et réseau

Les bibliothèques sont chargées depuis jsDelivr (TensorFlow.js 4.22.0 et COCO-SSD 2.2.3).
Le modèle `lite_mobilenet_v2` est téléchargé depuis l'hébergement Google utilisé
par COCO-SSD. Le navigateur contacte donc ces fournisseurs pour télécharger du code
et le modèle. L'inférence se déroule ensuite sur le PC : l'application ne transmet
aucune image ni événement de passage et n'enregistre ni vidéo ni son.

Les identifiants de suivi restent uniquement en mémoire, sans reconnaissance faciale.
La base `localStorage` conserve le type, l'heure exacte, la source et un identifiant
aléatoire de chaque événement, ainsi que les réglages. Elle appartient au navigateur
et à l'adresse du site : pas de synchronisation entre appareils. Exporter avant
d'effacer les données du navigateur. En navigation privée, la conservation n'est
pas garantie. Les images et statistiques locales ne sont pas publiées sur GitHub.

La production de compteurs ne dispense pas d'évaluer le traitement initial des
images au regard du RGPD. La suppression des images n'est pas, à elle seule,
une garantie d'anonymat de l'ensemble du dispositif. Avant une installation en
magasin, valider les obligations applicables et l'information des personnes.

## Limites et phase suivante

Le suivi est un prototype par proximité, sensible aux occultations, à l'éclairage,
aux groupes rapprochés et aux déplacements rapides. Il compte des **passages**,
pas des clients uniques. Il n'exclut pas les salariés et ne reconnaît pas les foyers.
Tester manuellement plusieurs parcours avant de tirer des conclusions commerciales.
Une caméra vue du dessus nécessite de vérifier l'adéquation du modèle à cet angle.

L'intégration Shopify, les statistiques multi-magasins et la sauvegarde centralisée
ne sont pas encore incluses. Ne jamais placer de jeton Shopify privé dans ce site public.

## Développement et tests

```sh
npm test
npm run check
npx serve .
```

Les tests Node vérifient les franchissements, l'expiration du suivi et les
scénarios de démarrage/arrêt avec une caméra et un détecteur simulés. Ils ne
mesurent pas la précision du modèle sur des images réelles et ne remplacent pas
le test sur le PC utilisateur.

- [Modèle et API COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd)
- [Configurer GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
