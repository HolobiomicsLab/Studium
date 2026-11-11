[English](claude-code.md) · Français

# Connecter Claude Code à Studium

Ajoutez Studium à Claude Code avec le plugin ou comme simple serveur, jouez des leçons avec l'agent de
leçon et affichez où en est la leçon dans la ligne d'état.

## Avant de commencer

- Lisez [Connecter votre assistant](harnesses.fr.md) : il explique les deux façons de lancer le serveur,
  `/path/to/studium`, `BUNDLES_ROOT` et `LITELLM_BASE_URL`. Le plugin et la forme `npx` ne demandent que
  Node ; la forme clone demande l'[installation depuis un clone](installation.fr.md#installer-depuis-un-clone).
- Installez Claude Code et connectez-vous selon la [procédure officielle](https://code.claude.com/docs/en/setup).

## Réaliser la tâche

### Installer le plugin

Le plugin est la voie recommandée. Il apporte en une étape le serveur (lancé avec `npx -y studium-mcp`),
les douze skills de `skills/` et les deux agents de leçon. Avec Claude Code 2.1.275 ou plus :

```bash
claude plugin install studium --marketplace HolobiomicsLab/studium
```

Dans une session : `/plugin install studium --marketplace HolobiomicsLab/studium`. La même chose en deux
étapes :

```bash
claude plugin marketplace add HolobiomicsLab/studium
claude plugin install studium@holobiomicslab
```

| Tâche | Commande |
|---|---|
| Mettre à jour | `claude plugin marketplace update holobiomicslab`, puis `claude plugin update studium@holobiomicslab` |
| Retirer | `claude plugin uninstall studium@holobiomicslab` |

D'après la documentation des plugins de Claude Code, les skills et les agents d'un plugin portent le nom du
plugin : les skills s'invoquent par `/studium:<skill-name>` (par exemple `/studium:studium-harness`), et
les agents s'appellent `studium:studium-lesson` et `studium:studium-explainer`. Claude Code lit le plugin
dans ce dépôt : tant que le dépôt est privé, l'installer demande d'y avoir accès (voir
[Où sont les paquets](installation.fr.md#où-sont-les-paquets)).

### Ajouter seulement le serveur

Sautez cette étape si vous avez installé le plugin : il déclare déjà le serveur.

**Avec `npx`** (sans clone), pour tous les projets de votre compte utilisateur :

```bash
claude mcp add --scope user studium -e LITELLM_BASE_URL= -- npx -y studium-mcp
claude mcp list
```

**Depuis un clone**, pour ce projet seulement :

1. Depuis votre clone, lancez :

   ```bash
   claude mcp add --scope project studium -e LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
   claude mcp list
   ```

2. `--scope project` écrit `.mcp.json` à la racine du projet, sous cette forme :

   ```json
   {
     "mcpServers": {
       "studium": {
         "type": "stdio",
         "command": "node",
         "args": ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"],
         "env": { "LITELLM_BASE_URL": "" }
       }
     }
   }
   ```

3. Dans une session, `/mcp` montre la connexion. Pour une exécution non interactive, passez le fichier de
   configuration et autorisez explicitement les outils Studium :

   ```bash
   claude -p --mcp-config .mcp.json --strict-mcp-config \
     --allowedTools "mcp__studium__*" --permission-mode dontAsk --max-budget-usd 2 \
     "Appelle get_server_info, puis get_study_plan, et montre-moi le résultat."
   ```

### Utiliser l'agent de leçon

Le plugin installe deux agents ; un clone contient aussi leurs définitions dans `.claude/agents/`. `studium-lesson` joue une leçon ou une
révision en relais strict sur le modèle rapide : il montre chaque écran tel que Studium l'a écrit, envoie
vos mots et n'ajoute rien. `studium-explainer` est un modèle plus fort qu'il appelle quand votre question
demande une vraie explication ; la leçon continue pendant que l'explication s'écrit. Son texte s'ouvre par
« Explication générée », pour que vous le distinguiez de celui de la leçon. L'agent de leçon ouvre une
leçon sur la meilleure surface que votre client sait afficher (un panneau ou un volet, des formulaires, ou
la conversation). Quand vous revenez vers lui après y avoir joué, il lit d'abord ce que vous avez fait,
pour ne pas vous remontrer un écran. Un client qui affiche les MCP Apps peut montrer le panneau même quand
la leçon se joue dans la conversation ou en formulaires : le panneau le dit alors (« Cette leçon se joue dans
la conversation », « Le panneau n'est pas la surface négociée pour cette séance. ») et ne dessine ni
scène ni contrôle de réponse, pour que vous répondiez là où la leçon se joue. Son bouton « Jouer ici »,
présent quand votre client sait afficher le panneau, demande au serveur de passer la séance sur le panneau.

Avec le plugin :

```bash
claude --agent studium:studium-lesson
```

Depuis le clone :

```bash
claude --agent studium-lesson
```

Sans le plugin, pour les utiliser depuis n'importe quel dossier, liez-les une fois à vos agents
personnels :

```bash
mkdir -p ~/.claude/agents
ln -s "$PWD/.claude/agents/studium-lesson.md" "$PWD/.claude/agents/studium-explainer.md" ~/.claude/agents/
```

Dans un dossier qui ne sert qu'à étudier, `{"agent": "studium-lesson"}` dans `.claude/settings.json` fait de
chaque session une session de leçon (`studium:studium-lesson` avec le plugin). Dans une session déjà ouverte, `/model haiku` le temps de la leçon
apporte l'essentiel du même gain. Ne demandez pas à un grand modèle de confier chaque réponse à l'agent
(voir [Garder des réponses rapides](fast-answers.fr.md)).

### Afficher la ligne d'état

La ligne d'état demande un clone : le script est un fichier du dépôt, que ni le plugin ni le paquet npm
ne fournissent.

En mode durable, Studium note où en est la leçon dans `status.json`, dans votre dossier d'apprenant, à
chaque écran et à chaque réponse. Le script `tools/studium_statusline.mjs` en affiche la ligne, celle qui
termine chaque écran :

```text
Les atomes · étape 2/3 · 3 min · à toi de répondre
```

La ligne tient en 80 caractères au plus. Un long titre de leçon est coupé avant son dernier séparateur qui
tient (« Atomistique L1 — Chapitre 1 (atomes, orbitales) » devient « Atomistique L1 — Chapitre 1 »), pour ne
pas changer d'un écran à l'autre. Pendant les questions de vérification d'une notion que vous avez contestée,
l'étape laisse la place à « contrôle 1/2 » (« check 1/2 » dans une leçon en anglais).

Pour l'afficher dans la ligne d'état de Claude Code, ajoutez ceci à `~/.claude/settings.json` :

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /path/to/studium/tools/studium_statusline.mjs"
  }
}
```

Le script ne demande aucune installation et n'affiche rien quand aucune leçon n'est en cours : séance
fermée, serveur arrêté, ou progression gardée en mémoire seulement (`STUDIUM_EPHEMERAL=1`), où rien n'est
écrit. Il trouve le dossier de données comme le serveur (`STUDIUM_DATA_DIR`, sinon `<STUDIUM_HOME>/data`) ;
`--data-dir=DOSSIER` en désigne un autre. Si vous avez donné `STUDIUM_DATA_DIR` ou `STUDIUM_HOME` au serveur
dans `.mcp.json`, donnez le même au script. Avec plusieurs leçons ouvertes sur une machine, il montre celle
qui a bougé en dernier, dans toutes les fenêtres de Claude Code.

## Ce que vous obtenez

Dans une session, `/mcp` affiche le serveur Studium ; `claude mcp list` affiche `studium` si vous l'avez
ajouté avec `claude mcp add`. Pour prouver la connexion, faites la vérification de
[Connecter votre assistant](harnesses.fr.md#vérifier-la-connexion).

## Limites

Cette configuration vise Claude Code, pas l'application de bureau Claude ; pour l'application, voir
[Claude Desktop](harnesses.fr.md#claude-desktop).
