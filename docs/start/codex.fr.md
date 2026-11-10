[English](codex.md) · Français

# Connecter Codex à Studium

Ajoutez le serveur Studium à Codex, pour que Codex prépare, joue et planifie vos leçons avec les outils de
Studium.

## Avant de commencer

- Terminez l'[installation](installation.fr.md) et lisez [Connecter votre assistant](harnesses.fr.md) : il
  explique `/path/to/studium`, `BUNDLES_ROOT` et `LITELLM_BASE_URL`.
- Installez Codex et connectez-vous selon le [démarrage Codex](https://learn.chatgpt.com/docs/quickstart) ;
  les options MCP sont dans [MCP dans Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Réaliser la tâche

1. Ajoutez le serveur depuis votre clone :

   ```bash
   codex mcp add studium --env LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
   codex mcp list
   ```

2. Ou fusionnez ceci dans `~/.codex/config.toml` :

   ```toml
   [mcp_servers.studium]
   command = "node"
   args = ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]

   [mcp_servers.studium.env]
   LITELLM_BASE_URL = ""
   ```

3. Répondez aux demandes d'approbation dans une session interactive, ou lancez en mode non interactif avec
   `codex exec --approve-for-me` (incompatible avec `-s/--sandbox`). Pour un essai ponctuel avec un autre
   dossier de leçons, passez tout par `-c` :

   ```bash
   codex exec --approve-for-me --skip-git-repo-check -C /path/to/workdir \
     -c 'mcp_servers.studium.command="node"' \
     -c 'mcp_servers.studium.args=["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]' \
     -c 'mcp_servers.studium.env={BUNDLES_ROOT="/path/to/lessons",LITELLM_BASE_URL=""}' \
     - < prompt.md
   ```

## Ce que vous obtenez

`codex mcp list` affiche `studium`. Pour prouver la connexion, faites la vérification de
[Connecter votre assistant](harnesses.fr.md#vérifier-la-connexion).

## Limites

- Un profil Codex avec `approval_policy = "never"` refuse tout appel à un serveur MCP stdio local
  (`MCP tool call requires approval, but approval policy is never`).
- Le serveur Studium n'écrit que dans son dossier de données ; il n'exécute jamais lui-même une capsule.
