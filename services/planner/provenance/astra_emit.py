"""Assemble + write ASTRA artifacts (astra.yaml + universes/*.yaml). Studium-local
emission following astra-spec analysis.yaml / universe.yaml; the version, the id
grammar and the `Output.format` grammar come from the vendored contract
(provenance/astra_contract.py). Every entry emitted here is in-schema for
astra-spec 0.0.14 (every class is `extra=forbid`, checked by the real
`astra validate` in tests and CI since 2026-09-03, INT-STUDIUM-010): the raw
Studium edge id travels as a tag, evidence is normalised, and every artifact cited
as evidence becomes a declared sub-analysis output."""
from __future__ import annotations
import os
from collections.abc import Mapping
from typing import Any

from provenance.astra_contract import ASTRA_SCHEMA_VERSION, is_valid_astra_format, slugify_id

# Tag prefix carrying the raw Studium edge id an entry was keyed by before
# slugification (`tags: ["source_edge_id:<raw>"]`). It is also the name of the
# extension key files written before 2026-09-03 carried instead, which the real
# validator rejects (extra=forbid). approval.py joins a Claim to its ASTRA entry
# through the edge id embedded in `astra_insight_ref`, so the raw value must
# survive the coercion; read it back with source_edge_id(), never by key.
SOURCE_ID_FIELD = "source_edge_id"

# Non-schema Insight key make_insight() may set; kept recoverable as a tag.
_INDICIUM_REF_KEY = "indicium_claim_ref"


def source_edge_id(body: Mapping[str, Any], key: str) -> str:
    """The raw Studium edge id of an ASTRA entry: the `source_edge_id:<raw>` tag
    (in-schema, written since 2026-09-03), else the legacy extension key of files
    written before that, else the container key itself (pre-slug files were keyed
    by the raw id). Raw ids contain colons, so the tag splits on its first colon."""
    prefix = SOURCE_ID_FIELD + ":"
    for tag in body.get("tags") or []:
        if isinstance(tag, str) and tag.startswith(prefix):
            return tag[len(prefix):]
    legacy = body.get(SOURCE_ID_FIELD)
    return legacy if isinstance(legacy, str) else key


def _course_manifest_input(name: str) -> dict[str, Any]:
    return {"id": "course_manifest", "type": "data",
            "description": f"Course manifest and corpus references for {name}."}


def _format_hint(raw_artifact: str) -> str:
    """`Output.format` of a grounding output: the lesson plan and the lesson bundle
    are JSON documents; annotations, capsules and Perspicacité passages are text."""
    return "json" if raw_artifact.startswith(("plan:", "lesson.json")) else "text"


class _Grounding:
    """Declares one sub-analysis output per distinct artifact cited as evidence
    (first-seen order), so every `Evidence.artifact` names a declared output as the
    validator's semantic pass requires. `declared` seeds the dedup set with the ids
    of the outputs given to emit_astra; those are never re-declared."""

    def __init__(self, declared: set[str]) -> None:
        self.declared = set(declared)
        self.by_raw: dict[str, str] = {}
        self.outputs: list[dict[str, Any]] = []

    def output_for(self, raw: str) -> str:
        if raw not in self.by_raw:
            oid = slugify_id(f"artifact_{raw}", self.declared)
            self.declared.add(oid)
            self.by_raw[raw] = oid
            self.outputs.append({"id": oid, "type": "data", "format": _format_hint(raw),
                                 "description": f"Grounding reference {raw} cited as evidence."})
        return self.by_raw[raw]


def _normalise_evidence(owner_slug: str, evidence: list[dict[str, Any]],
                        grounding: _Grounding) -> tuple[list[dict[str, Any]], list[str]]:
    """In-schema copies of an insight's evidence entries, plus the notes that keep
    what the schema has no slot for. `id` defaults to `<owner>_ev<n>`; a string
    `quote` becomes a TextQuoteSelector (`{exact: ...}`, an empty one is dropped);
    `confidence` / `decision_context` move out into a note; an `artifact` that is
    not a declared output is replaced by its grounding output id."""
    out: list[dict[str, Any]] = []
    notes: list[str] = []
    for n, entry in enumerate(evidence):
        ev = dict(entry)
        ev.setdefault("id", f"{owner_slug}_ev{n}")
        quote = ev.get("quote")
        if isinstance(quote, str):
            if quote:
                ev["quote"] = {"exact": quote}
            else:
                del ev["quote"]
        moved = [f"{k}={ev.pop(k)}" for k in ("confidence", "decision_context") if k in ev]
        if moved:
            notes.append(f"{ev['id']}: " + ", ".join(moved))
        artifact = ev.get("artifact")
        if isinstance(artifact, str) and artifact not in grounding.declared:
            ev["artifact"] = grounding.output_for(artifact)
        out.append(ev)
    return out, notes


def _in_schema_insight(slug: str, body: dict[str, Any], grounding: _Grounding) -> dict[str, Any]:
    body["evidence"], notes = _normalise_evidence(slug, body.get("evidence") or [], grounding)
    ref = body.pop(_INDICIUM_REF_KEY, None)
    if ref:
        body["tags"].append(f"{_INDICIUM_REF_KEY}:{ref}")
    if notes:
        existing = [body["notes"]] if body.get("notes") else []
        body["notes"] = "; ".join(existing + notes)
    return body


