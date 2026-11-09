[English](README.md) · Français

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/hero-dark.svg">
    <img src="docs/assets/hero-light.svg" width="880" alt="Studium : des leçons adaptatives, fondées sur la connaissance. Pour les enseignants, les étudiants et les autodidactes.">
  </picture>
</p>

# Studium

Studium transforme des sources que vous jugez fiables en leçons adaptatives, à suivre dans VS Code ou avec votre propre assistant IA, et son évaluation dit toujours qui a rédigé la clé de correction et si quelque chose a réellement été mesuré.

## Choisir son parcours

| Je veux… | Commencer ici | Ce que vous obtenez |
|---|---|---|
| Apprendre seul un sujet avec un assistant IA | [Apprendre avec votre assistant](docs/learn/learn-with-your-assistant.fr.md) | Une leçon construite à partir des sources choisies, puis des révisions espacées les jours suivants |
| Étudier dans une classe | [Guide étudiant](docs/learn/student-guide.fr.md) | Une leçon approuvée par l'enseignant, dans VS Code ou dans votre assistant, avec un retour après chaque réponse |
| Enseigner | [Guide enseignant](docs/teach/teacher-guide.fr.md) | Une leçon sourcée, un enregistrement d'approbation lié à son contenu exact et un rapport de classe agrégé |
| Construire sur Studium | [Architecture](docs/develop/architecture.fr.md) et [outils MCP](docs/reference/mcp-tools.fr.md) | Les contrats du moteur, les 40 outils MCP et le format des leçons |

Le [portail de la documentation](docs/index.fr.md) classe toutes les pages par rôle.

## Captures d'écran

<table>
  <tr>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/vscode-pane-choices-dark.png">
        <img src="docs/assets/screenshots/vscode-pane-choices-light.png" width="420" alt="Le panneau de leçon Studium dans VS Code sur une étape de quiz : un avis indiquant que l'apprenant a écrit la clé, l'étape 3 sur 8 consacrée à la série de Lyman, la formule de Rydberg en document de l'étape, quatre choix lettrés dont A est sélectionné, une échelle de confiance facultative de 0 à 4, un bouton Valider et un lien Indice.">
      </picture>
      <br><em>Une étape de quiz dans le panneau de leçon de VS Code ; l'avis en tête dit qui a écrit la clé de correction.</em>
    </td>
    <td width="50%" valign="top">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/vscode-pane-feedback-dark.png">
        <img src="docs/assets/screenshots/vscode-pane-feedback-light.png" width="420" alt="L'étape de retour après une réponse rédigée : un encadré « À comparer toi-même » marqué non certifié, faute de juge, les points clés, une réponse modèle repliée, le passage source cité avec son lien, quatre boutons pour évaluer son rappel et un bouton Continuer.">
      </picture>
      <br><em>Le retour après une réponse rédigée qu'aucun juge n'a évaluée : comparer aux points clés, puis évaluer son rappel.</em>
    </td>
  </tr>
</table>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/teacher-library-dark.png">
  <img src="docs/assets/screenshots/teacher-library-light.png" width="720" alt="La bibliothèque du tableau de bord enseignant : le nombre de cours, de leçons vérifiées et approuvées, puis chaque leçon avec sa langue, son auteur, ses nombres de scènes et de notions, sa durée, des badges pour ses classes de clé, un statut Vérifié et un bouton Relire.">
</picture>

<em>La bibliothèque du tableau de bord enseignant : chaque leçon, qui détient ses clés de correction et son statut de relecture.</em>

## Démarrage rapide (5 minutes)

Il vous faut git, Node 22 (Node 20 ou plus récent fonctionne) et pnpm 9. Python n'est pas nécessaire pour apprendre.

```bash
git clone https://github.com/HolobiomicsLab/studium.git
cd studium
corepack enable        # fournit la version de pnpm épinglée dans package.json
./setup.sh             # installe, construit les bibliothèques et l'extension VS Code
```

Si le clonage répond `Repository not found`, le dépôt n'est pas encore visible depuis votre compte : lancez `gh auth login` puis clonez à nouveau.

Choisissez ensuite l'une des deux surfaces.

**Dans VS Code.** Ouvrez le dossier `apps/studium-vscode`, appuyez sur F5 (fn+F5 sur Mac), puis, dans la fenêtre qui s'ouvre, lancez **Studium : Ouvrir une leçon** depuis la palette de commandes. Les leçons de démonstration de `fixtures/` fonctionnent sans clé d'API ni connexion réseau.

**Dans votre assistant IA.** Déclarez le serveur MCP de Studium construit par `setup.sh`, depuis la racine du dépôt :

