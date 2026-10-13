# Guide de configuration locale de l'administration Parallax (Lot 1 & 1 bis)

Ce document décrit la configuration, la sécurité et l'utilisation du socle d'administration et d'authentification Parallax.

---

## 1. Vue d'ensemble

Le socle d'administration Parallax fournit :
- Une interface de connexion par mot de passe unique (`/admin`).
- Une session d'administration sécurisée par cookie HTTP-only signé (`__parallax_admin_session`).
- Un tableau de bord (`/admin/dashboard`) avec prévisualisation des 8 modules d'administration à venir.
- Une déconnexion sécurisée (`/admin/logout`).
- Une limitation transactionnelle persistante des tentatives de connexion (`node:sqlite`).
- Une politique stricte de sécurité des requêtes (CSRF en temps constant, validation d'Origin strict, lecture bornée en streaming à 8 Kio, validation des champs autorisés).
- Des en-têtes de sécurité SSR avec Content Security Policy (CSP) par nonce cryptographique et en-têtes `no-store` / `noindex, nofollow` sur toutes les réponses d'administration.

---

## 2. Génération du hachage de mot de passe administrateur

Le mot de passe administrateur est haché à l'aide d'**Argon2id** (`@node-rs/argon2`) avec les paramètres recommandés (mémoire 19456 Ko, temps 2 passes, parallélisme 1 thread).

Pour générer un hachage en local sans exposer le mot de passe dans l'historique shell ou les arguments de commande :

```bash
npm run admin:hash
```

Le script interactif (`apps/web/scripts/admin-hash.js`) :
1. Vérifie la présence d'un terminal interactif (TTY) en entrée et en sortie.
2. Refuse tout argument de ligne de commande par sécurité.
3. Affiche clairement les invites et masque la saisie des caractères du mot de passe avec des astérisques (`*`).
4. Exige une longueur cohérente de **12 à 256 caractères** et demande une confirmation identique.
5. Calcule le hash Argon2id et l'affiche sur `stdout`.
6. Ne sauvegarde pas le mot de passe dans Git ni dans `.env.local` automatiquement.
7. Restaure immédiatement le terminal en cas d'annulation (Ctrl+C).

---

## 3. Configuration des variables d'environnement (`.env.local`)

Créez un fichier `.env.local` à la racine du monorepo Parallax (ce fichier est exclu de Git par `.gitignore`).

### Tableau des variables pour le Lot 1 & 1 bis

| Variable | Type / Format | Obligatoire | Rôle et contraintes |
|---|---|---|---|
| `NODE_ENV` | `development` \| `production` \| `test` | Recommandé | Environnement d'exécution. Si absent, par défaut `development`. En production, HTTPS et Secure cookies sont obligatoires. |
| `PUBLIC_SITE_URL` | URL absolue (`http://...` ou `https://...`) | Oui | URL publique de référence du site (ex. `http://localhost:3000` en dev, `https://mon-domaine.com` en prod). Sert à la validation stricte de l'en-tête `Origin`. |
| `ADMIN_PASSWORD_HASH` | Format standard `$argon2id$v=...$m=...,t=...,p=...$salt$hash` | Oui (pour `/admin`) | Hachage Argon2id du mot de passe unique généré par `npm run admin:hash`. |
| `ADMIN_SESSION_SECRET` | Chaîne (>= 32 caractères) | Oui (pour `/admin`) | Clé secrète dédiée à la signature cryptographique du cookie de session et à l'invalidation via `credentialVersion`. |
| `RATE_LIMIT_SECRET` | Chaîne (>= 32 caractères) | Oui (pour `/admin`) | Clé secrète distincte dédiée au hachage HMAC-SHA256 des adresses IP des clients. Doit obligatoirement être différente de `ADMIN_SESSION_SECRET`. |
| `RATE_LIMIT_DB_PATH` | Chemin absolu externe au dépôt | Oui (pour `/admin`) | Chemin absolu du fichier SQLite (ex. `/var/data/parallax/rate-limit.db`). Doit être hors du dépôt entier. Répertoire parent mode 0700, fichier mode 0600. Les liens symboliques sur tous les composants du chemin et les fichiers auxiliaires (`-wal`, `-shm`) sont strictement rejetés. Aucun chemin implicite interne par défaut. |
| `TRUST_PROXY` | `true` \| `false` | Recommandé | Si `false` (ou non défini), les en-têtes proxy (`x-forwarded-for`, `cf-connecting-ip`) sont ignorés et une clé partagée conservatrice (`127.0.0.1`) est utilisée. Si `true`, l'IP cliente doit être validée depuis un proxy inverse de confiance strict. |

### Variables futures (facultatives pour le Lot 1)

Les variables suivantes sont réservées aux lots ultérieurs (contenu éditorial, galeries privées, mailer) et sont facultatives pour le Lot 1 :
- `SITE_CONTENT_PATH`
- `GALLERY_DB_PATH`, `GALLERY_MEDIA_PATH`, `GALLERY_IMPORT_PATH`
- `GALLERY_SECRET`, `GALLERY_CODE_ENCRYPTION_KEY`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`
- `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL`

### Exemple de configuration locale (`.env.local`) avec placeholders à générer

```env
NODE_ENV=development
PUBLIC_SITE_URL=http://localhost:3000
ADMIN_PASSWORD_HASH=<GENERER_AVEC_NPM_RUN_ADMIN_HASH>
ADMIN_SESSION_SECRET=<GENERER_SECRET_SESSION_ALEATOIRE_MIN_32_CARACTERES>
RATE_LIMIT_SECRET=<GENERER_SECRET_RATE_LIMIT_DISTINCT_MIN_32_CARACTERES>
RATE_LIMIT_DB_PATH=/Users/profadmin/.parallax-data/rate-limit.db
TRUST_PROXY=false
```

---

## 4. Politique de session administrateur

- **Nature du cookie** : Le cookie `__parallax_admin_session` est un cookie **signé, et non chiffré**. Il garantit l'intégrité et l'authenticité des données de session, mais ne constitue pas un conteneur secret chiffré. Aucun mot de passe en clair, hash ou secret ne doit y être stocké.
- **Attributs de sécurité** :
  - `HttpOnly: true` (inaccessible par JavaScript côté client).
  - `SameSite: strict` (protection contre les attaques cross-site).
  - `Path: /` (portée globale du site).
  - `Secure: true` en environnement de production (HTTPS).
  - Aucun attribut `Domain` (limité à l'hôte exact).
- **Durée de rétention & validation serveur** :
  - 8 heures maximum (28 800 secondes).
  - Vérification côté serveur obligatoire via timestamp signé (`expiresAt`) pour rejeter les sessions obsolètes même si le client falsifie le `Max-Age`. Aucune prolongation implicite au-delà des 8 heures.
- **Session anonyme de pré-connexion** :
  - Une session anonyme temporaire est initialisée pour porter le jeton CSRF sur la page `GET /admin`.
  - Elle ne confère aucun privilège administrateur (`adminId` est absent).
  - Si un cookie de session expiré ou altéré est reçu sur `GET /admin`, une nouvelle session anonyme propre est générée avec un nouveau jeton CSRF et émise dans la réponse sans cookies contradictoires.
  - Lors d'une connexion réussie, une nouvelle session authentifiée est forgée depuis un stockage vide avec rotation du jeton CSRF et nouvel identifiant opaque.
- **Rotation et invalidation** :
  - Toute modification de `ADMIN_PASSWORD_HASH` ou `ADMIN_SESSION_SECRET` modifie le `credentialVersion` (HMAC-SHA256 du hash et du secret), ce qui invalide immédiatement toutes les sessions actives.
- **Limites de la déconnexion stateless** :
  - La déconnexion (`POST /admin/logout`) détruit le cookie sur le navigateur client via `destroySession`.
  - Dans une architecture de cookie stateless sans base de révocation centralisée, une copie d'un cookie valide capturée avant déconnexion resterait techniquement rejouable jusqu'à son expiration signée (`expiresAt`, 8h max). La mise en place d'une liste de révocation serveur pourra être envisagée dans un lot ultérieur si une invalidation instantanée absolue est requise.

---

## 5. Politique de limitation de débit (Rate Limiting)

- **Moteur** : `node:sqlite` natif (module synchrone `DatabaseSync`).
- **Quota administrateur** : 5 tentatives sur une fenêtre glissante de 15 minutes (900 000 ms).
- **Anonymisation** : L'adresse IP brute n'est jamais stockée sur disque ; elle est hachée via HMAC-SHA256 avec la clé `RATE_LIMIT_SECRET`.
- **Comportement en cas de dépassement** : Réponse HTTP 429 Too Many Requests avec en-tête `Retry-After` indiquant le nombre de secondes d'attente.
- **Réinitialisation** : En cas de succès d'authentification, les tentatives enregistrées pour l'IP sont automatiquement purgées. En cas de défaillance SQLite lors de la purge, une réponse 503 est retournée sans délivrer de session authentifiée.
- **Déconnexion** : L'action de déconnexion (`POST /admin/logout`) n'est pas soumise au quota de connexion pour garantir qu'un utilisateur puisse toujours clore sa session.
- **Résilience** : En cas de panne physique du stockage SQLite, le système bascule en sécurité et renvoie une réponse générique 503 Service Unavailable, sans autoriser d'accès non contrôlé.

---

## 6. Considérations sur le reverse-proxy (`TRUST_PROXY`)

- **`TRUST_PROXY=false` (mode par défaut)** :
  - Les en-têtes `X-Forwarded-For` et `CF-Connecting-IP` transmis par les clients sont scrupuleusement ignorés.
  - Le système utilise une clé partagée conservatrice (`127.0.0.1`). Cela signifie que toutes les connexions directes partagent le même quota global de 5 tentatives sur 15 minutes.
- **`TRUST_PROXY=true`** :
  - Doit être activé uniquement lorsque l'application s'exécute derrière un reverse proxy maîtrisé (Nginx, Caddy, Cloudflare).
  - L'IP cliente est extraite de `cf-connecting-ip` ou de `x-forwarded-for` avec validation stricte de l'adresse IP (`net.isIP`).
  - **Rejet strict des en-têtes multiples** : Si `x-forwarded-for` ou `cf-connecting-ip` contient une virgule (indiquant une chaîne d'IPs ou un en-tête multiple), la requête est rejetée (`null` / 403) ; le système n'extrait pas le dernier segment pour éviter l'usurpation d'adresse IP.
  - L'infrastructure amont doit impérativement écraser ces en-têtes et le serveur d'origine ne doit pas être directement exposé à Internet.

---

## 7. Comportement en cas de configuration manquante

- En l'absence des variables requises (`ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, `RATE_LIMIT_SECRET`, `RATE_LIMIT_DB_PATH`) :
  - La route publique d'accueil (`/`) reste fonctionnelle et accessible en développement.
  - L'accès à `/admin` et ses sous-routes renvoie immédiatement une réponse **503 Service Unavailable** générique.
  - Aucun mot de passe par défaut, aucune porte dérobée (backdoor) et aucun mode dégradé non sécurisé n'est autorisé.
