#!/usr/bin/env python3
"""Author the atomistique-L1 lesson bundle (LessonBundle v1.4), grounded in the
local extraction of cours-L1SV-atomistique.pdf (Chapter 1).

HYBRID authoring: the PDF was extracted locally (generate_assets.py is fully
offline; the structure skeleton is in _extract/). This script assembles the
bundle from that skeleton + author knowledge, attaching the generated scientific
assets as per-scene `render_assets`, and builds a typed Learning Workflow Graph.

Validated against the Python LessonBundle mirror here; the TS LessonBundleSchema
(which also validates render_assets + the LWG) is checked by validate_bundle.mjs.

Run: .venv/bin/python build_bundle.py   (after generate_assets.py)
"""
from __future__ import annotations
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "services", "scene-synth"))


def _read(rel: str) -> str:
    with open(os.path.join(HERE, rel), encoding="utf-8") as f:
        return f.read()


# ── render-asset helpers ──────────────────────────────────────────────────────

def orbital(path: str, title: str, iso: float = 0.18) -> dict:
    return {"kind": "orbital", "title": title, "path": path, "format": "cube",
            "provenance": "analytic hydrogenic wavefunction (generate_assets.py)",
            "meta": {"iso": iso, "signed": True}}


def spectrum(rel: str, title: str) -> dict:
    return {"kind": "spectrum", "title": title, "payload": _read(rel), "format": "vega-lite",
            "provenance": "Rydberg formula (generate_assets.py)"}


def plot(rel: str, title: str) -> dict:
    return {"kind": "plot_spec", "title": title, "payload": _read(rel), "format": "vega-lite",
            "provenance": "CRC / Clementi reference values (generate_assets.py)"}


def mol(rel: str, title: str) -> dict:
    return {"kind": "mol_3d", "title": title, "payload": _read(rel), "format": "xyz",
            "provenance": "idealized VSEPR geometry (generate_assets.py)"}


def eq(latex: str, title: str) -> dict:
    return {"kind": "equation_latex", "title": title, "payload": latex}


# ── concepts (LWG concept nodes too) ──────────────────────────────────────────

CONCEPTS = [
    ("c-particules", "Particules de l'atome", "Protons, neutrons, électrons ; Z, A, isotopes.", "understand"),
    ("c-nombres-quantiques", "Nombres quantiques", "n, ℓ, mℓ, ms et leurs valeurs autorisées.", "understand"),
    ("c-orbitales-formes", "Forme des orbitales atomiques", "Orbitales s, p, d : forme, nœuds, nomenclature.", "understand"),
    ("c-spectres", "Quantification et spectres", "Niveaux quantifiés, E=hν, raies d'émission (série de Balmer).", "apply"),
    ("c-remplissage", "Règles de remplissage", "Klechkowski (n+ℓ), principe de Pauli, règle de Hund.", "apply"),
    ("c-configuration", "Configuration électronique", "Configuration, séparation cœur / valence.", "apply"),
    ("c-periodicite", "Périodicité des propriétés", "Énergie d'ionisation et rayon atomique le long d'une période.", "analyze"),
    ("c-geometrie", "Géométrie des molécules", "VSEPR, hybridation, géométrie 3D (CH4, H2O).", "analyze"),
]


def concept_refs(*ids: str) -> list[str]:
    return list(ids)


# ── scenes ────────────────────────────────────────────────────────────────────

