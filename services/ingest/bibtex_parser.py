"""BibTeX parser — wraps bibtexparser library."""
from __future__ import annotations
import os
from typing import Any

import bibtexparser
from bibtexparser.bparser import BibTexParser as _BibTexParser


def parse_bibtex(path: str) -> list[dict[str, Any]]:
    """Parse a .bib file and return a list of normalised reference dicts.

    Each entry contains at minimum:
        ref_id, title, doi (may be empty string if absent), authors, year.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"BibTeX file not found: {path}")

    parser = _BibTexParser(common_strings=True)
    with open(path, encoding="utf-8") as fh:
        db = bibtexparser.load(fh, parser=parser)

    entries: list[dict[str, Any]] = []
    for entry in db.entries:
        entries.append({
            "ref_id": entry.get("ID", ""),
            "title": entry.get("title", ""),
            "doi": entry.get("doi", ""),
            "authors": entry.get("author", ""),
            "year": entry.get("year", ""),
            "journal": entry.get("journal", ""),
            "entry_type": entry.get("ENTRYTYPE", ""),
        })
    return entries
