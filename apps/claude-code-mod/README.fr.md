# Panneau Studium pour Claude Code

Ce plugin Claude Code ajoute un panneau de leçon Studium natif, relié au serveur MCP `studium-lesson`. Il enregistre `/studium` au démarrage d'une session sans ouvrir d'interface tant que l'utilisateur ne le demande pas.

## Charger le plugin

Depuis la racine du dépôt, lancer Claude Code avec le répertoire du plugin :

```sh
claude --plugin-dir "$PWD/apps/claude-code-mod"
```

Le même répertoire peut être ajouté à une valeur `CLAUDE_CODE_PLUGIN_DIRS` existante :

```sh
export CLAUDE_CODE_PLUGIN_DIRS="$PWD/apps/claude-code-mod${CLAUDE_CODE_PLUGIN_DIRS:+:$CLAUDE_CODE_PLUGIN_DIRS}"
claude
```

La session doit disposer d'un serveur MCP nommé `studium-lesson`. Ouvrir une leçon avec `/studium <bundle_ref>`. Une fois la leçon active, `/studium` rouvre son panneau. Les scènes qui demandent du texte libre utilisent `/studium answer <texte>` ; les choix, indices, révisions, redémarrages, autoévaluations et effacements utilisent les boutons du panneau. L'effacement exige deux pressions.

## Surfaces et contenu

Le panneau utilise les éléments natifs de Claude Code dans le terminal, l'application de bureau, VS Code et l'application mobile. Il affiche le titre et la progression, la prose Markdown de la scène, les choix et actions disponibles, le retour et les indices, les sources, le bilan de fin, ainsi que les états d'information et d'erreur. Le contenu courant est atténué pendant une action MCP. Les images PNG sont rendues dans le terminal, seule surface qui expose actuellement l'élément natif `Image` ; chaque surface affiche tout de même le titre et le type de chaque support.

Le panneau HTML du navigateur reste le moteur visuel le plus riche. Le panneau natif conserve le Markdown et les blocs de code, mais laisse les équations `$…$` sous forme de texte et ne rend ni KaTeX, ni graphiques Vega, ni graphes interactifs, ni contenu 3D, ni HTML arbitraire. Le texte libre et les échanges passent par `/studium answer`, car les surfaces mobile et VS Code ne partagent pas encore d'élément de saisie natif. Le plugin accepte uniquement le contrat versionné `studium/panel-view/1` et refuse proprement les vues stockées ou MCP incompatibles.

## Vérifications de développement

```sh
pnpm --filter @studium/claude-code-mod test
pnpm --filter @studium/claude-code-mod typecheck
claude plugin validate --strict apps/claude-code-mod
claude plugin test apps/claude-code-mod
```

La suite portable simule uniquement la frontière avec l'hôte Claude et fonctionne sans la CLI Claude. Le test natif du plugin reste une vérification SDK explicite.
