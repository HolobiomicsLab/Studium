<!-- Bilingue FR/EN — version française d'abord, English version below. -->
# Studium — Learner-as-author : Guide UI / UI Guide

> **Bilingue.** 🇫🇷 Version française d'abord · 🇬🇧 English version below.

---

## 🇫🇷 Version française

### Vue d'ensemble
Le mode **apprenant·e-auteur·e** ajoute deux écrans web autour du backend **scene-synth** :
- **`/studio`** — app `author-web` (port **3000**) : l'apprenant·e **rédige** un quiz, le **valide**, le **teste**, puis le **soumet**.
- **`/courses/<cours>/submissions`** — app `teacher-dashboard` (port **3001**) : l'enseignant·e **modère** les soumissions et **publie**.

### Pré-requis
- Node 20+, pnpm, le repo sur `main` (`git pull` + `pnpm install`).
- Le venv Python `.venv` (présent dans le repo). **Aucune clé API requise.**

### Lancer la pile (3 terminaux)
```bash
# 1) Backend scene-synth (port 8002)
cd ~/git/prototype-build/services/scene-synth
../../.venv/bin/python -m uvicorn scene_synth_app:app --reload --port 8002

# 2) App apprenant·e (port 3000)
cd ~/git/prototype-build && pnpm --filter @studium/author-web dev
#    → http://localhost:3000/studio

# 3) App enseignant·e (port 3001)
cd ~/git/prototype-build && pnpm --filter @studium/teacher-dashboard dev
#    → http://localhost:3001/courses/atomistique-l1/submissions
```
Les apps parlent à scene-synth sur `:8002` par défaut (variables `NEXT_PUBLIC_SCENE_SYNTH_SERVICE_URL` côté apprenant·e, `SCENE_SYNTH_BASE_URL` côté enseignant·e). Le CORS autorise déjà `:3000` et `:3001`.

> **Cours de démo** : `atomistique-l1`, concept `c-orbitales-formes`. Le **jeton de cours = l'identifiant du cours** → l'URL enseignant·e est donc `/courses/atomistique-l1/submissions`.

### Écran apprenant·e — `/studio`
1. **Formulaire guidé** (pas de JSON) : titre, question, **Choix (2 à 6, exactement un correct)**, feedback si correct / si incorrect, indices.
2. **Badge de validation** (vert/rouge) : à chaque saisie, le formulaire appelle `POST /learner-items/validate`. **Vert** = scène valide (schéma + *exactement une* bonne réponse + concept appartenant au cours).
3. **Auto-test** (panneau *self-test*) : tu réponds à **ton propre** quiz **sans clé API** (correcteur local) et tu vois le vrai feedback — pour vérifier distracteurs et feedback avant d'envoyer.
4. **Consentement** : la case *consentement* **+** le badge vert débloquent **Soumettre** → `POST /learner-items`. La scène part en état `submitted`.

> ⚠️ L'app apprenant·e **ne publie jamais** : elle ne peut que créer une soumission. La publication passe **uniquement** par l'approbation enseignant·e (règle 003).

### Écran enseignant·e — `/courses/atomistique-l1/submissions`
- Onglet **« Soumissions »** : liste les items en état `submitted`.
- Chaque item affiche : le **corps de la scène**, la **clé de réponse** (bonnes réponses marquées ●), le **badge de validation**, et une **étiquette auteur·e dé-identifiée** (jamais le pseudonyme réel) — pour qu'on n'approuve **jamais à l'aveugle**.
- Actions : **Approuver** / **Rejeter** / **Demander une révision** → `POST /learner-items/{id}/decide`.
- À l'**approbation**, scene-synth émet un **bundle communautaire** mono-scène dans le *bundles-root* (le cours d'origine reste **immuable**), avec `validated_by` = l'enseignant·e et le pseudonyme auteur·e **scrubé**.

### Confidentialité (par construction)
- Le texte libre reste sur l'appareil jusqu'à la soumission explicite ; jamais en télémétrie.
- Le **pseudonyme auteur·e (HMAC) est serveur-only** : jamais renvoyé au client, jamais montré aux pairs.
- L'auto-test ne fait **aucun** appel réseau / LLM.

