# Documentation Lot 7 — Entreprise, Pages Légales et Préférences de Confidentialité

Ce document fournit l'inventaire technique réel des traceurs et cookies, le protocole de test manuel multi-résolutions (Desktop 1440px et Mobile 390px), ainsi que la liste des informations d'entreprise et mentions restant à valider par Maxime avant la mise en production.

---

## 1. Inventaire technique réel des traceurs et cookies

Le site Parallax applique une politique de minimisation technique des données. Aucun outil d'analyse d'audience tiers (Google Analytics, Meta Pixel, etc.) ni police distante (`fonts.googleapis.com`) n'est chargé : l'ensemble des polices WOFF2 (Space Grotesk, Hanken Grotesk, Cormorant Garamond) est auto-hébergé localement.

### Cookies strictement nécessaires et techniques (exemptés de consentement préalable)

| Nom du cookie | Finalité technique | Durée de rétention | Sécurité / Attributs |
|---|---|---|---|
| `__parallax_admin_session` | Maintien de la session d'administration authentifiée | 8 heures (glissante) | `HttpOnly`, `SameSite=Strict`, `Path=/admin`, `Secure` (production) |
| `__parallax_gallery_session` | Maintien de l'accès client sécurisé par code à une galerie privée | 8 heures maximum technique | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` (production) |
| `__parallax_contact_ctx` | Contexte éphémère anonyme anti-spam (liaison cryptographique du jeton `_token`) | 2 heures | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` (production) |
| `__parallax_contact_flash` | Notification éphémère PRG (message de statut après soumission contact) | Usage unique (supprimé à la première lecture) | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` (production) |

### Cookie de préférences de confidentialité (mémorisation explicite)

| Nom du cookie | Finalité technique | Durée de rétention | Sécurité / Attributs |
|---|---|---|---|
| `__parallax_privacy_prefs` | Mémorisation du choix d'activation des lecteurs vidéo externes (YouTube, Vimeo) | 180 jours (~6 mois) | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` (production), signé HMAC-SHA256 (`RATE_LIMIT_SECRET`) |

> [!NOTE]
> - **Accord ponctuel** : Si l'utilisateur clique sur « Activer pour cette vidéo » sans cocher la mémorisation, l'accord reste strictement cantonné à l'URL média active via un état en mémoire JavaScript (`inMemoryOneTimeByMedia`). Aucun cookie n'est écrit. L'accord est révoqué dès la fermeture de la modale, le changement de média ou la navigation.
> - **Signature & intégrité** : Le cookie `__parallax_privacy_prefs` est émis avec l'attribut `HttpOnly`. Le client JavaScript ne lit jamais directement la valeur du cookie (aucun cookie falsifié ou expiré ne peut forcer un accord). L'état est validé côté serveur via l'API `/api/privacy/preferences` ou les loaders.
> - **Stockage navigateur** : Le mécanisme `ScrollRestoration` de React Router utilise le `sessionStorage` standard du navigateur pour préserver la position de défilement lors de la navigation.

### Intégrations vidéo tierces

- **YouTube** : Intégration conditionnelle via le domaine `www.youtube-nocookie.com`. Aucun appel réseau ni iframe n'est généré tant que l'utilisateur n'a pas validé son accord.
- **Vimeo** : Intégration conditionnelle via `player.vimeo.com` avec le paramètre `dnt=1` (Do Not Track) pour limiter la collecte publicitaire. Ce paramètre technique réduit le suivi comportemental mais ne constitue pas une garantie d'absence totale de tout traitement technique par le lecteur Vimeo une fois chargé.
- **Révocation immédiate** : Lors du retrait des préférences (via `/fr/cookies`, `/en/cookies` ou le bandeau), toute iframe active est immédiatement démontée du DOM et les autorisations ponctuelles en mémoire sont réinitialisées.

---

## 2. Cartographie des routes légales et préférences