def build_scenes() -> list[dict]:
    S: list[dict] = []

    S.append({
        "id": "s0-intro", "type": "intro", "title": "Chapitre 1 — Atomes et orbitales",
        "objective_refs": [], "concept_refs": [], "estimated_seconds": 60, "adaptation_hooks": [],
        "markdown": "# Atomistique L1 — Chapitre 1\nDe la structure de l'atome aux **orbitales atomiques**, "
                    "à la **configuration électronique**, puis à la **périodicité** des propriétés et à la "
                    "**géométrie** des molécules. Chaque notion s'appuie sur des objets que tu peux manipuler : "
                    "une orbitale 3D que l'on fait tourner, un spectre d'émission, une molécule.",
    })

    S.append({
        "id": "s1-concept-particules", "type": "concept", "title": "Particules constitutives de l'atome",
        "objective_refs": [], "concept_refs": concept_refs("c-particules"),
        "estimated_seconds": 180, "adaptation_hooks": [],
        "markdown": "## Particules et identité de l'atome\n\nUn atome = **noyau** (protons + neutrons) + **nuage "
                    "électronique**.\n\n- **Z** (numéro atomique) = nombre de protons → définit l'élément.\n"
                    "- **A** (nombre de masse) = Z + N (N = neutrons).\n- **Isotopes** : même Z, A différent.\n\n"
                    "Le noyau (~10⁻¹⁵ m) est 10⁵ fois plus petit que l'atome (~10⁻¹⁰ m).",
        "render_assets": [eq("A = Z + N", "Nombre de masse")],
    })

    S.append({
        "id": "s1-quiz-fer", "type": "quiz", "title": "Quiz : l'atome de fer (Z=26)",
        "objective_refs": [], "concept_refs": concept_refs("c-particules"),
        "estimated_seconds": 60, "adaptation_hooks": ["rule_2err_replay_concept"],
        "question": "L'isotope ⁵⁶Fe a Z=26. Combien contient-il de neutrons ?",
        "choices": [
            {"id": "a", "text": "26", "correct": False},
            {"id": "b", "text": "30", "correct": True},
            {"id": "c", "text": "56", "correct": False},
            {"id": "d", "text": "82", "correct": False},
        ],
        "feedback_correct": "Exact : N = A − Z = 56 − 26 = 30.",
        "feedback_incorrect": "N = A − Z. Ici 56 − 26 = 30 neutrons.",
        "hints": ["A = Z + N, donc N = A − Z."],
    })

    S.append({
        "id": "s2-concept-nombres-quantiques", "type": "concept", "title": "Les nombres quantiques",
        "objective_refs": [], "concept_refs": concept_refs("c-nombres-quantiques"),
        "estimated_seconds": 210, "adaptation_hooks": [],
        "markdown": "## Quatre nombres quantiques\n\nUn électron est décrit par :\n\n- **n** (principal) : 1, 2, 3, … "
                    "→ la couche.\n- **ℓ** (azimutal) : 0 … n−1 → la sous-couche (0=s, 1=p, 2=d, 3=f).\n- **mℓ** "
                    "(magnétique) : −ℓ … +ℓ → l'orbitale dans la sous-couche.\n- **ms** (spin) : −½ ou +½.\n\n"
                    "Une sous-couche ℓ contient (2ℓ+1) orbitales, soit 2(2ℓ+1) électrons.",
        "render_assets": [eq(r"\ell \in \{0,1,\dots,n-1\}\quad m_\ell \in \{-\ell,\dots,+\ell\}\quad m_s = \pm\tfrac{1}{2}",
                             "Valeurs autorisées")],
    })

    S.append({
        "id": "s2-quiz-4f", "type": "quiz", "title": "Quiz : la sous-couche 4f",
        "objective_refs": [], "concept_refs": concept_refs("c-nombres-quantiques"),
        "estimated_seconds": 75, "adaptation_hooks": ["rule_2err_replay_concept"],
        "question": "Combien d'orbitales (valeurs de mℓ) la sous-couche 4f (n=4, ℓ=3) compte-t-elle ?",
        "choices": [
            {"id": "a", "text": "3", "correct": False},
            {"id": "b", "text": "5", "correct": False},
            {"id": "c", "text": "7", "correct": True},
            {"id": "d", "text": "14", "correct": False},
        ],
        "feedback_correct": "Exact : mℓ va de −3 à +3, soit 2ℓ+1 = 7 orbitales (donc 14 électrons).",
        "feedback_incorrect": "mℓ ∈ {−ℓ … +ℓ}. Pour ℓ=3 : −3,−2,−1,0,1,2,3 → 7 orbitales.",
        "hints": ["Nombre d'orbitales = 2ℓ+1.", "ℓ vaut 3 pour une sous-couche f."],
    })

    S.append({
        "id": "s3-concept-orbitales", "type": "concept", "title": "Forme des orbitales atomiques",
        "objective_refs": [], "concept_refs": concept_refs("c-orbitales-formes"),
        "estimated_seconds": 240, "adaptation_hooks": [],
        "markdown": "## Forme des orbitales — fais-les tourner\n\nUne orbitale est la région où la probabilité de "
                    "présence de l'électron est élevée. La **2p** a deux lobes de **signe opposé** séparés par un "
                    "plan nodal ; la **3d_z²** a un lobe axial et une couronne équatoriale.\n\nFais tourner les "
                    "orbitales ci-contre : les deux isosurfaces (+ / −) sont les deux signes de la fonction d'onde.",
        "render_assets": [
            orbital("assets/orbitals/2pz.cube", "Orbitale 2p_z"),
            orbital("assets/orbitals/3dz2.cube", "Orbitale 3d_z²"),
        ],
    })

    S.append({
        "id": "s3-quiz-noeuds", "type": "quiz", "title": "Quiz : nœuds de la 2p",
        "objective_refs": [], "concept_refs": concept_refs("c-orbitales-formes"),
        "estimated_seconds": 60, "adaptation_hooks": ["rule_2err_replay_concept", "rule_mastery_high_skip"],
        "question": "Combien de nœuds RADIAUX possède une orbitale 2p ?",
        "choices": [
            {"id": "a", "text": "0", "correct": True},
            {"id": "b", "text": "1", "correct": False},
            {"id": "c", "text": "2", "correct": False},
        ],
        "feedback_correct": "Exact : nœuds radiaux = n − ℓ − 1 = 2 − 1 − 1 = 0 (le plan nodal de la 2p est angulaire).",
        "feedback_incorrect": "Nœuds radiaux = n − ℓ − 1. Pour la 2p : 2 − 1 − 1 = 0.",
        "hints": ["Distingue nœud radial (sphère) et nœud angulaire (plan).", "n − ℓ − 1."],
    })

    # explain_back — teach-back on orbital shape. key_points.cues are ACCENT-FREE substrings (the offline
    # matcher is literal: "probab" ⊂ "probabilité", "fonction" ⊂ "fonction d'onde") so a real French answer
    # scores without an API key; the live evaluator does the nuanced grading when available.
    S.append({
        "id": "s3b-explain-2p", "type": "explain_back", "title": "Explique — pourquoi la 2p a deux lobes",
        "objective_refs": [], "concept_refs": concept_refs("c-orbitales-formes"),
        "estimated_seconds": 180, "adaptation_hooks": [],
        "prompt": "Tu viens de faire tourner l'orbitale **2p** en 3D : deux lobes de signe opposé séparés par "
                  "un plan. **Explique, avec tes propres mots, pourquoi la 2p a deux lobes et ce que représente "
                  "le plan qui les sépare** (pense à la fonction d'onde et à la probabilité de présence).",
        # cues are MULTI-TOKEN so a keyword-stuffed wrong answer can't trivially score; the matcher folds
        # accents/apostrophes (normalize()), so a real French answer ("fonction d'onde", "signes opposés",
        # "probabilité de présence") matches these accent-free forms via the token-AND fallback.
        "key_points": [
            {"id": "kp-fonction", "text": "La forme découle de la fonction d'onde de l'électron", "cues": ["fonction d onde"]},
            {"id": "kp-signe", "text": "Les deux lobes ont des signes opposés", "cues": ["signe oppose"]},
            {"id": "kp-nodal", "text": "Le plan séparateur est un plan nodal", "cues": ["plan nodal"]},
            {"id": "kp-probab", "text": "Les lobes sont les régions de forte probabilité de présence", "cues": ["probabilite presence"]},
        ],
        "model_explanation": "La 2p est décrite par une **fonction d'onde** qui change de **signe** d'un lobe à "
                             "l'autre. Le plan qui les sépare est un **plan nodal** : la fonction d'onde y est nulle, "
                             "donc la **probabilité** de présence de l'électron y est nulle. Les deux lobes (signes + et −) "
                             "sont les régions où cette probabilité est élevée.",
        "rubric": {"completeness": 0.6, "evidence_quality": 0.2, "tone": 0.2},
    })

    S.append({
        "id": "s4-concept-spectres", "type": "concept", "title": "Quantification et spectres d'émission",
        "objective_refs": [], "concept_refs": concept_refs("c-spectres"),
        "estimated_seconds": 240, "adaptation_hooks": [],
        "markdown": "## Reconnaître un gaz à ses raies\n\nLes niveaux d'énergie sont **quantifiés**. Une transition "
                    "de n₂ vers n₁ émet un photon d'énergie E = hν. Pour l'hydrogène, les transitions vers n=2 "
                    "donnent la **série de Balmer**, dans le visible — la signature qui permet de *reconnaître un "
                    "gaz inconnu*.",
        "render_assets": [
            eq(r"E_{photon} = h\nu = \left| E_{n_2} - E_{n_1} \right|", "Énergie d'un photon émis"),
            spectrum("assets/spectra/H_balmer.spectrum.json", "Série de Balmer de l'hydrogène"),
        ],
    })

    S.append({
        "id": "s4-quiz-balmer", "type": "quiz", "title": "Quiz : la raie Hα",
        "objective_refs": [], "concept_refs": concept_refs("c-spectres"),
        "estimated_seconds": 60, "adaptation_hooks": ["rule_2err_replay_concept"],
        "question": "À quelle transition correspond la raie Hα (rouge, ~656 nm) ?",
        "choices": [
            {"id": "a", "text": "n = 3 → n = 2", "correct": True},
            {"id": "b", "text": "n = 2 → n = 1", "correct": False},
            {"id": "c", "text": "n = 4 → n = 2", "correct": False},
            {"id": "d", "text": "n = 1 → n = 3", "correct": False},
        ],
        "feedback_correct": "Exact : Hα = première raie de Balmer, n=3 → n=2.",
        "feedback_incorrect": "Balmer = transitions vers n=2. La plus proche (n=3→2) est Hα, la plus rouge.",
        "hints": ["La série de Balmer arrive sur n=2.", "Hα est la transition la plus basse en énergie de la série."],
    })

    S.append({
        "id": "s5-concept-remplissage", "type": "concept", "title": "Règles de remplissage",
        "objective_refs": [], "concept_refs": concept_refs("c-remplissage"),
        "estimated_seconds": 210, "adaptation_hooks": [],
        "markdown": "## Remplir les orbitales\n\n- **Klechkowski** : énergie croissante de (n+ℓ), puis n croissant à "
                    "(n+ℓ) égal → 1s, 2s, 2p, 3s, 3p, **4s, 3d**, 4p, …\n- **Pauli** : 2 électrons max par orbitale "
                    "(spins opposés).\n- **Hund** : on remplit d'abord à spins parallèles dans une sous-couche "
                    "dégénérée.",
        "render_assets": [eq(r"\text{ordre} : (n+\ell)\ \nearrow,\ \text{puis } n\ \nearrow", "Règle de Klechkowski")],
    })

    S.append({
        "id": "s5-quiz-carbone", "type": "quiz", "title": "Quiz : configuration du carbone",
        "objective_refs": [], "concept_refs": concept_refs("c-remplissage", "c-configuration"),
        "estimated_seconds": 60, "adaptation_hooks": ["rule_2err_replay_concept"],
        "question": "Quelle est la configuration électronique du carbone (Z=6) ?",
        "choices": [
            {"id": "a", "text": "1s² 2s² 2p²", "correct": True},
            {"id": "b", "text": "1s² 2s⁴", "correct": False},
            {"id": "c", "text": "1s² 2p⁴", "correct": False},
            {"id": "d", "text": "1s⁴ 2s²", "correct": False},
        ],
        "feedback_correct": "Exact : 2 + 2 + 2 = 6 électrons (Z=6).",
        "feedback_incorrect": "Klechkowski : 1s → 2s → 2p. Avec 6 e⁻ : 1s² 2s² 2p².",
        "hints": ["Ordre 1s, 2s, 2p.", "2 électrons max par orbitale (Pauli)."],
    })

    # spot_the_flaw — Risso's "cours biaisé": a deliberately-WRONG statement about nitrogen. claims hold the
    # answer key (flaws_expected = accent-free markers a correct answer contains: "hund", "spin", "2p3");
    # flawed_content is shown, model_correction is the "cours amélioré" (revealed/graded-against, never leaked).
    S.append({
        "id": "s5b-spot-azote", "type": "spot_the_flaw", "title": "Repère l'erreur — configuration de l'azote",
        "objective_refs": [], "concept_refs": concept_refs("c-remplissage"),
        "estimated_seconds": 150, "adaptation_hooks": [],
        "flawed_content": "L'azote (Z=7) a pour configuration électronique **1s² 2s² 2p⁴**. Dans la sous-couche 2p, "
                          "les électrons s'**apparient** deux par deux dans la même orbitale pour minimiser leur "
                          "énergie, si bien que l'azote ne possède **aucun électron célibataire**.",
        # flaws_expected are DISCRIMINATING markers a learner only writes if they understand (the rule
        # name "hund", the unpaired electrons "célibataires", the correct config "2p3" — accents/superscripts
        # are folded by normalize(), so "2p³" and "célibataires" match these forms).
        "claims": [
            {"id": "f-hund", "text": "Les électrons 2p s'apparient au lieu d'occuper des orbitales séparées (viole Hund)",
             "flaws_expected": ["hund", "celibataires"]},
            {"id": "f-count", "text": "Le décompte des électrons est faux (2+2+4 = 8 ≠ 7)",
             "flaws_expected": ["2p3"]},
        ],
        "model_correction": "La configuration correcte est **1s² 2s² 2p³** (7 électrons au total). Règle de **Hund** : "
                            "les **trois** électrons 2p occupent chacun une orbitale différente avec des **spins "
                            "parallèles** → l'azote a **3 électrons célibataires**, et non 0. (La version fausse donnait "
                            "aussi 8 électrons au lieu de 7.)",
        "rubric": {"completeness": 0.6, "evidence_quality": 0.3, "tone": 0.1},
    })

    S.append({
        "id": "s6-concept-periodicite", "type": "concept", "title": "Périodicité : ionisation et rayon",
        "objective_refs": [], "concept_refs": concept_refs("c-periodicite"),
        "estimated_seconds": 240, "adaptation_hooks": [],
        "markdown": "## Tendances le long d'une période\n\nDe gauche à droite (période 2, Li→Ne), la charge nucléaire "
                    "augmente à couche constante : les électrons sont plus attirés.\n\n- **Énergie de première "
                    "ionisation** : globalement ↑.\n- **Rayon atomique** : ↓.\n\nLes deux courbes ci-contre rendent "
                    "la tendance visible (et ses irrégularités, ex. B et O).",
        "render_assets": [
            plot("assets/plots/ionisation_periode2.plot.json", "E. de 1ʳᵉ ionisation (période 2)"),
            plot("assets/plots/rayon_periode2.plot.json", "Rayon atomique (période 2)"),
        ],
    })

    S.append({
        "id": "s6-quiz-tendance", "type": "quiz", "title": "Quiz : sens des tendances",
        "objective_refs": [], "concept_refs": concept_refs("c-periodicite"),
        "estimated_seconds": 60, "adaptation_hooks": ["rule_2err_replay_concept"],
        "question": "Le long d'une période (→), comment varient énergie d'ionisation et rayon atomique ?",
        "choices": [
            {"id": "a", "text": "Ionisation ↑, rayon ↓", "correct": True},
            {"id": "b", "text": "Ionisation ↓, rayon ↑", "correct": False},
            {"id": "c", "text": "Les deux ↑", "correct": False},
            {"id": "d", "text": "Les deux ↓", "correct": False},
        ],
        "feedback_correct": "Exact : charge nucléaire ↑ à couche constante → électrons plus liés (ionisation ↑, rayon ↓).",
        "feedback_incorrect": "À couche constante, Z↑ attire plus les électrons : ionisation ↑ et rayon ↓.",
        "hints": ["Que fait la charge nucléaire effective le long d'une période ?"],
    })

    S.append({
        "id": "s7-concept-geometrie", "type": "concept", "title": "Géométrie : VSEPR et hybridation",
        "objective_refs": [], "concept_refs": concept_refs("c-geometrie"),
        "estimated_seconds": 240, "adaptation_hooks": [],
        "markdown": "## Représenter une molécule dans l'espace\n\nLa théorie **VSEPR** prédit la géométrie à partir "
                    "des doublets autour de l'atome central :\n\n- **CH₄** : 4 doublets liants → **tétraédrique**, "
                    "109,5° (hybridation sp³).\n- **H₂O** : 2 liants + 2 non liants → **coudée**, 104,5°.\n\n"
                    "Fais tourner les deux molécules ci-contre pour comparer les géométries.",
        "render_assets": [
            mol("assets/molecules/CH4.xyz", "Méthane CH₄ (tétraédrique)"),
            mol("assets/molecules/H2O.xyz", "Eau H₂O (coudée)"),
        ],
    })

    S.append({
        "id": "s7-meta", "type": "meta_checkpoint", "title": "Auto-évaluation — chapitre 1",
        "objective_refs": [], "concept_refs": concept_refs("c-geometrie", "c-periodicite"),
        "estimated_seconds": 60, "adaptation_hooks": [],
        "pre_question": "Avant ce chapitre, à quel point te sentais-tu à l'aise pour relier orbitales, configuration et propriétés ?",
        "post_question": "Et maintenant ?",
        "scale_labels": ["Pas du tout", "Un peu", "Moyennement", "Bien", "Très à l'aise"],
    })

    S.append({
        "id": "s8-reproduction-periodique", "type": "reproduction",
        "title": "Reproduction : placer les éléments dans le tableau périodique",
        "objective_refs": [], "concept_refs": concept_refs("c-configuration", "c-periodicite"),
        "estimated_seconds": 420, "adaptation_hooks": [],
        "task_card_id": "task-atom-l1-periodic",
        "steps": [
            {"step_id": "na", "instruction": "Sodium (Z=11) : 1s² 2s² 2p⁶ 3s¹ → période et groupe ?",
             "expected_input_schema": {"type": "object",
                                       "properties": {"periode": {"type": "integer"}, "groupe": {"type": "integer"}},
                                       "required": ["periode", "groupe"]},
             "expected_output": {"periode": 3, "groupe": 1}},
            {"step_id": "s", "instruction": "Soufre (Z=16) : 1s² 2s² 2p⁶ 3s² 3p⁴ → période et groupe ?",
             "expected_input_schema": {"type": "object",
                                       "properties": {"periode": {"type": "integer"}, "groupe": {"type": "integer"}},
                                       "required": ["periode", "groupe"]},
             "expected_output": {"periode": 3, "groupe": 16}},
            {"step_id": "ca", "instruction": "Calcium (Z=20) : 1s² 2s² 2p⁶ 3s² 3p⁶ 4s² → période et groupe ?",
             "expected_input_schema": {"type": "object",
                                       "properties": {"periode": {"type": "integer"}, "groupe": {"type": "integer"}},
                                       "required": ["periode", "groupe"]},
             "expected_output": {"periode": 4, "groupe": 2}},
        ],
    })

    return S


