"""Parity of the scene-synth Pydantic mirror with the Zod bundle schema on the 2026-10-30 additions.

Two fields of packages/lesson-bundle-schema reach the bundle through the conversational authoring
route: ``metadata.authoring.drafted_by`` (contract C3) and ``evidence`` on EVERY scene type (it was
declared on intro, concept and reproduction only, so Zod silently stripped it from the others).
A mirror that lacks either one drops it on a round trip through scene-synth: readers then fall back
to ``learner`` for an agent-drafted key, and the quotes that ground a graded item vanish.

The Zod behaviour is pinned three ways: the TypeScript source is read for the facts that decide it
(the drafter enum, ``evidence`` declared once on the scene base and on no single type), the real Zod
schemas are RUN through tsx on the same payloads and compared with the Pydantic dump, and the
canonical Pydantic mirror in packages/lesson-bundle-schema/python is run against them too. The tsx
cases skip only when tsx is not installed (CI installs it: ``pnpm install``).
"""

import copy
import functools
import glob
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import get_args

import pytest
from pydantic import TypeAdapter, ValidationError

from scene_synth_schemas import Bundle, BundleAuthoring, Scene, SceneType

REPO = Path(__file__).resolve().parents[4]
SCHEMA_PKG = REPO / "packages/lesson-bundle-schema"
SCENES_TS = (SCHEMA_PKG / "src/scenes.ts").read_text()
INDEX_TS = (SCHEMA_PKG / "src/index.ts").read_text()

EVIDENCE = {
    "bibliographic_refs": [
        {
            "perspicacite_doc_id": "doc-1",
            "title": "Notes de cours",
            "authors": ["A. Auteur"],
            "year": 2024,
            "excerpt": "le droit devient restitutif",
            "relevance_score": 0.9,
            "prov_derived_from": "passage:abc123",
        }
    ],
    "enrichment_metadata": {
        "enricher_version": "authoring-1",
        "perspicacite_mode_used": "basic",
        "timestamp": "2026-10-30T10:00:00Z",
        "degraded": False,
    },
}


