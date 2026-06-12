"""Stage 1 — AUTHOR: corpus .md -> schema-valid LessonBundle ZIP.

Two pluggable backends, both producing the SAME runtime-exercising structure
(an LWG with a prerequisite_for edge + baseline/remedial universes whose concept
node ids align to scene.concept_refs, so session.ts prereq-gating AND universe
escalation actually fire — closing the fixture gap behind REVIEW-FINDINGS #6):

  - "deterministic" (default, key-free): builds concepts/scenes/rules/lwg/
    universes from the corpus *structure* (headings + the manifest summary).
    The prose is lifted verbatim from the corpus body, so the bundle is
    corpus-faithful at the SECTION level even without an LLM. It is NOT a
    content-blind metabolomics mock — it refuses to emit anything about a
    different corpus (design risk #1). Quiz items are templated and flagged in
    author_provenance as `synthetic_assessment=true` so the auditor never
    credits them as validated questions.

  - "claude" (live): the `claude` CLI reads the raw corpus and authors the
    concept/scene/quiz/critique PROSE as JSON; we then graft it onto the same
    structural scaffold (so the runtime contract is guaranteed) and VALIDATE the
    whole bundle with the Pydantic mirror before zipping. The LWG/universes are
    still authored structurally so concept-id alignment is machine-guaranteed.

Both backends:
  - reuse services/scene-synth/bundler.build_bundle (strict LessonBundle
    validation + PROV sidecar);
  - validate the LWG against the TS schema (fail loud — design risk #2/#3);
  - write author_provenance.json (mode, model, prompt hash, structural facts).

A "real" planner+scene-synth backend is documented in eval/README.md; it is the
key-gated path and is intentionally not the default because localhost:4000
(LiteLLM) is unreachable here and scene-synth has no mock fallback.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

from .corpus import CorpusMaterial
from .llm import ClaudeCli
from .paths import ensure_scene_synth_importable

# Bloom progression used across concepts (remember -> understand -> apply ...).
_BLOOM_LADDER = ["remember", "understand", "apply", "analyze", "evaluate", "create"]


@dataclass
class AuthorResult:
    bundle_path: Path
    bundle_uri: str
    provenance: dict
    bundle_dict: dict


# ---------------------------------------------------------------------------
# Corpus structural parsing (heading-driven section extraction)
# ---------------------------------------------------------------------------


@dataclass
class Section:
    title: str
    body: str

    @property
    def first_paragraph(self) -> str:
        for para in self.body.split("\n\n"):
            p = para.strip()
            if p and not p.startswith("#"):
                return p
        return self.body.strip()[:400]


def _slug(text: str, maxlen: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (s[:maxlen] or "x").strip("-")


def parse_sections(body: str) -> list[Section]:
    """Split a markdown body into sections on `##`/`###` headings.

    Falls back to a single section if the document has no sub-headings.
    """
    lines = body.splitlines()
    sections: list[Section] = []
    cur_title: str | None = None
    cur_lines: list[str] = []

    def flush() -> None:
        if cur_title is not None:
            sections.append(Section(title=cur_title.strip(), body="\n".join(cur_lines).strip()))

    for ln in lines:
        m = re.match(r"^#{2,3}\s+(.*)$", ln)
        if m:
            flush()
            cur_title = m.group(1)
            cur_lines = []
        else:
            cur_lines.append(ln)
    flush()

    # Drop empty / boilerplate sections; keep ones with real prose.
    sections = [s for s in sections if len(s.first_paragraph) > 60]
    return sections


def _title_of(body: str, fallback: str) -> str:
    m = re.search(r"^#\s+(.*)$", body, flags=re.MULTILINE)
    return m.group(1).strip() if m else fallback


# ---------------------------------------------------------------------------
# Structural scaffold — concepts/scenes/rules/lwg/universes (runtime contract)
# ---------------------------------------------------------------------------


# Consolidation / recap sections summarise prior content; tagging them with a high-order
# Bloom verb (analyze/evaluate/create) is content-incoherent (M1). We avoid selecting them
# as concepts so the chosen triple is genuinely substantive AND the positional Bloom ladder
# (understand -> apply -> analyze) lands coherently on real content sections.
_CONSOLIDATION_RE = re.compile(r"summary|conclusion|recap|review|overview|objectives?", re.IGNORECASE)


def _is_consolidation(title: str) -> bool:
    return bool(_CONSOLIDATION_RE.search(title or ""))


def _pick_concept_sections(sections: list[Section], material: CorpusMaterial) -> list[Section]:
    """Choose 2–3 sections to become concepts. Two minimum so we can author a
    prerequisite_for edge (concept B requires concept A) and exercise gating.

    M1 coherence: a consolidation/recap section (Summary, Conclusion, Overview, Learning
    Objectives) is NOT a substantive concept — the positional Bloom ladder would force the
    LAST concept to `analyze`, stamping a recap with the highest cognitive verb. So we draw
    concepts from substantive (non-consolidation) sections, falling back to the raw list
    only if filtering would leave too few.
    """
    if len(sections) >= 2:
        substantive = [s for s in sections if not _is_consolidation(s.title)]
        # keep >= the minimum (2) and prefer substantive sections; fall back if filtering is too aggressive
        pool = substantive if len(substantive) >= min(3, len(sections)) else sections
        # spread across the doc: first, middle, last-ish (of the substantive pool)
        if len(pool) >= 3:
            return [pool[0], pool[len(pool) // 2], pool[-1]]
        return pool[:2]
    # degenerate: synthesise two sub-concepts from the single section / summary
    only = sections[0] if sections else Section(material.title, material.summary)
    halves = only.body.split("\n\n")
    mid = max(1, len(halves) // 2)
    return [
        Section(f"{material.title} — overview", "\n\n".join(halves[:mid]) or material.summary),
        Section(f"{material.title} — details", "\n\n".join(halves[mid:]) or only.first_paragraph),
    ]


def build_scaffold(material: CorpusMaterial, body: str) -> dict:
    """Build the structural skeleton: concepts (with bloom ladder), scene
    order (intro -> per-concept concept+quiz -> ai_critique -> meta_checkpoint),
    adaptation rules, the LWG (prerequisite_for chain over concepts), and
    baseline/remedial universes. concept_refs == bare concept ids, and LWG
    concept nodes are `concept:<id>` (matching graph-nav.ts re-prefixing).
    """
    sections = parse_sections(body)
    chosen = _pick_concept_sections(sections, material)

    concepts: list[dict] = []
    for i, sec in enumerate(chosen):
        cid = f"c-{material.id}-{_slug(sec.title, 24)}-{i}"
        concepts.append(
            {
                "id": cid,
                "title": sec.title[:120],
                "description": sec.first_paragraph[:480],
                "bloom_level_target": _BLOOM_LADDER[min(i + 1, len(_BLOOM_LADDER) - 1)],
                "_section": sec,  # internal, stripped before validation
            }
        )

    return {
        "material": material,
        "concepts": concepts,
        "sections": sections,
    }


# ---------------------------------------------------------------------------
# Scene / rule / graph emission (shared by both author backends)
# ---------------------------------------------------------------------------


def _quiz_scene(cid: str, idx: int, content: dict) -> dict:
    """content: {question, choices:[{text,correct}], feedback_correct, feedback_incorrect, hints}"""
    choices = []
    for j, ch in enumerate(content["choices"]):
        choices.append({"id": chr(ord("a") + j), "text": ch["text"], "correct": bool(ch["correct"])})
    return {
        "id": f"s-quiz-{cid}-{idx}",
        "type": "quiz",
        "title": content.get("title", f"Quiz: {cid}"),
        "objective_refs": [],
        "concept_refs": [cid],
        "estimated_seconds": 60,
        "adaptation_hooks": ["rule_2err_replay_concept", "rule_mastery_high_skip"],
        "question": content["question"],
        "choices": choices,
        "feedback_correct": content.get("feedback_correct", "Correct."),
        "feedback_incorrect": content.get("feedback_incorrect", "Not quite — review the concept."),
        "hints": list(content.get("hints", [])),
    }


def _rules() -> list[dict]:
    return [
        {
            "id": "rule_2err_replay_concept",
            "when": {"consecutive_errors_same_concept": ">=2"},
            "action": {"kind": "replay_current_scene", "reason": "errors_threshold"},
            "modulator": "M1",
            "explanation_short": "Two errors on this concept — let's review it.",
        },
        {
            "id": "rule_mastery_high_skip",
            "when": {"mastery_c": ">=0.8", "total_attempts": ">=3"},
            "action": {"kind": "skip_to_next_concept"},
            "modulator": "M1",
            "explanation_short": "You have mastered this concept — moving on.",
        },
        {
            "id": "rule_calibration_mismatch_show",
            "when": {"confidence_calibration_abs": ">=0.4", "total_attempts": ">=3"},
            "action": {"kind": "show_calibration_panel"},
            "modulator": "M3",
            "explanation_short": "Compare your declared confidence to your actual performance.",
        },
    ]


def _learning_workflow_graph(material: CorpusMaterial, concepts: list[dict]) -> dict:
    """LWG with a prerequisite_for chain c0 <- c1 <- c2 so prereq gating fires
    when a later concept is reached without mastering the earlier one.

    Edge convention (graph-router.ts): a prerequisite_for edge has
    source=dependent, target=prerequisite. Concept node ids are `concept:<id>`.
    """
    nodes: list[dict] = []
    for c in concepts:
        nodes.append(
            {
                "id": f"concept:{c['id']}",
                "node_kind": "concept",
                "title": c["title"],
                "bloom_level": c["bloom_level_target"],
                "knowledge_dimension": "conceptual",
                "description": c["description"][:200],
            }
        )
    edges: list[dict] = []
    for i in range(1, len(concepts)):
        dependent = concepts[i]["id"]
        prereq = concepts[i - 1]["id"]
        edges.append(
            {
                "id": f"e-prereq-{i}",
                "relation": "prerequisite_for",
                "source": f"concept:{dependent}",
                "target": f"concept:{prereq}",
                "confidence": 0.5,
                # honest provenance: this edge is a STRUCTURAL inference, not a
                # Perspicacité-grounded one. The auditor's grounding dimension
                # keys off this flag (mirrors planner _ARTIFACT_FALLBACK_CONF=0.4).
                "quality_flags": ["structural_inference", "ungrounded"],
            }
        )
    return {
        "schema_version": "1.0",
        "course_id": f"course-{material.id}",
        "nodes": nodes,
        "edges": edges,
    }


def _universes() -> dict:
    """baseline + remedial variants. session.ts escalates baseline->remedial
    after ESCALATE_AFTER=2 prereq remediations; remedial lowers theta + heavy
    scaffolding. The `theta` decision key feeds thetaForVariant()."""
    return {
        "active": "baseline",
        "variants": [
            {
                "id": "baseline",
                "description": "Default pacing; standard scaffolding; theta=0.8.",
                "decisions": {"pacing": "linear", "scaffolding": "standard", "theta": "0.8"},
            },
            {
                "id": "remedial",
                "description": "Lower mastery bar and heavy scaffolding after repeated remediation.",
                "decisions": {"pacing": "linear", "scaffolding": "heavy", "theta": "0.6"},
            },
        ],
    }


def assemble_lesson_plan(material: CorpusMaterial, concepts: list[dict], scenes: list[dict]) -> dict:
    """Shape the dict that bundler.build_bundle consumes (it reads lesson_id,
    plan_id, metadata, concepts, rules, learning_workflow_graph, universes)."""
    clean_concepts = [{k: v for k, v in c.items() if not k.startswith("_")} for c in concepts]
    duration = max(10, round(material.word_count / 120) + len(scenes) * 2)
    language = "fr" if material.branch == "" else _guess_language(material)
    return {
        "lesson_id": f"lesson-{material.id}",
        "plan_id": f"plan-{material.id}",
        "title": material.title,
        "metadata": {
            "title": material.title,
            "target": material.level[:32] if material.level else "L3",
            "duration_minutes": duration,
            "language": language,
            "discipline": material.discipline,
        },
        "concepts": clean_concepts,
        "rules": _rules(),
        "learning_workflow_graph": _learning_workflow_graph(material, concepts),
        "universes": _universes(),
    }


def _guess_language(material: CorpusMaterial) -> str:
    # All corpus materials are English OER; keep it honest rather than defaulting to fr.
    return "en"


# ---------------------------------------------------------------------------
# Scene ordering — shared
# ---------------------------------------------------------------------------


def order_scenes(material: CorpusMaterial, concepts: list[dict], scene_content: dict) -> list[dict]:
    """Build the scene list in pedagogical order.

    scene_content (per concept id) provides authored prose:
      { cid: { "concept_markdown": str, "quiz": {...}, } }
    plus top-level "intro_markdown" and "critique": {claims, rubric}.
    """
    scenes: list[dict] = []
    scenes.append(
        {
            "id": "s-intro",
            "type": "intro",
            "title": f"Introduction — {material.title}"[:120],
            "objective_refs": [],
            "concept_refs": [concepts[0]["id"]],
            "estimated_seconds": 45,
            "adaptation_hooks": [],
            "markdown": scene_content["intro_markdown"],
        }
    )
    for i, c in enumerate(concepts):
        cid = c["id"]
        cc = scene_content["concepts"][cid]
        scenes.append(
            {
                "id": f"s-concept-{cid}",
                "type": "concept",
                "title": c["title"][:120],
                "objective_refs": [],
                "concept_refs": [cid],
                "estimated_seconds": 90,
                "adaptation_hooks": [],
                "markdown": cc["concept_markdown"],
            }
        )
        scenes.append(_quiz_scene(cid, 1, cc["quiz"]))
    # ai_critique anchored on the LAST concept (answer-graded -> moves mastery)
    crit = scene_content["critique"]
    scenes.append(
        {
            "id": "s-critique",
            "type": "ai_critique",
            "title": "Critique the AI tutor's claims"[:120],
            "objective_refs": [],
            "concept_refs": [concepts[-1]["id"]],
            "estimated_seconds": 120,
            "adaptation_hooks": [],
            "claims": crit["claims"],
            "rubric": crit["rubric"],
        }
    )
    scenes.append(
        {
            "id": "s-meta-final",
            "type": "meta_checkpoint",
            "title": "Self-assessment"[:120],
            "objective_refs": [],
            "concept_refs": [concepts[-1]["id"]],
            "estimated_seconds": 60,
            "adaptation_hooks": ["rule_calibration_mismatch_show"],
            "pre_question": f"How confident are you that you understand {material.title}?",
            "post_question": "Compare your declared confidence to your quiz performance.",
            "scale_labels": ["Not at all", "Slightly", "Moderately", "Fairly", "Completely"],
        }
    )
    return scenes


# ---------------------------------------------------------------------------
# Deterministic content (offline, corpus-section-faithful)
# ---------------------------------------------------------------------------


def _deterministic_content(material: CorpusMaterial, concepts: list[dict]) -> dict:
    intro = (
        f"# {material.title}\n\n{material.summary}\n\n"
        f"_Discipline: {material.discipline} · Level: {material.level} · "
        f"Source: {material.source_url}_"
    )
    per_concept: dict[str, dict] = {}
    for i, c in enumerate(concepts):
        sec: Section = c["_section"]
        # concept markdown = verbatim section prose (corpus-faithful)
        md = f"## {c['title']}\n\n{sec.body[:1800]}".strip()
        # templated quiz — flagged synthetic. Correct answer references the section title.
        per_concept[c["id"]] = {
            "concept_markdown": md,
            "quiz": {
                "title": f"Quiz: {c['title']}"[:120],
                "question": (
                    f"Which statement best reflects the section “{c['title']}” "
                    f"of {material.title}?"
                ),
                "choices": [
                    {"text": _first_sentence(sec.first_paragraph), "correct": True},
                    {"text": f"{c['title']} is unrelated to {material.discipline}.", "correct": False},
                    {"text": "None of the above applies to this material.", "correct": False},
                ],
                "feedback_correct": "Correct — that paraphrases the source section.",
                "feedback_incorrect": f"Re-read the section on {c['title']}.",
                "hints": [f"Look at how the source defines {c['title']}."],
            },
        }
    # ai_critique: two planted claims with flaws lifted from concept titles so
    # the ai-audit-matcher can detect a thorough critique.
    last = concepts[-1]
    critique = {
        "claims": [
            {
                "id": "claim-overgeneralize",
                "text": (
                    f"The tutor asserts that {material.title} can be fully understood "
                    f"from the single idea of {concepts[0]['title']} alone."
                ),
                "flaws_expected": ["overgeneralization", "ignores " + _slug(last["title"], 30).replace("-", " ")],
            },
            {
                "id": "claim-missing-evidence",
                "text": f"The tutor claims {last['title']} requires no prior concept.",
                "flaws_expected": ["missing prerequisite", "no evidence"],
            },
        ],
        "rubric": {"completeness": 0.5, "evidence_quality": 0.5, "tone": 0.5},
    }
    return {"intro_markdown": intro, "concepts": per_concept, "critique": critique}


def _normalize_validated_at(ts: str) -> tuple[str, bool]:
    """Convert a "+00:00" UTC offset to a "Z" suffix (Zod-strict datetime).
    Returns (normalized, was_offset)."""
    if ts.endswith("+00:00"):
        return ts[: -len("+00:00")] + "Z", True
    return ts, False


def _rewrite_lesson_json(bundle_path: Path, bundle_dict: dict) -> None:
    """Rewrite lesson.json inside the ZIP, preserving the prov.json sidecar."""
    import zipfile

    with zipfile.ZipFile(bundle_path) as zf:
        names = zf.namelist()
        others = {n: zf.read(n) for n in names if n != "lesson.json"}
    with zipfile.ZipFile(bundle_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("lesson.json", json.dumps(bundle_dict, indent=2, ensure_ascii=False))
        for n, data in others.items():
            zf.writestr(n, data)


def _first_sentence(text: str) -> str:
    m = re.split(r"(?<=[.!?])\s", text.strip(), maxsplit=1)
    s = m[0] if m else text
    return s.strip()[:240] or text[:240]


# ---------------------------------------------------------------------------
# Claude content (live LLM authoring of prose, structurally constrained)
# ---------------------------------------------------------------------------

_AUTHOR_SYSTEM = (
    "You are a meticulous university course author. You write factually accurate, "
    "pedagogically sound micro-lesson content grounded ONLY in the provided source "
    "material. You never invent facts beyond the source. You output strict JSON."
)


def _claude_content(material: CorpusMaterial, concepts: list[dict], body: str, cli: ClaudeCli) -> dict:
    concept_brief = [
        {"id": c["id"], "title": c["title"], "bloom_level_target": c["bloom_level_target"]}
        for c in concepts
    ]
    prompt = f"""SOURCE MATERIAL (title: {material.title}, discipline: {material.discipline}):
