[English](TESTING.md) · Français

# Tester Studium

Cette page s'adresse à un collègue qui essaie Studium sans les auteurs à ses côtés. En une vingtaine de minutes, vous suivez dans VS Code une leçon adaptative de chimie de première année (atomistique), puis vous nous dites ce qui est juste, faux ou manquant. Aucune clé d'API n'est nécessaire, ni aucune connexion réseau une fois l'installation faite : les bibliothèques de rendu sont copiées localement.

La leçon de démonstration et son guide détaillé sont en français. Les développeurs qui cherchent les suites de tests liront plutôt [Tests (développement)](docs/develop/testing.fr.md).

## Ce que vous testez

Vous avancez concept par concept et débloquez le suivant en montrant que vous maîtrisez celui en cours. En chemin, vous manipulez des objets scientifiques générés (orbitales atomiques en 3D, spectre d'émission de l'hydrogène, tendances périodiques, molécules en 3D) pendant qu'un graphe de la leçon se met à jour au fil de votre progression. Après une réponse, le retour s'affiche comme une étape à part ; à la fin, un écran de clôture propose les révisions à venir.

## Prérequis

| Il vous faut | Pourquoi | Comment |
|---|---|---|
| macOS ou Linux, avec VS Code | La leçon s'affiche dans un panneau de VS Code ; `setup.sh` est un script bash | [code.visualstudio.com](https://code.visualstudio.com) |
| Node 22 (Node 20 ou plus récent fonctionne) | Construit et lance l'extension | [nodejs.org](https://nodejs.org) |
| pnpm 9 | Installe le workspace | `corepack enable` (fourni avec Node) |
| Un accès au dépôt | Le clonage doit réussir | `gh auth login` si le clonage répond `Repository not found` |

Python n'est pas nécessaire pour la leçon. Il ne sert qu'au banc d'évaluation facultatif et au rapport de classe de l'enseignant, et demande Python 3.12 ou plus récent (le `python3` livré avec macOS est trop ancien).

## Installer

```bash
git clone https://github.com/HolobiomicsLab/studium.git
cd studium
corepack enable
./setup.sh
```

`setup.sh` vérifie vos outils, installe le workspace, construit les bibliothèques dont le serveur de leçon a besoin, copie les bibliothèques de rendu pour un usage hors ligne, construit l'extension et contrôle le résultat. Sa dernière ligne indique l'étape suivante. Vous pouvez le relancer sans risque.

## Lancer la leçon

1. Dans VS Code, choisissez **Fichier > Ouvrir le dossier…** et ouvrez `apps/studium-vscode`.
2. Appuyez sur **F5** (sur Mac, **fn+F5** si F5 est une touche multimédia). Une seconde fenêtre s'ouvre, intitulée `[Extension Development Host]` : c'est là que vous testez.
3. Ouvrez la palette de commandes (`Cmd+Maj+P` sur Mac, `Ctrl+Maj+P` ailleurs) et lancez **Studium : Ouvrir une leçon**.

L'extension ouvre `fixtures/atomistique-l1` sans aucun réglage à modifier. Votre progression est conservée d'une séance à l'autre ; lancez **Studium : Oublier mes données** pour tout reprendre de zéro.

## Suivre le guide

- [`fixtures/atomistique-l1/GUIDE-TEST-ELISE.md`](fixtures/atomistique-l1/GUIDE-TEST-ELISE.md) : la Partie 2 est la visite côté étudiant, scène par scène ; la Partie 3 est le côté enseignant ; la Partie 4 reprend les questions ci-dessous.
- [`apps/studium-vscode/README.md`](apps/studium-vscode/README.md) : les commandes, réglages et types de scènes de l'extension.

Côté enseignant, la Partie 3 du guide utilise `tools/class_report.py` pour produire hors ligne un rapport de classe agrégé et anonyme ; aucune application web n'est nécessaire.

Vous préférez essayer avec votre propre assistant IA ? Le [README](README.fr.md#depuis-un-clone-avec-les-leçons-de-démonstration) déclare le même serveur dans Claude Code ou Codex.

## Les retours que nous attendons

- **Justesse scientifique.** Les énoncés, bonnes réponses, retours et valeurs numériques sont-ils justes ?
- **Pédagogie.** L'ordre des concepts, les prérequis et les questions conviennent-ils à des étudiants de première année ?
- **Objets scientifiques.** Les orbitales, le spectre de Balmer, les tendances périodiques et les molécules en 3D sont-ils exacts et utiles ? Que manque-t-il pour vos étudiants ?
- **Retour et honnêteté.** Voit-on clairement qui a rédigé la clé de correction, et ce qui a été évalué ou non ?
- **Graphe enseignant.** La vue `teacher` du graphe reflète-t-elle votre logique de prérequis ?
- **Rapport de classe.** Désigne-t-il les bons concepts à retravailler ? Les signaux d'indices et de calibration vous seraient-ils utiles ?
- **Types de scènes.** Manque-t-il un type d'activité pour ce que vous voulez faire faire à vos étudiants ?
- **Accessibilité.** Pouvez-vous terminer la leçon au clavier seul, en thème clair comme en thème sombre ?

Envoyez vos retours par le formulaire d'issue **Tester feedback** sur GitHub (en français ou en anglais), ou par courriel à Louis-Félix Nothias, `louisfelix.nothias@gmail.com`. N'y incluez pas de données personnelles d'étudiants.

## Dépannage

| Symptôme | Solution |
|---|---|
| Le clonage échoue avec `Repository not found` | Lancez `gh auth login`, puis clonez à nouveau : c'est un problème d'accès, pas un dépôt absent |
| `setup.sh` signale une version de Node ou de pnpm trop ancienne | Installez Node 22, lancez `corepack enable`, puis relancez `./setup.sh` |
| Une orbitale ou une équation s'affiche en texte brut | Recopiez les bibliothèques de rendu : `pnpm --filter studium-vscode vendor` |
| Rien ne se passe avec F5 | Vérifiez que le dossier ouvert est `apps/studium-vscode`, pas la racine du dépôt |
| Vous voulez recommencer la leçon | Lancez **Studium : Oublier mes données** |

D'autres cas sont traités dans le [dépannage](docs/start/troubleshooting.fr.md).

## Hors du périmètre de ce test

La surface testée est VS Code. Vous n'avez pas à construire les autres applications : l'application étudiante Tauri (`apps/student-runtime`, gelée, demande Rust), `author-web` (héritée) et le tableau de bord enseignant. Inutile aussi de lancer `pnpm -r build` : `setup.sh` ne construit que ce dont la leçon a besoin.