# ── adaptation rules (same engine semantics as the m6 demo) ───────────────────

RULES = [
    {"id": "rule_2err_replay_concept", "when": {"consecutive_errors_same_concept": ">=2"},
     "action": {"kind": "replay_current_scene", "reason": "errors_threshold"}, "modulator": "M1",
     "explanation_short": "Deux erreurs sur ce concept : on le revoit avec un appui."},
    {"id": "rule_mastery_high_skip", "when": {"mastery_c": ">=0.8", "total_attempts": ">=3"},
     "action": {"kind": "skip_to_next_concept"}, "modulator": "M1",
     "explanation_short": "Concept maîtrisé : on passe au suivant."},
]


# ── Learning Workflow Graph (typed; consumed by typed-graph-lens) ─────────────

def build_lwg() -> dict:
    nodes = []
    for cid, title, _desc, bloom in CONCEPTS:
        nodes.append({"id": f"concept:{cid}", "node_kind": "concept", "title": title, "bloom_level": bloom})
    task_assess = {
        "s1-quiz-fer": ("c-particules", "quiz"),
        "s2-quiz-4f": ("c-nombres-quantiques", "quiz"),
        "s3-quiz-noeuds": ("c-orbitales-formes", "quiz"),
        "s3b-explain-2p": ("c-orbitales-formes", "explain_back"),
        "s4-quiz-balmer": ("c-spectres", "quiz"),
        "s5-quiz-carbone": ("c-configuration", "quiz"),
        "s5b-spot-azote": ("c-remplissage", "spot_the_flaw"),
        "s6-quiz-tendance": ("c-periodicite", "quiz"),
        "s8-reproduction-periodique": ("c-periodicite", "reproduction"),
    }
    for tid, (_c, stype) in task_assess.items():
        nodes.append({"id": f"task:{tid}", "node_kind": "task", "title": tid, "scene_type": stype})

    # (prereq, dependent) pairs — "learn `prereq` before `dependent`". The graph-router convention is
    # prerequisite_for: source = the DEPENDENT concept, target = its PREREQUISITE — so we emit
    # source=dependent, target=prereq (NOT the reading order).
    prereqs = [
        ("c-particules", "c-nombres-quantiques"),
        ("c-nombres-quantiques", "c-orbitales-formes"),
        ("c-nombres-quantiques", "c-spectres"),
        ("c-nombres-quantiques", "c-remplissage"),
        ("c-orbitales-formes", "c-remplissage"),
        ("c-remplissage", "c-configuration"),
        ("c-configuration", "c-periodicite"),
        ("c-spectres", "c-periodicite"),
        ("c-configuration", "c-geometrie"),
    ]
    edges = []
    for i, (prereq, dependent) in enumerate(prereqs):
        edges.append({"id": f"e-prereq-{i}", "relation": "prerequisite_for",
                      "source": f"concept:{dependent}", "target": f"concept:{prereq}", "confidence": 0.9})
    for i, (tid, (cid, _s)) in enumerate(task_assess.items()):
        edges.append({"id": f"e-assess-{i}", "relation": "assesses",
                      "source": f"task:{tid}", "target": f"concept:{cid}"})
    return {"schema_version": "1.0", "course_id": "atomistique-l1", "nodes": nodes, "edges": edges}


