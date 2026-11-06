[English](README.md) · Français

# Outils

Les outils en ligne de commande et les scripts qui accompagnent les applications : préparer et vérifier
une leçon, l'approuver, exporter des rapports, lancer les suites de tests, reproduire des audits et des
démonstrations. Lancez-les depuis la racine du dépôt ; les outils Python utilisent l'environnement
virtuel du dépôt (`.venv`).

| | |
|---|---|
| Statut | **maintenus** (les outils de création et d'approbation font partie du parcours pris en charge) |
| Installation | `pnpm install` ; `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt` |
| Tests | `.venv/bin/python -m pytest tools` et `bash tools/bundle_lint.test.sh` |

La [référence de la ligne de commande](../docs/reference/cli.fr.md) détaille les options des commandes
principales.

## Préparer, vérifier et approuver une leçon

| Commande | Rôle |
|---|---|
| `.venv/bin/python tools/conversation_sources.py` | transformer une transcription Claude Code (`.jsonl`) ou un export texte d'une conversation en entrée de `prepare_sources`, de type `conversation` ; local, résultats d'outils écartés par défaut, chaînes ressemblant à des identifiants remplacées (`--focus`, `--last`, `--include-tool-results`, `--language`, `--out`) |
| `.venv/bin/python tools/experience_packet.py passages` | capturer une URL, une page HTML, un PDF ou un texte choisi par l'apprenant en enveloppe de passages (`--url`, `--html`, `--pdf`, `--text`, `--out`) |
| `.venv/bin/python tools/experience_packet.py prepare` | transformer des passages en paquet de création hors ligne (`--passages`, `--out`, `--title`) |
| `.venv/bin/python tools/experience_packet.py check` | valider une réponse d'auteur au regard du paquet (`--packet`, `--response`, `--out` ; `--json` pour des constats structurés) |
| `.venv/bin/python tools/experience_packet.py bundle` | construire un bundle de leçon jouable à partir d'un cours vérifié (`--course`, `--out`) |
| `.venv/bin/python tools/experience_packet.py approve` | enregistrer la relecture d'une leçon par un enseignant dans `approval.json`, lié aux octets exacts de `lesson.json` (`--bundle`, `--validated-by`) |
| `node tools/bundle_lint.mjs <lesson.json>` | lint sans dépendance d'un bundle rédigé ; `--root <dossier>` vérifie un dossier de bundles |
| `node_modules/.pnpm/node_modules/.bin/tsx tools/bundle_validate.ts <lesson.json>` | valider un bundle contre le schéma TypeScript |
| `.venv/bin/python tools/self_study_passages.py` | la capture de passages derrière `experience_packet.py passages` |
| `.venv/bin/python tools/experience_approval.py` | `import`, `approve`, `verify`, `attach`, `synthesize` : relecture locale d'une révision exacte d'un plan de leçon |
| `.venv/bin/python tools/experience_review.py <dossier vérifié>` | afficher un brouillon vérifié comme vue de provenance ASTRA/MySTRA (ce n'est pas une approbation) |
| `.venv/bin/python tools/compose_lesson.py` | enchaîner un corpus et une capsule en bundle de jugement noté |

`prompts/` contient les consignes d'auteur que ces outils transmettent à un assistant ; `fixtures/`
contient les entrées de test du lint et des rapports.

## Rapports et analyses

| Commande | Rôle |
|---|---|
| `.venv/bin/python tools/class_report.py <run_dir>` | analyses de classe sur des flux de télémétrie, derrière un plancher de cinq apprenants |
| `.venv/bin/python tools/learner_report.py export` / `verify` | exporter un rapport d'activité choisi par l'apprenant, ou en vérifier un |
| `.venv/bin/python tools/learner_trace.py validate` / `schema` | valider un fichier d'actions de l'apprenant, ou écrire son schéma JSON |
| `.venv/bin/python tools/astra_render.py <course_dir>` | rendre la provenance d'un cours en une page MyST (MySTRA) |
| `.venv/bin/python tools/astra_validate_check.py` | construire l'ensemble ASTRA du planner et lancer le vrai validateur (la CI le lance) |
| `.venv/bin/python tools/ontology_report.py` | régénérer la page de conformité de l'ontologie à partir des schémas sur disque |

## Activités, médias et capsules

| Commande | Rôle |
|---|---|
| `.venv/bin/python tools/experience_templates.py list` / `prepare` | lister et préparer les modèles d'activité de [`examples/activity-templates`](../examples/activity-templates) |
| `.venv/bin/python tools/activity_presentation.py`, `tools/activity_support.py` | préférences de présentation et fichiers d'accompagnement des visionneuses d'activité |
| `.venv/bin/python tools/media_workflow.py prepare` / `attach` | écrire une demande de média indépendante du fournisseur ; joindre un résultat local vérifié |
| `.venv/bin/python tools/experience_exploration.py` | capturer une exploration du harnais pour relecture, sans l'exécuter |
| `.venv/bin/python tools/capsule_runner.py <capsule_dir>` | exécuter une capsule de reproduction ASB et capturer ses artefacts (niveau léger seulement, sauf `--allow-heavy`) |
| `.venv/bin/python tools/ground_judgment.py` | rattacher une exécution réelle de capsule à une scène de jugement |
| `.venv/bin/python tools/funmooc_ingest.py` | lire un cours FUN-MOOC (Open edX) auquel vous avez accès, avec votre propre cookie de session, vers un corpus |

## Tests et qualité

| Commande | Rôle |
|---|---|
| `.venv/bin/python tools/pytest_all.py` | toutes les suites Python du dépôt, un processus pytest par suite |
| `bash tools/bundle_lint.test.sh` | tests de contrat du lint des bundles |
| `node tools/docs/check.mjs` | le contrôle de la documentation : liens, paires de langues, pages de référence générées |
| `node tools/docs/gen-mcp-tools.mjs`, `node tools/docs/gen-lesson-bundle.mjs` | régénérer les références des outils MCP et du bundle de leçon (`--check` pour vérifier) |
| `node tools/audit-*.mjs`, `.venv/bin/python tools/audit-*.py` | audits navigateur et accessibilité des surfaces apprenant, enseignant, VS Code et Observatory ; chacun indique ses entrées en tête de fichier |

## De bout en bout et démonstrations

| Commande | Rôle |
|---|---|
| `bash tools/e2e-demo-m6.sh` | démonstration en deux séances avec le collecteur d'analyses et le tableau de bord enseignant (aussi un job manuel de la CI) |
| `bash tools/e2e-c2.sh`, `bash tools/e2e-m5.sh`, `bash tools/e2e-a10.sh` | anciens parcours de bout en bout (télémétrie, inter-séances, du plan au bundle) ; certains demandent l'application Tauri gelée |
| `.venv/bin/python tools/demo-literature-experience.py <nouveau dossier>` | de l'article capturé au brouillon, à MySTRA et à la visionneuse externe |
| `.venv/bin/python tools/demo-grounded-exploration.py <nouveau dossier>`, `tools/demo-template-reports.py` | démonstrations d'exploration et de rapports de modèles, sans appel de modèle |
| `.venv/bin/python tools/bake_demo_fresh.py`, `tools/build_capsule_judgment_demo.py` | reconstruire des bundles de démonstration |
| `.venv/bin/python tools/memory_cli.py` | ajouter des entrées et décisions à la mémoire d'agent dans `.memory/` |

## Voir aussi

- [Créer une leçon](../docs/teach/author-a-lesson.fr.md)
- [Relire et approuver](../docs/teach/review-and-approve.fr.md)
- [Tests](../docs/develop/testing.fr.md)
