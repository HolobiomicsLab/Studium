# Dépannage

Commencer par relever la révision (`git rev-parse HEAD`), le client utilisé,
`node --version`, `pnpm --version` et la commande qui échoue. Garder un message
d'erreur minimal sans clés, données personnelles ou contenu privé.

| Symptôme | Vérification / action |
|---|---|
| Clone refusé | Vérifier l'accès GitHub au dépôt et la branche fournie ; aucune ouverture publique n'est présumée |
| Module ou `dist` absent | Refaire `pnpm install --frozen-lockfile`, `pnpm build:libs`, puis le build extension |
| `tsx` introuvable | Utiliser le serveur compilé `node …/dist/lesson-mcp.cjs`, ou le binaire app-local documenté |
| MCP attend sans afficher de page | C'est du stdio : le lancer via un client MCP, pas dans un navigateur |
| Aucun outil Studium | Lire les logs MCP, vérifier les chemins, redémarrer le serveur et reconnecter le chat |
| VS Code ne lit pas le JSON | `.vscode/mcp.json` utilise `servers`, Claude/Cursor utilisent `mcpServers` |
| F5 ne trouve pas la configuration | Ouvrir `apps/studium-vscode`, qui contient la configuration Extension Host |
| Le VSIX ne trouve pas la leçon | Fournir le bundle et ses assets, définir `studium.bundlesRoot` et `bundleRef` |
| Graphique/équation dégradé | Exécuter `pnpm --filter studium-vscode vendor`, reconstruire ; vérifier le mode assets |
| Session inconnue après changement de client | Vérifier le même serveur encore actif ; l'API permet cette reprise, pas le transfert vers un nouveau processus |
| API répond `401` | Fournir le même token local au serveur et au client via leur environnement ; ne pas le coller dans le chat |
| API répond `409` | Relire le contexte si la scène est périmée ; après une erreur réseau, relancer le même fichier avec le même `request_id` |
| API répond `503` | File d'attente ou reçus pleins : consulter [les règles de reprise](guides/api-and-harness.md) avant de créer une nouvelle action |
| API refusée depuis un viewer | Les requêtes de navigateur avec `Origin` sont refusées ; faire appeler l'API par le harnais, sans token dans le HTML |
| `api:call` ou une option récente est absente | Vérifier [la révision installée](updates/2026-09-12.md) ; ne pas mélanger les docs récentes avec un ancien clone de `dev` |
| La langue choisie ne traduit pas toute l'activité | Fournir un dictionnaire `--translations` ; le sélecteur conserve les textes manquants dans leur langue source |
| Un prompt média ne génère rien dans le navigateur | Le harnais exécute la demande avec son outil disponible, puis attache le fichier dans une nouvelle activité |
| Chat et panneau montrent deux scènes | Ils peuvent utiliser deux serveurs ; choisir un seul pilote de séance |
| Réponse rejetée | Relire `get_operator_context` et son format ; ne pas envoyer `ack` à toutes les scènes |
| Réponse IA ou confiance inventée | Revenir à la contribution personnelle de l'étudiant avant toute soumission |
| Copilot demande un paiement malgré Education | Vérifier l'approbation puis l'activation de l'avantage et son délai officiel |
| Bibliothèque scientifique absente | Lire la capsule/skill ; installer la version appropriée dans son environnement d'expérience |
| `ModuleNotFoundError` Python | Employer le `.venv` du dépôt et la recette complète de l'installation |
| `check` refuse le brouillon | Comparer schéma, identifiants et citations ; garder `draft` / `validated_by: null` |
| Dossier de sortie déjà présent | Choisir un nouveau chemin ; les outils préservent volontairement les sorties existantes |
| MySTRA affiche 404 | Vérifier `--course-root`, le sous-dossier du cours et les fichiers générés par `experience_review.py` |
| Démo viewer échoue au navigateur | Vérifier Chrome et son environnement ; le succès du calcul seul n'est pas celui de l'audit UI |
| Interface auteur bloquée au PDF | Vérifier ingestion/planner et leurs règles CORS ; utiliser le parcours packet pour le pilote documenté |
| Planner retourne 422 | Envoyer `manifest_id` et `target`, pas l'ancien corps `corpus_path` / `target_level` |
| Synthèse retourne 503 | L'orchestrateur de service n'est pas configuré ; le simple lancement uvicorn ne suffit pas |
| Appel distant supposé mais sortie mock | Examiner mode, URL, alias et indicateurs de fallback ; HTTP 200 ne prouve pas le live |

## Vérification indépendante du chat

Depuis la racine installée/construite :

```sh
node apps/lesson-mcp/scripts/headless_smoke.mjs
```

Ce test MCP doit annoncer la réussite de tous ses contrôles. Il ne vérifie pas l'authentification
Copilot, le rendu dans l'Extension Host ni l'efficacité du cours. Pour une recette
Python et une revue locale, rejouer le [tutoriel littérature](tutorials/literature-to-course.md).

Si le problème persiste, transmettre : étape, résultat attendu, erreur réduite,
révision, plateforme et reproduction minimale. Ne pas publier un dossier entier
ni contourner l'évaluation/les protections pour obtenir un voyant vert.
