# Cartographie de Réutilisation Sempra -> Parallax

Ce document inventorie formellement les briques techniques de référence du projet Sempra (`TimelessWebSite`, commit `89bfee31ae5d477f71c95e83a0d55305521f426f`), définit leur statut de réutilisation pour Parallax, et détaille les adaptations nécessaires.

---

## Statut d'avancement par lot

| Brique technique | Périmètre Sempra | Statut Parallax | Lot d'implémentation |
|---|---|---|---|
| **Authentification & Session Admin** | `auth.server.ts`, `session.server.ts` | **Porté et adapté** | **Lot 1 & 1 bis** (`apps/web/app/lib/auth.server.ts`, `session.server.ts`) |
| **Sécurité des requêtes & Rate limiting** | `security.server.ts`, `rate-limit.server.ts` | **Porté et adapté** | **Lot 1 & 1 bis** (`apps/web/app/lib/security.server.ts`, `rate-limit.server.ts`) |
| **Headers de sécurité & CSP SSR** | `entry.server.tsx` | **Porté et adapté** | **Lot 1 & 1 bis** (`apps/web/app/entry.server.tsx`) |
| **Outil de hachage CLI** | `scripts/admin-hash.js` | **Porté et adapté** | **Lot 1 & 1 bis** (`apps/web/scripts/admin-hash.js`) |
| **Schéma éditorial & Persistance atomique** | `site-content.server.ts`, `atomic-fs.server.ts` | **Porté et adapté** | **Lot 2** (`apps/web/app/lib/site-content.server.ts`, `site-content.shared.ts`, `atomic-fs.server.ts`) |
| **Pipeline d'import d'images de site (Lot 2 bis)** | `api.admin.home-image.ts`, `home-media.server.ts`, `portfolio-image.server.ts`, `media.home.*.tsx`, `ImageUploader.tsx` | **Porté et adapté** | **Lot 2 bis** (`apps/web/app/lib/media-image.server.ts`, `routes/media/site-variant.ts`, `routes/api/admin-media-upload.ts`, `ImageUploader.tsx`) |
| **Galeries privées & Téléchargements ZIP** | `gallery-*.server.ts`, code unique | **Porté et adapté** | **Lot 4** (`apps/web/app/lib/gallery-*.server.ts`, routes client/admin) |
| **Previews WebP / Sharp** | `gallery-preview.server.ts`, `portfolio-image.server.ts` | **Porté et adapté** | **Lot 4 / Lot 3** (`apps/web/app/lib/gallery-preview.server.ts`, `media-image.server.ts`) |
| **Suppression & Rétention RGPD** | `gallery-deletion-worker.server.ts` | **Porté et adapté** | **Lot 5** (`apps/web/app/lib/gallery-deletion-worker.server.ts`, `data-retention.server.ts`) |
| **Formulaire Contact & Mailer** | `contact.server.ts`, `mailer.server.ts` | **Porté et adapté** | **Lot 6** (`apps/web/app/lib/contact.server.ts`, `mailer.server.ts`, routes Contact) |
| **Pages légales & Inventaire cookies** | `admin.legal.tsx`, cookies techniques | **Porté et adapté** | **Lot 7** (`apps/web/app/routes/admin/legal-*.tsx`, `public/legal-*.tsx`, `lib/privacy-preferences.*`) |
| **Tests E2E & Runner Playwright** | `run-e2e.js`, `playwright.config.ts` | **Différé** | Lot dédié ultérieur |

---

## 1. Authentification et sessions

