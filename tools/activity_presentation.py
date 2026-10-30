"""Prepare optional presentation preferences without rewriting activity evidence."""
from __future__ import annotations

import json
import re
import subprocess
from functools import lru_cache
from pathlib import Path

LANGUAGE = re.compile(r'^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$')
MAX_TRANSLATIONS_BYTES = 1_000_000


def load_presentation(*, language: str = 'en', translations_path: Path | None = None,
                      supports_path: Path | None = None) -> dict:
    """Load checked language packs and canonical visual assets from local files."""
    language = _canonical_language(language)
    translations = _translations(translations_path) if translations_path else {}
    assets = []
    if supports_path:
        from activity_support import prepare_support
        assets = prepare_support(supports_path)
    return {'language': language, 'translations': translations, 'render_assets': assets}


def _translations(path: Path) -> dict:
    """Read bounded exact-string translations; canonical identifiers are not keys."""
    with path.open('rb') as stream:
        raw = stream.read(MAX_TRANSLATIONS_BYTES + 1)
    if len(raw) > MAX_TRANSLATIONS_BYTES:
        raise ValueError('translation pack exceeds 1 MB')
    value = json.loads(raw)
    if not isinstance(value, dict) or len(value) > 50:
        raise ValueError('translation pack must map language tags to text dictionaries')
    for language, entries in value.items():
        if not LANGUAGE.fullmatch(language) or not isinstance(entries, dict):
            raise ValueError('translation language/dictionary is invalid')
        if any(not isinstance(text, str) or not isinstance(target, str) for text, target in entries.items()):
            raise ValueError('translation entries must contain text only')
    return {_canonical_language(language): entries for language, entries in value.items()}


@lru_cache(maxsize=128)
def _canonical_language(language: str) -> str:
    """Use the same Intl language-tag semantics as the JavaScript session host."""
    if not isinstance(language, str) or len(language) > 128 or not LANGUAGE.fullmatch(language):
        raise ValueError('Invalid presentation language tag')
    script = "try { process.stdout.write(Intl.getCanonicalLocales(process.argv[1])[0]); } catch { process.exit(1); }"
    result = subprocess.run(['node', '-e', script, language], capture_output=True, text=True, timeout=5)
    if result.returncode or not result.stdout:
        raise ValueError('Invalid presentation language tag')
    return result.stdout
