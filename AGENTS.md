# AGENTS.md — point d'entrée agentique (toutes plateformes)

Ce fichier existe parce que la plupart des harnais agentiques lisent `AGENTS.md` à la racine et
rien d'autre. **Les conventions du repo sont dans [`CLAUDE.md`](CLAUDE.md) et s'appliquent quel que
soit le modèle ou l'outil** — le nom de ce fichier-là est un accident d'outillage, pas une portée.
Lis-le en entier avant d'écrire quoi que ce soit ; ce qui suit ne le remplace pas, il ajoute ce qui
change quand le harnais n'est pas Claude Code.

## Ordre de lecture au démarrage

1. `CLAUDE.md` (ici) — toolchain, venv, commandes de test, conventions de nommage Python.
2. `../studium_dev/MANIFEST.yaml` — la constellation ; le hub `studium_dev` est le point d'entrée
   du projet, ce repo n'est que le code.
3. `../studium_dev/STATUS.md` — **l'état courant**. Il ne se lit pas ici : ce repo ne porte aucun
   instantané de jalon, délibérément (voir `CLAUDE.md`).
4. `../studium_dev/HANDOFF.md` — la reprise : quoi faire, quoi ne pas faire, quoi vérifier.
5. `AGENT_LOG.md` (ici) — le journal par commit significatif, à alimenter.

`../Studium/AGENTS.md` reste la référence de protocole citée par `CLAUDE.md`, avec une réserve :
il se déclare en « Phase 2 — pré-construction », ce qui est **périmé** — le projet construit depuis
longtemps. Ses règles d'or 3 à 9 (sourcer, pas de décision silencieuse, validation Pydantic pour
tout appel LLM, human-in-the-loop rule 003, mémoire avant conversation, commits atomiques, contrat
sous-agent) tiennent. Son cadrage de phases, non.

## Ce que Claude Code faisait et qu'aucun autre harnais ne fait

Des *hooks* imposaient plusieurs de ces règles mécaniquement. Ailleurs, elles ne sont imposées par
rien : il faut les tenir soi-même, et c'est le seul vrai delta de ce fichier.

| Règle | Qui l'imposait | Ce qu'il faut faire sans lui |
| --- | --- | --- |
| Chemins de staging explicites | rien (convention) | jamais `git add -A` / `git add .` — nomme chaque fichier |
| Pas de réécriture d'historique | rien | pas de `rebase`, `push --force`, suppression de branche, `stash` nu ; on avance en ajoutant |
| `push` sous approbation | hook `sdlc-git-gates` | **demander au propriétaire avant chaque push** ; PR, release et tag ne sont PAS autorisés |
| Édition des tests tracée | hook `protect-tests` | les tests sont du contrat : les modifier est une décision à énoncer, jamais un effet de bord d'une réparation |
| Repos interdits | rien | ne pas écrire dans `~/git/studium_manuscript`, `~/git/LabOS`, `~/Documents/ChatGPT/LabOS` |

Deux autres, qui ne dépendaient d'aucun hook et valent d'être répétées : ne jamais inspecter ni
recopier une valeur secrète ; ne pas accepter un intent `Draft` à la place du propriétaire — un
agent dépose, seul le propriétaire accepte.

## Portes (à passer avant de dire « c'est vert »)

```bash
source .venv/bin/activate            # obligatoire, jamais le python système
pnpm test                            # TypeScript, tous les paquets
python tools/pytest_all.py           # Python — succès : exit 0, « N suites, 0 failing »
pnpm --filter @studium/<pkg> exec tsc --noEmit
```

Et les diagnostics de `fixtures/atomistique-l1/` (`*.mjs`, via
`node_modules/.pnpm/node_modules/.bin/tsx`), qui sortent 0 en toutes circonstances : ils
*rapportent*, ils ne gardent pas. Leurs chiffres attendus sont dans le handoff courant — un écart
est un signal, pas un échec de test.

## Pièges de cette machine

- **Le travail est sur `dev`, pas sur `main`.** Et la ref `main` locale est périmée (`0293287`) :
  compare toujours avec `git ls-remote origin main dev`, jamais avec la ref locale.
- **Six worktrees frères existent** (`~/git/prototype-build-013`, `-015`, `-016`, `-lint`, `-s2`,
  `-s2-review`). Une branche qu'ils tiennent ne peut pas être `checkout` ici, et ces répertoires ne
  sont pas ce repo. `git worktree list` avant de s'étonner.
- **`feat/trust-instrument` est 24 commits en avance sur son remote** — du travail local non poussé,
  pas une branche morte.
- `fixtures/data/` est régénéré par `teacher_check.mjs` à chaque exécution et gitignoré : c'est la
  disposition du *runtime*, pas ce que lit le collecteur.
