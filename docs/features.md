# Fonctionnalités et maturité

Studium est un prototype de recherche d'enseignement adaptatif. Son unité est un
parcours explicite de concepts et de tâches, pas seulement une conversation avec
un modèle. Cette page décrit le code documenté au 11 septembre 2026 ; une fonction
présente dans le dépôt n'est pas nécessairement intégrée à toutes les interfaces.

## Ce que chaque composant apporte

| Capacité | Comportement disponible | Limite pratique |
|---|---|---|
| Plan pédagogique | Objectifs, scènes, prérequis et Learning Workflow Graph | Les propositions et liens scientifiques nécessitent une revue |
| Parcours adaptatif | Navigation liée aux prérequis, maîtrise, indices et remédiation | Dépend de la qualité du bundle et des évaluateurs |
| Métacognition | Confiance déclarée et comparaison avec la performance | Indicateurs du prototype, pas diagnostic ni note institutionnelle |
| Journal d'expérience | Prédiction motivée, confiance, observation et conclusion conservées via MCP/fichiers | Privé, opt-in, non noté ; reprise durable à configurer |
| Panneau VS Code | Scènes, réponses, assets et graphe dans l'éditeur | Installation/build ou VSIX de pilote requis |
| Notebook VS Code | Même contrat de scène dans une cellule pilote | Rendu à vérifier dans le véritable Extension Host |
| Harnais MCP | Outils pour ouvrir la séance, lire le contexte public et répondre | Chaque client a ses propres outils, compte et session |
| Canal fichier | Boucle tâche/réponse pour un harnais sans MCP | Respect des formats et écritures atomiques nécessaire |
| Littérature → draft | Capture de passages, plan canonique et liens exacts aux preuves | Pas d'approbation scientifique ni de bundle jouable automatique |
| Capsule ASB | Carte de tâche et protocole de reproduction | Un tier de capsule n'atteste pas un run étudiant |
| Visualiseur à la demande | Contexte public pour construire un artefact externe adapté | Pas d'installation automatique de code généré dans le panneau |
| Représentations liées | Exemple réseau MS/MS, spectres miroir et candidats avec baseline et paramètres | Données synthétiques ; similarité ne signifie pas identité |
| Révision approuvée → synthèse | Workflow local qui vérifie l'empreinte du plan relu avant synthèse | CLI et orchestrateur configuré ; contenu généré à relire avant diffusion |
| Dossier d'exploration | Capture portable de sources, versions, fichiers et contrôles | Hashes d'intégrité, pas preuve indépendante d'exécution |
| ASTRA / MySTRA | Provenance structurée et lecture locale des analyses/décisions | La revue n'exécute pas le code et ne signe pas une approbation |
| Observatory | Inspection de cours et vues de revue | Service local, pas portail multi-utilisateur authentifié |
| Contributions étudiantes | Proposition, revue et diffusion de bundles communautaires | MVP borné, notamment au cours de démonstration pour certains endpoints |

## Les 13 types de scènes

| Type du schéma | Intention pédagogique |
|---|---|
| `intro` | Situer l'objectif et le parcours |
| `concept` | Présenter et manipuler une idée |
| `quiz` | Répondre à un choix évalué |
| `meta_checkpoint` | Déclarer sa confiance |
| `reproduction` | Examiner un protocole et des résultats d'exécution |
| `ai_critique` | Critiquer une production de l'IA |
| `discussion` | Développer un raisonnement dialogué |
| `spot_the_flaw` | Repérer et expliquer des erreurs |
| `explain_back` | Reformuler et enseigner l'idée |
| `comparison` | Comparer deux objets ou explications |
| `summary_audit` | Vérifier un résumé et ses omissions |
| `prompt_practice` | Concevoir et améliorer une consigne |
| `communication_sim` | Produire une communication adaptée à une situation |

Les réponses sont typées : un texte, un choix et une confiance ne sont pas
interchangeables. Le contexte opérateur fournit un exemple de format canonique.
Les évaluateurs peuvent utiliser une logique locale ou un fournisseur configuré ;
une démonstration mock ne mesure pas la qualité d'un évaluateur LLM réel.

## Assets et ergonomie

Les surfaces prennent en charge images, SVG, équations LaTeX, code, CSV, protocoles,
spécifications de graphique et résultats exécutés. Les assets scientifiques
comprennent notamment orbitales, molécules 3D et spectres. Les bibliothèques de
rendu sont vendorizées pour le mode local ; une option CDN existe. Les solutions
de repli permettent de lire le contenu si un renderer manque, sans promettre
une interaction identique.

Le graphe possède une vue étudiante et une vue enseignant. Les préférences de
modalité peuvent réordonner et accentuer les assets sans cacher le contenu.
Les indices, rappels de révision et explications d'adaptation accompagnent la
progression. Voir la [référence extension](../apps/studium-vscode/README.md).

