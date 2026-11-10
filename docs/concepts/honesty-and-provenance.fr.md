[English](honesty-and-provenance.md) · Français

# Honnêteté et provenance

Studium dit à l'apprenant qui a écrit chaque clé de réponse, si quelque chose a réellement évalué sa réponse, et si un enseignant a validé la leçon. Cette page explique comment : classes de clé, juge, auto-évaluation, avis, citations des sources, registre d'approbation, et la règle selon laquelle aucun contenu n'atteint les étudiants sans un enseignant.

## Ce que déclare chaque leçon

`start_lesson_session`, `get_operator_context` (et donc le `task.md` du canal fichier) et chaque présentation portent un bloc `authoring`. Le panneau VS Code affiche son avis en bannière.

| Champ | Signification |
|---|---|
| `mode` | `teacher` (par défaut) ou `self_study` |
| `author_is_learner` | l'apprenant a écrit la leçon |
| `validated` | vrai seulement quand un registre d'approbation correspond à ce `lesson.json` exact ; jamais pour une leçon d'auto-apprentissage ; le texte de `validated_by` ne le donne jamais |
| `judge` | un juge modèle est configuré sur ce serveur |
| `notice` | le texte montré à l'apprenant pour une leçon d'auto-apprentissage ; null pour une leçon d'enseignant |
| `approval` | si un registre d'approbation existe (`approval.json` à côté de la leçon, ou le membre `approval.json` d'une leçon `.zip`), s'il correspond à ce `lesson.json` exact, et son relecteur (`reviewer`) |

L'auteur de la rédaction vient de `metadata.authoring.drafted_by` (`teacher`, `learner` ou `agent`) ; un bundle d'auto-apprentissage qui ne le précise pas est considéré comme rédigé par l'apprenant.

Le registre d'approbation est la seule source du statut validé. Chaque surface (premier écran de la
conversation, panneaux, `list_lessons`, page de la carte des notions) distingue trois états :

| État | Quand | Ce que lit l'apprenant |
|---|---|---|
| Approuvée | un registre correspond au sha256 du `lesson.json` chargé | « Leçon validée par <relecteur> » / "Lesson validated by <reviewer>", le nom étant pris dans le registre |
| Modifiée depuis l'approbation | un registre existe et ne correspond pas | un avis au premier écran : la leçon a été modifiée depuis son approbation |
| Aucun registre | pas de registre, ou un registre mal formé ou étranger | « Aucune approbation enregistrée pour cette leçon. » / "No approval is recorded for this lesson." |

La contribution d'un apprenant relue par un enseignant (`mode: "teacher"`, `drafted_by: "learner"`)
se lit comme proposée par une personne de la classe (« Leçon proposée par une personne de la classe,
validée par <relecteur>. », ou cette phrase suivie de celle de l'absence d'enregistrement), et sa clé
comme rédigée par une personne de la classe, jamais comme celle du lecteur. Une leçon
d'auto-apprentissage garde son propre avis et ne se lit jamais comme validée. Un nom écrit
à la main dans `validated_by`, sans registre, n'apparaît nulle part comme une validation.

## Classes de clé

Chaque type de scène appartient à l'une des quatre classes de clé ([`key-class.ts`](../../packages/lesson-session-host/src/key-class.ts)). `experience_packet.py check` les affiche sur sa ligne `Key classes:` et le lint les reprend.

| Classe | Types de scènes | Qui détient la clé | Dans une leçon d'auto-apprentissage |
|---|---|---|---|
| `ungraded` | `intro`, `concept`, `meta_checkpoint` | personne | rien n'est évalué |
| `author_keyed` | `quiz`, `spot_the_flaw` | l'auteur de la leçon | livre ouvert quand l'auteur est l'apprenant ; non vérifiée quand un agent l'a rédigée |
| `production` | `explain_back`, `comparison`, `summary_audit`, `prompt_practice`, `communication_sim`, `discussion`, `ai_critique` | un juge modèle, s'il est configuré | sans juge, la référence est montrée et rien n'est évalué |
| `externally_grounded` | `reproduction` | une exécution, vérifiée par rapport à son manifeste | la seule clé qu'aucun auteur n'a écrite |

