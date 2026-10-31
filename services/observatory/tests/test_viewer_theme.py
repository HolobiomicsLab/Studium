"""The native MySTRA viewer consumes the shared visual contract."""
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def test_native_mystra_inlines_theme_after_host_styles(client) -> None:
    page = client.get("/courses/course-a/mystra")
    theme = (ROOT / "ui" / "studium-theme.css").read_text(encoding="utf-8").rstrip()

    assert page.status_code == 200
    assert '<body class="studium-viewer" data-viewer="observatory">' in page.text
    assert f'<style id="studium-theme">\n{theme}\n</style>' in page.text
    assert page.text.index('id="observatory-host-styles"') < page.text.index('id="studium-theme"')


def test_native_mystra_tables_are_keyboard_accessible(client) -> None:
    page = client.get("/courses/course-a/mystra")

    assert page.status_code == 200
    assert 'class="table-scroll" tabindex="0" role="region"' in page.text
    assert 'aria-label="Recorded decisions table"' in page.text
    assert 'aria-label="Recorded findings table"' in page.text
    assert 'id="trace"' in page.text
    assert 'class="metric"' in page.text
