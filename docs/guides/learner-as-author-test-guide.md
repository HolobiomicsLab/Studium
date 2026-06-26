<!-- Bilingue FR/EN — version française d'abord, English version below. -->
# Studium — Learner-as-author : Guide de test / Test Guide

> **Bilingue.** 🇫🇷 Version française d'abord · 🇬🇧 English version below.
> Lance d'abord la pile : voir **`learner-as-author-UI-guide.md`** (scene-synth :8002, author-web :3000, teacher-dashboard :3001).

---

## 🇫🇷 Version française

### But
Tester **la boucle complète** *apprenant·e → pair → enseignant·e → camarade*, de bout en bout, sur le cours de démo `atomistique-l1`. Aucune clé API.

### Scénario — quiz « nœuds radiaux de la 3s »

**① Rôle apprenant·e — `http://localhost:3000/studio`**
1. Remplis le quiz :
   - **Question** : « Combien de nœuds radiaux possède l'orbitale 3s ? »
   - **Choix** : `0` (faux), `1` (faux), **`2` (correct)**, `3` (faux) — *un seul correct*.
   - **Feedback correct** : « Oui : nœuds radiaux = n−ℓ−1 = 3−0−1 = 2. »
   - **Feedback incorrect** : « Rappel : nœuds radiaux = n−ℓ−1. »
   - **Indice** : « n−ℓ−1 ».
2. ✅ **Attendu** : le badge passe **vert** (scène valide). Mets deux réponses correctes → le badge passe **rouge** (« exactement un correct ») ; remets-en une seule.
3. **Auto-test** : choisis volontairement `3` → tu vois le *feedback incorrect* ; choisis `2` → *feedback correct*. (Aucun appel réseau / LLM.)
4. Coche **consentement**, clique **Soumettre**.
   ✅ **Attendu** : un `item_id` est renvoyé ; l'item est en état `submitted`. (Le pseudonyme auteur·e n'apparaît **nulle part** côté client.)

**② Rôle pair (optionnel, via API)** — un·e autre apprenant·e teste et note l'item :
```bash
curl -X POST http://localhost:8002/learner-items/<item_id>/peer-review \
  -H 'Content-Type: application/json' \
  -d '{"passed": true, "rating": 5, "helpful": true}'
```
✅ **Attendu** : l'item passe en `peer_review` ; les signaux sont **agrégés** (k-anonymes), **sans identité du pair ni texte libre**. La lecture enseignant·e des signaux est **supprimée** sous le plancher de votants.

**③ Rôle enseignant·e — `http://localhost:3001/courses/atomistique-l1/submissions`**
5. ✅ **Attendu** : l'item apparaît avec le **corps de la scène**, la **clé de réponse** (`2` marqué ●), le **badge de validation**, et une **étiquette auteur·e dé-identifiée**.
6. Vérifie la chimie (3s : n−ℓ−1 = 3−0−1 = 2 ✓), puis clique **Approuver**.
   ✅ **Attendu** : l'item passe `approved → published` ; un **bundle communautaire** est écrit dans le *bundles-root*, **sans** le pseudonyme auteur·e, avec `validated_by` = l'enseignant·e. *(Rejeter / Demander une révision ne publient rien.)*

**④ Vérifier la diffusion (la scène atteint les camarades)**
```bash
# Driver e2e : Python émet le bundle communautaire, TS le découvre + le note.
node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/community_flow_check.mjs
```
✅ **Attendu** : le bundle communautaire est **découvert** à côté du cours (qui reste **immuable**), chargé, et un·e camarade répondant `2` est noté·e **correct** par le `quizGrader` existant — **sans jamais voir l'auteur·e**.

