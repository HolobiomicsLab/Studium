[English](README.md) · Français

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/hero-dark.svg">
    <img src="docs/assets/hero-light.svg" width="880" alt="Studium : des leçons adaptatives, fondées sur la connaissance. Pour les enseignants, les étudiants et les autodidactes.">
  </picture>
</p>

# Studium

Studium transforme des sources que vous jugez fiables en leçons adaptatives, à suivre dans VS Code ou avec votre propre assistant IA. Chaque réponse dit qui a rédigé la clé de correction et si quelque chose l'a évaluée.

[eDIAM](https://ediam.cnrs.fr/) · Institut de Chimie de Nice · Université Côte d'Azur · CNRS · [HolobiomicsLab](https://holobiomicslab.cnrs.fr/)

## Commencer ici

Studium a deux parties. Savoir laquelle fait quoi évite de chercher :

| Partie | Ce qu'elle fait | Ce qu'elle ne fait pas |
|---|---|---|
| **Votre assistant IA**, relié au serveur Studium | construit une leçon à partir des sources que vous indiquez, vous pose ses questions dans la conversation, ramène les idées les jours suivants | répondre à votre place |
| **L'extension VS Code** | affiche une leçon dans un panneau, avec ses figures, ses équations et ses révisions | construire une leçon : sur une machine neuve, sa vue **Leçons** reste vide tant qu'un assistant n'en a pas construit une |

Une nouvelle leçon commence donc toujours dans un assistant.

### 1. Relier votre assistant

Il vous faut Node 20 ou plus (`node --version`). Lancez une fois la ligne de votre assistant, puis
redémarrez-le :

| Assistant | Commande |
|---|---|
| Claude Code | `claude mcp add --scope user studium -e LITELLM_BASE_URL= -- npx -y studium-mcp` |
| Codex | `codex mcp add studium --env LITELLM_BASE_URL= -- npx -y studium-mcp` |
| Copilot dans VS Code, mode agent | `code --add-mcp '{"name":"studium","command":"npx","args":["-y","studium-mcp"],"env":{"LITELLM_BASE_URL":""}}'` |

Cursor, OpenCode et Claude Desktop, ainsi que le plugin Claude Code qui apporte aussi les skills, sont sur
la page [Installation](docs/start/installation.fr.md). `LITELLM_BASE_URL=` (vide) empêche Studium
d'appeler un modèle payant. Quel modèle utiliser, avec un abonnement Copilot ou un modèle sur votre
machine : [Choisir son modèle](docs/start/models.fr.md).

### 2. Demander une leçon

Dans une nouvelle conversation, avec vos mots :

> Je veux apprendre comment fonctionne le cycle de l'eau avec Studium. Sers-toi de ces deux pages : (deux
> liens en lesquels vous avez confiance).

L'assistant construit une leçon à partir de vos sources, vous en montre le plan, puis pose la première
question. Vous répondez ; il transmet vos mots. La leçon est enregistrée dans `~/.studium/library` et votre
progression dans `~/.studium/data`. Chaque étape est décrite dans
[Apprendre avec votre assistant](docs/learn/learn-with-your-assistant.fr.md).

### 3. La jouer dans VS Code (facultatif)

```bash
code --install-extension holobiomicslab.studium-vscode
```