- Au démarrage en production : une validation systématique de la configuration s'exécute avant le traitement des requêtes (`validateServerStartup()`).

---

## 8. Cartographie des routes livrées (Lot 1 & 1 bis)

| Route | Méthode | Rôle | Protection |
|---|---|---|---|
| `/admin` | `GET` | Affiche le formulaire de connexion si anonyme ; redirige vers `/admin/dashboard` si déjà authentifié. | `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`, CSP avec nonce |
| `/admin` | `POST` | Traite la soumission du mot de passe administrateur. Champs autorisés : `password`, `csrfToken` uniquement. | Origin strict, CSRF constant-time, Rate Limiting SQLite, body stream 8 Kio |
| `/admin/dashboard` | `GET` | Tableau de bord d'administration listant les 8 modules Parallax. | Authentification obligatoire, `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` |
| `/admin/logout` | `POST` | Déconnexion : détruit la session et supprime le cookie. Champ autorisé : `csrfToken` uniquement. | Authentification valide obligatoire, Origin strict, CSRF constant-time, body stream 8 Kio |
| `/admin/logout` | `GET` | Rejet explicite 405 Method Not Allowed (en-tête `Allow: POST`). | `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` |

---

## 9. Références visuelles obligatoires et flux de validation

- Les fichiers situés dans `References/parallax-site/` (`espace-client.html`, `contact.html`, `index.html`, `mobile.html`) demeurent la référence visuelle et structurelle stricte et obligatoire du projet (commit `7ff88e94316a3bbed5daa5effd24e2454afa0169` sur `chore/bootstrap`).
- La carte d'administration respecte les dimensions exactes de `espace-client.html` : largeur max 480 px, fond `#141822`, bordure `0.5px solid #232B3A`, rayon 20 px, padding 48px 44px, indicateur bleu `#1E9EFF` de 40px × 2px.
- Conformément à la convention de travail, ChatGPT effectue la revue complète du diff et procède aux fusions sur `main` après validation. Gemini livre des rapports factuels sans effectuer de merge direct.
