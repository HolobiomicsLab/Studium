[English](README.md) · Français

# Exemples

De petits exemples aboutis à ouvrir, jouer ou copier : une leçon d'auto-apprentissage construite à
partir d'un texte classique, cinq modèles d'activité interactive, un parcours de la littérature à la
visionneuse, et des demandes de médias et de supports visuels. Ce sont des supports pour essayer
Studium, pas des programmes validés.

| | |
|---|---|
| Statut | **maintenus** (plusieurs servent d'entrées aux tests des outils) |
| Lancer | chaque exemple l'indique dans son README ou dans l'outil qui le lit |
| Tests | `.venv/bin/python -m pytest tools` exerce les modèles, la visionneuse de littérature et l'exemple d'auto-apprentissage |

Pour les leçons utilisées par les suites de tests et les démonstrations, voir
[`fixtures/`](../fixtures/README.fr.md).

## Index

| Exemple | Ce qu'il montre | Par où commencer |
|---|---|---|
| [`self-study-durkheim/`](self-study-durkheim/README.fr.md) | une leçon d'auto-apprentissage en français, terminée (environ 18 minutes, quatre scènes), construite à partir du chapitre I des *Règles de la méthode sociologique* de Durkheim, avec ses passages et sa réponse d'auteur | [README](self-study-durkheim/README.fr.md) |
| [`activity-templates/`](activity-templates) | cinq modèles d'activité prêts, recensés dans `manifest.json` : représentations liées, comparaison contrôlée de paramètres, preuve et affirmation, diagnostic d'une analyse erronée, robustesse d'une conclusion ; `viewer.html` les affiche | `.venv/bin/python tools/experience_templates.py list` |
| [`literature-experience/`](literature-experience) | des passages capturés et une réponse d'auteur pour une activité appuyée sur la littérature, et un explorateur de spectres construit par l'hôte (`build-viewer.mjs`, `viewer.html`) | `.venv/bin/python tools/demo-literature-experience.py <nouveau dossier>` |
| [`archaeology/`](archaeology/README.md) | le modèle `evidence-claim` appliqué à une photographie de musée, qui distingue traits visibles, notices du catalogue et interprétations | [README](archaeology/README.md) (en anglais) |
| [`media/`](media/README.md) | une demande de média indépendante du fournisseur : une consigne d'enseignant avec ses références sources et un contrat de sortie attendu | [README](media/README.md) (en anglais) |
| [`visual-support/`](visual-support) | des fragments d'artefacts pour un support adapté : une équation, une figure, une carte conceptuelle Mermaid et un support de robustesse en anglais et en français | à lire avec [Langue et supports](../docs/learn/language-and-supports.fr.md) |

## Jouer la leçon d'auto-apprentissage

Dans VS Code, faites un clic droit sur `self-study-durkheim/lesson.json` et choisissez **Studium : Ouvrir
cette leçon**. Avec un assistant, réglez `BUNDLES_ROOT` sur le chemin absolu de ce dossier `examples/`
dans la configuration de son serveur Studium (voir [Connecter un assistant](../docs/start/harnesses.fr.md)),
puis demandez-lui de démarrer `self-study-durkheim/lesson.json`.

## Voir aussi

- [S'auto-former à partir de références](../docs/tutorials/self-study-from-references.fr.md)
- [Modèles d'activité](../docs/teach/activity-templates.fr.md)
- [Médias et supports visuels](../docs/teach/media-and-visual-support.fr.md)
