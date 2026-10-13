# Parallax — export HTML pour le développement

Export statique du projet de design « Parallax — page d'accueil ». Aucune dépendance, aucun build : ouvrir `index.html` dans un navigateur.

## Pages

| Fichier | Page du design |
|---|---|
| `index.html` | Accueil — desktop |
| `mobile.html` | Accueil — mobile (maquette 390 × 844) |
| `projets.html` | Projets / Portfolio (avec panneau latéral et galeries dépliables) |
| `studio.html` | Studio |
| `contact.html` | Contact (formulaire non branché) |
| `espace-client.html` | Espace client (connexion, non branchée) |
| `galerie.html` | Galerie client |
| `mentions-legales.html`, `confidentialite.html`, `cgv.html`, `cookies.html` | Pages légales (gabarits à compléter) |

Les liens entre pages sont déjà renommés vers ces fichiers.

## Structure

```
assets/img/        toutes les images (logo, photos — extraites du design, plus aucune image en base64)
assets/js/dc-lite.js   mini-runtime vanilla (~80 lignes) pour les interactions
source-design/     fichiers sources du design (.dc.html) + canvas.json, pour référence
```

## Comment c'est construit

- **HTML/CSS** : le markup est celui du design, styles en `style="…"` inline ; le `<head>` contient les règles globales (hover, champs de formulaire) et le lien Google Fonts (Space Grotesk ; Cormorant Garamond + Hanken Grotesk pour la section SEMPRA de l'accueil).
- **Rendu initial** : chaque page est déjà rendue dans son état initial (lisible sans JS).
- **Interactions** : en bas de chaque page, une classe `Component` contient l'état et la logique (bascule FR/EN via le dictionnaire `DICT`, bouton « remonter », panneau Projets, galeries, ancres de la galerie). `dc-lite.js` relie cette logique au DOM via trois attributs :
  - `data-dc-tpl-<attr>="… {{ clé }} …"` : valeur dynamique, recalculée à chaque `setState()` à partir de `renderVals()` ;
  - `data-dc-on="click:nomFonction"` : handler d'événement ;
  - `data-dc-ref="nomFonction"` : appelé avec l'élément au montage (ex. conteneur de scroll).

  Ces attributs indiquent exactement ce qui est dynamique : pratique pour porter vers React/Vue/Astro, ou à supprimer si vous réécrivez les interactions.

## Points à savoir pour l'intégration

- Les artboards du design faisaient 1440 × 900 (desktop) et 390 × 844 (mobile) avec un défilement interne (`#scroll`). Dans l'export, le cadre racine occupe la fenêtre (`width: 100%; height: 100vh`), le scroll reste interne. Pour un site en production, il sera plus naturel de laisser défiler le `body` et de rendre la mise en page responsive (les paddings et grilles sont pensés pour 1440 px).
- La version mobile est une page séparée ; à fusionner en media queries dans la version finale.
- Contenus entre crochets (`[ton prénom]`, `[à compléter]`, `[+32 …]`, `[hello@…]`…) = placeholders à remplacer.
- Liens `href="#"` (SEMPRA, réseaux sociaux, vidéos) à renseigner. Formulaires contact / connexion sans backend.
- Couleurs principales : fond `#0C0F17`, texte `#F5F6F7`, secondaire `#AEB6C6` / `#8A92A6`, accent `#1E9EFF`, SEMPRA `#D2B17D` sur `#072421`.
