[English](harnesses.md) · Français

# Connecter votre assistant

Studium fonctionne comme un serveur MCP que votre assistant IA lance sur votre ordinateur. Une fois la
connexion faite, vous pouvez dire « je veux apprendre X avec Studium » : l'assistant prépare, joue et
planifie vos leçons avec les outils de Studium. Cette page vous aide à choisir la page de votre client, puis
montre comment vérifier la connexion.

## Avant de commencer

Le client de l'assistant est appelé *harnais* (voir le [glossaire](../concepts/glossary.fr.md)). Terminez
l'[installation](installation.fr.md) : elle construit le fichier serveur
`apps/studium-vscode/dist/lesson-mcp.cjs` avec cette commande.

```bash
pnpm --filter studium-vscode build
```

Toutes les configurations lancent ce fichier avec `node` ; remplacez `/path/to/studium` par le chemin
absolu de votre clone. Le serveur dialogue par stdio : il n'ouvre aucun port et n'affiche aucune page web.

Vous rencontrez d'abord deux variables d'environnement :

| Réglage | Effet |
|---|---|
| `BUNDLES_ROOT` | Laissez-la absente (recommandé) : les leçons vivent dans `~/.studium/library`, la progression dans `~/.studium/data`. Avec `BUNDLES_ROOT=/path/to/studium/fixtures`, vous jouez les leçons de démonstration du dépôt ; les leçons que votre assistant prépare vont toujours dans `~/.studium/library`. |
| `LITELLM_BASE_URL=""` | Aucun modèle juge, même si votre shell en définit un (voir [Modèle juge](../reference/configuration.fr.md#modèle-juge-facultatif)). |

`STUDIUM_EPHEMERAL=1` garde la progression en mémoire seulement, pour une démonstration ou un test. Toutes
les variables sont décrites dans [Configuration](../reference/configuration.fr.md).

Les fichiers de [docs/examples](../examples/) sont des exemples complets qui ajoutent `BUNDLES_ROOT` pour les
leçons de démonstration : [codex.toml](../examples/codex.toml), [mcp.claude.json](../examples/mcp.claude.json),
[mcp.vscode.json](../examples/mcp.vscode.json) et [opencode-v2.json](../examples/opencode-v2.json).
Fusionnez-les dans le fichier de votre client, sans écraser les autres serveurs déjà déclarés.

## Choisir votre client

| Client | Où vit sa configuration | Page |
|---|---|---|
| Codex | `~/.codex/config.toml`, ou `codex mcp add` | [Connecter Codex](codex.fr.md) |
| Claude Code | `.mcp.json` à la racine du projet | [Connecter Claude Code](claude-code.fr.md) |
| Copilot dans VS Code | `.vscode/mcp.json` | [Connecter Copilot dans VS Code](copilot.fr.md) |
| OpenCode | `opencode.jsonc` à la racine du projet | [Connecter OpenCode](opencode.fr.md) |
| Cursor | `.cursor/mcp.json` | [Connecter Cursor](cursor.fr.md) |
| Un script ou un client sur mesure | aucune configuration MCP | [API HTTP](../reference/http-api.fr.md) et [canal fichiers](../reference/agentic-session-protocol.fr.md) |

## Vérifier la connexion

Une entrée de configuration, ou un skill découvert par le client, ne prouve pas que le serveur est
connecté. Demandez :

```text
Appelle l'outil Studium get_server_info et donne-moi la version, la date du build, le nombre d'outils et
si ma progression est durable. Appelle ensuite get_study_plan.
```

La réponse doit annoncer 40 outils (25 de leçon, 5 d'étude, 3 de rédaction, 2 pour l'enseignant, 1 de formulaires, 3 de panneau, 1 d'accompagnement ; voir
[Outils MCP](../reference/mcp-tools.fr.md)) et `persistence.durable: true`. Si `durable` vaut false, la
progression est perdue à l'arrêt du serveur. À la connexion, l'assistant reçoit aussi les instructions de
Studium (montrer chaque `display_markdown` tel quel, attendre votre propre réponse, ne jamais répondre ni
noter à votre place) et deux prompts, `learn` et `review`, dans les clients qui prennent en charge les
prompts MCP.

## Pour aller plus loin

- [Garder des réponses rapides](fast-answers.fr.md) : les choix qui décident du temps d'attente à chaque écran.
- [Skills](skills.fr.md) et [panneaux de leçon](harness-panels.fr.md) pour votre assistant.
- [VS Code](vscode.fr.md) pour le panneau de leçon de l'extension.
- [Dépannage](troubleshooting.fr.md) si la vérification échoue.
