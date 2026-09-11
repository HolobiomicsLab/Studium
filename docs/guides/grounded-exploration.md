# Expérimenter avec son harnais dans Studium

L'approche retenue est de confier les outils au harnais et le parcours pédagogique
à Studium. Une scène garde ses concepts, objectifs, contrat de réponse et règles
de progression. Le harnais peut consulter des sources, lire un skill de domaine,
préparer un environnement et fabriquer un visualiseur adapté à la question.
Le résultat de cette exploration reste un objet à examiner.

## Ce que le harnais peut apporter

Dans Copilot/VS Code, les skills regroupent des consignes et ressources réutilisables,
et les outils peuvent venir du client, de MCP ou d'extensions. La documentation
prévoit notamment la récupération de pages web. La disponibilité effective doit
être vérifiée dans **la session utilisée** ; le serveur Studium ne crée pas ces
capacités. Voir les documentations officielles [skills](https://code.visualstudio.com/docs/agent-customization/agent-skills)
et [outils](https://code.visualstudio.com/docs/agents/run/tools), consultées le 2026-09-11.
Ce développement ne constitue pas un essai en session Copilot réelle.

Utiliser le skill Studium existant pour la boucle pédagogique et charger un skill
de domaine seulement quand son travail devient utile. Une capsule ASB indique la
tâche scientifique, ses matériaux et contraintes. Un skill explique comment
opérer ; le harnais possède les outils et permissions. Aucun de ces objets ne
vaut preuve que la méthode a fonctionné dans l'environnement de l'étudiant.

Pour la science, commencer par les passages de l'article et la capsule, puis
Perspicacité si une question exige de la littérature supplémentaire. Pour
installer ou programmer, inspecter la documentation officielle correspondant
à la version utilisée. Un résultat de recherche est une piste ; conserver la
page effectivement lue, sa version/date et la raison du choix. Si la source est
inaccessible, consigner ce manque au lieu d'en inventer le contenu.

Pour un graphique, partir d'un asset existant. Si l'activité demande filtrage,
sélection ou variation de paramètres, une spécification déclarative est souvent
un premier choix économique : [les paramètres Vega-Lite](https://vega.github.io/vega-lite/docs/parameter.html)
permettent ces interactions. Construire une interface sur mesure quand la tâche
demande davantage. C'est une règle de choix proposée, pas un classement universel
des bibliothèques. Tester les valeurs, les unités et l'effet réel des contrôles,
puis la lisibilité clavier/mobile ; un rendu esthétique ne valide pas le calcul.

Installer les dépendances dans l'espace de l'expérience, conserver leurs versions
résolues et les fichiers de verrouillage. La documentation de
[pip sur les installations vérifiables](https://pip.pypa.io/en/stable/topics/secure-installs/)
décrit le contrôle des hashes. Un environnement virtuel isole les dépendances ;
il ne protège pas la machine contre du code inconnu. L'exécution reste soumise
aux permissions et à l'isolation du harnais. Aucun installateur global ou nouveau
service n'est ajouté par Studium.

## La boucle de l'étudiant

1. **Prédire.** Relier une question au concept courant. Recueillir la prédiction
   de l'étudiant avant le résultat ; identifier les hypothèses proposées par l'IA.
2. **Établir la référence.** Exécuter la tâche prévue avec les entrées identifiées.
   Conserver commande, environnement, sorties et contrôles réellement effectués.
3. **Varier.** Changer un facteur et afficher référence et variante ensemble.
   L'étudiant choisit le facteur ; l'IA aide à réaliser et comprendre la modification.
4. **Comparer.** Examiner l'effet, un cas limite et un contre-exemple. Garder un
   échec ou un résultat nul comme matière de raisonnement.
5. **Juger.** Demander ce que les résultats soutiennent, ce qu'ils ne démontrent
   pas et quelles preuves manquent. La confiance vient de l'étudiant, si fournie.
6. **Transférer.** Tester la même explication sur un cas nouveau, puis revenir à
   la scène Studium pour la réponse personnelle et les règles d'adaptation existantes.

Exemple ASB : une capsule de nettoyage de bibliothèque spectrale peut servir à
comparer avant/après filtrage, inspecter les spectres rejetés et juger si moins
de spectres signifie une meilleure bibliothèque. Lire sa carte exacte : un tier
`type-checked` n'est pas une exécution réussie. L'exemple spectral livré dans
`examples/literature-experience` illustre un autre concept, le matching modifié,
avec des données synthétiques ; il ne reproduit pas cette capsule de nettoyage.

Une interaction qui réaffiche les matériaux de l'activité approuvée peut rester
dans cette activité. Une nouvelle explication scientifique, un exercice ou une
scène générés au-delà de ce périmètre restent des brouillons à relire. Le système
ne certifie pas encore automatiquement cette distinction : le professeur doit
définir le périmètre exploratoire avant le pilote étudiant. Les nouvelles
questions de jugement ne sont pas secrètement incorporées au barème.

## Un dossier portable pour garder les preuves

Enregistrer le JSON public de `get_operator_context`, ou celui de `task.md`, puis :

```sh
.venv/bin/python tools/experience_exploration.py prepare \
  --context /absolute/current-context.json --out /absolute/new-experiment
```

Le nouveau dossier contient `context.json`, `task.md`, `experiment.json` et son
schéma JSON. Le gabarit est volontairement incomplet : renseigner la question,
l'hypothèse, les sources avec extraits permis, les fichiers explicitement choisis
et les actions. Pour chaque source, préciser son rôle, son identifiant, son
adresse, sa date de consultation, pourquoi elle convient et le fichier capturé.
Une version peut être ajoutée. Les sources scientifiques, docs logicielles,
skills, capsules et données ont des rôles distincts.

Les fichiers sont relatifs au dossier et portent un rôle : `source`, `skill`,
`input`, `code`, `output`, `environment` ou `log`. Un skill peut être identifié par
son chemin original et un court extrait permis ; ce snapshot est une preuve
de version consultée, jamais une nouvelle installation ou copie opérationnelle.
Un manifeste d'environnement est un fichier préparé sans secrets, par exemple
les versions réellement importées ; ne pas copier les variables d'environnement.

Une action référence ses sources, sa commande et ses fichiers de preuve.
`completed` exige un environnement capturé, une sortie/un log et des contrôles
tous réussis. `failed` et `not_run` conservent honnêtement les autres situations.
Ces champs sont des déclarations du harnais, pas une observation indépendante.
Le code n'exécute jamais les commandes enregistrées.

```sh
.venv/bin/python tools/experience_exploration.py seal \
  --workspace /absolute/new-experiment --out /absolute/new-receipt
.venv/bin/python tools/experience_exploration.py verify \
  /absolute/new-receipt --context /absolute/fresh-context.json
```

Le reçu contient le contexte, l'expérience et seulement les fichiers nommés,
stockés par SHA-256. Il se vérifie après déplacement, sans consulter les fichiers
d'origine. Les chemins sortants, symlinks et emplacements usuels de secrets sont
refusés ; chaque fichier est limité à 20 MiB, l'ensemble à 100 MiB. Ce n'est pas
un détecteur général de secrets : préparer des extraits et logs appropriés avant
capture. Le vérificateur ne récupère aucune URL et n'installe aucune dépendance.

Une vérification réussie signifie **intégrité de l'instantané**. Elle ne prouve
ni la vérité des sources, ni la justesse scientifique, ni l'exécution des commandes,
ni l'auteur humain d'un texte. Un acteur qui refabrique entièrement l'instantané
peut aussi refabriquer ses hashes. Le reçu n'est jamais soumis comme `response.json`
ou `run_result.json` ; le protocole de run et sa quarantaine restent en place.

`learner_observation` est nul par défaut. À la demande de l'étudiant seulement,
conserver ses propres mots et sa confiance facultative. Le reçu reste local,
hors télémétrie Studium ; l'effacement d'une session ne supprime pas ces fichiers.
Leur conservation/suppression relève de l'étudiant. Aucune publication automatique.

La suite produit utile est une ouverture de ces dossiers dans la revue auteur /
MySTRA, puis une expérience approuvée et un cas de transfert validé par le professeur.
Le présent outil livre la capture portable et les contrôles, pas cette UI intégrée.

## Rejouer le cas livré

Dans un checkout installé/construit avec Chrome disponible :

```sh
.venv/bin/python tools/demo-grounded-exploration.py /tmp/new-grounded-exploration
```

Le script reprend la démo spectrale existante, exécute le calcul, audite le
visualiseur puis produit `exploration-receipt/` et `exploration-verification.json`.
Les observations du navigateur sont des entrées d'audit synthétiques, conservées
comme sorties techniques ; `learner_observation` reste nul. Le calcul utilise
la bibliothèque standard Python, aucune installation supplémentaire. Les
sources capturées sont rejouées hors ligne, sans nouvelle recherche web.
