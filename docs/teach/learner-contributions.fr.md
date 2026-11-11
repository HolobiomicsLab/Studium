[English](learner-contributions.md) · Français

# Contributions des apprenants

Les étudiants peuvent proposer un nouvel item pour votre cours : un quiz, une scène « repérer
l'erreur » ou « ré-expliquer ». Vous voyez chaque proposition avec sa clé de réponse, vous approuvez,
rejetez ou demandez une révision, et seul ce que vous approuvez devient accessible à la classe, sous
forme de leçon communautaire distincte. Votre cours d'origine n'est jamais modifié. Un apprenant ne
peut jamais publier seul : c'est la règle 003 appliquée aux contributions.

| Étape | Qui | Où | Résultat |
|---|---|---|---|
| Rédiger et s'auto-tester | Apprenant | `/studio` dans l'application auteur web (`localhost:3000`) | Une scène qui passe la validation |
| Soumettre | Apprenant | Même page, après consentement | Un item à l'état `submitted` |
| Test par les pairs (facultatif) | Apprenants | `/peer` dans l'application auteur web | Des agrégats de notes, visibles à partir de 3 évaluateurs |
| Se connecter | Vous | `/login` dans le tableau de bord (`localhost:3001`) | Une session enseignant de 12 heures |
| Décider | Vous | `/courses/<course_id>/submissions` dans le tableau de bord (`localhost:3001`) | Approuvé, rejeté ou révision demandée |
| Jouer | Classe | Assistant (`list_community_bundles`) ou VS Code (« Studium : Contributions de la classe ») | Une leçon communautaire d'une scène |

## Lancer les services

Les décisions demandent un jeton de relecture enseignant : un secret d'au moins 32 caractères, de
même valeur dans `STUDIUM_REVIEW_TOKEN` pour scene-synth et pour le serveur du tableau de bord, et
jamais confié à un apprenant. Générez-en un par déploiement, par exemple dans un shell que vous
utilisez ensuite pour les deux commandes :

```bash
export STUDIUM_REVIEW_TOKEN="$(openssl rand -hex 32)"
```

Le tableau de bord demande aussi un code d'accès, que vous saisissez pour vous connecter : 16
caractères au moins dans `STUDIUM_DASHBOARD_ACCESS_CODE`, sur le serveur du tableau de bord seulement.
Sans lui, le tableau de bord refuse toute décision (`503`).

```bash
export STUDIUM_DASHBOARD_ACCESS_CODE="$(openssl rand -hex 16)"
```

Trois terminaux, depuis la racine du dépôt (le premier et le troisième ont besoin du jeton) :

```bash
.venv/bin/python -m uvicorn scene_synth_app:app --app-dir services/scene-synth --port 8002
```

```bash
pnpm --filter @studium/author-web dev
```

```bash
pnpm --filter @studium/teacher-dashboard dev
```

Sans le jeton, scene-synth refuse toute décision (approuver, rejeter, demander une révision) avec un
`503` qui nomme la variable à définir ; les apprenants peuvent toujours rédiger et soumettre.

Le service lit chaque cours dans `BUNDLES_ROOT/<course_id>/lesson.json` (par défaut le dossier
`fixtures/` du dépôt) et conserve les soumissions dans `LEARNER_DATA_ROOT` (par défaut
`/tmp/studium-learner-items`). Les applications web le joignent sur le port 8002
(`NEXT_PUBLIC_SCENE_SYNTH_SERVICE_URL` côté apprenant, `SCENE_SYNTH_BASE_URL` côté tableau de bord).
Aucune clé d'API n'est nécessaire.

Le formulaire apprenant se trouve dans l'application auteur web, marquée comme héritée, et il est
relié au cours de démonstration `atomistique-l1` (concept `c-orbitales-formes`). Pour un autre cours,
un client soumet par le même service (`POST /learner-items`) avec l'identifiant de ce cours.

## Ce que fait l'apprenant

1. Il remplit un formulaire guidé (sans JSON) : titre, question, deux à six choix dont exactement un
   correct, retour en cas de bonne et de mauvaise réponse, indices. « Repérer l'erreur » et
   « ré-expliquer » ont leur propre éditeur.
2. Il suit le badge de validation : chaque modification est vérifiée par rapport au schéma et aux
   concepts du cours.
