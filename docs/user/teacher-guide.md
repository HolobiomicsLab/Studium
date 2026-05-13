# Guide enseignant — Studium démo M6

> Studium v1 démo — chimie atomistique L1 SV.

## 1. Prérequis

- Studium installé (`pnpm install`, Python ≥ 3.13, Rust ≥ 1.95 stable).
- Services Python en éditable :
  ```bash
  pip install -e services/planner services/scene-synth services/analytics-collector
  ```
- (Optionnel) Perspicacité MCP configuré pour enrichissement bibliographique.

## 2. Workflow auteur

### 2.1 Ingestion d'un corpus pédagogique

Place tes documents source dans un dossier :

```
mon-corpus/
  cours.pdf
  td.pdf
  articles/*.pdf
```

Lance le planner :

```bash
curl -X POST http://localhost:8001/plan \
  -H "Content-Type: application/json" \
  -d '{
    "corpus_path": "mon-corpus/",
    "target_level": "L1",
    "duration_minutes": 45,
    "language": "fr",
    "discipline": "chimie atomistique"
  }'
```

Le service `planner` retourne un `lesson-plan.json` (schema 1.4) qui inclut :
- Plan structuré (objectifs, scènes, concepts)
- Critique automatique (`CriticAgent`)
- Enrichissement bibliographique optionnel (Perspicacité refs + ABS asset)

### 2.2 Configuration du blueprint d'évaluation

Le blueprint définit la pondération des 4 dimensions ADR 013 :

- Connaissance & application
- Pensée critique / raisonnement
- Métacognition / autonomie
- Littératie IA

Par défaut, pondération équilibrée (25/25/25/25). Modifiable via UI auteur ou
édition directe du `lesson-plan.json` (champ `assessment_blueprint`).

### 2.3 Génération du bundle

```bash
curl -X POST http://localhost:8002/scenes/synthesize \
  -H "Content-Type: application/json" \
  --data @lesson-plan.json
```

Produit `lesson-bundle.json` (schema 1.4) consommé par le runtime étudiant.

### 2.4 Export

```bash
zip -r demo-bundle.zip lesson.json abs-capsule/
```

Bundle distribuable aux étudiants (USB, LAN, ou téléchargement).

## 3. Lecture du dashboard

Lance le dashboard :

```bash
cd apps/teacher-dashboard
pnpm dev  # port 3001
```

Ouvre `http://localhost:3001`.

### 3.1 Vue Journal

Liste des entrées libres rédigées par les étudiants (modulateur M5 métacognition).
Indicateurs : nombre d'entrées par étudiant, dispersion, mots-clés fréquents.

**Comment l'interpréter** : un étudiant qui écrit ≥ 2 entrées par leçon avec
vocabulaire technique correct manifeste un engagement métacognitif solide.
Si 0 entrée, le modulateur M5 ne s'est pas déclenché — vérifier les
adaptation_hooks de la leçon.

### 3.2 Vue Blueprint radar

Radar à 4 dimensions, valeurs 0–1, par étudiant ou agrégat classe.

**Comment l'interpréter** :
- Lobe asymétrique = profil pédagogique typé (ex: forte connaissance,
  faible métacognition → tendance à mémoriser sans réfléchir).
- Lobe équilibré et large = maîtrise transversale.
- Lobe étroit = lacunes globales — revoir le plan.

### 3.3 Vue Coopération (analytics-only en v1)

Le mode LAN coopératif M4 est **différé** dans la v1 démo. La vue affiche
néanmoins les statistiques agrégées disponibles (taux de désaccord productif
si données récoltées sur d'autres sessions).

### 3.4 Vue Evidence (`scenes_with_evidence`)

Métrique calculée par `compute_progress_metrics` : `N/M` scènes ont au moins
1 référence bibliographique ou asset ABS.

**Comment l'interpréter** : ratio élevé = leçon bien sourcée, étudiants
exposés à des contenus traçables. Ratio faible = bundle peut être enrichi
via `STUDIUM_EVIDENCE_ENRICH=on` au prochain `/plan`.

## 4. Interprétation pédagogique

### 4.1 Trajectoire longitudinale

`/metrics/concept-mastery-history` retourne pour chaque concept-clé une série
temporelle Beta(α, β) reflétant l'évolution de la maîtrise.

**Cas typique** : un étudiant qui démontre la maîtrise de "Structure de
l'atome" en session 1 voit Beta(α=5, β=1) → α élevé. En session 2, l'adaptation
le pousse directement vers des questions de plus haut niveau Bloom (analyze)
plutôt que rejouer les bases.

### 4.2 Index littératie IA (`ai_literacy_index`)

Score psychométrique 0–1 basé sur les réponses `ai_critique`. Voir ADR 011
pour la formule complète et les limites psychométriques.

**Usage formatif uniquement v1** — ne pas utiliser en évaluation certificative.

## 5. Troubleshooting

| Symptôme | Cause probable | Solution |
|---|---|---|
| Dashboard vide | Collector pas démarré | `cd services/analytics-collector && uvicorn analytics_collector_app:app --port 8003` |
| Bundle refusé par runtime | Schema version != 1.4 | Régénérer via scene-synth, vérifier `schema_version` |
| Étudiant ne voit pas evidence | Bundle pré-1.4 | Régénérer avec `STUDIUM_EVIDENCE_ENRICH=on` |
| Perspicacité MCP fail | Pas configuré | Optionnel — graceful skip dans `EvidenceEnricher` |

## 6. Limites connues v1

- **Coopératif LAN M4 différé** : pas démontré dans la v1 démo. Brainstorm
  dédié post-M6 nécessaire.
- **Tableau périodique interactif** : statique en v1 (souhait auteur différé M7+).
- **macOS Tauri test WDIO** : impossible (tauri-driver Linux/Windows only).
  Tests E2E via CI Linux (workflow D.5).
- **D.1 validation humaine M3** : reste un blocage rule 003 indépendant — la
  démo M6 ne lève pas ce gate.
- **Evidence editing UI auteur** : pas dans la v1, manuel via édition JSON.

## 7. Pour aller plus loin

- Spec démo détaillée : `docs/user/demo-script-m6.md` (section 7 du présent guide peut servir de script de démo court — `demo-script-m6.md` dédié optionnel et différé M7 si pas le temps).
- ADR principales :
  - Lesson schema v1.4 : `.memory/decisions/003_lesson-schema-v1.md`
  - Evidence enrichment v1 : `.memory/decisions/014_evidence-enrichment-v1.md`
  - Assessment blueprint v1 : `.memory/decisions/013_assessment-blueprint-v1.md`
- Architecture : `architecture/lesson-schema.md`, `architecture/adaptation-model.md`
