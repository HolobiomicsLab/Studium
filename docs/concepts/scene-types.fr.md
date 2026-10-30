[English](scene-types.md) · Français

# Types de scènes

Une leçon Studium se compose de 13 types de scènes. Cette page indique, pour chacun, ce qu'il demande à l'apprenant, comment la réponse est évaluée, qui détient la clé, et si la réponse peut faire évoluer la maîtrise mesurée. Elle vous aide à choisir vos scènes quand vous rédigez une leçon, ou à comprendre le retour que vous recevez en tant qu'apprenant.

## Les 13 types en un coup d'œil

| Type | Ce que fait l'apprenant | Réponse | Classe de clé | Peut faire évoluer la maîtrise |
|---|---|---|---|---|
| `intro` | Découvre l'objectif et le parcours de la leçon | accusé de lecture | non évaluée | non |
| `concept` | Lit et manipule une idée | accusé de lecture | non évaluée | non |
| `meta_checkpoint` | Déclare sa confiance (de 0 à 4), une fois ou avant et après | confiance | non évaluée | non ; alimente la calibration |
| `quiz` | Choisit une réponse | choix | clé d'auteur | oui |
| `spot_the_flaw` | Repère les erreurs d'un texte volontairement fautif | jeu de verdicts ou texte libre | clé d'auteur | oui pour le jeu de verdicts ; texte libre seulement avec un juge |
| `ai_critique` | Critique une production de l'IA | texte libre | production | seulement avec un juge |
| `explain_back` | Explique l'idée avec ses mots, comme s'il l'enseignait | texte libre | production | seulement avec un juge |
| `comparison` | Compare deux objets ou deux explications | texte libre | production | seulement avec un juge |
| `summary_audit` | Vérifie les omissions et déformations d'un résumé produit par l'IA | texte libre | production | seulement avec un juge |
| `prompt_practice` | Rédige ou améliore une consigne pour une tâche | texte libre | production | seulement avec un juge |
| `communication_sim` | Transmet un message à un public, dans un rôle professionnel | texte libre | production | seulement avec un juge |
| `discussion` | Raisonne avec un tuteur sur plusieurs tours | tours (`submit_turn`) | production | non |
| `reproduction` | Fait exécuter un protocole par le harnais, puis examine le résultat | résultat d'exécution | ancrée dans une exécution | non ; ancre les audits suivants |

Le *juge* est un modèle configuré sur le serveur (`LITELLM_BASE_URL`). Les classes de clé sont définies dans [`key-class.ts`](../../packages/lesson-session-host/src/key-class.ts) et expliquées dans [Honnêteté et provenance](honesty-and-provenance.fr.md).

## Comment chaque famille est évaluée

### Scènes de lecture

`intro` et `concept` se terminent quand l'apprenant passe à la suite. Rien n'est évalué ni enregistré comme preuve.

### Points de confiance

