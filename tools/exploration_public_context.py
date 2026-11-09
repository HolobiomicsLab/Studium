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
PUBLIC_CONTEXT = {
    **_scalars("schema session_id"), "scene": _SCENE, "scene_assets": [_ASSET], "run_manifest": _RUN,
    "response": {**_scalars("kind file instructions"), "example": _EXAMPLE},
    "language": _scalars("source_language selected_language effective_language translation_required instructions"),
    "rendering": _scalars("owner instructions"),
    "exploration": {**_scalars("capabilities recordTool instructions"), "workflow": [None]},
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
