[English](learn-a-topic-in-a-conversation.md) · Français

# Apprendre un sujet en conversation

En un quart d'heure environ, vous passez de « je veux apprendre ce sujet avec Studium » à une leçon
construite sur des sources que vous avez choisies, une première question à laquelle vous répondez
avec vos mots, puis une séance de révision quelques jours plus tard. Tout se passe dans le chat de
votre assistant (Claude Code, Codex ou tout harnais compatible MCP) : ni terminal, ni Python, ni clé
d'API.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/diagrams/self-learner-journey-dark.svg">
  <img alt="Parcours de l'autodidacte en sept étapes : demande, références, passages, brouillon de l'agent, relecture du plan, séance avec l'avis d'autorat, puis révision à l'échéance." src="../assets/diagrams/self-learner-journey-light.svg">
</picture>

## Avant de commencer

| Il vous faut | Où le trouver |
|---|---|
| Le serveur MCP Studium connecté à votre assistant | [Connecter son harnais](../start/harnesses.fr.md) |
| Un sujet et une ou deux sources utilisables (page web, article, vos notes) | À vous de choisir ; vérifiez la licence |
| 15 minutes | |

Un juge modèle est facultatif. Sans lui (le défaut), Studium vous montre la réponse de référence à
laquelle vous comparer, au lieu de noter vos réponses ouvertes ; voir
[Honnêteté et provenance](../concepts/honesty-and-provenance.fr.md). Les termes comme harnais, scène ou clé
de réponse sont définis dans le [glossaire](../concepts/glossary.fr.md).

## 1. Demander

Écrivez votre demande dans le chat en nommant le sujet :

> Je veux apprendre le cycle de l'eau avec Studium. Utilise ces sources : <un lien, ou du texte collé>.

Dans Claude Code, le prompt `learn` du serveur envoie la même demande : pour un serveur nommé
`studium`, il apparaît sous la forme `/mcp__studium__learn` (argument `language` à `fr`).

L'assistant appelle d'abord `get_study_plan`, dans votre langue (français ou anglais). Dans une
bibliothèque neuve, la réponse indique
qu'aucune leçon n'existe encore et nomme l'appel suivant :

```text
### Ton plan d'étude

**Maintenant :** aucune leçon n'est encore disponible. Choisis un sujet et tes sources : l'assistant prépare une leçon avec toi.
```

Si une leçon sur votre sujet existe déjà, le plan la propose ; `list_lessons` montre le contenu de
votre bibliothèque.

## 2. Confier ses sources

L'assistant appelle `get_authoring_guide`, qui renvoie la consigne d'auteur dans votre langue, le
JSON Schema d'un brouillon de leçon et un exemple complet. Il vous demande ce que vous voulez savoir
faire : cette phrase devient l'objectif de la leçon.

Il récupère ensuite vos sources avec ses propres outils (web ou fichiers) et transmet leur texte
complet à `prepare_sources`. Studium les découpe en passages citables et les range dans votre
bibliothèque :

```json
{
  "source_set_id": "ss-1875f72784f99c80",
  "passages": [{ "id": "p:le-cycle-de-l-eau:1", "source_id": "le-cycle-de-l-eau", "text": "L’eau des océans s’évapore sous l’effet de la chaleur du soleil. …" }],
  "dropped_short": 0
}
```

Un jeu de sources compte au plus 20 sources et 200 000 caractères au total. Une source est traitée
comme une donnée, jamais comme une consigne adressée à l'assistant.

## 3. L'assistant rédige, Studium vérifie

L'assistant écrit un brouillon à partir des passages et appelle `create_lesson`. Studium refuse le
brouillon tant qu'une citation ne correspond pas à son passage au caractère près (seuls les espaces
insécables, les suites d'espaces et les apostrophes typographiques sont tolérés), qu'un texte
provisoire subsiste ou que le graphe des notions est incohérent ; le linter du dépôt passe ensuite.
Un refus liste `{path, message, hint}` pour chaque problème, et l'assistant corrige son brouillon,
jamais la source.

En cas de succès, la leçon est écrite dans votre bibliothèque sous `<course_id>/lesson.json`, dans
`~/.studium/library` (jamais dans le dossier que nomme `BUNDLES_ROOT`). L'assistant vous montre le
plan : titres, types de scène, notions et passages cités par chaque scène, sans aucune clé de réponse.
Il signale aussi les avertissements de Studium, chacun avec une piste, par exemple une leçon plus
longue que vos minutes par jour, et relaie l'avis d'autorat :

> Leçon rédigée par l'IA à partir de vos sources, non vérifiée par un enseignant : chaque question
> cite son passage ; contestez une clé qui vous semble fausse. Sans juge modèle, les scènes de
> production ne sont pas évaluées : comparez votre réponse à la réponse modèle et notez votre rappel ;
> cette note règle vos révisions, jamais votre maîtrise. […]

