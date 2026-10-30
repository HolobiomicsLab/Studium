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
| Décider | Vous | `/courses/<course_id>/submissions` dans le tableau de bord (`localhost:3001`) | Approuvé, rejeté ou révision demandée |
| Jouer | Classe | Assistant (`list_community_bundles`) ou VS Code (« Studium : Contributions de la classe ») | Une leçon communautaire d'une scène |

## Lancer les services

Trois terminaux, depuis la racine du dépôt :

```bash
.venv/bin/python -m uvicorn scene_synth_app:app --app-dir services/scene-synth --port 8002
```

```bash
pnpm --filter @studium/author-web dev
```

```bash
pnpm --filter @studium/teacher-dashboard dev
```

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

Ouvrez `http://localhost:3001/courses/atomistique-l1/submissions` (l'identifiant du cours sert de
jeton). Chaque item montre la scène, sa clé de réponse (bonnes réponses marquées), le résultat de la
validation et une étiquette d'auteur dé-identifiée : vous n'approuvez jamais à l'aveugle.

| Décision | Effet |
|---|---|
| Approuver | Une leçon communautaire d'une scène est écrite sous `BUNDLES_ROOT/<course_id>/community/`, avec votre nom dans `validated_by` et sans le pseudonyme de l'auteur |
| Rejeter | Rien n'est publié |
| Demander une révision | Rien n'est publié ; la décision est consignée sur l'item |

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
| Erreur CORS dans la console du navigateur | Le service n'est pas lancé, ou la page n'est pas sur `localhost:3000` ou `localhost:3001` |
| `400` ou `404` à la soumission | L'identifiant du cours est mal formé, ou `BUNDLES_ROOT/<course_id>/lesson.json` n'existe pas |
| `422` à la soumission | La scène n'a pas passé la validation ; la réponse liste les erreurs |
| File vide | Aucun item à l'état `submitted` ; faites d'abord l'étape apprenant |
| `Connection refused` sur le port 8002 | Lancez le service scene-synth |

Code : [`services/scene-synth/scene_synth_app.py`](../../services/scene-synth/scene_synth_app.py),
[`apps/author-web/app/studio/`](../../apps/author-web/app/studio/).
