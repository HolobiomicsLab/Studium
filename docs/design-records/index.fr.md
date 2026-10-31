[English](index.md) · Français

# Archives de conception

Ce dossier conserve les documents qui ont fondé la conception de Studium : spécifications, décisions
d'architecture (ADR), audits et notes de flux d'information. Ce sont des archives. Chacune garde sa langue
et sa forme d'origine ; elle peut donc décrire un état antérieur du code. Pour le fonctionnement actuel,
lisez la [page d'architecture](../develop/architecture.fr.md) et la [référence](../reference/mcp-tools.fr.md).

## Spécifications

| Document | Objet |
|---|---|
| [Types de scènes d'apprentissage actif](specs/active-learning-scenes.md) | `spot_the_flaw` et `explain_back` |
| [Scènes d'apprentissage actif, vague 1](specs/active-learning-scenes-wave1.md) | `comparison`, `summary_audit`, `prompt_practice` |
| [Scène d'apprentissage actif, vague 2](specs/active-learning-scenes-wave2-communication-sim.md) | `communication_sim` |
| [Plan « apprenant auteur »](specs/learner-as-author-plan.md) | items rédigés par l'apprenant (LAItem), côté serveur d'abord |
| [Bundles communautaires dans le runtime](specs/community-bundles-live-runtime-A3.md) | contributions d'apprenants approuvées, jouées comme leçons |
| [PeerStudio D1](specs/peerstudio-d1.md) | socle multi-apprenants (salles entre pairs) |

## Décisions d'architecture

| Document | Décision |
|---|---|
| [ADR 0001](adr/0001-astra-analyses-shape-and-ara-trace.md) | documents ASTRA au format ASB et traces d'exploration ARA |
| [ADR 0002](adr/0002-learner-actions-as-declared-artifacts.md) | actions de l'apprenant déclarées comme artefacts ASTRA |

## Audits

| Document | Langue | Objet |
|---|---|---|
| [Audit d'accessibilité M6](audits/2026-05-13-axe-m6.md) | français | audit axe de la démo M6 |
| [Audit du hub](audits/2026-08-19-hub-audit.md) | anglais | audit du dépôt sur la branche `feat/trust-instrument` |
| [Reproduire les audits locaux](audits/live-ui-audits.md) | français | relancer les pilotes d'audit apprenant, enseignant et VS Code sur des données synthétiques |
| [Audit de l'interface native](audits/native-ui-audit.md) | français | pourquoi l'application Tauri gelée ne peut pas encore être auditée isolément |

## Flux d'information

| Document | Objet |
|---|---|
| [Modèles d'activité et rapports](info-flow/activity-templates-and-reports.md) | ce que lit et écrit chaque modèle et chaque rapport |
| [Exploration ancrée](info-flow/grounded-exploration.md) | le parcours d'exploration et ses traces |
| [Expérience de lecture scientifique](info-flow/literature-experience.md) | d'un paquet de sources à une activité fondée sur la littérature |

## Autres documents

| Document | Langue | Objet |
|---|---|---|
| [Charte des viewers](viewer-charter.md) | français | règles visuelles communes des viewers HTML |
| [Guide de test « apprenant auteur »](learner-as-author-test-guide.md) | français et anglais | scénario de test manuel des contributions d'apprenants |
| [Conformité de l'ontologie](ontology-conformance.md) | anglais | produit par `tools/ontology_report.py` ; reste à son emplacement de génération |
| [Avancées du 10 au 12 septembre 2026](updates/2026-09-12.md) | français | note d'avancement datée ; liens repointés vers les pages actuelles |

## Ajouter un document

Un nouveau document va dans le sous-dossier qui lui correspond, garde sa langue d'origine et reçoit une
ligne ici et dans [index.md](index.md). On ne réécrit pas un document après coup : une décision ultérieure
fait l'objet de son propre document, qui nomme celui qu'elle remplace.
