[English](cursor.md) · Français

# Connecter Cursor à Studium

Ajoutez le serveur Studium à Cursor, pour que Cursor joue vos leçons avec les outils de Studium.

## Avant de commencer

- Terminez l'[installation](installation.fr.md) et lisez [Connecter votre assistant](harnesses.fr.md) : il
  explique `/path/to/studium`, `BUNDLES_ROOT` et `LITELLM_BASE_URL`.
- Lisez la [documentation MCP de Cursor](https://cursor.com/docs/mcp), qui explique comment activer les outils.

## Réaliser la tâche

1. Fusionnez ceci dans `.cursor/mcp.json` :

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

2. Activez les outils Studium comme l'explique la documentation de Cursor.

## Ce que vous obtenez

Les outils Studium sont activés dans Cursor. Pour prouver la connexion, faites la vérification de
[Connecter votre assistant](harnesses.fr.md#vérifier-la-connexion).

## Limites

Cursor utilise la clé `mcpServers`, comme Claude Code ; VS Code utilise `servers` (voir
[Copilot dans VS Code](copilot.fr.md)).
