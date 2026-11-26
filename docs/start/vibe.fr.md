[English](vibe.md) · Français

# Connecter Mistral Vibe à Studium

Ajoutez le serveur Studium à Mistral Vibe, l'assistant de Mistral AI (dans VS Code, sur le bureau ou dans un
terminal), pour qu'un modèle Mistral construise et joue vos leçons avec les outils de Studium.

## Dans VS Code ou Vibe Desktop : un clic, sans Node

Avec l'extension Studium pour VS Code installée, il ne faut ni terminal ni Node :

1. Dans VS Code, lancez **Studium : Relier Mistral Vibe** depuis la palette de commandes (quand Vibe est installé,
   l'extension le propose aussi une fois dans une notification, et la vue **Leçons** vide en donne le lien).
2. Rechargez la fenêtre de VS Code (la notification a un bouton **Recharger la fenêtre**) : l'extension Vibe lit sa
   configuration à son démarrage, et une nouvelle conversation ne suffit pas. Relancez aussi Vibe Desktop s'il est ouvert.
3. Demandez à Vibe : « je veux apprendre … avec Studium », en indiquant vos sources, par exemple un fichier de notes de
   cours. Dans VS Code, la leçon s'ouvre d'elle-même dans le panneau Studium quand elle est prête.

La commande écrit une entrée, `studium`, dans la configuration de Vibe (`~/.vibe/config.toml`, ou
`$VIBE_HOME/config.toml`), et rien d'autre ; le fichier précédent est gardé sous `config.toml.studium-backup`. L'entrée
lance le serveur Studium que l'extension contient, avec l'exécutable de VS Code lui-même : Node n'est pas nécessaire. Elle
utilise le même dossier de leçons, la même progression et le même apprenant que le panneau Studium : une leçon construite
avec Vibe apparaît dans la vue **Leçons**. Quand Vibe tourne dans VS Code, la leçon est proposée dans le panneau Studium ;
quand il tourne ailleurs (Vibe Desktop, Vibe dans un terminal), dans votre [navigateur](browser.fr.md#depuis-votre-assistant).
Si Vibe a déjà une entrée `studium` écrite par vous, la commande demande avant de la remplacer. Chaque mise à jour de
Studium réécrit l'entrée (le chemin du serveur change avec la version) ; **Studium : Délier Mistral Vibe** la retire, et
la désinstallation de l'extension aussi, pour autant que VS Code exécute son étape de désinstallation.

Ce qui a été vérifié, le 26 novembre 2026 avec Vibe 3.1.3 (ligne de commande, sans interface) et Mistral Large 4 sous
macOS : avec l'entrée écrite par la commande, Vibe a lancé le serveur, construit une leçon de deux étapes à partir d'un
fichier de notes en environ 3 minutes 30 et donné l'adresse du navigateur ; lancé depuis l'exécutable de VS Code, il a
donné le lien du panneau. Le même jour, dans l'extension Vibe pour VS Code
(1.30.0) : après un rechargement de la fenêtre, Vibe a vu les 40 outils de Studium et construit la leçon ; sa conversation
a montré le lien `vscode://` comme du texte et non comme un lien, d'où l'ouverture automatique de la leçon. D'après la
documentation de Mistral, Vibe Desktop lit la même configuration ; cela n'y a pas encore été essayé. Sous Windows, le serveur ne sait pas si VS Code l'a lancé et
propose toujours le navigateur. Dans une fenêtre VS Code distante (SSH, WSL, conteneurs), la commande ne s'exécute pas.

## Vibe dans un terminal, sans l'extension

### Avant de commencer

- Lisez [Connecter votre assistant](harnesses.fr.md) : il explique les deux façons de lancer le serveur
  (`npx -y studium-mcp`, ou `node` sur un fichier issu d'un clone ou d'une release), `BUNDLES_ROOT` et
  `LITELLM_BASE_URL`. La forme `npx` ne demande que Node ; voir [Installation](installation.fr.md).
- Installez Vibe et connectez-vous selon la [documentation de Mistral Vibe](https://docs.mistral.ai/mistral-vibe/introduction).

### Réaliser la tâche

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

### Ce que vous obtenez

La vérification liste 40 outils. Dans l'essai décrit sous Limites, Vibe a lu un fichier de notes de
cours, construit une leçon de 8 étapes sur 4 notions dont Studium a accepté les citations dès le premier
appel à `create_lesson`, l'a démarrée, a relayé chaque étape et transmis une réponse de quiz à Studium,
qui l'a évaluée avec la clé. L'exemple complet est [vibe.toml](../examples/vibe.toml).

Depuis cet essai, une leçon prête à jouer est proposée d'abord dans votre navigateur : Vibe affiche
l'adresse du [lecteur dans le navigateur](browser.fr.md#depuis-votre-assistant) de Studium, sur votre
ordinateur, où vous répondez à chaque étape sans passer par la conversation ; dites « ici » pour la suivre
dans la conversation. L'adresse vit le temps de la session de Vibe et joue l'apprenant que joue le serveur
(`STUDIUM_LEARNER_ID`, sinon `anonymous`). Vos réponses y sont vérifiées par Studium sur votre ordinateur et ne vont pas à Mistral AI,
tant qu'aucun modèle juge n'est configuré. `STUDIUM_BROWSER_PLAYER=off` dans l'`env` du serveur désactive
cela. Vérifié avec Vibe 3.1.3 sans interface le 26 novembre 2026 (ci-dessus) : Vibe a donné l'adresse.

### Ce qui quitte votre machine

Studium lui-même n'envoie rien : les leçons et la progression restent dans `~/.studium`. Le modèle de
l'assistant, lui, reçoit ce qu'il lit et relaie : vos sources, la leçon et vos réponses vont au
fournisseur de ce modèle, ici Mistral AI, selon les conditions de votre abonnement. C'est à vous et à
votre établissement de dire si ces conditions conviennent à vos supports de cours ; voir
[Confidentialité et limites](../concepts/privacy-and-limits.fr.md).

### Limites

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