Ouvrez l'icône **Studium** dans la barre d'activité : la leçon construite par votre assistant est dans la
vue **Leçons** (utilisez son bouton de rafraîchissement si VS Code était déjà ouvert), sauf si vous avez
choisi un autre dossier de leçons. Vous pouvez aussi demander à l'assistant d'ouvrir la leçon dans VS Code.
Le panneau garde sa propre progression, distincte de celle de la conversation. Voir
[VS Code](docs/start/vscode.fr.md#obtenir-votre-première-leçon).

### Si vous êtes un assistant IA qui aide quelqu'un avec Studium

Ces étapes sont écrites pour vous.

1. Vérifiez Node : `node --version` doit afficher 20 ou plus.
2. Déclarez le serveur avec la ligne de l'étape 1 qui correspond à votre harnais. Laissez
   `LITELLM_BASE_URL` vide sauf si la personne demande un modèle juge : une valeur non vide est une route
   payante.
3. Après le redémarrage, prouvez la connexion en appelant `get_server_info` : il renvoie la version et la
   liste des outils. Un fichier de configuration n'est pas une preuve.
4. Appelez `get_study_plan` avec un `learner_id` stable et la langue de la personne. Son `next_step` nomme
   l'appel suivant ; sans leçon, il vous envoie vers `get_authoring_guide`, puis `prepare_sources` et
   `create_lesson`.
5. L'apprenant répond et vous transmettez : ne répondez, ne choisissez et ne notez jamais à sa place, et ne
   lisez pas le corrigé d'une leçon. Affichez chaque `display_markdown` tel quel.
6. Une leçon que vous rédigez n'est pas approuvée par un enseignant : transmettez l'avis de son premier
   écran.

Le serveur répète ces règles dans ses propres instructions à la connexion. Détails :
[Connecter votre assistant](docs/start/harnesses.fr.md), le skill
[`studium-harness`](skills/studium-harness/SKILL.md) et les [outils MCP](docs/reference/mcp-tools.fr.md).
Pour modifier le code de Studium, lisez plutôt [`AGENTS.md`](AGENTS.md).

## Choisir son parcours

| Je veux… | Commencer ici | Ce que vous obtenez |
|---|---|---|
| Apprendre seul un sujet avec un assistant IA | [Apprendre avec votre assistant](docs/learn/learn-with-your-assistant.fr.md) | Une leçon construite à partir des sources choisies, puis des révisions espacées les jours suivants |
| Étudier dans une classe | [Guide étudiant](docs/learn/student-guide.fr.md) | Une leçon approuvée par l'enseignant, dans VS Code ou dans votre assistant, avec un retour après chaque réponse |
| Enseigner | [Guide enseignant](docs/teach/teacher-guide.fr.md) | Une leçon sourcée, un enregistrement d'approbation lié à son contenu exact et un rapport de classe agrégé |
| Construire sur Studium | [Architecture](docs/develop/architecture.fr.md) et [outils MCP](docs/reference/mcp-tools.fr.md) | Les contrats du moteur, les 40 outils MCP et le format des leçons |

Le [portail de la documentation](docs/index.fr.md) classe toutes les pages par rôle. Les mêmes pages se construisent en un site avec
un menu, une recherche, les deux langues et les thèmes clair et sombre, lisible sans réseau :
`node tools/docs/build-site.mjs --out site`, puis ouvrez `site/fr/index.html`.

<table>
  <tr>
<td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/vscode-pane-choices-dark.png"><img src="docs/assets/screenshots/vscode-pane-choices-light.png" width="420" alt="Le panneau de leçon Studium dans VS Code sur une étape de quiz : un avis indiquant que l'apprenant a écrit la clé, l'étape 3 sur 8 consacrée à la série de Lyman, la formule de Rydberg en document de l'étape, quatre choix lettrés dont A est sélectionné, une échelle de confiance facultative de 0 à 4, un bouton Valider et un lien Indice."></picture><br><em>Une étape de quiz dans le panneau de leçon de VS Code ; l'avis en tête dit qui a écrit la clé de correction.</em></td>
<td width="50%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/vscode-pane-feedback-dark.png"><img src="docs/assets/screenshots/vscode-pane-feedback-light.png" width="420" alt="L'étape de retour après une réponse rédigée : un encadré « À comparer toi-même » marqué non certifié, faute de juge, les points clés, une réponse modèle repliée, le passage source cité avec son lien, quatre boutons pour évaluer son rappel et un bouton Continuer."></picture><br><em>Le retour après une réponse rédigée qu'aucun juge n'a évaluée : comparer aux points clés, puis évaluer son rappel.</em></td>
  </tr>
</table>

## Depuis un clone, avec les leçons de démonstration

Ce parcours est pour les enseignants et les contributeurs, et vous donne les leçons de démonstration. Prévoyez un quart d'heure environ. Il vous faut git, Node 22 et pnpm 9. Python n'est pas nécessaire pour apprendre.

```bash
git clone https://github.com/HolobiomicsLab/studium.git
cd studium
corepack enable        # provides the pnpm version pinned in package.json
./setup.sh             # installs, builds the libraries and the VS Code extension
```

Si le clonage répond `Repository not found`, le dépôt n'est pas encore visible depuis votre compte : lancez `gh auth login` puis clonez à nouveau.

**Dans VS Code.** Installez l'extension avec les deux commandes ci-dessous, puis lancez **Studium : Choisir un cours** et choisissez le dossier `fixtures` pour les leçons de démonstration, qui n'exigent aucune clé d'API. Les contributeurs peuvent appuyer sur F5 dans `apps/studium-vscode`. Voir [VS Code](docs/start/vscode.fr.md) et [Installation](docs/start/installation.fr.md).

```bash
pnpm --filter studium-vscode package
code --install-extension apps/studium-vscode/studium.vsix
```

**Dans votre assistant IA.** Déclarez, depuis la racine du dépôt, le serveur Studium construit par `setup.sh` (MCP est le protocole par lequel un assistant appelle des outils). `LITELLM_BASE_URL=` (vide) indique à Studium de n'utiliser aucun modèle juge, même si votre shell en définit un.

```bash
# Claude Code
claude mcp add --scope project studium -e LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"

# Codex
codex mcp add studium --env LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
```

Redémarrez l'assistant et demandez : « Je veux apprendre la photosynthèse avec Studium ». L'assistant demande des sources, construit une leçon, puis vous pose la première question. Votre progression est conservée dans `~/.studium/data` ; les leçons que vous créez vont dans `~/.studium/library`. Copilot, OpenCode et Cursor sont décrits dans [Connecter votre assistant](docs/start/harnesses.fr.md). Pour aller plus loin : [démarrage rapide](docs/start/quickstart.fr.md) et [dépannage](docs/start/troubleshooting.fr.md).

## Ce qui distingue Studium

- **Un cours est un graphe.** Chaque leçon relie ses concepts par leurs prérequis ; navigation, remédiation et vue enseignant le lisent. [Comment fonctionne Studium](docs/concepts/how-studium-works.fr.md)
- **Une évaluation honnête, dont on connaît l'origine.** Chaque leçon dit qui a rédigé la clé de correction et si un modèle juge a évalué la réponse. [Honnêteté et provenance](docs/concepts/honesty-and-provenance.fr.md)
- **Des leçons sourcées.** Chaque item noté cite un passage, et chaque citation doit correspondre à sa source au caractère près.
- **Des révisions espacées.** Studium planifie les révisions (FSRS) ; votre auto-évaluation ne modifie jamais la maîtrise mesurée. [Réviser dans la durée](docs/learn/review-over-time.fr.md)
- **Local d'abord.** L'état de l'apprenant reste sur votre machine, sous pseudonyme, et vous pouvez l'effacer. [Confidentialité et limites](docs/concepts/privacy-and-limits.fr.md)
- **N'importe quel harnais.** Un seul contrat de séance sur MCP, une API HTTP locale et un canal fichier ; l'assistant relaie, l'apprenant répond.

## État et limites

Studium est un prototype de recherche, en version 0.6.0. Le moteur adaptatif, les outils d'auteur, les enregistrements de provenance et le banc d'évaluation sont implémentés et testés, mais l'effet de Studium sur les apprentissages n'a pas été évalué. Un enseignant doit relire et approuver une leçon avant que des étudiants l'utilisent. Une leçon construite par un assistant IA à partir de vos sources est signalée comme rédigée par un agent et non validée par un enseignant. Sans modèle juge configuré, les réponses ouvertes sont comparées à la référence plutôt que notées. L'adaptateur HTTP expose les 25 opérations de leçon et `rate_recall` ; les autres outils d'étude et tous les outils d'auteur et enseignant n'existent que par MCP. Le workflow de version peut publier sur la Marketplace VS Code, Open VSX et npm dès que leurs jetons sont configurés ; d'ici là, une version est une release GitHub en brouillon avec le VSIX et le fichier du serveur.

- [Capacités, surfaces et maturité](docs/concepts/capabilities.fr.md#surfaces-et-maturité) : ce que fait chaque surface et jusqu'où elle est prise en charge.
- [Architecture et carte du dépôt](docs/develop/architecture.fr.md) : le schéma, chaque application, paquet et service.
- Captures de la [bibliothèque enseignant](docs/teach/teacher-guide.fr.md) et de la [carte des notions](docs/learn/concept-map.fr.md).

## Une famille de projets

Studium assemble quatre projets frères du laboratoire : [Perspicacité](https://github.com/HolobiomicsLab/Perspicacite-AI) ancre les prérequis dans des passages de la littérature, [indicium](https://github.com/HolobiomicsLab/indicium) représente le graphe sous forme d'assertions liées à leurs preuves, [ASTRA](https://github.com/LightconeResearch/astra-spec) enregistre chaque décision d'adaptation pour qu'on puisse la rejouer, et [ASB](https://github.com/HolobiomicsLab/AgenticScienceBuilder) fournit les capsules de reproduction et le standard d'étape agentique.

## Qui fait Studium

Studium est développé par le [HolobiomicsLab](https://holobiomicslab.cnrs.fr/), au sein de l'[équipe eDIAM](https://ediam.cnrs.fr/) (Équipe d'Intelligence Artificielle pour les Sciences Moléculaires) de l'Institut de Chimie de Nice (ICN, UMR 7272), Université Côte d'Azur et CNRS.

Nous remercions l'[EUR Spectrum](https://spectrum.univ-cotedazur.fr/), école universitaire de recherche en sciences fondamentales et ingénierie d'Université Côte d'Azur, pour son soutien. Studium est né de questions d'enseignement soulevées autour de l'école.

## Licence

Le code est distribué sous [licence Apache 2.0](LICENSE). La documentation, l'identité visuelle et les leçons écrites par le projet sont sous licence [Creative Commons Attribution 4.0](LICENSES/CC-BY-4.0.txt). Les extraits de sources cités dans une leçon gardent leur propre licence, indiquée sur chaque ligne de source, et une leçon construite à partir de vos propres sources vous appartient. Le matériel pédagogique tiers utilisé par le banc d'évaluation sous `eval/corpus/` n'est pas redistribué ; son manifeste indique la licence de chaque source. Le fichier [NOTICE](NOTICE) précise quelle licence couvre quel dossier.

## Citer Studium

Si vous utilisez Studium dans un travail de recherche, citez-le avec les métadonnées de [`CITATION.cff`](CITATION.cff). GitHub en tire un bouton « Cite this repository ». Aucun DOI n'est encore attribué.

## Contribuer et sécurité

[Signaler un problème ou contribuer](docs/start/report-and-contribute.fr.md) · [Contribuer](CONTRIBUTING.fr.md) · [Code de conduite](CODE_OF_CONDUCT.fr.md) · [Politique de sécurité](SECURITY.fr.md) · [Tester Studium](TESTING.fr.md) · [Journal des modifications](CHANGELOG.md) (en anglais)
