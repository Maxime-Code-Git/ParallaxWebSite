# Guide de Configuration Contact et Mailer SMTP (Lot 6)

Ce document détaille la configuration, la sécurisation, les diagnostics et les essais du module Contact FR/EN et de l'envoi d'e-mails pour le studio Parallax.

---

## 1. Variables d'environnement requises

Pour activer l'envoi réel des formulaires de contact, six variables d'environnement doivent être définies dans votre fichier d'environnement local `.env.local` (ou dans les variables du serveur de production) :

| Variable | Description | Exemple |
| --- | --- | --- |
| `SMTP_HOST` | Nom d'hôte ou IP du serveur SMTP | `smtp.votrefournisseur.com` |
| `SMTP_PORT` | Port d'écoute SMTP (587 ou 465) | `587` |
| `SMTP_USER` | Identifiant ou utilisateur d'authentification SMTP | `contact@votredomaine.com` |
| `SMTP_PASSWORD` | Mot de passe ou mot de passe d'application | `••••••••••••••••` |
| `CONTACT_FROM_EMAIL` | Adresse d'expédition fixe déclarée au serveur SMTP | `contact@votredomaine.com` |
| `CONTACT_TO_EMAIL` | Adresse destinataire où sont reçues les demandes | `studio@votredomaine.com` |

### Variable optionnelle pour les tests locaux ou d'entreprise

| Variable | Description |
| --- | --- |
| `SMTP_CA_CERT` | Chemin absolu vers un certificat racine CA au format PEM pour valider les serveurs de test locaux avec certificat auto-signé. La vérification stricte du certificat (`rejectUnauthorized: true`) reste toujours active. |

---

## 2. Sécurité TLS stricte

Le transport SMTP Nodemailer de Parallax applique une politique de chiffrement stricte sans compromis :

1. **Port 587 (Standard Recommandé) :**
   - Mode `secure: false`.
   - `requireTLS: true` : la négociation STARTTLS est obligatoire. Si le serveur SMTP ne supporte pas STARTTLS ou propose une connexion en clair, la connexion est immédiatement interrompue.
2. **Port 465 (TLS Direct) :**
   - Mode `secure: true` : connexion chiffrée TLS immédiate dès l'ouverture du socket.
3. **Validation stricte des certificats :**
   - `rejectUnauthorized: true` par défaut absolu.
   - Aucun fallback en clair n'est permis.
   - Aucun bypass `rejectUnauthorized = false` ou `NODE_TLS_REJECT_UNAUTHORIZED = 0`.
4. **Délais et concurrence bornés :**
   - Timeout de connexion : 10 secondes.
   - Timeout de socket / greeting : 15 secondes.
   - Concurrence maximale d'envois simultanés : 5.
   - Protection contre le déni de service et les fuites de descripteurs.

---

## 3. Diagnostic SMTP sans envoi d'e-mail

### Commande CLI `smtp:verify`

Une commande dédiée permet de valider à tout moment la configuration et la poignée de main SMTP sans envoyer de message ni polluer une boîte aux lettres réelle :

```bash
npm run smtp:verify
```

**Comportement :**
- Vérifie la présence des 6 variables obligatoires.
- Établit une connexion sécurisée vers `SMTP_HOST:SMTP_PORT`.
- Effectue la négociation TLS (STARTTLS ou TLS direct) et vérifie la validité du certificat.
- Valide l'authentification avec `SMTP_USER` et `SMTP_PASSWORD`.
- Quitte avec le code de sortie `0` en cas de succès, ou `1` en cas d'erreur.
- **Sécurité des logs :** Aucun mot de passe, secret, corps de message ou adresse visiteur n'est affiché. Seuls des codes de diagnostic sûrs (`SMTP_UNCONFIGURED`, `SMTP_AUTH_FAILED`, `SMTP_CONN_REFUSED`, `SMTP_TLS_FAILED`, `SMTP_TIMEOUT`, `SMTP_DISCONNECTED`, `SMTP_ERROR`) sont retournés.

---

## 4. Diagnostic en direct dans l'Administration

Dans l'interface d'administration `/admin/contact` :
- Un badge visuel d'état indique en temps réel la situation du transport SMTP :
  - **● Configuré** (vert) : Toutes les 6 variables sont présentes et conformes.
  - **● Incomplet** (orange) : Affiche la liste des clés manquantes sans exposer les valeurs existantes.
  - **● Invalide** (rouge) : Format ou port incorrect.
- En cas de configuration incomplète côté serveur, le site public ne plante pas :
  - La page reste accessible.
  - Si un visiteur soumet le formulaire, le serveur retourne une réponse HTTP 503 propre avec un message localisé neutre d'indisponibilité.
  - Si une adresse publique est configurée dans les Coordonnées, un fallback `mailto:` permet au visiteur de contacter le studio par son client de messagerie habituel.

---

## 5. Pipeline anti-spam et protection contre le rejeu

Le traitement de soumission Contact intègre une chaîne de sécurité multicouche :

