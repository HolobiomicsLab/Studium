# Fonctionnalités et maturité

Studium est un prototype de recherche d'enseignement adaptatif. Son unité est un
parcours explicite de concepts et de tâches, pas seulement une conversation avec
un modèle. Cette page décrit le code jusqu'à `2691a5a`, consolidé le
12 septembre 2026. Une fonction implémentée n'est pas nécessairement publiée
sur la branche clonée, ni intégrée à toutes les interfaces.
Voir le [relevé des dernières avancées](updates/2026-09-12.md) et les
[cas d'usage](tutorials/use-cases.md).

## Ce que chaque composant apporte

| Capacité | Comportement disponible | Limite pratique |
|---|---|---|
| Plan pédagogique | Objectifs, scènes, prérequis et Learning Workflow Graph | Les propositions et liens scientifiques nécessitent une revue |
| Parcours adaptatif | Navigation liée aux prérequis, maîtrise, indices et remédiation | Dépend de la qualité du bundle et des évaluateurs |
| Métacognition | Confiance déclarée et comparaison avec la performance | Indicateurs du prototype, pas diagnostic ni note institutionnelle |
| Journal d'expérience | Prédiction motivée, confiance, observation et conclusion conservées via MCP/fichiers | Privé, opt-in, non noté ; reprise durable à configurer |
| Panneau VS Code | Scènes, réponses, assets et graphe ; actions sérialisées, attente visible et erreurs locales | Installation/build ou VSIX de pilote ; Extension Host réel à vérifier |
| Notebook VS Code | Même contrat de scène dans une cellule pilote | Rendu à vérifier dans le véritable Extension Host |
| Harnais MCP | Outils pour ouvrir la séance, lire le contexte public et répondre | Chaque client a ses propres outils, compte et session |
| API HTTP locale | Les 25 opérations communes à MCP, découverte des schémas, token et relances protégées | Usage individuel local ; sessions actives perdues à l'arrêt du serveur |
| Canal fichier | Boucle tâche/réponse pour un harnais sans MCP | Respect des formats et écritures atomiques nécessaire |
| Littérature → draft | Capture de passages, plan canonique et liens exacts aux preuves | Pas d'approbation scientifique ni de bundle jouable automatique |
| Capsule ASB | Carte de tâche et protocole de reproduction | Un tier de capsule n'atteste pas un run étudiant |
| Visualiseur à la demande | Contexte public pour construire un artefact externe adapté | Pas d'installation automatique de code généré dans le panneau |
| Représentations liées | Exemple réseau MS/MS, spectres miroir et candidats avec baseline et paramètres | Données synthétiques ; similarité ne signifie pas identité |
| Révision approuvée → synthèse | Workflow local qui vérifie l'empreinte du plan relu avant synthèse | CLI et orchestrateur configuré ; contenu généré à relire avant diffusion |
| Dossier d'exploration | Capture portable de sources, versions, fichiers et contrôles | Hashes d'intégrité, pas preuve indépendante d'exécution |
| Activités portables | Cinq templates, choix des paramètres, prédiction et conclusion ; export volontaire | Viewers locaux sans agent embarqué ni avancement automatique de la séance |
| Supports et médias | Mermaid, KaTeX, SMILES 2D, images, audio/vidéo avec provenance | Couverture différente selon le viewer ; génération externe facultative |
| Présentation multilingue | Langue modifiable dans le contexte du harnais et dictionnaires d'activités | Pas de traduction automatique de toutes les interfaces historiques |
| ASTRA / MySTRA | Provenance structurée et lecture locale des analyses/décisions | La revue n'exécute pas le code et ne signe pas une approbation |
| Observatory | Inspection de cours et vues de revue | Service local, pas portail multi-utilisateur authentifié |
| Contributions étudiantes | Proposition, revue et diffusion de bundles communautaires ; découverte par l'outil MCP `list_community_bundles` | MVP : tout cours dont le bundle canonique est `<BUNDLES_ROOT>/<cours>/lesson.json` ; bundle émis après la décision enseignante `decide_item` |
| Auto-apprentissage | Leçon construite par l'apprenant à partir de ses références (`passages`, `prepare`, `check`, `bundle --self-study`) ; [tutoriel](tutorials/self-study-from-references.md) | Livre ouvert pour quiz et défauts à repérer ; ni validation enseignante ni diffusion |

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

### Qui a écrit la clé ?

Un bundle peut déclarer son autorat dans `metadata.authoring`
(`mode: "teacher"` par défaut, ou `"self_study"`, avec `author_is_learner`).
`start_lesson_session`, `get_operator_context` (et le `task.md` du canal fichier)
et `presentation` renvoient un bloc `authoring: { mode, author_is_learner, validated, judge, notice }` ;
le panneau affiche l'avis en bannière. `judge` indique si un juge modèle est
configuré. L'avis d'une leçon auto-rédigée suit `metadata.language` et `judge` :

| Langue, juge | Avis |
|---|---|
| fr, sans juge | « Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert). Sans juge modèle, les scènes de production donnent un retour par mots-clés sans évaluation certifiée ; seules les reproductions exécutées portent une évaluation externe. » |
| fr, avec juge | « Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert). Les scènes de production, jugées par le modèle, et les reproductions exécutées portent l'évaluation. » |
| en, sans juge | « Self-authored lesson: quiz and spot-the-flaw keys were written by the learner (open book). Without a judge model, production scenes give keyword feedback with no certified assessment; only executed reproductions carry an external assessment. » |
| en, avec juge | « Self-authored lesson: quiz and spot-the-flaw keys were written by the learner (open book). Production scenes, judged by the model, and executed reproductions carry the assessment. » |

