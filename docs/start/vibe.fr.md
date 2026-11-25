[English](vibe.md) · Français

# Connecter Mistral Vibe à Studium

Ajoutez le serveur Studium à Mistral Vibe, l'assistant en ligne de commande de Mistral AI, pour qu'un
modèle Mistral construise et joue vos leçons avec les outils de Studium.

## Avant de commencer

- Lisez [Connecter votre assistant](harnesses.fr.md) : il explique les deux façons de lancer le serveur
  (`npx -y studium-mcp`, ou `node` sur un fichier issu d'un clone ou d'une release), `BUNDLES_ROOT` et
  `LITELLM_BASE_URL`. La forme `npx` ne demande que Node ; voir [Installation](installation.fr.md).
- Installez Vibe et connectez-vous selon la [documentation de Mistral Vibe](https://docs.mistral.ai/mistral-vibe/introduction).

## Réaliser la tâche

1. Ajoutez le serveur à votre configuration Vibe (`~/.vibe/config.toml`). **Avec `npx`** (sans clone) :

   ```bash
   vibe mcp add studium --transport stdio --command npx --arg=-y --arg studium-mcp --env LITELLM_BASE_URL=
   ```

   La commande écrit cette entrée, que vous pouvez aussi ajouter à la main :

   ```toml
   [[mcp_servers]]
   name = "studium"
   transport = "stdio"
   command = "npx"
   args = ["-y", "studium-mcp"]

   [mcp_servers.env]
   LITELLM_BASE_URL = ""
   ```

   **Depuis un clone**, utilisez `command = "node"` et `args = ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]`.

   Pour ne relier Studium que dans un dossier, placez la même entrée dans `.vibe/config.toml` dans ce
   dossier et lancez Vibe depuis celui-ci ; Vibe vous demande d'abord de faire confiance au dossier.

2. Lancez `vibe` et faites la vérification de [Connecter votre assistant](harnesses.fr.md#vérifier-la-connexion).
3. Demandez : « je veux apprendre … avec Studium », en indiquant vos sources, par exemple un fichier de
   notes de cours présent dans le dossier.

## Ce que vous obtenez

La vérification liste 40 outils. Dans l'essai décrit sous Limites, Vibe a lu un fichier de notes de
cours, construit une leçon de 8 étapes sur 4 notions dont Studium a accepté les citations dès le premier
appel à `create_lesson`, l'a démarrée, a relayé chaque étape et transmis une réponse de quiz à Studium,
qui l'a évaluée avec la clé. L'exemple complet est [vibe.toml](../examples/vibe.toml).

Depuis cet essai, une leçon prête à jouer est proposée d'abord dans votre navigateur : Vibe affiche
l'adresse du [lecteur dans le navigateur](browser.fr.md#depuis-votre-assistant) de Studium, sur votre
ordinateur, où chaque étape répond aussitôt au lieu d'attendre le modèle ; dites « ici » pour la suivre
dans la conversation. L'adresse vit le temps de la session de Vibe et joue l'identifiant d'apprenant que
Vibe a passé. Vos réponses y sont vérifiées par Studium sur votre ordinateur et ne vont pas à Mistral AI,
tant qu'aucun modèle juge n'est configuré. `STUDIUM_BROWSER_PLAYER=off` dans l'`env` du serveur désactive
cela. Pas encore essayé avec Vibe lui-même : seuls des scripts l'ont vérifié.

## Ce qui quitte votre machine

Studium lui-même n'envoie rien : les leçons et la progression restent dans `~/.studium`. Le modèle de
l'assistant, lui, reçoit ce qu'il lit et relaie : vos sources, la leçon et vos réponses vont au
fournisseur de ce modèle, ici Mistral AI, selon les conditions de votre abonnement. C'est à vous et à
votre établissement de dire si ces conditions conviennent à vos supports de cours ; voir
[Confidentialité et limites](../concepts/privacy-and-limits.fr.md).

## Limites

- Un seul essai fonde cette page : Vibe 3.1.3 avec le modèle Mistral Large 4 sous macOS, `studium-mcp`
  0.6.3, le 25 novembre 2026, dans le mode sans interface de Vibe (`vibe -p`), à partir de notes de cours
  en français d'environ 2 400 caractères. Construire la leçon a pris environ 6 minutes entre la demande
  et la première étape ; chaque étape suivante a pris de 23 à 28 secondes, un chiffre qui inclut le
  redémarrage de Vibe et du serveur à chaque appel. Les autres modèles, des sources plus longues et le
  mode interactif n'ont pas été mesurés.
- Aucun modèle juge n'était configuré. L'API de Mistral n'a pas été essayée comme juge. Son point
  d'accès de conversation suit le format OpenAI, donc `LITELLM_BASE_URL` et `LITELLM_MODEL` devraient
  l'atteindre pour les étapes d'audit, mais les étapes de discussion envoient le nom de modèle fixe
  `studium/runtime-tutor`, que seul un proxy peut faire correspondre à un modèle Mistral ; voir
  [Choisir son modèle](models.fr.md#le-modèle-juge). Ceci a été lu, pas exécuté.
- Le Chat, l'assistant web et de bureau de Mistral, n'a pas été essayé : le serveur de Studium parle par
  stdio sur votre machine et n'est pas proposé comme connecteur distant.
- Si le serveur n'apparaît pas la première fois, `npx` est peut-être encore en train de télécharger le
  paquet : ajoutez `--startup-timeout-sec 60` à la commande, ou `startup_timeout_sec = 60` à l'entrée.
- Les [panneaux de leçon](harness-panels.fr.md) n'ont pas été essayés dans Vibe.
