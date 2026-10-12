# Inventaire Technique de Reutilisation Sempra -> Parallax

Ce document dresse la cartographie des composants et modules techniques du depot de reference Sempra susceptibles d'etre adaptes dans Parallax lors de futurs lots de developpement.

Pour chaque systeme, les fichiers sources Sempra, leur role, les elements a adapter et les regles strictes de non-copie sont documentes ci-dessous.

Important : la future galerie Parallax fonctionnera avec un seul code par galerie. Aucun niveau d'acces invite ou couple, aucun champ `accessLevel` et aucun vocabulaire de mariage ne doit exister dans Parallax.

---

## 1. Authentification admin

- Fichiers Sempra concernes :
  - `apps/web/app/lib/auth.server.ts`
  - `apps/web/app/routes/admin.tsx`
  - `scripts/set-admin-password.sh`
  - `apps/web/scripts/admin-hash.js`
- Role :
  - Protection des routes d'administration `/admin/*` via cookie de session securise (HTTP-only, SameSite=Lax).
  - Hachage securise des mots de passe avec Argon2 via `@node-rs/argon2`.
- Elements reutilisables :
  - Logique de creation, verification et invalidation du cookie de session.
  - Script utilitaire de hachage de mot de passe en ligne de commande.
  - Middleware de verification pour les loaders et actions d'administration.
- Adaptations Parallax necessaires :
  - Renommage du cookie de session (ex: `__parallax_admin_session`).
  - Utilisation des variables d'environnement dediees a Parallax (`ADMIN_SESSION_SECRET`, `ADMIN_PASSWORD_HASH`).
  - Alignement des redirections sur la structure de routes Parallax.
- Elements a ne jamais copier :
  - Mots de passe, hashes ou secrets reels de production de Sempra.
  - Fichiers `.env` ou scripts avec identifiants Sempra en dur.

---

## 2. Contenu bilingue et administration

- Fichiers Sempra concernes :
  - `apps/web/app/lib/site-content.server.ts`
  - `apps/web/app/routes/admin.*.tsx`
  - `packages/shared/src/schemas/content.ts`
- Role :
  - Stockage du contenu editorial bilingue (FR et EN) dans un fichier JSON externe hors depot Git.
  - Validation du schema avec Zod et persistance atomique avec copie de secours.
  - Interface d'administration pour editer les textes et sections.
- Elements reutilisables :
  - Pattern d'ecriture atomique du fichier JSON (ecriture temporaire puis renommage).
  - Gestion du fallback linguistique (FR par defaut, EN si present).
  - Validation structurelle stricte via Zod.
- Adaptations Parallax necessaires :
  - Conception d'un nouveau schema adapte a l'activite de Parallax (studio photo/video, sections Documentaire, Publicite, Showreel, bloc dedie SEMPRA).
  - Demarrage direct du contenu en version 1 (`schemaVersion: 1`).
  - Exclusion de toute notion de formules ou forfaits mariage.
- Elements a ne jamais copier :
  - Fichiers JSON de contenu reels de Sempra (`site-content.json`).
  - Textes editoriaux, tarifs mariage et descriptions de ceremonies.

---

## 3. Contact et mailer

- Fichiers Sempra concernes :
  - `apps/web/app/lib/mailer.server.ts`
  - `apps/web/app/routes/fr.contact.tsx`
  - `apps/web/app/routes/en.contact.tsx`
  - `apps/web/scripts/smtp-verify.js`
- Role :
  - Envoi des formulaires de contact par email transactionnel via Nodemailer et relais SMTP.
  - Envoi d'une notification a l'equipe du studio et d'un accuse de reception au demandeur.
- Elements reutilisables :
  - Configuration du transporteur Nodemailer avec gestion des erreurs et pool de connexions.
  - Sanitisation des entrees utilisateur pour prevenir les injections d'en-tetes email.
  - Script de verification de connectivite SMTP en developpement.
