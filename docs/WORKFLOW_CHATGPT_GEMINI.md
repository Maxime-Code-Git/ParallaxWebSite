# Workflow de Developpement Parallax : ChatGPT et Gemini

Ce document decrit le protocole operationnel et les regles de collaboration strictes pour le developpement iteratif du projet Parallax.

## 1. Roles et responsabilites

- **ChatGPT (Concepteur et Pilote)** :
  - Analyse les besoins fonctionnels et techniques.
  - Structure le decoupage du projet en lots incrementaux, autonomes et cibles.
  - Redige chaque prompt technique avec perimetre precis, regles d'acceptation et contraintes strictes.
  - Effectue la revue technique approfondie (diff, hash de depart et d'arrivee, perimetre livre, CI, validations locales).
  - Autorise et execute les fusions de branches vers `main` conformement a la delegation donnee par l'utilisateur le 12 octobre 2026.

- **Gemini (Executeur Technique)** :
  - Reçoit et analyse le prompt fourni pour le lot donne.
  - Execute exclusivement le perimetre technique du lot en cours sur sa branche dediee.
  - Respecte les standards de qualite (TypeScript strict, zero warning ESLint, tests unitaires et d'integration, conformite aux formats et references).
  - Fournit le rapport d'execution factuel avec preuves de validation exhaustives.
  - S'arrete immediatement apres la remise du rapport final sans fusionner vers `main`.

## 2. Regles fondamentales du workflow

1. **Un prompt distinct par lot** :
   - Tout travail technique est encadre par un prompt explicite prepare par ChatGPT.
   - Aucun passage au lot suivant ne peut avoir lieu sans reception prealable de son prompt dedie.
   - Gemini ne doit jamais anticiper ni commencer un lot suivant de sa propre initiative.

2. **Arret obligatoire apres remise du rapport** :
   - Chaque intervention se conclut par la formule convenue et l'arret complet de l'agent.
   - L'utilisateur transmet le rapport a ChatGPT pour verification complete avant toute fusion ou etape ulterieure.

3. **Exigence de fidelite visuelle aux references fournies** :
   - Les fichiers HTML/CSS du dossier `References/parallax-site/` (`index.html`, `mobile.html`, `contact.html`, `espace-client.html`, `projets.html`, etc.) constituent la reference visuelle et fonctionnelle obligatoire pour toute realisation front-end. C'est une exigence d'acceptation, pas une simple inspiration.
   - Les tokens Parallax, composants (cartes, boutons, champs, typographie Space Grotesk) doivent etre fideles aux references sans re-inventer de direction artistique arbitraire.
   - Les fichiers sources de `References/` restent en lecture seule stricte.

4. **Interdiction des tests E2E et navigateurs sans autorisation formelle** :
   - Aucun test Playwright, aucun navigateur web automatise et aucun serveur E2E dedie ne doit etre lance sans autorisation explicite de l'utilisateur dans la conversation courante.
   - Les validations standard portent sur `typecheck`, `lint`, `test` (tests unitaires et d'integration) et `build`.

5. **Distinction entre resultats locaux et GitHub Actions** :
   - Les validations executees en local verifient l'etat de l'espace de travail au moment de la commande.
   - La CI GitHub Actions (`.github/workflows/ci.yml`) est declenchee sur `push` vers `main` ou sur `pull_request` vers `main`.
   - L'absence d'echec ou de succes sur GitHub Actions ne se substitue pas aux verifications locales.

6. **Gestion stricte de Git, des branches et des fusions** :
   - Tout travail s'effectue sur la branche dediee au lot (ex: `feat/admin-foundation`).
   - Sont formellement proscrits : le force-push (`--force`), le rebase destructif, le commit amende (`--amend`) apres publication et la suppression de branche.
   - **Delegation de fusion du 12 octobre 2026** : ChatGPT peut autoriser et effectuer les fusions apres avoir fait les verifications necessaires (diff, perimetre, hash exact, validations et CI). Cette instruction remplace l'exigence anterieure d'un accord utilisateur individuel pour chaque fusion. Gemini remet son rapport d'abord et ne fusionne pas lui-meme.
