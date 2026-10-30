# Tutoriel — une leçon d'auto-apprentissage à partir de ses références

**Objectif :** construire seul, avec son harnais, une leçon jouable à partir d'une
source choisie, puis la jouer dans le panneau ou par MCP. Aucun enseignant, aucun
connecteur Perspicacité ni second fournisseur API n'est nécessaire. Prévoir
30–45 minutes avec l'[installation Python](../getting-started/installation.md)
terminée. Le skill [`studium-self-learner`](../../skills/studium-self-learner/SKILL.md)
conduit l'agent dans les mêmes étapes.

L'exemple utilise Émile Durkheim, *Les Règles de la méthode sociologique*,
chapitre I « Qu'est-ce qu'un fait social ? », sur Wikisource. Le texte est dans
le domaine public ; les ajouts propres au site (notes, mise en page) suivent la
licence de Wikisource. Pour une autre source, vérifier sa licence avant de
commencer : un PDF d'éditeur ou une licence `NC`, `ND` ou inconnue restreint ce
qu'on peut faire de la leçon.

Ce que l'apprenant fait : formuler l'objectif, fournir la source, relire le plan
proposé, puis jouer la leçon. Ce que l'agent fait : extraire les passages, rédiger
le plan et les scènes avec des citations exactes, lancer les vérifications.

## 1. Extraire les passages

Depuis la racine du dépôt, choisir des dossiers de sortie nouveaux :

```sh
.venv/bin/python tools/experience_packet.py passages --url "https://fr.wikisource.org/wiki/Les_R%C3%A8gles_de_la_m%C3%A9thode_sociologique/Chapitre_1" --title "Les Règles de la méthode sociologique, chapitre I" --license public-domain --out /ABS/PATH/auto-etude/passages.json
```

Remplacer `/ABS/PATH` par un emplacement personnel. La commande accepte aussi
`--html FICHIER`, `--pdf FICHIER` ou `--text FICHIER` à la place de `--url`, et
borne la taille des passages avec `--min-chars` (200 par défaut) et `--max-chars`
(1200 par défaut). Elle écrit une enveloppe inerte
`{ "success": true, "origin": "self-study-passages/1.0", "results": [...] }`,
du même rôle que l'enveloppe Perspicacité du
[tutoriel littérature](literature-to-course.md) : ce sont les seuls textes que la
leçon pourra citer.

Sur une page Wikimedia, la commande ignore la navigation, le pied de page, les
catégories et les liens de modification. Un paragraphe trop court (un titre, une
note) est d'abord fusionné avec les paragraphes qui le suivent, sinon rattaché au
passage précédent, au lieu d'être perdu ; le compte `dropped_short` indique ce qui
a tout de même été écarté. Les notes qu'une page regroupe à la fin rejoignent donc
le dernier passage du corps, pas le paragraphe qui les appelle. Parcourir quand même les passages : un
passage parasite (métadonnées du site, appel de note isolé) peut rester. Il suffit
de ne pas le citer ; `check` le comptera parmi les passages non cités. Si
l'extraction est surtout faite de tels passages, repartir d'un fichier texte
nettoyé avec `--text`.

## 2. Préparer le dossier d'auteur

```sh
.venv/bin/python tools/experience_packet.py prepare --passages /ABS/PATH/auto-etude/passages.json --title "Qu'est-ce qu'un fait social ?" --target "Autodidacte, niveau licence" --out /ABS/PATH/auto-etude/packet
```

