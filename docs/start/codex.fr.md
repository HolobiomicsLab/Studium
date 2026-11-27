[English](codex.md) · Français

# Connecter Codex à Studium

Ajoutez le serveur Studium à Codex, pour que Codex prépare, joue et planifie vos leçons avec les outils de
Studium.

## Avec l'extension VS Code : un clic, sans Node

Avec l'extension Studium pour VS Code installée, il ne faut ni terminal ni Node :

1. Dans VS Code, lancez **Studium : Relier un assistant…** depuis la palette de commandes et cochez **Codex** (la
   vue **Leçons** vide en donne aussi le lien).
2. Rechargez la fenêtre de VS Code pour Codex dans VS Code (la notification a un bouton **Recharger la fenêtre**) ; dans un terminal, lancez une nouvelle session `codex`.
3. Demandez à Codex : « je veux apprendre … avec Studium », en indiquant vos sources.

La commande écrit une entrée `studium` dans `~/.codex/config.toml` (ou `$CODEX_HOME/config.toml`), et rien d'autre ; le fichier précédent est gardé à côté sous
`<fichier>.studium-backup`. L'entrée lance le serveur Studium que l'extension contient, avec l'exécutable de VS Code
lui-même, et utilise le même dossier de leçons, la même progression et le même apprenant que le panneau Studium. Quand
Codex tourne dans VS Code, la leçon est proposée dans le panneau Studium et s'y ouvre d'elle-même quand elle est
prête ; ailleurs, dans votre [navigateur](browser.fr.md#depuis-votre-assistant). Une entrée `studium` écrite par vous
n'est remplacée que si vous dites oui. Chaque mise à jour de Studium réécrit l'entrée ; **Studium : Délier un
assistant…** la retire, et la désinstallation de l'extension aussi, pour autant que VS Code exécute son étape de
désinstallation.

L'entrée indique aussi `default_tools_approval_mode = "approve"` : Codex utilise les outils de Studium sans demander
avant chacun (lancer une leçon, chaque réponse, chaque note de rappel). Les outils de Studium n'écrivent que les leçons
et la progression de Studium. Une entrée écrite par Studium 0.6.9 ou antérieur reçoit cette ligne au prochain
démarrage de l'extension mise à jour par VS Code. Si vous préférez que Codex demande, ajoutez plutôt Studium à la main,
comme ci-dessous, sans cette ligne.

Vérifié sous macOS avec codex-cli 0.170.0. Le 26 novembre 2026, Codex a lu l'entrée (`codex mcp get studium`) et
l'entrée a lancé le serveur avec ses 40 outils. Le 27 novembre, une conversation de 13 tours (`codex exec`, puis
`codex exec resume`, avec le modèle par défaut de Codex) a utilisé cette entrée et sa ligne d'approbation : la leçon
de démonstration « Découvrir Studium », un quiz, la carte des notions, une leçon de quatre étapes construite à partir
d'un fichier de notes en moins d'une minute, une réponse rédigée et la note de rappel. Pas encore essayé :
l'application Codex et Codex dans VS Code.

Les sections ci-dessous installent le serveur à la main.

## Avant de commencer

- Lisez [Connecter votre assistant](harnesses.fr.md) : il explique les deux façons de lancer le serveur
  (`npx -y studium-mcp`, ou `node` sur un fichier issu d'un clone ou d'une release), `/path/to/studium`,
  `BUNDLES_ROOT` et `LITELLM_BASE_URL`. La forme `npx` ne demande que Node ; voir
  [Installation](installation.fr.md).
- Installez Codex et connectez-vous selon le [démarrage Codex](https://learn.chatgpt.com/docs/quickstart) ;
  les options MCP sont dans [MCP dans Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Réaliser la tâche

1. Ajoutez le serveur. **Avec `npx`** (sans clone) :

   ```bash
   codex mcp add studium --env LITELLM_BASE_URL= -- npx -y studium-mcp
   codex mcp list
   ```

   **Depuis un clone**, dans son dossier racine :

   ```bash
   codex mcp add studium --env LITELLM_BASE_URL= -- node "$PWD/apps/studium-vscode/dist/lesson-mcp.cjs"
   ```

2. Ou fusionnez ceci dans `~/.codex/config.toml` :

   ```toml
   [mcp_servers.studium]
   command = "npx"
   args = ["-y", "studium-mcp"]
   default_tools_approval_mode = "approve"

   [mcp_servers.studium.env]
   LITELLM_BASE_URL = ""
   ```

   Depuis un clone, utilisez `command = "node"` et
   `args = ["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]`.

3. Laissez Codex utiliser les outils de Studium sans demander à chaque fois : sous `[mcp_servers.studium]`
   dans `~/.codex/config.toml`, ajoutez `default_tools_approval_mode = "approve"`, comme dans l'exemple
   ci-dessus (`codex mcp add` ne l'écrit pas). Sans cette ligne, Codex demande avant chaque outil qui
   enregistre quelque chose (une leçon lancée, une réponse, une note), et `codex exec`, qui ne peut pas
   demander, le refuse. Pour un essai ponctuel avec un autre dossier de leçons, passez tout par `-c` :

   ```bash
   codex exec --skip-git-repo-check -C /path/to/workdir \
     -c 'mcp_servers.studium.command="node"' \
     -c 'mcp_servers.studium.args=["/path/to/studium/apps/studium-vscode/dist/lesson-mcp.cjs"]' \
     -c 'mcp_servers.studium.env={BUNDLES_ROOT="/path/to/lessons",LITELLM_BASE_URL=""}' \
     -c 'mcp_servers.studium.default_tools_approval_mode="approve"' \
     - < prompt.md
   ```

## Ce que vous obtenez

`codex mcp list` affiche `studium`. Pour prouver la connexion, faites la vérification de
[Connecter votre assistant](harnesses.fr.md#vérifier-la-connexion).

À un Codex qui annonce MCP Apps (Codex Desktop), une leçon prête à jouer est proposée d'abord dans le panneau
Studium : l'assistant l'ouvre avec `open_lesson_panel`. Votre navigateur vient ensuite, puis la
conversation, sur « ici ». Un Codex qui n'annonce pas MCP Apps a le navigateur d'abord. Voir
[Où une leçon est proposée d'abord](harness-panels.fr.md#où-une-leçon-est-proposée-dabord). Pas encore
essayé dans Codex Desktop : tests automatisés seulement.

## Limites

- Sans `default_tools_approval_mode = "approve"`, Codex demande avant chaque outil Studium qui n'est pas marqué
  en lecture seule, et `codex exec`, qui ne peut pas demander, le refuse :
  `MCP tool call requires approval, but approval policy is never`. Les outils de lecture (le plan d'étude, la
  liste des leçons) ne font pas l'objet d'une demande.
- Chaque `codex exec` ou `codex exec resume` relance le serveur : la leçon ouverte à un tour précédent n'est
  plus ouverte. Studium dit à l'assistant de la relancer, et elle reprend à l'étape où elle s'était arrêtée. Dans
  une session interactive, le serveur reste lancé.
- Le serveur Studium n'écrit que dans son dossier de données ; il n'exécute jamais lui-même une capsule.
