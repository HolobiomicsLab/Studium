[English](learner-report.md) · Français

# Rapport d'activité de l'apprenant

Exportez ce que vous avez fait dans une activité portable, une copie de votre journal d'expérience, ou les
deux, sous forme d'un rapport local à ouvrir dans un navigateur, à vérifier et à partager si vous le décidez.
L'export vérifie que les enregistrements sont bien formés et dans l'ordre. Il ne vous note pas, ne déduit pas
ce que vous avez appris et ne valide pas la science.

Deux types d'enregistrements peuvent y figurer :

- **Actions de l'apprenant** : un fichier annexe écrit par une activité portable. Il distingue les actions
  observées par le navigateur de l'aide déclarée par le harnais. Un événement d'aide absent signifie que la
  couverture est inconnue, pas qu'aucune aide n'a eu lieu.
- **Copie du journal** : une copie de votre [journal d'expérience](experiment-journal.fr.md). Elle n'est pas
  authentifiée. Quand les deux sont choisis, l'identifiant de scène de l'activité doit figurer dans le
  journal ; ce recoupement n'authentifie pas pour autant un apprenant, une leçon ou une séance, et les deux
  horloges restent séparées.

Le [tutoriel activité → rapport](../tutorials/activity-to-report.fr.md) déroule un exemple complet.

## Vérifier le fichier d'actions

Depuis la racine du dépôt :

```bash
.venv/bin/python tools/learner_trace.py validate chemin/vers/learner-actions.json
.venv/bin/python tools/learner_trace.py schema --out learner-actions.schema.json
```

Le JSON Schema est généré à partir du modèle qu'utilise l'export : producteurs et rapport partagent un seul
contrat.

## Exporter

Exportez les actions avec l'activité préparée exacte dont elles proviennent :

```bash
.venv/bin/python tools/learner_report.py export reports/learner-report \
  --actions chemin/vers/learner-actions.json \
  --activity chemin/vers/activite-preparee/activity.json
```

Le champ `activity_sha256` du fichier annexe doit correspondre à l'empreinte de cette activité : libellés,
énoncé de la source, paramètres, choix et contrôles du rapport appartiennent ainsi à la définition capturée.
Sans `--activity`, le rapport indique que le contexte est indisponible au lieu de deviner les libellés.

| Pour inclure | Ajoutez |
|---|---|
| Une copie du journal avec les actions | `--journal chemin/vers/journal.json` |
| Le journal seul | `--journal` sans `--actions` |
| Vos textes originaux | `--include-original-text` |

Les textes libres et les localisateurs de preuves du journal sont masqués par défaut. Garder vos propres mots
est un choix local explicite. L'accord donné pour stocker le journal ne vaut pas accord pour partager ou publier
le rapport. L'export ne copie aucun champ d'identité de l'apprenant ni de séance privée, mais des identifiants
d'activité ou des descriptions de sources peuvent encore vous identifier : relisez le rapport avant de le
partager. Le masquage est une règle appliquée aux champs autorisés, pas une garantie générale
d'anonymisation.

## Ouvrir et vérifier

Ouvrez `reports/learner-report/index.html` : une vue portable et échappée qui montre l'activité et le journal
sur deux chronologies distinctes, avec des liens vers les fichiers ASTRA, ARA, MyST et d'intégrité (voir le
[glossaire](../concepts/glossary.fr.md) pour ces formats).

Pour l'afficher dans l'Observatory MySTRA, faites pointer la racine des cours vers le dossier parent du
rapport :

```bash
.venv/bin/python services/observatory/observatory_app.py --course-root reports --port 8124
```

Ouvrez ensuite `http://127.0.0.1:8124/courses/learner-report/mystra`. La page montre les actions et les
événements du journal masqués. Son résumé est pensé pour un cours et affiche zéro scène jugée : c'est attendu,
l'évaluation ne fait pas partie de l'export. Pour en savoir plus : [Observatory](../teach/observatory.fr.md).

Vérifiez un export avant de vous y fier :

```bash
.venv/bin/python tools/learner_report.py verify reports/learner-report
```

La vérification revalide les sources choisies et leurs liens, recalcule le résumé et les sorties rendues, lance
le validateur `astra-tools` installé (ASTRA 0.0.14) et contrôle l'empreinte SHA-256 de chaque sortie standard
et de chaque source choisie. Le manifeste n'est pas signé : il détecte un fichier périmé, manquant ou modifié
par accident, mais quelqu'un qui peut réécrire tout le rapport peut aussi réécrire ses empreintes.

## Contenu du dossier

| Fichier | Contenu |
|---|---|
| `sources/learner-actions.json`, `sources/experiment-journal.json`, `sources/activity.json` | Les seuls enregistrements choisis, masqués |
| `report.json` | Le résumé technique dérivé et son périmètre |
| `astra.yaml` | La déclaration d'artefacts ASTRA 0.0.14 |
| `trace/exploration_tree.yaml` | Des parcours d'actions séparés, reliés à leurs preuves |
| `course_provenance.myst.md` | La sortie du moteur de rendu MySTRA partagé |
| `index.html` | La vue portable |
| `checks.json` | Le résultat du validateur et les empreintes des fichiers (il ne s'inclut pas lui-même) |

Le dossier ne contient jamais de copie de la trace brute d'origine. Le code se trouve dans
[tools/learner_report.py](../../tools/learner_report.py) et [tools/learner_trace.py](../../tools/learner_trace.py).
