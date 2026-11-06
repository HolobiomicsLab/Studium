[English](README.md) · Français

# Panneau de leçon partagé

Les mêmes renderers de leçon et de graphe servent VS Code et les MCP Apps. Le serveur fournit une
vue publique `studium/panel-view/2` (une vue `studium/panel-view/1` reste lue) ; le navigateur ne note pas les réponses et ne lit aucun fichier
apprenant. `src/artifact-pane.js` exporte `renderView`, avec les indices, discussions, autoévaluations
et fins de leçon. Le build classique conserve les messages historiques pour les pilotes existants.

Pour une vue version 2, le renderer de leçon affiche aussi : une ligne d'orientation au-dessus du rail de
progression (le `status_line` de la vue ; le rail garde ses segments et perd son propre libellé, l'étape
n'est donc dite qu'une fois) ; qui signe la leçon, au-dessus de la scène, et qui a évalué la réponse,
au-dessus d'un verdict ; l'échelle d'aide sous les contrôles de réponse, un bouton par échelon, chacun avec
son coût ou la raison pour laquelle il est fermé ; et « Poser une question », qui envoie l'action `ask`.
Un échelon fermé est `aria-disabled`, pas `disabled` : il prend le focus clavier, sa raison peut donc être
lue, et l'actionner n'envoie rien. Chaque contrôle s'atteint avec Tab, dans l'ordre de lecture. Le renderer
mesure le délai entre une action et l'affichage de la vue qui y répond, et le remet une fois au pont avec
l'action suivante (`window.__send(action, { client_ms })`) ; le pont MCP App le passe à `panel_action` dans
`client_ms`, le pont VS Code à l'extension, qui fait de même.

Depuis la racine : `pnpm --filter @studium/lesson-panel-ui build`. Le build utilise esbuild et deux
gabarits HTML, régénère les fichiers vendor depuis les paquets installés et écrit
`dist/lesson-panel.html`, `dist/graph-panel.html`, les exports JavaScript des ressources embarquées
et `dist/vscode/`. Chaque ressource MCP est limitée à 1 500 000 octets par le build. Les builds MCP
et VS Code l'appellent automatiquement ; le lancer avant d'importer directement le serveur source.
`pnpm --filter @studium/lesson-panel-ui test` vérifie le renderer et les interactions des bridges.

Les adaptateurs sont `bridge-vscode.js`, `bridge-mcp-app.js` et `bridge-standalone.js`. Un nouvel
hôte fournit les vues et transporte les actions de la personne qui apprend. MCP Apps respecte la
langue et le thème de l'hôte, signale la taille, ouvre les liens via l'hôte, confirme l'effacement et
propose un sélecteur de cours. Les reproductions de capsules nécessitent le terminal VS Code ; le
panneau MCP explique cette limite.

Le HTML MCP embarque marked, KaTeX et mhchem. Les CSS/polices KaTeX, Vega, Vega-Lite, Vega-Embed,
3Dmol, Cytoscape et dagre viennent de `https://cdn.jsdelivr.net`, avec versions et intégrité
vérifiées. Sans ces bibliothèques, les représentations de secours restent lisibles. Les images
distantes des leçons restent bloquées. VS Code garde son mode vendor hors ligne. Voir les
[licences](VENDOR-LICENSES.md) et la [configuration des harnais](../../docs/start/harness-panels.fr.md).
