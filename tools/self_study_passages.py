"""Turn a learner-chosen URL, HTML page, PDF or text file into an inert passage envelope.

The envelope has the shape ``experience_packet.py prepare --passages`` already reads from
Perspicacité (``{"success": true, "results": [...]}``), so a learner without Perspicacité can
author a lesson from references they chose themselves. Nothing read or fetched is executed:
HTML is reduced to its readable text with the standard-library parser, a PDF to its text
blocks with PyMuPDF.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, NamedTuple
from urllib.parse import urlsplit

import httpx

SELF_STUDY_ORIGIN_FAMILY = "self-study-passages"
SELF_STUDY_PASSAGES_ORIGIN = f"{SELF_STUDY_ORIGIN_FAMILY}/1.0"
DEFAULT_LICENSE_ID = "unknown"
DEFAULT_MIN_CHARS = 200
DEFAULT_MAX_CHARS = 1200
REFERENCE_KINDS = ("url", "html", "pdf", "text")
CAPTURE_ATTEMPTS = 1
FETCH_TIMEOUT_SECONDS = 20.0
USER_AGENT = "studium-self-study-passages/1.0 (+https://github.com/HolobiomicsLab/studium)"
HTTP_SCHEMES = frozenset({"http", "https"})
HTML_MEDIA_TYPES = frozenset({"text/html", "application/xhtml+xml"})
PDF_MEDIA_TYPE = "application/pdf"
PDF_SIGNATURE = b"%PDF-"
PDF_TEXT_BLOCK = 0
FALLBACK_SLUG = "passage"
PARAGRAPH_SEPARATOR = "\n\n"
PARAGRAPH_BOUNDARY = re.compile(r"\n\s*\n|\f")
WHITESPACE_RUN = re.compile(r"\s+")
# A period after these is not a sentence end ("d'après M. Spencer"); nor is one after an initial.
NON_TERMINAL_ABBREVIATIONS = (
    "M", "MM", "Mme", "Mlle", "Dr", "Pr", "St", "cf", "Cf", "ex", "Ex", "p", "pp", "vol", "Vol",
    "no", "No", "n°", "etc", "i.e", "e.g",
)
SENTENCE_END = re.compile(
    r"(?<=[.!?…])"
    + "".join(rf"(?<!\b{re.escape(abbreviation)}\.)" for abbreviation in NON_TERMINAL_ABBREVIATIONS)
    + r"(?<!\b[A-ZÀ-ÖØ-Þ]\.) "
)
NON_SLUG_RUN = re.compile(r"[^a-z0-9]+")
VOID_HTML_TAGS = frozenset(
    {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
)
# Page chrome and non-prose: nothing inside these ever becomes a passage.
SKIPPED_HTML_TAGS = frozenset(
    {"script", "style", "noscript", "template", "svg", "nav", "header", "footer", "aside", "form", "title"}
)
SKIPPED_HTML_ROLES = frozenset({"navigation", "contentinfo", "banner"})
# Skins put page-state classes on these (vector-sticky-header-enabled, page-<title>): never chrome.
NEVER_CHROME_TAGS = frozenset({"html", "body"})
# Wikimedia chrome, matched inside class and id values: jump links, notices, indicators, Wikisource
# headers and scan data, footers, categories, the breadcrumb and Vector's sticky header.
SKIPPED_HTML_MARKERS = (
    "mw-jump-link", "printfooter", "catlinks", "noprint", "navbox", "mw-editsection", "mw-indicator",
    "ws-noexport", "contentSub", "vector-sticky-header",
)
SKIPPED_TABLE_MARKERS = ("infobox", "metadata", "headertemplate", "ws-summary")
# An unclosed <li>, <p>, <td>… ends where its next sibling starts.
IMPLIED_END_SIBLINGS = {
    "li": {"li"}, "p": {"p"}, "dt": {"dt", "dd"}, "dd": {"dt", "dd"}, "tr": {"tr"}, "td": {"td", "th"},
    "th": {"td", "th"}, "option": {"option"},
}
BLOCK_HTML_TAGS = frozenset(
    {
        "p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "td", "th", "dd", "dt",
        "figcaption", "caption", "figure", "div", "section", "article", "main", "table", "tr",
        "ul", "ol", "dl", "hr", "address",
    }
)


class PassageCaptureError(ValueError):
    """Raised when a reference cannot be read or yields no usable passage."""


@dataclass(frozen=True)
class PassageCapture:
    """One learner-chosen reference to capture.

    ``kind`` is ``url``, ``html``, ``pdf`` or ``text``; ``location`` is the URL or the file path.
    A paragraph shorter than ``min_chars`` joins a neighbouring passage when it fits and is
    dropped and counted otherwise; no passage is longer than ``max_chars``.
    """

    kind: str
    location: str
    title: str
    license_id: str = DEFAULT_LICENSE_ID
    min_chars: int = DEFAULT_MIN_CHARS
    max_chars: int = DEFAULT_MAX_CHARS


@dataclass(frozen=True)
class FetchedReference:
    """What one URL fetch returned: media type (no parameters), raw bytes, text encoding."""

    media_type: str
    body: bytes
    encoding: str


class ChunkedText(NamedTuple):
    """Passages cut from a text, and how many short paragraphs had no passage to join."""

    passages: list[str]
    dropped_short: int


def _is_chrome(tag: str, attrs: dict[str, str | None]) -> bool:
    if tag in NEVER_CHROME_TAGS:
        return False
    names = f"{attrs.get('class') or ''} {attrs.get('id') or ''}"
    table_class = attrs.get("class") or "" if tag == "table" else ""
    return (
        tag in SKIPPED_HTML_TAGS
        or bool(SKIPPED_HTML_ROLES.intersection((attrs.get("role") or "").lower().split()))
        or any(marker in names for marker in SKIPPED_HTML_MARKERS)
        or any(marker in table_class for marker in SKIPPED_TABLE_MARKERS)
    )


class _ReadableTextParser(HTMLParser):
    """Collect a page's readable text, one paragraph per block element, chrome left out.

    Open elements are kept on a stack so that the end tag closing a chrome element, however
    deeply its own children nest, is the one that ends the skipped region.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._open: list[tuple[str, bool]] = []
        self._skipped_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in VOID_HTML_TAGS:
            self._void(tag)
            return
        if self._open and self._open[-1][0] in IMPLIED_END_SIBLINGS.get(tag, ()):
            self._close_from(len(self._open) - 1)
        is_chrome = _is_chrome(tag, dict(attrs))
        self._open.append((tag, is_chrome))
        self._skipped_depth += is_chrome
        self._break_at_block(tag)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self._open) - 1, -1, -1):
            if self._open[index][0] == tag:
                self._close_from(index)
                self._break_at_block(tag)
                return

    def handle_data(self, data: str) -> None:
        # Source line breaks inside a block are layout, not paragraph ends.
        if self._skipped_depth == 0:
            self._parts.append(WHITESPACE_RUN.sub(" ", data))

    def _close_from(self, index: int) -> None:
        self._skipped_depth -= sum(is_chrome for _, is_chrome in self._open[index:])
        del self._open[index:]

    def _break_at_block(self, tag: str) -> None:
        if tag in BLOCK_HTML_TAGS and self._skipped_depth == 0:
            self._parts.append(PARAGRAPH_SEPARATOR)

    def _void(self, tag: str) -> None:
        if self._skipped_depth == 0 and tag == "br":
            self._parts.append(" ")
        else:
            self._break_at_block(tag)

    def text(self) -> str:
        return "".join(self._parts)


