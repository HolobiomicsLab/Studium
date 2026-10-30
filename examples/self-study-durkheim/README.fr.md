# Exemple d'autoformation sur Durkheim

Cet exemple est une courte leçon achevée, en français, construite à partir de la capture HTML conservée du chapitre I des *Règles de la méthode sociologique* d'Émile Durkheim. Elle apprend à reconnaître le fait social par son extériorité, son pouvoir de coercition et son existence indépendante de ses manifestations individuelles.

La leçon dure environ 18 minutes. Ses quatre scènes associent une introduction sourcée, un quiz à livre ouvert, une comparaison et une explication par l'apprenant. Les deux scènes de production demandent de raisonner avec ses propres mots, et pas seulement de reconnaître une réponse.

## Fichiers

- `passages.json` est la capture portable des 29 passages extraits de `tools/fixtures/self-study/durkheim-ch1.html`. La leçon en cite quatre.
- `author-response.json` contient le LessonPlan brouillon et ses quatre liens vers des citations vérifiées caractère par caractère.
- `lesson.json` est le LessonBundle 1.4 achevé, généré depuis ce plan puis complété avec les contenus visibles et les références de notation.

Le bundle déclare `metadata.authoring.mode = "self_study"`, `author_is_learner = true` et `validated_by = "SELF-STUDY — not teacher-validated"`. La clé du quiz reste donc écrite par l'apprenant et consultable dans le fichier. Cet exemple sert à l'étude privée ; il ne constitue ni une approbation enseignante ni une diffusion à des étudiants.

## Rejouer la chaîne

Depuis la racine du dépôt, avec l'environnement virtuel du projet :

```bash
.venv/bin/python tools/experience_packet.py passages \
  --html tools/fixtures/self-study/durkheim-ch1.html \
  --title "Les Règles de la méthode sociologique — chapitre I" \
  --license Public-Domain \
  --out /tmp/durkheim-passages.json

.venv/bin/python tools/experience_packet.py prepare \
  --passages /tmp/durkheim-passages.json \
  --title "Comprendre le fait social chez Durkheim" \
  --target "Licence 1 — étude autonome" \
  --self-study \
  --out /tmp/durkheim-packet

.venv/bin/python tools/experience_packet.py check \
  --packet /tmp/durkheim-packet \
  --response examples/self-study-durkheim/author-response.json \
  --out /tmp/durkheim-course

.venv/bin/python tools/experience_packet.py bundle \
  --course /tmp/durkheim-course \
  --self-study \
  --out /tmp/durkheim-skeleton.json
```

La commande `bundle` produit volontairement un squelette d'édition. Le fichier `lesson.json` fournit les champs de scène achevés tout en conservant les identifiants, concepts, graphe, règles, métadonnées et avertissements générés. Le test de bout en bout applique cette complétion et vérifie le résultat :

```bash
.venv/bin/python -m pytest tools/test_self_study_e2e.py -q
node tools/bundle_lint.mjs examples/self-study-durkheim/lesson.json
pnpm exec tsx tools/bundle_validate.ts examples/self-study-durkheim/lesson.json
```

## Source

Émile Durkheim, *Les Règles de la méthode sociologique*, chapitre I, 1895. La page Wikisource du domaine public conservée dans le dépôt est l'unique source employée ; aucun accès réseau n'est nécessaire.
