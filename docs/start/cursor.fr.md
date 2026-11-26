[English](cursor.md) · Français

# Connecter Cursor à Studium

Ajoutez le serveur Studium à Cursor, pour que Cursor joue vos leçons avec les outils de Studium.

## Avec l'extension VS Code : un clic, sans Node

Avec l'extension Studium pour VS Code installée, il ne faut ni terminal ni Node :

1. Dans VS Code, lancez **Studium : Relier un assistant…** depuis la palette de commandes et cochez **Cursor** (la
   vue **Leçons** vide en donne aussi le lien).
2. Redémarrez Cursor, puis activez les outils de Studium comme l'explique la documentation de Cursor.
3. Demandez à Cursor : « je veux apprendre … avec Studium », en indiquant vos sources.

La commande écrit une entrée `studium` dans `~/.cursor/mcp.json` (tous les projets), et rien d'autre ; le fichier précédent est gardé à côté sous
`<fichier>.studium-backup`. L'entrée lance le serveur Studium que l'extension contient, avec l'exécutable de VS Code
lui-même, et utilise le même dossier de leçons, la même progression et le même apprenant que le panneau Studium. La leçon est proposée dans votre
[navigateur](browser.fr.md#depuis-votre-assistant). Une entrée `studium` écrite par vous
n'est remplacée que si vous dites oui. Chaque mise à jour de Studium réécrit l'entrée ; **Studium : Délier un
assistant…** la retire, et la désinstallation de l'extension aussi, pour autant que VS Code exécute son étape de
désinstallation.

Vérifié le 26 novembre 2026 sous macOS : Cursor n'était pas installé sur l'ordinateur d'essai : l'entrée a la forme donnée plus bas sur cette page, et les tests de l'extension la vérifient, mais elle n'a pas encore été essayée dans Cursor.

Les sections ci-dessous installent le serveur à la main.

## Avant de commencer

- Lisez [Connecter votre assistant](harnesses.fr.md) : il explique les deux façons de lancer le serveur
  (`npx -y studium-mcp`, ou `node` sur un fichier issu d'un clone ou d'une release), `/path/to/studium`,
  `BUNDLES_ROOT` et `LITELLM_BASE_URL`. La forme `npx` ne demande que Node ; voir
  [Installation](installation.fr.md).
- Lisez la [documentation MCP de Cursor](https://cursor.com/docs/mcp), qui explique comment activer les outils.

## Réaliser la tâche

1. Fusionnez ceci dans `.cursor/mcp.json` (ce projet) ou `~/.cursor/mcp.json` (tous vos projets).
   **Avec `npx`** (sans clone) :

   ```json
   {
     "mcpServers": {
       "studium": {
         "type": "stdio",
         "command": "npx",
         "args": ["-y", "studium-mcp"],
         "env": { "LITELLM_BASE_URL": "" }
       }
     }
   }
   ```

   **Depuis un clone**, utilisez `"command": "node"` et
   `"args": ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]`.

2. Activez les outils Studium comme l'explique la documentation de Cursor.

## Ce que vous obtenez

Les outils Studium sont activés dans Cursor. Pour prouver la connexion, faites la vérification de
[Connecter votre assistant](harnesses.fr.md#vérifier-la-connexion).

## Limites

Cursor utilise la clé `mcpServers`, comme Claude Code ; VS Code utilise `servers` (voir
[Copilot dans VS Code](copilot.fr.md)).