\"\"\"
{body[:9000]}
\"\"\"

Author lesson content for these concepts (use these EXACT ids):
{json.dumps(concept_brief, indent=2)}

Return STRICT JSON with this shape (no markdown fences):
{{
  "intro_markdown": "<2-4 sentence markdown intro to the whole lesson, grounded in the source>",
  "concepts": {{
    "<concept id>": {{
      "concept_markdown": "<150-300 word markdown explainer for this concept, grounded in the source>",
      "quiz": {{
        "title": "<short quiz title>",
        "question": "<one factual multiple-choice question answerable from the source>",
        "choices": [
          {{"text": "<correct answer>", "correct": true}},
          {{"text": "<plausible distractor>", "correct": false}},
          {{"text": "<plausible distractor>", "correct": false}}
        ],
        "feedback_correct": "<one sentence>",
        "feedback_incorrect": "<one sentence>",
        "hints": ["<one helpful hint>"]
      }}
    }}
  }},
  "critique": {{
    "claims": [
      {{"id": "claim-1", "text": "<a deliberately FLAWED claim about the material a student should critique>", "flaws_expected": ["<short flaw keyword>", "<short flaw keyword>"]}},
      {{"id": "claim-2", "text": "<a second flawed claim>", "flaws_expected": ["<short flaw keyword>"]}}
    ],
    "rubric": {{"completeness": 0.5, "evidence_quality": 0.5, "tone": 0.5}}
  }}
}}

