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
        components/
          public/
            Footer.tsx
            footer.module.css
            Header.tsx
            header.module.css
            ScrollToTop.tsx
            scrollToTop.module.css
            VideoModal.tsx
            videoModal.module.css
        content/
          default-site-content.json
        lib/
          admin-auth.server.ts
          atomic-fs.server.ts
          auth.server.ts
          env.server.ts
          rate-limit.server.ts
          security.server.ts
          session.server.ts
          site-content.server.ts
          site-content.shared.ts
        routes/
          admin/
            adminForms.module.css
            dashboard.module.css
            dashboard.tsx
            home.tsx
            login.module.css
            login.tsx
            logout.tsx
            studio.tsx
          public/
            home.module.css
            home.tsx
            studio.module.css
            studio.tsx
          preview-login.ts
          root-redirect.tsx
        app.css
        entry.server.tsx
        root.tsx
        routes.ts
      public/
        fonts/
          cormorant-garamond-*.woff2
          hanken-grotesk-*.woff2
          LICENSE.txt
          space-grotesk-*.woff2
        img/
      scripts/
        admin-hash.js
        preview-local.js
      tests/
      package.json
      tsconfig.json
      vite.config.ts
      vitest.config.ts
  packages/
    shared/
      src/
      package.json
      tsconfig.json
  scripts/
    env-loader.js
    env-loader.d.ts
  docs/
    ADMIN_SETUP.md
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

- `apps/web` : Application principale sous React Router v8, React 19 et Vite 8 en mode SSR. Contient les routes, layouts, composants UI, scripts et services serveur.
- `packages/shared` : Package interne partage (`@parallax/shared`) reserve exclusivement aux types, schemas et validateurs purs, sans import de modules serveur (`node:*`), sans donnees sensibles et sans secrets.
- `scripts/` : Outils monorepo partages, notamment le chargeur d'environnement `env-loader.js`.
- `docs/` : Documentation technique de reference et guides d'exploitation.

## 3. Scripts disponibles

Depuis la racine du monorepo :

- `npm run dev` : Lance le serveur de developpement pour `apps/web`.
- `npm run build` : Compile les packages et produit les bundles client et serveur SSR pour `apps/web`.
- `npm run typecheck` : Execute la verification statique des types TypeScript sur l'ensemble des workspaces (`apps/web` et `packages/shared`).
- `npm run lint` : Execute ESLint sur l'ensemble du projet avec zero warning autorise.
- `npm run test` : Execute les tests unitaires et d'integration avec Vitest.
- `npm run start` : Demarre le serveur de production pour `apps/web`.
- `npm run preview:local` : Demarre le serveur de previsualisation de production local (`PARALLAX_LOCAL_PREVIEW=true`, lie a `127.0.0.1`).
- `npm run admin:hash` : Lance l'outil interactif securise de generation de hash administrateur Argon2id.

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
  - Variables `--px-*` pour l'identite sombre de Parallax (fond `#0C0F17`, surface `#141822`, accent `#1E9EFF`, texte `#F5F6F7`, police Space Grotesk).
  - Variables `--sp-*` pour le bloc dedie SEMPRA (fond `#072421`, or `#D2B17D`, typographies Cormorant Garamond et Hanken Grotesk).
- Polices d'ecriture locales : Space Grotesk 400 et 500 hebergees localement sous licence SIL Open Font License 1.1 (`/public/fonts/`). Aucun chargement externe Google Fonts a l'execution.
- Interdiction stricte des styles inline dans le code JSX/TSX.

## 5. Exigence de fidelite visuelle aux references

- Les fichiers situes dans `References/parallax-site/` (`index.html`, `mobile.html`, `contact.html`, `espace-client.html`, etc.) constituent la reference visuelle et structurelle obligatoire du projet.
- Les interfaces portees doivent reproduire fidelement la mise en page, l'ordre des sections, les espacements, les arrondis, les largeurs des cartes, les champs et les boutons issus des HTML fournis.
- L'administration (non modelisee dans le prototype) derive ses cartes de connexion, champs et boutons directement des composants de `espace-client.html` et `contact.html` (carte 480px max, indicateur bleu 40px, bordures 0.5px, fond `#141822`, bouton accent `#1E9EFF`).
- Le dossier `References/` demeure en lecture seule stricte dans le depot.

## 6. Socle de securite administrateur (Lot 1)