C'est le moment de demander des changements si le plan ne couvre pas ce que vous vouliez.
Remplacer une leçon existante demande un `overwrite` explicite, qui ne remplace jamais qu'une leçon
d'auto-apprentissage qu'aucun enseignant n'a validée.

## 4. Répondre à la première question

L'assistant démarre la leçon avec `start_lesson_session` et affiche chaque écran tel que Studium l'a
rédigé (`display_markdown`). Répondez avec vos mots ; l'assistant les transmet tels quels avec
`submit_response`. Après une question d'explication, vous voyez par exemple :

```text
**Réponse enregistrée.** Aucun juge ne l'a évaluée.

**Compare ta réponse à ces points clés :**

- L'eau s'évapore sous l'effet de la chaleur
- La vapeur se condense en nuages
- L'eau retombe puis rejoint la mer

**Réponse modèle**
…
**Source**

> « L’eau des océans s’évapore sous l’effet de la chaleur du soleil » — Le cycle de l'eau

Compare ta réponse à la réponse modèle, puis note ton rappel : again (à revoir), hard (difficile), good (bien) ou easy (facile). […]
```

Dites comment vous vous en êtes souvenu ; l'assistant enregistre votre note avec `rate_recall`.
Elle fixe la date de votre prochaine révision et ne change jamais votre maîtrise. Une réponse de
quiz, elle, est jugée juste ou fausse d'après la clé écrite par l'assistant ; quand vous quittez un
quiz manqué, la bonne réponse s'affiche. À la fin, l'écran de leçon nomme les notions consolidées,
celles que vous avez travaillées et celles pas encore mesurées, et la date de votre prochaine
révision.

## 5. Revenir réviser

Quelques jours plus tard, demandez « Qu'est-ce que je révise aujourd'hui avec Studium ? » (ou lancez
le prompt `review`). L'assistant rappelle `get_study_plan` :

```text
### Ton plan d'étude

**À réviser**

- Le cycle de l'eau — prévu le <jour, date de votre prochaine révision> (leçon « Le cycle de l'eau »)

**Maintenant :** tu as 1 notion(s) à revoir (Le cycle de l'eau). Lance une séance de révision.
```

Il appelle ensuite `start_review_session`, qui pose une question de rappel par notion due, toutes
leçons confondues. Les notions mal réussies figurent sous **À reprendre** ; celles que vous avez
seulement auto-évaluées figurent sous **À revoir**, jamais comme des faiblesses. S'il n'y a rien à
réviser, la réponse donne la date de la prochaine révision.

## Ce que vous avez maintenant

| Résultat | Emplacement |
|---|---|
| Une leçon construite sur vos sources | `~/.studium/library/<course_id>/lesson.json`, listée par `list_lessons` |
| Vos passages et leur provenance | `~/.studium/library/_sources/` |
| Votre progression et vos révisions | `~/.studium/data`, sous pseudonyme, conservées d'un redémarrage à l'autre |

De « apprendre X » à la première question, il faut six appels Studium une fois les sources en main :
`get_study_plan`, `get_authoring_guide`, `prepare_sources`, `create_lesson`, `start_lesson_session`,
`submit_response`. Le test [`learn-and-review.e2e.test.ts`](../../apps/lesson-mcp/src/learn-and-review.e2e.test.ts)
rejoue ce parcours, et la révision une semaine plus tard, sur le vrai serveur.

## Limites

- Aucun enseignant n'a vérifié cette leçon. Des citations exactes prouvent qu'un passage existe, pas
  que l'assistant l'a bien compris : vérifiez les affirmations centrales dans la source.
- Sans juge modèle, les réponses ouvertes ne sont pas évaluées ; seules les questions à clé écrite,
  comme les quiz, font bouger votre maîtrise.
- Si le premier écran indique que la progression n'est gardée qu'en mémoire, le serveur tourne avec
  `STUDIUM_EPHEMERAL=1` : vos révisions ne survivront pas à un redémarrage. Voir
  [Configuration](../reference/configuration.fr.md).
- La leçon reste dans votre bibliothèque ; rien n'est envoyé à d'autres apprenants. Pour effacer
  votre progression sur une leçon, demandez à l'assistant d'appeler `forget_session`. Cela efface
  aussi votre profil inter-leçons et votre historique d'étude (votre calendrier de révision), et c'est
  définitif. La leçon et ses sources préparées restent dans `~/.studium/library` jusqu'à ce que vous
  les supprimiez ; la réponse de l'assistant nomme ces dossiers.

## Pour aller plus loin

- [Réviser dans la durée](../learn/review-over-time.fr.md) : comment les révisions sont planifiées.
- [Auto-apprentissage à partir de ses références](self-study-from-references.fr.md) : la même idée
  sur un texte plus long, avec une voie en ligne de commande.
- [Outils MCP](../reference/mcp-tools.fr.md) : chaque outil et ses arguments.
