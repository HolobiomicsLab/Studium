[English](README.md) · Français

# Author Studio (héritée)

La première interface de création : déposer un PDF, obtenir un plan de leçon du planner, modifier ses
titres et l'exporter ; plus deux pages « apprenant auteur » où un étudiant propose une question de quiz
(`/studio`) et où ses pairs la testent (`/peer`). L'application affiche un bandeau « héritée ». Les leçons
actuelles se préparent depuis une conversation ou avec `tools/experience_packet.py`, et se relisent dans
le [tableau de bord enseignant](../teacher-dashboard/README.fr.md).

| | |
|---|---|
| Statut | **héritée** (décision D6 ; bandeau dans l'application) |
| Lancer | `pnpm --filter @studium/author-web dev` |
| Port | 3000 |
| Appelle | ingestion (8000), planner (8001), scene-synth (8002) |
| Tests | `pnpm --filter @studium/author-web test` |

## La lancer

```bash
pnpm --filter @studium/author-web dev
```

Ouvrez `http://localhost:3000`. Les pages :

| Page | Rôle |
|---|---|
| `/` | déposer un PDF ; appelle l'ingestion puis le planner |
| `/plan/<id>` | modifier le titre du plan et ceux des scènes ; **Valider et exporter** télécharge le JSON |
| `/studio` | un apprenant propose une question de quiz, validée par scene-synth |
| `/peer` | les pairs passent et notent la question d'un camarade |

**Valider et exporter** marque le plan `approved` et renseigne `validated_by` dans le seul fichier
téléchargé ; aucune approbation n'est enregistrée côté serveur et la synthèse n'est pas lancée.

## Configuration

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `NEXT_PUBLIC_INGEST_SERVICE_URL` | `http://localhost:8000` | [service d'ingestion](../../services/ingest/README.fr.md) |
| `NEXT_PUBLIC_PLANNER_SERVICE_URL` | `http://localhost:8001` | [planner](../../services/planner/README.fr.md) |
| `NEXT_PUBLIC_SCENE_SYNTH_SERVICE_URL` | `http://localhost:8002` | [scene-synth](../../services/scene-synth/README.fr.md) |

## Limites

- Les services se lancent et se configurent séparément. Le planner répond 503 sans modèle configuré et
  ne règle pas CORS pour un POST JSON direct depuis `localhost:3000` : sans proxy, le parcours navigateur
  est bloqué.
- `POST /scenes/synthesize` répond 503 tant qu'aucun orchestrateur n'est configuré : le plan ne peut pas
  devenir une leçon depuis cette application.
- L'interface est en français.

## Tests

```bash
pnpm --filter @studium/author-web test
pnpm --filter @studium/author-web typecheck
```

## Voir aussi

- [Créer une leçon](../../docs/teach/author-a-lesson.fr.md), le parcours actuel
- [Contributions des apprenants](../../docs/teach/learner-contributions.fr.md)
