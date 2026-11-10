[English](panels.md) · Français

# Panneaux de leçon pour les développeurs

Cette page s'adresse aux contributeurs qui vérifient un hôte de panneaux, lancent le serveur de développement local ou ajoutent un hôte. Elle consigne aussi la politique des ressources des fichiers de panneau. Pour simplement ouvrir un panneau, lisez [Panneaux de leçon dans votre assistant](../start/harness-panels.fr.md).

## Avant de commencer

Compilez le fichier serveur que lancent la sonde et le serveur de développement :

```bash
pnpm --filter @studium/lesson-mcp bundle
```

Cette commande compile les renderers de panneau (`@studium/lesson-panel-ui`) et écrit `apps/lesson-mcp/dist/studium-mcp.cjs`. [`tools/panel-probe.mjs`](../../tools/panel-probe.mjs) et [`tools/panel-http-dev.mjs`](../../tools/panel-http-dev.mjs) lancent exactement ce chemin, et non le fichier serveur du build VS Code.

Les deux fichiers serveur partent du même point d'entrée, [`lesson-mcp-entry.ts`](../../apps/studium-vscode/src/lesson-mcp-entry.ts), et des mêmes renderers : ils servent donc les mêmes panneaux. Pour un assistant, utilisez `apps/studium-vscode/dist/lesson-mcp.cjs`, comme dans [Connecter votre assistant](../start/harnesses.fr.md). Le binaire `studium-mcp` du paquet `@studium/lesson-mcp` est `apps/lesson-mcp/dist/studium-mcp.cjs`.

## Comment un hôte obtient des panneaux

L'entrée stdio de Codex est `node /chemin/absolu/studium-mcp.cjs`. Un hôte compatible MCP Apps annonce `io.modelcontextprotocol/ui` à l'initialisation. C'est alors seulement que le serveur expose deux ressources `ui://` et annote les trois outils de panneau et `get_workflow_graph`. Sans cette annonce, le serveur propose les mêmes 40 outils, sans métadonnée UI et sans ressource.

## Vérifier un hôte

Lancez la sonde depuis la racine du dépôt, après la compilation ci-dessus :

```bash
STUDIUM_EPHEMERAL=1 node tools/panel-probe.mjs
```

La sonde lance deux fois le serveur embarqué, une fois sans et une fois avec la prise en charge de MCP Apps. Elle vérifie que le serveur propose 40 outils, que 4 d'entre eux portent des métadonnées UI et que 2 ressources existent quand le client prend en charge MCP Apps, et qu'aucune n'existe sinon. Elle vérifie que la vue ne contient aucune clé de réponse, que chaque ressource HTML reste sous 1,5 Mo et que la surface est `panel` pour un client qui a négocié MCP Apps, `text` sinon. Elle charge ensuite l'App embarquée dans un DOM, puis réalise le handshake postMessage et un aller-retour d'action.

Deux options modifient l'exécution :

- `--http=http://127.0.0.1:3001/mcp` teste le serveur HTTP local ci-dessous au lieu d'un processus lancé par la sonde.
- `--dom=/chemin/absolu/panneau.html` conserve le DOM rendu.

La sonde est un hôte de contrat automatisé. Elle ne remplace pas un essai dans un vrai hôte. Le `ext-apps/examples/basic-host` externe nécessite ses propres dépendances et son build avant de se connecter au serveur de développement.

## Lancer le serveur de développement local

La route du connecteur distant pour claude.ai et Claude Desktop est distincte de l'API HTTP de leçon. Studium n'ouvre aucun endpoint public, tunnel ou connecteur. Pour essayer cette route sur votre machine uniquement, compilez le bundle comme ci-dessus, puis lancez :

```bash
node tools/panel-http-dev.mjs
```

Le serveur écoute sur `127.0.0.1:3001`, à l'adresse `/mcp`. Définissez `PANEL_HTTP_PORT` pour changer le port. Pour chaque connexion, il lance un serveur embarqué en mémoire seule et lui transmet MCP. Il n'accepte que les hôtes et origines `localhost` et `127.0.0.1`, et ne fournit ni authentification de production ni contrat de déploiement. Arrêtez-le après usage.

## Ajouter un hôte

1. Écrivez un bridge dans [`apps/lesson-panel-ui/src`](../../apps/lesson-panel-ui/src/bridge-mcp-app.js) qui appelle `renderView` et transmet les `PanelAction` publiques au serveur.
2. Gardez les accès disque, la notation et les clés de réponse côté serveur.
3. Suivez la langue et le thème de l'hôte, ses états d'attente et d'erreur, et ses règles de liens et de taille.
4. Pour prévisualiser un bridge, définissez `window.__studiumView` et envoyez des événements `studium:view` au bridge standalone.

## Politique des ressources

| Élément | Règle |
|---|---|
| Ressources MCP | `text/html;profile=mcp-app`, `prefersBorder: true`, un seul domaine de ressources CSP, `https://cdn.jsdelivr.net` |
| Bibliothèques embarquées | marked, KaTeX JS et mhchem |
| Bibliothèques CDN | CSS et polices KaTeX, Vega, Vega-Lite, Vega-Embed, 3Dmol, Cytoscape et dagre, chargés depuis des URL de la version installée avec intégrité SHA-384 ; les polices suivent le chemin versionné du CSS KaTeX vérifié |
| Une bibliothèque CDN manque | Une représentation de secours lisible la remplace |
| Images distantes d'une leçon | Bloquées ; les images approuvées par le serveur arrivent en URI `data:` |
| VS Code | Garde sa CSP à nonce et son mode vendor entièrement local |
| Taille | 1,5 Mo par ressource HTML ; le build échoue au-delà |

Les licences sont dans [`VENDOR-LICENSES.md`](../../apps/lesson-panel-ui/VENDOR-LICENSES.md). Pour les couches autour des panneaux, voyez [Architecture](architecture.fr.md).
