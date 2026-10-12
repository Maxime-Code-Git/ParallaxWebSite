# Architecture Technique Parallax

## 1. Environnement d'execution et versions cibles

- **Node.js cible** : `v24.15.0`. C'est la valeur exacte specifiee dans `.nvmrc` et dans le workflow GitHub Actions (`.github/workflows/ci.yml`).
- **Borne minimale** : Le champ `"engines": { "node": ">=24.15.0" }` de `package.json` definit une borne minimale pour l'outillage npm, et ne constitue pas une preuve que chaque version superieure de Node a ete validee en production.
- **Gestionnaire de paquets** : `npm >= 10`.

## 2. Structure du monorepo

Le projet Parallax est organise en monorepo base sur les npm workspaces :

```text
ParallaxWebSite/
  .github/
    workflows/
      ci.yml
  apps/
    web/
      app/
      public/
      tests/
      package.json
      tsconfig.json
      vite.config.ts
  packages/
    shared/
      src/
      package.json
      tsconfig.json
  docs/
    ARCHITECTURE.md
    SEMPRA_REUSE_MAP.md
    WORKFLOW_CHATGPT_GEMINI.md
  .editorconfig
  .env.example
  .gitignore
  .nvmrc
  eslint.config.js
  package.json
  package-lock.json
  README.md
  tsconfig.json
```

- `apps/web` : Application principale sous React Router v8, React 19 et Vite 8 en mode SSR. Contient les routes, layouts, composants UI et services serveur.
- `packages/shared` : Package interne partage (`@parallax/shared`) reserve exclusivement aux types, schemas et validateurs purs, sans import de modules serveur (`node:*`), sans donnees sensibles et sans secrets.
- `docs/` : Documentation technique de reference.

## 3. Scripts disponibles

Depuis la racine du monorepo :

- `npm run dev` : Lance le serveur de developpement pour `apps/web`.
- `npm run build` : Compile les packages et produit les bundles client et serveur SSR pour `apps/web`.
- `npm run typecheck` : Execute la verification statique des types TypeScript sur l'ensemble des workspaces (`apps/web` et `packages/shared`).
- `npm run lint` : Execute ESLint sur l'ensemble du projet avec zero warning autorise.
- `npm run test` : Execute les tests unitaires et de configuration avec Vitest.
- `npm run start` : Demarre le serveur de production pour `apps/web`.

## 4. Conventions TypeScript et CSS Modules

### TypeScript
- Mode strict active imperativement (`"strict": true`).
- Interdiction absolue de `any`, `as any`, `@ts-ignore` et `@ts-expect-error`.
- Typage explicite des loaders, actions et meta de React Router.
- Imports transverses resolus directement via l'alias `@parallax/shared`.

### CSS Modules et styles
- Aucun framework CSS utility-first (aucun recours a Tailwind CSS).
- Utilisation exclusive de CSS Modules pour le scoping des composants graphiques.
- Option `localsConvention: "camelCase"` configuree dans Vite.
- Tokens de design centralises dans `app/app.css` :
  - Variables `--px-*` pour l'identite sombre de Parallax (fond `#0C0F17`, accent `#1E9EFF`, texte `#F5F6F7`, police Space Grotesk).
  - Variables `--sp-*` pour le bloc dedie SEMPRA (fond `#072421`, or `#D2B17D`, typographies Cormorant Garamond et Hanken Grotesk).
- Interdiction stricte des styles inline dans le code JSX/TSX.

## 5. Separation code public, serveur et tests

- Code public et composants partages : situes dans `apps/web/app/`.
- Code reserve au serveur : suffixe `.server.ts` ou place dans un sous-dossier `.server/` (automatiquement exclus du bundle client par le bundler React Router).
- Code reserve au client : suffixe `.client.ts` ou `.client.tsx` (exclus du rendu initial SSR si necessaire).
- Tests automatises :
  - Tests unitaires et smoke tests : dans `apps/web/tests/`, executes via Vitest et jsdom.
  - Setup de test dans `apps/web/tests/setup.ts`.

## 6. Principe des donnees persistantes hors du depot

Le code applicatif et les donnees persistantes sont strictement separes :