```bash
# Claude Code
claude mcp add studium -e BUNDLES_ROOT="$PWD/fixtures" -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"

# Codex
codex mcp add studium --env BUNDLES_ROOT="$PWD/fixtures" -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
```

Redémarrez l'assistant et demandez : « Je veux apprendre la photosynthèse avec Studium ». L'assistant suit les instructions du serveur : il consulte votre plan d'étude, réunit des sources avec ses propres outils, construit une leçon avec `prepare_sources` et `create_lesson`, puis vous pose la première question. Votre progression est conservée dans `~/.studium/data` ; les leçons que vous créez vont dans `~/.studium/library`. Les autres harnais (Copilot, OpenCode, Cursor) sont décrits dans [Connecter un harnais](docs/start/harnesses.fr.md).

Pour aller plus loin : [démarrage rapide](docs/start/quickstart.fr.md), [installation](docs/start/installation.fr.md), [dépannage](docs/start/troubleshooting.fr.md).

## Ce qui distingue Studium

- **Un cours est un graphe.** Chaque leçon porte un graphe de parcours (*Learning Workflow Graph*) : des concepts et des tâches reliés par des arêtes typées comme `prerequisite_for` ou `assesses`. La navigation, la remédiation et la vue enseignant lisent le même graphe. Voir [Comment fonctionne Studium](docs/concepts/how-studium-works.fr.md).
- **Une évaluation honnête, dont on connaît l'origine.** Chaque leçon indique si sa clé de correction a été rédigée par un enseignant, par l'apprenant ou par un agent IA, et si un modèle juge a évalué la réponse. Sans juge, une réponse ouverte est présentée à côté de la référence pour que vous compariez vous-même ; elle ne reçoit jamais de score par mots-clés. Voir [Honnêteté et provenance](docs/concepts/honesty-and-provenance.fr.md).
- **Des leçons sourcées.** Une leçon construite à partir de vos sources cite un passage pour chaque item noté, et chaque citation doit correspondre à sa source au caractère près avant que la leçon soit écrite.
- **Des révisions espacées.** Après une leçon, Studium planifie des révisions (FSRS). Un seul appel, `get_study_plan`, dit ce qui est dû, toutes leçons confondues. Votre auto-évaluation planifie les révisions mais ne modifie jamais la maîtrise mesurée. Voir [Réviser dans la durée](docs/learn/review-over-time.fr.md).
- **Local d'abord.** L'état de l'apprenant reste sur votre machine, dans des dossiers nommés par pseudonyme, et vous pouvez l'effacer. Les rapports de classe sont agrégés, avec au moins cinq apprenants derrière chaque chiffre. Voir [Confidentialité et limites](docs/concepts/privacy-and-limits.fr.md).
- **N'importe quel harnais.** Le même contrat de séance est servi par MCP, par une API HTTP locale et par un canal fichier : Codex, Claude Code, Copilot, OpenCode ou Cursor peuvent conduire une leçon. L'assistant relaie, l'apprenant répond.

## Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/diagrams/architecture-dark.svg">
  <img src="docs/assets/diagrams/architecture-light.svg" alt="Architecture de Studium : des services Python de préparation transforment des documents ou une capsule ASB en LessonBundle et en graphe de parcours typé ; les paquets du moteur et l'hôte de séance servent les séances par MCP, HTTP et canal fichier à VS Code et aux harnais IA ; le tableau de bord enseignant et l'Observatory sont des surfaces de relecture séparées.">
</picture>

### Carte du dépôt

| Domaine | Où | Rôle |
|---|---|---|
| Clients apprenant | [`apps/studium-vscode`](apps/studium-vscode) | Extension VS Code : panneau de leçon, notebook, participant de chat, révisions dans la barre d'état |
| Hôtes | [`apps/lesson-mcp`](apps/lesson-mcp), [`packages/lesson-session-host`](packages/lesson-session-host), [`apps/lesson-server`](apps/lesson-server) | Serveur MCP (40 outils), hôte multi-séances à état durable, adaptateurs HTTP |
| Moteur adaptatif | [`packages/lesson-session`](packages/lesson-session), [`packages/adaptation-engine`](packages/adaptation-engine), [`packages/learner-state`](packages/learner-state) | Navigation selon le graphe, maîtrise, remédiation, indices, calibration, révision espacée |
| Contrats | [`packages/lesson-bundle-schema`](packages/lesson-bundle-schema), [`packages/learning-workflow-schema`](packages/learning-workflow-schema), [`packages/telemetry-events`](packages/telemetry-events) | Schémas typés (Zod, avec miroirs Pydantic) des leçons, des graphes et des événements |
| Préparation et relecture | [`services/`](services), [`tools/`](tools), [`eval/`](eval) | Planificateur Python, synthèse de scènes, ingestion, Observatory, CLI d'auteur (`tools/experience_packet.py`), banc d'évaluation |
| Surfaces enseignant et identité | [`apps/teacher-dashboard`](apps/teacher-dashboard), [`skills/`](skills), [`design/`](design) | Bibliothèque et pages de relecture enseignant, skills pour harnais, jetons et composants graphiques |