@functools.lru_cache(maxsize=None)
def _canonical_mirror():
    path = SCHEMA_PKG / "python/lesson_bundle_schema/__init__.py"
    spec = importlib.util.spec_from_file_location("lesson_bundle_schema_canonical", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # pydantic resolves the forward references through it
    spec.loader.exec_module(module)
    return module


def _one_scene_per_type():
    """One real scene of every type, taken from the repository fixtures."""
    found = {}
    for name in sorted(glob.glob(str(REPO / "fixtures/**/lesson.json"), recursive=True)):
        for scene in json.loads(Path(name).read_text()).get("scenes", []):
            found.setdefault(scene["type"], scene)
    return found


SCENES = _one_scene_per_type()
TYPES = sorted(get_args(SceneType))


def test_the_fixtures_hold_every_scene_type():
    assert sorted(SCENES) == TYPES


def test_zod_declares_evidence_once_on_the_scene_base_and_on_no_single_type():
    base = re.search(r"export const SceneBaseSchema = z\.object\(\{(.*?)\n\}\);", SCENES_TS, re.S)
    assert base and "evidence: EvidenceSchema.optional()" in base.group(1)
    blocks = re.findall(
        r"export const \w+SceneSchema = SceneBaseSchema\.extend\(\{(.*?)\n\}\);", SCENES_TS, re.S
    )
    assert len(blocks) == len(TYPES)
    # a per-type re-declaration would shadow the base (and could narrow it): none may exist
    assert [b for b in blocks if re.search(r"^\s*evidence\s*:", b, re.M)] == []


@pytest.mark.parametrize("scene_type", TYPES)
def test_every_scene_type_keeps_its_evidence_through_a_round_trip(scene_type):
    raw = copy.deepcopy(SCENES[scene_type])
    raw["evidence"] = copy.deepcopy(EVIDENCE)
    scene = TypeAdapter(Scene).validate_python(raw)
    dumped = json.loads(scene.model_dump_json(exclude_none=True))
    assert dumped["evidence"]["bibliographic_refs"][0]["excerpt"] == "le droit devient restitutif"


@pytest.mark.parametrize("scene_type", TYPES)
def test_evidence_stays_optional_on_every_scene_type(scene_type):
    raw = copy.deepcopy(SCENES[scene_type])
    raw.pop("evidence", None)
    scene = TypeAdapter(Scene).validate_python(raw)
    assert scene.evidence is None


@pytest.mark.parametrize("scene_type", TYPES)
def test_scene_synth_and_the_canonical_mirror_agree_on_evidence(scene_type):
    canonical = _canonical_mirror()
    raw = copy.deepcopy(SCENES[scene_type])
    raw["evidence"] = copy.deepcopy(EVIDENCE)
    ours = TypeAdapter(Scene).validate_python(raw).model_dump(exclude_none=True)["evidence"]
    theirs = TypeAdapter(canonical.Scene).validate_python(raw).model_dump(exclude_none=True)["evidence"]
    assert ours == theirs


def test_drafted_by_values_match_the_zod_enum_and_the_canonical_mirror():
    zod = re.search(r"DraftedBySchema = z\.enum\(\[(.*?)\]\)", INDEX_TS, re.S)
    zod_values = set(re.findall(r'"(\w+)"', zod.group(1)))
    field = BundleAuthoring.model_fields["drafted_by"]
    # Optional[Literal[...]]: the Literal is the non-None member of the union
    ours = {value for arg in get_args(field.annotation) for value in get_args(arg)}
    theirs = {
        value
        for arg in get_args(_canonical_mirror().BundleAuthoring.model_fields["drafted_by"].annotation)
        for value in get_args(arg)
    }
    assert ours == zod_values == theirs == {"agent", "learner", "teacher"}


@pytest.mark.parametrize("drafter", ["agent", "learner", "teacher"])
def test_drafted_by_survives_the_bundle_round_trip(drafter):
    raw = json.loads((REPO / "fixtures/atomistique-l1/lesson.json").read_text())
    raw["metadata"]["authoring"] = {"mode": "self_study", "author_is_learner": False, "drafted_by": drafter}
    bundle = Bundle.model_validate(raw)
    dumped = json.loads(bundle.model_dump_json(exclude_none=True))
    assert dumped["metadata"]["authoring"] == raw["metadata"]["authoring"]


def test_drafted_by_stays_optional_and_rejects_an_unknown_drafter():
    assert BundleAuthoring.model_validate({"mode": "self_study"}).drafted_by is None
    with pytest.raises(ValidationError):
        BundleAuthoring.model_validate({"mode": "self_study", "drafted_by": "oracle"})


# ---------------------------------------------------------------------------
# The real Zod schemas, run through tsx (the same binary CI calls for tools/bundle_lint.mjs)
# ---------------------------------------------------------------------------

TSX = REPO / "node_modules/.pnpm/node_modules/.bin/tsx"
needs_tsx = pytest.mark.skipif(not (TSX.exists() or shutil.which("tsx")), reason="tsx is not installed")

ZOD_SCRIPT = """
import {{ SceneSchema, LessonBundleSchema }} from {src!r};
import {{ readFileSync }} from "node:fs";
const payload = JSON.parse(readFileSync(0, "utf8"));
const out: any = {{ scenes: {{}}, bundles: [] }};
for (const [type, raw] of Object.entries<any>(payload.scenes)) {{
  const r = SceneSchema.safeParse(raw);
  out.scenes[type] = r.success ? {{ ok: true, evidence: (r.data as any).evidence ?? null }} : {{ ok: false }};
}}
for (const raw of payload.bundles) {{
  const r = LessonBundleSchema.safeParse(raw);
  out.bundles.push(r.success ? {{ ok: true, authoring: (r.data as any).metadata?.authoring ?? null }} : {{ ok: false }});
}}
console.log(JSON.stringify(out));
"""


@functools.lru_cache(maxsize=1)
def _zod_results():
    base = json.loads((REPO / "fixtures/atomistique-l1/lesson.json").read_text())
    scenes = {}
    for scene_type in TYPES:
        raw = copy.deepcopy(SCENES[scene_type])
        raw["evidence"] = copy.deepcopy(EVIDENCE)
        scenes[scene_type] = raw
    bundles = []
    for drafter in ["agent", "learner", "teacher", "oracle"]:
        bundle = copy.deepcopy(base)
        bundle["metadata"]["authoring"] = {"mode": "self_study", "author_is_learner": False, "drafted_by": drafter}
        bundles.append(bundle)
    script = ZOD_SCRIPT.format(src=str(SCHEMA_PKG / "src/index.ts"))
    # the script imports the schema sources by absolute path, so it can live in a temp dir
    with tempfile.TemporaryDirectory() as tmp:
        script_path = Path(tmp) / "zod_parity_probe.mts"
        script_path.write_text(script)
        proc = subprocess.run(
            [str(TSX) if TSX.exists() else "tsx", str(script_path)],
            input=json.dumps({"scenes": scenes, "bundles": bundles}),
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(REPO),
        )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1]), scenes, bundles


@needs_tsx
@pytest.mark.parametrize("scene_type", TYPES)
def test_zod_keeps_evidence_on_every_scene_type_exactly_as_scene_synth_does(scene_type):
    zod, scenes, _ = _zod_results()
    assert zod["scenes"][scene_type]["ok"] is True
    ours = TypeAdapter(Scene).validate_python(scenes[scene_type]).model_dump(exclude_none=True)["evidence"]
    assert zod["scenes"][scene_type]["evidence"] == json.loads(json.dumps(ours))


@needs_tsx
def test_zod_and_scene_synth_agree_on_every_drafter_including_the_rejected_one():
    zod, _, bundles = _zod_results()
    for raw, verdict in zip(bundles, zod["bundles"]):
        drafter = raw["metadata"]["authoring"]["drafted_by"]
        try:
            ours = Bundle.model_validate(raw).model_dump(exclude_none=True)["metadata"]["authoring"]
        except ValidationError:
            ours = None
        assert (ours is not None) == verdict["ok"], drafter
        if ours is not None:
            assert verdict["authoring"]["drafted_by"] == ours["drafted_by"] == drafter
    assert [v["ok"] for v in zod["bundles"]] == [True, True, True, False]
