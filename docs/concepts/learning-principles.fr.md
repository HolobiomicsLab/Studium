[English](learning-principles.md) · Français

# Principes d'apprentissage

Studium repose sur quelques principes : comment on apprend, et comment une évaluation doit se comporter. Pour chacun, cette page dit ce que Studium fait réellement dans le code, puis le compare brièvement à d'autres manières d'étudier avec un logiciel. Elle expose une intention de conception ; elle n'affirme pas que Studium améliore l'apprentissage de façon démontrée.

## 1. Pratique de récupération, répondre avant de voir

Se remémorer une réponse est déjà un moment d'apprentissage : Studium demande avant de montrer.

- Aucune clé n'atteint l'apprenant avant sa réponse, sur aucune surface (MCP, canal fichier, HTTP, VS Code).
- La réponse de référence et les passages cités ne sont communiqués qu'après la réponse, une fois la scène quittée.
- Les révisions redemandent plutôt que de remontrer : `start_review_session` construit une scène de récupération par concept dû, toutes leçons confondues, en évitant si possible la question posée la dernière fois.

## 2. Espacement, revenir quand le rappel s'estompe

Chaque concept a une mémoire de révision (FSRS) qui estime la probabilité que vous vous en souveniez. Un concept est dû quand cette probabilité descend à 0,9. `get_study_plan` liste en un seul appel ce qui est dû, toutes leçons confondues. Studium utilise les poids FSRS par défaut publiés et une cible fixe ; il ne les ajuste pas à chaque apprenant. Voir [Modèle de l'apprenant](learner-model.fr.md#la-rétention-avec-fsrs) et [Réviser dans la durée](../learn/review-over-time.fr.md).

## 3. L'effort avant l'aide

L'aide existe, mais elle a un coût : l'apprenant essaie d'abord.

- Un quiz propose un indice rédigé par l'auteur dans le parcours standard, tous les indices dans l'univers de remédiation.
- Chaque indice réduit le crédit d'une bonne réponse (1,5, puis 0,5, puis 0,3 à difficulté moyenne) et donne une note de révision plus faible.
- Dans une `discussion`, la réponse du tuteur est remplacée par une relance neutre quand elle révélerait la solution.

## 4. Un retour qui cite sa source

Le retour renvoie à la référence et à son origine, pas seulement à une note.

- Un verdict évalué porte sa référence comme donnée : points clés, défauts placés ou affirmations fautives, et une réponse modèle.
- Dans une leçon rédigée à partir de vos sources, chaque question évaluée cite un passage, et chaque citation est vérifiée caractère par caractère avant l'écriture de la leçon.
- Un décompte comme « 3 points clés sur 4 » n'apparaît que si un juge l'a mesuré.

## 5. Un graphe de concepts explicite

Le parcours est un graphe lisible, pas une séquence cachée. Concepts et tâches sont reliés par des arêtes typées (`prerequisite_for`, `part_of`, `decomposes_into`, `assesses`, `aligns_with`). Un prérequis manquant conduit l'apprenant vers lui, puis le ramène. L'enseignant peut examiner et corriger le graphe dans le bundle ; l'apprenant le voit dans le panneau VS Code.

## 6. Une évaluation honnête

Une estimation ne vaut que par les preuves qui la fondent.

- Seuls un choix noté, un jeu de verdicts comparé à sa clé ou un juge font évoluer la maîtrise. Les correspondances de mots-clés, non.
- Une réponse que personne n'a évaluée n'est pas comptée comme fausse, et un concept jamais révisé n'est pas compté comme oublié.
- L'auto-évaluation règle les révisions et ne modifie jamais la maîtrise.
- Chaque leçon dit qui a écrit ses clés et si un enseignant l'a validée. Voir [Honnêteté et provenance](honesty-and-provenance.fr.md).

## 7. Savoir ce que l'on sait

Les points de confiance comparent ce que l'apprenant déclare à ce qu'il a montré. Un écart important ouvre un panneau de calibration, et un excès de confiance mesuré retient une certification de maîtrise. Les audits ancrés mesurent, à part, à quel point l'apprenant se fie à une lecture fautive d'un résultat réel par l'IA. Voir [Modèle de l'apprenant](learner-model.fr.md#calibration).

## 8. Local d'abord

L'état de l'apprenant reste par défaut sur sa machine, dans des dossiers nommés par des pseudonymes, et peut être effacé. Les rapports de classe sont des agrégats avec un plancher de cinq apprenants. Voir [Confidentialité et limites](privacy-and-limits.fr.md).

## Comparaison avec d'autres modes d'étude

Ces comparaisons décrivent uniquement les sources citées, et ce que Studium fait autrement.

| Approche | Ce que décrit la source | Ce que Studium fait autrement |
|---|---|---|
| [Mode étude de ChatGPT](https://openai.com/index/chatgpt-study-mode/) | Un mode d'étude intégré à un assistant conversationnel généraliste | Studium se place derrière n'importe quel assistant, sous forme de leçon avec des clés explicites, un graphe de concepts et un modèle d'apprenant durable ; l'assistant relaie, l'apprenant répond |
| [LearnLM](https://arxiv.org/abs/2412.16429) | Améliorer le comportement pédagogique d'un modèle en l'entraînant à suivre des consignes pédagogiques | Studium agit au niveau de la leçon et de ses preuves, quel que soit le modèle ; la pédagogie est dans le bundle, les règles et l'évaluation |
| [Learn Your Way](https://research.google/blog/learn-your-way-reimagining-textbooks-with-generative-ai/) | Un manuel adapté au niveau scolaire et aux centres d'intérêt, sous plusieurs représentations, avec des quiz par section ; une étude randomisée sur 60 élèves rapporte de meilleurs scores à un test de rétention 3 à 5 jours plus tard | Studium ne réécrit pas la source selon les centres d'intérêt ; il en tire des scènes et des clés, cite les passages et dit qui a écrit chaque clé |
| [Anki](https://docs.ankiweb.net/faqs/what-spaced-repetition-algorithm) | Des cartes planifiées par une variante de SM-2 ou par FSRS, avec une rétention cible | Studium planifie des concepts plutôt que des cartes, et sépare ce qui planifie une révision (toute note) de ce qui mesure la maîtrise (les seules preuves évaluées) |
| [Rétention optimale FSRS](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-optimal-retention) | La rétention cible est un compromis entre charge de travail et souvenirs retenus, et l'optimum varie d'un apprenant à l'autre | Studium utilise une cible fixe de 0,9 et les poids par défaut ; l'optimisation par apprenant n'est pas implémentée |
| [MCP Apps](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/) | Une extension proposée de MCP pour des interfaces interactives dans les applications de chat (ressources `ui://`) | Studium renvoie un texte prêt pour tout chat (`display_markdown`) et rend la même vue publique de leçon en panneau VS Code, en panneau MCP Apps ou en volet natif Claude Code, selon ce que l'hôte sait afficher ; voir [Panneaux de leçon dans les harnais IA](../start/harness-panels.fr.md) |

Studium peut se combiner avec ces approches : un harnais doté de n'importe quel modèle, ou n'importe quelle habitude d'étude, peut piloter une leçon Studium via MCP.