def html_text(markup: str) -> str:
    """Return the readable text of an HTML page, paragraphs separated by blank lines.

    Dropped: scripts, styles, templates, SVG, navigation, headers, footers, asides, forms, the
    ``<title>``, landmarks with role navigation, banner or contentinfo, Wikimedia chrome named
    by class or id (``SKIPPED_HTML_MARKERS``) and info, metadata or header tables. Entities are
    decoded.
    """
    parser = _ReadableTextParser()
    parser.feed(markup)
    parser.close()
    return parser.text()


def _pdf_text(data: bytes) -> str:
    """Return a PDF's text blocks, blank lines between blocks and form feeds between pages."""
    import fitz  # PyMuPDF, loaded only when a PDF is read

    # Ligatures expanded and line-end hyphens joined, so a quote typed by hand matches.
    flags = (fitz.TEXTFLAGS_BLOCKS & ~fitz.TEXT_PRESERVE_LIGATURES) | fitz.TEXT_DEHYPHENATE
    try:
        with fitz.open(stream=data, filetype="pdf") as document:
            return "\f".join(_pdf_page_text(page, flags) for page in document)
    except RuntimeError as exc:
        raise PassageCaptureError(f"cannot read PDF: {exc}") from exc


def _pdf_page_text(page: Any, flags: int) -> str:
    blocks = page.get_text("blocks", flags=flags)
    return PARAGRAPH_SEPARATOR.join(block[4] for block in blocks if block[6] == PDF_TEXT_BLOCK)