1. **Jeton cryptographique lié au contexte de session :**
   - Cookie anonyme éphémère HttpOnly/SameSite=Lax `__parallax_contact_ctx`.
   - `_token` contenant `timestamp.nonce.contextId.signatureHMAC`.
   - Délai minimal de 2 secondes : rejette les soumissions instantanées des automates.
   - Expiration maximale de 2 heures : invalide les jetons anciens ou rejoués.
2. **Honeypot discret :**
   - Champ `website` invisible via CSS Module, masqué pour les lecteurs d'écran (`aria-hidden="true"`, `tabIndex={-1}`) et avec `autoComplete="off"`.
   - Si renseigné, la soumission est immédiatement refusée avec code 400 sans révéler au bot la nature du piège.
3. **Rate Limiting persistant indépendant :**
   - Stocké dans SQLite sous le namespace `contact` (distinct de `admin` et `gallery`).
   - 5 soumissions par fenêtre glissante de 15 minutes par empreinte IP (hachée en HMAC avec `RATE_LIMIT_SECRET`).
   - Code HTTP 429 avec en-tête `Retry-After` en cas de dépassement.
   - Les compteurs ne sont jamais réinitialisés lors d'un envoi réussi afin de bloquer les rafales.
4. **Table anti-rejeu et dédoublonnage (`contact_claims`) :**
   - Empreinte de jeton liée atomiquement à l'empreinte HMAC du contenu (`content_hash`) et à une identité de claim (`claim_id`).
   - En cas de double-clic ou soumission concurrente, un seul appel SMTP est exécuté, la requête concurrente recevant 409.
   - Une re-soumission d'un même jeton avec le même contenu (même au-delà de 2 minutes et jusqu'à 2 heures) renvoie la redirection 303 PRG sans second envoi d'e-mail.
   - Une re-soumission d'un même jeton avec un contenu différent est rejetée avec code 409 Conflict avec préservation des saisies.
   - Les erreurs de transport incertaines (timeout socket, déconnexion) marquent le claim comme `uncertain` (code HTTP 504) et interdisent tout réarmement aveugle.
5. **Pattern PRG (Post-Redirect-Get) avec flash signé et remise à zéro :**
   - Succès confirmé par redirection HTTP 303 vers `/fr/contact` ou `/en/contact`.
   - Cookie flash éphémère signé `__parallax_contact_flash` consommé et effacé immédiatement lors de l'affichage.
   - Un simple paramètre d'URL `?success=true` ne provoque aucun faux message de succès.
   - Réinitialisation complète des champs et du sélecteur de type après succès, sans effacer de nouvelle saisie lors de revalidations ultérieures.

---

## 6. Procédure d'essai manuel

Pour tester l'ensemble du parcours en conditions réelles :

1. **Démarrer l'application locale :**
   ```bash
   npm run build && npm run preview:local
   ```
2. **Accéder à la page Contact :**
   - Ouvrir `http://localhost:3000/fr/contact` (ou l'origine loopback affichée).
   - Vérifier la mise en page responsive conforme au prototype : grille desktop 1.3fr / 1fr, espacement 56px, formulaire à gauche, carte Coordonnées à droite.
3. **Tester les validations :**
   - Soumettre un formulaire vide : les messages d'erreur apparaissent par champ avec un résumé d'erreur en haut de formulaire.
   - Saisir un e-mail syntaxiquement invalide : refus avec mise en valeur du champ.
   - Les valeurs déjà saisies sont conservées.
4. **Tester le pré-remplissage par URL :**
   - Accéder à `/fr/contact?type=advertising`.
   - Le sélecteur du type de projet est automatiquement pré-positionné sur « Publicité ».
5. **Tester l'envoi :**
   - Renseigner tous les champs obligatoires (Nom, Email, Type, Message).
   - Cliquer sur « Envoyer ».
   - Le bouton passe en état désactivé avec le libellé « Envoi en cours… ».
   - Après succès, la page est rechargée avec le bandeau vert de confirmation `role="status"` et le formulaire est entièrement réinitialisé (y compris le menu déroulant du type).
6. **Tester l'administration :**
   - Accéder à `/admin/contact`.
   - Modifier un texte (ex. le titre ou les coordonnées téléphoniques) et enregistrer.
   - Revenir sur `/fr/contact` pour constater la mise à jour immédiate.

---

## 7. Dépendances de mise en ligne pour le Lot 7

Les éléments suivants sont préparés et réservés pour finalisation au Lot 7 :
1. **Pages légales et Politique de confidentialité :**
   - La mention d'information sous le bouton de formulaire indique la finalité du traitement (répondre à la demande et préparer un éventuel projet).
   - Le lien vers la politique de confidentialité reste masqué ou pointe vers un ancrage inoffensif tant que la page légale `/fr/politique-de-confidentialite` n'est pas rédigée et publiée.
2. **Inventaire des cookies pour le bandeau Lot 7 :**
   - Cookie fonctionnel technique : `__parallax_contact_flash`.
   - Finalité : Affichage sécurisé unique du message de confirmation après redirection PRG.
   - Durée : Éphémère (effacé à la première lecture, expiration maximale 60 secondes).
   - Attributs : `HttpOnly`, `SameSite=Lax`, `Secure` (en production HTTPS).
   - Aucun cookie publicitaire, traceur tiers ou outil d'analyse n'est déposé.