| Page / Fonctionnalité | Route canonique FR | Route canonique EN | Alias patrimoniaux (301) |
|---|---|---|---|
| Mentions légales | `/fr/mentions-legales` | `/en/legal-notice` | `/en/mentions-legales` -> `/en/legal-notice` |
| Politique de confidentialité | `/fr/confidentialite` | `/en/privacy-policy` | `/en/confidentialite` -> `/en/privacy-policy`<br>`/fr/politique-de-confidentialite` -> `/fr/confidentialite` |
| Conditions Générales de Vente | `/fr/cgv` | `/en/terms` | `/en/cgv` -> `/en/terms` |
| Politique cookies & Préférences | `/fr/cookies` | `/en/cookies` | — |
| API Préférences de confidentialité | `/api/privacy/preferences` | `/api/privacy/preferences` | — |

Toutes les routes légales publiques appliquent les en-têtes `Cache-Control: private, no-store` et `Vary: Cookie` afin de garantir la réactivité immédiate lors des publications/dépublications et la non-mise en cache des préférences utilisateur.

---

## 3. Protocole de test manuel multi-résolutions

### Environnements recommandés
- **Desktop** : Largeur standard 1440px (Chrome / Firefox / Safari).
- **Mobile** : Largeur standard 390px (iPhone 12/13/14/15/16 Pro).

---

### Test 1 : Parcours public des pages légales (Desktop 1440px & Mobile 390px)

1. **Navigation et liens du Footer** :
   - Naviguer vers la page d'accueil `/fr`.
   - Faire défiler jusqu'au pied de page (`Footer`).
   - Vérifier la présence des liens bilingues : « Mentions légales », « Confidentialité », « CGV », « Cookies » ainsi que l'ancre « Gérer mes préférences ».
   - Cliquer sur « Mentions légales » : vérifier que l'URL cible est `/fr/mentions-legales`.
2. **Bascule linguistique (FR <-> EN)** :
   - Sur `/fr/mentions-legales`, cliquer sur le sélecteur « EN » dans l'en-tête.
   - Vérifier la navigation vers `/en/legal-notice`.
   - Vérifier la balise `<link rel="canonical">` pointant vers l'URL absolue configurée (`PUBLIC_SITE_URL`).
   - Vérifier les balises `<link rel="alternate" hreflang="fr">` et `hreflang="en"`.
3. **Redirections 301 des URLs patrimoniales** :
   - Saisir manuellement dans la barre d'adresse : `/en/mentions-legales`.
   - Vérifier la redirection automatique en HTTP 301 vers `/en/legal-notice`.
   - Tester également `/en/confidentialite` -> `/en/privacy-policy`, `/en/cgv` -> `/en/terms`, et `/fr/politique-de-confidentialite` -> `/fr/confidentialite`.
   - Vérifier que les requêtes `.data` sur ces alias renvoient également la bonne destination sans retomber sur `/fr`.
4. **Mise en page responsive Space Grotesk** :
   - **À 1440px** : Le titre principal s'affiche de manière équilibrée avec un espacement de section confortable. La grille d'identité affiche 2 colonnes équilibrées.
   - **À 390px** : Les marges s'adaptent, le titre se calibre, et la grille d'identité bascule sur 1 seule colonne lisible sans débordement horizontal.
5. **Panneau Préférences accessible avant publication** :
   - Se rendre sur `/fr/cookies#preferences` lorsque le document Cookies n'est pas encore publié.
   - Vérifier que le panneau de gestion des préférences vidéo s'affiche et fonctionne (sauvegarde et tout refuser), y compris avec JavaScript désactivé via le formulaire natif.

---

### Test 2 : Lecteur vidéo externe & Consentement (Desktop & Mobile)

1. **Vérification de l'absence de requête réseau préalable** :
   - Ouvrir la console développeur du navigateur (onglet Réseau).
   - Filtrer sur `youtube` ou `vimeo`.
   - Cliquer sur un projet vidéo ou le showreel pour ouvrir la modale `VideoModal`.
   - **Résultat attendu** : Aucune requête vers `youtube-nocookie.com` ou `vimeo.com`. Un panneau d'information neutre et équilibré s'affiche dans la modale.
