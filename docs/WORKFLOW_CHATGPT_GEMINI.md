# Workflow de Developpement Parallax : ChatGPT et Gemini

Ce document decrit le protocole operationnel et les regles de collaboration pour le developpement iteratif du projet Parallax.

## 1. Roles et responsabilites

- **ChatGPT (Concepteur et Pilote)** :
  - Analyse les besoins fonctionnels et techniques.
  - Structure le decoupage du projet en lots incrementaux et independants.
  - Redige chaque prompt technique cible destine a Gemini, avec specifications detaillees, regles d'acceptation et contraintes de securite.

- **Gemini (Executeur Technique)** :
  - Reçoit et analyse le prompt fourni.
  - Execute uniquement le perimetre technique decrit dans le prompt du lot en cours.
  - Respecte les standards de qualite (TypeScript strict, zero warning ESLint, tests unitaires).
  - Fournit le rapport d'execution structure avec preuves de validation.
  - S'arrete immediatement apres la remise du rapport final.

## 2. Regles fondamentales du workflow

1. **Execution stricte par lot** :
   - Gemini ne doit jamais anticiper ni commencer un lot suivant de sa propre initiative.
   - Aucun developpement de fonctionnalite n'est realise sans un prompt explicite prepare par ChatGPT.

2. **Arret obligatoire apres rapport** :
   - Chaque intervention se conclut par la formule convenue et l'arret complet de l'agent.
   - L'utilisateur transmet le rapport a ChatGPT pour evaluation et preparation du lot suivant.

3. **Interdiction des tests E2E non autorises** :
   - Aucun test Playwright ou test end-to-end complet n'est execute sans instruction formelle dans le prompt du lot.
   - Les validations courantes se concentrent sur le typage (`typecheck`), le linting (`lint`), les tests unitaires (`test`) et la compilation (`build`).

4. **Gestion des branches et de Git** :
   - Tout travail s'effectue sur une branche dediee (ex: `chore/bootstrap` ou `feat/<nom-du-lot>`).
   - Aucune fusion (merge) dans la branche `main` n'est automatique.
   - Pas de force-push, pas de rebase destructif, pas de commit amende.
   - La fusion vers `main` releve exclusivement de la validation finale et de la revue par l'utilisateur.
