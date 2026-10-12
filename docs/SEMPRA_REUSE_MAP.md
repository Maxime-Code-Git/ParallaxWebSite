# Inventaire Technique de Reutilisation Sempra -> Parallax

Ce document dresse l'inventaire technique rigoureux des modules du depot de reference Sempra (commit `89bfee31ae5d477f71c95e83a0d55305521f426f`), a partir du code reellement consulte.

Pour chaque rubrique, ce document precise les fichiers existants, les fonctions et types observes, le statut de reutilisation, les adaptations necessaires pour Parallax, les tests Sempra associes et les elements non verifies.

Important : Le systeme de galerie Parallax reposera imperativement sur un code d'acces unique par galerie. Aucun niveau d'acces invite ou couple, aucun champ `accessLevel` et aucune terminologie de mariage ne sera integre dans la gestion des galeries Parallax.

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
   - **Adapter**.

4. **Adaptations Parallax** :
   - Renommer le cookie de session (ex: `__parallax_admin_session`).
   - Utiliser les variables d'environnement propres a Parallax (`ADMIN_SESSION_SECRET`, `ADMIN_PASSWORD_HASH`).
   - Aligner les redirections sur les routes Parallax.

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
   - **Adapter**.

4. **Adaptations Parallax** :
   - Adapter les directives CSP aux embeds video externes autorises pour Parallax (Vimeo, YouTube nocookie pour showreel et realisations).
   - Interdire strictement les styles inline en cible de production (garanti par l'usage exclusif de CSS Modules).
   - Maintenir les scripts techniques d'hydratation autorises exclusivement via le nonce de la reponse.
   - Isoler la base de donnees du rate limiting via `RATE_LIMIT_DB_PATH` hors du depot.

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
   - Detection des conflits de revision : chaque fonction de mise a jour (`saveSettings`, `saveLegalPageDraft`, etc.) exige un parametre `previousRevision` et refuse l'ecriture si la revision du fichier disque a evolue.
   - `atomicWrite(filePath, content)` et `atomicWriteJson(filePath, data)` dans `atomic-fs.server.ts` : ecriture dans un fichier temporaire (`.tmp.[hex]`), `fsyncSync` du descripteur de fichier et du repertoire, puis renommage atomique (`renameSync`). Creation d'une copie de sauvegarde (`.bak`) prealable et rotation des 5 derniers backups (`rotateBackups`).
   - Note sur la concurrence : l'ecriture atomique garantit l'integrite physique du fichier en cas de plantage, mais ne constitue pas un verrouillage distribue entre processus distincts (d'ou la necessite de la detection de revision).

3. **Choix** :
   - **Adapter**.
   - Note : Zod reste une option de conception elegante pour le futur schema Parallax, mais doit etre distingue du validateur manuel observe dans Sempra.

4. **Adaptations Parallax** :
   - Schema de contenu neuf demarrant directement en `schemaVersion: 1`.
   - Structure editoriale adaptee a Parallax : Showreel, Fondateurs (Maxime & Ludovic), Rubriques de creation, bloc dedie SEMPRA.
   - Emplacement externe configure par `SITE_CONTENT_PATH`.

5. **Tests Sempra pertinents** :
   - `apps/web/tests/site-content.server.test.ts`
   - `apps/web/tests/atomic-fs.server.test.ts`
   - `apps/web/tests/site-content-migration.server.test.ts`

6. **Elements non verifies** :
   - Performance de lecture synchrone repetee lors de fortes charges concurrentes sans couche de memoire cache.

---

## 4. Portfolio et medias publics

1. **Fichiers consultes (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/lib/portfolio-content.server.ts`
   - `apps/web/app/lib/portfolio-image.server.ts`
   - `apps/web/app/lib/portfolio-media.server.ts`
   - `apps/web/app/lib/portfolio-transaction.server.ts`
   - `apps/web/app/routes/portfolio.media.$photoId.$variant.tsx`

2. **Fonctions, types et comportements observes** :
   - `getPortfolioContent()`, `savePortfolio()`, `assertPortfolioRevision()` : gestion de l'arborescence des categories et photos avec validation de schema V2 (ici valide via Zod `portfolioSchemaV2`).
   - `generateSlug()`, `generateUniqueSlug()` : generation d'identifiants URL uniques.
   - `portfolio-media.server.ts` : streaming securise avec controle des chemins, types MIME et en-tetes HTTP de cache (`Cache-Control: public, max-age=31536000, immutable`).
   - `portfolio-image.server.ts` : traitement des variantes d'images avec application eventuelle de watermark et extraction de metadonnees.
   - `portfolio-transaction.server.ts` : coordination transactionnelle entre ecriture disque et mise a jour des metadonnees.

3. **Choix** :
   - **Adapter**.

4. **Adaptations Parallax** :
   - Deux rubriques structurelles distinctes : Documentaire et Publicite.
   - Distinction claire entre les rubriques et les realisations (projets multiples au sein de chaque rubrique).
   - Panneau lateral d'ouverture dynamique : entree depuis la droite si miniature cliquee a gauche, entree depuis la gauche si miniature cliquee a droite, fermeture vers le bord d'origine.
   - Suppression du moteur de filigrane (watermark) Sempra.
   - Stockage persistant externe via `PORTFOLIO_CONTENT_PATH` et `PORTFOLIO_MEDIA_PATH`.

5. **Tests Sempra pertinents** :
   - `apps/web/tests/portfolio-content.server.test.ts`
   - `apps/web/tests/portfolio-image.server.test.ts`
   - `apps/web/tests/portfolio-transaction.server.test.ts`
   - `apps/web/tests/portfolio-video-cover.test.ts`

6. **Elements non verifies** :
   - Integration d'un lecteur video personnalise avec streaming adapte.

---

## 5. Galerie privee (architecture a code unique)

1. **Fichiers consultes (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/lib/gallery-auth.server.ts`
   - `apps/web/app/lib/gallery-db.server.ts`
   - `apps/web/app/lib/gallery.server.ts`
   - `apps/web/app/lib/gallery-import.server.ts`

2. **Fonctions, types et comportements observes** :
   - `hashGalleryCode(code)` : hachage HMAC-SHA256 du code d'acces pour recherche indexee en base sans stockage en clair.
   - `encryptGalleryCode(code)` et `decryptGalleryCode(str)` : chiffrement AES-256-GCM permettant a l'administrateur de relire le code si necessaire.
   - `gallerySessionStorage` : session de galerie isolee sous cookie dedie.
   - `gallery-db.server.ts` : tables SQLite pour les galeries, medias et imports.
   - Dans Sempra existaient `GalleryAccessLevel = "invites" | "maries"` et `isMediaAuthorized` : ces notions sont des specificites de mariage a supprimer integralement.

3. **Choix** :
   - **Adapter en simplifiant radicalement**.

4. **Adaptations Parallax obligatoires** :
   - Exactement UN code actif par galerie.
   - Contrainte SQLite `UNIQUE(gallery_id)` sur la table des codes.
   - Hachage HMAC pour recherche, AES-GCM pour restitution par l'admin, AUCUN mot de passe stocke en clair.
   - Gestion d'une version de code (`code_version`) pour invalider immediatement les sessions apres rotation.
   - Session client de galerie strictement separee de la session administrateur.
   - Suppression totale de `accessLevel`, de la separation invite/couple et de tout vocabulaire de mariage dans la galerie.
   - (Rappel : le bloc SEMPRA de la page d'accueil presente son activite de mariage, mais le moteur de galerie Parallax en est totalement affranchi).

5. **Tests Sempra pertinents** :
   - `apps/web/tests/gallery.test.ts`
   - `apps/web/tests/gallery-db.server.test.ts`
   - `apps/web/tests/admin-gallery-integration.server.test.ts`

6. **Elements non verifies** :
   - Impact sur les temps de reponse lors du telechargement simultane d'archives ZIP volumineuses par plusieurs clients.

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
   - **Porter** tel quel le pipeline `gallery-preview.server.ts` pour la galerie privee.
   - **Adapter** le pipeline public aux dimensions graphiques de Parallax.

4. **Adaptations Parallax** :
   - Separation nette entre variantes publiques (adaptees aux grilles du site) et variantes de galerie privee (480, 960, 1920 px).
   - Ne pas substituer les dimensions de maquettes (1440 / 390 px) aux formats fixes de la galerie privee.

5. **Tests Sempra pertinents** :
   - `apps/web/tests/gallery-preview.server.test.ts`
   - `apps/web/tests/generate-previews.script.test.ts`
   - `apps/web/tests/poster-fs.test.ts`

6. **Elements non verifies** :
   - Temps d'execution de la conversion batch pour un volume important de fichiers RAW ou tres haute resolution (> 45 MP).

---

## 7. Suppression et retention

1. **Fichiers consultes (commit Sempra `89bfee31ae5d477f71c95e83a0d55305521f426f`)** :
   - `apps/web/app/lib/gallery-deletion-worker.server.ts`
   - `apps/web/app/routes/admin.data-retention.tsx`

2. **Fonctions, types et comportements observes** :
   - `resumeGalleryDeletions()` : repris automatiquement au demarrage dans `entry.server.tsx` pour executer les purges planifiees en suspens.
   - Suppression en deux temps : marquage d'expiration en base, puis suppression physique des repertoires sur disque avec logs d'audit.
   - `admin.data-retention.tsx` : interface d'administration de conformite RGPD avec declenchement manuel ou planifie.

3. **Choix** :
   - **Adapter**.

4. **Adaptations Parallax** :
   - Adapter les regles contractuelles de conservation aux missions de production audiovisuelle (publicites, documentaires, clips).
   - Adapter les journaux d'audit et les notifications administrateur.

5. **Tests Sempra pertinents** :
   - `apps/web/tests/admin-data-retention-gallery.server.test.ts`
   - `apps/web/tests/admin-data-retention-booking.server.test.ts`

6. **Elements non verifies** :
   - Comportement en cas de point de montage disque sature ou inaccessible lors de la purge.

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
   - **Adapter**.

4. **Adaptations Parallax** :
   - Champs du formulaire conformes au prototype Parallax :
     - Nom ou societe ;
     - E-mail ;
     - Telephone (facultatif) ;
     - Delai souhaite ;
     - Type de projet : options exactes du prototype :
       - Clip musical ;
       - Publicite ;
       - Portrait ;
       - Documentaire ;
       - Autre ;
     - Message ;
     - Notice de consentement RGPD avec lien vers la page confidentialite.
   - Ne pas utiliser les intitules generiques "photo, video, documentaire, publicite, portrait".
   - Templates e-mails bilingues aux couleurs de Parallax.

5. **Tests Sempra pertinents** :
   - `apps/web/tests/contact.server.test.ts`
   - `apps/web/tests/mailer.server.test.ts`
   - `apps/web/tests/admin-contact-http.test.ts`

6. **Elements non verifies** :
   - Taux de delivrabilite reel avec domaine Parallax sur relais SMTP de production.

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
   - **Adapter**.

4. **Adaptations Parallax** :
   - Conserver l'integralite du cycle de vie brouillon / publication / archive / restauration dans l'admin.
   - Adapter les CGV a l'activite de production audiovisuelle (cession de droits d'auteur, droit a l'image, autorisations de tournage, conditions de paiement et de livraison).
   - Renseigner les donnees d'immatriculation juridique exactes de Parallax / LS studio.
   - Rappel important : l'implementation technique ne vaut pas validation juridique ; les textes devront faire l'objet d'une validation formelle par un juriste.

5. **Tests Sempra pertinents** :
   - `apps/web/tests/admin-legal-http.test.ts`
   - `apps/web/tests/admin-legal.test.tsx`
   - `apps/web/tests/cgv-meta.test.ts`

6. **Elements non verifies** :
   - Conformite des clauses de cession de droits avec les legislations extra-europeennes.

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
   - **Non repris dans ce lot de bootstrap**.

4. **Adaptations Parallax** :
   - Les tests E2E ne sont pas configures dans ce bootstrap et feront l'objet d'un lot dedie ulterieur apres autorisation explicite de l'utilisateur.

5. **Tests Sempra pertinents** :
   - `apps/web/tests/e2e-runner.test.ts`
   - `apps/web/tests/no-playwright-test.test.ts`

6. **Elements non verifies** :
   - Compatibilite de la suite de navigateurs Playwright avec l'environnement d'execution distant CI.