Le dossier contient `evidence.json`, `author-task.md` et `response.schema.json`,
décrits dans le [tutoriel littérature](literature-to-course.md#1-rejouer-le-petit-exemple-livré).
Comme l'enveloppe vient de `passages` (origine `self-study-passages/…`), `prepare`
écrit une consigne d'auteur propre à l'auto-apprentissage, et non la consigne
enseignant, et préfixe les identifiants de preuve par `passage:` (`--self-study` force cette
consigne pour une enveloppe d'une autre origine ; le préfixe, lui, suit l'origine).
La destination
peut être un dossier vide déjà créé ; un dossier non vide est refusé, `prepare`
n'ayant pas d'option `--force` : choisir alors un nouveau chemin.

## 3. Faire rédiger le plan par l'agent

L'apprenant donne l'objectif ; l'agent écrit la réponse d'auteur. Prompt :

> Lis `author-task.md`, `evidence.json` et `response.schema.json` du packet.
> Mon objectif : savoir dire ce qui distingue un fait social d'un fait individuel
> selon Durkheim, et l'appliquer à un exemple nouveau. Écris `author-response.json`
> en français (`language: "fr"`), avec des citations exactes des passages et leurs
> identifiants de preuve. Privilégie les scènes où je produis un texte
> (`explain_back`, `comparison`, `summary_audit`) ; au plus un quiz. Garde
> `status: draft` et `validated_by: null`. Montre-moi ensuite le plan (objectifs,
> concepts, titres et types de scènes, sources) sans les réponses attendues.

Relire ce plan et demander les corrections utiles : un concept manquant, une
scène trop longue, un exemple hors du texte. Ne pas ouvrir `author-response.json`
soi-même : il contient déjà ce que l'agent attend.

Le champ `learning_workflow_graph` de la réponse est facultatif : `bundle` dérive
le graphe des `prerequisites` déclarés sur chaque concept.

## 4. Vérifier le brouillon et lire les classes de clé

```sh
.venv/bin/python tools/experience_packet.py check --packet /ABS/PATH/auto-etude/packet --response /ABS/PATH/auto-etude/author-response.json --out /ABS/PATH/auto-etude/courses/durkheim-fait-social
```

Les sorties sont celles du tutoriel littérature (`plan.json`, `source_links.json`,
`review.md`…). Une citation qui n'est pas une sous-chaîne exacte de son passage
produit `ERROR` : l'agent corrige le brouillon, jamais la preuve. La licence
`public-domain` n'émet pas l'avertissement réservé aux licences `NC`, `ND` ou
inconnues.

La ligne `Key classes:` range les identifiants de scène selon l'origine de leur clé :

| Classe | Types de scène | Ce que cela veut dire ici |
|---|---|---|
| `ungraded` | intro, concept, meta_checkpoint | Rien n'est évalué |
| `author_keyed` | quiz, spot_the_flaw | La clé est écrite par celui qui répondra : livre ouvert |
| `production` | explain_back, comparison, summary_audit, prompt_practice, communication_sim, discussion, ai_critique | L'apprenant produit un texte ; sans juge modèle, retour par mots-clés auto-écrits, sans évaluation certifiée ; un juge modèle rend l'évaluation externe |
| `externally_grounded` | reproduction | Le résultat de référence vient d'une exécution attestée, pas de l'auteur |

Pour ce texte, attendre surtout des scènes `production` et au plus un identifiant
`author_keyed`. Une reproduction n'a de sens qu'avec une capsule réellement
exécutée ; un texte de sociologie n'en fournit pas.

## 5. Construire le bundle d'auto-apprentissage

```sh
.venv/bin/python tools/experience_packet.py bundle --course /ABS/PATH/auto-etude/courses/durkheim-fait-social --out /ABS/PATH/auto-etude/bundles/durkheim-fait-social/lesson.json --self-study --note "Étude personnelle du chapitre I, Wikisource"
```

`--self-study` écrit `metadata.authoring = { mode: "self_study", author_is_learner: true, note }`
et la marque `validated_by: "SELF-STUDY — not teacher-validated"` à la place de
`DRAFT — not validated`. Le champ `validated_at` reçoit l'heure de construction :
ce n'est que la date du fichier, rien n'a été validé. Le bundle reste un
squelette : l'agent remplace chaque champ texte `TODO:` à partir des passages
(choix du quiz, points attendus et leurs indices, réponses de référence). Les
identifiants `todo-*` du squelette peuvent rester ; seul le texte compte. Les
indices (`cues`) d'un point attendu sont deux à quatre racines ou synonymes courts
que l'apprenant écrirait, jamais des phrases. Les indices ne concernent que les
points attendus : dans une scène `summary_audit`, chaque entrée de `flaws_expected`
compte pour un défaut planté dans le score affiché (« n/m défauts »), donc une seule
formulation par défaut, sans variante, et chaque défaut nommé dans
`model_correction` (sinon le lint signale `flaw_reveal_gap` en ERROR). Les règles du squelette sont celles de
[Du brouillon au bundle jouable](../user/teacher-guide.md#du-brouillon-au-bundle-jouable).
Valider ensuite la forme :

```sh
apps/lesson-mcp/node_modules/.bin/tsx tools/bundle_validate.ts /ABS/PATH/auto-etude/bundles/durkheim-fait-social/lesson.json
```

## 6. Lire le lint

```sh
node tools/bundle_lint.mjs /ABS/PATH/auto-etude/bundles/durkheim-fait-social/lesson.json
```

Chaque ligne a la forme `NIVEAU  bundle  code  message`. Pour cet exemple, attendre :

| Ligne | Sens |
|---|---|
| `INFO … self_study_authoring …` | Le bundle se déclare auto-rédigé |
| `WARN … self_study_open_book …` | Liste les scènes `author_keyed` : le quiz est à livre ouvert |
| `INFO … lwg_single_graded_item …` | Un concept n'a qu'une scène évaluée par réponse : le quiz |
| `WARN … lwg_prereq_unassessable …` | Un concept n'a aucune scène évaluée par réponse (quiz ou ai_critique ; hors ligne, un `ai_critique` ferait taire la ligne sans rendre le concept évaluable, puisqu'il ne certifie rien sans juge) |

Les deux lignes `lwg_*` découlent du choix recommandé ici (scènes de production,
un seul quiz) : elles sont attendues, ce ne sont pas des erreurs. Elles rappellent
que la maîtrise de ces concepts ne bougera pas sans juge modèle (voir plus bas).

`WARN … self_study_no_external_key …` apparaîtrait si la leçon ne contenait
aucune scène `production` ni `reproduction`. Ajouter alors une scène de production
plutôt que d'ignorer l'avertissement. Un `ERROR` fait échouer la commande et doit
être corrigé.

## 7. Jouer la leçon

Avant de jouer, ne pas ouvrir `plan.json` ni `lesson.json` : la clé y est en
clair. Le serveur retire les réponses attendues de la scène publique, mais ne peut
pas effacer ce qu'on a déjà lu.

**Par MCP.** Déclarer dans son harnais un serveur stdio lancé depuis la racine du
dépôt, avec cette commande :

```sh
BUNDLES_ROOT=/ABS/PATH/auto-etude/bundles STUDIUM_DATA_DIR=/ABS/PATH/auto-etude/data node_modules/.pnpm/node_modules/.bin/tsx apps/lesson-mcp/src/index.ts
```

Après un build de l'extension, `node apps/studium-vscode/dist/lesson-mcp.cjs`
remplace la partie `tsx …`, avec les mêmes variables. La forme de configuration de
chaque client est dans les [recettes de harnais](../getting-started/harnesses-and-api.md).
Demander à l'agent de suivre le
[skill harnais](../../skills/studium-harness/SKILL.md) et d'appeler
`start_lesson_session` :

```json
{"bundle_ref":"durkheim-fait-social/lesson.json","learner_id":"demo-local"}
```

La réponse, comme `get_operator_context` et le `task.md` du canal fichier, porte
un bloc `authoring`. Sans juge modèle (`LITELLM_BASE_URL` vide, le défaut) :

```json
{"mode":"self_study","author_is_learner":true,"validated":false,"judge":false,"notice":"Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert). Sans juge modèle, les scènes de production donnent un retour par mots-clés sans évaluation certifiée ; seules les reproductions exécutées portent une évaluation externe."}
```

Avec un juge modèle, `judge` vaut `true` et l'avis devient : « Leçon auto-rédigée :
les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre ouvert).
Les scènes de production, jugées par le modèle, et les reproductions exécutées
portent l'évaluation. » L'avis suit `metadata.language` ; les variantes anglaises
sont dans [Fonctionnalités](../features.md#qui-a-écrit-la-clé-).

**Dans le panneau.** Régler `studium.bundlesRoot` sur
`/ABS/PATH/auto-etude/bundles`, lancer **Studium : Choisir un cours**, puis ouvrir
`durkheim-fait-social`. Le panneau affiche l'avis en bannière.

Répondre ensuite avec ses propres mots, comme dans la
[première séance](first-lesson.md). La scène `explain_back` ne réaffiche pas le
passage cité, et son retour montre la réponse de référence écrite par l'agent.
Pour se corriger, revenir plutôt au passage, dans les scènes de concept précédentes
ou dans la source. Le quiz peut être servi deux fois : une première fois en détour,
quand la porte de prérequis l'exige, puis à sa place dans le parcours. Les deux
réponses comptent, alors que la seconde se fait en ayant déjà vu les choix et le
retour.

## Ce que cette leçon n'est pas

- **Une leçon validée.** Aucun enseignant ne l'a relue. Les citations exactes et
  un schéma valide ne garantissent pas l'interprétation ; vérifier les affirmations
  centrales dans le texte lui-même.
- **Une évaluation, sans juge modèle.** Avec `LITELLM_BASE_URL` vide, le défaut
  des exemples, les scènes de production donnent un retour par mots-clés, écrits
  par l'agent, mais aucune évaluation certifiée : elles ne déplacent pas la
  maîtrise. Seul le quiz à livre ouvert la fait bouger. Un retour par mots-clés
  peut aussi manquer une paraphrase juste. Un juge configuré rend l'évaluation
  externe ; c'est une route payante, à décider avant de l'activer.
- **Une contribution diffusée.** Un bundle d'auto-apprentissage n'est pas un
  bundle communautaire : `list_community_bundles` ne le trouve pas, et rien n'est
  envoyé à d'autres apprenants. La relecture humaine avant toute diffusion
  étudiante (règle 003) reste la règle ; voir le
  [guide apprenant-auteur](../guides/learner-as-author-UI-guide.md) pour le
  circuit des contributions relues.
