# Architecture Technique Parallax

## 1. Structure du monorepo

Le projet Parallax est organise sous forme d'un monorepo base sur les npm workspaces.

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

- `apps/web` : Application web principale basee sur React Router v8, React 19 et Vite 8 en mode SSR.
- `packages/shared` : Package interne partage (@parallax/shared) pour les constantes, schemas et utilitaires transverses.
- `docs/` : Documentation technique de reference du projet.

## 2. Scripts disponibles

Depuis la racine du monorepo :

- `npm run dev` : Lance le serveur de developpement pour apps/web.
- `npm run build` : Compile les packages et produit le build de production pour apps/web.
- `npm run typecheck` : Execute la verification de types TypeScript sur l'ensemble des workspaces.
- `npm run lint` : Execute ESLint sur l'ensemble du projet avec zero warning autorise.
- `npm run test` : Execute les tests unitaires et d'integration avec Vitest.
- `npm run start` : Demarre le serveur de production pour apps/web.

## 3. Conventions TypeScript et CSS Modules

### TypeScript
- Mode strict active sans exception (`"strict": true`).
- Interdiction stricte de `any`, `as any`, `@ts-ignore` et `@ts-expect-error`.
- Typage explicite des loaders, actions et meta React Router.
- Imports de code partage resolus directement depuis `@parallax/shared`.

### CSS Modules et styles
- Aucun framework CSS utility-first (pas de Tailwind CSS).
- Utilisation exclusive de CSS Modules pour le scoping des composants.
- Configuration `localsConvention: "camelCase"` dans Vite.
- Variables CSS et design tokens centralises dans `app/app.css` (`--px-*` pour l'univers Parallax, `--sp-*` pour le bloc SEMPRA).
- Interdiction stricte des styles inline dans le code JSX/TSX.

## 4. Separation code public, serveur et tests

- Code public et composants partages : situes dans `apps/web/app/`.
- Code reserve au serveur : suffixe `.server.ts` ou place dans un sous-dossier `.server/` (exclus du bundle client par React Router).
- Code reserve au client : suffixe `.client.ts` ou `.client.tsx` (exclus du SSR si necessaire).
- Tests automatises :
  - Tests unitaires et smoke tests : dans `apps/web/tests/`, executes via Vitest et jsdom.
  - Setup de test dans `apps/web/tests/setup.ts`.

## 5. Principe des donnees persistantes hors du depot

Le code applicatif et les donnees persistantes sont strictement separes :

- Aucune donnee persistante, media client, base de donnees SQLite ou secret n'est committe dans Git.
- Les chemins persistants sont configures via des variables d'environnement (`.env.local` hors Git) :
  - `SITE_CONTENT_PATH` : Emplacement externe pour le contenu JSON.
  - `GALLERY_DB_PATH` : Emplacement externe de la base SQLite des galeries.
  - `GALLERY_MEDIA_PATH` : Dossier externe pour les fichiers photos et videos.
  - `GALLERY_IMPORT_PATH` : Dossier externe de transit pour les imports.
  - `RATE_LIMIT_DB_PATH` : Emplacement externe de la base SQLite du rate limiting.
- En developpement comme en production, ces dossiers sont situes en dehors de l'arborescence du code suivi par Git.

## 6. Versionnage du contenu Parallax

- Le contenu structure du site Parallax demarre directement en version 1 (`schemaVersion: 1`).
- Aucune dette technique liee aux versions anterieures n'est importee.
- Toute evolution future du schema de donnees sera explicite et documentee lot par lot.
