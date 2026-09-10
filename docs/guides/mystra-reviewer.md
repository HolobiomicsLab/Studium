# MySTRA — inspecter un cours avant diffusion

MySTRA permet à un enseignant ou relecteur de consulter les décisions, alternatives,
preuves et revues enregistrées dans les artefacts ASTRA d'un cours. Dans l'Observatory,
ouvrir le cours puis **MySTRA** (`/courses/<id>/mystra`). La page est lisible dans le
navigateur et imprimable; **MyST source** conserve le Markdown pour un document MyST.
Le HTML est construit avec les lecteurs structurés existants, sans exécuter le
Markdown, les liens de preuve ou le code contenu dans les artefacts.

Le dossier présente toutes les analyses et les revues de chaque bundle, y compris
les revues de l'ancien format. Les citations proviennent de `Evidence.quote.exact`;
les anciennes formes sont encore lisibles. Un document absent ou illisible apparaît
comme tel. Un verdict de modèle et une validation ASTRA ne valent pas validation
pédagogique: la décision de diffuser reste celle de l'enseignant.

La validation de schéma est déclenchée par le lien **Run or inspect validation**, puis son statut
est visible dans le dossier. Elle contrôle le schéma et les références structurelles.
La commande actuelle utilise `--skip-evidence`: elle ne vérifie pas les fichiers de
preuve ni la justesse de leurs citations. Ouvrir MySTRA ne lance aucun modèle et ne
modifie aucun artefact. Le service reste local, sans authentification ni déploiement.

## Démarrer sur ses artefacts

Depuis le dépôt code, avec son virtualenv:

```sh
.venv/bin/python services/observatory/observatory_app.py \
  --course-root /absolute/path/to/generated-courses --port 8004
```

Le répertoire contient un sous-dossier par cours, avec `astra.yaml`. Pour un dossier
unique, utiliser `--course /absolute/path/to/course`. Ouvrir
[Studium Observatory local](http://127.0.0.1:8004/). Les détails de configuration et
les vues Sessions/Harness restent dans [le guide Observatory](observatory.md).

Le contrat utilisé est épinglé dans `requirements.txt`: `astra-spec==0.0.14` et
`astra-tools==0.2.17`. L'installation documentée est `.venv/bin/python -m pip install
-r requirements.txt`; l'outil doit être installé dans le même virtualenv que le
serveur. Les versions réellement chargées figurent sur la page de validation.

## Démonstration et audit sans appel de modèle

Choisir un chemin **qui n'existe pas encore**. Le script refuse d'écraser une
précédente démonstration:

```sh
.venv/bin/python tools/audit-mystra-fixtures.py /tmp/my-studium-review-demo
.venv/bin/python services/observatory/observatory_app.py \
  --course-root /tmp/my-studium-review-demo/courses \
  --eval-root /tmp/my-studium-review-demo/eval \
  --validity-root /tmp/my-studium-review-demo/validity \
  --sessions-root /tmp/my-studium-review-demo/sessions \
  --analytics-data-dir /tmp/my-studium-review-demo/analytics --port 8114
```

Dans un autre terminal, depuis le même dépôt:

```sh
OBSERVATORY_URL=http://127.0.0.1:8114 PLAYWRIGHT_CHANNEL=chrome \
  node tools/audit-mystra-ui.mjs /tmp/my-studium-review-demo /tmp/my-studium-review-evidence
```

Les trois dossiers sont synthétiques: `review-demo` porte deux analyses et deux
revues, `no-review` montre l'absence de revue, `partial-course` contient volontairement
un univers illisible. Le premier passe le vrai validateur avant le lancement du GUI.
Aucun contenu validé, étudiant ou résultat de modèle live n'est utilisé.

Le pilote conserve des captures desktop/mobile/impression, un PDF, l'export MyST,
le verdict du validateur et un `report.json`. Il vérifie les citations, les deux
revues, la navigation clavier, le débordement mobile, l'absence de requêtes externes
et d'erreurs navigateur, ainsi que les octets et mtimes des artefacts avant/après.
Il nécessite les dépendances pnpm installées et Chrome (`PLAYWRIGHT_CHANNEL` permet
une autre installation Playwright). Un succès exige exit 0 et `passed: true`.

La commande indépendante `.venv/bin/python tools/astra_validate_check.py` reste le
contrôle CI de conformance ASTRA; `python tools/pytest_all.py` découvre aussi les
nouveaux tests MySTRA. Les journaux et preuves de cette tranche sont dans le hub
`studium_dev/docs/superpowers/audits/2026-09-10-mystra-reviewer.md`.
