# Documentation Lot 7 — Entreprise, Pages Légales et Confidentialité (APD)

Ce document fournit l'inventaire exhaustif des traceurs et cookies techniques, le protocole de test manuel multi-résolutions (Desktop 1440px et Mobile 390px), ainsi que la liste des mentions légales restant à compléter et confirmer par Maxime avant la mise en production.

---

## 1. Inventaire exhaustif des traceurs et cookies

Le site Parallax applique une politique de stricte minimisation des données, conforme aux lignes directrices de l'**Autorité de Protection des Données (APD)** belge et au **RGPD**.

### Cookies strictement nécessaires (exemptés de consentement préalable)

| Nom du cookie | Finalité technique | Durée de rétention | Sécurité / Attributs |
|---|---|---|---|
| `__parallax_admin_session` | Maintien de la session d'administration authentifiée | 8 heures (glissante) | HttpOnly, SameSite=Lax, Secure (prod) |
| `__parallax_client_session` | Maintien de l'accès client sécurisé à une galerie privée | 7 jours | HttpOnly, SameSite=Lax, Secure (prod) |
| `__parallax_contact_ctx` | Contexte éphémère anonyme anti-spam (liaison cryptographique du jeton `_token`) | 2 heures | HttpOnly, SameSite=Lax, Secure (prod) |
| `__parallax_contact_flash` | Notification éphémère PRG (bandeau vert de succès après envoi du formulaire) | Usage unique (supprimé à la première lecture) | HttpOnly, SameSite=Lax, Secure (prod) |

### Cookie de préférences de confidentialité (soumis à validation explicite)

| Nom du cookie | Finalité technique | Durée de rétention | Sécurité / Attributs |
|---|---|---|---|
| `__parallax_privacy_prefs` | Mémorisation du choix d'activation des lecteurs vidéo externes (YouTube, Vimeo) | 180 jours (~6 mois) | SameSite=Lax, Path=/, Secure (prod), signé HMAC-SHA256 |

> [!NOTE]
> - Si l'utilisateur clique sur « Accepter pour cette vidéo » **sans** cocher « Mémoriser mon choix », le consentement est conservé uniquement en mémoire pour la durée de visite de la page. Aucun cookie n'est déposé.
> - Le cookie `__parallax_privacy_prefs` n'est émis que si la case « Mémoriser mon choix » a été explicitement cochée par l'utilisateur.

### Traceurs tiers et intégrations externes

- **YouTube** : Intégration via le domaine `www.youtube-nocookie.com`. Aucun appel réseau ni cookie tiers n'est déclenché tant que l'utilisateur n'a pas validé son consentement.
- **Vimeo** : Intégration via `player.vimeo.com` avec le paramètre `dnt=1` (Do Not Track) pour empêcher l'analyse comportementale tierce.
- **Polices typographiques** : Polices Google Fonts (Space Grotesk, Hanken Grotesk, Cormorant Garamond) auto-hébergées localement en format WOFF2 dans `/fonts/`. Aucun appel vers `fonts.googleapis.com` ou `fonts.gstatic.com`.
- **Statistiques & Mesure d'audience** : Aucun outil de tracking tiers (ex. Google Analytics, Meta Pixel) n'est installé.

---

## 2. Protocole de test manuel multi-résolutions

### Environnements de test recommandés
- **Desktop** : Largeur standard 1440px (Chrome / Firefox / Safari).
- **Mobile** : Largeur standard 390px (iPhone 12/13/14/15/16 Pro).

---

### Test 1 : Parcours public des pages légales (Desktop 1440px & Mobile 390px)

1. **Navigation et liens du Footer** :
   - Naviguer vers la page d'accueil `/fr`.
   - Faire défiler jusqu'au pied de page (`Footer`).
   - Vérifier la présence des 4 liens bilingues : « Mentions légales », « Confidentialité », « CGV », « Cookies » ainsi que le lien d'action « Gérer mes préférences ».
   - Cliquer sur « Mentions légales » : vérifier que l'URL cible est `/fr/mentions-legales`.
2. **Bascule linguistique (FR <-> EN)** :
   - Sur `/fr/mentions-legales`, cliquer sur le sélecteur « EN » dans l'en-tête.
   - Vérifier la redirection immédiate vers `/en/legal-notice`.
   - Vérifier la balise `<link rel="canonical" href=".../en/legal-notice">`.
   - Vérifier les balises `<link rel="alternate" hreflang="fr" href=".../fr/mentions-legales">` et `hreflang="en"`.
3. **Redirections 301 des URLs patrimoniales** :
   - Saisir manuellement dans la barre d'adresse : `/en/mentions-legales`.
   - Vérifier la redirection automatique en HTTP 301 vers `/en/legal-notice`.
   - Tester également `/en/confidentialite` -> `/en/privacy-policy`, `/en/cgv` -> `/en/terms`, et `/fr/politique-de-confidentialite` -> `/fr/confidentialite`.
