[English](first-lesson.md) · Français

# Une première séance

Parcourez une leçon du début à la fin en restant l'auteur de vos réponses. Comptez 15 à 20 minutes
une fois Studium [installé](../start/installation.fr.md). La leçon livrée avec le dépôt,
`atomistique-l1/lesson.json` (atomistique de première année), suffit ; aucune clé d'API n'est
nécessaire. Les termes comme scène, indice ou harnais sont définis dans le
[glossaire](../concepts/glossary.fr.md).

## Voie A : le panneau de leçon dans VS Code

1. Installez l'extension comme indiqué dans [VS Code](../start/vscode.fr.md).
2. Lancez **Studium : Ouvrir une leçon**, ou **Studium : Choisir un cours** pour choisir parmi les
   leçons trouvées.
3. Lisez l'introduction, ouvrez les ressources, puis continuez jusqu'à la première question.
4. Répondez vous-même ; demandez un indice si besoin. À un point d'étape, déclarez votre propre
   confiance.
5. Lisez le retour, présenté comme une étape à part, avant d'avancer. Après une réponse ouverte
   qu'aucun juge n'a évaluée, notez votre rappel avec les boutons (again, hard, good, easy) : cette
   note fixe votre prochaine révision et ne change jamais votre maîtrise.
6. À la fin, l'écran de clôture indique ce que vous avez consolidé et la date de votre prochaine
   révision.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/vscode-pane-feedback-dark.png">
  <img alt="Le panneau de leçon Studium dans VS Code après une réponse : le verdict, la référence à laquelle se comparer et la source citée, puis le bouton pour continuer." src="../assets/screenshots/vscode-pane-feedback-light.png" width="420">
</picture>

Le notebook est une autre surface : **Studium : Ouvrir la leçon en notebook** joue la même leçon
cellule par cellule. Le panneau et le participant de chat (`@studium` dans la vue Chat) sont
présentés dans [VS Code](../start/vscode.fr.md).

## Voie B : un assistant par MCP

Connectez votre harnais comme dans [Connecter son harnais](../start/harnesses.fr.md), avec
`BUNDLES_ROOT` pointant vers le dossier `fixtures/` du dépôt, comme le font les configurations
d'exemple de [`docs/examples/`](../examples/). Envoyez ensuite :

> Lis `skills/studium-harness/SKILL.md`. Nous faisons une séance étudiante, pas une simulation de
> réponses. Démarre `atomistique-l1/lesson.json` avec Studium. Affiche chaque écran tel que Studium
> l'a rédigé, un à la fois, attends ma réponse et transmets mes propres mots. N'invente ni réponse,
> ni niveau de confiance, ni résultat d'exécution, et ne consulte pas les corrigés.

L'assistant fait ces appels ; les identifiants ci-dessous sont des gabarits. `start_lesson_session`
reçoit :

```json
{"bundle_ref": "atomistique-l1/lesson.json", "learner_id": "demo-local"}
```

La réponse porte un `session_id` et une `presentation` dont le `display_markdown` est l'écran à
afficher tel quel. Votre réponse repart avec vos mots :

```json
{"session_id": "ID_RETOURNE_PAR_LE_SERVEUR", "input": {"kind": "reply", "text": "b"}}
```

`{kind: "reply", text}` accepte ce que vous taperiez dans un chat : la lettre d'un choix, une
confiance de 0 à 4, une phrase, ou « continuer » sur un écran de lecture. Après la réponse,
l'assistant affiche d'abord `verdict.display_markdown`, puis l'écran suivant. Autres appels utiles :

| Appel | Usage |
|---|---|
| `request_hint` | Un indice sur la question en cours, sans avancer |
| `explain_last_adaptation` | Pourquoi Studium a choisi la scène suivante |
| `get_operator_context` | La scène publique, ses ressources et la forme de réponse attendue |
| `end_session` | S'arrêter en gardant sa progression |

`tools/list` dans votre harnais est l'inventaire qui fait foi ; la référence
[Outils MCP](../reference/mcp-tools.fr.md) décrit chaque outil.

## Petit exercice de jugement

Avant de changer un paramètre d'une ressource, écrivez une prédiction en une phrase. Après
observation, dites ce qui la confirme ou la contredit. Demandez à l'assistant un cas nouveau qui
pourrait mettre l'explication en défaut, dans le périmètre fixé par l'enseignant. La réponse finale
reste la vôtre ; le visualiseur et le texte de l'assistant sont des matériaux à examiner.

## Vérifier que la séance fonctionne

- Un appel réel a renvoyé la scène et les outils attendus.
- Une réponse personnelle a produit un retour ou une transition.
- Le retour vient de la séance utilisée, sans mélange entre panneau et chat.
- Une éventuelle exécution est signalée comme faite, échouée ou non faite.

Cela vérifie la connexion et le déroulement, pas l'efficacité du cours.

## Pour aller plus loin

- [Apprendre un sujet en conversation](learn-a-topic-in-a-conversation.fr.md) : construire une
  leçon à partir de vos propres sources.
- [Une expérience scientifique avec son agent](agentic-experiment.fr.md).
- Outils absents ou scène immobile : [Dépannage](../start/troubleshooting.fr.md).
