[English](opencode.md) · Français

# Connecter OpenCode à Studium

Ajoutez le serveur Studium à OpenCode, pour qu'OpenCode joue vos leçons avec les outils de Studium.

## Avant de commencer

- Lisez [Connecter votre assistant](harnesses.fr.md) : il explique les deux façons de lancer le serveur
  (`npx -y studium-mcp`, ou `node` sur un fichier issu d'un clone ou d'une release), `/path/to/studium`,
  `BUNDLES_ROOT` et `LITELLM_BASE_URL`. La forme `npx` ne demande que Node ; voir
  [Installation](installation.fr.md).
- Installez OpenCode et configurez un fournisseur selon la
  [documentation OpenCode v2](https://opencode.ai/v2/docs) et sa [page MCP](https://opencode.ai/v2/docs/mcp-servers).

## Réaliser la tâche

1. Pour OpenCode v2, fusionnez ceci dans `opencode.jsonc` à la racine du projet. **Avec `npx`** (sans
   clone) :

   ```json
   {
     "mcp": {
       "servers": {
         "studium": {
           "type": "local",
           "command": ["npx", "-y", "studium-mcp"],
           "environment": { "LITELLM_BASE_URL": "" }
         }
       }
     }
   }
   ```

   **Depuis un clone**, utilisez `"command": ["node", "/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]`.

2. Lancez `opencode mcp list` pour voir la connexion.

## Ce que vous obtenez

`opencode mcp list` affiche `studium`. Pour prouver la connexion, faites la vérification de
[Connecter votre assistant](harnesses.fr.md#vérifier-la-connexion). L'exemple complet est
[opencode-v2.json](../examples/opencode-v2.json).

## Limites

- Les versions antérieures d'OpenCode utilisent une autre forme de configuration.
- Un modèle ouvert proposé par votre fournisseur n'est par défaut ni gratuit, ni local, ni de qualité
  équivalente.