4. **Mise en page responsive Space Grotesk** :
   - **À 1440px** : Le titre principal est affiché à 60px avec marge supérieure de 96px, marge inférieure de 40px, et un espacement de section de 80px. La grille d'identité affiche 2 colonnes équilibrées.
   - **À 390px** : Les marges s'adaptent (80px top, 32px bottom, 56px entre sections). Le titre passe à 36px, et la grille d'identité bascule sur 1 seule colonne lisible sans débordement horizontal.

---

### Test 2 : Lecteur vidéo externe & Consentement APD (Desktop & Mobile)

1. **Vérification de l'absence de requête réseau préalable** :
   - Ouvrir la console développeur du navigateur (onglet Réseau).
   - Filtrer sur `youtube` ou `vimeo`.
   - Cliquer sur un projet vidéo ou le showreel pour ouvrir la modale `VideoModal`.
   - **Résultat attendu** : Aucune requête vers `youtube-nocookie.com` ou `vimeo.com`. Un panneau d'information neutre et équilibré s'affiche dans la modale.
2. **Lecture ponctuelle sans cookie** :
   - Laisser la case « Mémoriser mon choix » décochée.
   - Cliquer sur « Activer pour cette vidéo ».
   - **Résultat attendu** : L'iframe de la vidéo se charge et commence la lecture. Dans l'onglet Application / Stockage, **aucun** cookie `__parallax_privacy_prefs` n'a été créé.
   - Fermer la modale et la rouvrir : le panneau de consentement s'affiche à nouveau (le consentement n'a pas été persisté).
3. **Mémorisation du consentement** :
   - Cocher la case « Mémoriser mon choix pour mes prochaines visites ».
   - Cliquer sur « Activer pour cette vidéo ».
   - **Résultat attendu** : Le cookie signé `__parallax_privacy_prefs` apparaît dans les cookies du site avec une validité de 180 jours.
   - Ouvrir une autre vidéo YouTube : elle se lance directement sans redemander le consentement.
4. **Révocation immédiate et démontage de l'iframe** :
   - Cliquer sur « Gérer mes préférences » dans le footer ou se rendre sur `/fr/cookies`.
   - Cliquer sur « Révoquer tous mes consentements » (ou décocher YouTube et enregistrer).
   - Revenir sur la vidéo en cours : **l'iframe est immédiatement démontée du DOM** et le panneau de consentement réapparaît instantanément.

---

### Test 3 : Administration de l'entreprise & Synchronisation canonique (`/admin/company`)

1. **Accès et authentification** :
   - Se connecter à `/admin` puis accéder à la rubrique « Entreprise » (`/admin/company`).
2. **Modification des coordonnées canoniques** :
   - Modifier le nom commercial : `Parallax Studio`.
   - Modifier l'e-mail public : `contact@parallax.be`.
   - Modifier le téléphone : `+32 470 12 34 56`.
   - Modifier l'URL Instagram et YouTube.
   - Cliquer sur « Enregistrer ».
3. **Vérification de la synchronisation canonique** :
   - Naviguer sur le site public `/fr`.
   - Vérifier que l'en-tête affiche le nouveau nom commercial.
   - Vérifier que la section contact du pied de page et de la page `/fr/contact` affichent la nouvelle adresse e-mail, le nouveau numéro de téléphone et les nouveaux liens sociaux.
4. **Protection contre les conflits concurrents (HTTP 409)** :
   - Ouvrir deux onglets distincts sur `/admin/company`.
   - Modifier et enregistrer une valeur dans le premier onglet (la révision change).
   - Tenter d'enregistrer une modification dans le second onglet (qui possède l'ancienne révision).
   - **Résultat attendu** : Un message clair de conflit de révision (HTTP 409) avertit l'administrateur sans écraser aveuglément les données.

---

### Test 4 : Cycle de vie des pages légales & Prévisualisation privée (`/admin/legal`)

