[English](fast-answers.md) · Français

# Garder des réponses rapides

Studium note une réponse et choisit l'écran suivant en quelques millisecondes. Ce que vous attendez, c'est
l'assistant qui relaie. Trois choix décident de l'essentiel de cette attente :

- **Une session pour la leçon.** Jouez une leçon dans une session neuve et courte, pas à la fin d'une longue
  conversation de travail : chaque réponse traîne toute la conversation derrière elle.
- **Un modèle rapide.** Relayer ne demande aucun raisonnement, puisque Studium note et oriente. Gardez le
  grand modèle pour une question qui demande une vraie explication.
- **La connexion MCP** décrite dans [Connecter votre assistant](harnesses.fr.md), et non des appels shell à l'API HTTP : chaque appel shell
  lance un processus.

## Ce qui a été mesuré

Mesuré sur la leçon de démonstration `atomistique-l1` avec `tools/latency_bench.py` (Claude Code, médianes
sur six réponses, 6 novembre 2026) :

| Qui relaie | Fin de la réponse | Premier mot |
|---|---|---|
| un grand modèle, par appels shell, à la fin d'une longue session de travail (essai réel, application de bureau) | 27 s | environ 20 s |
| le même grand modèle, session courte, outils MCP | 8,2 s | 5,4 s |
| le modèle rapide, session courte, outils MCP | 5,4 s | 2,0 s |
| l'agent de leçon `studium-lesson` comme session (voir [Claude Code](claude-code.fr.md#utiliser-lagent-de-leçon)) | 5,5 s | 1,9 s |
| un grand modèle qui confie chaque réponse à cet agent rapide | 16,1 s | 13,5 s |

Une exécution par ligne : un écart d'une seconde entre deux lignes n'est pas établi. Le banc mesure un
relais dans Claude Code ; il ne mesure ni les autres clients de cette page, ni ce que quiconque apprend.
Baisser l'effort de raisonnement n'a rien changé de mesurable. La dernière ligne est le piège : un agent
placé entre vous et le serveur fait écrire chaque écran par deux modèles.

## Jouer en formulaires

Un prototype va un pas plus loin : là où le client sait afficher des formulaires (élicitation MCP),
`play_in_forms` laisse Studium poser lui-même les questions. Vous lisez un écran ou choisissez une réponse
dans un formulaire, le verdict ouvre le formulaire suivant, et aucun modèle n'écrit entre les deux ; la
conversation reprend quand une étape demande vos propres mots ou quand vous fermez un formulaire pour poser
une question. Quand la leçon possède une carte des notions, chaque formulaire d'étape propose `map` : le
formulaire de carte liste chaque notion avec son identifiant, revient à l'étape intacte s'il est validé vide,
ou prend `contest_concept` et `claim` (`known` ou `unsure`) pour poser les questions de contrôle avant de
reprendre cette étape. Seuls un indice, une question ou une proposition demandent encore la conversation,
comme l'indique la ligne d'aide. Un formulaire ne vous demande jamais de dire « continuer », puisqu'on ne
peut rien y dire. Demandez à votre assistant de « jouer les prochaines étapes en formulaires ». La façon dont
un vrai client affiche un écran long, une formule ou ce formulaire de carte n'a pas encore été observée.

Sans modèle entre les deux, la part du serveur est petite : une réponse donnée dans un formulaire ou sur un
panneau reçoit son verdict en moins de 20 ms au 95e centile, transport compris (même script, `--mode forms`
et `--mode panel`, trois exécutions de 32 à 40 réponses chacune, l'état de l'apprenant enregistré sur
disque, 6 novembre 2026). Le temps qu'un client met ensuite à dessiner l'écran n'est pas dans ce chiffre et
n'a pas été mesuré.

