# Workflow de Developpement Parallax : ChatGPT et Gemini

Ce document decrit le protocole operationnel et les regles de collaboration strictes pour le developpement iteratif du projet Parallax.

## 1. Roles et responsabilites

- **ChatGPT (Concepteur et Pilote)** :
  - Analyse les besoins fonctionnels et techniques.
  - Structure le decoupage du projet en lots incrementaux, autonomes et cibles.
  - Redige chaque prompt technique avec perimetre precis, regles d'acceptation et contraintes strictes.

- **Gemini (Executeur Technique)** :
  - Reçoit et analyse le prompt fourni pour le lot donne.
  - Execute exclusivement le perimetre technique du lot en cours.
  - Respecte les standards de qualite (TypeScript strict, zero warning ESLint, tests unitaires, conformite des formats).
  - Fournit le rapport d'execution factuel avec preuves de validation.
  - S'arrete immediatement apres la remise du rapport final.

## 2. Regles fondamentales du workflow

1. **Un prompt distinct par lot** :
   - Tout travail technique est encadre par un prompt explicite prepare par ChatGPT.
   - Aucun passage au lot suivant ne peut avoir lieu sans reception prealable de son prompt dedie.
   - Gemini ne doit jamais anticiper ni commencer un lot suivant de sa propre initiative.

2. **Arret obligatoire apres remise du rapport** :
   - Chaque intervention se conclut par la formule convenue et l'arret complet de l'agent.
   - L'utilisateur transmet le rapport a ChatGPT pour evaluation et preparation du lot suivant.

3. **Interdiction des tests E2E et navigateurs sans autorisation formelle** :
   - Aucun test Playwright, aucun navigateur web automatise et aucun serveur E2E dedie ne doit etre lance sans autorisation explicite de l'utilisateur dans la conversation courante.
   - Les validations standard portent sur `typecheck`, `lint`, `test` (tests unitaires / smoke tests) et `build`.

4. **Distinction entre resultats locaux et GitHub Actions** :
   - Les validations executees en local verifient l'etat de l'espace de travail au moment de la commande.
   - La CI GitHub Actions (`.github/workflows/ci.yml`) est declenchee sur `push` vers `main` ou sur `pull_request` vers `main`.
   - Par consequent, un push sur une branche de travail telle que `chore/bootstrap` ne declenche pas automatiquement l'execution du workflow GitHub Actions. L'absence d'echec ou de succes sur GitHub Actions ne se substitue pas aux verifications locales.

5. **Gestion stricte de Git et des branches** :
   - Tout travail s'effectue sur la branche dediee au lot (ex: `chore/bootstrap`).
   - Aucune fusion (merge) vers la branche `main` n'est realisee automatiquement. La fusion vers `main` releve exclusivement d'une instruction explicite de l'utilisateur.
   - Sont formellement proscrits : le force-push (`--force`), le rebase destructif, le commit amende (`--amend`) apres publication et la suppression de branche.
