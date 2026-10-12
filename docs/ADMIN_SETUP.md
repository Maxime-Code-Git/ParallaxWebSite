# Guide de configuration locale de l'administration Parallax (Lot 1)

Ce document décrit la configuration et l'utilisation du socle d'administration et d'authentification Parallax.

## 1. Vue d'ensemble

Le socle d'administration Parallax (Lot 1) fournit :
- Une interface de connexion par mot de passe unique (`/admin`).
- Une session d'administration sécurisée par cookie HTTP-only (`__parallax_admin_session`).
- Un tableau de bord (`/admin/dashboard`) avec prévisualisation des modules à venir.
- Une déconnexion sécurisée (`/admin/logout`).
- Une limitation transactionnelle persistante des tentatives de connexion (`node:sqlite`).
- Une politique stricte de sécurité des requêtes (CSRF en temps constant, validation Origin, lecture bornée en streaming à 8 Kio).
- Des en-têtes de sécurité SSR avec Content Security Policy (CSP) par nonce cryptographique.

---

## 2. Génération du hachage de mot de passe administrateur

Le mot de passe administrateur est haché à l'aide d'**Argon2id** (`@node-rs/argon2`) avec les paramètres recommandés (mémoire 19456 Ko, temps 2 passes, parallélisme 1 thread).

Pour générer un hachage en local sans exposer le mot de passe dans l'historique shell ou les arguments de commande :

```bash
npm run admin:hash
```

Le script interactif :
1. Vérifie la présence d'un terminal TTY interactif.
2. Refuse tout argument de ligne de commande.
3. Masque la saisie du mot de passe avec des astérisques (`*`).
4. Exige une longueur minimale de 12 caractères et demande une confirmation.
5. Calcule le hash Argon2id et l'affiche sur `stdout`.
6. Ne sauvegarde pas le mot de passe dans Git ni dans `.env.local` automatiquement.

---

## 3. Configuration des variables d'environnement (`.env.local`)

Créez un fichier `.env.local` à la racine du monorepo Parallax (ce fichier est exclu de Git par `.gitignore`).

### Tableau des variables pour le Lot 1

| Variable | Type / Format | Obligatoire | Rôle et contraintes |
|---|---|---|---|
| `NODE_ENV` | `development` \| `production` \| `test` | Recommandé | Environnement d'exécution. Si absent, par défaut `development`. En production, HTTPS et Secure cookies sont obligatoires. |
| `PUBLIC_SITE_URL` | URL absolue (`http://...` ou `https://...`) | Oui | URL publique de référence du site (ex. `http://localhost:3000` en dev, `https://mon-domaine.com` en prod). Sert à la validation de l'en-tête `Origin`. |
| `ADMIN_PASSWORD_HASH` | Chaîne commençant par `$argon2id$` | Oui (pour `/admin`) | Hachage Argon2id du mot de passe unique généré par `npm run admin:hash`. |
| `ADMIN_SESSION_SECRET` | Chaîne (>= 32 caractères) | Oui (pour `/admin`) | Clé secrète dédiée au chiffrement/signature du cookie de session et à l'invalidation via `credentialVersion`. |
| `RATE_LIMIT_SECRET` | Chaîne (>= 32 caractères) | Oui (pour `/admin`) | Clé secrète distincte dédiée au hachage HMAC-SHA256 des adresses IP des clients. |
| `RATE_LIMIT_DB_PATH` | Chemin absolu sur disque | Oui (pour `/admin`) | Chemin absolu du fichier SQLite (ex. `/var/data/parallax/rate-limit.db`). Doit être hors du dépôt, hors de `public/` et `build/`. Dossier parent permissions 0700, fichier 0600. Les liens symboliques sont rejetés. |
| `TRUST_PROXY` | `true` \| `false` | Non (défaut `false`) | Si `false`, les en-têtes `x-forwarded-for` et `cf-connecting-ip` sont ignorés (clé partagée conservatrice). Si `true`, l'adresse IP cliente doit être validée depuis un proxy inverse de confiance strict. |

### Variables futures (facultatives pour le Lot 1)

Les variables suivantes sont réservées aux lots ultérieurs (contenu éditorial, galeries privées, mailer) et sont facultatives pour le Lot 1 :
- `SITE_CONTENT_PATH`
- `GALLERY_DB_PATH`, `GALLERY_MEDIA_PATH`, `GALLERY_IMPORT_PATH`
- `GALLERY_SECRET`, `GALLERY_CODE_ENCRYPTION_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`
- `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL`

### Exemple de configuration locale (`.env.local`)

```env
NODE_ENV=development
PUBLIC_SITE_URL=http://localhost:3000
ADMIN_PASSWORD_HASH=$argon2id$v=19$m=19456,t=2,p=1$...
ADMIN_SESSION_SECRET=dev_admin_session_secret_min_32_chars_long!!
RATE_LIMIT_SECRET=dev_rate_limit_secret_min_32_chars_long_key!
RATE_LIMIT_DB_PATH=/Users/profadmin/.parallax-data/rate-limit.db
TRUST_PROXY=false
```

