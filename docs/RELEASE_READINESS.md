# Guide de Préparation et Finalisation Avant Mise en Ligne — Parallax

Ce document récapitule les configurations, procédures d'exploitation, référencement et protocoles de sauvegarde pour la mise en ligne du studio Parallax.

---

## 1. Messagerie & Formulaire de Contact

### A. Adresse canonique de réception
L'adresse officielle du studio est :
```
parallax.creative.studiolm@gmail.com
```
- **Rôle public :** Cette adresse est renseignée dans les coordonnées d'entreprise (`company.email`) et synchronisée sur les pages d'Accueil et de Contact.
- **Rôle destinataire :** C'est le destinataire exclusif des notifications de formulaires de contact (`CONTACT_TO_EMAIL=parallax.creative.studiolm@gmail.com`).
- **Protection DPO / Vie privée :** Le contact dédié à l'exercice des droits RGPD (`company.privacyEmail`) reste distinct et n'est pas écrasé s'il a été spécifié séparément.

### B. Distinction entre Réception et Relais SMTP
La boîte Gmail reçoit les emails sans imposer de relais d'expédition particulier :
1. **Option Relais Externe (Brevo / Sendinblue) :**
   - Si un compte Brevo est déjà configuré avec un nom de domaine authentifié (DKIM/SPF), conservez ce relais dans le fichier `.env.local` racine. Les notifications arriveront directement dans la boîte Gmail.
   - *Attention :* On ne peut pas authentifier le domaine `gmail.com` dans Brevo (Maxime ne possède pas `gmail.com`).
