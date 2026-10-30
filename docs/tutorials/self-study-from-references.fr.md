[English](self-study-from-references.md) · Français

# Auto-apprentissage à partir de ses références

Transformez un texte de votre choix en une leçon à jouer seul, sans enseignant. Deux voies mènent au
même type de leçon : en conversation avec votre assistant, par les outils MCP (un quart d'heure,
sans terminal), ou avec les outils de dossier en ligne de commande (30 à 45 minutes, avec la main sur
chaque étape). Le skill [`studium-self-learner`](../../skills/studium-self-learner/SKILL.md) guide un
assistant dans la voie en ligne de commande.

L'exemple est Émile Durkheim, *Les Règles de la méthode sociologique*, chapitre I, « Qu'est-ce qu'un
fait social ? », sur Wikisource. Le texte est dans le domaine public ; les ajouts propres au site
(notes, mise en page) suivent la licence de Wikisource. Pour une autre source, vérifiez d'abord sa
licence : un PDF d'éditeur ou une licence `NC`, `ND` ou inconnue restreint ce que vous pouvez faire
de la leçon.

Vous formulez l'objectif, fournissez la source, relisez le plan proposé et jouez la leçon.
L'assistant extrait les passages, rédige le plan et les scènes avec des citations exactes, et lance
les vérifications.

## Voie 1 : en conversation (MCP)

Le serveur Studium étant connecté à votre assistant ([Connecter son harnais](../start/harnesses.fr.md)),
envoyez :

> Je veux apprendre avec Studium ce qui distingue un fait social d'un fait individuel selon
> Durkheim, et savoir l'appliquer à un exemple nouveau. Récupère le chapitre I des *Règles de la
> méthode sociologique* sur Wikisource (domaine public) et construis une leçon en français.
> Privilégie les scènes où j'écris (explain_back, comparison, summary_audit), avec au plus un quiz.
> Montre-moi le plan sans les réponses.

L'assistant suit alors les étapes d'[Apprendre un sujet en conversation](learn-a-topic-in-a-conversation.fr.md) :

| Étape | Outil | Ce que vous voyez |
|---|---|---|
| Lire la consigne | `get_authoring_guide {language: "fr"}` | L'assistant demande votre objectif si vous ne l'avez pas donné |
| Découper la source en passages | `prepare_sources` avec `{title, text, url, license: "public-domain"}` | Des passages aux identifiants du type `p:<source>:1` |
| Vérifier et écrire la leçon | `create_lesson` | Le plan (sans clé) et l'avis d'autorat |
| Jouer | `start_lesson_session`, `submit_response`, `rate_recall` | Un écran à la fois, avec vos mots |

L'assistant récupère la page avec son propre outil web ; Studium ne la télécharge jamais. Un jeu de
sources compte au plus 20 sources et 200 000 caractères au total : un chapitre entier y tient.
Chaque citation doit correspondre à son passage au caractère près, sinon `create_lesson` refuse le
brouillon et l'assistant le corrige. La leçon est écrite dans votre bibliothèque
(`~/.studium/library/<course_id>/lesson.json`) et marquée « rédigée par l'IA, non vérifiée par un
enseignant ».

## Voie 2 : avec les outils en ligne de commande

Cette voie demande l'environnement Python de l'[installation](../start/installation.fr.md). Lancez
les commandes depuis la racine du dépôt et choisissez un dossier de travail neuf :

```bash
WORK="$HOME/studium-auto-etude"
```

### Extraire les passages

```bash
.venv/bin/python tools/experience_packet.py passages \
  --url "https://fr.wikisource.org/wiki/Les_R%C3%A8gles_de_la_m%C3%A9thode_sociologique/Chapitre_1" \
  --title "Les Règles de la méthode sociologique, chapitre I" \
  --license public-domain --out "$WORK/passages.json"
```

`--html FICHIER`, `--pdf FICHIER` ou `--text FICHIER` remplacent `--url` ; `--min-chars` (200 par
défaut) et `--max-chars` (1200 par défaut) bornent la taille des passages. La sortie est une
enveloppe inerte (`origin: "self-study-passages/1.0"`) : ce sont les seuls textes que la leçon pourra
citer. Sur une page Wikimedia, la commande ignore navigation, pied de page et catégories ; un
paragraphe trop court est fusionné avec ses voisins, et `dropped_short` compte ce qui a tout de même
été écarté. Parcourez les passages : un passage parasite (métadonnées du site, appel de note isolé)
peut simplement rester non cité. S'il y en a beaucoup, repartez d'un fichier texte nettoyé avec
`--text`.

### Préparer le dossier d'auteur

```bash
.venv/bin/python tools/experience_packet.py prepare --passages "$WORK/passages.json" \
  --title "Qu'est-ce qu'un fait social ?" --target "Autodidacte, niveau licence" \
  --out "$WORK/packet"
```