# ── assemble + validate ───────────────────────────────────────────────────────

def main():
    bundle = {
        "schema_version": "1.4",
        "bundle_id": "atomistique-l1-chap1",
        "source_plan_id": "plan-atomistique-l1",
        "metadata": {
            "title": "Atomistique L1 — Chapitre 1 (atomes, orbitales, périodicité)",
            "target": "L1", "duration_minutes": 60, "language": "fr",
            "discipline": "chimie atomistique",
        },
        "concepts": [{"id": c, "title": t, "description": d, "bloom_level_target": b}
                     for (c, t, d, b) in CONCEPTS],
        "scenes": build_scenes(),
        "rules": RULES,
        "learning_workflow_graph": build_lwg(),
        "validated_by": "louisfelix.nothias@univ-cotedazur.fr",
        "validated_at": "2026-06-20T00:00:00Z",
    }

    from scene_synth_schemas import LessonBundle  # Python mirror (scenes + render_assets)
    obj = LessonBundle.model_validate(bundle)
    n_assets = sum(len(s.get("render_assets") or []) for s in bundle["scenes"])

    out = os.path.join(HERE, "lesson.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, indent=2)

    print(f"OK  {obj.bundle_id}  schema={obj.schema_version}")
    print(f"    concepts={len(bundle['concepts'])}  scenes={len(bundle['scenes'])}  render_assets={n_assets}")
    lwg = bundle["learning_workflow_graph"]
    print(f"    LWG nodes={len(lwg['nodes'])}  edges={len(lwg['edges'])}")
    print(f"    → {out}")


if __name__ == "__main__":
    main()
