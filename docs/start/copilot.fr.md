[English](copilot.md) · Français

# Connecter Copilot dans VS Code à Studium

Ajoutez le serveur Studium à Copilot Chat en mode agent, pour que Copilot joue vos leçons avec les outils de
Studium. Cette page traite du client MCP de Copilot ; le panneau de leçon de l'extension est décrit dans
[VS Code](vscode.fr.md).

## Avant de commencer

- Lisez [Connecter votre assistant](harnesses.fr.md) : il explique les deux façons de lancer le serveur
  (`npx -y studium-mcp`, ou `node` sur un fichier issu d'un clone ou d'une release), `/path/to/studium`,
  `BUNDLES_ROOT` et `LITELLM_BASE_URL`. La forme `npx` ne demande que Node ; voir
  [Installation](installation.fr.md).
- Copilot Chat en mode agent lit les serveurs MCP dans le `.vscode/mcp.json` de l'espace de travail, ou
  dans votre configuration utilisateur quand vous passez par `code --add-mcp`. Pour la forme clone, ouvrez
  le clone comme espace de travail.
- Les étudiants peuvent obtenir Copilot par GitHub Education : demandez la vérification étudiante
  ([GitHub Education pour les étudiants](https://docs.github.com/en/education/about-github-education/github-education-for-students/apply-to-github-education-as-a-student)),
  puis activez Copilot Student dans vos paramètres Copilot
  ([configurer Copilot pour les étudiants](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students)).
  Vérification et activation sont deux étapes distinctes, et l'avantage peut mettre plusieurs jours à
  apparaître : vérifiez l'état de votre demande avant de payer. Les enseignants vérifiés ont leur propre
  parcours ([enseignants](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-teachers-and-os-maintainers)).
  Envoyez vos justificatifs à GitHub uniquement, jamais dans un dépôt de cours.

## Réaliser la tâche

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

VS Code utilise la clé `servers`, pas la clé `mcpServers` de Claude Code et de Cursor. Référence :
[serveurs MCP dans VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

## Ce que vous obtenez

**MCP: List Servers** affiche `studium` en cours d'exécution. Pour prouver la connexion, faites la
vérification de [Connecter votre assistant](harnesses.fr.md#vérifier-la-connexion).

## Limites

- Le panneau de leçon de l'extension Studium lance son propre serveur. Le client MCP de Copilot et le panneau
  ne partagent pas la scène courante : pilotez une leçon depuis l'un des deux à la fois. Voir
  [VS Code](vscode.fr.md).
- Offres, modèles et limites sont fixés par GitHub et évoluent.