1. **Fichiers consultes (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/lib/auth.server.ts`
   - `apps/web/app/lib/session.server.ts`
   - `apps/web/app/lib/admin-auth.server.ts`
   - `apps/web/app/lib/env.server.ts`
   - `apps/web/app/routes/admin.tsx`

2. **Fonctions, types et comportements observes** :
   - `getAdminConfig()` : valide la presence de `ADMIN_PASSWORD_HASH` (format argon2id) et `ADMIN_SESSION_SECRET` (>= 32 car.), leve une reponse 503 sinon.
   - `computeCredentialVersion()` : HMAC SHA-256 du hash avec le secret pour versionner les identifiants et invalider les sessions en cas de rotation.
   - `verifyAdminPassword(password)` : verification securisee par `@node-rs/argon2`.
   - `requireAdminSession(request)` et `constantTimeEqual(a, b)` : verification de session en temps constant.
   - `getSessionStorage()`, `getSession()`, `commitSession()`, `destroySession()` dans `session.server.ts` : cookie `__admin_session` (httpOnly, strict, maxAge 8h, secrets signes).
   - `requireValidAdminSession(request)` dans `admin-auth.server.ts` : redirection `/admin` avec destruction du cookie si session invalide.

3. **Choix** :
   - **Porté et adapté au Lot 1 & 1 bis**.

4. **Adaptations Parallax** :
   - Renommer le cookie de session (`__parallax_admin_session`).
   - Utiliser les variables d'environnement propres a Parallax (`ADMIN_SESSION_SECRET`, `ADMIN_PASSWORD_HASH`).
   - Duree de session bornee a 8h validee cote serveur via timestamp signe (`expiresAt`).
   - Session anonyme temporaire pour acheminer le CSRF sans privileges admin, avec regeneration complete de session et rotation du CSRF apres connexion.
   - Aligner les redirections et en-tetes sur les routes Parallax (`/admin`, `/admin/dashboard`, `/admin/logout`).

5. **Tests Sempra pertinents** :
   - `apps/web/tests/admin-auth.server.test.ts`
   - `apps/web/tests/admin-auth.test.ts`
   - `apps/web/tests/admin-hash.test.ts`

6. **Elements non verifies** :
   - Comportement multi-onglets lors d'une rotation de cle a chaud en production.

---

## 2. Origin, lecture bornee des requetes et securite

1. **Fichiers consultes (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/lib/security.server.ts`
   - `apps/web/app/lib/admin-auth.server.ts`
   - `apps/web/app/lib/rate-limit.server.ts`
   - `apps/web/app/entry.server.tsx`

2. **Fonctions, types et comportements observes** :
   - `validateOrigin(request)` : compare strictement l'en-tete Origin avec `ENV.PUBLIC_SITE_URL`.
   - `getClientIp(request)` : resolution securisee de l'IP (`cf-connecting-ip` / `x-forwarded-for` filtrees via `net.isIP`, rejet des IP multiples) si `TRUST_PROXY=true`.
   - `readStrictFormUrlEncoded(request, maxBytes)` : flux borne de lecture bloquant les payloads excessifs des la reception des premiers chunks.
   - `requireSecureAdminMutation(request)` : enforce POST, `validateOrigin`, `Content-Type: application/x-www-form-urlencoded`, lecture streaming bornee a 128 Ko (`MAX_MUTATION_SIZE`), `ActionSecurityError`.
   - `validateAdminFormData(request)` : validation de token CSRF en temps constant sans module externe separe.
   - `checkRateLimit(ip, namespace)` : fenetre glissante persistee sous SQLite (`node:sqlite`) avec indexation sur hash HMAC et horodatage, transactions exclusives.
   - `entry.server.tsx` : generation de nonce cryptographique (`generateNonce`), injection de nonce dans `ServerRouter` pour l'hydratation SSR, en-tetes `nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy`.

3. **Choix** :
   - **Porté et adapté au Lot 1 & 1 bis**.

4. **Adaptations Parallax** :
   - Validation stricte de l'Origin interdisant identifiants, requetes ou chemins.
   - Lecture bornee en streaming a 8 Kio pour l'authentification et la deconnexion avec verification des champs autorises et rejet des doublons.
   - Limitation transactionnelle SQLite a 5 tentatives sur 15 minutes, IP anonymisee par HMAC-SHA256 avec cle dediee, dossier prive 0700 et fichier 0600.
   - En-tetes SSR `Cache-Control: no-store` et `X-Robots-Tag: noindex, nofollow` appliques a toutes les reponses d'administration.

5. **Tests Sempra pertinents** :
   - `apps/web/tests/security.server.test.ts`
   - `apps/web/tests/rate-limit-security.test.ts`
   - `apps/web/tests/admin-csrf.test.ts`

6. **Elements non verifies** :
   - Comportement derriere un reverse-proxy specifique autre que Cloudflare en configuration `TRUST_PROXY`.

---

## 3. Contenus et persistance

1. **Fichiers consultes (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/lib/site-content.server.ts`
   - `apps/web/app/lib/atomic-fs.server.ts`

2. **Fonctions, types et comportements observes** :
   - `validateSiteContent(data)` : validateurs stricts ecrits a la main pour chaque section (PAS de schema Zod dans ce module).
   - Detection des conflits de revision : chaque fonction de mise a jour (`saveSettings`, `saveLegalPageDraft`, etc.) exige un parametre `previousRevision` et refuse l'ecriture avec une erreur 409 si la revision du fichier disque a evolue.
   - `atomicWrite(filePath, content)` et `atomicWriteJson(filePath, data)` dans `atomic-fs.server.ts` : ecriture dans un fichier temporaire (`.tmp.[hex]`), `fsyncSync` du descripteur de fichier et du repertoire, puis renommage atomique (`renameSync`). Creation d'une copie de sauvegarde (`.bak`) prealable et rotation des 5 derniers backups (`rotateBackups`), permissions 0600.
   - Note sur la concurrence : l'ecriture atomique garantit l'integrite physique du fichier en cas de plantage, mais ne constitue pas un verrouillage distribue entre processus distincts (d'ou la necessite de la detection de revision).

3. **Choix** :
   - **Porté et adapté au Lot 2**.

4. **Adaptations Parallax** :
   - Schema de contenu neuf demarrant directement en `schemaVersion: 1`.
   - Structure editoriale propre a Parallax : Showreel (avec modal de consentement tiers sans tiers au simple affichage), Fondateurs (Maxime & Ludovic), Rubriques de creation photo & video (ponctuation simple, sans tirets cadratins/demi-cadratins), bloc dedie SEMPRA distinct, Studio (intro, portraits, approche).
   - Separation claire `site-content.shared.ts` (interfaces, `ALLOWED_IMAGE_MAP`, `resolveAllowedImage`) pour eviter toute fuite de code serveur dans le build client Vite, et `site-content.server.ts` (I/O, mutations atomiques, validation).
   - Emplacement externe configure par `SITE_CONTENT_PATH` (ex: `/Users/profadmin/.parallax-data/site-content.json`). Fichier initialise a partir de `default-site-content.json` uniquement s'il n'existe pas ; aucune reinitialisation au redemarrage.
   - Formulaires d'administration Accueil (`/admin/home`) et Studio (`/admin/studio`) : validation serveur stricte, lecture bornee a 500 Ko, validation Origin/CSRF, protection anti-conflit de revision 409 preservant les saisies utilisateur, et etats accessibles (`role="status"`, `role="alert"`).
   - Selection d'images bornee strictement a `ALLOWED_IMAGE_MAP` ; aucun chemin de fichier arbitraire accepte en saisie.

5. **Tests Parallax utiles portes de Sempra** :
   - `apps/web/tests/atomic-fs.server.test.ts` (ecriture atomique, fsync, backups .bak, rotation a 5 fichiers, permissions 0600)
   - `apps/web/tests/site-content.server.test.ts` (initialisation, validation, persistance, conflit 409)
   - `apps/web/tests/editorial-routes.test.ts` (loaders/actions publics et admin, protection de session, mutations)
   - `apps/web/tests/preview-mode.test.ts` (contraintes strictes de previsualisation locale et runner)

6. **Elements non verifies** :
   - Performance de lecture synchrone repetee lors de tres fortes charges concurrentes sans couche de memoire cache.

---

## 3 bis. Pipeline d'import d'images de site (Lot 2 bis)

1. **Fichiers consultés (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/routes/api.admin.home-image.ts`
   - `apps/web/app/lib/home-media.server.ts`
   - `apps/web/app/lib/portfolio-image.server.ts`
   - `apps/web/app/routes/media.home.$imageId.$variant.tsx`
   - `apps/web/app/components/admin/ImageUploader.tsx`

2. **Fonctions, types et comportements observés** :
   - Réception multipart/form-data en streaming avec `busboy`, borne stricte de taille (25 Mo).
   - Pipeline Sharp produisant des variantes WebP (qualité 82) et AVIF (qualité 65, effort 4) pour les points de rupture (640p, 960p, 1440p, 1920p).
   - Auto-orientation EXIF via `sharp.rotate()`, espace sRGB, stripping de métadonnées pour protéger la vie privée.
   - `ConcurrencyLimiter(2)` bornant à 2 les traitements Sharp simultanés pour préserver les ressources serveur.
   - Route de diffusion des variantes avec calcul d'ETag, statut 304, et en-têtes de cache immuables (`Cache-Control: public, max-age=31536000, immutable`).

3. **Choix** :
   - **Porté et adapté au Lot 2 bis** (`apps/web/app/lib/media-image.server.ts`, `apps/web/app/routes/media/site-variant.ts`, `apps/web/app/routes/api/admin-media-upload.ts`, `apps/web/app/components/admin/ImageUploader.tsx`).

4. **Adaptations et durcissements Parallax** :
   - Suppression totale du moteur de filigrane (watermark) Sempra.
   - Support des 4 emplacements éditoriaux actuels (`showreel_cover`, `duo`, `portrait_ludovic`, `portrait_maxime`).
   - Rétablissement vers l'image de référence par défaut (`x-media-action: revert`).
   - Validation décimale stricte de `Content-Length` (`/^\d+$/`) rejetant toute valeur partiellement numérique.
   - Saturation du limiteur traduite par une exception dédiée `ConcurrencyLimitError` retournant HTTP 503 avec en-tête `Retry-After: 2`.
   - Isolation en staging privé (`staging/<imageId>`) prévenant la suppression prématurée des fichiers en cours par un import concurrent terminant son nettoyage.
   - Publication coordonnée avec vérification de révision avant `renameSync` atomique et rollback circonscrit aux seuls fichiers de l'import en cas de 409.
   - Confinement strict des chemins via `verifySecurePathChain` examinant chaque composant (`site`, emplacement, UUID, variante, fichier) avec `lstatSync` sans suivre les liens symboliques, avec `O_NOFOLLOW` complémentaire et gestion d'erreurs en 404 sans fuite de chemins.
   - Rétention bornée et rotation réelle : exploitation de `getBackups(siteContentPath)` de `atomic-fs.server.ts` préservant les variantes des 5 sauvegardes physiques, purge des anciennes métadonnées non rattachées et report sécurisé du nettoyage en cas de sauvegarde illisible.
   - Validation de cohérence des références importées lors des sauvegardes de formulaire : UUID connu, correspondance clé/métadonnées, emplacement cohérent et variantes valides.

5. **Tests Parallax utiles** :
   - `apps/web/tests/media-image.server.test.ts`
   - `apps/web/tests/admin-media-upload.test.ts`
   - `apps/web/tests/site-variant.route.test.ts`
   - `apps/web/tests/confinement-security.test.ts`
   - `apps/web/tests/bounded-retention.test.ts`
   - `apps/web/tests/concurrent-upload-isolation.test.ts`

6. **Éléments non vérifiés** :
   - Remplacement concurrent des dossiers sur le disque par un acteur local en temps réel (race condition d'OS local sans garantie absolue démontrée).

---

## 4. Portfolio et medias publics (Lot 3)

1. **Fichiers consultes (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/lib/portfolio-content.server.ts` : validation Zod V2, révisions, sauvegardes atomiques, slugs uniques, ordre et filtrage public.
   - `apps/web/app/lib/portfolio-image.server.ts`, `portfolio-media.server.ts` et `portfolio-transaction.server.ts` : traitement des variantes, distribution et coordination fichiers/métadonnées.
   - `apps/web/app/routes/admin.portfolio.tsx` et `admin.portfolio.upload.tsx` : administration et upload.
   - `apps/web/app/routes/PortfolioPage.tsx`, `fr.portfolio.tsx` et `en.portfolio.tsx` : filtrage public, rendu responsive et consentement vidéo.

2. **Fonctions, types et comportements observes** :
   - `getPortfolioContent()`, `savePortfolio()`, révision aléatoire et rotation des backups physiques.
   - Slugs uniques dans l'espace de noms des rubriques.
   - Streaming sécurisé avec contrôle d'accès, types MIME, `O_NOFOLLOW` et en-têtes HTTP immuables (`Cache-Control: public, max-age=31536000, immutable`).
   - `ConcurrencyLimiter(2)` bornant les traitements Sharp simultanés.
   - Traitement par lot côté client avec file séquentielle d'upload.

3. **Choix** :
   - **Porté et adapté au Lot 3** :
     - Modèle éditorial : `apps/web/app/lib/portfolio-content.shared.ts`, `apps/web/app/lib/portfolio-content.server.ts`.
     - Administration : `apps/web/app/routes/admin/portfolio.tsx`, `apps/web/app/routes/admin/portfolio-edit.tsx`, `apps/web/app/routes/admin/portfolio-section.tsx`.
     - Upload & Médias : `apps/web/app/routes/api/admin-portfolio-upload.ts`, `apps/web/app/routes/media/portfolio-variant.ts`, `apps/web/app/routes/admin/portfolio-media.ts`.
     - Vitrine publique & panneaux : `apps/web/app/routes/public/portfolio.tsx`, `apps/web/app/components/public/ResponsivePortfolioImage.tsx`, `apps/web/app/lib/localized-urls.ts`.

4. **Adaptations et durcissements Parallax** :
   - **Modèle de réalisations Parallax (schemaVersion 1)** : remplacement du catalogue de photos individuelles Sempra par des réalisations structurées (titre, résumé, blocs de contenu typés, SEO, galerie d'images ordonnée, vidéo YouTube/Vimeo avec couverture dédiée, side auto/left/right, ordre, statut brouillon/publié, archivage).
   - **Deux rubriques structurelles stables** : `documentary` (Documentaire / Documentary) et `advertising` (Publicité / Advertising) administrables (titre, intro, couverture, showreel vidéo, boutons) sans possibilité de suppression des identifiants métier.
   - **Panneau coulissant directionnel unique** : transition 500ms `cubic-bezier(0.7, 0, 0.2, 1)`, formule déterministe obligatoire `const panelDirection = imageSide === "left" ? "right" : "left"` garantissant l'ouverture depuis la droite si l'image est à gauche et depuis la gauche si l'image est à droite (permettant deux directions distinctes pour la rubrique Publicité selon la rangée cliquée). Navigation entre rubrique et fiche réalisation dans le même panneau sans modales empilées.
   - **Séparation stricte des stockages** : variables `PORTFOLIO_CONTENT_PATH` et `PORTFOLIO_MEDIA_PATH` séparées de `SITE_CONTENT_PATH` et `SITE_MEDIA_PATH`. Le nettoyage d'un sous-système ne parcourt ni ne supprime jamais les fichiers de l'autre.
   - **Pipeline d'import d'images de portfolio** : réutilisation de `verifySecurePathChain`, `atomicWriteJson` et partage du `ConcurrencyLimiter(2)` Sharp avec `SITE_MEDIA_PATH`. Saturation 503 avec `Retry-After: 2`. File séquentielle bornée côté client avec rafraîchissement de la révision serveur à chaque étape et préservation des textes/sélections en cas d'upload ou de 409.
   - **Rétention bornée et rotation réelle** : 5 vrais backups physiques conservés, détection des orphelins excluant les images référencées par les sauvegardes valides et report sécurisé de purge si une sauvegarde est illisible.
   - **Diffusion sécurisée** : contrôle strict que l'image demandée est référencée par un projet effectivement publié ou une rubrique publique. Les brouillons ne sont consultables que via la route d'aperçu d'administration authentifiée.
   - **SEO, hreflang et header partagé** : routes localisées `/fr/projets`, `/fr/projets/documentaire`, `/fr/projets/publicite`, `/fr/projets/:rubrique/:slugFr` et équivalents `/en/projects/*` avec balises canoniques, hreflang et synchronisation de la langue préservant la réalisation active.

5. **Tests Parallax utiles** :
   - `apps/web/tests/portfolio-content.test.ts`
   - `apps/web/tests/portfolio-routes.test.ts`
   - `apps/web/tests/video.test.ts`
   - `apps/web/tests/env.server.test.ts`

6. **Éléments non vérifiés** :
   - Navigateurs mobiles WebKit anciens (< iOS 15) pour les animations complexes de backdrop-filter.


---

## 5. Galeries privees et telechargement ZIP (Lot 4)

1. **Fichiers consultes (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/lib/gallery-db.server.ts` : moteur SQLite dedie, PRAGMAs WAL, foreign keys, baux workers et jobs de suppression.
   - `apps/web/app/lib/gallery-auth.server.ts` : derivation HKDF-SHA256, chiffrement AES-256-GCM, HMAC-SHA256 des codes, cookie de session client signe `__gallery_session`, CSRF. (Note de clarification : les fichiers `gallery-session.server.ts` et `crypto.server.ts` mentionnes dans les esquisses initiales n'existent pas dans Sempra a ce commit : ces responsabilites sont integralement concentrees dans `gallery-auth.server.ts`).
   - `apps/web/app/lib/gallery.server.ts` : modele, creation atomique galerie et code, revision optimiste, rotation de code.
   - `apps/web/app/lib/gallery-import.server.ts` : inspection de dossier, baux workers atomiques avec renouvellement conditionnel, copie securisee en streaming.
   - `apps/web/app/lib/media-utils.ts` et `apps/web/app/routes/api.gallery.$publicId.media.$mediaId.ts` : RFC 7233 Range streaming video (206, Content-Range, Accept-Ranges, 416).
   - `apps/web/app/routes/api.gallery.$publicId.download.ts` : generation et streaming d'archives ZIP via `yazl` avec `compress: false`. (Note de clarification : `gallery-zip.server.ts` n'existe pas a ce commit : la logique de streaming ZIP est portee directement dans sa route de telechargement).
   - `apps/web/app/routes/api.admin.gallery.$id.media.$mediaId.poster.ts` : televersement multipart streaming de poster video Sharp.
   - Routes client : `apps/web/app/routes/fr.clients.tsx`, `en.clients.tsx`, `fr.gallery.tsx`, `en.gallery.tsx`, `GalleryView.tsx`.
   - Routes admin : `apps/web/app/routes/admin.galleries._index.tsx`, `admin.galleries.new.tsx`, `admin.galleries.$id.tsx`.

2. **Fonctions, types et comportements observes** :
   - SQLite isole avec baux workers `UPDATE ... RETURNING` et verification stricte du proprietaire avant tout effet persistant.
   - Chiffrement AES-256-GCM avec nonce aleatoire pour reveler les codes aux administrateurs sans stockage en clair.
   - HMAC-SHA256 pour indexation rapide sans clair.
   - Cookie `__parallax_gallery_session` signe et cloisonne de l'admin.
   - Streaming ZIP yazl sans compression des medias deja compresses (`compress: false`), avec ouverture progressive des descripteurs pour eviter toute saturation memoire.

3. **Choix** :
   - **Porté et adapté au Lot 4**.

4. **Adaptations Parallax** :
   - **Modele a code unique strict** : suppression totale des branches invites/maries, des tables ou colonnes `guest_*`/`couple_*` et de tout vocabulaire mariage dans le code, la base et l'interface.
   - Schéma SQLite V1 neuf, propre et direct, sans chaine de migrations historiques Sempra.
   - Normalisation unique du code (insensible a la casse et aux tirets).
   - Protection de confinement de chemin appliquee a chaque niveau (`verifySecurePathChain` et `O_NOFOLLOW`).
   - Stockage independant defini par `GALLERY_DB_PATH`, `GALLERY_MEDIA_PATH` et `GALLERY_IMPORT_PATH`.
   - Script de setup idempotent `scripts/gallery-setup.js` configure via `npm run gallery:setup`.

5. **Tests Parallax utiles** :
   - `apps/web/tests/gallery-db.server.test.ts`
   - `apps/web/tests/gallery-auth.server.test.ts`
   - `apps/web/tests/gallery-import-worker.server.test.ts`
   - `apps/web/tests/gallery-media.server.test.ts`
   - `apps/web/tests/gallery-zip.server.test.ts`
   - `apps/web/tests/admin-galleries.test.ts`
   - `apps/web/tests/gallery-setup.test.ts`

6. **Elements non verifies** :
   - Comportement lors de telechargements simultanes de ZIP par plus de 50 clients concurrents (necessite un banc de charge de production).

---

## 6. Previews publiques et privees

1. **Fichiers consultes (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/lib/gallery-preview.server.ts`
   - `apps/web/app/lib/portfolio-image.server.ts`
   - `apps/web/scripts/generate-previews.ts`

2. **Fonctions, types et comportements observes** :
   - Pipeline de galerie privee dans `gallery-preview.server.ts` :
     - Tailles standardisees : `ALLOWED_WIDTHS = [480, 960, 1920]`.
     - 480 px (qualite WebP 80) pour les vignettes de grille compacte.
     - 960 px (qualite WebP 80) pour l'affichage standard de grille.
     - 1920 px (qualite WebP 84) reserve a la lightbox plein ecran.
     - Les fichiers originaux ne sont jamais servis en preview et sont reserves aux routes de telechargement authentifiees.
     - `ConcurrencyLimiter(2)` : plafond strict de 2 operations Sharp simultanees pour preserver la memoire et le CPU de l'hote.
     - `pendingGenerations` : table de promesses dedoublonnant les requetes concurrentes sur une meme variante.
     - `sharp.rotate()` : conservation imperative de l'orientation EXIF.
     - `enforceSafePath()` : protection contre la traversee de repertoire et interdiction des liens symboliques.
   - Pipeline des medias publics dans `portfolio-image.server.ts` : generation des variantes adaptees a la mise en page du site.

3. **Choix** :
   - **Porté et adapté** (Lot 3 pour les variantes de portfolio, Lot 4 pour les variantes WebP 480/960/1920 de galerie privée).

4. **Adaptations Parallax** :
   - Separation nette entre variantes publiques (adaptees aux grilles du site et portfolio) et variantes de galerie privee (480, 960, 1920 px WebP).
   - Variantes 480 et 960 pour la grille masonry, 1920 reserve a la lightbox. Aucun fallback vers l'original pour eviter tout telechargement implicite de fichier lourd.
   - Partage du limiteur global Sharp `imageProcessingLimiter` borne a 2 operations simultanees.
   - Confinement strict via `verifySecurePathChain` et `O_NOFOLLOW`.
   - Dimensions reelles persistees dans les metadonnees pour eviter tout ecart d'affichage.

5. **Tests Sempra pertinents** :
   - `apps/web/tests/gallery-preview.server.test.ts`
   - `apps/web/tests/generate-previews.script.test.ts`
   - `apps/web/tests/poster-fs.test.ts`

6. **Elements non verifies** :
   - Temps d'execution de la conversion batch pour un volume important de fichiers RAW ou tres haute resolution (> 45 MP).

---

## 7. Suppression et rétention (Lot 5)

1. **Fichiers consultés (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/routes/admin.data-retention.tsx` : Structure de l'interface de recherche, sélection bornée, modale de confirmation, suivi des jobs et relance.
   - `apps/web/app/routes/admin.data-retention.module.css` : Présentation des listes tabulaires, badges de statut et boîtes de dialogue modales.
   - `apps/web/app/lib/gallery-db.server.ts` : Suppression transactionnelle avec intention durable, quarantaine `.trash` et journalisation.
   - `apps/web/app/lib/gallery-deletion-worker.server.ts` : Traitement par lots sous baux avec tentatives bornées, erreurs sûres et relance de jobs échoués.
   - `apps/web/tests/admin-data-retention-gallery.server.test.ts` : Cas de tests transactionnels, fichiers disque, isolation de la source, rejet des symlinks, reprise après crash et échecs groupés.
   - `apps/web/app/routes/api.admin.data-retention.booking-export.ts` : Architecture d'un point d'accès d'export sécurisé d'administration.
   - `apps/web/e2e/data-retention.spec.ts` : Scénarios d'accessibilité clavier, modale et focus trap (consultés statiquement).

2. **Éléments non repris de Sempra** :
   - Aucune réservation, calendrier, contact couple ou terminologie de mariage (galeries de projets studio Parallax uniquement).
   - Aucun niveau d'accès invité / couple.
   - Aucune durée de conservation arbitraire ou légale inventée (pas de règle fixe de 24 mois imposée).
   - Aucune migration historique Sempra ni table bookings.
   - Aucun effacement direct sur disque avant validation de l'intention en base de données.

3. **Adaptations et durcissements Parallax** :
   - **Moteur unique de suppression** : Rapprochement de la suppression unitaire (éditeur de galerie) et de la suppression groupée (tableau de rétention) via un service unique `deleteGalleriesWithIntentBulk`.
   - **Politique de rétention désactivée par défaut** : La politique automatique s'initialise à `enabled: 0` avec un délai `retention_days: NULL` (« Non configurée »). Aucune purge automatique n'intervient sans configuration et activation explicites dans l'administration.
   - **Prévisualisation d'impact obligatoire** : Toute activation ou réduction du délai de rétention exige une simulation préalable affichant la liste exacte des galeries immédiatement éligibles et le volume estimé, avec confirmation explicite par case à cocher.
   - **Sélection groupée bornée** : Limitation stricte à 50 galeries par lot avec validation de révision optimiste (renvoi d'erreur 409 et préservation de la saisie sans altération partielle en cas de conflit).
   - **Quarantaine sécurisée et reprise sur crash** : Les médias sont déplacés dans `.trash/gallery-deletions/<jobId>` (permissions `0700`) en dehors de la transaction SQLite. La réconciliation post-crash gère les fichiers restés à l'origine comme ceux déjà en quarantaine.
   - **Protection des sources d'import** : Les fichiers originaux déposés dans `gallery-import/<projet>/` ne sont jamais supprimés par la purge automatique ; le bilan signale les dossiers sources connus avec instructions de nettoyage manuel.
   - **Exports privés sécurisés** : Export métadonnées JSON sans secrets, codes chiffrés, sessions, IP ni chemins système ; export archive ZIP streaming paresseux protégé par `O_NOFOLLOW` avec annulation immédiate des descripteurs.
   - **Accessibilité WAI-ARIA** : Modale accessible sans styles inline, piège de focus complet, fond inerte (`aria-hidden`), fermeture par touche Échap et restauration du focus.

---

## 8. Contact et mailer

1. **Fichiers consultes (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/lib/contact.server.ts`
   - `apps/web/app/lib/mailer.server.ts`
   - `apps/web/app/routes/fr.contact.tsx`
   - `apps/web/app/routes/en.contact.tsx`

2. **Fonctions, types et comportements observes** :
   - `processContactAction(request, lang)` : verification d'origine, controle `MAX_BODY_SIZE` (100 Ko), rate limit, sanitisation des champs texte contre l'injection d'en-tetes, validation de format d'e-mail.
   - `sendContactEmail(formData, lang)` : creation de transporteur Nodemailer reutilisable, obligation de TLS (`requireTLS: true`), gestion des timeouts socket/connexion.
   - Envoi d'un double e-mail : notification a l'equipe et accuse de reception au contact.

3. **Choix** :
   - **Porté et adapté pour le Lot 6 (`feat/contact-mailer`)**.

4. **Adaptations Parallax** :
   - **Champs du formulaire conformes au prototype Parallax** (`References/parallax-site/contact.html`) :
     - Nom ou société (1-100 caractères, sans retours chariot CRLF) ;
     - E-mail (1-254 caractères, validation stricte, sans CRLF) ;
     - Téléphone (facultatif, max 50 caractères, sans CRLF) ;
     - Échéance souhaitée (facultative, max 120 caractères, ex: "Printemps 2027", sans CRLF) ;
     - Type de projet : 5 options strictes configurables (`Clip musical`, `Publicité`, `Portrait`, `Documentaire`, `Autre`) ;
     - Message (1-5000 caractères) ;
     - Notice de traitement des données avec lien optionnel vers la politique de confidentialité.
   - **Anti-spam et sécurité renforcée** :
     - Jeton signé HMAC `_token` combinant un horodatage d'émission et un nonce avec secret `RATE_LIMIT_SECRET` (délai minimal 2s, expiration 2h).
     - Champ piège honeypot discret `website` (rejet immédiat 400).
     - Rate Limiting persistant indépendant sous le namespace SQLite `contact` (5 soumissions / heure / IP). Ne se réinitialise jamais après un succès pour neutraliser les attaques par rafale.
     - Table anti-rejeu et dédoublonnage `contact_claims` : réservation atomique SQLite empêchant l'envoi multiple lors d'un double-clic ou de soumissions concurrentes.
     - Redirection PRG (Post-Redirect-Get) 303 avec cookie signé éphémère `__parallax_contact_flash` consommé dès l'affichage. `?success=true` ne déclenche aucun faux succès.
     - Réinitialisation intégrale du formulaire au succès.
     - Pré-remplissage propre via paramètre `?type=`.
   - **Mailer sécurisé (`mailer.server.ts`)** :
     - Nodemailer avec support Node 24.
     - Chiffrement TLS strict : Port 587 STARTTLS obligatoire (`requireTLS: true`), Port 465 TLS direct (`secure: true`). Validation stricte des certificats (`rejectUnauthorized: true`, support de `SMTP_CA_CERT` pour tests locaux).
     - Nettoyage des erreurs : aucun mot de passe, adresse de visiteur ou corps de message n'est journalisé (codes sûrs : `SMTP_UNCONFIGURED`, `SMTP_AUTH_FAILED`, `SMTP_CONN_REFUSED`, `SMTP_TLS_FAILED`, `SMTP_TIMEOUT`).
     - Pas d'accusé de réception automatique non sollicité au visiteur afin d'éviter le relais de spam (backscatter).
   - **Administration dédiée (`/admin/contact`)** :
     - Édition complète bilingue FR/EN (SEO, Hero, formulaires, messages système).
     - Activation / désactivation des 5 types de projet.
     - Coordonnées synchronisées canoniquement avec `home.contact` (e-mail, Instagram, YouTube) et numéro de téléphone direct.
     - Badge en direct de l'état SMTP (configuré / incomplet / invalide) sans fuite de secrets.
     - Contrôle de conflit de révision optimiste (HTTP 409) préservant la saisie en cours.
   - **Diagnostic CLI autonome** :
     - Commande `npm run smtp:verify` testant la configuration et la poignée de main TLS sans envoyer d'e-mail.

5. **Tests Parallax livrés** :
   - `apps/web/tests/mailer-smtp.test.ts` (9 tests avec faux serveur SMTP local `smtp-server` sur `127.0.0.1:0` et certificat CA local, STARTTLS, rejet de certificats, assainissement CRLF).
   - `apps/web/tests/contact.server.test.ts` (18 tests couvrant les jetons, cookies flash, honeypot, limites de corps, doublons, rate limiting et table `contact_claims`).
   - `apps/web/tests/admin-contact.test.ts` (7 tests couvrant la migration V1->V2, l'enregistrement atomique, la synchronisation des coordonnées et les conflits 409).
   - `apps/web/tests/contact-ui.test.tsx` (7 tests validant l'accessibilité, le pré-remplissage `?type=`, les états de soumission et les badges SMTP admin).
   - Zéro e-mail réel expédié, zéro utilisation de données privées.

6. **Elements non verifies** :
   - Délivrabilité réelle sur les serveurs SMTP finaux en production (dépendra du paramétrage SPF, DKIM et DMARC du domaine final de l'opérateur).

---

## 9. Pages legales et conformite

1. **Fichiers consultes (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/routes/admin.legal.tsx`
   - `apps/web/app/lib/site-content.server.ts` (validateurs `validateLegalDocument`, `validateLegalPageState`, `validateCookieInventoryItem`)
   - `apps/web/app/routes/fr.legal.tsx`, `fr.privacy.tsx`, `fr.cgv.tsx`, `fr.cookies.tsx` (et equivalents `/en/`)

2. **Fonctions, types et comportements observes** :
   - Cycle de vie documentaire complet : statut brouillon (`draft`), version publiee (`published`), historique archive (`archived`) et possibilite de restaurer une version anterieure.
   - Inventaire structure des cookies techniques sans cookie traceur publicitaire.
   - Validation stricte des sections legales bilingues.

3. **Choix** :
   - **Porté et adapté au Lot 7**.

4. **Adaptations Parallax** :
   - **Cycle de vie documentaire étanche** : Séparation stricte `draft` vs `published` pour les 4 pages légales FR/EN (`mentions`, `privacy`, `terms`, `cookies`). Incrément de version automatique à la publication, validation stricte anti-placeholders (`[à compléter]`), blocage de la publication des mentions sans identification complète de l'entreprise (dénomination, adresse, BCE, hébergeur).
   - **Paramètres d'entreprise et synchronisation canonique** (`/admin/company`) : Synchronisation atomique et canonique des coordonnées (`common.brandName`, `home.contact.email`, `home.contact.instagramUrl`, `home.contact.youtubeUrl`, `contactPage.card.phone`).
   - **Protection contre les fuites d'identité et de brouillon** : Filtrage strict des getters publics (`getPublicCompanyContent()`, `getPublicLegalDocument()`). Aucune fuite d'adresse privée non confirmée ou de texte de brouillon dans les payloads JSON ou le HTML SSR public.
   - **Prévisualisation privée authentifiée** (`/admin/legal/:pageKey/preview`) : Route réservée aux administrateurs avec en-têtes stricts `Cache-Control: no-store` et `X-Robots-Tag: noindex, nofollow`.
   - **Gestion des préférences de confidentialité conforme APD (Autorité de Protection des Données belge)** : Consentement explicite préalable obligatoire avant tout chargement d'iframe externe (YouTube / Vimeo). Cookie signé HMAC-SHA256 (`__parallax_privacy_prefs`, TTL 180 jours, SameSite=Lax). Case « Mémoriser mon choix » décochée par défaut avec option de consentement en mémoire pour la session. Démontage immédiat de l'iframe du DOM lors d'une révocation des préférences via l'événement `parallax:privacy-updated`.
   - **Routes publiques canoniques et redirections 301** : 8 URLs bilingues canoniques (`/fr/mentions-legales`, `/en/legal-notice`, `/fr/confidentialite`, `/en/privacy-policy`, `/fr/cgv`, `/en/terms`, `/fr/cookies`, `/en/cookies`) et redirection 301 permanente des anciennes URLs (`/en/mentions-legales`, `/en/confidentialite`, `/en/cgv`, `/fr/politique-de-confidentialite`).

5. **Tests Parallax Lot 7** :
   - `apps/web/tests/lot7-company-admin.test.ts`
   - `apps/web/tests/lot7-content-migration.test.ts`
   - `apps/web/tests/lot7-legal-lifecycle.test.ts`
   - `apps/web/tests/lot7-legal-routes.test.ts`
   - `apps/web/tests/lot7-privacy-preferences.test.ts`
   - `apps/web/tests/lot7-sentinel-leakage.test.ts`
   - `apps/web/tests/lot7-video-player-consent.test.tsx`

6. **Elements non verifies** :
   - Validation formelle finale par un juriste des clauses contractuelles et conditions d'exercice de l'activité audiovisuelle.

---

## 10. Tests et runner E2E

1. **Fichiers consultes (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/scripts/run-e2e.js`
   - `apps/web/playwright.config.ts`
   - `apps/web/tests/e2e-runner.test.ts`

2. **Fonctions, types et comportements observes** :
   - Orchestration de Playwright avec demarrage d'une instance `smtp-server` locale simulant le serveur de messagerie.
   - Isolation des bases SQLite dans `os.tmpdir()`.
   - Fermeture propre et garantie des processus fils.

3. **Choix** :
   - **Non repris dans ce lot de bootstrap ou le socle admin**.

4. **Adaptations Parallax** :
   - Les tests E2E ne sont pas configures dans ce lot et feront l'objet d'un lot dedie ulterieur apres autorisation explicite de l'utilisateur.

5. **Tests Sempra pertinents** :
   - `apps/web/tests/e2e-runner.test.ts`
   - `apps/web/tests/no-playwright-test.test.ts`

6. **Elements non verifies** :
   - Compatibilite de la suite de navigateurs Playwright avec l'environnement d'execution distant CI.