2. **Option Relais Gmail SMTP (Recommandée si aucun domaine expéditeur n'est actif) :**
   - Si aucun domaine personnalisé n'est encore configuré pour l'envoi, configurez le transport Gmail SMTP standard dans le fichier `.env.local` racine :
     ```env
     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=587
     SMTP_USER=parallax.creative.studiolm@gmail.com
     CONTACT_FROM_EMAIL=parallax.creative.studiolm@gmail.com
     CONTACT_TO_EMAIL=parallax.creative.studiolm@gmail.com
     SMTP_PASSWORD=<mot-de-passe-d-application>
     ```
   - **Précision Sécurité Google :** Le mot de passe SMTP ne doit **jamais** être le mot de passe habituel du compte Google. Maxime doit :
     1. Activer la validation en deux étapes sur son compte Google (`parallax.creative.studiolm@gmail.com`).
     2. Se rendre sur [Sécurité Google > Mots de passe d'application](https://myaccount.google.com/apppasswords).
     3. Générer un mot de passe d'application dédié pour « Parallax WebSite » (16 caractères).
     4. Renseigner cette chaîne dans `SMTP_PASSWORD` du fichier `.env.local` (protégé en `0600`).

### C. Validation & Essai Manuel
- **Vérification technique de connexion :**
  ```bash
  npm run smtp:verify
  ```
  Ce script établit une connexion sécurisée (STARTTLS avec validation stricte des certificats TLS) et vérifie l'authentification sans envoyer d'email.
- **Essai de réception en conditions réelles (1 à 2 minutes) :**
  1. Ouvrir `http://127.0.0.1:3000/fr/contact`.
  2. Renseigner un formulaire d'essai avec un nom, une adresse de test personnelle et un message.
  3. Valider l'envoi.
  4. Ouvrir la boîte `parallax.creative.studiolm@gmail.com`, confirmer la réception du message, et tester la fonction « Répondre » pour s'assurer qu'elle pointe bien vers l'adresse du visiteur (`Reply-To`).

---

## 2. Référencement Technique & Découverte (SEO)

### A. Fichier `robots.txt`
Route déclarée : `/robots.txt`
- Type MIME : `text/plain; charset=utf-8`
- Déclare l'emplacement du sitemap dynamique sur l'origine publique : `Sitemap: <PUBLIC_SITE_URL>/sitemap.xml`.
- Écarte les moteurs des espaces privés et d'administration :
  - `Disallow: /admin`
  - `Disallow: /admin/`
  - `Disallow: /api/`
  - `Disallow: /fr/galerie/` et `Disallow: /en/gallery/` (galeries privées à code unique)
  - `Disallow: /fr/espace-client` et `Disallow: /en/client-area`

### B. Sitemap Dynamique `sitemap.xml`
Route déclarée : `/sitemap.xml`
- Type MIME : `application/xml; charset=utf-8`
- Conforme aux spécifications Sitemaps.org 0.9 et extensions multilingues XHTML (`xhtml:link rel="alternate" hreflang="..."`).
- **Périmètre inclus :**
  - Vitrine FR/EN : Accueil (`/fr`, `/en`), Studio (`/fr/studio`, `/en/studio`), Contact (`/fr/contact`, `/en/contact`).
  - Portfolio : Vue d'ensemble (`/fr/projets`, `/en/projects`).
  - Rubriques publiées : Slugs dynamiques localisés (ex: `/fr/projets/documentaire`, `/en/projects/documentary`).
  - Projets publiés : Slugs dynamiques des projets actifs dans des rubriques publiées.
  - Pages légales publiées : Uniquement les documents légaux ayant un snapshot `published` effectif sur le disque.
- **Périmètre exclu :**
  - Projets brouillons ou archivés.
  - Rubriques masquées.
  - Galeries privées clients et pages de connexion.
  - Routes d'administration et d'API.
  - Pages de prévisualisation administrative (`/preview`).
  - Anciens alias redirigés (301).
  - Paramètres techniques d'URL (ex: `?dir=`, `?type=`).
- **Horodatages réels :** Les balises `<lastmod>` reflètent fidèlement les dates de modification réelles des contenus (`updatedAt` / `effectiveDate`), sans inventer de timestamp par requête.

### C. Métadonnées de Partage (Open Graph & Twitter Cards)
Toutes les pages publiques (Accueil, Studio, Contact, Portfolio, Pages Légales) disposent désormais de balises complètes :
- `link rel="canonical"` sans paramètres superflus.
- `link rel="alternate" hreflang="fr|en|x-default"`.
- `meta name="robots" content="index, follow"`.
- Open Graph : `og:type`, `og:site_name`, `og:title`, `og:description`, `og:url`, `og:image`, `og:locale`, `og:locale:alternate`.
- Twitter Cards : `twitter:card="summary_large_image"` (ou `"summary"` pour légal), `twitter:title`, `twitter:description`, `twitter:image`.

---

## 3. Sauvegarde Complète & Restauration

### A. Inventaire des Données
Le site repose sur plusieurs stockages qu'il est indispensable de couvrir conjointement :
1. **Contenu éditorial vitrine :** `SITE_CONTENT_PATH` (`site-content.json`).
2. **Médias vitrine publiés :** `SITE_MEDIA_PATH` (variantes WebP/AVIF).
3. **Contenu portfolio :** `PORTFOLIO_CONTENT_PATH` (`portfolio-content.json`).
4. **Médias portfolio publiés :** `PORTFOLIO_MEDIA_PATH` (images et posters).
5. **Base des galeries privées :** `GALLERY_DB_PATH` (SQLite avec journal WAL).
6. **Médias des galeries privées :** `GALLERY_MEDIA_PATH`.
7. **Dossier des imports galeries :** `GALLERY_IMPORT_PATH` (`gallery-import/`).
8. **Base de limitation des requêtes :** `RATE_LIMIT_DB_PATH` (SQLite).
9. **Configuration privée des secrets :** `.env.local` (droits `0600`).

### B. Contrat de Cohérence Globale
Une sauvegarde cohérente nécessite que les bases SQLite, les fichiers JSON éditoriaux et les fichiers médias correspondent exactement au même instant.
- **Règle absolue :** Ne jamais planifier ni exécuter de sauvegarde complète non coordonnée pendant que l'application accepte des écritures ou des téléversements.
- **Précondition obligatoire :** Arrêter temporairement le serveur et les workers d'import avant d'exécuter la sauvegarde (`--service-stopped`), puis redémarrer le service une fois la sauvegarde publiée.
- **Mécanisme SQLite :** Le script utilise `VACUUM INTO` pour chaque base SQLite, garantissant un instantané autonome et complet intégrant toutes les transactions du WAL. Aucun repli silencieux vers une copie brute n'est toléré.
- **Calcul d'empreinte borné :** Le calcul SHA-256 lit les fichiers par blocs de 64 KB, sans jamais charger des vidéos volumineuses en mémoire.

### C. Exécution de la Sauvegarde
```bash
# 1. Mode simulation (vérification de l'inventaire et des schémas, aucune écriture)
npm run backup -- --dry-run

# 2. Sauvegarde complète réelle (après arrêt confirmé du service)
npm run backup -- --service-stopped

# Optionnel : spécifier un répertoire de sortie personnalisé
npm run backup -- --service-stopped --out-dir /chemin/vers/dossier-sauvegarde
```
- **Emplacement par défaut :** `~/.parallax-backups/parallax-backup-<timestamp>/`
- **Permissions appliquées :** `0700` pour les répertoires, `0600` pour les fichiers et secrets.
- **Publication atomique :** Les fichiers sont écrits dans un dossier temporaire privé (`.staging`), vérifiés, puis renommés de façon atomique vers la destination finale avec leur `manifest.json`.

### D. Procédure de Contrôle & Restauration
```bash
# 1. Vérification de l'intégrité et des schémas de la sauvegarde (lecture seule)
npm run restore -- --backup-dir ~/.parallax-backups/parallax-backup-<timestamp> --verify-only

# 2. Restauration de contrôle sur une cible isolée (fortement recommandé avant toute réouverture)
npm run restore -- --backup-dir ~/.parallax-backups/parallax-backup-<timestamp> --target-dir /tmp/parallax-restore-test

# 3. Restauration en place sur les emplacements d'origine (service arrêté, confirmation explicite requise)
npm run restore -- --backup-dir ~/.parallax-backups/parallax-backup-<timestamp> --force --service-stopped
```

---

## 4. Exploitation & Supervision Serveur (macOS / Linux)

### A. Contrôle de Santé / Disponibilité
Route déclarée : `/api/health`
- Réponse JSON : `{ "status": "ok", "timestamp": "..." }`
- En-tête : `Cache-Control: no-store`
- Ne divulgue aucune donnée interne ou secret.

### B. Distinction des Environnements
- **Aperçu local (`npm run preview:local`) :**
  - Conçu pour le test en boucle locale (`127.0.0.1:3000`).
  - Refuse strictement `TRUST_PROXY=true`.
  - N'exige pas de certificat HTTPS.
- **Préparation de déploiement :**
  - Compilation préalable obligatoire : `npm run build`.
  - Configuration du reverse proxy HTTPS et des chemins de persistance.
- **Production effective :**
  - `NODE_ENV=production`
  - `PUBLIC_SITE_URL=https://<domaine-officiel>`
  - Cookies `Secure` obligatoires (terminaison TLS par reverse proxy).
  - Supervision automatique du processus par `launchd` ou `systemd`.

### C. Modèle de Service macOS `launchd` (`com.parallax.web.plist`)
Pour exécuter le site Parallax en continu sur macOS (ex: Mac mini serveur) avec redémarrage automatique en cas d'incident :

1. Déterminer le chemin absolu de Node sur la machine :
   ```bash
   which node
   # Exemple : /usr/local/bin/node ou /opt/homebrew/bin/node
   ```

2. Créer le fichier `~/Library/LaunchAgents/com.parallax.web.plist` (en adaptant les chemins) :
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key>
       <string>com.parallax.web</string>
       <key>WorkingDirectory</key>
       <string>/Users/profadmin/Documents/Antigravity/Parallax Website/ParallaxWebSite-admin</string>
       <key>ProgramArguments</key>
       <array>
           <string>/usr/local/bin/node</string>
           <string>node_modules/@react-router/serve/bin.js</string>
           <string>build/server/index.js</string>
       </array>
       <key>EnvironmentVariables</key>
       <dict>
           <key>NODE_ENV</key>
           <string>production</string>
           <key>PORT</key>
           <string>3000</string>
           <key>HOST</key>
           <string>127.0.0.1</string>
       </dict>
       <key>RunAtLoad</key>
       <true/>
       <key>KeepAlive</key>
       <true/>
       <key>StandardOutPath</key>
       <string>/Users/profadmin/.parallax-data/logs/parallax-stdout.log</string>
       <key>StandardErrorPath</key>
       <string>/Users/profadmin/.parallax-data/logs/parallax-stderr.log</string>
   </dict>
   </plist>
   ```

3. Vérifier la syntaxe du fichier plist :
   ```bash
   plutil -lint ~/Library/LaunchAgents/com.parallax.web.plist
   ```

4. Charger et démarrer le service :
   ```bash
   mkdir -p ~/.parallax-data/logs
   launchctl load ~/Library/LaunchAgents/com.parallax.web.plist
   launchctl start com.parallax.web
   ```

### D. Configuration Reverse Proxy (Nginx / Caddy)
Parallax écoute en interne sur `127.0.0.1:3000`. Un reverse proxy public gère le nom de domaine officiel, la terminaison HTTPS et les certificats TLS.

**Directives pour Nginx (`/etc/nginx/sites-available/parallax`) :**
```nginx
server {
    listen 80;
    server_name parallax.studio; # Remplacer par le domaine réel
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name parallax.studio; # Remplacer par le domaine réel

    ssl_certificate /etc/letsencrypt/live/parallax.studio/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/parallax.studio/privkey.pem;

    client_max_body_size 100M; # Adapté aux imports de médias

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Gestion des connexions persistantes
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

**Règles IP & `TRUST_PROXY` :**
- Dans le fichier `.env.local` de production : positionner `TRUST_PROXY=true` uniquement lorsque le serveur est placé derrière ce reverse proxy de confiance. Cela permet au middleware de limitation de débit (`rate-limit.server.ts`) d'utiliser l'adresse IP cliente transmise dans `X-Forwarded-For`.
- En prévisualisation locale (`npm run preview:local`), `TRUST_PROXY=true` est interdit pour empêcher toute usurpation d'adresse IP en local.

### E. Gestion des Journaux (Logs)
Les journaux applicatifs sont redirigés vers `~/.parallax-data/logs/`.
Sur macOS, la rotation des journaux peut être configurée via `newsyslog` en créant `/etc/newsyslog.d/parallax.conf` (avec droits root) :
```
# logfilename                                                 [owner:group]  mode count size when  flags [/pid_file] [sig_num]
/Users/profadmin/.parallax-data/logs/parallax-stdout.log      profadmin:staff 640  7     5120 *     J
/Users/profadmin/.parallax-data/logs/parallax-stderr.log      profadmin:staff 640  7     5120 *     J
```
*(Cette configuration compresse les journaux dès qu'ils atteignent 5 Mo et conserve 7 rotations).*

### F. Pages Légales Publiées & Republication
Conformément aux règles de sécurité éditoriale, les versions publiées des documents légaux sur le disque restent **strictement immuables** et ne sont jamais republiées automatiquement lors de modifications des coordonnées de l'entreprise.

- L'adresse email publique a été actualisée vers `parallax.creative.studiolm@gmail.com`.
- Pour répercuter cette nouvelle adresse dans les Mentions Légales et la Politique de Confidentialité publiées :
  1. Se connecter à l'administration `/admin`.
  2. Ouvrir le menu **Pages Légales** (`/admin/legal`).
  3. Vérifier le brouillon de la page **Mentions Légales** et **Confidentialité**.
  4. Cliquer sur **Publier le document** lorsque Maxime le souhaite.
