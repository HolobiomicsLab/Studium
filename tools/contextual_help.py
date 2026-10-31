"""Inline shared, passive pedagogical help in local Studium HTML surfaces."""
from functools import lru_cache
from html import escape
import json
from pathlib import Path
import re

UI = Path(__file__).resolve().parents[1] / 'ui'


@lru_cache(maxsize=1)
def load_catalogue() -> dict:
    """Read the versioned, authored catalogue; no learner or provider input."""
    return json.loads((UI / 'context-help.json').read_text(encoding='utf-8'))


def _paragraph(label: str, value: str) -> str:
    return f'<p><strong>{escape(label)}:</strong> {escape(value)}</p>'


def _localized_body(topic: dict, locale: str, audience: str) -> str:
    labels = load_catalogue()['labels'][locale]
    item = topic[locale]
    other = 'teacher' if audience == 'student' else 'student'
    intro = f'<h3>{escape(item["title"])}</h3><p>{escape(item["what"])}</p>'
    first = _paragraph(labels[audience], item[audience])
    objective = _paragraph(labels['objective'], item['objective'])
    more = ''.join(_paragraph(labels[key], item[key]) for key in (other, 'method', 'limit'))
    source = _paragraph(labels['source'], topic['source'])
    return f'<div data-help-locale="{locale}" lang="{locale}">{intro}{first}{objective}<details class="studium-help-more"><summary>{escape(labels["more"])}</summary>{more}{source}</details></div>'


def help_tip(topic_id: str, audience: str = 'student') -> str:
    """Render one known topic as native bilingual disclosure; escape every value."""
    catalogue = load_catalogue()
    if topic_id not in catalogue['topics']:
        raise ValueError(f'Unknown help topic: {topic_id}')
    if audience not in ('student', 'teacher'):
        raise ValueError('Unknown help audience')
    topic = catalogue['topics'][topic_id]
    names = ''.join(f'<span class="studium-help-sr" data-help-locale="{loc}" lang="{loc}">{escape(catalogue["labels"][loc]["about"])}: {escape(topic[loc]["title"])}</span>' for loc in ('en', 'fr'))
    body = ''.join(_localized_body(topic, loc, audience) for loc in ('en', 'fr'))
    return f'<details class="studium-help" data-help-topic="{escape(topic_id)}" translate="no"><summary><span aria-hidden="true">?</span>{names}</summary><div class="studium-help-box">{body}</div></details>'


def help_assets(interactive: bool = False) -> str:
    """Inline shared CSS and optional non-recording keyboard/dismissal enhancement."""
    css = (UI / 'context-help.css').read_text(encoding='utf-8')
    result = f'<style id="studium-help-styles">{css}</style>'
    if interactive:
        script = (UI / 'context-help-runtime.js').read_text(encoding='utf-8')
        result += f'<script>{script}</script>'
    return result


def add_contextual_help(page: str, audience: str = 'student') -> str:
    """Replace explicit authored markers, leaving titles, values and inputs intact."""
    page = re.sub(r'<!-- HELP:([a-z-]+) -->', lambda match: help_tip(match[1], audience), page)
    return page.replace('</head>', help_assets() + '</head>', 1).replace(
        '</body>', '<script>' + (UI / 'context-help-runtime.js').read_text() + '</script></body>', 1)