1. **Édition du brouillon** :
   - Accéder à `/admin/legal/privacy`.
   - Modifier le titre public FR : « Notre engagement pour votre vie privée ».
   - Cliquer sur « Enregistrer le brouillon ».
   - Consulter la page publique `/fr/confidentialite` : **le texte public reste strictement inchangé** (le brouillon n'a aucun impact sur la version publique en ligne).
2. **Prévisualisation privée authentifiée** :
   - Depuis l'éditeur, cliquer sur « Prévisualiser le brouillon ».
   - L'URL `/admin/legal/privacy/preview` s'affiche avec un bandeau noir d'avertissement « Mode Prévisualisation Privée (Brouillon) ».
   - Copier l'URL et l'ouvrir dans une fenêtre de navigation privée (non authentifiée) : **redirection immédiate vers `/admin` avec code 303**.
3. **Validation anti-placeholders à la publication** :
   - Insérer volontairement la mention `[à compléter]` dans une section du brouillon.
   - Cliquer sur « Publier cette version ».
   - **Résultat attendu** : La publication est refusée avec un message explicite indiquant que des mentions non complétées (placeholders) subsistent.
4. **Publication et dépublication** :
   - Remplacer le placeholder par un texte définitif et cliquer sur « Publier ».
   - Le statut passe à « Publié », la version est incrémentée (`v1` -> `v2`), et la page publique `/fr/confidentialite` affiche instantanément la nouvelle version.
   - Cliquer sur « Dépublier » : la version publiée repasse à l'état non publié, et la page publique affiche l'état neutre « Document en cours de mise à jour » avec une balise `noindex, nofollow`.

---

## 3. Checklist des informations juridiques à compléter par Maxime

> [!IMPORTANT]
> Pour que les mentions légales et les conditions générales de vente soient juridiquement conformes et opposables avant l'ouverture commerciale du studio, Maxime doit valider et renseigner les éléments suivants dans `/admin/company` et `/admin/legal` :

### 1. Paramètres d'entreprise (`/admin/company`)
- [ ] **Forme juridique exacte** : Personne physique (indépendant en nom propre) ou personne morale (SRL, SA, etc.).
- [ ] **Dénomination sociale officielle** : Nom enregistré auprès de la Banque-Carrefour des Entreprises (BCE) (actuellement en attente, mention `Parallax` ou raison sociale de Maxime).
- [ ] **Adresse du siège social / établissement** : Adresse physique enregistrée en Belgique (actuellement non renseignée pour protéger la vie privée).
- [ ] **Numéro d'entreprise / BCE** : Numéro au format `0XXX.XXX.XXX`.
- [ ] **Numéro de TVA intracommunautaire** : Format `BE 0XXX.XXX.XXX` (ou mention d'exonération de TVA selon le régime de la petite entreprise, article 56bis du Code de la TVA).
- [ ] **Directeur de la publication** : Nom et prénom du responsable légal de la publication.
- [ ] **Coordonnées de l'hébergeur** : Nom social exact, adresse postale et numéro de téléphone du prestataire d'hébergement (ex. Infomaniak Network SA, Suisse).
- [ ] **Publication de l'identité** : Cocher la case « Confirmer et publier l'identité d'entreprise sur le site public » une fois l'ensemble des données vérifiées.

### 2. Conditions Générales de Vente (CGV — `/admin/legal/terms`)
- [ ] **Modalités financières** : Montant de l'acompte à la commande (ex. 30 % ou 50 %), délais de paiement des factures de solde, pénalités de retard et indemnité forfaitaire de recouvrement (loi belge du 2 août 2002).
- [ ] **Cession des droits d'auteur & Propriété intellectuelle** : Définition précise des droits cédés au client (supports web, réseaux sociaux, diffusion TV, territoire géographique, durée de la cession en années).
- [ ] **Droit à l'image & Autorisations de tournage** : Préciser que le client est seul responsable de l'obtention des autorisations des personnes filmées/photographiées et des lieux privés.
- [ ] **Conditions d'annulation et de report** : Conditions météorologiques (pour les tournages extérieurs), délais minimaux de notification d'annulation par le client et sort de l'acompte versé.
- [ ] **Loi applicable et juridiction compétente** : Indication des tribunaux compétents de l'arrondissement judiciaire de rattachement (ex. Bruxelles ou tribunal francophone compétent).

---

## 4. Bilan de conformité

| Exigence | Statut technique | Commentaire |
|---|---|---|
| **Consentement vidéo externe (YouTube/Vimeo)** | **Conforme APD** | Opt-in strict, aucun chargement préalable, case mémoire décochée par défaut, démontage immédiat du DOM |
| **Boutons équilibrés (Anti-Dark Pattern)** | **Conforme APD** | Boutons d'acceptation et de refus de même hiérarchie visuelle |
| **Durée du cookie de consentement** | **Conforme APD** | 180 jours maximum avec horodatage et signature cryptographique HMAC |
| **Étanchéité des données privées** | **Conforme RGPD** | Pas de fuite d'adresse ou BCE non confirmés dans les payloads ou HTML publics |
| **Prévisualisation privée** | **Sécurisé** | Authentification admin requise, en-têtes `no-store` et `noindex` stricts |
| **Validation juridique des contenus** | **À charge de Maxime** | Les structures techniques sont prêtes ; les mentions textuelles spécifiques restent à valider par un juriste |
