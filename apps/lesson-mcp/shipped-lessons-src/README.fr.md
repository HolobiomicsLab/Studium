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
| Statut | mode enseignant (`authoring_mode` dans `sources.json`), `drafted_by: agent` ; le responsable du projet les a approuvées le 25 novembre 2026, sous le nom beta-testeur, sans les avoir lues (aucune scène ouverte, aucune liste de contrôle déclarée) ; `approval.json` est lié aux octets exacts de `lesson.json` (règle 003) |

| Fichier | Ce que c'est |
|---|---|
| `sources.json` | les pages, leur URL et leur licence, l'objectif de chaque version, et le mode de rédaction qu'écrit la construction (`authoring_mode`) |
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
bibliothèque temporaire : chaque citation est vérifiée au caractère près dans son passage ; une page de
documentation qui ne contient plus une phrase citée fait donc échouer la construction. `create_lesson` écrit
toujours une leçon d'auto-apprentissage ; le script lui donne ensuite le mode de rédaction que nomme
`sources.json`, en gardant `drafted_by: agent`, et passe le linter sur la leçon qu'il livre. Le test joue
les deux leçons par le serveur MCP et vérifie que chaque passage cité est toujours dans la page qu'il cite.

## Relire et approuver

`experience_packet.py approve` refuse une leçon d'auto-apprentissage : ces leçons sont donc construites en mode
enseignant (`authoring_mode` dans `sources.json`), toujours `drafted_by: agent`. Le responsable du projet les a
approuvées le 25 novembre 2026, sous le nom beta-testeur, sans les avoir lues : leur reçu dans `reviews/` dit
qu'aucune scène n'a été ouverte, et leur registre d'approbation ne déclare aucune liste de contrôle. Le texte de la
leçon ne dit jamais qu'elle a été approuvée, puisque le statut vient du registre, qu'une copie ou une reconstruction
laisse derrière elle : le texte d'accueil (`s1-intro`) dit qu'un agent d'IA a rédigé la leçon et renvoie au haut de
l'écran, qui dit si quelqu'un a validé cette version exacte et qui ; la bonne réponse de `s6-quiz`
(« Qui a écrit cette clé ») est l'agent d'IA.

Pour approuver une leçon, pour chaque langue :

```bash
.venv/bin/python tools/experience_packet.py approve \
  --bundle apps/lesson-mcp/shipped-lessons/discover-studium-fr/lesson.json \
  --validated-by "Nom du relecteur" --opened s1-intro,s6-quiz \
  --note "Ce qui s'est passé : les scènes lues, et comment"
```

`--opened` ne liste que les scènes réellement ouvertes et lues (omettez-le quand aucune ne l'a été) ; `--note`
dit ce qui s'est passé. La commande réécrit `lesson.json` (`validated_by`, `validated_at`), puis écrit
`approval.json`, lié au sha256 de ces octets, et un reçu dans `reviews/` à côté de la leçon.

Reconstruire les leçons, ou modifier un `lesson.json`, change ses octets : son registre d'approbation est alors
périmé, et les apprenants lisent que la leçon a changé depuis son approbation. `src/shipped-lessons.test.ts` (et
la vérification de la démonstration dans `apps/studium-vscode/src/extension-host.driver.ts`) échouent jusqu'à ce
que `approve` soit relancé sur les nouveaux octets, avec le nom du relecteur lui-même, `--opened` ne listant que
les scènes réellement ouvertes et lues, et une `--note` disant ce qui s'est passé. Les tests ne nomment aucun
relecteur : ils le lisent dans `approval.json` et vérifient que le registre, `validated_by` et l'unique reçu des
octets actuels concordent.
