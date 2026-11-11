[English](README.md) · Français

# Studium pour VS Code

Suivez une leçon adaptative Studium dans VS Code : lisez chaque scène avec ses figures, équations,
graphiques et molécules, répondez dans le panneau, recevez le retour après votre réponse et voyez quelles
notions sont à réviser. L'extension est un client MCP léger de [`apps/lesson-mcp`](../lesson-mcp/README.fr.md) ;
elle n'ajoute aucun serveur.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../docs/assets/screenshots/vscode-pane-choices-dark.png">
  <img src="../../docs/assets/screenshots/vscode-pane-choices-light.png" width="420" alt="Le panneau de leçon Studium dans VS Code, avec une question à choix multiple et ses boutons de réponse">
</picture>

| | |
|---|---|
| Statut | **pris en charge** (décision D6) |
| Lancer (développement) | `pnpm --filter studium-vscode build`, puis F5 dans VS Code |
| Installer | `pnpm --filter studium-vscode package`, puis `code --install-extension apps/studium-vscode/studium.vsix` |
| Port | aucun : le serveur tourne comme processus enfant sur stdio |
| Appelle | le serveur de leçons embarqué (`dist/lesson-mcp.cjs`), ou le serveur source dans un clone |
| Tests | `pnpm --filter studium-vscode test` (vérification de types et 23 pilotes sans interface) |

Guide d'utilisation : [Studium dans VS Code](../../docs/start/vscode.fr.md).

## Surfaces

- **Panneau de leçon** (`studium.openLesson`) : une webview (`media/artifact-pane.{js,css}`) qui affiche
  chaque scène avec ses artefacts et recueille la réponse. Le retour forme une étape à part ; un écran de
  fin propose les actions de révision.
- **Notebook de leçon** (`studium.openLessonNotebook`) : chaque exécution de la cellule pilote fait
  avancer la leçon d'un tour et affiche la scène en sortie de cellule.
- **Choix du cours** (`studium.pickLesson`) : trouve un dossier de leçons, mémorise le cours choisi pour
  l'espace de travail et l'ouvre, sans modifier `settings.json`.
- **Participant de chat** (`@studium`) : une leçon tour par tour dans le panneau de chat, avec `/hint` et
  `/discuss`. Il affiche le texte du serveur pour chaque étape et envoie ce que vous tapez sous la forme
  `{kind: "reply", text}` ; le serveur le traduit dans l'entrée de la scène (une lettre, une confiance, vos
  mots) ou dit qu'il n'a pas pu le lire, et le chat rappelle alors comment répondre à cette scène.

Le panneau, le chat et le notebook lancent le serveur de leçons de la même façon, sur le même stockage d'apprenant.

```
 VS Code extension host ── MCP client ──▶ lesson-mcp (stdio) ──▶ lesson-session engine
        │                                                          (adaptive loop, mastery, graders)
        ├─▶ WebviewPanel  ◀── postMessage ──  media/artifact-pane.{js,css}
        └─▶ NotebookController ── cell output ──  src/notebook.ts
```

