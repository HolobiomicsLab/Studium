# Documentation Studium

Studium transforme un contenu scientifique en parcours d'apprentissage explicite :
objectifs, prérequis, activités, réponses personnelles et décisions d'adaptation.
Un **harnais** est l'application qui héberge l'agent et ses outils, par exemple
VS Code avec Copilot, Claude Code ou Codex. Studium conserve le contrat pédagogique ;
le harnais aide à lire, expérimenter, programmer et expliquer.

Cette documentation décrit le **prototype de recherche**, à utiliser d'abord en
pilote accompagné. Elle est destinée à être lue directement sur GitHub. Les
pages d'entrée ont été consolidées le **12 septembre 2026**, à partir du code et
des vérifications de connexion disponibles. Les références fournisseurs ont leur
date de consultation dans les guides concernés.
Utiliser le code et les guides de la même révision. L'accès au dépôt dépend de
ses permissions ; ces pages n'annoncent ni publication publique ni version stable.

## Choisir son entrée

| Je souhaite… | Commencer ici | Résultat attendu |
|---|---|---|
| Suivre une activité | [Guide étudiant](user/student-guide.md) | Une première réponse personnelle dans une séance |
| Préparer un enseignement | [Guide enseignant](user/teacher-guide.md) | Un brouillon sourcé et une revue avant diffusion |
| Installer les outils | [Installation](getting-started/installation.md) | Panneau, serveur MCP ou API locale prêt à vérifier |
| Utiliser mon avantage étudiant | [Copilot Student](getting-started/copilot.md) | Compte activé et Studium connecté à VS Code |
| Piloter sans MCP ni VS Code | [API locale et harnais](guides/api-and-harness.md) | Session HTTP, reprise et export |
| Garder mon agent habituel | [Harnais et API](getting-started/harnesses-and-api.md) | Configuration adaptée au client choisi |
| Comprendre le produit | [Fonctionnalités et maturité](features.md) | Ce qui fonctionne et ce qui reste expérimental |
| Voir les dernières avancées | [10–12 septembre](updates/2026-09-12.md) | Changements, révisions et limites de vérification |
| Choisir une activité concrète | [Cas d'usage](tutorials/use-cases.md) | Matériel requis, rôle de chacun et résultat à relire |

Les [skills prêts à utiliser](getting-started/skills.md) accompagnent ces parcours :
`studium-teacher`, `studium-student`, `studium-harness`,
`studium-self-learner` (apprenant sans enseignant), `studium-activity-templates`,
`studium-visual-support` et `studium-learner-report`.

## Apprendre par la pratique

1. [Première séance](tutorials/first-lesson.md) : découvrir les outils, lire une scène,
   répondre, demander un indice et comprendre une adaptation.
2. [De l'article au cours](tutorials/literature-to-course.md) : préparer un dossier
   de preuves, faire proposer un plan, le vérifier et le relire dans MySTRA.
3. [Expérience agentique](tutorials/agentic-experiment.md) : prédire, exécuter,
   modifier un facteur, construire un visualiseur et défendre une conclusion.
4. [Auto-apprentissage à partir de ses références](tutorials/self-study-from-references.md) :
   extraire les passages d'une source choisie, faire rédiger la leçon, lire ses
   limites (livre ouvert, aucune validation enseignant) et la jouer.
5. [Activité → rapport](tutorials/activity-to-report.md) : choisir un template,
   expérimenter et vérifier l'export ASTRA/ARA/MySTRA avant partage.

Pour choisir entre ces parcours, lire les [cas d'usage](tutorials/use-cases.md) :
capsule ASB et métabolomique, diagnostic d'analyse, robustesse, photographie en
archéologie, aide multilingue et restitution. Les [langues et supports scientifiques](guides/language-and-scientific-presentation.md)
et les [médias sourcés ou générés](guides/sourced-and-generated-media.md) restent
facultatifs ; aucun modèle multimodal n'est nécessaire pour terminer une activité.

Les guides [confidentialité et limites](privacy-and-limits.md) et
[dépannage](troubleshooting.md) accompagnent les deux rôles. Les activités proposées
ici ne valent pas validation scientifique ni preuve d'efficacité pédagogique.

## Références pour aller plus loin

- [Templates d’activité pour le harnais](user/activity-templates.md),
  [rapport étudiant ASTRA/MySTRA](user/learner-report.md) et
  [tutoriel activité → rapport](tutorials/activity-to-report.md).
- [Photographies, audio et vidéo](guides/sourced-and-generated-media.md) :
  sources et droits, accessibilité, génération par le harnais et
  [exemple d’archéologie](../examples/archaeology/README.md).
- [Journal privé prédiction → observation → conclusion](user/experiment-journal.md),
  [viewer MS/MS à représentations liées](user/linked-viewer.md) et
  [révision approuvée → synthèse](user/reviewed-synthesis.md).
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

Pour comprendre les méthodes et les symboles `?` pendant une séance :
[aide contextuelle pédagogique](guides/contextual-help.md), avec exemples étudiant,
enseignant et contrat commun pour les viewers créés par un harnais.