2. **Lecture ponctuelle limitée au média actif** :
   - Laisser la case « Mémoriser mon choix » décochée.
   - Cliquer sur « Activer pour cette vidéo ».
   - **Résultat attendu** : L'iframe de la vidéo se charge et commence la lecture. Dans le stockage, aucun cookie `__parallax_privacy_prefs` n'a été créé.
   - Fermer la modale (via bouton Fermer ou touche Escape) et la rouvrir sur la même vidéo ou une autre : le panneau de consentement s'affiche à nouveau (l'accord ponctuel a été révoqué).
3. **Mémorisation du consentement** :
   - Cocher la case « Mémoriser mon choix pour mes prochaines visites ».
   - Cliquer sur « Activer pour cette vidéo ».
   - **Résultat attendu** : Le cookie signé `__parallax_privacy_prefs` est émis en `HttpOnly` avec une validité de 180 jours.
   - Ouvrir une autre vidéo du même fournisseur : elle se lance directement sans redemander le consentement.
4. **Révocation immédiate et démontage de l'iframe** :
   - Se rendre sur `/fr/cookies#preferences` ou cliquer sur « Gérer mes préférences » dans le footer.
   - Cliquer sur « Tout refuser / Révoquer » (ou décocher YouTube et enregistrer).
   - Revenir sur la vidéo en cours : **l'iframe est immédiatement démontée du DOM** et le panneau de consentement réapparaît instantanément.

---

### Test 3 : Administration de l'entreprise & Synchronisation canonique (`/admin/company`)

1. **Accès et authentification** :
   - Se connecter à `/admin` puis accéder à la rubrique « Entreprise » (`/admin/company`).
2. **Modification et suppression des coordonnées canoniques** :
   - Modifier le nom commercial : `Parallax`.
   - Modifier l'e-mail public : `contact@parallax.be`.
   - Modifier le téléphone : `+32 470 12 34 56`.
   - Effacer l'URL Instagram (champ vide).
   - Cliquer sur « Enregistrer les paramètres ».
3. **Vérification de la synchronisation canonique** :
   - Naviguer sur le site public `/fr` et `/fr/contact`.
   - Vérifier que l'e-mail et le téléphone sont mis à jour, et que le lien Instagram est effectivement supprimé (aucun ancien lien orphelin ne persiste).
4. **Étanchéité des données non confirmées** :
   - Dans `/admin/company`, renseigner une adresse ou un responsable tout en laissant la case « Confirmer et autoriser la publication » décochée.
   - Vérifier via l'API ou le code source public qu'aucune donnée privée (adresse, numéro BCE, responsable de publication) ne fuite dans les payloads publics.
5. **Gestion des conflits concurrents (HTTP 409)** :
   - Ouvrir deux onglets distincts sur `/admin/company`.
   - Modifier et enregistrer dans le premier onglet (la révision serveur change).
   - Tenter d'enregistrer depuis le second onglet : le conflit 409 est détecté, les saisies locales sont conservées, et un bouton permet d'adopter la révision du serveur.

---

### Test 4 : Cycle de vie des pages légales & Prévisualisation privée (`/admin/legal`)

1. **Édition du brouillon et préservation de la saisie** :
   - Accéder à `/admin/legal/privacy`.
   - Taper du texte comportant des espaces, des retours à la ligne et plusieurs paragraphes.
   - Vérifier que la saisie brute n'est pas tronquée ou modifiée pendant la frappe.
   - Basculer sur l'onglet EN : saisir du texte, puis revenir sur FR : vérifier que les textes sont fidèlement conservés.
   - Cliquer sur « Enregistrer le brouillon ».
   - Consulter `/fr/confidentialite` : le document public reste strictement inchangé.
2. **Prévisualisation privée authentifiée** :
   - Cliquer sur « Aperçu privé ».
   - L'URL `/admin/legal/privacy/preview` s'affiche avec le bandeau d'avertissement « Mode Prévisualisation Privée ».
   - Ouvrir cette URL dans une navigation privée non connectée : redirection 303 vers `/admin`.
3. **Validation anti-placeholders à la publication** :
   - Insérer volontairement la mention `[à compléter]` dans un champ ou une section du brouillon.
   - Cliquer sur « Publier cette version ».
   - **Résultat attendu** : La publication est refusée avec une erreur claire et neutre indiquant la présence de mentions incomplètes.