`meta_checkpoint` enregistre une confiance de 0 à 4 pour un concept. Studium la compare à la maîtrise mesurée de ce concept : l'écart est la calibration de l'apprenant. Un écart important peut ouvrir un panneau de calibration (modulateur M3). La réponse n'est jamais juste ou fausse. Voir [Modèle de l'apprenant](learner-model.fr.md#calibration).

### Choix

`quiz` compare l'option choisie à la clé. La mise à jour corrige l'effet du hasard : sur une question à deux options, un apprenant qui répond au hasard n'apparaît plus maîtriser à 50 %. Les quiz proposent des indices (`request_hint`), qui réduisent le crédit d'une bonne réponse.

### Audits avec un jeu de verdicts

`spot_the_flaw` peut présenter un *jeu de verdicts* : l'apprenant marque chaque affirmation comme fautive ou correcte. Le jeu est comparé à la clé élément par élément, jamais en cherchant des mots. Il est réussi quand au moins 60 % des défauts placés sont repérés et qu'au moins la moitié des affirmations correctes ne sont pas signalées : tout signaler ne suffit donc pas. Quand la scène s'appuie sur un résultat réellement exécuté, le jeu mesure aussi l'excès de confiance ou de méfiance envers une lecture faite par l'IA.

### Réponses rédigées

`ai_critique`, `explain_back`, `comparison`, `summary_audit`, `prompt_practice`, `communication_sim` et la forme rédigée de `spot_the_flaw` sont comparés à des points clés ou à des défauts placés par l'auteur.

- **Avec un juge**, le modèle note la réponse ; une note de 0,6 ou plus compte comme juste et fait évoluer la maîtrise. Le retour peut alors donner un décompte mesuré, par exemple les points clés couverts.
- **Sans juge**, la réponse n'est pas évaluée. Le verdict affiche la référence à laquelle se comparer et demande à l'apprenant de noter son rappel : again (à revoir), hard (difficile), good (bien) ou easy (facile). Cette note règle les révisions et ne modifie jamais la maîtrise. Aucun décompte du type « X sur Y couverts » n'est affiché, puisque rien ne l'a mesuré.

La référence arrive comme une donnée du verdict, étiquetée par `reference_kind` :

| `reference_kind` | Types de scènes | Ce à quoi l'apprenant se compare |
|---|---|---|
| `key_points` | `explain_back`, `comparison`, `prompt_practice`, `communication_sim` | les points qu'une bonne réponse couvre, et une réponse modèle |
| `planted_flaws` | `spot_the_flaw`, `summary_audit` | les affirmations qui cachaient un défaut, et la correction modèle |
| `flawed_claims` | `ai_critique` | les affirmations qui cachaient un défaut, avec les défauts attendus par l'auteur |
| `correct_choice` | `quiz`, après une mauvaise réponse | le texte du bon choix (« La bonne réponse ») |

Chaque verdict dit aussi qui a évalué la réponse dans `assessed_by` : `key`, `judge` ou `none`. Voir
[honnêteté et provenance](honesty-and-provenance.fr.md#qui-a-évalué-une-réponse).

### Discussion

`discussion` est un dialogue de quelques tours sur un sujet et une affirmation de départ. Quand un modèle est configuré, chaque tour est classé comme un geste de raisonnement (justification, hypothèse, question, contre-exemple ou synthèse) et un tuteur socratique répond ; une réponse qui révélerait la solution est remplacée par une relance neutre. Cette scène ne fait jamais évoluer la maîtrise.

### Reproduction

Dans une `reproduction`, le harnais prépare et exécute un protocole décrit par le manifeste d'exécution de la scène ; Studium n'exécute jamais de code lui-même. Le harnais renvoie un résultat (`submit_run_result` ou le canal fichier). Studium vérifie qu'il est cohérent avec le manifeste : sorties déclarées produites, contrôles déclarés rapportés et réussis, ligne repère (*landmark*) renvoyée. Une exécution incohérente peut faire avancer la leçon mais n'ancre jamais un jugement. Une exécution cohérente peut ancrer un `spot_the_flaw` ultérieur : l'apprenant audite alors une lecture par l'IA de son propre résultat. Cela relève le niveau d'exigence face aux exécutions partielles ou bâclées ; ce n'est pas une preuve cryptographique d'exécution.

## Difficulté

Le poids d'une réponse dépend du niveau de Bloom de son concept : `remember` 0,3, `understand` 0,5, `apply` 0,6, `analyze` 0,7, `evaluate` 0,8, `create` 0,9. Sans niveau de Bloom, un quiz pèse 0,5 et les autres types évalués 0,7. Une question plus difficile rapporte moins quand elle est réussie et coûte davantage quand elle est manquée.

## Notes pour la rédaction

- Un assistant qui utilise `create_lesson` peut rédiger tous les types sauf `reproduction`, qui exige un manifeste d'exécution et une capsule.
- Une leçon d'auto-apprentissage ou rédigée par un agent qui ne contient que des scènes à clé d'auteur reçoit l'avertissement de lint `self_study_no_external_key` : ajoutez une scène de production évaluée par un juge, ou une reproduction.
- Les schémas champ par champ sont dans la [référence du bundle](../reference/lesson-bundle.fr.md) ; les évaluateurs sont dans [`graders.ts`](../../packages/lesson-session/src/grading/graders.ts).
