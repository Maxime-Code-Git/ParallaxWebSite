# Parallax - Conservation, Suppression et Exports des Galeries (Lot 5)

Ce document décrit l'architecture, le fonctionnement opérationnel, les garanties de sécurité et les règles de gestion du module **Conservation et suppression** (`/admin/data-retention`) de Parallax.

---

## 1. Principes Fondamentaux et Distinction des Échéances

### Expiration client vs Purge physique

Il est primordial de ne pas confondre **l'expiration de l'accès client** et **la suppression définitive des données** :

1. **Date d'expiration (`expires_at`)** :
   - Fixée lors de la publication de la galerie (ou mise à jour dans l'éditeur de galerie).
   - À cette date, l'accès client est immédiatement révoqué : toute tentative de connexion ou de chargement de média renvoie une réponse HTTP 401.
   - Les médias, miniatures et métadonnées restent intégralement conservés sur le serveur pour consultation, export ou prolongation par l'administrateur.

2. **Date prévisionnelle de purge (`scheduled_purge_at`)** :
   - Calculée en UTC selon la politique de rétention active :
     $$\text{scheduledPurgeAt} = \text{expiresAt} + (\text{retentionDays} \times 86\,400\,000\text{ ms})$$
   - Si la politique automatique est désactivée ou si le délai n'est pas configuré (`retentionDays === null`), le système affiche **« Non configurée »** et aucune suppression automatique n'intervient.
   - Les brouillons (`status: 'draft'`) sans date d'expiration ne deviennent jamais éligibles à la purge automatique.
   - Le statut archivé (`status: 'archived'`) ne déclenche aucune suppression immédiate à lui seul.

---

## 2. Valeurs Initiales et Règles de la Politique de Conservation

### Configuration par défaut
Conformément aux exigences du projet, la politique de conservation s'initialise dans un état strictly inoffensif :
- **Activation automatique (`enabled`)** : `false` (désactivée par défaut).
- **Délai après expiration (`retention_days`)** : `null` (non configuré).
- **Conservation du journal d'audit (`log_retention_days`)** : `null` (conservation indéfinie tant que non configuré).
- **Révision (`revision`)** : `1`.

Aucune durée légale ou contractuelle arbitraire (ex: 24 mois) n'est pré-imposée dans Parallax. L'activation et le choix du délai relèvent d'une décision explicite de l'opérateur.

### Éligibilité stricte à la purge automatique
Une galerie n'est éligible à la purge automatique par le superviseur que si **toutes** les conditions suivantes sont réunies :
1. La politique est activée (`enabled === true`) et possède un délai configuré (`retentionDays !== null`).
2. La galerie a le statut `published` ou `archived`.
3. `expires_at` est non nul et passé dans le temps.
4. La date calculée `scheduled_purge_at` est atteinte ou dépassée.
5. La galerie n'est pas exemptée (`retention_exempt === 0`).
6. Aucun import de médias n'est en cours pour cette galerie (en cas d'import actif, la suppression est reportée au cycle suivant).

### Exemption de conservation
Une galerie peut être marquée individuellement comme **exemptée de purge** depuis le tableau de rétention, avec un motif court sans données personnelles sensibles (ex: *« Archivage patrimonial »*, *« Litige en cours »*).
- L'exemption interdit toute suppression automatique par le superviseur.
- Une suppression manuelle explicitement confirmée par l'administrateur reste toujours possible sur une galerie exemptée.

---

## 3. Prévisualisation d'Impact Obligatoire (Simulation)

Avant d'enregistrer une politique activée ou de réduire le délai de rétention :
1. L'administrateur doit obligatoirement cliquer sur **« Simuler l'impact »** sur la page `/admin/data-retention/settings`.
2. Le serveur calcule l'ensemble fermé des galeries qui deviendraient immédiatement éligibles à la purge sous ces nouveaux paramètres, avec le nombre total et le volume disque estimé.
3. Si au moins une galerie devient éligible immédiatement, l'enregistrement des paramètres est bloqué tant que l'administrateur n'a pas coché la case de confirmation explicite :
   *« Je confirme avoir vérifié l'impact et autorise la suppression automatique des galeries immédiatement éligibles. »*
4. La révision de configuration (`revision`) est revalidée lors de l'enregistrement pour parer à toute collision concurrente (erreur HTTP 409).

---

## 4. Moteur Unique de Suppression et Garanties Transactionnelles

Parallax intègre un service unique de suppression partagé entre l'éditeur de galerie (`/admin/galleries/:id`) et le tableau de rétention (`/admin/data-retention`).

### Étapes d'une suppression (unitaire ou groupée jusqu'à 50) :
1. **Validation transactionnelle globale** :
   - Vérification de chaque UUID et de sa révision optimiste (`expectedRevision`).
   - Si une seule révision diverge ou si un identifiant est introuvable, l'ensemble de l'opération est avorté avec une erreur HTTP 409 ; aucune galerie ne subit de mutation partielle.
