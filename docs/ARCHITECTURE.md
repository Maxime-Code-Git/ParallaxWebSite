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

2. **Modele de donnees et persistance (`schemaVersion: 1`)** :
   - Stockage externe defini par `SITE_CONTENT_PATH` (ex: `/Users/profadmin/.parallax-data/site-content.json`).
   - Ecriture atomique (`atomicWriteJson`) avec fichier temporaire, `fsync` du descripteur et du repertoire parent, rotation a 5 fichiers de sauvegarde `.bak`, et permissions `0600`.
   - Suivi de revision par jeton hex 32 octets aleatoire et horodatage ISO serveur. En cas de tentative d'enregistrement concurrent avec une revision obsolete, le serveur renvoie une erreur HTTP 409 et preserve l'integrite des saisies de l'utilisateur dans l'interface sans perte de donnees.
   - Selection de visuels strictement limitee aux identifiants autorises (`ALLOWED_IMAGE_MAP`). Aucun chemin arbitraire accepte en entree.

## 9. Portfolio et realisations publiques (Lot 3)

1. **Architecture des rubriques et realisations** :
   - Deux rubriques fondamentales stables : `documentary` (Documentaire / Documentary) et `advertising` (Publicite / Advertising).
   - Realisations structurees avec titre, resume, blocs de contenu typés, SEO, galerie d'images ordonnee, video avec couverture dediee, statut brouillon/publie, ordre d'affichage et side.
   - Transition de remplacement directionnelle unique (500ms `cubic-bezier(0.7, 0, 0.2, 1)`) calculee selon `const panelDirection = imageSide === "left" ? "right" : "left"`.
   - Stockage independant defini par `PORTFOLIO_CONTENT_PATH` et `PORTFOLIO_MEDIA_PATH`.

2. **Routes et endpoints** :
   - Pages publiques : `/fr/projets`, `/fr/projets/:rubrique`, `/fr/projets/:rubrique/:slugFr`, et equivalents `/en/projects/*`.
   - Administration : `/admin/portfolio`, `/admin/portfolio/:id`, `/admin/portfolio/section/:sectionKey`.
   - Upload et distribution : `/api/admin/portfolio/upload`, `/media/portfolio/:variantKey`.

## 10. Espace client et galeries privees a code unique (Lot 4)

1. **Modele SQLite V1 et isolation stricte** :
   - Moteur SQLite natif `node:sqlite` V1 separe du rate limiter et du site (`GALLERY_DB_PATH`).
   - Tables : `galleries` (UUID interne, publicId opaque, statut, expiration, revision), `gallery_codes` (HMAC sha256 unique, chiffrement AES-256-GCM, version entiere), `gallery_media` (photos et videos ordonnees, hash SHA-256 unique par galerie, dimensions, variantes WebP), `gallery_import_jobs` (baux workers exclusifs, statut, progression), `gallery_deletion_jobs` (quarantaine transactionnelle reprenable).
   - Code d'acces unique sans compte ni identifiant : prefixe `PARALLAX-`, alphabet lisible, 96 bits d'entropie, jamais stocke en clair.
   - Rotation du code : nouvelle valeur generee, `version = version + 1`, revocation instantanee de tous les cookies de clients actifs.

