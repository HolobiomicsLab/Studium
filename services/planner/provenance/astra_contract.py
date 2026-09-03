"""Vendored minimal ASTRA contract: schema version + id grammar + slugifier + format grammar.

astra-spec is not a RUNTIME dependency of prototype-build, for the same reason
indicium is not (see indicium_schema_vendored.py): the planner emits plain
ASTRA-shaped dicts without importing astra. Since 2026-09-03 (INT-STUDIUM-010)
`astra-spec` and `astra-tools` are DEV requirements (requirements.txt) so the
real `astra validate` CLI runs in the test suite and in CI
(provenance/astra_validate.py, tools/astra_validate_check.py). This module stays
the OFFLINE fallback -- the version string the emitter stamps, the id grammar
and the slugifier that coerces Studium's internal edge ids into it, and the
`Output.format` grammar -- and the SINGLE source of truth for them; nothing else
in this repo may declare a second copy.

SOURCE OF TRUTH:
  Version string: PyPI astra-spec 0.0.14 (astra/datamodel/astra_pydantic.py;
    every class is `extra=forbid`). Re-pinned 2026-09-03, see MIGRATION below.
  Id grammar, reserved ids, slugifier (unchanged between 0.0.12 and 0.0.14):
    AgenticScienceBuilder src/agentic_science_builder/astra_export/model.py
    @ commit 2795f9ec4910e039ac7bb4dc02f574ae1645ca2c (2026-08-26)
    - id grammar           : model.py:28-35
    - ASTRA_RESERVED_IDS   : model.py:37-48
    - slugify_id           : model.py:51-75
    ASB still declares 0.0.12 (model.py:27); its documents keep the same id
    grammar, so this vendored fallback applies to ASB documents unchanged.
  Upstream spec: https://astra-spec.org/latest/ (analysis.yaml / universe.yaml)

MIGRATION 0.0.12 -> 0.0.14 (2026-09-03, INT-STUDIUM-010):
The first real `astra validate` run (astra-tools 0.2.17 and 0.2.12) rejected the
emitted set under BOTH versions, so the move is about the fields the validator
enforces, not the version string: every class forbids extra keys (the
`source_edge_id` extension key became a `source_edge_id:<raw>` tag read back by
`astra_emit.source_edge_id`); `Evidence.id` and `Insight.created_at` are
required; an evidence `quote` is a `TextQuoteSelector` object (`{exact: ...}`),
not a string; a universe assigns EVERY decision of its analysis; every evidence
`artifact` must be a declared output. New in 0.0.14: `Output.format`, optional
now and required from ASTRA 0.1.0 -- a lowercase token such as `json`, never a
media type (`application/json` is rejected); a root re-export output (one that
carries `from`) must NOT carry `format`. Emitting `format` is the one thing a
0.0.12 validator rejects, so 0.0.12 is no longer a green target for Studium's
own documents (ASB documents are unaffected: they are read here, not re-emitted).

MIGRATION 0.0.10 -> 0.0.12 (kept for the record):
0.0.12 dropped the `Narrative` class -- its five prose sections collapsed into a
single free-prose `description` on Analysis, and the narrative-coverage rule went
with it. Studium never emitted a `narrative` block, so for this emitter the
migration was the version string plus the id grammar (0.0.10 documents keyed by
raw edge ids never validated in the first place).
"""
from __future__ import annotations

import re

ASTRA_SCHEMA_VERSION = "0.0.14"

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


# `Output.format` grammar (astra-spec 0.0.14, Output.format pattern): a lowercase
# token such as `json` or `jsonld`, never a media type. Optional today, required
# from ASTRA 0.1.0; a root re-export output (one carrying `from`) must not set it.
ASTRA_FORMAT_RE = re.compile(r"^[a-z0-9][a-z0-9_.+-]*$")


def is_valid_astra_format(value: object) -> bool:
    """True when `value` is a string matching the `Output.format` grammar, else False."""
    return isinstance(value, str) and bool(ASTRA_FORMAT_RE.match(value))


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
