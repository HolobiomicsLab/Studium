[English](harness-panels.md) · Français

# Panneaux de leçon dans les harnais IA

Studium sépare la vue publique d'une leçon de son hôte. Le même renderer HTML affiche contenus,
contrôles de réponse, retours, révisions et fin de leçon dans VS Code et MCP Apps. Le mod Claude Code
présente cette vue avec des composants natifs. Ce tableau décrit les routes implémentées ; les
vérifications dans les vrais hôtes Codex Desktop et Claude sont différées.

| Hôte | Route du panneau | Vérification actuelle |
|---|---|---|
| Extension Studium pour VS Code | Renderer partagé et bridge VS Code | Pilotes DOM et extension existants |
| Codex Desktop compatible MCP Apps | Ressources `ui://` via la connexion stdio existante | Handshake et action du SDK embarqué ; essai natif différé |
| Claude Code CLI, onglet Code et extension | Plugin `apps/claude-code-mod` | Tests du contrat du mod ; essai natif différé |
| Connecteur distant claude.ai / Claude Desktop | MCP Apps sur Streamable HTTP | Service distant et exposition à décider par le propriétaire |
| Client MCP textuel | Outils existants et outils de vue publique | Aucune métadonnée UI ni ressource UI accessible |

## Connexion

L'entrée Codex reste `node /chemin/absolu/studium-mcp.cjs`. Recompiler avec
`pnpm --filter @studium/lesson-mcp bundle`, puis utiliser
`apps/lesson-mcp/dist/studium-mcp.cjs` dans la configuration du connecteur existant. Ouvrir une leçon
avec `open_lesson_panel`. L'hôte annonce `io.modelcontextprotocol/ui` à l'initialisation : le serveur
expose alors deux ressources et annote les trois outils de panneau et `get_workflow_graph`. Le
modèle attend les actions de la personne qui apprend lorsqu'un panneau interactif est ouvert.

Le panneau MCP propose un sélecteur de cours et une confirmation explicite avant effacement. Une
reproduction de capsule nécessite le terminal VS Code ; le panneau l'explique. Le graphe montre le
voisinage actuel de l'apprenant ; cliquer sur un nœud en affiche le libellé localement.

La route du connecteur distant Claude est distincte de l'API HTTP de leçon existante. Aucun endpoint
public, tunnel ou connecteur n'est installé ici. Pour le développement local uniquement, compiler
le bundle puis lancer `node tools/panel-http-dev.mjs`. Il écoute sur `127.0.0.1:3001`, transmet MCP
à un serveur embarqué en mémoire par connexion et n'accepte que les hôtes et origines loopback.
L'arrêter après usage. Il ne fournit ni authentification ni contrat de déploiement en production.

## Vérifier et étendre

`STUDIUM_EPHEMERAL=1 node tools/panel-probe.mjs` vérifie 37 outils, les comptes 2/4 des ressources et
outils UI, l'isolation par capacité, les tailles HTML, l'absence de clé et le handshake postMessage
avec une action du véritable App embarqué dans un DOM. `--http=http://127.0.0.1:3001/mcp` vérifie
l'adaptateur HTTP local ; `--dom=/chemin/absolu/panneau.html` conserve le DOM rendu. Cet hôte automatisé
ne remplace pas un essai natif. Le `ext-apps/examples/basic-host` externe nécessite ses propres
dépendances et son build avant de se connecter au serveur local.

Pour ajouter un hôte, écrire un bridge dans
[`apps/lesson-panel-ui/src`](../../apps/lesson-panel-ui/src/bridge-mcp-app.js) qui appelle `renderView`
et transmet les `PanelAction` publiques. Garder les accès disque, la notation et les clés côté
serveur. Suivre langue, thème, attente, erreurs, liens et taille. Pour les aperçus, le bridge
standalone lit `window.__studiumView` puis les événements `studium:view`.

## Politique des ressources

Les ressources MCP utilisent `text/html;profile=mcp-app`, `prefersBorder: true` et le seul domaine CSP
`https://cdn.jsdelivr.net`. marked, KaTeX JS et mhchem sont embarqués ; CSS/polices KaTeX, Vega,
Vega-Lite, Vega-Embed, 3Dmol, Cytoscape et dagre utilisent les versions installées et l'intégrité
SHA-384. Les polices suivent le chemin versionné du CSS KaTeX vérifié. Sans CDN, les représentations
de secours restent lisibles. Les images distantes des leçons sont bloquées ; les images approuvées
par le serveur arrivent en URI `data:`. VS Code conserve sa CSP à nonce et son mode vendor local.
Le build limite chaque HTML à 1,5 Mo. Les licences sont dans
[`VENDOR-LICENSES.md`](../../apps/lesson-panel-ui/VENDOR-LICENSES.md).
