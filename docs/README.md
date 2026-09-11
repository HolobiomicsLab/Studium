# Documentation Studium

Studium transforme un contenu scientifique en parcours d'apprentissage explicite :
objectifs, prérequis, activités, réponses personnelles et décisions d'adaptation.
Un **harnais** est l'application qui héberge l'agent et ses outils, par exemple
VS Code avec Copilot, Claude Code ou Codex. Studium conserve le contrat pédagogique ;
le harnais aide à lire, expérimenter, programmer et expliquer.

Cette documentation décrit le **prototype de recherche**, à utiliser d'abord en
pilote accompagné. Elle est destinée à être lue directement sur GitHub. Les
recettes et informations fournisseurs ont été vérifiées le **11 septembre 2026**.
Utiliser le code et les guides de la même révision. L'accès au dépôt dépend de
ses permissions ; ces pages n'annoncent ni publication publique ni version stable.

## Choisir son entrée

| Je souhaite… | Commencer ici | Résultat attendu |
|---|---|---|
| Suivre une activité | [Guide étudiant](user/student-guide.md) | Une première réponse personnelle dans une séance |
| Préparer un enseignement | [Guide enseignant](user/teacher-guide.md) | Un brouillon sourcé et une revue avant diffusion |
| Installer les outils | [Installation](getting-started/installation.md) | Serveur MCP et/ou panneau VS Code fonctionnel |
| Utiliser mon avantage étudiant | [Copilot Student](getting-started/copilot.md) | Compte activé et Studium connecté à VS Code |
| Garder mon agent habituel | [Harnais et API](getting-started/harnesses-and-api.md) | Configuration adaptée au client choisi |
| Comprendre le produit | [Fonctionnalités et maturité](features.md) | Ce qui fonctionne et ce qui reste expérimental |

Les [skills prêts à utiliser](getting-started/skills.md) accompagnent ces parcours :
`studium-teacher`, `studium-student` et `studium-harness`.

## Apprendre par la pratique

1. [Première séance](tutorials/first-lesson.md) : découvrir les outils, lire une scène,
   répondre, demander un indice et comprendre une adaptation.
2. [De l'article au cours](tutorials/literature-to-course.md) : préparer un dossier
   de preuves, faire proposer un plan, le vérifier et le relire dans MySTRA.
3. [Expérience agentique](tutorials/agentic-experiment.md) : prédire, exécuter,
   modifier un facteur, construire un visualiseur et défendre une conclusion.

Les guides [confidentialité et limites](privacy-and-limits.md) et
[dépannage](troubleshooting.md) accompagnent les deux rôles. Les activités proposées
ici ne valent pas validation scientifique ni preuve d'efficacité pédagogique.

## Références pour aller plus loin

- [Procédure du harnais](../skills/studium-harness/SKILL.md) et
  [protocole agentique](agentic-session-protocol.md).
- [Revue MySTRA](guides/mystra-reviewer.md), [Observatory](guides/observatory.md),
  [contrat littérature](guides/literature-experience.md) et
  [dossiers d'exploration](guides/grounded-exploration.md).
- [Évaluations techniques](../eval/README.md), [architecture](../README.md)
  et [instructions de développement](../CLAUDE.md).

Pour proposer une amélioration, fournir la révision du code, le parcours suivi,
le résultat attendu et un exemple minimal anonymisé. Ne pas joindre une clé API,
un dossier étudiant ou un article dont la redistribution n'est pas autorisée.
