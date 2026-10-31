from __future__ import annotations

import pytest

from perspicacite_mcp.client import _normalize
from perspicacite_mcp.passages import PassageEnvelopeError, normalize_passage_envelope


LIVE_ENVELOPE = {
    "success": True,
    "passages": [
        {
            "text": "The intervention reduced the measured response by 31%.",
            "source_doi": "10.1000/example",
            "source_url": "https://example.test/paper",
            "license_id": "CC-BY-4.0",
            "score": 0.87,
            "kb_name": "course-kb",
        }
    ],
    "attempts": [{"query": "measured response"}],
    "refined_query": "intervention measured response",
}


def test_normalizes_live_flat_passage_without_losing_provenance():
    normalized = normalize_passage_envelope(LIVE_ENVELOPE)

    assert normalized["status"] == "ok"
    assert normalized["attempts"] == LIVE_ENVELOPE["attempts"]
    passage = normalized["passages"][0]
    assert passage["text"].startswith("The intervention")
    assert passage["doi"] == "10.1000/example"
    assert passage["url"] == "https://example.test/paper"
    assert passage["license_id"] == "CC-BY-4.0"
    assert passage["kb_name"] == "course-kb"
    assert len(passage["sha256"]) == 64


def test_client_keeps_legacy_return_shape_for_live_flat_passage():
    result = _normalize(LIVE_ENVELOPE)

    assert result["status"] == "ok"
    assert result["docs"] == [
        {
            "id": "10.1000/example",
            "doi": "10.1000/example",
            "title": "(untitled)",
            "authors": [],
            "year": None,
            "excerpt": "The intervention reduced the measured response by 31%.",
            "relevance_score": 0.87,
        }
    ]


def test_legacy_nested_passages_remain_supported():
    result = _normalize(
        {
            "success": True,
            "results": [
                {
                    "chunk_id": "chunk-1",
                    "chunk_text": "Legacy passage text.",
                    "score": 0.5,
                    "source": {
                        "doi": "10.1000/legacy",
                        "title": "Legacy paper",
                        "authors": ["A. Author"],
                        "year": 2024,
                    },
                }
            ],
        }
    )

    assert result["status"] == "ok"
    assert result["docs"][0]["id"] == "chunk-1"
    assert result["docs"][0]["excerpt"] == "Legacy passage text."


def test_captured_content_preserves_origin_and_null_relevance():
    normalized = normalize_passage_envelope(
        {
            "success": True,
            "origin": {"tool": "perspicacite.get_paper_content", "selector": "paragraph 2"},
            "passages": [
                {
                    "text": "An exact selected excerpt.",
                    "source_doi": "10.1000/content",
                    "title": "Paper title",
                    "score": None,
                    "kb_name": None,
                }
            ],
        }
    )

    assert normalized["origin"]["tool"] == "perspicacite.get_paper_content"
    assert normalized["passages"][0]["title"] == "Paper title"
    assert normalized["passages"][0]["score"] is None


@pytest.mark.parametrize(
    "payload",
    [
        {"success": True, "passages": "not-a-list"},
        {"success": True, "passages": [{}]},
        {"success": True},
    ],
)
def test_successful_but_malformed_envelopes_fail_closed(payload):
    with pytest.raises(PassageEnvelopeError):
        normalize_passage_envelope(payload)

    assert _normalize(payload) == {"status": "offline", "docs": []}
