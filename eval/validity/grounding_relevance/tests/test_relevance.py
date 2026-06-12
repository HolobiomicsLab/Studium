"""test_relevance.py — unit tests for the lexical relevance primitives."""

from eval.validity.grounding_relevance.relevance import (
    jaccard,
    ref_relevance,
    ref_text,
    scene_relevance,
    scene_text,
    tokenize,
)
from eval.validity.grounding_relevance.tests._synth import make_ref, make_scene


# --- tokenize -------------------------------------------------------------

def test_tokenize_lowercases_and_splits_on_nonalnum():
    assert tokenize("Hello, World! Foo-bar") == {"hello", "world", "foo", "bar"}


def test_tokenize_drops_short_tokens():
    # tokens shorter than 3 chars are dropped
    toks = tokenize("a an to go cat")
    assert "go" not in toks  # 2 chars
    assert "a" not in toks
    assert "cat" in toks


def test_tokenize_drops_stopwords():
    toks = tokenize("the cell and the membrane with for that")
    assert "the" not in toks
    assert "and" not in toks
    assert "with" not in toks
    assert "that" not in toks
    assert "cell" in toks
    assert "membrane" in toks


def test_tokenize_empty_or_none():
    assert tokenize("") == set()
    assert tokenize(None) == set()


# --- jaccard --------------------------------------------------------------

def test_jaccard_identical_sets_is_one():
    assert jaccard({"a", "b", "c"}, {"a", "b", "c"}) == 1.0


def test_jaccard_disjoint_sets_is_zero():
    assert jaccard({"a", "b"}, {"c", "d"}) == 0.0


def test_jaccard_partial_overlap():
    # |{b}| / |{a,b,c}| = 1/3
    assert jaccard({"a", "b"}, {"b", "c"}) == 1 / 3


def test_jaccard_both_empty_is_zero():
    assert jaccard(set(), set()) == 0.0


# --- scene_text / ref_text ------------------------------------------------

def test_scene_text_concats_title_and_markdown():
    scene = make_scene("s1", "concept", "Peroxisomes", "they handle reactive oxygen")
    txt = scene_text(scene)
    assert "Peroxisomes" in txt
    assert "reactive oxygen" in txt


def test_scene_text_handles_missing_fields():
    assert scene_text({}) == " " or scene_text({}).strip() == ""


def test_ref_text_concats_title_and_excerpt():
    ref = make_ref("Peroxisome biology", excerpt="oxidative metabolism in cells")
    txt = ref_text(ref)
    assert "Peroxisome biology" in txt
    assert "oxidative metabolism" in txt


# --- ref_relevance --------------------------------------------------------

def test_ref_relevance_high_when_topical_overlap():
    scene = make_scene(
        "s1", "concept", "Peroxisomes",
        "Peroxisomes are organelles that break down fatty acids and reactive oxygen species",
    )
    ref = make_ref(
        "Peroxisome biology and function",
        excerpt="organelles involved in fatty acid oxidation and reactive oxygen handling",
    )
    assert ref_relevance(scene, ref) > 0.15


def test_ref_relevance_near_zero_when_disjoint():
    scene = make_scene(
        "s1", "concept", "Peroxisomes",
        "Peroxisomes are organelles that break down fatty acids",
    )
    ref = make_ref(
        "Untargeted metabolomics of gut microbiota",
        excerpt="metabolite profiling links intestinal bacteria to host energy",
    )
    assert ref_relevance(scene, ref) < 0.06


# --- scene_relevance ------------------------------------------------------

def test_scene_relevance_none_when_no_evidence():
    scene = make_scene("s1", "concept", "Peroxisomes", "body")  # no refs -> no evidence
    assert scene_relevance(scene) is None


def test_scene_relevance_reports_best_mean_per_ref():
    scene = make_scene(
        "s1", "concept", "Peroxisomes",
        "Peroxisomes break down fatty acids and reactive oxygen species",
        refs=[
            make_ref("Peroxisome biology", excerpt="fatty acid oxidation reactive oxygen", doi="10.0/on"),
            make_ref("Gut microbiota metabolomics", excerpt="intestinal bacteria metabolites", doi="10.0/off"),
        ],
    )
    out = scene_relevance(scene)
    assert out is not None
    assert "best" in out and "mean" in out and "per_ref" in out
    assert len(out["per_ref"]) == 2
    # best (on-topic) should exceed mean (dragged down by off-topic ref)
    assert out["best"] >= out["mean"]
    # per_ref carries the doi (or title) identifier
    ids = {pid for pid, _ in out["per_ref"]}
    assert "10.0/on" in ids and "10.0/off" in ids