### Dépannage
| Symptôme | Cause / solution |
|---|---|
| Erreur CORS dans la console | scene-synth non lancé, ou origine ≠ `:3000`/`:3001` |
| `400` à la soumission | `course_id` doit être `atomistique-l1` (cours de démo unique) |
| File vide (enseignant·e) | aucune soumission `submitted` — fais d'abord l'étape apprenant·e |
| `Connection refused :8002` | le backend scene-synth n'est pas démarré |
| `next build` casse sur les types | refais `pnpm install` (relie les types Next/React) |

---

## 🇬🇧 English version

### Overview
The **learner-as-author** mode adds two web screens around the **scene-synth** backend:
- **`/studio`** — `author-web` app (port **3000**): the learner **drafts** a quiz, **validates** it, **self-tests** it, then **submits** it.
- **`/courses/<course>/submissions`** — `teacher-dashboard` app (port **3001**): the teacher **moderates** submissions and **publishes**.

### Prerequisites
- Node 20+, pnpm, repo on `main` (`git pull` + `pnpm install`).
- The Python `.venv` (in the repo). **No API key required.**

### Start the stack (3 terminals)
```bash
# 1) scene-synth backend (port 8002)
cd ~/git/prototype-build/services/scene-synth
../../.venv/bin/python -m uvicorn scene_synth_app:app --reload --port 8002

# 2) Learner app (port 3000)
cd ~/git/prototype-build && pnpm --filter @studium/author-web dev
#    → http://localhost:3000/studio

# 3) Teacher app (port 3001)
cd ~/git/prototype-build && pnpm --filter @studium/teacher-dashboard dev
#    → http://localhost:3001/courses/atomistique-l1/submissions
```
Apps call scene-synth on `:8002` by default (`NEXT_PUBLIC_SCENE_SYNTH_SERVICE_URL` on the learner side, `SCENE_SYNTH_BASE_URL` on the teacher side). CORS already allows `:3000` and `:3001`.

> **Demo course**: `atomistique-l1`, concept `c-orbitales-formes`. The **course token = the course id**, so the teacher URL is `/courses/atomistique-l1/submissions`.

### Learner screen — `/studio`
1. **Guided form** (no JSON): title, question, **Choices (2–6, exactly one correct)**, feedback-if-correct / feedback-if-incorrect, hints.
2. **Validation badge** (green/red): on every edit the form calls `POST /learner-items/validate`. **Green** = valid scene (schema + *exactly one* correct + a concept that belongs to the course).
3. **Self-test** panel: you answer **your own** quiz **with no API key** (local grader) and see the real feedback — to sanity-check distractors and feedback before sending.
4. **Consent**: the *consent* checkbox **+** the green badge unlock **Submit** → `POST /learner-items`. The scene leaves in state `submitted`.

> ⚠️ The learner app **never publishes** — it can only create a submission. Publishing happens **only** through the teacher's approval (rule 003).

### Teacher screen — `/courses/atomistique-l1/submissions`
- A **"Soumissions"** tab listing `submitted` items.
- Each item shows the **scene body**, the **answer key** (correct answers marked ●), the **validation badge**, and a **de-identified author tag** (never the real pseudonym) — so you **never approve blind**.
- Actions: **Approve** / **Reject** / **Request revision** → `POST /learner-items/{id}/decide`.
- On **approve**, scene-synth emits a single-scene **community bundle** into the bundles-root (the original course stays **immutable**), with `validated_by` = the teacher and the author pseudonym **scrubbed**.

### Privacy (by construction)
- Free text stays on-device until explicit submit; never in telemetry.
- The **author pseudonym (HMAC) is server-only**: never returned to the client, never shown to peers.
- The self-test makes **no** network / LLM call.

### Troubleshooting
| Symptom | Cause / fix |
|---|---|
| CORS error in the console | scene-synth not running, or origin ≠ `:3000`/`:3001` |
| `400` on submit | `course_id` must be `atomistique-l1` (single demo course) |
| Empty queue (teacher) | no `submitted` item — do the learner step first |
| `Connection refused :8002` | the scene-synth backend isn't started |
| `next build` fails on types | re-run `pnpm install` (relinks Next/React types) |
