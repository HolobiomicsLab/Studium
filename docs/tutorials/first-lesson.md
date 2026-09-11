# Tutoriel — une première séance

**Objectif :** parcourir une activité en gardant l'étudiant auteur de ses réponses.
Prévoir 15–20 minutes après l'[installation](../getting-started/installation.md).
Le bundle local `atomistique-l1/lesson.json` suffit ; aucune clé API backend.

## Route A : panneau Studium

1. Ouvrir le dossier de l'extension et lancer F5 comme indiqué dans l'installation.
2. Dans la fenêtre de développement, lancer **Studium: Open Lesson**.
3. Lire l'introduction, afficher les assets, puis continuer jusqu'à une activité.
4. Répondre personnellement ; essayer un indice si utile. Au checkpoint, déclarer
   sa propre confiance. Observer le feedback et le graphe du parcours.
5. Noter une décision que l'on souhaite comprendre et demander son explication.

Le notebook est une autre surface : sa cellule pilote accepte `next`, un
identifiant de choix, une confiance de `0` à `4`, du texte ou `hint` selon la scène.
Voir le [guide extension](../../apps/studium-vscode/README.md).

## Route B : harnais avec MCP

Connecter [Copilot](../getting-started/copilot.md) ou
[un autre client](../getting-started/harnesses-and-api.md). Envoyer :

> Lis `skills/studium-harness/SKILL.md`. Nous faisons une séance étudiante,
> pas une simulation de réponses. Vérifie les outils disponibles, démarre
> `atomistique-l1/lesson.json` et lis le contexte opérateur public. Présente une
> activité à la fois, attends ma réponse, puis soumets mes propres mots avec
> le type requis. Demande ma confiance seulement si utile au contrat. N'invente
> ni réponse, ni confiance, ni résultat d'exécution et ne consulte pas les corrigés.

L'agent utilise ces appels. Les identifiants ci-dessous sont des gabarits :

```json
{"bundle_ref":"atomistique-l1/lesson.json","learner_id":"demo-local"}
```

Ce sont les arguments de `start_lesson_session`. Avec le `session_id` réellement
retourné, appeler `get_operator_context` :

```json
{"session_id":"ID_RETOURNE_PAR_LE_SERVEUR"}
```

Le contexte fournit scène publique, assets, instructions et exemple canonique de
réponse. Pour une introduction qui attend `ack`, `submit_response` peut recevoir :

```json
{"session_id":"ID_RETOURNE_PAR_LE_SERVEUR","input":{"kind":"ack"}}
```

Pour les autres scènes, lire le contrat courant : un `ack` universel ou un texte
à la place d'un choix ne convient pas. Utiliser `request_hint` pour un indice et
`explain_last_adaptation` pour interroger la décision. `tools/list` est l'inventaire
faisant autorité, y compris après mise à jour.

## Petit exercice de jugement

Avant de changer un paramètre d'un asset, écrire une prédiction en une phrase.
Après observation, dire ce qui la confirme ou la contredit. Demander à l'agent
un cas nouveau qui pourrait mettre l'explication en défaut, dans le périmètre
enseignant. La réponse finale reste personnelle ; le visualiseur et le texte de
l'IA servent de matériaux à examiner.

## Vérifier que la séance fonctionne

- Un appel réel a retourné la scène et les outils attendus.
- Une réponse personnelle valide a produit une transition ou un feedback.
- Le feedback vient de la séance utilisée, sans mélange entre panneau et chat.
- Un éventuel run est identifié comme exécuté, échoué ou non exécuté.

Cela vérifie la connexion et le déroulement, pas l'efficacité du cours.
Suite : [expérience agentique](agentic-experiment.md). Outils absents ou scène
immobile : [dépannage](../troubleshooting.md).
