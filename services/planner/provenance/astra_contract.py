"""Vendored minimal ASTRA contract: schema version + id grammar + slugifier.

astra-spec is intentionally NOT a dependency of prototype-build, for the same
reason indicium is not (see indicium_schema_vendored.py): the planner emits plain
ASTRA-shaped dicts without importing astra. To make conformance testable OFFLINE
we vendor the *minimal* contract we need — the version string, the id grammar
`astra validate` enforces, and the slugifier that coerces Studium's internal edge
ids into it. This module is the SINGLE source of truth for both; nothing else in
this repo may declare a second copy.

SOURCE OF TRUTH (copy these verbatim; keep this file in lock-step):
  AgenticScienceBuilder src/agentic_science_builder/astra_export/model.py
    @ commit 5e707bc9be1ee6d4f0b27ae5d818c9d86eba381f (2026-07-29)
    - ASTRA_SCHEMA_VERSION : model.py:26   (upstream astra-spec v0.0.12)
    - id grammar           : model.py:28-34
    - ASTRA_RESERVED_IDS   : model.py:36-48
    - slugify_id           : model.py:50-73
  Upstream spec: https://astra-spec.org/latest/ (analysis.yaml / universe.yaml)

MIGRATION 0.0.10 -> 0.0.12 (the version this emitter previously declared):
0.0.12 dropped the `Narrative` class — its five prose sections collapsed into a
single free-prose `description` on Analysis, and the narrative-coverage rule went
with it. Studium never emitted a `narrative` block, so for this emitter the
migration is the version string plus the id grammar (0.0.10 documents keyed by
raw edge ids never validated in the first place).
"""
from __future__ import annotations

import re

ASTRA_SCHEMA_VERSION = "0.0.12"

# Container keys the grammar reserves.
ASTRA_RESERVED_IDS = frozenset({
    "inputs", "outputs", "decisions", "findings", "prior_insights",
    "analyses", "options", "content",
})

# Grammar `astra validate` enforces (model.py:28-34).
ASTRA_ID_RE = re.compile(
    r"^(?!(inputs|outputs|decisions|findings|prior_insights|analyses|options|content)$)"
    r"[a-z][a-z0-9_]*$"
)

_DIGIT_PREFIX = "a_"        # ASB's canonical prefix, already stamped downstream
_RESERVED_SUFFIX = "_x"
_EMPTY_FALLBACK = "a"


def is_valid_astra_id(value: object) -> bool:
    """True when `value` is a string matching the ASTRA id grammar, else False."""
    return isinstance(value, str) and bool(ASTRA_ID_RE.match(value))


def _slug_base(raw: object) -> str:
    """Lowercase `raw` to [a-z0-9_], guarding empty, leading-digit and reserved ids.
    Returns a grammar-valid id that is not yet checked for uniqueness."""
    s = re.sub(r"[^a-z0-9_]+", "_", str(raw).lower())
    s = re.sub(r"_+", "_", s).strip("_")
    if not s:
        return _EMPTY_FALLBACK
    if s[0].isdigit():
        return _DIGIT_PREFIX + s
    if s in ASTRA_RESERVED_IDS:
        return s + _RESERVED_SUFFIX
    return s


def slugify_id(raw: object, taken: set[str] | None = None) -> str:
    """Coerce arbitrary text to a valid ASTRA id.

    raw: any value (an edge id such as "link:wf:concept", an analysis id, ...).
    taken: ids already used in the same scope — the result is suffixed until it is
    unused and is then added to the set; pass None when the caller already
    guarantees uniqueness. Returns the grammar-valid id."""
    slug = _slug_base(raw)
    if taken is None:
        return slug
    base, n, out = slug, 2, slug
    while out in taken:
        out = f"{base}_{n}"
        n += 1
    taken.add(out)
    return out