## Adaptation et auditabilité

Le moteur relie la maîtrise aux tentatives évaluées ; cliquer « continuer » ne
suffit pas à démontrer tous les concepts. Des prérequis non acquis peuvent mener
à une remédiation, et les univers baseline/remedial modulent l'accompagnement.
Les indices réduisent le crédit de maîtrise pour limiter la délégation de la
réponse. Les tags de modulateurs actifs sont M1, M3 et M6 : voir
[leur définition](ontology/modulators.md).

Les représentations indicium et ASTRA rendent les affirmations et décisions
inspectables. Leur présence permet un audit ; elle ne garantit pas qu'une
inférence pédagogique est correcte. MySTRA aide le reviewer à confronter le plan
aux preuves et à distinguer éléments vérifiés, déclarés et encore à examiner.

## Agenticité : une répartition des responsabilités

- **Studium** garde concepts, scènes, réponse attendue, progression et protocole de run.
- **Le harnais** possède les outils, lit les skills, cherche et exécute dans son environnement.
- **L'étudiant** prédit, choisit une variation, interprète et répond.
- **L'enseignant** fixe le périmètre, relit et décide de la diffusion.

La recherche web, Perspicacité, les bibliothèques et les skills ne sont pas
magiquement disponibles parce qu'un cours les mentionne. Le harnais doit vérifier
ses connexions réelles. Le [tutoriel agentique](tutorials/agentic-experiment.md)
montre comment exploiter ces capacités sans sortir du contrat pédagogique.

## Frontières encore ouvertes

Le [workflow local de revue et synthèse](user/reviewed-synthesis.md) conserve la
révision approuvée et expose sa provenance dans MySTRA. Il complète le parcours
historique : l'approbation dans le navigateur reste un export local et la route
HTTP de synthèse requiert un orchestrateur configuré. L'installation automatique
d'un viewer dans tous les clients et un portail enseignant authentifié restent
à construire. Le panneau et un MCP indépendant ne partagent pas automatiquement
leur session. Le [journal privé](user/experiment-journal.md) peut reprendre ses
contributions avec le même stockage, identité et contenu de cours.

La conformité institutionnelle, le déploiement multi-utilisateur et l'efficacité
pédagogique ne découlent pas de tests logiciels réussis. Commencer par un pilote
accompagné, avec [les règles de confidentialité](privacy-and-limits.md) adaptées.

## Activités réutilisables et rapport étudiant

Le [catalogue de templates](user/activity-templates.md) permet au harnais de
préparer cinq activités : représentations liées, comparaison de paramètres,
examen d’une affirmation à partir de preuves, diagnostic d’analyse et robustesse
d’une conclusion. Les deux dernières comparent des résultats fournis et des
hypothèses explicites ; l’exécution scientifique relève du harnais. Le viewer
reste un outil local, sans agent intégré.

Le [rapport étudiant](user/learner-report.md) transforme les actions exportées
volontairement et/ou un journal choisi en une copie locale ASTRA/MySTRA. Les
événements utilisent un contrat Studium versionné ; ASTRA et ARA conservent leurs
formats communs. Les textes personnels sont exclus par défaut. Cette trace
partielle ne prouve ni l’absence d’aide, ni l’apprentissage, ni l’identité de son
auteur. Elle ne soumet pas de réponse et ne modifie pas la maîtrise des concepts.

## Supports visuels et différenciation par le harnais

Le [guide dédié](guides/adaptive-visual-support.md) distingue les médias déjà rendus, les imports PDF/ASB encore incomplets et le workflow de génération externe. Le skill `studium-visual-support` prépare une aide sourcée à partir de la scène et des besoins exprimés ; il ne constitue pas un moteur automatique de personnalisation. Les viewers partagent une [charte sobre](design/viewer-charter.md).

Les activités portables acceptent maintenant des photographies avant la prédiction,
des supports audio/vidéo locaux avec transcription et sous-titres, et des prompts
de génération préparés pour le harnais. L'enseignant peut préparer un média une
fois ; l'étudiant peut demander une aide et faire intégrer le fichier retourné
dans un nouvel artefact. Les droits et la provenance restent explicites. Voir le
[parcours complet et ses limites](guides/sourced-and-generated-media.md).
Cette capacité ne constitue pas un branchement automatique à une API multimodale
ni une migration de tous les lecteurs et rapports historiques.

### Scientific supports and language

Portable activities can include local Mermaid diagrams, KaTeX equations, 2D SMILES
structures and raster figures, with provenance and an AI-origin notice where
applicable. MCP and file sessions carry an editable presentation-language policy
for the active harness. GUI translations use packaged dictionaries; this does not
automatically localize all legacy interfaces or call a translation/image API.
See [the tutorial](guides/language-and-scientific-presentation.md).