2. **Annulation des imports actifs** :
   - Tout worker d'import actif sur les galeries ciblées est marqué comme annulé.
3. **Révocation immédiate des accès** :
   - Les clés d'accès (`gallery_codes`) et les sessions clientes associées sont supprimées en cascade dans la transaction SQLite.
4. **Intention durable de suppression** :
   - Un job de suppression est persisté dans `gallery_deletion_jobs` avec le statut `pending`, le chemin de quarantaine cible, et la source de décision (`'manual'` ou `'policy_rev_<X>'`).
5. **Déplacement en quarantaine hors transaction** :
   - Le répertoire de la galerie sous `GALLERY_MEDIA_PATH` est déplacé de façon atomique vers `.trash/gallery-deletions/<jobId>` (permissions `0700`).
   - La transaction SQLite est refermée avant toute opération lourde sur le disque pour préserver la réactivité du serveur.
6. **Effacement physique asynchrone** :
   - Le worker d'arrière-plan efface récursivement le dossier en quarantaine et met à jour le statut du job en `completed` avec l'horodatage `completed_at`.

### Reprise après interruption (Crash Recovery)
Si le serveur s'arrête brutalement pendant le traitement :
- Au redémarrage, le superviseur détecte les jobs `pending` ou `processing` dont le bail a expiré.
- Le worker vérifie si le dossier de la galerie est encore à son emplacement d'origine ou déjà dans `.trash/`.
- Les descripteurs sont nettoyés et l'effacement en quarantaine reprend sans laisser d'orphelins sur disque.

### Relance contrôlée des échecs
Si un job échoue (ex: erreur d'E/S disque), il passe au statut `failed` avec un code d'erreur normalisé visible dans l'administration.
- Un bouton d'action sécurisé (POST authentifié avec CSRF) permet de relancer la tentative.
- Le système refuse de voler un job en cours d'exécution active (`processing` sous bail valide).

---

## 5. Préservation Absolue des Dossiers Sources (`gallery-import/`)

### Cloisonnement du dossier de dépôt
Maxime dépose ses photos et vidéos à importer dans `gallery-import/<projet>/photos/` et `videos/`.
- **Ce dossier est un espace de dépôt externe.**
- **Le moteur de suppression Parallax ne touche JAMAIS aux fichiers présents dans `gallery-import/`.**
- La purge ne détruit que les copies de travail et les miniatures générées sous `~/.parallax-data/gallery-media/`.

### Bilan et nettoyage manuel
Lorsqu'une galerie est supprimée, le bilan indique les dossiers sources connus qui ont servi à l'alimenter. Un guide rappelle à l'opérateur comment libérer de l'espace sur son Mac via le Finder si ces fichiers ne sont plus nécessaires.

---

## 6. Exports Privés d'Administration (`/api/admin/data-retention/gallery-export`)

L'administrateur peut exporter les données d'une galerie à tout moment, y compris après son expiration client, tant qu'elle n'est pas engagée dans un processus de suppression.

### 1. Export Métadonnées JSON (`exportType=json`)
- Renvoie un document JSON structuré conforme (`schemaVersion: 1`).
- Contient les textes éditoriaux bilingues FR/EN, nom client, date du projet, statut, date d'expiration, et l'inventaire complet des médias (nom original, dimensions, taille, hash de contenu SHA-256).
- **Exclusion stricte de sécurité** : Aucun code d'accès en clair, aucun hash ou chiffrement AES, aucun jeton de session, aucun cookie ni chemin absolu système.

### 2. Export Originaux ZIP (`exportType=zip`)
- Streaming paresseux en continu via `yazl` avec descripteurs de fichiers sécurisés (`openSecureMediaFile` avec `O_RDONLY | O_NOFOLLOW`).
- Rejet strict de tout lien symbolique.
- Les fichiers ne sont ouverts que lorsque yazl commence à en extraire les octets.
- En cas de déconnexion du client ou d'annulation, tous les descripteurs ouverts sont immédiatement refermés et le slot de concurrence est restitué.
- Si une suppression est déjà engagée (`pending` ou `processing`), l'export est refusé avec HTTP 409 pour éviter toute archive incomplète.

---

## 7. Cadre Juridique et Limites de Responsabilité

> [!IMPORTANT]
> **Outil technique de gestion — Non-substitut à une politique juridique** :
> Ce module fournit des mécanismes techniques rigoureux (révocation d'accès, purges programmées, traçabilité d'audit, exports).
> Il ne constitue pas à lui seul une certification de conformité juridique globale. La politique de conservation contractuelle et les mentions légales définitives relèvent du Lot 7.

Pour toute formulation relative aux données à caractère personnel, se référer aux textes de référence :
- [RGPD - Chapitre II (Principes de traitement)](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre2)
- [RGPD - Chapitre III (Droits de la personne concernée)](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre3)