4. **Incrémentation monotone de version** :
   - Après publication en `v1`, publier à nouveau : la version passe en `v2`.
   - Dépublier le document : le document repasse en brouillon non publié.
   - Republication ultérieure : la version devient `v3` (la dépublication ne réinitialise pas le compteur de versions).
5. **Inventaire structuré des cookies** :
   - Sur `/admin/legal/cookies`, ajouter un cookie dans le tableau d'inventaire, modifier son nom, sa catégorie et sa finalité.
   - Enregistrer le brouillon et vérifier la persistance des données structurées.

---

## 4. Checklist des informations d'entreprise à valider par Maxime

> [!IMPORTANT]
> Pour que les mentions légales, la politique de confidentialité et les conditions générales de vente soient juridiquement opposables, Maxime doit valider et renseigner les éléments définitifs dans `/admin/company` et `/admin/legal` :

### 1. Paramètres d'entreprise (`/admin/company`)
- [ ] **Forme juridique exacte** : Personne physique (indépendant en nom propre) ou personne morale (SRL, etc.).
- [ ] **Dénomination sociale officielle** : Nom enregistré auprès de la Banque-Carrefour des Entreprises (BCE).
- [ ] **Adresse du siège / professionnelle** : Adresse physique enregistrée en Belgique.
- [ ] **Numéro d'entreprise / BCE** : Format `0XXX.XXX.XXX`.
- [ ] **Numéro de TVA intracommunautaire** : Format `BE 0XXX.XXX.XXX` (ou mention d'exonération de TVA de l'article 56bis du Code de la TVA).
- [ ] **Responsable de la publication** : Nom et prénom du responsable de publication.
- [ ] **Coordonnées de l'hébergeur** : Nom, adresse postale et contact du prestataire d'hébergement web (ex. Infomaniak Network SA, Suisse).
- [ ] **Confirmation de publication** : Cocher la case « Confirmer et autoriser la publication » une fois les données validées.

### 2. Conditions Générales de Vente (CGV — `/admin/legal/terms`)
- [ ] **Modalités financières** : Acompte à la commande, délais de paiement, pénalités de retard et indemnités de recouvrement (loi belge du 2 août 2002).
- [ ] **Cession des droits d'auteur & Propriété intellectuelle** : Étendue des droits cédés au client (supports, durée, territoire).
- [ ] **Droit à l'image & Lieux** : Responsabilité du client quant aux autorisations requises des personnes filmées et des lieux.
- [ ] **Annulation et météo** : Conditions de report pour tournage extérieur et sort de l'acompte.
- [ ] **Juridiction compétente** : Arrondissement judiciaire de rattachement en Belgique (Bruxelles).

---

## 5. Synthèse des contrôles techniques vérifiés

| Point de contrôle | État technique vérifié | Remarques |
|---|---|---|
| **Consentement vidéo externe** | **Vérifié** | Pas de chargement préalable d'iframe ou de ressource externe sans accord explicite. Accord ponctuel cantonné au média actif. Démontage immédiat du DOM lors de la révocation. |
| **Boutons de consentement** | **Vérifié** | Acceptation et refus présentés au même niveau de hiérarchie visuelle, sans incitation trompeuse. |
| **Protection cryptographique du cookie** | **Vérifié** | Cookie `__parallax_privacy_prefs` émis en `HttpOnly`, signé HMAC-SHA256 avec `RATE_LIMIT_SECRET`. Tout cookie falsifié ou expiré est refusé côté client comme côté serveur. |
| **Étanchéité des données privées** | **Vérifié** | `publicationDirector`, adresse, numéro BCE masqués des payloads et loaders publics tant que la publication de l'entreprise n'est pas confirmée. |
| **Prévisualisation privée** | **Vérifié** | Authentification session requise, en-têtes `no-store` et `noindex` stricts. |
| **Conformité CSP** | **Vérifié** | Zéro attribut `style` inline sur les 4 écrans légaux et d'administration. En-tête CSP sans `unsafe-inline` en production. |
| **Validation juridique des contenus** | **À charge de Maxime** | Les structures techniques et les mécanismes d'édition sont livrés et vérifiés ; les mentions textuelles spécifiques restent à valider sur le plan légal par Maxime et son conseil. |
