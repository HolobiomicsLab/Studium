# Tutoriel — une expérience scientifique avec son agent

**Objectif :** utiliser la liberté du harnais pour tester une idée, en restant lié
à la scène, aux preuves et au contrat de réponse Studium. L'enseignant définit le
périmètre ; l'étudiant choisit une hypothèse et défend sa conclusion.

## Cas A : similarité spectrale et visualiseur sur mesure

Question proposée : « Une meilleure similarité après déplacement des pics
suffit-elle à identifier une molécule ? » L'exemple fourni est un calcul illustratif
sur spectres synthétiques, lié à un passage capturé de SimMS. Il ne reproduit pas
l'article ni une capsule de nettoyage de bibliothèque ASB.

Pour rejouer le calcul, le visualiseur et l'audit technique, avec Node/Python
installés et Chrome disponible :

```sh
.venv/bin/python tools/demo-grounded-exploration.py /ABS/PATH/new-exploration-demo
```

Le script produit notamment `capsule/outputs/match.json`, `execution.json`,
`audit/viewer/`, `audit/report.json`, `exploration-receipt/` et
`exploration-verification.json`. Il réutilise les passages capturés hors ligne,
exécute le calcul et teste le visualiseur. Les observations de cet audit sont
synthétiques, pas des réponses d'étudiant.

Pour inspecter le visualiseur produit :

```sh
.venv/bin/python -m http.server 8118 --bind 127.0.0.1 --directory /ABS/PATH/new-exploration-demo/audit/viewer
```

Ouvrir `http://127.0.0.1:8118`, manipuler les contrôles et vérifier que les valeurs
changent de façon cohérente. Le visualiseur est un artefact local externe ; il
n'est pas automatiquement installé dans le panneau Studium. Arrêter avec Ctrl-C.

## Cas B : tâche réelle issue d'une capsule ASB

À partir d'une capsule fournie par l'enseignant, une tâche de nettoyage spectral
peut devenir une comparaison avant/après : quels spectres ont été rejetés, selon
quels critères et avec quelles conséquences sur l'analyse ? Lire sa carte exacte,
ses données et ses dépendances. Ne pas remplacer une tâche indisponible par
l'exemple synthétique en lui donnant le nom du résultat réel.

Le harnais doit vérifier ses outils effectifs : accès aux fichiers, terminal,
recherche web, Perspicacité éventuel et skills de domaine. Un skill explique
comment opérer ; il n'installe ni bibliothèque ni connecteur par sa seule présence.
Pour une question scientifique, consulter l'article et des sources primaires.
Pour coder ou installer, commencer par la documentation officielle de la version
choisie. Garder URL, date, extrait utile et raison du choix. Le
[guide d'exploration](../guides/grounded-exploration.md) détaille cette sélection.

## Boucle à utiliser en séance

1. **Prédire.** L'étudiant formule l'effet attendu avant de voir les résultats.
2. **Exécuter une référence.** Le harnais fait la tâche autorisée et conserve
   entrées, versions, commande et sorties réelles.
3. **Varier un facteur.** L'étudiant choisit un seuil ou une hypothèse. La référence
   reste visible pour comparer.
4. **Tester les limites.** Examiner au moins un cas limite et un résultat nul ou
   contradictoire. Vérifier unités et calculs, pas seulement l'apparence.
5. **Juger.** L'étudiant explique ce que l'expérience soutient, ne démontre pas
   et quelles preuves supplémentaires seraient utiles.
6. **Transférer.** Appliquer le raisonnement à un cas nouveau, puis revenir à la
   réponse personnelle exigée par Studium.

Prompt prêt à adapter :

> Lis le contexte public de la scène et le skill Studium. Vérifie tes outils.
> Aide-moi à expérimenter sur [question], dans [périmètre enseignant]. Demande
> d'abord ma prédiction. Propose l'environnement minimal et les sources officielles
> pertinentes ; utilise un skill de domaine si nécessaire. Exécute la référence,
> puis la variation que je choisis. Crée un viewer avec données, unités, référence
> et variante visibles. Teste les contrôles et un cas limite. Conserve les preuves
> et distingue `completed`, `failed`, `not_run`. Termine par une question de
> jugement et attends ma réponse ; ne soumets rien à ma place.

Préférer un asset existant ou une spécification déclarative quand cela suffit.
Un viewer personnalisé est utile lorsqu'une interaction répond à une question
pédagogique précise. Installer les bibliothèques dans un environnement propre à
l'expérience et conserver les versions ; un venv n'est pas un bac à sable de
sécurité. Le harnais garde ses permissions d'exécution habituelles.

## Respecter le protocole d'exécution

Pour une scène comportant un run, utiliser `get_run_manifest`, exécuter réellement
l'opération autorisée, puis transmettre un `RunResult` conforme avec
`submit_run_result`. Lire le [skill](../../skills/studium-harness/SKILL.md) pour les
champs actuels. Studium n'exécute pas la science à la place du harnais au temps
étudiant. Un recalcul exploratoire dans un graphique n'est pas un nouveau run
attesté et ne doit pas remplacer silencieusement le résultat soumis.

## Conserver un dossier d'expérience portable

Sauver le JSON public de `get_operator_context` puis :

```sh
.venv/bin/python tools/experience_exploration.py prepare --context /ABS/PATH/current-context.json --out /ABS/PATH/new-experiment
```

Lire `task.md` et le schéma généré. Compléter `experiment.json` avec question,
hypothèse, sources, fichiers explicitement choisis, actions et contrôles. Le
gabarit initial est volontairement incomplet. Une action déclarée `completed`
exige des preuves et contrôles réussis. Puis :

```sh
.venv/bin/python tools/experience_exploration.py seal --workspace /ABS/PATH/new-experiment --out /ABS/PATH/new-receipt
.venv/bin/python tools/experience_exploration.py verify /ABS/PATH/new-receipt --context /ABS/PATH/fresh-context.json
```

Le reçu vérifie l'intégrité des fichiers capturés et leur rattachement au contexte.
Il ne prouve ni vérité scientifique, ni exécution indépendante, ni auteur humain.
Il ne se soumet pas comme `response.json` ou `run_result.json`. L'intégration de
ces reçus dans la revue MySTRA n'est pas encore réalisée. Conserver l'observation
personnelle uniquement à la demande de l'étudiant ; elle est nulle par défaut.
Ces fichiers restent hors de l'effacement de session et de la télémétrie Studium.

**Réussite pédagogique attendue :** une prédiction personnelle, une comparaison
reproductible, une limite explicitée et un transfert argumenté. Le fait que
l'agent ait écrit du code ou produit un joli graphique ne suffit pas.
