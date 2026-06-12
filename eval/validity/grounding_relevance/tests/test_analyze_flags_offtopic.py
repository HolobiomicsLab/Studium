"""test_analyze_flags_offtopic.py — a concept scene cited with an off-topic paper
must be flagged irrelevant and the bundle verdict must be 'presence_only'.

This is the exact gap the tool closes: the auditor scores grounding_citations by
PRESENCE (a ref is attached -> 1.0), so the mock metabolomics paper bolted onto a
Peroxisomes lesson passes. Lexical relevance catches it.
"""

from eval.validity.grounding_relevance.analyze import analyze_bundle
from eval.validity.grounding_relevance.tests._synth import (
    make_bundle,
    make_ref,
    make_scene,
)


def _offtopic_bundle():
    scene = make_scene(
        "s-concept-peroxisomes",
        "concept",
        "Peroxisomes",
        "Peroxisomes are organelles that break down very long chain fatty acids "
        "and detoxify reactive oxygen species inside eukaryotic cells.",
        refs=[
            make_ref(
                "Untargeted metabolomics of gut microbiota",
                excerpt="metabolite profiling links intestinal bacteria to host energy metabolism",
                doi="10.1073/pnas.1319030111",
                relevance_score=0.8,  # the bundle CLAIMS high relevance — it lies
            )
        ],
    )
    return make_bundle([scene])


def test_offtopic_scene_is_flagged_irrelevant():
    card = analyze_bundle(_offtopic_bundle())
    assert card["n_evidenced_scenes"] == 1
    flagged_ids = {f["scene_id"] for f in card["irrelevant_scenes"]}
    assert "s-concept-peroxisomes" in flagged_ids


def test_offtopic_bundle_verdict_is_presence_only():
    card = analyze_bundle(_offtopic_bundle())
    assert card["relevance_grade"] == 0.0
    assert card["verdict"] == "presence_only"


def test_offtopic_mean_best_relevance_below_threshold():
    card = analyze_bundle(_offtopic_bundle())
    assert card["mean_best_relevance"] < 0.06