## Surfaces et maturité

| Surface | Statut | Signification |
|---|---|---|
| Tout harnais MCP (Codex, Claude Code, Copilot, OpenCode, Cursor) et le canal fichier | Supportée | Testée en CI, documentée, voie d'entrée recommandée |
| Extension VS Code (panneau de leçon, participant de chat) | Supportée | Testée en CI, VSIX construit par la CI |
| `lesson-server` (HTTP, clés de correction masquées), tableau de bord enseignant, Observatory | Maintenue | Maintenue en état de marche et testée ; peu de nouveautés |
| Application étudiante Tauri ([`apps/student-runtime`](apps/student-runtime)) | Gelée | Plus de développement ; construite seulement sur demande manuelle |
| [`apps/author-web`](apps/author-web) | Héritée | Conservée pour la démonstration M1 ; utilisez plutôt le tableau de bord enseignant |
| Panneau MCP Apps ([`apps/lesson-panel-ui`](apps/lesson-panel-ui)) et volet Claude Code ([`apps/claude-code-mod`](apps/claude-code-mod)) | Prototype | Panneaux de leçon partagés avec contrôles automatisés des contrats ; essais dans les hôtes natifs et essai formatif avec des apprenants encore à venir |

## État et limites

Studium est un prototype de recherche, en version 0.3.0. Le moteur adaptatif, les outils d'auteur, les enregistrements de provenance et le banc d'évaluation sont implémentés et testés, mais l'effet de Studium sur les apprentissages n'a pas été évalué. Un enseignant doit relire et approuver une leçon avant que des étudiants l'utilisent. Une leçon construite par un assistant IA à partir de vos sources est signalée comme rédigée par un agent et non validée par un enseignant. Sans modèle juge configuré, les réponses ouvertes sont comparées à la référence plutôt que notées. L'adaptateur HTTP expose les 25 opérations de leçon et `rate_recall` ; les autres outils d'étude et tous les outils d'auteur et enseignant n'existent que par MCP. Le workflow de version peut publier sur la Marketplace VS Code, Open VSX et npm dès que leurs jetons sont configurés ; d'ici là, une version est une release GitHub en brouillon avec le VSIX et le fichier du serveur. Les [capacités](docs/concepts/capabilities.fr.md) détaillent chaque surface.

## Une famille de projets

Studium assemble quatre projets frères du laboratoire : [Perspicacité](https://github.com/HolobiomicsLab/Perspicacite-AI) ancre les prérequis dans des passages de la littérature, [indicium](https://github.com/HolobiomicsLab/indicium) représente le graphe sous forme d'assertions liées à leurs preuves, [ASTRA](https://github.com/LightconeResearch/astra-spec) enregistre chaque décision d'adaptation pour qu'on puisse la rejouer, et [ASB](https://github.com/HolobiomicsLab/AgenticScienceBuilder) fournit les capsules de reproduction et le standard d'étape agentique.

## Licence

Le code est distribué sous [licence Apache 2.0](LICENSE). La documentation, l'identité visuelle et les leçons écrites par le projet sont sous licence [Creative Commons Attribution 4.0](LICENSES/CC-BY-4.0.txt). Les extraits de sources cités dans une leçon gardent leur propre licence, indiquée sur chaque ligne de source, et une leçon construite à partir de vos propres sources vous appartient. Le matériel pédagogique tiers utilisé par le banc d'évaluation sous `eval/corpus/` n'est pas redistribué ; son manifeste indique la licence de chaque source. Le fichier [NOTICE](NOTICE) précise quelle licence couvre quel dossier.

## Citer Studium

Si vous utilisez Studium dans un travail de recherche, citez-le avec les métadonnées de [`CITATION.cff`](CITATION.cff). GitHub en tire un bouton « Cite this repository ». Aucun DOI n'est encore attribué.

## Contribuer et sécurité

- [Contribuer](CONTRIBUTING.fr.md) : installation, contrôles qu'une modification doit passer, tests d'abord, documentation bilingue.
- [Code de conduite](CODE_OF_CONDUCT.fr.md).
- [Politique de sécurité](SECURITY.fr.md) : signaler une vulnérabilité en privé.
- [Tester Studium](TESTING.fr.md) : le parcours guidé pour un collègue qui essaie la leçon de démonstration.
- [Journal des modifications](CHANGELOG.md) (en anglais).
