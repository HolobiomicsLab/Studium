[English](installation.md) · Français

# Installation

Choisissez la voie la plus courte pour votre cas. Pour apprendre avec un assistant IA, Node suffit :
l'assistant lance le serveur Studium avec `npx`, sans clone du dépôt. Les enseignants qui préparent et
approuvent des cours, et les contributeurs, installent depuis un clone. La première séance ne demande
aucune clé d'API de modèle.

## Choisir comment vous installez

| Vous voulez | Voie | Il vous faut |
|---|---|---|
| Apprendre avec un assistant IA (Codex, Claude Code, Copilot, Cursor, OpenCode, Claude Desktop) | [Ajouter le serveur à votre assistant](#ajouter-le-serveur-à-votre-assistant) | Node |
| Apprendre dans Claude Code, avec les agents de leçon et les skills | [Installer le plugin Claude Code](#installer-le-plugin-claude-code) | Node, Claude Code 2.1.275 ou plus |
| Jouer les leçons dans un panneau visuel | [Installer l'extension VS Code](#installer-lextension-vs-code) | VS Code |
| Préparer et approuver des cours, ou contribuer | [Installer depuis un clone](#installer-depuis-un-clone) | Git, Node, pnpm ; Python pour les outils enseignant |
| Ouvrir une activité portable préparée par un enseignant | rien : ouvrez son `index.html` (voir [De l'activité au rapport](../tutorials/activity-to-report.fr.md)) | un navigateur récent |

Seul un clone vous donne :

- les leçons de démonstration de `fixtures/` ;
- les outils enseignant (Python), qui préparent, vérifient et approuvent un cours ;
- les [skills](skills.fr.md) pour les assistants autres que Claude Code (le plugin les apporte à Claude Code) ;
- l'[Observatoire](../teach/observatory.fr.md) et le tableau de bord enseignant (voir
  [Suivre une classe](../teach/follow-a-class.fr.md)).

## Prérequis

| Outil | Version | Voie | Vérification |
|---|---|---|---|
| Node | 22 LTS (20 et plus acceptés) | serveur, plugin, clone | `node --version` |
| Claude Code | 2.1.275 ou plus | plugin | `claude --version` |
| VS Code | 1.95 ou plus | extension | Aide, À propos |
| Git | récente | clone | `git --version` |
| pnpm | 9.15.9 | clone | `pnpm --version` |
| Python | 3.12 ou plus | clone, outils enseignant seulement | `python3.12 --version` |

L'extension embarque son propre serveur et ne demande pas de Node à part. Si `pnpm` manque,
`corepack enable` (fourni avec Node) ou le [guide d'installation de pnpm](https://pnpm.io/installation)
l'installe. Sur un macOS d'origine, `python3` est souvent en 3.9, trop ancien pour les outils enseignant.

## Où sont les paquets

Depuis la version 0.6.0, le serveur et l'extension sont sur des registres publics :

| Quoi | Registre | Nom |
|---|---|---|
| Serveur MCP | [npm](https://www.npmjs.com/package/studium-mcp) | `studium-mcp` |
| Serveur MCP, référencé pour les assistants | [MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.HolobiomicsLab/studium) | `io.github.HolobiomicsLab/studium` |
| Extension VS Code | [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=holobiomicslab.studium-vscode) | `holobiomicslab.studium-vscode` |
| Extension VS Code pour VSCodium, Cursor et Gitpod | [Open VSX](https://open-vsx.org/extension/holobiomicslab/studium-vscode) | `holobiomicslab.studium-vscode` |

Le plugin Claude Code n'est sur aucun registre : Claude Code le lit dans ce dépôt, qui est public. Il
lance son serveur avec `npx -y studium-mcp`.

Sur une machine qui ne peut joindre aucun registre, utilisez les deux fichiers joints à une
[release GitHub](https://github.com/HolobiomicsLab/studium/releases) :

- `lesson-mcp.cjs`, lancé avec `node /path/to/lesson-mcp.cjs` partout où cette documentation écrit
  `npx -y studium-mcp` ;
- `studium-vX.Y.Z.vsix`, installé avec `code --install-extension studium-vX.Y.Z.vsix`.

Le dépôt est public : le cloner, installer le plugin et télécharger les fichiers d'une release ne
demandent aucun compte.

## Ajouter le serveur à votre assistant

Il vous faut Node 20 ou plus. `npx` récupère le serveur la première fois ; rien d'autre à installer.
`LITELLM_BASE_URL=` (vide) indique à Studium de n'appeler aucun modèle juge, même si votre shell en
définit un.

| Assistant | Commande ou fichier |
|---|---|
| Claude Code | `claude mcp add --scope user studium -e LITELLM_BASE_URL= -- npx -y studium-mcp` |
| Codex | `codex mcp add studium --env LITELLM_BASE_URL= -- npx -y studium-mcp` |
| Copilot dans VS Code | `code --add-mcp '{"name":"studium","command":"npx","args":["-y","studium-mcp"],"env":{"LITELLM_BASE_URL":""}}'` |
| Cursor | `.cursor/mcp.json` ou `~/.cursor/mcp.json`, voir [Connecter Cursor](cursor.fr.md) |
| OpenCode | `opencode.jsonc`, voir [Connecter OpenCode](opencode.fr.md) |
| Claude Desktop | `claude_desktop_config.json`, voir [Connecter votre assistant](harnesses.fr.md#claude-desktop) |

Vérifiez le serveur lui-même :

```bash
npx -y studium-mcp --version
npx -y studium-mcp --help
```

Les deux répondent sans démarrer le serveur. Vérifiez ensuite que votre assistant est connecté :
[Connecter votre assistant](harnesses.fr.md#vérifier-la-connexion).

## Installer le plugin Claude Code

Le plugin `studium` ajoute en une étape le serveur, les douze skills de `skills/` et les deux agents de
leçon :

```bash
claude plugin install studium --marketplace HolobiomicsLab/studium
```

Dans une session, `/plugin install studium --marketplace HolobiomicsLab/studium` fait la même chose. Le nom
des skills et des agents sous le plugin, ainsi que les commandes en deux étapes, de mise à jour et de
retrait, sont dans [Connecter Claude Code](claude-code.fr.md#installer-le-plugin).

## Installer l'extension VS Code

Depuis le Visual Studio Marketplace ou Open VSX :

```bash
code --install-extension holobiomicslab.studium-vscode
```

Ou depuis un fichier de release : `code --install-extension studium-vX.Y.Z.vsix`. L'extension contient le
serveur et les moteurs de rendu. Les leçons n'y sont pas : elle lit votre bibliothèque personnelle
(`~/.studium/library`) ou le dossier que vous choisissez. Ce qu'elle propose est décrit dans
[VS Code](vscode.fr.md).

## Installer depuis un clone

Cette voie s'adresse aux enseignants qui préparent et approuvent des cours, et aux contributeurs.

### Récupérer le code et construire

```bash
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
`apps/studium-vscode/dist/lesson-mcp.cjs`. Ce second fichier est le serveur MCP Studium autonome, le même
que le `lesson-mcp.cjs` d'une release. Un assistant le lance avec `node` (voir
[Connecter votre assistant](harnesses.fr.md)) ; il ne demande pas de `tsx` global.

### Vérifier le serveur sans client

```bash
node apps/lesson-mcp/scripts/headless_smoke.mjs
```

Un client MCP minimal démarre le serveur, liste ses outils, joue une leçon fournie et affiche
`all 19 assertions passed`. Le test ne garde rien sur le disque. Il prouve que le serveur fonctionne, pas
qu'un assistant donné y est connecté.

### Autres façons de lancer le serveur

| Usage | Commande |
|---|---|
| Depuis les sources, pour développer | `pnpm --filter @studium/lesson-mcp start` |
| Fichier unique autonome | `pnpm --filter @studium/lesson-mcp bundle`, qui écrit `apps/lesson-mcp/dist/studium-mcp.cjs` |
| API HTTP locale au lieu de MCP | `pnpm --filter @studium/lesson-mcp api` (voir [API HTTP](../reference/http-api.fr.md#la-démarrer)) |

La construction et la publication d'une version sont décrites dans [Publication](../develop/release.fr.md).

### Construire l'extension VS Code

```bash
pnpm --filter studium-vscode package
code --install-extension apps/studium-vscode/studium.vsix
```

`package` copie les moteurs de rendu, construit et lance la dépendance de développement `vsce`, à version
épinglée. Un collègue peut installer le VSIX sans le dépôt. Les développeurs peuvent plutôt ouvrir
`apps/studium-vscode` dans VS Code et appuyer sur F5.

### Ajouter les outils enseignant (Python)

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

### Windows

Les commandes du clone sont écrites pour macOS et Linux. Sous Windows :

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

## Où Studium range vos leçons et votre progression

Le serveur lancé par un assistant utilise ces valeurs par défaut, quelle que soit la voie. Chacune se
change par une variable d'environnement dans la configuration de l'assistant ; la liste complète est dans
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

## Mettre à jour

| Voie | Mise à jour |
|---|---|
| Serveur avec `npx` | redémarrez l'assistant. `npx` peut réutiliser une copie déjà récupérée : `npx -y studium-mcp@latest --version` demande la plus récente à npm |
| Plugin Claude Code | `claude plugin marketplace update holobiomicslab`, puis `claude plugin update studium@holobiomicslab` |
| Extension VS Code | depuis un marketplace, VS Code la met à jour ; depuis un fichier, installez le `.vsix` plus récent |
| Clone | `git pull`, puis `./setup.sh` |

Redémarrez ou reconnectez ensuite le serveur MCP dans votre assistant. Un fichier serveur construit ou
téléchargé avant la mise à jour n'a pas les outils récents, sans autre symptôme : demandez à votre
assistant d'appeler `get_server_info`, qui indique la version, l'origine du build (`source` ou `bundled`),
sa date et la liste des outils. Une mise à jour ne touche ni vos leçons ni votre progression dans
`~/.studium`.

## Effacer vos données

Votre assistant peut effacer la progression d'une leçon avec `forget_session`, seulement si vous le
demandez ; cela efface aussi votre profil inter-leçons et votre historique d'étude (votre calendrier
de révision), sans retour possible. Si vous lui demandez d'effacer toutes vos données, il efface aussi la
progression de toutes vos leçons. Sa réponse nomme ce qui reste : les leçons de votre bibliothèque et leurs
sources préparées. Pour tout retirer de ce que le serveur côté assistant a gardé, supprimez le dossier Studium
(`~/.studium` par défaut). Dans VS Code, **Studium : Oublier mes données** efface ce que l'extension garde.
Les rapports exportés et l'historique de votre assistant sont des copies séparées. Plus de détails dans
[Vie privée et limites](../concepts/privacy-and-limits.fr.md).
