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

   **OpenCode 1.x** (la version que `npm` installe aujourd'hui, 1.19.6 le 25 novembre 2026) prend le serveur
   directement sous `mcp`, dans `opencode.json` :

   ```json
   {
     "mcp": {
       "studium": {
         "type": "local",
         "command": ["npx", "-y", "studium-mcp"],
         "environment": { "LITELLM_BASE_URL": "" }
       }
     }
   }
   ```

2. Lancez `opencode mcp list` pour voir la connexion.

## Dans un navigateur web, avec un modèle Mistral

OpenCode a une interface web : `opencode web` lance un serveur sur votre machine (127.0.0.1) et ouvre une
page de conversation dans votre navigateur, avec les outils Studium de la configuration du dossier. C'est
une façon de construire et de jouer des leçons sans conversation dans un terminal et sans VS Code.

1. Donnez à OpenCode un fournisseur de modèle. Pour Mistral, définissez `MISTRAL_API_KEY` dans votre
   environnement, puis choisissez le modèle `mistral/mistral-large-4` (`opencode models mistral` liste les
   autres).
2. Dans le dossier qui contient la configuration ci-dessus, lancez `opencode web`. Définissez d'abord
   `OPENCODE_SERVER_PASSWORD` : sans lui, OpenCode prévient que son serveur n'est pas protégé.
3. Demandez « je découvre Studium, par où commencer ? » ou « je veux apprendre … avec Studium », en nommant
   un fichier du dossier comme source.

Comme avec tout assistant, ce que le modèle lit et relaie va à son fournisseur, ici Mistral AI, selon les
conditions de votre abonnement ; voir [Connecter Mistral Vibe](vibe.fr.md#ce-qui-quitte-votre-machine).

## Ce que vous obtenez

`opencode mcp list` affiche `studium`. Pour prouver la connexion, faites la vérification de
[Connecter votre assistant](harnesses.fr.md#vérifier-la-connexion). L'exemple complet est
[opencode-v2.json](../examples/opencode-v2.json).

Une leçon prête à jouer est proposée d'abord dans votre navigateur : l'assistant affiche l'adresse du
[lecteur dans le navigateur](browser.fr.md#depuis-votre-assistant) de Studium, sur votre ordinateur, où
chaque étape répond aussitôt ; dites « ici » pour la suivre plutôt dans la conversation. L'adresse vit le
temps de la session d'OpenCode et joue l'identifiant d'apprenant qu'OpenCode a passé. Vos réponses y sont
vérifiées par Studium sur votre ordinateur et ne vont pas au modèle, tant qu'aucun modèle juge n'est
configuré. `STUDIUM_BROWSER_PLAYER=off` dans `environment` désactive cela. Pas encore essayé avec OpenCode
lui-même : seuls des scripts l'ont vérifié.

## Limites

- Un seul essai fonde la configuration 1.x et le modèle Mistral : OpenCode 1.19.6 sous macOS, le 25 novembre
  2026, avec `mistral/mistral-large-4` par `opencode run`, la forme en ligne de commande. À la question « par où
  commencer ? » avec une bibliothèque vide, il a montré la première étape de la leçon de démonstration livrée
  avec Studium en 23 secondes ; il a construit une leçon de 9 étapes à partir de notes de cours d'environ
  2 400 caractères, désignées par leur chemin, en 3 minutes 4 secondes. L'interface web a été lancée et sa
  page a répondu, mais aucune leçon n'y a été jouée. La configuration v2 ci-dessus n'a pas été exécutée ce
  jour-là.
- Les versions antérieures d'OpenCode utilisent une autre forme de configuration.
- Un modèle ouvert proposé par votre fournisseur n'est par défaut ni gratuit, ni local, ni de qualité
  équivalente.