À chaque tour, l'extension récupère la scène courante (expurgée par le serveur) et
`get_scene_artifacts`, les présente, renvoie la réponse par `submit_response`, `submit_turn` ou
`request_hint`, puis affiche la scène suivante. Le panneau traite les actions de l'apprenant une à une,
désactive les contrôles pendant un tour en cours, garde les erreurs récupérables à côté de la scène et
ferme une connexion qui finit de s'ouvrir après la fermeture du panneau. Un échec au démarrage indique
le canal de sortie et la commande à relancer. Quand une action atteint une séance que le serveur ne
connaît plus (`session not found`), l'extension passe ce motif au panneau, qui remplace la scène par
« Séance perdue » et un bouton « Rouvrir la leçon » ; ce bouton ferme le panneau et ouvre la même leçon
dans un nouveau (avec un stockage durable, l'apprenant reprend où il en était).

## Commandes

Les titres, les descriptions des paramètres et le nom de la vue suivent la langue d'affichage de VS Code
(anglais dans `package.nls.json`, français dans `package.nls.fr.json`). Les identifiants ne changent
jamais.

| Commande | Identifiant | Effet |
|---|---|---|
| Studium : Choisir un cours | `studium.pickLesson` | choisir un cours trouvé ou un autre dossier de leçons, les mémoriser dans l'espace de travail, ouvrir la leçon |
| Studium : Ouvrir une leçon | `studium.openLesson` | le panneau de leçon |
| Studium : Ouvrir la leçon en notebook | `studium.openLessonNotebook` | la surface notebook |
| Studium : Ouvrir cette leçon | `studium.openThisLesson` | aussi dans les menus de l'explorateur et de l'onglet sur un `lesson.json` ; l'ouvre sans toucher aux paramètres |
| Studium : Contributions de la classe | `studium.communityContributions` | ouvrir les bundles rédigés par des pairs et approuvés par l'enseignant, dans le dossier `community/` du cours |
| Studium : Exécuter la reproduction (capsule de la scène courante) | `studium.runReproduction` | exécuter la capsule de la scène courante, après confirmation |
| Studium : Rafraîchir la vue des leçons | `studium.refreshLessons` | relire les cours et les révisions |
| Studium : Prise en main | `studium.openWalkthrough` | le parcours de prise en main |
| Studium : Oublier mes données | `studium.forgetMyData` | après confirmation, effacer ce que l'extension conserve dans VS Code |

**Oublier mes données** ferme d'abord chaque serveur de leçon lancé par l'extension (panneaux de leçon,
chat, séances de notebook, rafraîchissement de l'état) et attend qu'il s'arrête, pour qu'aucun ne réécrive
son état ; une leçon demandée entre-temps attend la fin de l'effacement. La commande efface ensuite la
progression et l'état des révisions dans le dossier de stockage de l'extension, les cours auxquels vous avez fait confiance et la dernière leçon mémorisée. Les données
qu'un assistant (Claude Code, Codex) conserve dans `<STUDIUM_HOME>/data` (par défaut `~/.studium/data`)
sont nommées dans la confirmation et laissées intactes. Dans une leçon, **M'oublier** dans le menu
*Options de la leçon* du panneau (ou la directive `forget` du notebook) appelle `forget_session` après
confirmation. `end_session` ferme une séance et garde son état ; fermer un panneau ou un notebook ne coupe
que la connexion, la progression enregistrée est conservée.

## Paramètres

| Paramètre | Valeur par défaut | Rôle |
|---|---|---|
| `studium.repoRoot` | la racine du monorepo de l'extension | où se trouvent `lesson-mcp` et le `tsx` de pnpm |
| `studium.bundlesRoot` | le `fixtures/` d'un clone, sinon `~/.studium/library` | `BUNDLES_ROOT` contre lequel le serveur résout `bundleRef` ; `STUDIUM_HOME` déplace la bibliothèque |
| `studium.bundleRef` | `atomistique-l1/lesson.json` | le cours courant ; sans valeur mémorisée, Ouvrir une leçon lance le choix du cours |
| `studium.communityBundlesRoot` | la valeur de `bundlesRoot` | racine parcourue pour les contributions |
| `studium.assets` | `vendor` | `vendor` (hors ligne, `media/vendor`) ou `cdn` (jsdelivr) |
| `studium.learnerId` | `vscode-learner` | sel du pseudonyme de l'apprenant |
| `studium.telemetryConsent` | `false` | accepter l'envoi de télémétrie de classe consentie et pseudonymisée ; progression et révisions restent sur l'appareil dans tous les cas |
| `studium.showGraph` | `true` | ouvrir le panneau compagnon du graphe de parcours en direct |
| `studium.graphView` | `student` | portée du graphe : `student` (vue centrée) ou `teacher` (graphe complet) |
| `studium.showMastery` | `false` | afficher la barre de maîtrise par notion (démo enseignant seulement : elle peut trahir les réponses) |
| `studium.modalityPreference` | `balanced` | ordre des artefacts `visual`, `textual` ou `balanced` |

## Scènes et artefacts

Chaque type de scène du schéma de bundle est branché sur les deux surfaces, affiché et répondu avec le
type de réponse qu'attend son correcteur (les correcteurs aiguillent sur `scene.type` et refusent un type
de réponse qui ne correspond pas).

| Type de scène | Ce que fait l'apprenant | Réponse |
|---|---|---|
| `intro`, `concept` | lire | continuer (`ack`) |
| `quiz` | choisir une réponse, demander un indice | `quiz_choice` |
| `meta_checkpoint` | déclarer sa confiance de `0` à `4` | `confidence` |
| `reproduction` | suivre le protocole ; voir l'exécution de référence | `ack` |
| `ai_critique` | critiquer une production d'IA (texte libre) | `critique` |
| `spot_the_flaw` | nommer les erreurs glissées | `flaw_report` |
| `explain_back` | réexpliquer l'idée | `explanation` |
| `comparison` | nommer les différences entre les artefacts A et B | `comparison` |
| `summary_audit` | auditer un résumé d'IA (omissions, déformations) | `summary_audit` |
| `prompt_practice` | écrire ou affiner un prompt pour la tâche | `prompt_submission` |
| `communication_sim` | rédiger un message professionnel pour le scénario | `communication` |
| `discussion` | dialogue socratique en plusieurs tours | `submit_turn` plusieurs fois, puis `ack` |

Les corrigés (`claims`, `key_points`, indicateurs `correct`, `model_*`) sont retirés par le serveur avant
que la scène n'atteigne le panneau.

Les raccourcis par lettre et par chiffre fonctionnent quand le focus est dans la liste des choix ; le
panneau l'indique sous les choix (« Dans la liste des choix : A–C ou 1 à 3 pour choisir, Entrée pour
valider. », ou « Dans l'échelle : 0 à 4 » pour un point de confiance).

Le panneau affiche le manifeste `scene_assets[]` selon le type : `image`, `svg`, `equation_latex` (KaTeX),
`plot_spec` (Vega-Lite), `code`, `data_csv`, `protocol_md`, la carte `executed_result` (figure,
vérifications notées, repère, provenance de la capsule), ainsi que `orbital`, `mol_3d` (3Dmol) et
`spectrum` (Vega). Si une bibliothèque manque, le rendu se dégrade (équation en code mis en forme,
graphique en barres SVG, 3D en note légendée). marked, KaTeX, Vega, 3Dmol et Cytoscape sont copiés dans
`media/vendor` et chargés localement par défaut.

Le texte des leçons est en Markdown GFM et passe par une liste blanche DOM locale. Les mathématiques en
ligne et en bloc (`$…$`, `$$…$$`, `\(…\)`, `\[…\]`) et mhchem sont rendues par KaTeX ; le code reçoit une
coloration hors ligne pour Python, JavaScript/TypeScript, SQL, Bash et JSON. Les images Markdown relatives
affichent pour l'instant une légende « image non résolue ».

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../docs/assets/screenshots/vscode-pane-feedback-dark.png">
  <img src="../../docs/assets/screenshots/vscode-pane-feedback-light.png" width="420" alt="Le retour affiché comme une étape à part après une réponse rédigée : marqué non certifié faute de juge, avec les points clés, la réponse modèle, la source citée et les quatre boutons d'auto-évaluation">
</picture>

## Retour, révisions et adaptation

- **Le retour** vient après la réponse. ✓ n'apparaît que sur une réponse jugée juste, ✗ que sur une
  réponse jugée fausse ; une réponse que personne n'a évaluée est affichée comme enregistrée. Sans modèle
  juge, une réponse ouverte est présentée avec la référence à comparer ; l'auto-évaluation (« Je ne savais
  pas », « Difficile », « Bien », « Facile ») programme les révisions mais ne modifie jamais la maîtrise.
  Après une mauvaise réponse à un quiz, le bon choix apparaît sous « La bonne réponse » une fois la question
  quittée. Une source citée affiche sa licence après son titre quand la leçon en indique une.