- Adaptations Parallax necessaires :
  - Champs du formulaire Parallax : Nom, Email, Telephone, Echeance du projet, Type de projet (photo, video, documentaire, publicite, portrait), Message.
  - Coordonnees d'expedition et de reception configurees via `CONTACT_FROM_EMAIL` et `CONTACT_TO_EMAIL`.
  - Templates email bilingues au design Parallax (typographie Space Grotesk, palette sombre).
- Elements a ne jamais copier :
  - Identifiants de relais SMTP ou cles d'API Brevo de Sempra.
  - Adresses email du studio Sempra.

---

## 4. Securite HTTP et rate limiting

- Fichiers Sempra concernes :
  - `apps/web/app/entry.server.tsx`
  - `apps/web/app/lib/rate-limit.server.ts`
  - `apps/web/app/lib/csrf.server.ts`
- Role :
  - Application d'une politique Content-Security-Policy dynamique avec nonce unique par reponse.
  - En-tetes de securite stricts (X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy).
  - Limitation du debit (rate limiting) par adresse IP persistee dans une base SQLite dediee.
- Elements reutilisables :
  - Mecanisme d'injection de nonce CSP dans le flux de rendu SSR de React Router.
  - Implementation SQLite du rate limiter avec fenetre glissante et requetes preparees.
- Adaptations Parallax necessaires :
  - Ajustement des directives CSP pour autoriser les sources multimedia specifiques a Parallax (embeds video Vimeo / YouTube nocookie).
  - Chemin persistant dedie `RATE_LIMIT_DB_PATH` hors du depot.
- Elements a ne jamais copier :
  - Fichiers SQLite de rate limit existants.
  - Cles de signature CSRF ou secrets de production.

---

## 5. Pages legales

- Fichiers Sempra concernes :
  - `apps/web/app/routes/fr.legal.tsx`, `apps/web/app/routes/en.legal.tsx`
  - `apps/web/app/routes/fr.privacy.tsx`, `apps/web/app/routes/en.privacy.tsx`
  - `apps/web/app/routes/fr.cgv.tsx`, `apps/web/app/routes/en.cgv.tsx`
  - `apps/web/app/routes/fr.cookies.tsx`, `apps/web/app/routes/en.cookies.tsx`
- Role :
  - Affichage conforme RGPD et droit belge des mentions legales, politique de confidentialite, CGV et politique des cookies.
- Elements reutilisables :
  - Structure juridique des rubriques obligatoires (responsable de traitement, droits des personnes, finalites).
  - Ergonomie de lecture avec sommaire ancre et mise en page responsive.
- Adaptations Parallax necessaires :
  - Coordonnees de l'editeur : Parallax / LS studio (BCE, TVA, siege social a completer).
  - CGV adaptees aux prestations de tournage video, captation publicitaire et reportage d'entreprise (cession de droits d'auteur, autorisations de diffusion) au lieu du mariage.
- Elements a ne jamais copier :
  - Donnees juridiques privees specifiques a d'autres societes.
  - Clauses de prestations specifiques aux evenements de mariage.

---

## 6. Portfolio et medias

- Fichiers Sempra concernes :
  - `apps/web/app/lib/portfolio.server.ts`
  - `apps/web/app/routes/portfolio.media.*.tsx`
- Role :
  - Distribution optimisee des photos et videos avec mise en cache HTTP et gestion des formats d'image.
- Elements reutilisables :
  - En-tetes de cache HTTP (`Cache-Control: public, max-age=31536000, immutable`).
  - Validation des types MIME avec `file-type` pour bloquer les fichiers corrompus ou malveillants.
- Adaptations Parallax necessaires :
  - Architecture a deux categories principales : Documentaire et Publicite.
  - Support de l'ouverture en panneau lateral et des galeries depliables selon le prototype Parallax.
  - Integration du lecteur showreel video en pleine largeur.
- Elements a ne jamais copier :
  - Fichiers medias, photos de maries et videos de Sempra.
  - Filigranes visuels Sempra.