1. **Chargement d'environnement (`env-loader.js` et `env.server.ts`)** :
   - Isolation absolue en test (`NODE_ENV === "test"` n'effectue aucune lecture de `.env.local`).
   - Priorite aux variables deja definies dans le processus.
   - Validation stricte des chemins de stockage (absolus, hors depot, permissions verifiees, rejet des liens symboliques).
   - Validation stricte de `PUBLIC_SITE_URL` (HTTPS obligatoire en production).
   - En l'absence de configuration administrateur valide, l'acces a `/admin` retourne une reponse 503 sans fuite d'informations.

2. **Authentification et gestion de session (`auth.server.ts`, `session.server.ts`)** :
   - Hachage de mot de passe par Argon2id via `@node-rs/argon2` (cout memoire 19456 Ko, temps 2 passes, parallelisme 1 thread).
   - Invalidation automatique des sessions via `credentialVersion` basee sur HMAC-SHA256 du hash et du secret de session.
   - Cookie de session dedie `__parallax_admin_session`, `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` en production.
   - Duree de vie maximale de session de 8 heures, validee cote serveur via timestamp signe (`expiresAt`), et non uniquement par le `Max-Age` du navigateur.
   - Session anonyme temporaire pour porter le jeton CSRF de pre-connexion, transformee en session authentifiee apres validation du mot de passe.

3. **Protection des mutations et limitation de debit (`security.server.ts`, `rate-limit.server.ts`)** :
   - Validation d'origine stricte (`Origin` egal a `PUBLIC_SITE_URL`).
   - Validation CSRF en temps constant (`crypto.timingSafeEqual`).
   - Rejet des methodes autres que POST pour les mutations (405 avec en-tete `Allow: POST`).
   - Rejet des types de contenu differents de `application/x-www-form-urlencoded` (415).
   - Lecture bornee en streaming des requetes a 8 KiB maximum pour l'authentification (413 Payload Too Large en cas de depassement).
   - Rejet des champs sensibles dupliques.
   - Limitation transactionnelle SQLite des tentatives de connexion : 5 tentatives sur fenetre glissante de 15 minutes, basee sur le hachage HMAC de l'adresse IP (aucune IP brute stockee).
   - La deconnexion est protegee par CSRF et Origin mais n'est pas bloquee par le quota de tentatives de connexion.

4. **En-tetes de securite et CSP SSR (`entry.server.tsx`)** :
   - Nonce cryptographique 16 octets regenere a chaque requete SSR.
   - Content-Security-Policy stricte en production : aucun `unsafe-inline`, aucun `unsafe-eval`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
   - Reponses d'administration (y compris erreurs et redirections) protegees par `Cache-Control: no-store` et `X-Robots-Tag: noindex, nofollow`.

## 7. Cartographie des routes livrees (Lot 1)

- Routes publiques :
  - `/` : Page d'accueil technique de demarrage.
- Routes d'administration :
  - `GET /admin` : Page de connexion si anonyme ; redirection 303 vers `/admin/dashboard` si deja connecte.
  - `POST /admin` : Traitement de la connexion administrateur.
  - `GET /admin/dashboard` : Tableau de bord securise presentant les 8 modules a venir.
  - `POST /admin/logout` : Deconnexion securisee avec CSRF et destruction de la session.
  - `GET /admin/logout` : Rejet 405 Method Not Allowed avec en-tete `Allow: POST`.

## 8. Vitrine FR/EN et contenus administrables (Lot 2)

1. **Pages et routes livrees** :
   - `GET /` : Redirection temporaire 302 vers `/fr`.
   - `GET /fr` et `GET /en` : Page d'accueil publique fidele au prototype desktop (`index.html`) et mobile (`mobile.html`), avec Header responsive, choix de langue dynamique preservant la page courante, hero, showreel (modal de consentement sans tiers automatique au chargement), duo Maxime & Ludovic, savoir-faire photo & video (ponctuation simple sans tirets cadratins), contact, bloc SEMPRA isole avec palette et polices dediees, et Footer.
   - `GET /fr/studio` et `GET /en/studio` : Page Studio avec portraits, roles et approche du duo.
   - `GET /admin/home` et `POST /admin/home` : Formulaire d'administration de la page Accueil en francais et en anglais.
   - `GET /admin/studio` et `POST /admin/studio` : Formulaire d'administration de la page Studio en francais et en anglais.
   - `GET /preview/login` : Endpoint d'authentification de developpement local borne strictement au mode `PARALLAX_LOCAL_PREVIEW=true` (retourne 404 en production standard).

2. **Modele de donnees et persistance (`schemaVersion: 1`)** :
   - Stockage externe defini par `SITE_CONTENT_PATH` (ex: `/Users/profadmin/.parallax-data/site-content.json`).
   - Ecriture atomique (`atomicWriteJson`) avec fichier temporaire, `fsync` du descripteur et du repertoire parent, rotation a 5 fichiers de sauvegarde `.bak`, et permissions `0600`.
   - Suivi de revision par jeton hex 32 octets aleatoire et horodatage ISO serveur. En cas de tentative d'enregistrement concurrent avec une revision obsolete, le serveur renvoie une erreur HTTP 409 et preserve l'integrite des saisies de l'utilisateur dans l'interface sans perte de donnees.
   - Selection de visuels strictement limitee aux identifiants autorises (`ALLOWED_IMAGE_MAP`). Aucun chemin arbitraire accepte en entree.