- **Les révisions** : au démarrage, à la fermeture ou à la fin d'une leçon, et sur Rafraîchir,
  l'extension demande au serveur ce qui est dû (`get_next_reinforcement`). La barre d'état affiche alors
  **Studium · 2 à réviser** quand toutes les notions en attente sont des révisions dues, sinon
  **Studium · 3 à travailler** ; son info-bulle et la barre latérale séparent les groupes (à réviser, à
  reprendre, pas encore mesurées) ou donnent la prochaine date de révision. Un clic ouvre la barre latérale
  Studium. Sans historique, rien ne s'affiche.
- **L'écran de fin** : les notions consolidées, les notions travaillées (avec leur nombre de réponses
  notées) et celles pas encore mesurées, puis la prochaine date de révision et les actions de révision.
- **Préférence de modalité** : réordonne et met en avant les artefacts de chaque scène côté `visual` ou
  `textual` ; rien n'est masqué.
- **Verdict de calibration** : une incitation sans chiffre en cas de sur- ou sous-confiance
  ([`src/calibration.ts`](src/calibration.ts)).
- **Graphe de parcours en direct** (`studium.showGraph`) : un panneau Cytoscape compagnon, redessiné à
  chaque tour.

## D'une conversation au panneau

Une leçon qu'un assistant construit pour vous arrive dans votre bibliothèque personnelle
(`~/.studium/library`, ou `STUDIUM_HOME/library`), le dossier de leçons par défaut d'une extension
installée. Pour l'ouvrir, l'assistant peut lancer

