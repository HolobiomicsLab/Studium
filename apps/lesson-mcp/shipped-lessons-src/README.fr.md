[English](README.md) · Français

# Leçons livrées avec Studium : sources

`apps/lesson-mcp/shipped-lessons/` contient les leçons livrées dans l'extension VS Code (`dist/shipped-lessons/`)
et le paquet npm `studium-mcp` (`shipped-lessons/`). Le serveur les trouve à côté de lui et les cherche après le
dossier de leçons et la bibliothèque de l'apprenant : une leçon de l'apprenant l'emporte toujours,
`list_lessons` les liste à part (`shipped_lessons`), et `get_study_plan` n'en propose une qu'à un apprenant qui
n'a encore aucune leçon à lui. Ce dossier contient ce à partir de quoi elles sont construites.

## Découvrir Studium / Discover Studium

| | |
|---|---|
| Leçons | `discover-studium-fr/lesson.json` (français), `discover-studium-en/lesson.json` (anglais) |
| Contenu | 12 scènes, environ 11 minutes, 5 notions : l'assistant relaie et l'apprenant répond ; un cours est un graphe de notions (avec un détour par un prérequis) ; qui détient la clé et d'où elle vient ; les révisions espacées ; local d'abord |
| Sources | sept pages de la documentation de Studium, dans la langue de la leçon (`sources.json`), CC BY 4.0 |
| Rédigées par | un agent d'IA (Claude Opus 5.5 dans Claude Code), le 25 novembre 2026 |
| Statut | mode auto-apprentissage, `drafted_by: agent`, validées par personne ; aucun registre d'approbation (règle 003) |

| Fichier | Ce que c'est |
|---|---|
| `sources.json` | les pages, leur URL et leur licence, et l'objectif de chaque version |
| `draft.en.json`, `draft.fr.json` | le LessonDraft envoyé à `create_lesson` ; le `passage_id` d'une citation écrit `doc:<clé>` est remplacé par celui de l'unique passage de cette page qui la contient |
| `source-set.en.json`, `source-set.fr.json` | le jeu de sources produit par `prepare_sources` : tous les passages que la leçon peut citer, nommé par le `source_plan_id` de la leçon |

## Reconstruire

Depuis la racine du dépôt, après `pnpm build:libs` :

```bash
pnpm --filter @studium/lesson-mcp exec tsx scripts/build-shipped-lessons.ts
node tools/bundle_lint.mjs apps/lesson-mcp/shipped-lessons/discover-studium-en/lesson.json
node tools/bundle_lint.mjs apps/lesson-mcp/shipped-lessons/discover-studium-fr/lesson.json
STUDIUM_EPHEMERAL=1 pnpm --filter @studium/lesson-mcp exec vitest run src/shipped-lessons.test.ts
```

Le script lance `prepare_sources` et `create_lesson` (les fonctions que les outils MCP appellent) dans une
bibliothèque temporaire : chaque citation est vérifiée au caractère près dans son passage et le linter passe ;
une page de documentation qui ne contient plus une phrase citée fait donc échouer la construction. Le test joue
les deux leçons par le serveur MCP et vérifie que chaque passage cité est toujours dans la page qu'il cite.

## Relire et approuver

Aucun enseignant n'a relu ces leçons, et leur premier écran le dit. `experience_packet.py approve` refuse une
leçon d'auto-apprentissage. Pour en approuver une après l'avoir lue, son mode passe à `teacher` (en gardant
`drafted_by: agent`) et les phrases qui disent qu'aucun enseignant ne l'a vérifiée changent : le texte d'accueil
(`s1-intro`) et la bonne réponse de `s6-quiz` (« Qui a écrit cette clé »). Ensuite :

```bash
.venv/bin/python tools/experience_packet.py approve \
  --bundle apps/lesson-mcp/shipped-lessons/discover-studium-fr/lesson.json \
  --validated-by "Nom du relecteur" --opened s1-intro,s2-quiz,s3-concept,s4-quiz,s5-concept,s6-quiz,s7-explain_back,s8-concept,s9-quiz,s10-concept,s11-quiz,s12-quiz
```

puis de même pour `discover-studium-en`. La commande écrit `approval.json` et `reviews/` à côté de la leçon ; le
test qui vérifie l'absence de registre d'approbation change avec elle.