---

## 4. Politique de session administrateur

- **Nom du cookie** : `__parallax_admin_session`.
- **Attributs de sécurité** :
  - `HttpOnly: true` (inaccessible par JavaScript côté client).
  - `SameSite: strict` (protection contre les fuites cross-site).
  - `Path: /` (portée globale du site).
  - `Secure: true` en environnement de production (HTTPS).
  - Aucun attribut `Domain` (limité à l'hôte exact).
- **Durée de rétention** :
  - 8 heures maximum (28 800 secondes).
  - Vérification côté serveur obligatoire via timestamp signé (`expiresAt`) pour rejeter les sessions obsolètes même si le client falsifie le `Max-Age`.
- **Session anonyme de pré-connexion** :
  - Une session anonyme temporaire est initialisée pour porter le jeton CSRF sur la page `GET /admin`.
  - Elle ne confère aucun privilège administrateur (`adminId` est absent).
  - Lors d'une connexion réussie, une nouvelle session authentifiée est forgée avec rotation du jeton CSRF et nouvel identifiant opaque.
- **Rotation et invalidation** :
  - Toute modification de `ADMIN_PASSWORD_HASH` ou `ADMIN_SESSION_SECRET` modifie le `credentialVersion` (HMAC-SHA256 du hash et du secret), ce qui invalide immédiatement toutes les sessions actives.

---

## 5. Politique de limitation de débit (Rate Limiting)

- **Moteur** : `node:sqlite` natif (module synchrone `DatabaseSync`).
- **Quota administrateur** : 5 tentatives sur une fenêtre glissante de 15 minutes (900 000 ms).
- **Anonymisation** : L'adresse IP brute n'est jamais stockée sur disque ; elle est hachée via HMAC-SHA256 avec la clé `RATE_LIMIT_SECRET`.
- **Comportement en cas de dépassement** : Réponse HTTP 429 Too Many Requests avec en-tête `Retry-After` indiquant le nombre de secondes d'attente.
- **Réinitialisation** : En cas de succès d'authentification, les tentatives enregistrées pour l'IP sont automatiquement purgées.
- **Déconnexion** : L'action de déconnexion (`POST /admin/logout`) n'est pas soumise au quota de connexion pour garantir qu'un utilisateur puisse toujours clore sa session.
- **Résilience** : En cas de panne physique du stockage SQLite, le système bascule en sécurité et renvoie une réponse générique 503 Service Unavailable, sans autoriser d'accès non contrôlé.

---

## 6. Considérations sur le reverse-proxy (`TRUST_PROXY`)

- **`TRUST_PROXY=false` (mode par défaut)** :
  - Les en-têtes `X-Forwarded-For` et `CF-Connecting-IP` transmis par les clients sont scrupuleusement ignorés.
  - Recommandé en développement local ou si l'application Node est directement exposée sans proxy intermédiaire certifié.
- **`TRUST_PROXY=true`** :
  - Doit être activé uniquement lorsque l'application s'exécute derrière un reverse proxy maîtrisé (Nginx, Caddy, Cloudflare).
  - L'IP cliente est extraite de `cf-connecting-ip` ou du dernier segment de `x-forwarded-for` avec validation stricte de l'adresse IP (`net.isIP`).
  - L'infrastructure amont doit impérativement réécrire ces en-têtes pour éviter l'usurpation d'adresse IP.

---

## 7. Comportement en cas de configuration manquante

- En l'absence des variables requises (`ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, `RATE_LIMIT_SECRET`, `RATE_LIMIT_DB_PATH`) :
  - La route publique d'accueil (`/`) reste fonctionnelle et accessible.
  - L'accès à `/admin` et ses sous-routes renvoie immédiatement une réponse **503 Service Unavailable** générique.
  - Aucun mot de passe par défaut, aucune porte dérobée (backdoor) et aucun mode dégradé non sécurisé n'est autorisé.

---

## 8. Cartographie des routes livrées (Lot 1)

| Route | Méthode | Rôle | Protection |
|---|---|---|---|
| `/admin` | `GET` | Affiche le formulaire de connexion si anonyme ; redirige vers `/admin/dashboard` si déjà authentifié. | Cache-Control: no-store, X-Robots-Tag: noindex |
| `/admin` | `POST` | Traite la soumission du mot de passe administrateur. | Origin, CSRF, Rate Limiting, body stream 8 Kio |
| `/admin/dashboard` | `GET` | Tableau de bord d'administration listant les 8 modules Parallax. | Authentification obligatoire, Cache-Control: no-store, X-Robots-Tag: noindex |
| `/admin/logout` | `POST` | Déconnexion : détruit la session et supprime le cookie. | Authentification, Origin, CSRF, body stream 8 Kio |
| `/admin/logout` | `GET` | Rejet explicite 405 Method Not Allowed (en-tête `Allow: POST`). | Aucun effet de bord |
