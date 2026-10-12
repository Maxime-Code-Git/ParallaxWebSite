# Inventaire Technique de Reutilisation Sempra -> Parallax

Ce document dresse l'inventaire technique rigoureux des modules du depot de reference Sempra (commit `89bfee31ae5d477f71c95e83a0d55305521f426f`), a partir du code reellement consulte.

Pour chaque rubrique, ce document precise les fichiers existants, les fonctions et types observes, le statut de reutilisation, les adaptations necessaires pour Parallax, les tests Sempra associes et l'etat d'avancement par lot.

Important : Le systeme de galerie Parallax reposera imperativement sur un code d'acces unique par galerie. Aucun niveau d'acces invite ou couple, aucun champ `accessLevel` et aucune terminologie de mariage ne sera integre dans la gestion des galeries Parallax.

---

## Tableau de synthese de portage (Etat a l'issue du Lot 1)

| Module Sempra | Statut Lot 1 | Fichiers Parallax correspondants | Notes et adaptations |
| --- | --- | --- | --- |
| `auth.server.ts` | **Porte et adapte** | `apps/web/app/lib/auth.server.ts` | Argon2id, versioning des identifiants `credentialVersion`, verification mot de passe bornee a 256 car., temps constant. |
| `session.server.ts` | **Porte et adapte** | `apps/web/app/lib/session.server.ts` | Cookie dedie `__parallax_admin_session`, maxAge 8h, expiration cote serveur, session anonyme pour CSRF pre-connexion. |
| `admin-auth.server.ts` | **Porte et adapte** | `apps/web/app/lib/admin-auth.server.ts` | Validation de session avec redirection 303, en-tetes `no-store` / `noindex`, lecture bornee des requetes 8 Ko. |
| `security.server.ts` | **Porte et adapte** | `apps/web/app/lib/security.server.ts` | `validateOrigin`, `getClientIp` securise sous `TRUST_PROXY`, `readStrictFormUrlEncoded` avec verification des doublons. |
| `rate-limit.server.ts` | **Porte et adapte** | `apps/web/app/lib/rate-limit.server.ts` | `node:sqlite`, permissions 0700/0600, rejet des symlinks, fenetre glissante 15 min / 5 tentatives, HMAC des IP, isolation DB hors depot. |
| `entry.server.tsx` | **Porte et adapte** | `apps/web/app/entry.server.tsx` | Nonce SSR regenere a chaque requete, CSP stricte sans `unsafe-inline` en prod, sans embeds tiers non autorises. |
| `scripts/env-loader.js` | **Porte et adapte** | `scripts/env-loader.js` | Monorepo root finder sur package `parallax`, isolation totale en test (`NODE_ENV === "test"`), remontee explicite des erreurs de lecture. |
| `apps/web/scripts/admin-hash.js` | **Porte et adapte** | `apps/web/scripts/admin-hash.js` | Saisie interactive masquee avec confirmation, rejet des arguments CLI, hachage Argon2id conforme. |
| `routes/admin.tsx` | **Porte et decompose** | `apps/web/app/routes/admin/` | Decompose en routes propres : `/admin` (connexion), `/admin/dashboard` (tableau de bord 8 modules), `/admin/logout` (deconnexion POST). |
| `site-content.server.ts` | **Differe (Lot suivant)** | A creer au lot editorial | Schema V1 Parallax, validation sans migrations historiques. |
| `atomic-fs.server.ts` | **Differe (Lot suivant)** | A creer au lot editorial | Ecriture atomique et rotations de sauvegardes pour le JSON de contenu. |
| `gallery-*.server.ts` | **Differe (Lot galerie)** | A creer au lot galeries | Moteur de galeries clients a code d'acces unique (sans niveaux d'acces mariage). |
| `mailer.server.ts` | **Differe (Lot contact)** | A creer au lot contact | Configuration SMTP et envoi securise de formulaires de contact. |
| Workers arriere-plan | **Differe (Lots avances)** | A creer au besoin | Purge de donnees et conversion d'images asynchrone. |

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

3. **Statut Parallax (Lot 1)** :
   - **Livre** dans `apps/web/app/lib/auth.server.ts`, `session.server.ts` et `admin-auth.server.ts`.
   - Cookie renomme `__parallax_admin_session`.
   - Redirection 303 post-connexion et post-deconnexion avec nettoyage du cookie.

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
   - `requireSecureAdminMutation(request)` : enforce POST, `validateOrigin`, `Content-Type: application/x-www-form-urlencoded`, lecture streaming bornee a 128 Ko, `ActionSecurityError`.
   - `validateAdminFormData(request)` : validation de token CSRF en temps constant sans module externe separe.
   - `checkRateLimit(ip, namespace)` : fenetre glissante persistee sous SQLite (`node:sqlite`) avec indexation sur hash HMAC et horodatage, transactions exclusives.
   - `entry.server.tsx` : generation de nonce cryptographique (`generateNonce`), injection de nonce dans `ServerRouter` pour l'hydratation SSR, en-tetes `nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy`.

3. **Statut Parallax (Lot 1)** :
   - **Livre** dans `security.server.ts`, `rate-limit.server.ts`, `admin-auth.server.ts` et `entry.server.tsx`.
   - Limite de lecture ajustee a 8 KiB pour les routes d'authentification/deconnexion.
   - Nonce SSR propage a l'hydratation, CSP sans `unsafe-inline` en production.
   - Base de limitation de debit isolee via `RATE_LIMIT_DB_PATH`, permissions 0700/0600.
