[English](easy-start.md) · Français

# Démarrer sans terminal

Le chemin le plus court vers Studium pour qui n'utilise pas de terminal : VS Code, une extension et
l'assistant d'IA que vous utilisez déjà. Pas de ligne de commande, pas de Node. Comptez une vingtaine de
minutes, leçon de démonstration comprise.

## Avant de commencer

| Il vous faut | Pourquoi |
|---|---|
| [VS Code](https://code.visualstudio.com/) 1.95 ou plus récent (1.101 ou plus récent pour Copilot) | il affiche les leçons et relie votre assistant |
| Un assistant d'IA que vous pouvez déjà utiliser : Copilot dans VS Code, Claude Code, Codex, Mistral Vibe, Claude Desktop, Cursor ou OpenCode | il construit les leçons à partir de vos sources, avec votre propre compte ; Studium n'a pas de compte et n'appelle aucun modèle |

La leçon de démonstration, comme toute leçon déjà faite par quelqu'un, se joue sans assistant et sans compte.

## 1. Installer l'extension

Dans VS Code, ouvrez la vue Extensions (l'icône à quatre carrés à gauche, ou `Cmd+Shift+X` sur macOS,
`Ctrl+Shift+X` ailleurs), cherchez **Studium** et choisissez **Installer** sur l'extension publiée par
HolobiomicsLab. Une icône **Studium** apparaît dans la barre d'activité.

Si Studium était déjà installé : la version 0.6.6 ne démarrait pas, et chaque commande Studium répondait
« command 'studium.…' not found ». Mettez l'extension à jour en 0.6.8 ou plus récente, puis lancez
**Développeur : Recharger la fenêtre** (**Developer: Reload Window**) depuis la palette de commandes (`Cmd+Shift+P` ou `Ctrl+Shift+P`).

## 2. Essayer « Découvrir Studium »

Sélectionnez l'icône **Studium**, puis **Découvrir Studium**. Cette leçon est livrée avec l'extension :
environ douze minutes, en français ou en anglais, sans compte d'IA. Vous apprenez Studium en l'utilisant (un
quiz avec son échelle de confiance, un indice, une réponse écrite comparée à une référence, la carte des
notions) et vous voyez où d'autre Studium se branche et ce qu'il apporte aux étudiants et aux enseignants. La
barre de progression vous ramène à une étape déjà faite. Un agent d'IA a rédigé cette leçon à partir de la
documentation de Studium ; le responsable du projet l'a approuvée, sous le nom beta-testeur, sans la lire.

## 3. Relier votre assistant

| Votre assistant | Que faire |
|---|---|
| Copilot dans VS Code, mode agent | rien : l'extension lui donne le serveur Studium. À son premier outil Studium, ouvrez la flèche à côté de **Autoriser une fois** (**Allow Once** si VS Code est en anglais) et choisissez **Toujours autoriser les outils de Studium** |
| Claude Code, Codex ou Mistral Vibe (leur extension VS Code, leur application ou leur ligne de commande), Claude Desktop, Cursor, OpenCode | dans la vue Studium, sélectionnez **Relier un assistant**, ou lancez **Studium : Relier un assistant…** depuis la palette de commandes ; cochez votre assistant, puis validez |

Redémarrez ensuite l'assistant : rechargez la fenêtre de VS Code pour celui qui tourne dans VS Code (la
notification a un bouton **Recharger la fenêtre**) ; quittez et
rouvrez Claude Desktop, Cursor ou OpenCode ; ouvrez une nouvelle session d'un assistant en ligne de commande.
La prochaine fois que vous ouvrez la liste, votre assistant y est marqué « relié ».

La commande écrit une entrée `studium` dans le fichier de configuration de l'assistant et garde une copie de
sauvegarde à côté. Cette entrée lance le serveur contenu dans l'extension, exécuté par le programme de
VS Code lui-même : voilà pourquoi Node n'est pas nécessaire. Si l'assistant avait déjà un serveur Studium sous
un autre nom, VS Code vous le signale : gardez-en un seul, sinon l'assistant liste chaque outil de Studium deux
fois. Chaque assistant a sa page sous [Connecter votre assistant](harnesses.fr.md).

## 4. Demander une leçon

Dans une nouvelle conversation avec votre assistant, avec vos mots :

> Je veux apprendre comment fonctionne le cycle de l'eau avec Studium. Utilise ces deux pages : (deux liens de confiance).

L'assistant vous montre un plan, puis construit la leçon. La construction prend quelques minutes, une seule
fois : la barre d'état indique **Studium · leçon en préparation…**, VS Code vous prévient quand la leçon est
prête, et elle apparaît dans la vue **Leçons**. Jouez-la là ou dans la conversation ; les étapes sont dans
[Apprendre avec votre assistant](../learn/learn-with-your-assistant.fr.md).

## Vérifier que tout marche

Demandez à votre assistant :

> Appelle l'outil Studium get_server_info et donne-moi la version et le nombre d'outils.

Il doit répondre avec une version, 0.6.8 ou plus récente, et 40 outils. Si l'assistant ne connaît pas l'outil,
voir [Dépannage](troubleshooting.fr.md#connexion-dun-assistant).

## Sans VS Code : Claude Desktop

Téléchargez `studium-vX.Y.Z.mcpb` depuis la
[dernière version publiée](https://github.com/HolobiomicsLab/Studium/releases/latest), double-cliquez dessus et
choisissez **Installer** dans Claude Desktop, qui le lance avec le Node qu'il embarque. Le paquet contient
« Découvrir Studium » ; demandez ensuite à Claude « Je veux apprendre X avec Studium ». Chaque publication
vérifie le manifeste du paquet et le serveur qu'il lance ; l'installation dans Claude Desktop lui-même n'a pas
encore été essayée.

## Quand Node est nécessaire

Seulement pour ces parcours, chacun décrit sur sa page :

- relier un assistant depuis un terminal avec `npx -y studium-mcp` ([Installation](installation.fr.md#ajouter-le-serveur-à-votre-assistant)) ;
- le plugin Claude Code, qui apporte aussi les skills ([Relier Claude Code](claude-code.fr.md)) ;
- le [lecteur dans le navigateur](browser.fr.md), qui joue une leçon dans un navigateur web ;
- préparer et approuver des cours depuis un clone ([Démarrage rapide](quickstart.fr.md)).

## Limites

- **Studium : Relier un assistant…** relie les assistants de cet ordinateur seulement, pas depuis une fenêtre
  distante (SSH, conteneur, Codespaces).
- L'entrée désigne le programme de VS Code et le dossier de l'extension. Après une mise à jour de
  l'extension, ouvrez VS Code une fois : il met à jour les entrées qu'il a écrites. Si vous désinstallez
  VS Code, reliez votre assistant d'une autre façon.
