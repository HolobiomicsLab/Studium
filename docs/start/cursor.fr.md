[English](cursor.md) · Français

# Connecter Cursor à Studium

Ajoutez le serveur Studium à Cursor, pour que Cursor joue vos leçons avec les outils de Studium.

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