Rules: exactly one choice per quiz has correct=true; provide a quiz for EVERY concept id; 1-3 claims; flaws_expected are 1-4 lowercase keyword phrases that would literally appear in a good critique."""
    data = cli.complete_json(prompt, system=_AUTHOR_SYSTEM)
    if not isinstance(data, dict):
        raise ValueError("Claude author did not return a JSON object")
    # Backfill any concept the model skipped, so order_scenes never KeyErrors.
    det = _deterministic_content(material, concepts)
    out_concepts = data.get("concepts") or {}
    for c in concepts:
        if c["id"] not in out_concepts:
            out_concepts[c["id"]] = det["concepts"][c["id"]]
    data["concepts"] = out_concepts
    data.setdefault("intro_markdown", det["intro_markdown"])
    data.setdefault("critique", det["critique"])
    # Ensure each quiz has exactly one correct choice (model drift guard).
    for cid, cc in data["concepts"].items():
        quiz = cc.get("quiz") or det["concepts"][cid]["quiz"]
        choices = quiz.get("choices") or []
        if sum(1 for ch in choices if ch.get("correct")) != 1 or len(choices) < 2:
            cc["quiz"] = det["concepts"][cid]["quiz"]
        else:
            cc["quiz"] = quiz
    return data


# ---------------------------------------------------------------------------
# Public entry — author a bundle
# ---------------------------------------------------------------------------


def author_bundle(
    material: CorpusMaterial,
    out_dir: Path,
    mode: str = "deterministic",
    model: str | None = None,
) -> AuthorResult:
    """Author a schema-valid LessonBundle ZIP for `material`.

    mode: "deterministic" (key-free) | "claude" (live LLM prose).
    Raises on any validation failure (fail loud).
    """
    ensure_scene_synth_importable()
    import bundler  # services/scene-synth/bundler.py (build_bundle)
    from scene_synth_schemas import LessonBundle  # noqa: N813 (mirror validator)

    body = material.read_body()
    scaffold = build_scaffold(material, body)
    concepts = scaffold["concepts"]

    if mode == "claude":
        cli = ClaudeCli(model=model)
        content = _claude_content(material, concepts, body, cli)
        author_label = "claude-cli"
        synthetic_assessment = False  # LLM authored the questions
    elif mode == "deterministic":
        content = _deterministic_content(material, concepts)
        author_label = "deterministic-offline"
        synthetic_assessment = True
    else:
        raise ValueError(f"unknown author mode: {mode!r} (use 'deterministic' or 'claude')")

    scenes = order_scenes(material, concepts, content)
    lesson_plan = assemble_lesson_plan(material, concepts, scenes)

    # --- fail-loud structural assertions (design risks #2/#3/#6) ---
    lwg = lesson_plan["learning_workflow_graph"]
    assert lwg and lwg["nodes"], "LWG must be present and non-empty (REVIEW-FINDINGS #2)"
    assert lwg["edges"], "LWG must carry >=1 prerequisite_for edge so gating can fire (#6)"
    scene_concept_ids = {cr for s in scenes for cr in s.get("concept_refs", [])}
    lwg_concept_ids = {n["id"].removeprefix("concept:") for n in lwg["nodes"]}
    missing = scene_concept_ids - lwg_concept_ids
    assert not missing, f"scene concept_refs not in LWG concepts (alignment broken): {missing}"
    assert lesson_plan["universes"]["variants"], "universes must be present (#6 adaptivity)"

    out_dir.mkdir(parents=True, exist_ok=True)
    bundle_path = out_dir / f"{material.id}-bundle.zip"
    prov_seed = {"agent": "eval-harness-author", "version": "0.1.0", "validator": f"eval-harness:{author_label}"}

    # build_bundle does the STRICT LessonBundle.model_validate before zipping.
    bundle_uri = bundler.build_bundle(lesson_plan, scenes, bundle_path, prov_seed)

    # re-load + re-validate the emitted lesson.json (belt and suspenders / fail loud)
    import zipfile

    with zipfile.ZipFile(bundle_path) as zf:
        bundle_dict = json.loads(zf.read("lesson.json"))
    LessonBundle.model_validate(bundle_dict)  # raises on any drift

    # HARNESS-DISCOVERED INTEROP DEFECT: bundler.py emits validated_at via
    # datetime.now(timezone.utc).isoformat() -> "...+00:00", but the TS loader
    # (bundle-loader.ts -> LessonBundleSchema) uses Zod z.string().datetime()
    # which by default REJECTS numeric offsets (only accepts "...Z"). The
    # Pydantic mirror accepts both, so the round-trip passes Python yet the
    # runtime refuses to load the bundle. We normalise to a Z suffix so the
    # session can run, and flag it for the audit (maps to the schema
    # single-source-of-truth IMPORTANT cluster item).
    normalized_ts, ts_was_offset = _normalize_validated_at(bundle_dict.get("validated_at", ""))
    if ts_was_offset:
        bundle_dict["validated_at"] = normalized_ts
        _rewrite_lesson_json(bundle_path, bundle_dict)
        LessonBundle.model_validate(bundle_dict)

    prompt_hash = hashlib.sha256(
        (material.read_body() if mode == "claude" else material.summary).encode("utf-8")
    ).hexdigest()[:16]

    provenance = {
        "bundler_validated_at_offset_defect": ts_was_offset,
        "author_mode": mode,
        "author_label": author_label,
        "model": model or ("claude-cli-default" if mode == "claude" else None),
        "synthetic_assessment": synthetic_assessment,
        "corpus_id": material.id,
        "corpus_title": material.title,
        "corpus_source_url": material.source_url,
        "corpus_word_count": material.word_count,
        "source_hash_sha256_16": prompt_hash,
        "n_concepts": len(concepts),
        "n_scenes": len(scenes),
        "scene_types": [s["type"] for s in scenes],
        "lwg_nodes": len(lwg["nodes"]),
        "lwg_edges": len(lwg["edges"]),
        "universe_variants": [v["id"] for v in lesson_plan["universes"]["variants"]],
        "schema_version": bundle_dict["schema_version"],
        "warning": (
            "OFFLINE deterministic author: quiz items are templated (synthetic_assessment=true) "
            "and concept prose is lifted verbatim from corpus sections. Not LLM-authored content."
            if mode == "deterministic"
            else "Live Claude author: prose + assessment LLM-generated; structure machine-constrained."
        ),
    }
    (out_dir / "author_provenance.json").write_text(
        json.dumps(provenance, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    return AuthorResult(
        bundle_path=bundle_path,
        bundle_uri=bundle_uri,
        provenance=provenance,
        bundle_dict=bundle_dict,
    )


__all__ = ["author_bundle", "AuthorResult", "parse_sections", "build_scaffold", "assemble_lesson_plan"]
