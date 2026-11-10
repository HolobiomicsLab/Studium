[English](README.md) · Français

# Panneau de leçon partagé

Les mêmes renderers de leçon et de graphe servent VS Code et les MCP Apps. Le serveur fournit une
vue publique `studium/panel-view/2` (une vue `studium/panel-view/1` reste lue) ; le navigateur ne note pas les réponses et ne lit aucun fichier
apprenant. `src/artifact-pane.js` exporte `renderView`, avec les indices, discussions, autoévaluations
et fins de leçon. Le build classique conserve les messages historiques pour les pilotes existants.

Pour une vue version 2, le renderer de leçon dessine, de haut en bas : une ligne de séance tirée de
l'`orientation` de la vue (étape, question de contrôle, détour et point de retour, minutes restantes,
révisions dues), à côté du menu « ⋯ », le `status_line` de la vue étant le texte que lit un lecteur
d'écran ; le rail de progression, qui suit l'étape du serveur (un détour garde l'étape où il revient, ou
la dernière étape du parcours, et il est marqué) ; le type de la scène et une puce courte qui dit qui signe
la leçon et s'ouvre sur la phrase complète ; la scène ; puis une barre qui reste en bas du panneau quand
la scène défile (`position: sticky`, si bien qu'un hôte qui ajuste le cadre à son contenu ne voit pas sa
hauteur changer), avec l'échelle de confiance et le sens de ses deux bornes, l'acte attendu et un seul
bouton « Aide ». « Aide » ouvre l'échelle d'aide sur place, juste après lui dans l'ordre de lecture : un
bouton par échelon, chacun avec son coût ou la raison pour laquelle il est fermé, et « Poser une
question », qui envoie l'action `ask`. Un échelon fermé est `aria-disabled`, pas `disabled` : il prend le
focus clavier, sa raison peut donc être lue, et l'actionner n'envoie rien. Un indice s'affiche sous la
question. Le menu « ⋯ » contient « Réglages », « Choisir un autre cours » quand la vue propose
`pickCourse`, et le droit à l'oubli. « Réglages » ouvre une section fermée en bas du volet, tirée des
actions que la vue propose et de rien d'autre : « Silencieux », « Normal », « Accompagné »
(`setAttention`, l'`attention` de la vue enfoncée), FR et EN (`setLanguage`, la `locale` de la vue
enfoncée), et un champ de minutes avec « Replanifier » (`replan {minutes}`, de 1 à 600). Ces contrôles ne
répondent à rien : ils restent actifs quand une réponse est attendue, et le retour déjà quitté ne revient
pas quand leur vue revient.
L'écran de retour garde la ligne de séance, dit qui a évalué la réponse et montre la réponse de
l'apprenant, que le renderer garde le temps de la séance et n'envoie nulle part : un choix à côté de la
bonne réponse quand la vue la porte, avec le nom de la clé, ou une réponse écrite citée au-dessus des
points clés. Une scène rejouée montre le retour que le serveur a rendu, qui ne contient aucune référence ;
une référence que la vue porterait encore est retenue. Le `content_language` d'une vue, quand il est
présent, marque la scène et son retour de cette langue. Chaque contrôle s'atteint avec Tab, dans l'ordre
de lecture, et un contrôle qui a le focus le garde pendant qu'une action attend (`aria-disabled`).
Chaque réponse porte `expected_scene_id`, la scène à l'écran ; quand le serveur la refuse parce que la scène
a changé, le pont MCP App relit `get_panel_view` et le panneau dit que la réponse n'a pas été comptée.
L'échelon d'explication est nommé d'après `help.explains` (la dernière réponse ou l'écran), et un détour est
placé à l'étape du parcours principal que donne la vue (`progress.detour`). Une erreur d'action dont le message
commence par `session not found` (le serveur a redémarré ou la séance a été fermée ; l'enveloppe JSON
`{"error": …}` de l'outil est d'abord ouverte, et rien n'est lu après le préfixe) remplace la scène,
réglages compris, par l'avis « Séance perdue » et un bouton « Rouvrir la leçon » qui envoie `reopen` une
fois, sur un clic ; rien n'est relancé tout seul. Le pont MCP App répond à `reopen` par
`open_lesson_panel` avec le `bundle_ref`, le `learner_id` et le `surface` de la dernière vue, dans la
langue courante ; le pont VS Code le passe à l'extension. Toute autre erreur d'action garde la scène et la
ligne d'état « Échec de l'action ». Une vue dont le `surface.kind` vaut `text` ou `form` (un hôte qui affiche
les MCP Apps montre le panneau à tout appel de `open_lesson_panel`, surface conversation ou formulaires
comprise) n'est pas dessinée comme une scène : le panneau affiche « Cette leçon se joue dans la
conversation » (ou « …en formulaires »), « Le panneau n'est pas la surface négociée pour cette séance. » et
la `status_line` de la vue, sans corps de scène, contrôle de réponse, réglages ni carte, pour qu'aucun acte
ne soit pris à un rang que le serveur n'a pas négocié. Quand `surface.available` contient `panel`, un bouton
« Jouer ici » envoie `playHere` une fois, sur un clic ; le pont MCP App y répond par `open_lesson_panel` avec
le `session_id`, le `bundle_ref` et le `learner_id` de la vue et `surface: "panel"`, ce qui renégocie la
surface de la séance vivante (le journal d'interaction note le changement de rang). Une vue `pane` ou
`panel` est dessinée comme avant. Le renderer
mesure le délai entre une action et l'affichage de la vue qui y répond, et le remet une fois au pont avec
l'action suivante (`window.__send(action, { client_ms })`) ; le pont MCP App le passe à `panel_action` dans
`client_ms`, le pont VS Code à l'extension, qui fait de même.

Le pont MCP App tient aussi l'assistant de l'hôte au courant, là où l'hôte dit le permettre
(`getHostCapabilities()`). Après chaque `panel_action`, il lit `get_companion_brief` avec `peek: true` (le
curseur ne bouge pas) et place le brief dans le contexte du modèle par `updateModelContext`, sous la forme
d'une ligne de note suivie du brief en JSON. « Poser une question » ouvre un petit formulaire dans l'échelle d'aide. Les mots de
l'apprenant partent dans la conversation de l'hôte par `sendMessage`, après un brief lu sans `peek`, puis
l'action `ask` marque le passage de main. Un hôte qui ne prend pas de message reçoit l'action `ask` seule,
dont l'avis renvoie l'apprenant à la conversation. Un brief illisible ne fait jamais échouer le panneau.

Depuis la racine : `pnpm --filter @studium/lesson-panel-ui build`. Le build utilise esbuild et deux
gabarits HTML, régénère les fichiers vendor depuis les paquets installés et écrit
`dist/lesson-panel.html`, `dist/graph-panel.html`, les exports JavaScript des ressources embarquées
et `dist/vscode/`. Chaque ressource MCP est limitée à 1 500 000 octets par le build. Les builds MCP
et VS Code l'appellent automatiquement ; le lancer avant d'importer directement le serveur source.
`pnpm --filter @studium/lesson-panel-ui test` vérifie le renderer et les interactions des bridges.

Les adaptateurs sont `bridge-vscode.js`, `bridge-mcp-app.js` et `bridge-standalone.js`. Un nouvel
hôte fournit les vues et transporte les actions de la personne qui apprend. MCP Apps respecte la
langue et le thème de l'hôte, signale la taille, ouvre les liens via l'hôte, et dessine dans le
panneau la confirmation de l'effacement et le choix du cours. Les reproductions de capsules nécessitent le terminal VS Code ; le
panneau MCP explique cette limite.

Le HTML MCP embarque marked, KaTeX et mhchem. Les CSS/polices KaTeX, Vega, Vega-Lite, Vega-Embed,
3Dmol, Cytoscape et dagre viennent de `https://cdn.jsdelivr.net`, avec versions et intégrité
vérifiées. Sans ces bibliothèques, les représentations de secours restent lisibles. Les images
distantes des leçons restent bloquées. VS Code garde son mode vendor hors ligne. Voir les
[licences](VENDOR-LICENSES.md) et la [notes pour les développeurs](../../docs/develop/panels.fr.md).
