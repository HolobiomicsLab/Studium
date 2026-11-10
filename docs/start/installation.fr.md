[English](installation.md) · Français

# Installation

Installez Studium une fois depuis un clone du dépôt, puis connectez-le à votre assistant ou ouvrez les
leçons dans VS Code. Le parcours apprenant ne demande que Node ; les enseignants qui préparent des cours à
partir de la littérature ajoutent Python. La première séance utilise des leçons d'exemple locales et ne
demande aucune clé d'API de modèle.

## Choisir ce que vous installez

| Vous voulez | À installer |
|---|---|
| Apprendre avec un assistant IA (Codex, Claude Code, Copilot, OpenCode, Cursor) | Node, pnpm, le dépôt |
| Jouer les leçons dans un panneau visuel | ce qui précède, plus VS Code et l'extension Studium |
| Préparer et approuver des cours à partir de sources | ce qui précède, plus Python 3.12 et les outils enseignant |
| Ouvrir une activité portable préparée par un enseignant | un navigateur récent seulement : ouvrez son `index.html` (voir [De l'activité au rapport](../tutorials/activity-to-report.fr.md)) |

## Prérequis

| Outil | Version | Vérification |
|---|---|---|
| Git | récente | `git --version` |
| Node | 22 LTS (le dépôt accepte 20 et plus) | `node --version` |
| pnpm | 9.15.9 | `pnpm --version` |
| Python (outils enseignant seulement) | 3.12 ou plus | `python3.12 --version` |
| VS Code (panneau seulement) | 1.95 ou plus | Aide, À propos |

Si `pnpm` manque, `corepack enable` (fourni avec Node) ou le
[guide d'installation de pnpm](https://pnpm.io/installation) l'installe. Sur un macOS d'origine,
`python3` est souvent en 3.9, trop ancien pour les outils enseignant.

## Récupérer le code et construire

Le dépôt est privé : authentifiez-vous avant de cloner, sinon Git répond `Repository not found`.

```bash
gh auth login
git clone https://github.com/HolobiomicsLab/studium.git
cd studium
./setup.sh
```

`setup.sh` peut être relancé sans risque. Il vérifie Node et pnpm, installe l'espace de travail, construit
les bibliothèques, copie les moteurs de rendu hors ligne (KaTeX, Vega, 3Dmol) dans l'extension, construit
l'extension et contrôle le résultat. L'équivalent manuel :

```bash
pnpm install --frozen-lockfile
pnpm build:libs
pnpm --filter studium-vscode vendor
pnpm --filter studium-vscode build
```

La dernière commande écrit `apps/studium-vscode/dist/extension.js` et
`apps/studium-vscode/dist/lesson-mcp.cjs`. Ce second fichier est le serveur MCP Studium autonome que les
[configurations de harnais](harnesses.fr.md) lancent avec `node` ; il ne demande pas de `tsx` global.

## Vérifier le serveur sans client

```bash
node apps/lesson-mcp/scripts/headless_smoke.mjs
```

Un client MCP minimal démarre le serveur, liste ses outils, joue une leçon fournie et affiche
`all 19 assertions passed`. Le test ne garde rien sur le disque. Il prouve que le serveur fonctionne, pas
qu'un assistant donné y est connecté.

## Où Studium range vos leçons et votre progression

Le serveur lancé par un assistant utilise ces valeurs par défaut. Chacune se change par une variable
d'environnement dans la configuration du harnais ; la liste complète est dans
[Configuration](../reference/configuration.fr.md).

| Quoi | Par défaut | Variable |
|---|---|---|
| Dossier Studium | `~/.studium` | `STUDIUM_HOME` |
| Leçons préparées pour vous | `~/.studium/library` | `STUDIUM_HOME` (`BUNDLES_ROOT` ne fait qu'ajouter un dossier consulté en premier) |
| Progression et révisions durables | `~/.studium/data` | `STUDIUM_DATA_DIR` |
| Tout garder en mémoire (tests, démos) | désactivé | `STUDIUM_EPHEMERAL=1` |

Sur le disque, les dossiers d'apprenant portent un pseudonyme, jamais votre identifiant. L'extension VS Code
garde sa propre progression dans le stockage d'extension de VS Code ; voir
[VS Code](vscode.fr.md#vos-données).

## Autres façons de lancer le serveur

| Usage | Commande |
|---|---|
| Depuis les sources, pour développer | `pnpm --filter @studium/lesson-mcp start` |
| Fichier unique autonome | `pnpm --filter @studium/lesson-mcp bundle`, qui écrit `apps/lesson-mcp/dist/studium-mcp.cjs` |
| API HTTP locale au lieu de MCP | `pnpm --filter @studium/lesson-mcp api` (voir [API HTTP](../reference/http-api.fr.md#la-démarrer)) |

Une version étiquetée joint `studium-vX.Y.Z.vsix`, `lesson-mcp.cjs` et `SHA256SUMS.txt` à une release GitHub
préparée en brouillon par le workflow de publication. Rien n'est publié sur npm ni sur le Marketplace de
VS Code.

## Installer l'extension VS Code

Construisez un paquet installable depuis le dépôt, puis installez-le :

```bash
pnpm --filter studium-vscode package
code --install-extension apps/studium-vscode/studium.vsix
```

`package` copie les moteurs de rendu, construit et lance la dépendance de développement `vsce`, à version
épinglée. Le VSIX contient le serveur et les moteurs de rendu : un collègue peut l'installer sans le dépôt.
Les leçons ne sont pas dans le VSIX : l'extension lit votre bibliothèque personnelle (`~/.studium/library`)
ou le dossier que vous choisissez. Les développeurs peuvent plutôt ouvrir `apps/studium-vscode` dans
VS Code et appuyer sur F5. Ce que propose l'extension est décrit dans [VS Code](vscode.fr.md).

## Ajouter les outils enseignant (Python)

Depuis la racine du dépôt, dans un environnement virtuel (jamais le Python du système) :

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python tools/experience_packet.py --help
```

`experience_packet.py` propose `passages`, `prepare`, `check`, `bundle`, `approve` et `receipt`. Ce
dernier enregistre un reçu de relecture pour une leçon que vous renvoyez, sans l'approuver ; `approve`
refuse un verdict `to_fix` et renvoie vers lui. Continuez avec le
[guide de l'enseignant](../teach/teacher-guide.fr.md). Les bibliothèques scientifiques dont une capsule de
cours a besoin s'installent dans l'environnement propre de cette capsule, aux versions qu'elle déclare.

## Windows

Les commandes ci-dessus sont écrites pour macOS et Linux. Sous Windows :

- créez l'environnement avec `py -3.12 -m venv .venv` et remplacez `.venv/bin/python` par
  `.venv\Scripts\python.exe` ;
- en PowerShell, définissez une variable avec `$env:NOM="valeur"` avant la commande, au lieu de
  `NOM=valeur commande` ;
- `setup.sh` et le script `vendor` de l'extension utilisent des outils Unix (`mkdir -p`, `cp`) :
  construisez sous WSL, ou installez un VSIX construit ailleurs. Ne mélangez pas les `node_modules` de
  Windows et de WSL ;
- les liens de découverte de `.claude/skills` et `.agents/skills` sont des liens symboliques, qu'un clone
  Windows peut perdre ; indiquez alors directement `skills/<nom>/SKILL.md` à votre assistant.

Le parcours Windows n'a pas été exécuté de bout en bout.

## Mettre à jour

```bash
git pull
./setup.sh
```

Redémarrez ou reconnectez ensuite le serveur MCP dans votre assistant. Un `lesson-mcp.cjs` construit avant
la mise à jour n'a pas les outils récents, sans autre symptôme : demandez à votre assistant d'appeler
`get_server_info`, qui indique la version, l'origine du build (`source` ou `bundled`), sa date et la liste
des outils. Une mise à jour ne touche ni vos leçons ni votre progression dans `~/.studium`.

## Effacer vos données

Votre assistant peut effacer la progression d'une leçon avec `forget_session`, seulement si vous le
demandez ; cela efface aussi votre profil inter-leçons et votre historique d'étude (votre calendrier
de révision), sans retour possible. Si vous lui demandez d'effacer toutes vos données, il efface aussi la
progression de toutes vos leçons. Sa réponse nomme ce qui reste : les leçons de votre bibliothèque et leurs
sources préparées. Pour tout retirer de ce que le serveur côté assistant a gardé, supprimez le dossier Studium
(`~/.studium` par défaut). Dans VS Code, **Studium : Oublier mes données** efface ce que l'extension garde.
Les rapports exportés et l'historique de votre assistant sont des copies séparées. Plus de détails dans
[Vie privée et limites](../concepts/privacy-and-limits.fr.md).