### Ce sur quoi ton retour est précieux
- Le formulaire `/studio` est-il assez guidé pour un·e L1 ? Les messages de validation sont-ils clairs ?
- L'**auto-test** aide-t-il réellement à améliorer le quiz avant l'envoi ?
- La **file de modération** donne-t-elle assez de contexte pour décider (clé de réponse + badge) ?
- La **boucle pair** (tester + noter le quiz d'un·e camarade) a-t-elle du sens pédagogiquement ?
- Manque-t-il un type de scène (au-delà du quiz) pour ce que tu veux faire faire à tes étudiant·es ?

### Garanties (déjà vérifiées par revue adverse)
- L'apprenant·e ne peut **que** soumettre ; **seule** l'approbation enseignant·e publie (**règle 003**).
- L'auto-test est **sans clé API**. Le cours d'origine est **immuable**. L'auteur·e n'est **jamais** exposé·e aux pairs. Les signaux pairs sont **k-anonymes**.

---

## 🇬🇧 English version

### Goal
Test the **full loop** *learner → peer → teacher → classmate*, end to end, on the `atomistique-l1` demo course. No API key.

### Scenario — "3s radial nodes" quiz

**① Learner role — `http://localhost:3000/studio`**
1. Fill in the quiz:
   - **Question**: "How many radial nodes does the 3s orbital have?"
   - **Choices**: `0` (false), `1` (false), **`2` (correct)**, `3` (false) — *exactly one correct*.
   - **Feedback correct**: "Yes: radial nodes = n−ℓ−1 = 3−0−1 = 2."
   - **Feedback incorrect**: "Recall: radial nodes = n−ℓ−1."
   - **Hint**: "n−ℓ−1".
2. ✅ **Expected**: the badge turns **green** (valid scene). Mark two correct answers → it turns **red** ("exactly one correct"); set it back to one.
3. **Self-test**: deliberately pick `3` → you see the *incorrect feedback*; pick `2` → *correct feedback*. (No network / LLM call.)
4. Tick **consent**, click **Submit**.
   ✅ **Expected**: an `item_id` is returned; the item is `submitted`. (The author pseudonym appears **nowhere** on the client.)

**② Peer role (optional, via API)** — another learner tests and rates the item:
```bash
curl -X POST http://localhost:8002/learner-items/<item_id>/peer-review \
  -H 'Content-Type: application/json' \
  -d '{"passed": true, "rating": 5, "helpful": true}'
```
✅ **Expected**: the item moves to `peer_review`; signals are **aggregated** (k-anonymous), with **no peer identity and no free text**. The teacher-facing read is **suppressed** below the raters floor.

**③ Teacher role — `http://localhost:3001/courses/atomistique-l1/submissions`**
5. ✅ **Expected**: the item appears with the **scene body**, the **answer key** (`2` marked ●), the **validation badge**, and a **de-identified author tag**.
6. Check the chemistry (3s: n−ℓ−1 = 3−0−1 = 2 ✓), then click **Approve**.
   ✅ **Expected**: the item goes `approved → published`; a **community bundle** is written into the bundles-root, **without** the author pseudonym, with `validated_by` = the teacher. *(Reject / Request revision publish nothing.)*

**④ Verify diffusion (the scene reaches classmates)**
```bash
# e2e driver: Python emits the community bundle, TS discovers + grades it.
node_modules/.pnpm/node_modules/.bin/tsx fixtures/atomistique-l1/community_flow_check.mjs
```
✅ **Expected**: the community bundle is **discovered** alongside the (still **immutable**) course, loaded, and a classmate answering `2` is graded **correct** by the existing `quizGrader` — **never seeing the author**.

### Where your feedback matters most
- Is the `/studio` form guided enough for an L1 student? Are the validation messages clear?
- Does the **self-test** genuinely help improve the quiz before sending?
- Does the **moderation queue** give enough context to decide (answer key + badge)?
- Does the **peer loop** (test + rate a classmate's quiz) make pedagogical sense?
- Is a scene type missing (beyond quiz) for what you want your students to do?

### Guarantees (already checked by adversarial review)
- The learner can **only** submit; **only** the teacher's approval publishes (**rule 003**).
- The self-test is **key-free**. The original course is **immutable**. The author is **never** exposed to peers. Peer signals are **k-anonymous**.