Le dossier contient `evidence.json`, `author-task.md` et `response.schema.json`. Comme l'enveloppe
vient de `passages`, `prepare` écrit la consigne d'auto-apprentissage et préfixe les identifiants de
preuve par `passage:` (`--self-study` impose cette consigne pour une enveloppe d'une autre origine).
`prepare` refuse une destination non vide et n'a pas d'option `--force`.

### Faire rédiger l'assistant

> Lis `author-task.md`, `evidence.json` et `response.schema.json` du dossier. Mon objectif : savoir
> dire ce qui distingue un fait social d'un fait individuel selon Durkheim, et l'appliquer à un
> exemple nouveau. Écris `author-response.json` en français (`language: "fr"`), avec des citations
> exactes et leurs identifiants de preuve. Privilégie les scènes où j'écris ; au plus un quiz. Garde
> `status: draft` et `validated_by: null`. Montre-moi ensuite le plan sans les réponses attendues.

Relisez le plan et demandez les corrections utiles. N'ouvrez pas `author-response.json` vous-même :
il contient déjà les réponses attendues. Son champ `learning_workflow_graph` est facultatif : `bundle`
dérive le graphe des `prerequisites` de chaque notion.

### Vérifier le brouillon

```bash
.venv/bin/python tools/experience_packet.py check --packet "$WORK/packet" \
  --response "$WORK/author-response.json" --out "$WORK/courses/durkheim-fait-social"
```

Une citation qui n'est pas une sous-chaîne exacte de son passage produit une `ERROR` : l'assistant
corrige le brouillon, jamais la preuve. `--json` produit un rapport lisible par une machine ;
`--force` remplace une sortie existante. La ligne `Key classes:` range les scènes selon qui détient
leur clé :

| Classe | Types de scène | Ce que cela veut dire ici |
|---|---|---|
| `ungraded` | intro, concept, meta_checkpoint | Rien n'est évalué |
| `author_keyed` | quiz, spot_the_flaw | La clé est écrite par celui qui répond : livre ouvert |
| `production` | explain_back, comparison, summary_audit, prompt_practice, communication_sim, discussion, ai_critique | Vous écrivez un texte ; sans juge modèle, vous le comparez à la référence et notez votre rappel |
| `externally_grounded` | reproduction | Évaluée d'après une exécution attestée ; un texte de sociologie n'en fournit pas |

### Construire et contrôler la leçon

```bash
.venv/bin/python tools/experience_packet.py bundle --course "$WORK/courses/durkheim-fait-social" \
  --out "$WORK/bundles/durkheim-fait-social/lesson.json" --self-study \
  --note "Étude personnelle du chapitre I, Wikisource"
```

`--self-study` inscrit `metadata.authoring = {mode: "self_study", author_is_learner: true, note}` et
`validated_by: "SELF-STUDY — not teacher-validated"`. Le bundle est un squelette : l'assistant
remplace chaque texte `TODO:` à partir des passages (choix du quiz, points clés et leurs 2 à 4
indices courts `cues`, réponses modèles). Dans une scène `summary_audit`, chaque entrée de
`flaws_expected` est un défaut planté : une seule formulation par défaut, chacun nommé dans
`model_correction`. Validez puis lancez le lint :

```bash
apps/lesson-mcp/node_modules/.bin/tsx tools/bundle_validate.ts "$WORK/bundles/durkheim-fait-social/lesson.json"
node tools/bundle_lint.mjs "$WORK/bundles/durkheim-fait-social/lesson.json"
```

| Ligne du lint | Sens |
|---|---|
| `INFO self_study_authoring` | La leçon se déclare auto-rédigée |
| `WARN self_study_open_book` | Liste les scènes `author_keyed` : le quiz est à livre ouvert |
| `INFO lwg_single_graded_item` / `WARN lwg_prereq_unassessable` | Une notion n'a qu'une scène, ou aucune, évaluée par une clé : attendu avec surtout des scènes de production |
| `WARN self_study_no_external_key` | Aucune scène de production ni de reproduction : en ajouter une plutôt qu'ignorer l'avertissement |

Une `ERROR` fait échouer la commande et doit être corrigée. Les règles pour compléter un squelette
sont dans [Rédiger une leçon](../teach/author-a-lesson.fr.md).

### Jouer la leçon

N'ouvrez ni `plan.json` ni `lesson.json` avant de jouer : la clé y est en clair. Le serveur retire
les réponses attendues de ce qu'il affiche, mais ne peut pas effacer ce que vous avez déjà lu.

Pour jouer avec votre assistant, copiez la leçon dans votre bibliothèque (`~/.studium/library`, ou
`<STUDIUM_HOME>/library`), que le serveur consulte toujours :

```bash
mkdir -p "$HOME/.studium/library" && cp -R "$WORK/bundles/durkheim-fait-social" "$HOME/.studium/library/"
```

Demandez ensuite : « Démarre la leçon Studium `durkheim-fait-social/lesson.json`. » Dans VS Code,
réglez `studium.bundlesRoot` sur le chemin complet de votre dossier `bundles` et lancez
**Studium : Choisir un cours**. Le premier écran affiche l'avis d'une leçon rédigée par l'apprenant :

> Leçon auto-rédigée : les quiz et les défauts à repérer ont une clé écrite par l'apprenant (livre
> ouvert). Sans juge modèle, les scènes de production ne sont pas évaluées : compare ta réponse à la
> référence affichée et note ton rappel […]

Répondez avec vos mots, comme dans [la première séance](first-lesson.fr.md). Après une réponse
évaluée, quand la leçon avance, le retour montre la référence et le passage cité par la scène.

## Ce que cette leçon n'est pas

- **Une leçon validée.** Aucun enseignant ne l'a relue. Des citations exactes et un schéma valide ne
  garantissent pas l'interprétation ; vérifiez les affirmations centrales dans le texte lui-même.
- **Une évaluation, sans juge modèle.** Avec `LITELLM_BASE_URL` vide (le défaut), les scènes de
  production montrent la référence et vous demandent de noter votre rappel ; cette note règle les
  révisions et ne fait jamais bouger la maîtrise. Seules les questions à clé, comme le quiz, la font
  bouger. Un juge modèle est une voie payante, à décider avant de l'activer
  ([Configuration](../reference/configuration.fr.md)).
- **Une contribution partagée.** La leçon reste dans votre bibliothèque et rien n'est envoyé à
  d'autres apprenants. Une leçon destinée à des étudiants passe d'abord par la relecture d'un
  enseignant (règle 003) : voir [Contributions des apprenants](../teach/learner-contributions.fr.md).