## Le juge

Le juge est un modèle que le serveur joint via `LITELLM_BASE_URL`. `get_server_info` indique `model_backend: configured` ou `none`. Seule une évaluation dont la source est le modèle certifie une réponse rédigée ; une note de 0,6 ou plus compte comme juste.

Studium n'évalue plus les textes par mots-clés. Chercher des mots indices n'importe où dans une réponse mesure le vocabulaire, pas la compréhension : comparée à un enseignant sur une vraie leçon, cette méthode inversait 11 réponses sur 12. Sans juge, le retour montre la référence à laquelle se comparer et n'affiche aucun décompte.

## Qui a évalué une réponse

Chaque verdict dit qui a évalué la réponse dans `assessed_by` : `key` (la clé de l'auteur, pour un quiz ou un jeu de verdicts), `judge` (le modèle juge) ou `none` (personne : une réponse rédigée sans juge, un simple acquittement). `graded` signifie seulement qu'une réponse a été soumise. Le texte montré à l'apprenant ne marque ✓ que si `correct` vaut true et ✗ que s'il vaut false ; une réponse que personne n'a évaluée est affichée comme enregistrée.

Après la réponse, un verdict porte sa référence sous forme de données, étiquetée par `reference_kind` : les points clés qu'une réponse devrait couvrir, les défauts glissés, les affirmations qu'une critique devrait contester, ou `correct_choice`, le texte du bon choix quand un quiz a reçu une mauvaise réponse (« La bonne réponse »). Comme les passages cités, la référence n'est communiquée que lorsque l'apprenant quitte la scène pour de bon ; une nouvelle tentative sur le même item la retient.

## Auto-évaluation

Après une réponse rédigée qu'aucun juge n'a évaluée, l'apprenant note son rappel : again (à revoir), hard (difficile), good (bien) ou easy (facile). Cette note fixe la prochaine révision (FSRS) de chaque notion de la scène notée et ne modifie jamais la maîtrise. Son enregistrement porte `source: "self_rated"`, ce qui permet à un rapport de la distinguer d'une preuve évaluée. Voir [Modèle de l'apprenant](learner-model.fr.md#auto-évaluation).

## Avis

Une leçon d'auto-apprentissage commence par un avis dans sa langue (en français pour une leçon française, en anglais sinon). Il réunit une phrase sur l'auteur des clés et une phrase sur ce qui est évalué.

| Rédigée par | Première phrase |
|---|---|
| l'apprenant | « Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert). » |
| un agent | « Leçon rédigée par l'IA à partir de tes sources, non vérifiée par un enseignant : chaque question cite son passage ; signale à l'agent une clé qui te semble fausse. » |

| Juge | Seconde phrase |
|---|---|
| aucun | « Sans juge modèle, les scènes de production ne sont pas évaluées : compare ta réponse à la référence affichée et note ton rappel ; cette note règle tes révisions, jamais ta maîtrise. » |
| configuré | « Les scènes de production sont évaluées par le modèle. » |

Une leçon qui contient une reproduction ajoute une troisième phrase : « Les reproductions exécutées portent une évaluation externe. »

Les textes sont définis dans [`authoring.ts`](../../packages/lesson-session-host/src/authoring.ts).

## Sources et citations

Une leçon qu'un assistant rédige avec `create_lesson` cite un passage source pour chaque question évaluée. Chaque citation doit figurer dans le passage qu'elle nomme et compter de 15 à 500 caractères. Seul ce qu'une copie par un chat ou une page web modifie sans qu'on le voie est neutralisé : les espaces insécables et les suites d'espaces deviennent une seule espace, les apostrophes typographiques deviennent `'`. Les accents, la casse et le reste de la ponctuation, guillemets « » compris, restent significatifs. Une citation qui ne correspond pas est refusée, avec l'endroit où elle diverge, et la leçon n'est pas écrite.

La licence indiquée pour chaque source est recopiée dans les citations de la leçon (`evidence.bibliographic_refs[].license`) et affichée après le titre de la source ; une source préparée sans licence n'a pas de champ de licence.

Les passages cités d'une scène évaluée ne sont communiqués qu'après la réponse, quand l'apprenant quitte la scène pour de bon.

Une citation exacte prouve un lien textuel, pas que la question l'utilise correctement. C'est pourquoi l'avis des leçons rédigées par un agent invite l'apprenant à signaler à l'agent une clé qui lui semble fausse.

## Constats du lint sur l'autorat

`node tools/bundle_lint.mjs` ajoute ces constats quand `metadata.authoring` est présent. WARN et INFO ne font pas échouer l'exécution.

| Code | Niveau | Quand |
|---|---|---|
| `self_study_authoring` | INFO | toujours en auto-apprentissage : mode, rédacteur, classes de clé |
| `self_study_open_book` | WARN | scènes à clé d'auteur dont l'apprenant a écrit la clé |
| `self_study_agent_key` | WARN | scènes à clé d'auteur dont un agent a rédigé la clé ; vérifiez chacune avec son passage |
| `self_study_no_external_key` | WARN | aucune scène de production ni ancrée dans une exécution |
| `learner_authored_validated` | INFO | la leçon d'un apprenant diffusée comme bundle d'enseignant |

## Le registre d'approbation

Un enseignant enregistre l'approbation d'une leçon terminée avec :

```bash
.venv/bin/python tools/experience_packet.py approve --bundle chemin/vers/lesson.json --validated-by "Nom de l'enseignant"
```

La commande refuse une leçon qui contient encore des marqueurs à remplir, des erreurs de lint, ou qui est en mode auto-apprentissage (ce qui inclut les leçons rédigées avec `create_lesson`). Elle renseigne `validated_by` et `validated_at`, puis écrit `approval.json` (schéma `studium-approval/1`) à côté de la leçon, avec l'empreinte SHA-256 des octets exacts de `lesson.json`, le relecteur, la date, une liste de contrôle facultative (`--checklist CLE=VALEUR ...`) et le résumé du lint.

Le serveur lit ce registre et indique `approval.matches` : toute modification de `lesson.json` après l'approbation le rend faux. Une leçon diffusée en `.zip` porte son registre dans le membre `approval.json`, lié aux octets du membre `lesson.json`. Le registre est un fichier modifiable par quiconque a accès en écriture ; il documente une relecture, ce n'est pas une signature. L'outil MCP `review_lesson` permet à l'enseignant d'examiner un brouillon sans en voir les clés. Voir [Relire et approuver](../teach/review-and-approve.fr.md).

## Règle 003, un enseignant avant toute diffusion

La règle 003 du projet impose une validation humaine stricte : aucun contenu n'est diffusé aux étudiants sans validation par un enseignant. En pratique :

- un bundle d'enseignant ne se lit comme validé qu'avec un registre d'approbation lié à ses octets exacts (`approve` écrit aussi le nom dans `validated_by`, qui seul n'accorde rien) ;
- une leçon d'auto-apprentissage ou rédigée par un agent est destinée à l'apprenant qui l'a produite, et son avis le dit ;
- la contribution d'un apprenant n'atteint d'autres apprenants qu'après la décision d'un enseignant, voir [Contributions des apprenants](../teach/learner-contributions.fr.md).

Studium rend la provenance visible ; il ne certifie pas qu'une leçon est juste. La page [Confidentialité et limites](privacy-and-limits.fr.md) précise ce que prouvent, ou non, les empreintes, les citations et les contrôles d'exécution.
