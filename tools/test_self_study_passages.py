from __future__ import annotations

import sys
from pathlib import Path

import httpx
import pytest

TOOLS = Path(__file__).resolve().parent
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

import self_study_passages  # noqa: E402
from self_study_passages import (  # noqa: E402
    FETCH_TIMEOUT_SECONDS,
    SELF_STUDY_PASSAGES_ORIGIN,
    FetchedReference,
    PassageCapture,
    PassageCaptureError,
    build_passage_envelope,
    chunk_text,
    html_text,
    read_reference_text,
)

# Saved 2026-10-30 from https://fr.wikisource.org/wiki/Les_R%C3%A8gles_de_la_m%C3%A9thode_sociologique/Chapitre_1
# (Durkheim, 1895, public domain; Wikisource page chrome CC BY-SA). Read as inert data, never fetched.
DURKHEIM_PAGE = TOOLS / "fixtures" / "self-study" / "durkheim-ch1.html"
DURKHEIM_NOTE_COUNT = 4
WIKIMEDIA_CHROME = (
    "Aller au contenu",
    "Récupérée de",
    "Catégorie",
    "Télécharger",
    "La bibliothèque libre",
    "◄",
    ".djvu",
    "Rechercher",
    "< Les Règles",
)
LONG_A = (
    "Social facts are ways of acting, thinking and feeling that exist outside the "
    "individual consciousness and are endowed with a power of coercion by which they "
    "impose themselves upon the individual, whether or not the individual consents to them."
)
LONG_B = (
    "The first and most fundamental rule is to consider social facts as things, which "
    "means that the sociologist must approach them from the outside, through their "
    "observable manifestations, and not through the ideas that people already hold of them."
)


def pdf_bytes(pages: list[list[str]]) -> bytes:
    fitz = pytest.importorskip("fitz")
    document = fitz.open()
    for paragraphs in pages:
        page = document.new_page()
        for index, paragraph in enumerate(paragraphs):
            top = 72 + index * 140
            page.insert_textbox(fitz.Rect(72, top, 540, top + 120), paragraph, fontsize=10)
    return document.tobytes()


def fake_fetch(media_type: str, body: bytes, encoding: str = "utf-8"):
    def fetch(url: str) -> FetchedReference:
        return FetchedReference(media_type=media_type, body=body, encoding=encoding)

    return fetch


def test_chunk_text_keeps_paragraph_order_and_collapses_whitespace():
    text = (
        "Alpha   one\ntwo three four five six.\n\n\n"
        "Beta paragraph with   enough words here.\f"
        "  Gamma page two paragraph long enough.  "
    )

    assert chunk_text(text, 10, 60).passages == [
        "Alpha one two three four five six.",
        "Beta paragraph with enough words here.",
        "Gamma page two paragraph long enough.",
    ]


def test_chunk_text_merges_short_consecutive_paragraphs_up_to_max_chars():
    text = "Heading\n\nShort line.\n\nA longer paragraph that stands alone fine.\n\nTail para of decent size."

    chunked = chunk_text(text, 30, 70)

    # The short tail fits neither forward (nothing follows) nor back (it would pass max-chars).
    assert chunked.passages == ["Heading\n\nShort line.\n\nA longer paragraph that stands alone fine."]
    assert chunked.dropped_short == 1


def test_chunk_text_drops_passages_shorter_than_min_chars():
    long_paragraph = "word " * 13 + "end."

    chunked = chunk_text(f"Tiny.\n\n{long_paragraph}", 40, 70)

    assert chunked.passages == [long_paragraph.strip()]
    assert chunked.dropped_short == 1


def test_chunk_text_cuts_long_paragraphs_at_sentence_ends():
    sentences = ["First sentence is here.", "Second one follows it!", "Third closes it?"]
    paragraph = " ".join(sentences)

    chunks = chunk_text(paragraph, 1, 50).passages

    assert chunks == ["First sentence is here. Second one follows it!", "Third closes it?"]
    assert " ".join(chunks) == paragraph


def test_chunk_text_cuts_an_overlong_sentence_at_spaces_then_characters():
    giant_word = "x" * 25
    sentence = f"alpha beta gamma delta {giant_word} omega"

    chunks = chunk_text(sentence, 1, 12).passages

    assert all(len(chunk) <= 12 for chunk in chunks)
    assert chunks == ["alpha beta", "gamma delta", "x" * 12, "x" * 12, "x", "omega"]


def test_chunk_text_appends_a_short_paragraph_to_the_passage_before_it():
    # A heading still joins the paragraph after it; a trailing note joins the one before it.
    text = "Heading\n\nBody paragraph that is long enough.\n\nShort note [1]."

    chunked = chunk_text(text, 20, 80)

    assert chunked.passages == ["Heading\n\nBody paragraph that is long enough.\n\nShort note [1]."]
    assert chunked.dropped_short == 0


