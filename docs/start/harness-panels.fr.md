[English](harness-panels.md) · Français

# Panneaux de leçon dans votre assistant

Studium peut afficher une leçon dans un panneau à côté de la conversation, avec le texte de la leçon, les contrôles de réponse, les retours, vos dates de révision et l'écran de fin. Cette page dit où un panneau s'affiche et comment en ouvrir un. Pour vérifier un hôte ou en ajouter un, les développeurs lisent [Panneaux de leçon pour les développeurs](../develop/panels.fr.md).

## Où un panneau s'affiche

| Où vous travaillez | Ce que vous voyez | Comment c'est vérifié |
|---|---|---|
| VS Code avec l'extension Studium | Un volet | Tests automatisés du volet |
| Codex Desktop compatible MCP Apps | Un panneau | Test automatisé de l'initialisation et d'une action ; pas encore essayé dans l'application |
| Claude Code (terminal, onglet Code, extension) | Un volet natif fourni par le mod Claude Code de `apps/claude-code-mod` (un mod est un module complémentaire de Claude Code) | Tests automatisés du mod ; pas encore essayé dans l'application |
| claude.ai ou Claude Desktop, en connecteur distant | Un panneau sur Streamable HTTP | Non proposé : le service distant et son exposition relèvent d'une décision du propriétaire |
| Un assistant qui n'affiche que du texte | La conversation | Les outils de panneau existent, mais aucun panneau n'est affiché |

Le même moteur d'affichage dessine le panneau dans VS Code et dans MCP Apps. Le mod Claude Code montre la même vue de leçon avec des composants natifs. Aucun panneau n'a encore été essayé dans les vraies applications Codex Desktop ou Claude.

## Avant de commencer

- Installez et connectez le serveur Studium comme dans [Connecter votre assistant](harnesses.fr.md). Son fichier serveur `apps/studium-vscode/dist/lesson-mcp.cjs` porte les panneaux.
- Après une mise à jour, recompilez avec `./setup.sh`, ou seulement le serveur avec `pnpm --filter studium-vscode build`.

## Ouvrir une leçon dans un panneau

1. Demandez à votre assistant d'ouvrir la leçon dans un panneau. L'assistant appelle `open_lesson_panel`.
2. Studium choisit la meilleure surface que votre client sait afficher et la nomme dans la vue qu'il renvoie (`surface` : `rank`, `kind` et les genres `available`).
3. Répondez dans le panneau. Tant qu'il est ouvert, l'assistant vous attend.

## La surface sur laquelle la leçon se joue

| Rang | Surface | Studium l'utilise quand |
|---|---|---|
| 3 | `panel`, un panneau MCP Apps | le client annonce `io.modelcontextprotocol/ui` |
| 3 | `pane`, un volet natif | le client demande `surface: "pane"` (le mod Claude Code et l'extension VS Code le font) |
| 2 | `form`, des formulaires affichés par le client | le client déclare l'élicitation |
| 1 | `text`, la conversation | toujours |

Pour rester dans la conversation, demandez `surface: "text"`. Une surface que le client ne sait pas afficher retombe sur la meilleure en dessous. Aux rangs 2 et 1, le résumé écrit pour le modèle dit comment continuer : `play_in_forms`, ou relayer le texte de `get_current_scene`. `get_panel_view` accepte le même champ `surface` ; sans lui, une séance garde la surface sur laquelle elle a été ouverte.

## Ce que propose le panneau MCP

- Un sélecteur de cours, et l'effacement de vos données après une confirmation explicite.
- Un graphe du voisinage de votre concept actuel ; cliquer sur un nœud en affiche le libellé localement.
- Pour une reproduction de capsule, un message indiquant que le terminal VS Code est nécessaire.

## Limites

- Studium n'ouvre aucun endpoint public et n'installe aucun connecteur. La route du connecteur distant n'est pas offerte aux utilisateurs.
- Les panneaux n'ont que des vérifications automatisées, comme l'indique le tableau.
