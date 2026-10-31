"""Shared report theme and bounded portable-renderer compatibility tests."""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest

from learner_report import ReportError, export_learner_report, verify_learner_report
from test_learner_report import journal, write_json


ROOT = Path(__file__).resolve().parents[1]
LEGACY_REPORT = ROOT / "tools" / "fixtures" / "learner-report-v1" / "host-journal"
THEME = ROOT / "ui" / "studium-theme.css"


def _rehash_html(report_dir: Path) -> None:
    """Update only the manifest hash after deliberate HTML tampering."""
    index_path = report_dir / "index.html"
    checks_path = report_dir / "checks.json"
    checks = json.loads(checks_path.read_text(encoding="utf-8"))
    checks["artifacts"]["index.html"] = hashlib.sha256(index_path.read_bytes()).hexdigest()
    checks_path.write_text(
        json.dumps(checks, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def test_historical_v1_report_still_verifies() -> None:
    """A real report exported before the theme change remains supported."""
    assert verify_learner_report(LEGACY_REPORT)["ok"] is True


def test_new_report_inlines_shared_theme_and_semantic_navigation(tmp_path: Path) -> None:
    """The portable viewer is themed, self-contained, and keyboard navigable."""
    output = tmp_path / "report"
    export_learner_report(
        None,
        output,
        journal_path=write_json(tmp_path / "journal.json", journal()),
    )
    page = (output / "index.html").read_text(encoding="utf-8")
    theme = THEME.read_text(encoding="utf-8").rstrip()

    assert f'<style id="studium-theme">\n{theme}\n</style>' in page
    assert '<body class="studium-viewer" data-viewer="report">' in page
    assert '<main id="main">' in page
    assert '<nav class="section-nav" aria-label="Report sections">' in page
    for anchor in ("overview", "context", "activity", "journal", "source"):
        assert f'id="{anchor}"' in page
        assert f'href="#{anchor}"' in page
    assert page.count('class="table-scroll" tabindex="0" role="region"') == 2
    assert 'aria-label="Activity events table"' in page
    assert 'aria-label="Host journal events table"' in page
    assert "<script" not in page.lower()
    assert verify_learner_report(output)["ok"] is True


@pytest.mark.parametrize("kind", ["legacy", "current"])
def test_rehashed_tampered_html_is_rejected(tmp_path: Path, kind: str) -> None:
    """Compatibility accepts two exact renderers, never arbitrary rehashed HTML."""
    if kind == "legacy":
        output = tmp_path / kind / "host-journal"
        shutil.copytree(LEGACY_REPORT, output)
    else:
        output = tmp_path / kind
        export_learner_report(
            None,
            output,
            journal_path=write_json(tmp_path / "journal.json", journal()),
        )
    index_path = output / "index.html"
    index_path.write_text(
        index_path.read_text(encoding="utf-8").replace(
            "Learner activity technical report",
            "Altered learner activity report",
            1,
        ),
        encoding="utf-8",
    )
    _rehash_html(output)

    with pytest.raises(ReportError, match="browser rendering is stale"):
        verify_learner_report(output)