def test_chunk_text_counts_the_short_paragraphs_it_still_drops():
    forty = "A paragraph of exactly forty characters."

    chunked = chunk_text(f"Tiny.\n\n{forty}\n\nEnd.", 20, 41)

    assert chunked.passages == [forty]
    assert chunked.dropped_short == 2


@pytest.mark.parametrize(
    "abbreviation",
    ["M.", "MM.", "Mme.", "Mlle.", "Dr.", "Pr.", "St.", "cf.", "Cf.", "ex.", "p.", "pp.", "vol.", "no.", "n°.",
     "etc.", "i.e.", "e.g.", "J.", "É."],
)
def test_chunk_text_never_cuts_after_an_abbreviation_or_an_initial(abbreviation):
    first = "Aaaa bbbb cccc dddd."
    second = f"Voir {abbreviation} Suite ici."
    # The limit ends exactly after the abbreviation, where the old cutter split "M." from "Spencer".
    max_chars = len(f"{first} Voir {abbreviation}")

    assert chunk_text(f"{first} {second}", 1, max_chars).passages == [first, second]


def test_chunk_text_is_deterministic():
    text = f"{LONG_A}\n\n{LONG_B}\n\nshort"

    assert chunk_text(text, 200, 1200) == chunk_text(text, 200, 1200)


def test_html_text_keeps_readable_blocks_and_drops_page_chrome():
    markup = """<!doctype html><html><head><title>Tab title</title>
    <style>p { color: red }</style><script>var hidden = "script";</script></head>
    <body><nav>Menu Home</nav><header>Site header</header>
    <noscript>Enable JS</noscript><template><p>Template text</p></template>
    <svg><title>Icon</title><text>vector</text></svg>
    <main><h2>Les faits sociaux</h2>
    <p>First   paragraph
       with &amp; entities &eacute;t&eacute; &#8217;quoted&#8217;&nbsp;here.</p>
    <p>Line one<br>line two</p>
    <ul><li>Item one</li><li>Item two</li></ul>
    <blockquote>A quoted block</blockquote><pre>pre   text</pre>
    <table><tr><td>cell A</td><td>cell B</td></tr></table>
    <dl><dt>Term</dt><dd>Definition</dd></dl>
    <figure><figcaption>Caption text</figcaption></figure>
    <aside>Side note</aside><form>Search box</form></main>
    <footer>Footer links</footer></body></html>"""

    assert chunk_text(html_text(markup), 1, 1000).passages == [
        "Les faits sociaux",
        "First paragraph with & entities été ’quoted’ here.",
        "Line one line two",
        "Item one",
        "Item two",
        "A quoted block",
        "pre text",
        "cell A",
        "cell B",
        "Term",
        "Definition",
        "Caption text",
    ]


def test_html_text_drops_chrome_marked_by_class_id_role_or_table_class():
    # Skins put page-state classes on <html> and <body> (vector-sticky-header-enabled, page-Navbox):
    # those two elements are never chrome.
    markup = """<html class="client-nojs vector-sticky-header-enabled"><body class="page-Navbox noprint-off">
    <a class="mw-jump-link" href="#content">Aller au contenu</a>
    <div id="contentSub"><div class="subpages">&lt; Page parente</div></div>
    <div class="mw-indicators"><div class="mw-indicator">Télécharger</div></div>
    <div id="siteSub" class="noprint">La bibliothèque libre.</div>
    <div id="headertemplate" class="ws-noexport"><div>Auteur <div>imbriqué</div> encore</div></div>
    <div role="navigation">Navigation</div><div role="banner">Bannière</div>
    <div role="contentinfo">Pied</div>
    <table class="infobox"><tr><td>Infobox</td></tr></table>
    <table class="metadata plainlinks"><tr><td>Métadonnées</td></tr></table>
    <table class="headertemplate"><tr><td>Entête</td></tr></table>
    <table class="ws-summary"><tr><td>Sommaire</td></tr></table>
    <table class="wikitable"><tr><td>Cellule gardée</td></tr></table>
    <h2>Titre<span class="mw-editsection">[modifier]</span></h2>
    <p>Paragraphe gardé.</p>
    <div class="navbox">Boîte de navigation</div>
    <ul><li class="noprint">Élément jamais fermé<li>Élément gardé</ul>
    <div class="printfooter">Récupérée de …</div>
    <div id="catlinks" class="catlinks">Catégorie : Textes validés</div>
    <div class="vector-sticky-header-container"><span>Titre collant</span></div>
    </body></html>"""

    assert chunk_text(html_text(markup), 1, 1000).passages == [
        "Cellule gardée",
        "Titre",
        "Paragraphe gardé.",
        "Élément gardé",
    ]