Les types de scène se rangent en quatre
classes de clé, affichées par `check` (ligne `Key classes:`) et reprises par le lint :

| Classe | Types | En auto-apprentissage |
|---|---|---|
| `ungraded` | intro, concept, meta_checkpoint | Rien n'est évalué |
| `author_keyed` | quiz, spot_the_flaw | Clé écrite par celui qui répondra : livre ouvert |
| `production` | explain_back, comparison, summary_audit, prompt_practice, communication_sim, discussion, ai_critique | Sans juge modèle, retour par mots-clés auto-écrits, sans évaluation certifiée ni effet sur la maîtrise ; un juge modèle (`LITELLM_BASE_URL`) rend l'évaluation externe |
| `externally_grounded` | reproduction | Résultat de référence issu d'une exécution attestée |

Le lint signale `self_study_authoring` (INFO), `self_study_open_book` (WARN, scènes
`author_keyed`), `self_study_no_external_key` (WARN, ni `production` ni
`externally_grounded`) et `learner_authored_validated` (INFO, contribution
d'apprenant approuvée par un enseignant).

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

### Quelle surface pour quelle capacité ?

| Surface | Capacités présentes | À prévoir séparément |
|---|---|---|
| Harnais API/MCP/fichiers | Scène publique, langue demandée, réponses typées, contexte d'exploration | Modèle, outils web/scientifiques et génération du harnais |
| Panneau VS Code | Figures, équations, plots, spectres, structures et graphe ; thème de l'éditeur et aide `?` | Pas de synchronisation automatique avec un autre serveur de séance |
| Cinq activités portables | Sélecteur de langue, dictionnaires, Mermaid, KaTeX, SMILES 2D, images et lecteurs audio/vidéo | Pas tous les renderers du panneau ; données scientifiques préparées en amont |
| Rapports ASTRA/MySTRA | Trace choisie, provenance, navigation et aide contextuelle | Pas de replay du calcul ni de localisation complète de l'interface |
| Observatory et interfaces auteur | Inspection de cours, revue et explications des méthodes | Pas de portail de classe authentifié ni de parité automatique avec les activités |

Les [contrats de présentation](guides/language-and-scientific-presentation.md)
et de [médias](guides/sourced-and-generated-media.md) précisent formats, solutions
de repli et provenance. Les adaptations répondent à un besoin exprimé ; elles
ne diagnostiquent pas un profil cognitif ni un handicap.

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

### Langue et représentations scientifiques

Les activités portables affichent des diagrammes Mermaid, équations KaTeX,
structures SMILES 2D et images avec provenance et mention d'origine IA si nécessaire.
Les séances API, MCP et fichiers portent une préférence de langue que le harnais
applique à ses présentations. Les dictionnaires traduisent les textes fournis ;
ils ne localisent pas automatiquement toutes les anciennes interfaces.
Voir [le tutoriel](guides/language-and-scientific-presentation.md).

## Expliquer les méthodes pendant l’usage

Les contrôles `?` donnent des explications pour enseignants et étudiants : objectif,
prédiction, confiance, preuves, adaptation, traces et provenance. Catalogue EN/FR
commun aux activités, viewers, rapports, interfaces web et panneau VS Code.
Voir [couverture, exemples et intégration](guides/contextual-help.md). Les textes
expriment l’intention pédagogique ; ils ne certifient pas les bénéfices du prototype.

## API locale et harnais indépendants

L’[API HTTP](guides/api-and-harness.md) expose les mêmes opérations et schémas que MCP, avec authentification locale, découverte, sérialisation, protection contre les doubles soumissions et scènes périmées. Un même serveur peut être piloté successivement depuis plusieurs harnais sans VS Code. Les sessions actives et reçus restent limités à la durée de vie du processus ; ce serveur individuel ne constitue pas un hébergement multi-utilisateur.
