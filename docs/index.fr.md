[English](index.md) · Français

# Documentation de Studium

Studium transforme un contenu scientifique en parcours d'apprentissage explicite : objectifs, prérequis, activités, réponses personnelles de l'apprenant et décisions d'adaptation prises à partir d'elles. Un **harnais** est l'application qui héberge un assistant IA et ses outils, par exemple Codex, Claude Code, ou VS Code avec Copilot. Studium conserve le contrat pédagogique ; le harnais aide à lire, expérimenter, programmer et expliquer.

Ces pages décrivent un prototype de recherche, à utiliser d'abord en pilote accompagné. Utilisez le code et la documentation d'une même révision. Les termes techniques sont définis dans le [glossaire](concepts/glossary.fr.md).

## Pour commencer

| Je souhaite… | Lire | Résultat |
|---|---|---|
| Essayer Studium en cinq minutes | [Démarrage rapide](start/quickstart.fr.md) | Une première question dans VS Code ou dans votre assistant |
| Installer l'extension, le serveur MCP ou les outils Python | [Installation](start/installation.fr.md) | Chaque surface prête et vérifiée |
| Garder mon assistant habituel (Codex, Claude Code, Copilot, OpenCode, Cursor) | [Connecter un harnais](start/harnesses.fr.md) | Le serveur Studium déclaré dans ce client |
| Utiliser le panneau VS Code | [VS Code](start/vscode.fr.md) | Leçons, révisions et maîtrise de vos données dans l'éditeur |
| Donner à mon assistant les procédures Studium | [Skills](start/skills.fr.md) | Les skills qui apprennent à un harnais à conduire une leçon |
| Résoudre un problème | [Dépannage](start/troubleshooting.fr.md) | Le symptôme, sa cause et la solution |

## Apprendre seul

Vous choisissez les sources, votre assistant construit la leçon, Studium la vérifie et planifie vos révisions.

- [Apprendre avec votre assistant](learn/learn-with-your-assistant.fr.md) : de « je veux apprendre X » à une première question, puis les révisions quotidiennes.
- [Réviser dans la durée](learn/review-over-time.fr.md) : le plan d'étude, les révisions dues, et ce que l'auto-évaluation change ou ne change pas.
- [Tutoriel : apprendre un sujet au fil d'une conversation](tutorials/learn-a-topic-in-a-conversation.fr.md).
- [Tutoriel : apprendre seul à partir de ses références](tutorials/self-study-from-references.fr.md) : une leçon à livre ouvert tirée d'une page, d'un PDF ou d'un texte, et ses limites.

## Étudier dans une classe

- [Guide étudiant](learn/student-guide.fr.md) : suivre une leçon, répondre, demander un indice, lire le retour.
- [Journal d'expérience](learn/experiment-journal.fr.md) : la trace privée de vos prédictions, observations et conclusions.
- [Rapport de l'apprenant](learn/learner-report.fr.md) : relire une trace choisie avant de la partager ; vos propres textes n'y figurent que sur demande.
- [Carte des notions](learn/concept-map.fr.md) : où vous en êtes sur chaque notion, et une page interactive qui montre sur quoi chacune repose.
- [Langues et supports scientifiques](learn/language-and-supports.fr.md) : changer la langue de présentation ; équations, schémas, structures et figures avec leur provenance.
- [Tutoriel : première séance](tutorials/first-lesson.fr.md).

## Enseigner

- [Guide enseignant](teach/teacher-guide.fr.md) : des sources à une leçon approuvée et à un rapport de classe.
- [Rédiger une leçon](teach/author-a-lesson.fr.md) et [relire et approuver](teach/review-and-approve.fr.md) : l'enregistrement d'approbation lié au fichier exact de la leçon.
- [Suivre une classe](teach/follow-a-class.fr.md) : des rapports agrégés, jamais en dessous de cinq apprenants.
- [Contributions des apprenants](teach/learner-contributions.fr.md) : les leçons écrites par des apprenants et leur publication soumise à l'enseignant.
- [Modèles d'activité](teach/activity-templates.fr.md), [littérature et preuves](teach/literature-and-evidence.fr.md), [médias et supports visuels](teach/media-and-visual-support.fr.md).
- [Observatory](teach/observatory.fr.md) : relecture de cours, provenance et rapports MySTRA pour les opérateurs.
- Tutoriels : [de l'article au cours](tutorials/literature-to-course.fr.md), [une expérience agentique](tutorials/agentic-experiment.fr.md), [de l'activité au rapport](tutorials/activity-to-report.fr.md), et [cas d'usage](tutorials/use-cases.fr.md) (capsule ASB et métabolomique, diagnostic d'analyse, robustesse, photographie en archéologie, aide multilingue).

## Comprendre

- [Comment fonctionne Studium](concepts/how-studium-works.fr.md) et [capacités et maturité](concepts/capabilities.fr.md).
- [Types de scènes](concepts/scene-types.fr.md), [modèle de l'apprenant](concepts/learner-model.fr.md), [principes d'apprentissage](concepts/learning-principles.fr.md), [modulateurs](concepts/modulators.fr.md).
- [Honnêteté et provenance](concepts/honesty-and-provenance.fr.md) : qui a rédigé la clé, si un juge a évalué, ce qui a été mesuré.
- [Confidentialité et limites](concepts/privacy-and-limits.fr.md) : à lire avant un pilote en classe.
- [Glossaire](concepts/glossary.fr.md).

## Construire sur Studium

- Référence : [outils MCP](reference/mcp-tools.fr.md), [format de leçon](reference/lesson-bundle.fr.md), [configuration](reference/configuration.fr.md), [ligne de commande](reference/cli.fr.md), [protocole de séance agentique](reference/agentic-session-protocol.fr.md), [API HTTP](reference/http-api.fr.md). Les pages de référence générées restent en anglais, avec une introduction en français.
- Développer : [architecture](develop/architecture.fr.md), [tests](develop/testing.fr.md), [publication](develop/release.fr.md), [style de la documentation](develop/docs-style.fr.md).
- [Contribuer](../CONTRIBUTING.fr.md), [politique de sécurité](../SECURITY.fr.md), [journal des modifications](../CHANGELOG.md), [conventions des agents](../AGENTS.md).
- [Archives de conception](design-records/index.fr.md) : spécifications, décisions, audits et notes datées, conservés dans leur langue d'origine.
- Procédure du harnais : [`skills/studium-harness/SKILL.md`](../skills/studium-harness/SKILL.md) ; banc d'évaluation : [`eval/README.md`](../eval/README.md).

## Skills

Sept skills sont découverts par les harnais via `.claude/skills` et `.agents/skills` : `studium-teacher`, `studium-student`, `studium-harness`, `studium-self-learner` (apprendre sans enseignant), `studium-activity-templates`, `studium-visual-support` et `studium-learner-report`. Un skill supplémentaire, `studium-observatory`, se trouve dans [`skills/`](../skills). Voir [Skills](start/skills.fr.md).

## Limites

Les activités décrites ici ne valent ni validation scientifique ni preuve d'efficacité pédagogique. Un enseignant approuve une leçon avant que des étudiants l'utilisent.

## Proposer une amélioration

Indiquez la révision du code, le parcours suivi, le résultat attendu et un exemple minimal anonymisé. Ne joignez ni clé d'API, ni dossier d'étudiant, ni article dont la redistribution n'est pas autorisée. Les problèmes de sécurité passent par la [politique de sécurité](../SECURITY.fr.md), pas par une issue publique.