---

## 7. Galerie privee

- Fichiers Sempra concernes :
  - `apps/web/app/lib/gallery.server.ts`
  - `apps/web/app/lib/gallery-db.server.ts`
  - `apps/web/app/routes/fr.gallery.tsx`
  - `apps/web/app/routes/api.gallery.*.ts`
- Role :
  - Consultation privee des livrables clients (photos et videos) avec code d'acces et telechargement de fichiers originaux ou archives ZIP.
- Elements reutilisables :
  - Generation de flux d'archives ZIP a la volee sans surcharge memoire grace a `yazl`.
  - Hachage et chiffrement securise des codes de galerie.
  - Schema de base de donnees SQLite pour le referencement des collections de medias.
- Adaptations Parallax necessaires :
  - IMPORTANT : Un seul code d'acces par galerie client.
  - Suppression integrale de la separation invites vs maries (`accessLevel`).
  - Suppression de toutes les references terminologiques liees au mariage.
  - Adaptation de l'interface client (sections Photos et Film avec boutons d'ancre fluides).
- Elements a ne jamais copier :
  - Bases de donnees de galeries Sempra (`galleries.sqlite`).
  - Medias clients et archives d'anciens mariages.

---

## 8. Previews WebP

- Fichiers Sempra concernes :
  - `apps/web/scripts/generate-previews.ts`
  - `apps/web/app/lib/media-processing.server.ts`
- Role :
  - Traitement d'images haute definition avec Sharp pour generer des miniatures WebP et des versions responsives.
- Elements reutilisables :
  - Parametres d'optimisation Sharp (compression WebP qualite 80, suppression des metadonnees EXIF sensibles).
  - Pipeline de generation automatique des vignettes lors de l'import.
- Adaptations Parallax necessaires :
  - Dimensions de generation adaptees aux formats du design Parallax (hero 1440px, vignettes 1100x760, mobile 390px).
  - Generation de posters pour les lecteurs video HTML5.
- Elements a ne jamais copier :
  - Bibliotheque d'images sources Sempra.

---

## 9. Suppression et retention

- Fichiers Sempra concernes :
  - `apps/web/app/lib/gallery-deletion-worker.server.ts`
  - `apps/web/app/routes/admin.data-retention.tsx`
- Role :
  - Gestion du cycle de vie des donnees clients, suppression planifiee des galeries apres delai contractuel et journalisation RGPD.
- Elements reutilisables :
  - Worker asynchrone tolerant aux pannes capable de reprendre les taches interrompues au demarrage du serveur.
  - Procedure de suppression securisee des fichiers sur le disque (unlink avec verification prealable).
- Adaptations Parallax necessaires :
  - Regles de retention conformes aux contrats de prestation audiovisuelle d'entreprise.
  - Tableaux de bord de retention dans l'espace administration Parallax.
- Elements a ne jamais copier :
  - Registres de retention et historiques d'anciens clients Sempra.

---

## 10. Tests et runner E2E

- Fichiers Sempra concernes :
  - `apps/web/scripts/run-e2e.js`
  - `apps/web/playwright.config.ts`
- Role :
  - Execution automatique des tests end-to-end Playwright avec serveur SMTP mock integre et base de donnees temporaire.
- Elements reutilisables :
  - Pattern de serveur SMTP local temporaire avec `smtp-server` pour tester l'envoi de formulaire sans tiers.
  - Isolation complete de l'environnement de test (base SQLite dans le dossier temporaire du systeme).
- Adaptations Parallax necessaires :
  - Les tests E2E ne sont pas configures dans ce bootstrap et feront l'objet d'un lot dedie ulterieur.
  - Les scenarios futurs testeront le formulaire contact Parallax, la navigation Projets et l'acces a la galerie par code unique.
- Elements a ne jamais copier :
  - Jeux de donnees de test ou captures d'ecran Sempra.