```bash
code --open-url "vscode://holobiomicslab.studium-vscode/open?bundle=<chemin encodé du lesson.json>"
```

ou vous pouvez faire un clic droit sur le `lesson.json` et choisir **Studium : Ouvrir cette leçon**. Un
lien doit désigner un chemin absolu, sans `..`, vers un fichier `.json` existant ; sinon il est refusé et
rien ne s'ouvre. Si la fenêtre se recharge pendant une leçon, le panneau est restauré et la leçon reprend.

## Vos données, et ce qui s'exécute

- **Où elles sont.** Progression et révisions sont écrites dans le stockage d'extension de VS Code propre
  à l'utilisateur (`globalStorageUri`), jamais dans le dossier des leçons, quel que soit le paramètre de
  télémétrie.
- **Limites de taille.** Pour nommer les notions par leur titre, l'extension lit un `lesson.json` d'au plus
  8 Mo, ou un `.zip` communautaire d'au plus 32 Mo dont le `lesson.json` décompressé ne dépasse pas 8 Mo ;
  au-delà, elle ne lit rien et le panneau affiche les identifiants des notions. Le serveur de leçons
  applique la même limite de 8 Mo à un `lesson.json` zippé.
- **Lancer une reproduction.** Avant qu'une commande du bundle ne s'exécute, une fenêtre montre la
  commande exacte, les paquets à installer et le dossier ; rien ne démarre avant **Exécuter** ou
  **Exécuter et faire confiance à ce cours** (mémorisé pour cette version exacte du bundle, par
  empreinte). Un `working_dir` absolu ou contenant `..` est refusé. Un `landmark_pattern` est borné avant
  compilation et chaque recherche est limitée à 50 ms.

Directives de la cellule pilote du notebook : vide ou `next` pour continuer ; un identifiant de choix
(`a`, `b`…) pour répondre à un quiz ; `0` à `4` pour la confiance ; du texte libre pour une scène
d'apprentissage actif ou un tour de discussion ; `hint` pour un indice ; `forget` pour effacer vos
données de séance.

## Développer

