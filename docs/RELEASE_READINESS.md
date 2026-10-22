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
   - Si un compte Brevo est déjà configuré avec un nom de domaine authentifié (DKIM/SPF), conservez ce relais dans `.env.local`. Les notifications arriveront directement dans la boîte Gmail.
   - *Attention :* On ne peut pas authentifier le domaine `gmail.com` dans Brevo (Maxime ne possède pas `gmail.com`).
2. **Option Relais Gmail SMTP (Recommandée si aucun domaine expéditeur n'est actif) :**
   - Si aucun domaine personnalisé n'est encore configuré pour l'envoi, configurez le transport Gmail SMTP standard dans `.env.local` :
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
  - `/admin/`
  - `/api/`
  - `/fr/galerie/` et `/en/gallery/` (galeries privées à code unique)
  - `/fr/espace-client` et `/en/client-area`

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
- Twitter Cards : `twitter:card="summary_large_image"`, `twitter:title`, `twitter:description`, `twitter:image`.

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

### B. Cohérence SQLite & Mécanisme
Pour éviter les sauvegardes corrompues dues au mode WAL (Write-Ahead Logging) d'un SQLite actif, le script utilise la commande standard `VACUUM INTO '<destination>'`. Elle produit un fichier SQLite autonome, compacté et à jour de toutes ses transactions sans dépendre de fichiers `-wal` séparés.

### C. Exécution de la Sauvegarde
```bash
# Simulation sans écriture (vérification de l'inventaire)
node scripts/backup.js --dry-run

# Sauvegarde complète horodatée
node scripts/backup.js
```
- **Emplacement par défaut :** `~/.parallax-backups/parallax-backup-<timestamp>/`
- **Permissions appliquées :** `0700` pour le répertoire de sauvegarde, `0600` pour les fichiers.
- **Manifeste d'intégrité :** Un fichier `manifest.json` consigne l'empreinte SHA-256 de chaque fichier pour validation lors de la restauration.

### D. Procédure de Restauration
```bash
# 1. Vérification de l'intégrité de l'archive (empreintes SHA-256)
node scripts/restore.js --backup-dir ~/.parallax-backups/parallax-backup-<timestamp> --verify-only

# 2. Restauration de contrôle sur un dossier isolé (recommandé avant réouverture)
node scripts/restore.js --backup-dir ~/.parallax-backups/parallax-backup-<timestamp> --target-dir /tmp/parallax-restore-test

# 3. Restauration aux emplacements d'origine (service arrêté)
node scripts/restore.js --backup-dir ~/.parallax-backups/parallax-backup-<timestamp> --force
```

### E. Proposition de Planification Quotidienne (macOS launchd)
Exemple de fichier LaunchAgent à renseigner et déposer dans `~/Library/LaunchAgents/com.parallax.backup.plist` (non installé automatiquement) :
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.parallax.backup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/profadmin/Documents/Antigravity/Parallax Website/ParallaxWebSite-admin/scripts/backup.js</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>3</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/profadmin/.parallax-backups/backup.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/profadmin/.parallax-backups/backup-error.log</string>
</dict>
</plist>
```

---

## 4. Exploitation & Mise en Ligne

### A. Contrôle de Santé / Disponibilité
Route déclarée : `/api/health`
- Réponse JSON : `{ "status": "ok", "timestamp": "..." }`
- En-tête : `Cache-Control: no-store`
- Ne divulgue aucune donnée interne ou secret.

### B. Commandes de Démarrage
- **Mode prévisualisation locale (loopback uniquement) :**
  ```bash
  npm run preview:local
  ```
  Accessible sur `http://127.0.0.1:3000`.
- **Mode production réel :**
  ```bash
  npm run build
  npm run start
  ```
  En production :
  - `NODE_ENV=production`
  - `PUBLIC_SITE_URL=https://<domaine-reel>`
  - Cookies `Secure` obligatoires (nécessite HTTPS).
  - Reverse proxy de confiance (Nginx, Caddy ou Cloudflare) gérant la terminaison TLS.

### C. Pages Légales Publiées & Republication
Conformément aux règles de sécurité éditoriale, les versions publiées des documents légaux sur le disque restent **strictement immuables** et ne sont jamais republiées automatiquement lors de modifications des coordonnées de l'entreprise.

- L'adresse email publique a été actualisée vers `parallax.creative.studiolm@gmail.com`.
- Pour répercuter cette nouvelle adresse dans les Mentions Légales et la Politique de Confidentialité publiées :
  1. Se connecter à l'administration `/admin`.
  2. Ouvrir le menu **Pages Légales** (`/admin/legal`).
  3. Vérifier le brouillon de la page **Mentions Légales** et **Confidentialité**.
  4. Cliquer sur **Publier le document** lorsque Maxime le souhaite.