def _fetch(url: str) -> FetchedReference:
    """GET ``url`` once, following redirects, and return what came back."""
    try:
        response = httpx.get(
            url,
            follow_redirects=True,
            timeout=FETCH_TIMEOUT_SECONDS,
            headers={"User-Agent": USER_AGENT},
        )
        response.raise_for_status()
    except (httpx.HTTPError, httpx.InvalidURL) as exc:
        raise PassageCaptureError(f"cannot fetch {url}: {exc}") from exc
    media_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    encoding = response.encoding or "utf-8"
    return FetchedReference(media_type=media_type, body=response.content, encoding=encoding)


def _http_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme not in HTTP_SCHEMES or not parts.netloc:
        raise PassageCaptureError(f"--url needs an http or https URL with a host, got {url!r}")
    return url


def _fetched_text(fetched: FetchedReference) -> str:
    if fetched.media_type == PDF_MEDIA_TYPE or fetched.body.startswith(PDF_SIGNATURE):
        return _pdf_text(fetched.body)
    text = fetched.body.decode(fetched.encoding, errors="replace")
    return html_text(text) if fetched.media_type in HTML_MEDIA_TYPES else text


def _read_local_bytes(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except OSError as exc:
        raise PassageCaptureError(f"cannot read {path}: {exc}") from exc


def _decode_local(data: bytes, location: str) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise PassageCaptureError(f"{location} is not UTF-8 text; save it as UTF-8 and retry") from exc


def read_reference_text(capture: PassageCapture) -> str:
    """Return the readable text of the reference ``capture`` points at.

    A URL is fetched once and routed by media type: HTML, PDF (also recognised by its
    signature), anything else as plain text. A local file is read as its kind says; HTML and
    text files must be UTF-8.
    """
    if capture.kind == "url":
        return _fetched_text(_fetch(_http_url(capture.location)))
    if capture.kind not in REFERENCE_KINDS:
        expected = ", ".join(REFERENCE_KINDS)
        raise PassageCaptureError(f"unknown reference kind {capture.kind!r}; expected one of {expected}")
    data = _read_local_bytes(Path(capture.location))
    if capture.kind == "pdf":
        return _pdf_text(data)
    text = _decode_local(data, capture.location)
    return html_text(text) if capture.kind == "html" else text


def _pack(units: list[str], max_chars: int) -> list[str]:
    """Join consecutive units with single spaces into pieces of at most ``max_chars``."""
    pieces: list[str] = []
    for unit in units:
        if pieces and len(pieces[-1]) + 1 + len(unit) <= max_chars:
            pieces[-1] += " " + unit
        else:
            pieces.append(unit)
    return pieces


def _fit_sentence(sentence: str, max_chars: int) -> list[str]:
    if len(sentence) <= max_chars:
        return [sentence]
    words = _pack(sentence.split(" "), max_chars)
    return [word[start:start + max_chars] for word in words for start in range(0, len(word), max_chars)]


def _fit(paragraph: str, max_chars: int) -> list[str]:
    """Cut a paragraph longer than ``max_chars`` at sentence ends, then spaces, then anywhere."""
    if len(paragraph) <= max_chars:
        return [paragraph]
    sentences = _pack(SENTENCE_END.split(paragraph), max_chars)
    return [piece for sentence in sentences for piece in _fit_sentence(sentence, max_chars)]


def _fits_after(passage: str, piece: str, max_chars: int) -> bool:
    return len(passage) + len(PARAGRAPH_SEPARATOR) + len(piece) <= max_chars


def _merge_short(pieces: list[str], min_chars: int, max_chars: int) -> list[str]:
    merged: list[str] = []
    for piece in pieces:
        if merged and len(merged[-1]) < min_chars and _fits_after(merged[-1], piece, max_chars):
            merged[-1] += PARAGRAPH_SEPARATOR + piece
        else:
            merged.append(piece)
    return merged


def _attach_short(chunks: list[str], min_chars: int, max_chars: int) -> ChunkedText:
    passages: list[str] = []
    dropped_short = 0
    for chunk in chunks:
        if len(chunk) >= min_chars:
            passages.append(chunk)
        elif passages and _fits_after(passages[-1], chunk, max_chars):
            passages[-1] += PARAGRAPH_SEPARATOR + chunk
        else:
            dropped_short += 1
    return ChunkedText(passages, dropped_short)


def chunk_text(text: str, min_chars: int, max_chars: int) -> ChunkedText:
    """Split ``text`` into ordered passages of ``min_chars`` to ``max_chars`` characters.

    Paragraphs end at blank lines and form feeds; inside one, whitespace runs become single
    spaces. A paragraph longer than ``max_chars`` is cut at sentence ends, never after an
    abbreviation or an initial (at spaces when one sentence is too long). A passage under
    ``min_chars`` first absorbs the paragraphs after it (a heading joins its section); one
    still short then joins the passage before it (a note joins the text it ends). Both joins
    use a blank line and stay within ``max_chars``; what fits nowhere is dropped and counted
    in ``dropped_short``. The same text always gives the same passages.
    """
    paragraphs = (WHITESPACE_RUN.sub(" ", block).strip() for block in PARAGRAPH_BOUNDARY.split(text))
    pieces = [piece for paragraph in paragraphs if paragraph for piece in _fit(paragraph, max_chars)]
    return _attach_short(_merge_short(pieces, min_chars, max_chars), min_chars, max_chars)


def _slug(title: str) -> str:
    ascii_title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    return NON_SLUG_RUN.sub("-", ascii_title.lower()).strip("-") or FALLBACK_SLUG


def _check_request(capture: PassageCapture) -> None:
    if not capture.title.strip():
        raise PassageCaptureError("title must not be empty")
    if not 1 <= capture.min_chars <= capture.max_chars:
        raise PassageCaptureError("--min-chars must be at least 1 and no larger than --max-chars")


def is_self_study_origin(origin: Any) -> bool:
    """Whether an envelope ``origin`` says its passages were captured by this module."""
    return isinstance(origin, str) and origin.startswith(SELF_STUDY_ORIGIN_FAMILY)


def _envelope(capture: PassageCapture, chunked: ChunkedText) -> dict[str, Any]:
    title = capture.title.strip()
    license_id = capture.license_id.strip() or DEFAULT_LICENSE_ID
    url = capture.location if capture.kind == "url" else None
    slug = _slug(title)
    results = [
        {
            "chunk_id": f"{slug}-{number}",
            "text": chunk,
            "source_url": url,
            "title": title,
            "license_id": license_id,
            # One key for the whole reference, as a Perspicacité bibkey: the packet then counts
            # a local file (no DOI, no URL) as one source, not one per passage.
            "source": {"bibkey": slug, "title": title, "url": url, "license": license_id},
        }
        for number, chunk in enumerate(chunked.passages, start=1)
    ]
    envelope: dict[str, Any] = {
        "success": True,
        "origin": SELF_STUDY_PASSAGES_ORIGIN,
        "results": results,
        "attempts": CAPTURE_ATTEMPTS,
        "dropped_short": chunked.dropped_short,
    }
    if url is None:
        envelope["origin_path"] = str(Path(capture.location).resolve())
    return envelope


def build_passage_envelope(capture: PassageCapture) -> dict[str, Any]:
    """Read, chunk and wrap one reference as the envelope ``prepare --passages`` consumes.

    Every passage carries the title, the licence, the title slug as ``source.bibkey`` (so
    the packet's ``source_id`` names the reference) and, for a URL, that URL. A local file
    leaves ``source_url`` null and records its absolute path as the top-level
    ``origin_path``, which the passage normalizer ignores, as it ignores ``dropped_short``
    (short paragraphs that found no passage to join). Text is NFC-normalized so a quote typed
    with composed accents matches. Raises ``PassageCaptureError`` when the request is unusable
    or no passage survives.
    """
    _check_request(capture)
    text = unicodedata.normalize("NFC", read_reference_text(capture))
    chunked = chunk_text(text, capture.min_chars, capture.max_chars)
    if not chunked.passages:
        raise PassageCaptureError(
            f"no passage of at least {capture.min_chars} characters in {capture.location}; "
            "it may be empty, a scan without text, or shorter than --min-chars"
        )
    return _envelope(capture, chunked)