def test_durkheim_page_passages_start_with_the_chapter_and_carry_no_chrome():
    envelope = build_passage_envelope(
        PassageCapture(kind="html", location=str(DURKHEIM_PAGE), title="Les Règles — Chapitre I")
    )

    texts = [result["text"] for result in envelope["results"]]
    assert texts[0].startswith(
        "CHAPITRE I\n\nQU’EST-CE QU’UN FAIT SOCIAL ?\n\nAvant de chercher quelle est la méthode"
    )
    for chrome in WIKIMEDIA_CHROME:
        assert not any(chrome in text for text in texts), chrome
    assert any("d’après M. Spencer" in text for text in texts)
    assert sum(text.count("↑") for text in texts) == DURKHEIM_NOTE_COUNT
    assert all(200 <= len(text) <= 1200 for text in texts)
    assert envelope["dropped_short"] == 0


def test_pdf_reference_reads_text_blocks_page_by_page(tmp_path):
    path = tmp_path / "reference.pdf"
    path.write_bytes(pdf_bytes([["First block on page one.", "Second block on page one."], ["Page two block."]]))

    text = read_reference_text(PassageCapture(kind="pdf", location=str(path), title="T"))

    assert "\f" in text
    assert chunk_text(text, 1, 1000).passages == [
        "First block on page one.",
        "Second block on page one.",
        "Page two block.",
    ]


def test_pdf_reference_rejects_unreadable_bytes(tmp_path):
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"this is not a pdf")

    with pytest.raises(PassageCaptureError, match="cannot read PDF"):
        read_reference_text(PassageCapture(kind="pdf", location=str(path), title="T"))


@pytest.mark.parametrize(
    ("media_type", "body", "expected"),
    [
        ("text/html", b"<p>Hello <b>web</b></p><script>hidden()</script>", ["Hello web"]),
        ("application/xhtml+xml", b"<p>Strict page</p>", ["Strict page"]),
        ("text/plain", b"<p>Plain text keeps its tags</p>", ["<p>Plain text keeps its tags</p>"]),
    ],
)
def test_url_reference_routes_by_media_type(monkeypatch, media_type, body, expected):
    monkeypatch.setattr(self_study_passages, "_fetch", fake_fetch(media_type, body))
    capture = PassageCapture(kind="url", location="https://example.test/page", title="T")

    assert chunk_text(read_reference_text(capture), 1, 1000).passages == expected


@pytest.mark.parametrize("media_type", ["application/pdf", "application/octet-stream"])
def test_url_reference_reads_pdf_by_media_type_or_signature(monkeypatch, media_type):
    monkeypatch.setattr(self_study_passages, "_fetch", fake_fetch(media_type, pdf_bytes([["Remote PDF block."]])))
    capture = PassageCapture(kind="url", location="https://example.test/paper", title="T")

    assert chunk_text(read_reference_text(capture), 1, 1000).passages == ["Remote PDF block."]


@pytest.mark.parametrize("url", ["file:///etc/hosts", "ftp://example.test/file", "example.test/page", "https://"])
def test_url_reference_requires_an_http_url(url):
    with pytest.raises(PassageCaptureError, match="http"):
        build_passage_envelope(PassageCapture(kind="url", location=url, title="T"))


def test_fetch_asks_once_with_timeout_redirects_and_user_agent(monkeypatch):
    calls = []

    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(
            200,
            headers={"content-type": "Text/HTML; charset=ISO-8859-1"},
            content="café".encode("iso-8859-1"),
            request=httpx.Request("GET", url),
        )

    monkeypatch.setattr(self_study_passages.httpx, "get", fake_get)

    fetched = self_study_passages._fetch("https://example.test/page")

    assert fetched.media_type == "text/html"
    assert fetched.body.decode(fetched.encoding) == "café"
    url, kwargs = calls[0]
    assert len(calls) == 1 and url == "https://example.test/page"
    assert kwargs["timeout"] == FETCH_TIMEOUT_SECONDS == 20
    assert kwargs["follow_redirects"] is True
    assert kwargs["headers"]["User-Agent"]


@pytest.mark.parametrize(
    "failure",
    [
        httpx.ConnectError("no route"),
        httpx.HTTPStatusError(
            "404 Not Found",
            request=httpx.Request("GET", "https://example.test/missing"),
            response=httpx.Response(404),
        ),
    ],
)
def test_fetch_failure_is_a_capture_error(monkeypatch, failure):
    def failing_get(url, **kwargs):
        raise failure

    monkeypatch.setattr(self_study_passages.httpx, "get", failing_get)

    with pytest.raises(PassageCaptureError, match="cannot fetch https://example.test/missing"):
        self_study_passages._fetch("https://example.test/missing")