def _keyed_by_astra_id(entries: list[dict[str, Any]], *, grounding: _Grounding | None = None,
                       ) -> dict[str, dict[str, Any]]:
    """Key `entries` (each carrying an "id") by a grammar-valid ASTRA id. Every body
    carries the raw id as a `source_edge_id:<raw>` tag (the legacy extension key is
    never written). With `grounding` (insight containers) the evidence is normalised
    and the artifacts it cites are declared. Returns the id -> body map ASTRA
    containers use."""
    taken: set[str] = set()
    out: dict[str, dict[str, Any]] = {}
    for entry in entries:
        raw = entry["id"]
        slug = slugify_id(raw, taken)
        body = {k: v for k, v in entry.items() if k not in ("id", SOURCE_ID_FIELD)}
        body["tags"] = [*(body.get("tags") or []), f"{SOURCE_ID_FIELD}:{raw}"]
        if grounding is not None:
            body = _in_schema_insight(slug, body, grounding)
        out[slug] = body
    return out


def emit_astra(
    *,
    analysis_id: str,
    name: str,
    decisions: list[dict[str, Any]],
    prior_insights: list[dict[str, Any]],
    findings: list[dict[str, Any]],
    outputs: list[dict[str, Any]],
    inputs: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build an ASTRA document in the ASB shape: version/name/inputs/outputs at the
    root (no root id) and the course as ONE sub-analysis under `analyses`, keyed and
    id'd by the slugified analysis_id. Container entries are keyed by grammar-valid
    ids and carry the raw id as a `source_edge_id:<raw>` tag; insight evidence is
    normalised and every artifact it cites becomes a declared sub-analysis output,
    appended after the given `outputs`. Root outputs re-export each GIVEN output via
    `from`, as ASB emitters do (a re-export carries no `format`). `inputs` is the
    sub-analysis input list; the default is the course manifest, the same entry as
    the root. Raises ValueError when an output carries a `format` outside the
    contract's grammar (a lowercase token such as `json`, never a media type)."""
    for o in outputs:
        if "format" in o and not is_valid_astra_format(o["format"]):
            raise ValueError(f"output {o.get('id')!r}: format {o['format']!r} is not an ASTRA "
                             f"format token (lowercase, no slash; e.g. 'json')")
    slug = slugify_id(analysis_id)
    manifest = _course_manifest_input(name)
    grounding = _Grounding({o["id"] for o in outputs})
    keyed_decisions = _keyed_by_astra_id(decisions)
    keyed_prior = _keyed_by_astra_id(prior_insights, grounding=grounding)
    keyed_findings = _keyed_by_astra_id(findings, grounding=grounding)
    return {
        "version": ASTRA_SCHEMA_VERSION,
        "name": name,
        "description": "Studium author-time course build; the sub-analysis carries "
                       "the build's decisions and findings.",
        "inputs": [manifest],
        "outputs": [{"id": f"{slug}_result", "from": f"{slug}.{o['id']}"} for o in outputs],
        "analyses": {slug: {
            "id": slug,
            "name": name,
            "inputs": list(inputs) if inputs is not None else [manifest],
            "decisions": keyed_decisions,
            "prior_insights": keyed_prior,
            "findings": keyed_findings,
            "outputs": [*outputs, *grounding.outputs],
        }},
    }


def analysis_body(doc: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """(slug, sub-analysis body) of an ASTRA document. A pre-nesting flat document
    (no `analyses` container) is its own body, so old artifacts keep resolving."""
    analyses = doc.get("analyses")
    if not analyses:
        return doc.get("id", ""), doc
    slug = next(iter(analyses))
    return slug, analyses[slug]


def baseline_universe(decisions: list[dict[str, Any]]) -> dict[str, Any]:
    """The baseline Universe selection: each decision's default option, flat.
    This is the in-API shape; nest_universe wraps it for the written artifact."""
    return {
        "id": "baseline",
        "description": "Default option per decision across the analysis.",
        "decisions": {slugify_id(d["id"]): d["default"] for d in decisions},
    }


def nest_universe(universe: dict[str, Any], analysis_slug: str) -> dict[str, Any]:
    """Wrap a flat Universe selection into the ASB universe.yaml shape: the option
    map sits under `analyses.<slug>.decisions` instead of at the root."""
    return {
        "id": universe["id"],
        "description": universe["description"],
        "analyses": {analysis_slug: {"decisions": universe["decisions"]}},
    }


def write_astra_yaml(analysis: dict[str, Any], out_dir: str) -> None:
    import yaml
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "astra.yaml"), "w", encoding="utf-8") as f:
        yaml.safe_dump(analysis, f, sort_keys=False, allow_unicode=True)


def write_universe_yaml(universe: dict[str, Any], out_dir: str) -> None:
    import yaml
    udir = os.path.join(out_dir, "universes")
    os.makedirs(udir, exist_ok=True)
    with open(os.path.join(udir, f"{universe['id']}.yaml"), "w", encoding="utf-8") as f:
        yaml.safe_dump(universe, f, sort_keys=False, allow_unicode=True)