2. **Routes publiques de l'espace client** :
   - `GET /fr/espace-client` et `POST /fr/espace-client` : Formulaire de connexion FR avec carte prototype 480px.
   - `GET /en/client-area` et `POST /en/client-area` : Formulaire de connexion EN.
   - `GET /fr/galerie/:publicId` et `GET /en/gallery/:publicId` : Galerie privee (grille masonry 3 colonnes, pastille telechargement ronde, lightbox accessible, film 16:9).
   - `POST /api/gallery/logout` : Deconnexion client et destruction du cookie `__parallax_gallery_session`.
   - `GET /api/gallery/:publicId/photos?skip=24` : Pagination ordonnee stable de 24 en 24.
   - `GET /api/gallery/:publicId/media/:mediaId?width=480|960|1920&format=webp` : Previews WebP persistantes (aucun fallback vers l'original).
   - `GET /api/gallery/:publicId/media/:mediaId` : Streaming de video avec support RFC 7233 Range (206, Content-Range, Accept-Ranges, 416).
   - `GET /api/gallery/:publicId/media/:mediaId/poster` : Poster prive pour film video.
   - `GET /api/gallery/:publicId/download/original/:mediaId` : Telechargement du fichier original non altere.
   - `GET /api/gallery/:publicId/download?type=all|photos|videos` : Streaming instantane d'archive ZIP via yazl (`compress: false`).

3. **Administration des galeries** :
   - `GET /admin/galleries` : Liste des galeries avec compteurs photos/videos, statuts et dates d'expiration.
   - `GET /admin/galleries/new` et `POST /admin/galleries/new` : Creation atomique galerie et code d'acces.
   - `GET /admin/galleries/:id` et `POST /admin/galleries/:id` : Edition editoriale avec verification de revision (409 Conflict), rotation du code, publication, archivage et suppression avec confirmation exacte du nom.
   - `GET /admin/galleries/:id/preview` : Previsualisation fidele pour l'administrateur connecte sans session client.
   - `POST /api/admin/galleries/:id/import` : Analyse du dossier source puis demarrage du job a bail persistant.
   - `GET /api/admin/galleries/:id/imports/:importId` : Suivi de progression temps reel de l'import.
   - `POST /api/admin/galleries/:id/media/:mediaId/poster` : Televersement de poster video via formulaire natif streaming (Sharp, limite 25 MiB).

## 11. Conservation, suppression et exports des galeries (Lot 5)

1. **Schéma de base de données V2 et migrations idempotentes** :
   - Migration transactionnelle enregistrée dans `gallery_schema` sous le nom `parallax_gallery_v2`.
   - Table `retention_settings` :
     - `id` = 1 (singleton unique).
     - `enabled` (0 ou 1, 0 par défaut : la suppression automatique commence systématiquement **désactivée**).
     - `retention_days` (entier en jours ou `NULL` tant qu'il n'est pas configuré : affiche « Non configurée »).
     - `log_retention_days` (entier en jours ou `NULL`).
     - `revision` (entier incrémenté à chaque modification pour le contrôle de concurrence optimiste).
     - `updated_at` (timestamp millisecondes UTC).
   - Colonnes ajoutées à la table `galleries` :
     - `retention_exempt` (0 ou 1, 0 par défaut).
     - `retention_exempt_reason` (texte court décrivant le motif sans données personnelles sensibles).
   - Colonnes ajoutées à la table `gallery_deletion_jobs` pour l'audit et le suivi :
     - `decision_source` (source de la décision : `'manual'` ou `'policy_rev_<X>'`).
     - `gallery_title` (titre mémorisé pour l'affichage de l'historique après effacement).
     - `media_count` et `total_size` (métriques réelles des fichiers purgés).
     - `completed_at` (timestamp de finalisation de la purge disque).

2. **Moteur unifié de suppression (`gallery-db.server.ts` & `gallery-retention.server.ts`)** :
   - Service unique pour la suppression unitaire et la suppression groupée (maximum 50 galeries par lot).
   - **Validation transactionnelle préalable** :
     - Vérification de l'existence de chaque galerie, de son statut et de sa révision attendue (`expectedRevision`).
     - En cas de divergence de révision ou d'identifiant inconnu, l'opération échoue globalement avec une erreur HTTP 409 et aucune galerie ne subit de mutation partielle.
     - Annulation immédiate de tout import actif associé aux galeries ciblées.
     - Suppression en cascade immédiate des codes d'accès (`gallery_codes`) et des sessions dans la transaction SQLite.
     - Création d'une intention de suppression durable (`status = 'pending'`) dans `gallery_deletion_jobs`.
   - **Déplacement en quarantaine et suppression physique hors transaction** :
     - Déplacement atomique du dossier de galerie vers `.trash/gallery-deletions/<jobId>` sous permissions strictes `0700`.
     - Les suppressions récursives sur disque ne bloquent jamais la transaction SQLite.
     - Le worker d'arrière-plan traite les jobs en quarantaine, procède à l'effacement définitif et met à jour le statut en `'completed'`.
     - **Reprise après crash** : L'algorithme réconcilie les deux cas possibles après un redémarrage impromptu : fichiers encore à l'emplacement d'origine dans `GALLERY_MEDIA_PATH`, ou fichiers déjà transférés dans `.trash/`.

3. **Politique de rétention et calculs de dates** :
   - **Distinction stricte** :
     - `expires_at` : Date de fin d'accès pour les clients (page et médias retournent 401).
     - `scheduled_purge_at` : Date prévisionnelle de destruction physique calculée en UTC selon la formule :
       $$\text{scheduledPurgeAt} = \text{expiresAt} + (\text{retentionDays} \times 86\,400\,000\text{ ms})$$
     - Tant que `retention_days` est `null`, la purge affiche « Non configurée » et aucune suppression automatique n'a lieu.
   - **Éligibilité à la purge automatique** :
     - Statut obligatoirement publié ou archivé.
     - `expires_at` non nul, échu dans le passé.
     - `scheduled_purge_at` atteint dans le passé.
     - `retention_exempt = 0` (les galeries exemptées sont protégées de la purge automatique).
     - Aucun import en cours (en cas d'import actif, la purge est différée au cycle suivant).
   - **Simulation obligatoire avant enregistrement** :
     - Toute activation (`enabled: true`) ou réduction du délai de rétention exige de simuler l'impact sur l'écran `/admin/data-retention/settings`.
     - La simulation affiche le nombre exact de galeries immédiatement éligibles et le volume estimé.
     - Une confirmation explicite par case à cocher est obligatoire pour enregistrer les paramètres lorsqu'au moins une galerie devient éligible immédiatement.

4. **Exports privés sécurisés (`/api/admin/data-retention/gallery-export`)** :
   - Point d'accès réservé à l'administrateur connecté (`POST` avec vérification stricte `Origin` et CSRF constant-time).
   - **Export JSON structuré** :
     - `schemaVersion: 1`, métadonnées éditoriales bilingues FR/EN, nom client, dates et statuts.
     - Inventaire détaillé des médias : nom original, type, taille, dimensions, hash de contenu SHA-256.
     - Exclusion absolue de tout secret : ni code en clair, ni hash/chiffrement de code, ni token CSRF, ni cookie de session, ni chemin système absolu.
   - **Export archive ZIP des originaux** :
     - Streaming paresseux via `yazl` avec descripteurs de fichiers sécurisés (`openSecureMediaFile` avec `O_RDONLY | O_NOFOLLOW`).
     - Vérification de la chaîne de répertoires contre tout lien symbolique.
     - Quota de concurrence dédié (`MAX_CONCURRENT_EXPORT_ZIPS = 3`) et libération immédiate du slot et des descripteurs en cas d'interruption par le client.
   - Si une suppression est déjà engagée (`pending` ou `processing`), la demande d'export est immédiatement rejetée avec HTTP 409 pour éviter toute extraction tronquée.

5. **Superviseur d'arrière-plan et journalisation technique** :
   - Le superviseur existant dans `gallery-import.server.ts` coordonne périodiquement :
     - Le traitement des suppressions en quarantaine (`processGalleryDeletions`).
     - L'avancement des imports en attente (`processNextPendingImport`).
     - Le cycle de purge automatique (`runRetentionAutoPurgeCycle`).
     - L'élagage des journaux d'audit de suppression finalisés (`pruneRetentionAuditLogs`) selon `log_retention_days`.
   - Journal minimal : identifiant opaque de job, date, volume et nombre de médias, statut final et code d'erreur normalisé. Aucun e-mail, code, nom de client ou chemin système stocké dans l'audit.

## 12. Guide d'exploitation, sauvegardes et restauration (Déploiement Mac mini)

### Sauvegarde à chaud cohérente
Pour sauvegarder l'application Parallax sur le Mac mini de production sans interrompre le service :

1. **Sauvegarde de la base de données SQLite** :
   Utiliser la commande native `VACUUM INTO` ou `.backup` de SQLite pour obtenir un snapshot cohérent même sous trafic actif :
   ```bash
   sqlite3 /Users/profadmin/.parallax-data/gallery.sqlite ".backup '/Users/profadmin/Backups/gallery-$(date +%Y%m%d%H%M%S).sqlite'"
   ```
2. **Sauvegarde du répertoire des médias** :
   Synchroniser le dossier des médias stockés avec `rsync` :
   ```bash
   rsync -a --delete /Users/profadmin/.parallax-data/gallery-media/ /Users/profadmin/Backups/gallery-media/
   ```
3. **Sauvegarde du contenu du site et portfolio** :
   ```bash
   cp /Users/profadmin/.parallax-data/site-content.json /Users/profadmin/Backups/
   rsync -a --delete /Users/profadmin/.parallax-data/portfolio-media/ /Users/profadmin/Backups/portfolio-media/
   ```

### Procédure de restauration sécurisée
Lors de la restauration d'une sauvegarde antérieure (ex: suite à un incident matériel sur le Mac mini) :

> [!WARNING]
> **Risque de réouverture intempestive de galeries purgées** :
> Si une sauvegarde ancienne est restaurée sans précaution, des galeries dont la rétention était expirée et les médias supprimés pourraient réapparaître en base.
> Il est impératif d'isoler le réseau avant de relancer le service Parallax.

1. **Arrêt complet du serveur Node.js** :
   S'assurer qu'aucun processus Parallax n'est actif.
2. **Restauration des fichiers SQLite et médias** :
   Restaurer la base `gallery.sqlite` et le dossier `gallery-media/`.
3. **Réconciliation hors ligne avant réouverture réseau** :
   - Démarrer l'application avec `PARALLAX_LOCAL_PREVIEW=true` sur `127.0.0.1`.
   - Se connecter à l'administration `/admin/data-retention`.
   - Vérifier la cohérence entre les galeries présentes en base et les dossiers réels sur disque.
   - Si la politique automatique était active, s'assurer que les dates d'expiration des galeries restaurées reflètent la volonté de l'opérateur (au besoin, activer l'exemption de rétention sur les galeries restaurées avant de réactiver le service public).
4. **Réouverture du service public en production**.

### Limites matérielles et effacement SSD
- L'appel système `unlink` sous macOS / APFS marque les blocs de données comme non alloués dans le système de fichiers.
- Sur les supports SSD (comme le stockage flash interne des Mac mini), l'effacement physique effectif des cellules dépend des cycles d'usure (wear-leveling) et des commandes TRIM opérées par macOS.
- Le module de rétention garantit la révocation logique immédiate, la suppression des métadonnées applicatives et la libération des fichiers au niveau du système de fichiers, sans prétendre à un écrasement multipasse magnétique de bas niveau.