- Aucune donnee persistante, media client, base de donnees SQLite ou secret n'est committe dans Git, ni place dans `public/` ou `build/`.
- Les chemins de persistance sont configures via des variables d'environnement externes (`.env.local` hors Git) :
  - `SITE_CONTENT_PATH` : Emplacement externe pour le fichier JSON de contenu.
  - `GALLERY_DB_PATH` : Emplacement externe de la base SQLite des galeries.
  - `GALLERY_MEDIA_PATH` : Emplacement externe pour le stockage des photos et videos.
  - `GALLERY_IMPORT_PATH` : Repertoire externe de transit pour les imports de medias.
  - `RATE_LIMIT_DB_PATH` : Emplacement externe de la base SQLite du rate limiting.
- En developpement comme en production, ces dossiers doivent se situer en dehors de l'arborescence du code suivi par Git.

## 7. Versionnage du contenu Parallax

- Le contenu Parallax demarre directement et exclusivement en version 1 (`schemaVersion: 1`).
- Aucune dette technique liee aux versions anterieures ou aux schemas historiques de Sempra n'est importee.
- Toute evolution future fera l'objet d'un lot specifique avec migration explicite.

## 8. Proposition de cartographie des routes (a valider lot par lot)

Cette arborescence represente une proposition architecturale pour les lots futurs et n'est pas encore implementee :

- Routes publiques francaises :
  - `/fr` : Accueil
  - `/fr/projets` : Portfolio (rubriques Documentaire, Publicite et realisations)
  - `/fr/studio` : Presentation du studio et des fondateurs
  - `/fr/contact` : Formulaire de demande de projet
  - `/fr/espace-client` : Saisie du code d'acces galerie unique
  - `/fr/galerie/:id` : Consultation et telechargement de galerie privee
  - `/fr/mentions-legales`, `/fr/confidentialite`, `/fr/cgv`, `/fr/cookies` : Pages legales
- Routes publiques anglaises :
  - Miroir sous le prefixe `/en/` (`/en/projects`, `/en/studio`, `/en/contact`, `/en/client-area`, `/en/gallery/:id`, `/en/legal`, etc.)
- Routes d'administration :
  - `/admin` : Connexion
  - `/admin/portfolio` : Gestion des realisations et medias
  - `/admin/galleries` : Gestion des galeries clients et generation des codes
  - `/admin/legal` : Edition et publication des textes juridiques
  - `/admin/settings` : Configuration generale

## 9. Differences connues entre les documents de reference

Pour lever toute ambiguite lors des developpements futurs :

1. **Espace client et galerie** :
   - Le guide PDF mentionnait un couple e-mail / mot de passe.
   - **Regle retenue** : Le prototype actuel et le contexte fonctionnel exigent **un seul champ code d'acces** par galerie client. Aucun compte utilisateur classique avec mot de passe n'est requis.
2. **Typographies et styles** :
   - Le prototype HTML utilisait Google Fonts et des styles inline.
   - **Regle retenue** : En production, les polices doivent etre hebergees localement sous licence et les styles inline doivent etre remplaces par des CSS Modules.
3. **Mise en page mobile** :
   - Le prototype fournissait une page separee `mobile.html`.
   - **Regle retenue** : Fusionner la mise en page dans une interface responsive unique via media queries CSS.
4. **Portfolio et panneau lateral** :
   - Le prototype affiche deux rubriques visibles : Documentaire et Publicite.
   - **Regle retenue** : Distinguer clairement les rubriques structurelles des realisations (projets). Le portfolio n'est pas limite a deux projets fixes mais supporte plusieurs realisations par rubrique.
   - **Direction du panneau lateral** :
     - Si la vignette cliquee est a gauche => entree depuis la droite.
     - Si la vignette cliquee est a droite => entree depuis la gauche.
     - Fermeture du panneau vers le cote d'origine d'entree.
   - Les aspects avances (routes localisees, lien direct, historique, touche Escape, piege a focus, blocage du scroll arriere-plan, prefers-reduced-motion) seront traites dans le lot portfolio dedie.
5. **Informations manquantes a fournir ulterieurement** :
   - Coordonnees reelles (e-mail, telephone, adresse du studio) ;
   - Donnees d'immatriculation (numero BCE, TVA) ;
   - Liens des reseaux sociaux officiels (Instagram, YouTube) ;
   - Fichiers medias sources defintifs (photos et video showreel HD).
   Ces informations seront injectees lors des lots correspondants sans bloquer le socle actuel.
