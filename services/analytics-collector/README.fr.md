[English](README.md) · Français

# Collecteur d'analyses Studium

Un service FastAPI qui stocke la télémétrie des apprenants en JSONL (ajout seul), un dossier par cours,
et sert des agrégats de classe (progression, calibration, achèvement, profondeur de raisonnement,
confiance, autonomie, etc.) au [tableau de bord enseignant](../../apps/teacher-dashboard/README.fr.md).
Chaque agrégat est protégé par un plancher de cinq apprenants.

| | |
|---|---|
| Statut | **maintenu**, service de développement et de démonstration |
| Lancer | `uvicorn analytics_collector_app:app` (voir ci-dessous) |
| Port | 8003 par convention, sur 127.0.0.1 |
| Appelé par | le tableau de bord enseignant (`ANALYTICS_BASE_URL`) ; lu sur disque par l'[Observatory](../observatory/README.fr.md) |
| Appelle | rien |
| Tests | `.venv/bin/python -m pytest services/analytics-collector` |

## Le lancer

Depuis la racine du dépôt, avec l'environnement virtuel installé :

```bash
ANALYTICS_DATA_DIR=/tmp/studium-analytics .venv/bin/python -m uvicorn analytics_collector_app:app \
  --app-dir services/analytics-collector --host 127.0.0.1 --port 8003
```

| Variable | Valeur par défaut | Rôle |
|---|---|---|
| `ANALYTICS_DATA_DIR` | `data`, relatif au dossier de travail | magasin d'événements, `<magasin>/<cours>/<AAAA-MM-JJ>.jsonl` ; donnez un chemin absolu |
| `ANALYTICS_MIN_LEARNERS` | `5` | plancher côté serveur d'apprenants distincts par agrégat ; jamais un paramètre de requête |

## Routes

| Route | Rôle |
|---|---|
| `GET /health` | disponibilité |
| `POST /telemetry` | ajouter des événements pour un cours |
| `GET /metrics/progress`, `/metrics/course-completion`, `/metrics/scene-breakdown` | progression et achèvement |
| `GET /metrics/calibration`, `/metrics/trust-calibration`, `/metrics/autonomy` | mesures de jugement, publiées avec une tranche d'effectif |
| `GET /metrics/reasoning`, `/metrics/ai-audit`, `/metrics/ai-literacy`, `/metrics/journal`, `/metrics/cooperation`, `/metrics/concept-mastery-history` | autres lectures de classe |
| `POST /metrics/blueprint` | score composite au regard d'un plan d'évaluation, à usage formatif uniquement |

À quoi sert le plancher : il freine l'identification d'un individu ; il ne rend pas les chiffres
anonymes, car l'enseignant connaît déjà sa liste de classe. Les mesures de jugement publient leur
population sous forme de tranche (`5–9`, `10–19`, `20+`) et portent une phrase rappelant qu'il s'agit
d'une lecture de classe, pas d'un jugement sur un étudiant. Les définitions partagées sont dans
[`metrics.py`](metrics.py).

## Limites

- **Pas d'authentification réelle.** L'en-tête `X-Course-Token` doit être égal au `course` lu :
  quiconque connaît l'identifiant d'un cours peut lire ses mesures. Faites-le écouter sur `127.0.0.1`
  (comme `tools/e2e-demo-m6.sh`) et ne l'exposez pas.
- **Confinement des chemins.** Le jeton de cours nomme un dossier sous `ANALYTICS_DATA_DIR`. Il doit
  respecter `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` (ni `..`, ni séparateur, ni point initial) et le dossier
  doit se résoudre dans le dossier de données, liens symboliques compris ; sinon `400` et rien n'est
  écrit. `store.course_dir` est l'unique point d'application.

## Tests

```bash
.venv/bin/python -m pytest services/analytics-collector
```

## Voir aussi

- [Suivre une classe](../../docs/teach/follow-a-class.fr.md)
- [Confidentialité et limites](../../docs/concepts/privacy-and-limits.fr.md)
