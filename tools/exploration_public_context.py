"""Fail closed on fields outside operator-context/v1's public display projection.

This boundary mirrors operator-context.ts, not the full private lesson schema.
Transport parity is exercised with real host output in the exploration demo.
Scalar source text is still untrusted data, not authenticated or secret-scanned.
"""


def _scalars(names: str) -> dict:
    return dict.fromkeys(names.split())


_CHECK = _scalars("check passed")
_COMMAND = {"cmd": [None], "env": None}
_EXAMPLE = {**_scalars("kind text choiceId value ran passed landmark stdout_tail confidence"),
            "verdicts": [_scalars("token flagged")], "artifacts": [None],
            "checks": [_CHECK], "provenance": _COMMAND}
_SCENE = {**_scalars("id type title markdown prompt question flawed_content source_content ai_summary artifact_a artifact_b scenario task"),
          "concept_refs": [None], "objective_refs": [None],
          "choices": [_scalars("id text")], "deck": [_scalars("token text")]}
_ASSET = {**_scalars("kind title payload path language format provenance"),
          "legend": [_scalars("symbol meaning")],
          "meta": {**_scalars("passed landmark"), "cmd": [None]}}
_RUN = {**_scalars("capsule_ref working_dir timeout_s research_question landmark_pattern"),
        **{name: [None] for name in ("cmd", "requirements", "expected_outputs", "verify_checks")}}
# `authoring` is the host's AuthoringBlock (authoring.ts): who wrote the lesson and the approval record's
# status. `reviewer` is bounded free text from approval.json; the record's bundle hash is not projected.
_AUTHORING = {**_scalars("mode author_is_learner drafted_by validated judge notice"),
              "approval": _scalars("recorded matches reviewer reviewed_at")}
# The private, ungraded experiment journal's descriptor (tool names, file names, sequence, instructions).
_JOURNAL = {**_scalars("record_tool read_tool file snapshot instructions"), "sequence": [None]}
PUBLIC_CONTEXT = {
    **_scalars("schema session_id"), "scene": _SCENE, "scene_assets": [_ASSET], "run_manifest": _RUN,
    # The legends of earlier equations that share a concept with the scene (host.sceneNotation).
    "notation": [_scalars("symbol meaning")], "authoring": _AUTHORING,
    "response": {**_scalars("kind file instructions"), "example": _EXAMPLE},
    "language": _scalars("source_language selected_language effective_language translation_required instructions"),
    "rendering": _scalars("owner instructions"),
    "exploration": {**_scalars("capabilities recordTool instructions"), "workflow": [None],
                    "journal": _JOURNAL},
}


def validate_public_fields(value: object, shape: object = PUBLIC_CONTEXT) -> None:
    """Reject unknown/nested private fields while retaining the exact public context."""
    if value is None:
        return
    if isinstance(shape, dict):
        if not isinstance(value, dict) or not value.keys() <= shape.keys():
            raise ValueError("Context contains fields outside the public display contract")
        for key, child in value.items():
            validate_public_fields(child, shape[key])
    elif isinstance(shape, list):
        if not isinstance(value, list):
            raise ValueError("Public context field must be an array")
        for child in value:
            validate_public_fields(child, shape[0])
    elif isinstance(value, (dict, list)):
        raise ValueError("Nested content in a public scalar field")
