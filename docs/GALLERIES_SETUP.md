# Parallax - Guide de Configuration : Espace Client & Galeries Privées (Lot 4)

Ce guide détaille la mise en place, l'arborescence des fichiers, les flux d'import et le cycle de vie des galeries privées à code d'accès unique.

---

## 1. Variables d'Environnement et Commande de Setup

Les galeries privées Parallax reposent sur un stockage SQLite natif V1 et un stockage de médias strictement cloisonné.

### Clés requises dans `.env.local`

```dotenv
GALLERY_DB_PATH=/Users/profadmin/.parallax-data/gallery.sqlite
GALLERY_MEDIA_PATH=/Users/profadmin/.parallax-data/gallery-media
GALLERY_IMPORT_PATH=/Users/profadmin/.parallax-data/gallery-import
GALLERY_SECRET=<64 caractères hexadécimaux / 32 octets aléatoires>
GALLERY_CODE_ENCRYPTION_KEY=<64 caractères hexadécimaux / 32 octets aléatoires>
```

### Initialisation automatique idempotente

Exécuter la commande suivante à la racine du projet :

```bash
npm run gallery:setup
```

Cette commande effectue les opérations suivantes :
- Prépare les dossiers privés par défaut sous `~/.parallax-data/` avec permissions strictes (`0700`).
- Génère les deux secrets cryptographiques manquants (`GALLERY_SECRET` et `GALLERY_CODE_ENCRYPTION_KEY`) de 32 octets aléatoires.
- Ajoute les clés manquantes dans `.env.local` avec permissions de fichier restreintes (`0600`).
- Préserve l'intégralité des valeurs et secrets existants (aucune écrasement ni duplication).
- Ne journalise ni mot de passe, ni hash Argon2, ni secret.

---

## 2. Arborescence du Dossier d'Import Contrôlé

Pour importer des médias dans une galerie, Maxime dépose les fichiers dans un sous-dossier de `GALLERY_IMPORT_PATH` (`~/.parallax-data/gallery-import/`).

### Structure attendue

```text
GALLERY_IMPORT_PATH/
  nom-du-dossier/
    photos/
      photo-01.jpg
      photo-02.jpg
      photo-03.webp
    videos/
      film.mp4
```

### Règles structurelles

- Le sous-dossier peut contenir uniquement un répertoire `photos/`, uniquement un répertoire `videos/`, ou les deux.
- Aucun sous-dossier invité ou couple.
- Les fichiers sources restent intacts dans le dossier d'import : ils sont copiés vers le stockage privé `GALLERY_MEDIA_PATH` de manière atomique.

---

## 3. Formats et Garde-fous Techniques

### Photos acceptées

- **Formats** : JPEG (`image/jpeg`), PNG (`image/png`), WebP (`image/webp`), AVIF (`image/avif`).
- **Taille maximale par fichier** : 60 MiB.
- **Dimensions maximales** : 16 384 x 16 384 pixels, limite de 100 000 000 pixels au total.
- **Rejets stricts** : RAW, SVG, GIF animés, fichiers multipages, fake headers ou extensions trompeuses (vérification de signature par magic bytes).

### Vidéos acceptées

- **Formats** : MP4 (`video/mp4`), WebM (`video/webm`).
- **Taille maximale par fichier** : 10 GiB.
- **Streaming** : Lecture en continu avec support natif des en-têtes HTTP Range (RFC 7233 : 206 Partial Content, Content-Range, Accept-Ranges, 416 pour plages hors limites).
- **Posters vidéo** : Téléversement multipart natif d'une image de couverture (limite 25 MiB, Sharp, métadonnées privées purgées).

### Previews privées persistantes

Pour chaque photo importée, trois variantes WebP sont générées de manière persistante :
- `480` : Qualité 80 (grille compacte).
- `960` : Qualité 80 (grille standard).
- `1920` : Qualité 84 (lightbox haute définition).

Les métadonnées EXIF d'orientation sont appliquées automatiquement et les métadonnées sensibles (GPS, appareil) sont purgées des variantes. Concurrence globale bornée par `imageProcessingLimiter` (maximum 2 instances Sharp simultanées).

---

## 4. Cycle de Vie et Workflow Administrateur

1. **Création (`/admin/galleries/new`)** :
   - Saisie du titre, nom client, date du projet, lieu optionnel, textes FR/EN (intro et signature).
   - Génération automatique d'un code unique sécurisé préfixé `PARALLAX-` avec 96 bits d'entropie.
   - Galerie initialisée au statut `draft` (brouillon).
2. **Analyse du dossier (`POST /api/admin/galleries/:id/import`)** :
   - Inspection du sous-dossier choisi : nombre de photos et vidéos valides, rejets motivés, doublons éventuels par hash SHA-256.
3. **Import persistant à bail atomique** :
   - Démarrage d'un job asynchrone sécurisé par bail SQLite avec renouvellement régulier (`UPDATE ... RETURNING`).
   - Copie en streaming via descripteurs de fichiers sécurisés (`O_NOFOLLOW`, confinement de chemin).
   - Suivi de progression temps réel (`GET /api/admin/galleries/:id/imports/:importId`) sans réinitialisation de la saisie utilisateur.
4. **Couverture & Poster** :
   - Sélection de la couverture parmi les photos de la galerie.
   - Téléversement d'un poster pour chaque vidéo via un sélecteur de fichier natif.
5. **Publication** :
   - Choix obligatoire d'une date d'expiration future.
   - Au moins un média prêt requis.
   - Statut passe à `published`.
6. **Rotation du code d'accès** :
   - Nouveau code généré, incrémentation de la version (`version + 1`).
   - Révocation immédiate de toutes les sessions actives des clients ayant l'ancienne version.
7. **Suppression sécurisée transactionnelle** :
   - Confirmation textuelle exacte du titre de la galerie requise.
   - Révocation des accès, annulation des imports en cours, déplacement en quarantaine et suppression ordonnée.

---

## 5. Expérience et Sécurité Côté Client

1. **Connexion (`/fr/espace-client` ou `/en/client-area`)** :
   - Champ unique pour le code d'accès, aucun compte ni mot de passe requis.
   - Normalisation automatique du code (insensible à la casse et aux tirets).
   - Protection CSRF et limitation de débit intégrée.
2. **Consultation de la galerie (`/fr/galerie/:publicId` ou `/en/gallery/:publicId`)** :
   - Grille masonry responsive (3 colonnes desktop, mobile fluide).
   - Bouton de téléchargement rond sur chaque photo.
   - Lecteur vidéo 16:9 avec poster et bouton de téléchargement du fichier original.
   - Lightbox accessible : navigation au clavier (Flèches, Echap), piège de focus et restauration.
3. **Téléchargements ZIP en streaming** :
   - Options : Tout (`type=all`), Photos uniquement (`type=photos`), Vidéos uniquement (`type=videos`).
   - Streaming instantané via `yazl` avec `compress: false` (zéro mise en mémoire tampon excessive).
4. **Déconnexion (`POST /api/gallery/logout`)** :
   - Destruction du cookie `__parallax_gallery_session` et redirection vers la page de connexion.

---

## 6. Reprise Après Interruption

Si le serveur s'arrête ou redémarre pendant un import :
- Le worker d'import reprend les jobs en cours grâce au mécanisme de bail SQLite expiré.
- Les fichiers partiellement copiés en zone temporaire sont nettoyés.
- Les doublons de médias déjà importés et vérifiés sont ignorés sans corruption.
