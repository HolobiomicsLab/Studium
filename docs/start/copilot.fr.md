[English](copilot.md) · Français

# Connecter Copilot dans VS Code à Studium

Donnez le serveur Studium à Copilot Chat en mode agent, pour que Copilot construise et joue vos leçons avec
les outils de Studium. Avec l'extension Studium installée, il n'y a rien à ajouter : l'extension propose son
propre serveur à Copilot. Cette page traite du client MCP de Copilot ; le panneau de leçon de l'extension est
décrit dans [VS Code](vscode.fr.md).

## Avant de commencer

- Les étudiants peuvent obtenir Copilot par GitHub Education : demandez la vérification étudiante
  ([GitHub Education pour les étudiants](https://docs.github.com/en/education/about-github-education/github-education-for-students/apply-to-github-education-as-a-student)),
  puis activez Copilot Student dans vos paramètres Copilot
  ([configurer Copilot pour les étudiants](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students)).
  Vérification et activation sont deux étapes distinctes, et l'avantage peut mettre plusieurs jours à
  apparaître : vérifiez l'état de votre demande avant de payer. Les enseignants vérifiés ont leur propre
  parcours ([enseignants](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-teachers-and-os-maintainers)).
  Envoyez vos justificatifs à GitHub uniquement, jamais dans un dépôt de cours.
- Pour la voie sans l'extension, lisez [Connecter votre assistant](harnesses.fr.md) : il explique les deux
  façons de lancer le serveur (`npx -y studium-mcp`, ou `node` sur un fichier issu d'un clone ou d'une
  release), `/path/to/studium`, `BUNDLES_ROOT` et `LITELLM_BASE_URL`. La forme `npx` demande Node ; voir
  [Installation](installation.fr.md).

## Réaliser la tâche

### Avec l'extension Studium : ni Node, ni commande

1. Installez l'extension Studium dans VS Code 1.101 ou plus récent (la fenêtre **À propos** donne la version).
2. Ouvrez Copilot Chat et choisissez le mode agent.
3. Dans la palette de commandes, lancez **MCP: List Servers**. **Studium** figure dans la liste, fourni par
   l'extension. Démarrez-le s'il est arrêté ; VS Code peut d'abord vous demander de lui faire confiance.
4. La première fois que Copilot appelle un outil Studium, VS Code vous demande de l'autoriser. Ouvrez la
   flèche à côté de **Autoriser une fois** (**Allow Once** si VS Code est en anglais) et choisissez
   **Autoriser les outils de Studium dans cette session** (**Allow Tools from Studium in this Session**), ou
   **Toujours autoriser les outils de Studium** (**Always Allow Tools from Studium**) si vous comptez revenir.
   Sinon VS Code redemande à chaque outil, et une leçon en construction ou en cours attend votre clic. Ce
   sont les libellés de VS Code 1.139 ; un serveur ajouté à la main s'appelle `studium`.

L'extension lance le serveur qu'elle embarque avec le moteur de VS Code lui-même, le même serveur que son
panneau de leçon : aucune installation de Node, aucun terminal. Ce serveur lit le dossier de leçons du
réglage `studium.bundlesRoot` (vide : votre bibliothèque personnelle, `~/.studium/library`), écrit dans
cette bibliothèque les leçons qu'il construit, et garde la progression dans l'espace de stockage de
l'extension. Il n'appelle aucun modèle juge, sauf si `LITELLM_BASE_URL` est défini dans l'environnement d'où
VS Code a été lancé. Pour le désactiver, mettez `studium.registerMcpServer` à `false`.

**Si vous avez déjà ajouté `studium` vous-même**, avec `code --add-mcp` ou dans un `mcp.json`, l'extension
n'en ajoute pas un second : le canal de sortie **Studium — lesson-mcp** nomme le fichier qui contient le
vôtre. Copilot continue d'utiliser votre entrée. Pour passer au serveur intégré, supprimez votre entrée ;
l'extension propose alors le sien. Elle regarde le `mcp.json` de votre profil utilisateur, le
`.vscode/mcp.json` et le `.mcp.json` de chaque dossier de l'espace de travail, le
`~/.copilot/mcp-config.json` de Copilot (ou celui de `COPILOT_HOME`), et l'ancien réglage `mcp.servers`.
Un serveur ajouté dans un autre profil VS Code n'est pas vu.

### Sans l'extension

1. Ajoutez le serveur. **Avec `npx`** (sans clone), en une commande :

   ```bash
   code --add-mcp '{"name":"studium","command":"npx","args":["-y","studium-mcp"],"env":{"LITELLM_BASE_URL":""}}'
   ```

   ou fusionnez ceci dans `.vscode/mcp.json` :

   ```json
   {
     "servers": {
       "studium": {
         "type": "stdio",
         "command": "npx",
         "args": ["-y", "studium-mcp"],
         "env": { "LITELLM_BASE_URL": "" }
       }
     }
   }
   ```

   **Depuis un clone** ouvert comme espace de travail, utilisez `"command": "node"` et
   `"args": ["${workspaceFolder}/apps/studium-vscode/dist/lesson-mcp.cjs"]`.

2. Dans la palette de commandes, lancez **MCP: List Servers**, sélectionnez `studium` et démarrez-le. Son
   journal montre les erreurs.
3. Au premier appel d'outil, autorisez les outils du serveur pour la session, comme à l'étape 4 ci-dessus.

VS Code utilise la clé `servers`, pas la clé `mcpServers` de Claude Code et de Cursor. Référence :
[serveurs MCP dans VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## Ce que vous obtenez

**MCP: List Servers** affiche **Studium** (fourni par l'extension) ou `studium` (ajouté à la main) en cours
d'exécution. Pour prouver la connexion, faites la vérification de
[Connecter votre assistant](harnesses.fr.md#vérifier-la-connexion), puis demandez « je veux apprendre …
avec Studium » en nommant vos sources.

Construire la leçon prend quelques minutes ; c'est fait une fois, et vous pouvez ensuite la jouer autant de
fois que vous voulez. Avec l'extension Studium installée, VS Code montre où en est la construction :

| Quand | Ce que VS Code affiche |
|---|---|
| L'assistant a préparé ses sources | la barre d'état indique **Studium · leçon en préparation…** ; son info-bulle nomme la source et dit de répondre à l'assistant dans le chat s'il demande d'autoriser une étape |
| La leçon est écrite dans votre bibliothèque | **Studium : ta leçon « … » est prête (n étapes).** avec **Ouvrir**, **Plus tard** et **Ne plus afficher** (qui désactive le réglage `studium.notifyLessonReady`) ; la leçon apparaît dans la vue **Leçons**. Si vous étiez dans une autre fenêtre, l'avis attend votre retour dans VS Code |

En attendant, vous pouvez essayer la leçon de démonstration (**Studium : Essayer la leçon de
démonstration**). L'extension surveille votre bibliothèque, `~/.studium/library` (ou
`<STUDIUM_HOME>/library`), le dossier où le serveur Studium écrit les leçons ; elle crée ce dossier au
démarrage s'il manque. **Ouvrir** joue la leçon dans le panneau et ne modifie aucun réglage.

Avec le serveur de l'extension, Copilot propose ensuite la leçon d'abord dans le panneau Studium : son
message se termine par **Ouvre-la dans le panneau Studium**, un lien qui ouvre la leçon dans le panneau, où
chaque étape répond aussitôt. La première fois, VS Code demande si Studium peut ouvrir le lien. Dites plutôt
« ici » pour jouer la leçon dans la conversation. Quand vous demandez à Copilot quoi étudier ensuite, la leçon
à commencer ou à reprendre vient avec le même lien. Dans VS Code avant la version 1.120 environ, le lien
s'affiche comme du texte : ouvrez la leçon depuis la vue **Leçons**.

## Limites

- Le serveur intégré n'a pas été essayé dans une vraie session de VS Code avec Copilot. Ce qui a été
  vérifié : les tests de l'extension, face à une imitation de VS Code, l'enregistrent, démarrent le serveur
  qu'il décrit et relisent son dossier de leçons et son dossier de données ; et le moteur de VS Code 1.139,
  sans Node dans le chemin, a démarré le serveur embarqué, listé ses 40 outils et écrit un jeu de sources
  dans la bibliothèque.
- La documentation de VS Code dit que les définitions de serveur admissibles fournies par une extension
  peuvent être transmises aux sessions Copilot ; que les sessions d'agent propres à Copilot reçoivent
  celle-ci n'a pas été vérifié.
- Les éditeurs sans cette interface (VS Code avant 1.101, et peut-être Cursor ou d'autres dérivés, non
  essayés) n'ont pas de serveur intégré ; le canal de sortie le dit. Ajoutez-y le serveur à la main.
- Copilot et le panneau jouent le même apprenant, le réglage `studium.learnerId` (`vscode-learner` par
  défaut), et gardent la progression dans le même dossier : une leçon commencée dans l'un se poursuit dans
  l'autre à l'étape où vous en étiez, et les révisions faites dans la conversation apparaissent dans la barre
  d'état à son prochain rafraîchissement. Ils ne se suivent pas en direct : terminez ou fermez la leçon dans
  l'un avant de continuer dans l'autre. Une réponse donnée dans la conversation après avoir avancé dans le
  panneau est refusée plutôt qu'enregistrée par-dessus votre progression, et Copilot relance la leçon là où
  vous en êtes. Après avoir changé `studium.learnerId`, redémarrez **Studium** dans **MCP: List Servers**.
- La progression que Copilot gardait avant cette version, sous l'identifiant d'apprenant qu'il avait choisi
  (`anonymous` par défaut), reste sous cet identifiant : elle n'est pas transférée à l'apprenant du panneau.
- Un serveur Studium ajouté à la main ne reçoit ni l'apprenant du panneau ni le lien du panneau : il propose à
  la place son [lecteur dans le navigateur](browser.fr.md#depuis-votre-assistant). Retirez cette entrée pour
  utiliser le serveur intégré, ou définissez `STUDIUM_LEARNER_ID` et `STUDIUM_OPEN_LINK`
  (`vscode://holobiomicslab.studium-vscode/open?bundle=`) dans son `env`.
- Le lien et l'apprenant partagé ont été vérifiés face à une imitation de VS Code : le lien de Copilot, transmis
  comme le fait le code de VS Code lui-même, ouvre le panneau à l'étape de l'apprenant. Le cliquer dans une
  vraie conversation Copilot n'a pas été essayé.
- **Studium : Oublier mes données** ferme les serveurs que l'extension a lancés pour le panneau, la
  conversation et le notebook, pas celui que VS Code a lancé pour Copilot. Arrêtez d'abord **Studium** dans
  **MCP: List Servers**.
- L'état « en préparation » et l'avis de leçon prête ont été vérifiés face à une imitation de VS Code, avec le
  vrai serveur qui écrit les fichiers. Que VS Code signale les écritures dans `~/.studium/library` quand ce
  dossier n'est pas ouvert dans la fenêtre n'a pas été vu dans une vraie session. Sans avis, la vue
  **Leçons** est relue quand vous l'affichez ou revenez à la fenêtre.
- L'état « en préparation » prend fin quand arrive la leçon construite à partir de ces sources, ou au bout de
  20 minutes. Si l'assistant s'est arrêté, la leçon peut ne pas venir.
- Offres, modèles et limites sont fixés par GitHub et évoluent.