def test_envelope_for_a_local_text_file_is_inert_and_records_its_path(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text(f"{LONG_A}\n\n{LONG_B}\n", encoding="utf-8")

    envelope = build_passage_envelope(
        PassageCapture(kind="text", location=str(path), title="  Les Règles — Chapitre I  ")
    )

    source = {
        "bibkey": "les-regles-chapitre-i",
        "title": "Les Règles — Chapitre I",
        "url": None,
        "license": "unknown",
    }
    assert envelope == {
        "success": True,
        "origin": SELF_STUDY_PASSAGES_ORIGIN,
        "results": [
            {
                "chunk_id": f"les-regles-chapitre-i-{index}",
                "text": text,
                "source_url": None,
                "title": "Les Règles — Chapitre I",
                "license_id": "unknown",
                "source": source,
            }
            for index, text in enumerate([LONG_A, LONG_B], start=1)
        ],
        "attempts": 1,
        "dropped_short": 0,
        "origin_path": str(path.resolve()),
    }


def test_envelope_for_a_url_carries_the_url_and_licence_on_every_passage(monkeypatch):
    page = f"<html><body><p>{LONG_A}</p><p>{LONG_B}</p></body></html>".encode()
    monkeypatch.setattr(self_study_passages, "_fetch", fake_fetch("text/html", page))

    envelope = build_passage_envelope(
        PassageCapture(kind="url", location="https://example.test/rules", title="Rules", license_id="CC-BY-SA-4.0")
    )

    assert "origin_path" not in envelope
    assert [result["text"] for result in envelope["results"]] == [LONG_A, LONG_B]
    for result in envelope["results"]:
        assert result["source_url"] == result["source"]["url"] == "https://example.test/rules"
        assert result["license_id"] == result["source"]["license"] == "CC-BY-SA-4.0"


def test_envelope_title_without_ascii_letters_still_gets_chunk_ids(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text(LONG_A, encoding="utf-8")

    envelope = build_passage_envelope(PassageCapture(kind="text", location=str(path), title="社会的事実"))

    assert envelope["results"][0]["chunk_id"] == "passage-1"


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"title": "   "}, "title"),
        ({"min_chars": 0}, "--min-chars"),
        ({"min_chars": 500, "max_chars": 400}, "--min-chars"),
        ({"kind": "docx"}, "kind"),
    ],
)
def test_envelope_rejects_unusable_requests(tmp_path, changes, message):
    path = tmp_path / "notes.txt"
    path.write_text(LONG_A, encoding="utf-8")
    request = {"kind": "text", "location": str(path), "title": "T", **changes}

    with pytest.raises(PassageCaptureError, match=message):
        build_passage_envelope(PassageCapture(**request))


def test_envelope_reports_how_many_short_paragraphs_it_dropped(tmp_path):
    path = tmp_path / "notes.txt"
    forty = "A paragraph of exactly forty characters."
    path.write_text(f"Tiny.\n\n{forty}\n\nEnd.", encoding="utf-8")

    envelope = build_passage_envelope(
        PassageCapture(kind="text", location=str(path), title="T", min_chars=20, max_chars=41)
    )

    assert [result["text"] for result in envelope["results"]] == [forty]
    assert envelope["dropped_short"] == 2


def test_envelope_without_a_usable_passage_is_an_error(tmp_path):
    path = tmp_path / "notes.txt"
    path.write_text("Too short.\n\nAlso short.", encoding="utf-8")

    with pytest.raises(PassageCaptureError, match="no passage of at least 200 characters"):
        build_passage_envelope(PassageCapture(kind="text", location=str(path), title="T"))


def test_local_files_must_be_utf8_and_readable(tmp_path):
    latin = tmp_path / "latin.txt"
    latin.write_bytes("café ".encode("iso-8859-1") * 80)

    with pytest.raises(PassageCaptureError, match="UTF-8"):
        build_passage_envelope(PassageCapture(kind="text", location=str(latin), title="T"))
    with pytest.raises(PassageCaptureError, match="cannot read"):
        build_passage_envelope(PassageCapture(kind="html", location=str(tmp_path / "absent.html"), title="T"))


def test_passage_text_is_unicode_normalized_for_exact_quotes(tmp_path):
    path = tmp_path / "decomposed.txt"
    decomposed = "été " * 60
    path.write_text(decomposed, encoding="utf-8")

    envelope = build_passage_envelope(PassageCapture(kind="text", location=str(path), title="T"))

    assert envelope["results"][0]["text"] == ("été " * 60).strip()
