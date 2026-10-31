# Reproduire les audits locaux de Studium

Les trois pilotes ci-dessous utilisent uniquement des fixtures synthétiques.
Ils n'appellent aucun modèle payant et ne diffusent rien à des étudiants.
Préparer les dépendances avec `pnpm install --frozen-lockfile` puis `pnpm build`.
Utiliser le venv Python du projet; ne pas réutiliser des données de production.

## Interface apprenant

Dans un terminal, depuis la racine du code:

```sh
pnpm --filter @studium/student-runtime exec vite --host 127.0.0.1 --port 5186 --strictPort
```

Dans un second terminal:

```sh
node tools/audit-learner-ui.mjs /tmp/studium-learner-evidence
```

Le pilote ouvre Chrome installé sur la machine, parcourt le vrai frontend et
écrit captures PNG et `report.json`. `LEARNER_URL` change l'adresse et
`PLAYWRIGHT_CHANNEL` choisit un autre navigateur installé. Le rapport distingue
les vérifications réussies des éventuelles observations `findings`.

Le pont Tauri est un **double IPC en mémoire**, installé uniquement par le pilote
avant le chargement de l'application. Les trois fichiers `lesson.json` sont lus
sans modification; leurs empreintes figurent dans le rapport. Les choix du quiz
proviennent des contrôles visibles, sans consultation des corrigés. Ce contrôle
ne valide ni SQLCipher, ni Keychain, ni la livraison réseau de la télémétrie.
Voir [la limite native](native-ui-audit.md).

## Collecteur réel et interface enseignant

Démarrer un collecteur sur un **répertoire neuf** dans un terminal. Adapter le
chemin du venv si le travail est dans un worktree; le `PYTHONPATH` doit désigner
les sources du checkout effectivement audité.

```sh
AUDIT_DATA_DIR=$(mktemp -d /tmp/studium-collector-data.XXXXXX)
ANALYTICS_DATA_DIR="$AUDIT_DATA_DIR" ANALYTICS_MIN_LEARNERS=5 \
  PYTHONPATH="$PWD/packages/telemetry-events/python" \
  .venv/bin/python -m uvicorn analytics_collector_app:app \
  --app-dir services/analytics-collector --host 127.0.0.1 --port 8106
```

Dans un autre terminal:

```sh
.venv/bin/python tools/audit-collector-live.py /tmp/studium-collector-results.json
ANALYTICS_BASE_URL=http://127.0.0.1:8106 \
  pnpm --filter @studium/teacher-dashboard exec next dev --hostname 127.0.0.1 --port 3106
```

Le pilote injecte 55 événements pour `studium-audit-cohort`, deux pour
`studium-audit-private` et un avec identité vide pour `studium-audit-anonymous`.
Ces identifiants sont publics et synthétiques. Il vérifie les valeurs de dix
familles d'agrégats, leurs retenues, les réponses 401/403 et le rejet du champ
d'identité absent. Ne pas réinjecter ce jeu dans le même répertoire: le protocole
attend les effectifs d'une cohorte neuve.

Enfin, avec les deux serveurs actifs:

```sh
PLAYWRIGHT_CHANNEL=chrome ANALYTICS_BASE_URL=http://127.0.0.1:8106 \
  DASHBOARD_PORT=3106 DASHBOARD_PORT_EXTERNAL=1 E2E_COURSE_TOKEN=studium-audit-cohort \
  pnpm --filter @studium/teacher-dashboard exec playwright test --workers=1
node tools/audit-teacher-ui.mjs /tmp/studium-teacher-evidence
```

Sans `PLAYWRIGHT_CHANNEL`, Playwright utilise son Chromium habituel. Sur cette
machine la révision 1217 n'était pas disponible; Chrome a permis d'exécuter
l'ensemble des specs. Le contournement est un choix de navigateur, pas un mock
des API. Arrêter les serveurs avec Ctrl+C avant `pnpm build`: Next dev et Next
build ne doivent pas écrire simultanément dans `.next`.

## Propriété des évaluations et graphe

```sh
node node_modules/.pnpm/node_modules/tsx/dist/cli.mjs tools/audit-concept-ownership.ts
```

Ce diagnostic compare `concept_refs` et les arêtes `assesses` de deux bundles,
puis exécute `LessonSession` et `graphAwareNextIndex`. Il rapporte les divergences
et une projection contrefactuelle; il ne choisit pas quelle source pédagogique
doit devenir autoritaire et ne modifie aucun bundle validé.
