"""Gated: only runs when the real `indicium` package is importable (sibling repo
pip-installed). Confirms our emitted Insight shape round-trips through
indicium.astra_bridge. Skipped offline — never a hard dependency."""
import pytest

indicium_bridge = pytest.importorskip("indicium.astra_bridge")

from agentic.decision import make_insight, make_evidence


def test_emitted_insight_converts_to_indicium_claim():
    insight = make_insight(
        insight_id="e1",
        claim="FFT requires Fourier basics",
        created_at="2026-06-10T00:00:00+00:00",
        evidence=[make_evidence(doi="10.48550/arXiv.1706.03762", confidence=0.9)],
    )
    claim = indicium_bridge.insight_to_claim(insight, analysis_id="course-analysis")
    assert getattr(claim, "astra_insight_ref", None) == "course-analysis/e1"