1. Copier une fois les bibliothèques de rendu : `pnpm --filter studium-vscode vendor`.
2. Construire : `pnpm --filter studium-vscode build` (écrit `dist/extension.js` et `dist/lesson-mcp.cjs`).
3. Ouvrir ce dossier dans VS Code et appuyer sur F5 (hôte de développement d'extension).
4. Lancer **Studium : Choisir un cours**, ou utiliser le nœud **Cours** de la barre d'activité Studium.
   La découverte accepte `<bundlesRoot>/<cours>/lesson.json` et les fichiers `*.json` à la racine.

## Construire un VSIX

```bash
pnpm --filter studium-vscode package        # copie les bibliothèques, construit, puis empaquette avec un @vscode/vsce épinglé
code --install-extension apps/studium-vscode/studium.vsix
```

L'extension demande VS Code 1.95 ou plus récent. Le VSIX contient `dist/lesson-mcp.cjs` et les moteurs de
rendu, il fonctionne donc sans clone ni `tsx` global. Les leçons ne sont pas dans le VSIX : sans clone,
l'extension lit votre bibliothèque personnelle ; sinon réglez `studium.bundlesRoot` et `studium.bundleRef`,
ou utilisez **Studium : Choisir un cours**. Dans un clone, elle préfère le serveur source et le
`fixtures/` du clone. `studium.vsix` est un artefact de construction local, pas une publication sur le
Marketplace. Un client MCP natif et le panneau de l'extension ouvrent des séances séparées ; ils ne
partagent pas la scène courante. L'installation est décrite dans le
[guide d'installation](../../docs/start/installation.fr.md).

La page que montrent le Marketplace et Open VSX est [`MARKETPLACE.md`](MARKETPLACE.md), écrite pour la
personne qui installe l'extension, en anglais puis en français ; `package` la donne à `vsce` et ce README
reste hors du VSIX. Une page de registre ne peut pas suivre un lien relatif : renvoyez à la branche
`main` de ce dépôt par adresse complète, images comprises (le pilote `contributes` le contrôle). Les fichiers d'une version sont construits par
[`tools/release/build.sh`](../../tools/release/build.sh) ; voir
[Publication](../../docs/develop/release.fr.md).

## Tests

```bash
pnpm --filter studium-vscode test          # tsc --noEmit et les 23 pilotes enregistrés
```

| Pilote | Couvre |
|---|---|
| `extension-host` | l'hôte d'extension face à un faux module `vscode` et au vrai `lesson-mcp` : lien et « Ouvrir cette leçon », restauration du panneau, stockage sans consentement, confirmation d'exécution et confiance mémorisée, refus d'un `working_dir`, navigation, auto-évaluation, fin de leçon, révision et redémarrage, oubli des données |
| `run-trust`, `lesson-uri`, `study-status`, `data-paths`, `host-phrases`, `pane-messages` | les briques pures (empreinte et texte de consentement, analyse des liens, mise en forme des révisions, dossier de leçons par défaut, parité fr/en, validation des messages) |
| `contributes` | le manifeste : chaque `%clé%` existe dans les deux fichiers nls, parcours, événements d'activation, menus, vue d'accueil, icône |
| `scene-io` | le contrat scène vers type de réponse (doit correspondre aux correcteurs) et le portage de la calibration |
| `webview-pane` | rendu réel de `media/artifact-pane.js` dans jsdom : chaque type de scène, messages envoyés, aucune clé `model_*` dans le DOM, et un passage axe-core (WCAG 2.x A/AA) |
| `lesson-walk` | de bout en bout : lance le vrai `lesson-mcp` et parcourt chaque type de scène avec les vrais correcteurs jusqu'à `complete` |
| `community`, `modality`, `review-fsrs`, `lesson-tree`, `lesson-picker` | découverte, ordre des modalités, parité FSRS, arbre des cours |
| `panel-lifecycle`, `mcp-connect`, `chat-format`, `context-help`, `asset-path`, `run-task` | nettoyage après fermeture tardive, actions exclusives, échec de connexion, sortie de chat, aide, chemins d'artefacts, tâches d'exécution |
| `completion` | la répartition de fin de leçon (consolidées, travaillées, pas encore mesurées) et la prochaine révision après une auto-évaluation |

Les pilotes qui lancent `lesson-mcp` n'écrivent jamais dans votre dossier personnel :
[`src/driver-isolation.ts`](src/driver-isolation.ts) dirige `STUDIUM_HOME` vers un dossier temporaire,
fixe `STUDIUM_EPHEMERAL=1`, dirige `HOME` vers un dossier témoin vide et échoue si quelque chose y
apparaît. jsdom ne dessine pas : le contraste des couleurs est vérifié à part par
`node design/scripts/check-contrast.mjs`, et un thème d'éditeur personnalisé reste à regarder dans
VS Code. La sortie de cellule du notebook n'est vérifiée qu'au typage ; essayez-la à la main avec F5.