3. Il répond à son propre item dans le panneau d'auto-test, corrigé localement, sans appel réseau.
4. Il coche le consentement ; avec un badge vert, **Soumettre** envoie l'item, qui arrive à l'état
   `submitted`.

## Décider d'une soumission

Connectez-vous d'abord. Ouvrez `http://localhost:3001/courses/atomistique-l1/submissions`
(l'identifiant du cours sert de jeton) : le tableau de bord vous envoie sur sa page de connexion, vous
saisissez le code d'accès, et il vous ramène à la file. La session dure 12 heures ; **Se déconnecter**,
dans l'en-tête, la ferme. Si elle expire pendant que la page est ouverte, une décision répond qu'il faut
vous reconnecter. La session n'enregistre pas qui vous êtes : le nom que liront les apprenants est celui
que vous saisissez plus bas. Chaque item montre la scène, sa clé de réponse (bonnes réponses marquées), le résultat de la
validation et une étiquette d'auteur dé-identifiée : vous n'approuvez jamais à l'aveugle.

Au-dessus de la file, saisissez **Votre nom, tel que les apprenants le liront**. Le bouton Approuver
reste désactivé tant que le champ est vide, et la page montre la phrase que liront les apprenants :
« Leçon proposée par une personne de la classe, validée par <nom> » (en anglais : "Lesson contributed
by a classmate, validated by <name>"). Une adresse électronique est acceptée, avec une note rappelant
que les apprenants la verront. Le navigateur retient le nom pour votre prochaine visite (stockage
local, sur ce navigateur seulement).

| Décision | Effet |
|---|---|
| Approuver | Une leçon communautaire d'une scène, `community-<id>.zip`, est écrite sous `BUNDLES_ROOT/<course_id>/community/`, avec votre nom dans `validated_by`, un enregistrement `approval.json` à côté de son `lesson.json`, et sans le pseudonyme de l'auteur |
| Rejeter | Rien n'est publié |
| Demander une révision | Rien n'est publié ; la décision est consignée sur l'item |

### Comment une décision est enregistrée

Une décision est un acte d'enseignant, et le service la vérifie comme tel :

- Votre navigateur envoie la décision au serveur du tableau de bord, qui appelle scene-synth avec
  `Authorization: Bearer $STUDIUM_REVIEW_TOKEN`. Le jeton reste sur les deux serveurs : il n'atteint
  jamais un navigateur, une réponse, un journal ni un fichier. Un jeton absent ou faux reçoit `401`.
- scene-synth refuse toute décision venue directement d'un navigateur (`403`) et n'accorde aucun
  accès CORS à la route de décision : l'application apprenant sur `localhost:3000` ne peut pas
  décider, pas même pour ses propres items.
- À l'approbation, le relecteur est le nom que vous avez saisi, sans espaces aux extrémités : le
  tableau de bord refuse un nom vide, un nom de plus de 200 caractères, un nom contenant un caractère
  de contrôle ou un identifiant commençant par `urn:`, et scene-synth refuse un nom vide ou trop long,
  un identifiant commençant par `urn:`, et l'identifiant ou le pseudonyme de l'auteur de l'item
  (`400`). Un rejet ou une demande de révision, qui ne publient rien, consignent votre nom si vous
  l'avez saisi, sinon l'identifiant du cours `urn:studium:teacher:<course_id>`.
- À l'approbation, l'archive contient `approval.json`, le même enregistrement `studium-approval/1`
  que celui qu'écrit `experience_packet.py approve` pour une leçon d'enseignant : `bundle_sha256` (le
  sha256 des octets exacts du `lesson.json` de l'archive), `reviewer`, `reviewed_at`, `tool` et
  `decision_route: "learner-contribution"`. Toute modification de `lesson.json` rompt la
  correspondance.
- La leçon dit qui l'a écrite : `metadata.authoring` vaut `{mode: "teacher", author_is_learner: true,
  drafted_by: "learner"}`, un brouillon d'apprenant validé par vous.
- Chaque décision ajoute une ligne à `learner_decisions.jsonl` dans `LEARNER_DATA_ROOT` : item, cours,
  décision, relecteur, `reviewed_at` déclaré, `recorded_at` du serveur et, à l'approbation, le sha256
  du `lesson.json` publié et celui de l'archive.

Les apprenants et leurs assistants trouvent les items approuvés avec l'outil MCP
`list_community_bundles`, dont les références se passent telles quelles à `start_lesson_session`, ou
avec la commande VS Code « Studium : Contributions de la classe ».

## Évaluation par les pairs en classe

Deux façons facultatives de faire tester le travail des uns par les autres :

- **La page `/peer`** de l'application auteur web permet aux apprenants de passer un item soumis et
  de le noter. Les notes ne portent ni texte ni identité ; vous ne voyez l'agrégat qu'à partir de
  trois évaluateurs.
- **Une salle PeerStudio en direct** : votre assistant appelle `open_peer_room` pour une leçon et
  donne aux étudiants un code de six caractères ; ils appellent `join_peer_room` et
  `submit_peer_rating`. Vous lisez `get_peer_room_state` et terminez par `close_peer_room`, qui
  renvoie les agrégats des cibles ayant reçu au moins trois notes indépendantes. La salle vit en
  mémoire et disparaît à la fermeture. La page `/room` du tableau de bord offre les mêmes commandes
  par le lesson-server (`LESSON_SERVER_BASE_URL`, par défaut `http://localhost:8010`).

Les notes éclairent votre décision ; elles ne publient jamais rien d'elles-mêmes.

## Confidentialité

- Le texte de l'apprenant reste sur son appareil jusqu'à la soumission ; il n'entre jamais dans la
  télémétrie.
- Le pseudonyme de l'auteur est calculé sur le serveur, jamais renvoyé à un client ni montré aux pairs.
- L'auto-test ne fait aucun appel réseau ni aucun appel de modèle.

## À ne pas confondre avec une leçon d'auto-apprentissage

Une leçon qu'un apprenant construit pour lui-même avec son assistant (voir
[apprendre avec votre assistant](../learn/learn-with-your-assistant.fr.md)) reste dans sa propre
bibliothèque, marquée auto-apprentissage. `experience_packet.py approve` refuse ces leçons ; pour
donner ce contenu à une classe, reconstruisez-le par la
[voie enseignant](author-a-lesson.fr.md#voie-b-le-dossier-de-preuves).

## Dépannage

| Symptôme | Cause et solution |
|---|---|
| Erreur CORS dans la console du navigateur | Le service n'est pas lancé, ou la page apprenant n'est pas sur `localhost:3000` ; le tableau de bord n'appelle jamais scene-synth depuis le navigateur |
| « Les décisions sont désactivées » dans le tableau de bord, ou `503` sur une décision | `STUDIUM_REVIEW_TOKEN` (32 caractères au moins) manque sur scene-synth ou sur le serveur du tableau de bord : donnez la même valeur aux deux et redémarrez-les |
| « Décisions indisponibles » au-dessus de la file | Le serveur du tableau de bord n'a pas `STUDIUM_DASHBOARD_ACCESS_CODE` (16 caractères au moins) ou `STUDIUM_REVIEW_TOKEN` ; la ligne nomme celui à définir |
| `401` sur une décision, avec « connectez-vous » | Votre session sur le tableau de bord est absente ou expirée : reconnectez-vous |
| `401` sur une décision, venu de scene-synth | Les deux serveurs n'ont pas la même valeur de `STUDIUM_REVIEW_TOKEN` |
| `400` « the reviewer cannot be the item's author » | Le relecteur nommé est l'apprenant qui a écrit l'item ; un apprenant ne décide jamais de son propre item |
| `400` ou `404` à la soumission | L'identifiant du cours est mal formé, ou `BUNDLES_ROOT/<course_id>/lesson.json` n'existe pas |
| `422` à la soumission | La scène n'a pas passé la validation ; la réponse liste les erreurs |
| File vide | Aucun item à l'état `submitted` ; faites d'abord l'étape apprenant |
| `Connection refused` sur le port 8002 | Lancez le service scene-synth |

Code : [`services/scene-synth/scene_synth_app.py`](../../services/scene-synth/scene_synth_app.py),
[`services/scene-synth/learner_review.py`](../../services/scene-synth/learner_review.py),
[`apps/teacher-dashboard/lib/decide-route.ts`](../../apps/teacher-dashboard/lib/decide-route.ts),
[`apps/author-web/app/studio/`](../../apps/author-web/app/studio/).
