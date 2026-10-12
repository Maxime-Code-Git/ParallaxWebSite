# Parallax

Site officiel et espace client du studio Parallax (photo et video).

## Organisation du projet

Ce projet est developpe de maniere incrementale par lots techniques selon le workflow defini dans [docs/WORKFLOW_CHATGPT_GEMINI.md](docs/WORKFLOW_CHATGPT_GEMINI.md) :
- ChatGPT concoit l'architecture et prepare les prompts de chaque lot.
- Gemini execute chaque prompt technique et s'arrete apres son rapport de cloture.

## Structure du depot

Le projet est organise en monorepo npm :
- `apps/web` : Application principale sous React Router v8, React 19 et Vite 8 (mode SSR).
- `packages/shared` : Types, constantes et schemas partages (`@parallax/shared`).
- `docs/` : Documentation technique du projet :
  - `docs/ARCHITECTURE.md` : Principes architecturaux et standards du projet.
  - `docs/SEMPRA_REUSE_MAP.md` : Cartographie des modules techniques a adapter depuis le referentiel Sempra.
  - `docs/WORKFLOW_CHATGPT_GEMINI.md` : Regles de collaboration et cycle de livraison.

## Pre-requis

- Node.js >= 24.15.0 (voir `.nvmrc`)
- npm >= 10

## Commandes disponibles

```bash
# Installation reproductible des dependances
npm ci

# Lancer le serveur de developpement
npm run dev

# Verification statique des types TypeScript
npm run typecheck

# Verification de la qualite du code (zero warning)
npm run lint

# Lancer les tests unitaires et smoke tests
npm run test

# Compiler pour la production
npm run build
```
