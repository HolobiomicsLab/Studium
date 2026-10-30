#!/usr/bin/env python3
"""Discover and prepare local Studium harness activity templates."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import re
import subprocess
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from activity_presentation import load_presentation
from contextual_help import add_contextual_help
from exploration_public_context import validate_public_fields
from learner_trace import activity_json_schema


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = ROOT / "examples" / "activity-templates"
MANIFEST_PATH = TEMPLATE_ROOT / "manifest.json"
VIEWER_PATH = TEMPLATE_ROOT / "viewer.html"
THEME_PATH = ROOT / "ui" / "studium-theme.css"
LINKED_CORE_PATH = ROOT / "examples" / "literature-experience" / "linked-viewer-core.mjs"
CATALOGUE_SCHEMA = "studium/activity-template-catalogue/v1"
CONFIG_SCHEMA = "studium/activity-template-config/v1"
ACTIVITY_SCHEMA = "studium/prepared-activity/v1"
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,120}$")
CHOICE_ID_MAX_LENGTH = 120
DATA_STATUSES = {"synthetic teaching fixture", "supplied source-backed data"}
COMMON_CONFIG_FIELDS = {
    "schema", "template_id", "data_status", "scope", "prediction_prompt",
    "expected_source_inputs", "independent_checks", "source",
}


@dataclass(frozen=True)
class PreparedActivity:
    """Paths produced for one ready activity template."""

    output_dir: Path
    activity_path: Path
    viewer_path: Path
    task_path: Path


def _read_json(path: Path) -> dict[str, Any]:
    """Read a JSON object from disk."""
    value = json.loads(
        path.read_text(encoding="utf-8"),
        object_pairs_hook=_reject_duplicate_keys,
        parse_constant=lambda token: (_ for _ in ()).throw(
            ValueError(f"non-finite JSON number: {token}")
        ),
    )
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    """Reject ambiguous duplicate JSON object members."""
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _sha256(data: bytes) -> str:
    """Return a lowercase SHA-256 digest."""
    return hashlib.sha256(data).hexdigest()


def _canonical_bytes(value: object) -> bytes:
    """Serialize JSON deterministically for hashing."""
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def list_templates() -> dict[str, Any]:
    """Return a detached copy of the versioned template catalogue."""
    catalogue = _read_json(MANIFEST_PATH)
    if catalogue.get("schema") != CATALOGUE_SCHEMA:
        raise ValueError("Unsupported activity-template catalogue")
    return copy.deepcopy(catalogue)


def _template_entry(template_id: str) -> dict[str, Any]:
    """Resolve one exact template identifier."""
    matches = [item for item in list_templates()["templates"] if item.get("id") == template_id]
    if len(matches) != 1:
        raise ValueError(f"Unknown activity template: {template_id}")
    return matches[0]


def _load_context(context_path: Path) -> dict[str, Any]:
    """Load and fail closed on a public operator context."""
    context = _read_json(context_path.resolve())
    _validate_current_public_context(context)
    scene_id = context.get("scene", {}).get("id")
    if context.get("schema") != "studium/operator-context/v1" or not isinstance(scene_id, str):
        raise ValueError("Expected a public Studium operator context with a scene ID")
    if not scene_id.strip() or len(scene_id) > 240:
        raise ValueError("Public scene ID must be nonblank and at most 240 characters")
    return context


def _validate_current_public_context(context: dict[str, Any]) -> None:
    """Accept the current typed journal descriptor beside the shared public projection."""
    checked = copy.deepcopy(context)
    exploration = checked.get("exploration")
    journal = exploration.pop("journal", None) if isinstance(exploration, dict) else None
    validate_public_fields(checked)
    if journal is None:
        return
    fields = {"record_tool", "read_tool", "file", "snapshot", "sequence", "instructions"}
    journal = _require_exact_keys(journal, fields, "public journal descriptor")
    if not all(isinstance(journal[field], str) for field in fields - {"sequence"}):
        raise ValueError("Public journal descriptor fields must be text")
    if not isinstance(journal["sequence"], list) or not all(isinstance(item, str) for item in journal["sequence"]):
        raise ValueError("Public journal sequence must be text")


def _load_config(entry: dict[str, Any], config_path: Path | None) -> tuple[dict[str, Any], Path]:
    """Load the selected sample or an explicit public activity config."""
    selected = config_path.resolve() if config_path else (TEMPLATE_ROOT / entry["sample_config"]).resolve()
    config = _read_json(selected)
    if config.get("schema") != CONFIG_SCHEMA or config.get("template_id") != entry["id"]:
        raise ValueError("Activity config does not match the selected template")
    return config, selected


def _require_strings(config: dict[str, Any], field: str) -> list[str]:
    """Return a non-empty array of non-empty strings."""
    values = config.get(field)
    if not isinstance(values, list) or not values or not all(isinstance(v, str) and v.strip() for v in values):
        raise ValueError(f"Activity config requires non-empty {field}")
    return values


def _require_exact_keys(value: object, expected: set[str], label: str) -> dict[str, Any]:
    """Reject missing and unknown keys in a public activity object."""
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    missing, unknown = expected - value.keys(), value.keys() - expected
    if missing:
        raise ValueError(f"{label} missing fields: {', '.join(sorted(missing))}")
    if unknown:
        raise ValueError(f"{label} has unknown fields: {', '.join(sorted(unknown))}")
    return value


def _validate_source(source: object, data_status: str) -> None:
    """Validate one explicitly classified public source description."""
    fields = {"id", "title", "locator", "source_kind", "statement"}
    source = _require_exact_keys(source, fields, "source")
    if not isinstance(source["id"], str) or not ID_PATTERN.fullmatch(source["id"]):
        raise ValueError("Source ID must be a bounded ASCII identifier")
    for field in ("title", "locator", "statement"):
        if not isinstance(source[field], str) or not source[field].strip():
            raise ValueError(f"Source {field} must be nonblank text")
    expected_kind = "synthetic_fixture" if data_status == "synthetic teaching fixture" else "supplied_evidence"
    if source["source_kind"] != expected_kind:
        raise ValueError(f"Source kind must be {expected_kind} for data status {data_status}")


def _validate_checks(checks: object) -> None:
    """Validate unique expected-check descriptions without treating them as results."""
    if not isinstance(checks, list) or not checks:
        raise ValueError("Activity config requires independent checks")
    ids: list[str] = []
    for check in checks:
        item = _require_exact_keys(check, {"id", "description"}, "independent check")
        if not isinstance(item["id"], str) or not ID_PATTERN.fullmatch(item["id"]) or not isinstance(item["description"], str) or not item["description"].strip():
            raise ValueError("Each independent check needs a valid ID and description")
        ids.append(item["id"])
    if len(ids) != len(set(ids)):
        raise ValueError("Independent check IDs must be unique")


def _validate_common_config(config: dict[str, Any]) -> None:
    """Validate the fields shared by all runnable activity configs."""
    if config.get("schema") != CONFIG_SCHEMA or not isinstance(config.get("template_id"), str):
        raise ValueError("Activity config schema and template ID are invalid")
    for field in ("data_status", "scope", "prediction_prompt"):
        if not isinstance(config.get(field), str) or not config[field]:
            raise ValueError(f"Activity config requires {field}")
    if config["data_status"] not in DATA_STATUSES:
        raise ValueError("Data status must identify a synthetic fixture or supplied source-backed data")
    _require_strings(config, "expected_source_inputs")
    _validate_checks(config.get("independent_checks"))
    _validate_source(config.get("source"), config["data_status"])


def _validate_parameter(parameter: object) -> dict[str, Any]:
    """Validate one finite bounded numerical control."""
    fields = {"id", "label", "unit", "min", "max", "step", "baseline", "variation"}
    parameter = _require_exact_keys(parameter, fields, "parameter")
    if not isinstance(parameter["id"], str) or not ID_PATTERN.fullmatch(parameter["id"]):
        raise ValueError("Activity config requires a valid parameter")
    if not all(isinstance(parameter[field], str) and parameter[field].strip() for field in ("label", "unit")):
        raise ValueError("Parameter label and unit must be nonblank text")
    numbers = [parameter.get(key) for key in ("min", "max", "step", "baseline", "variation")]
    if not all(_is_finite_number(value) for value in numbers):
        raise ValueError("Parameter bounds and values must be finite numeric values")
    minimum, maximum, step, baseline, variation = numbers
    if step <= 0 or minimum >= maximum or not minimum <= baseline <= maximum or not minimum <= variation <= maximum:
        raise ValueError("Parameter values fall outside their declared bounds")
    if not all(_is_step_aligned(value, minimum, step) for value in (baseline, variation)):
        raise ValueError("Parameter baseline and variation must align with the declared step")
    return parameter


def _is_step_aligned(value: float, minimum: float, step: float) -> bool:
    """Return whether a range value lies on its finite step grid."""
    try:
        offset = (value - minimum) / step
    except OverflowError:
        return False
    if not math.isfinite(offset):
        return False
    return math.isclose(offset, round(offset), rel_tol=0, abs_tol=1e-9)


def _run_linked_core(network: dict[str, Any], parameter: dict[str, Any]) -> dict[str, int]:
    """Validate and calculate the network with the existing checked JavaScript core."""
    script = """import {pathToFileURL} from 'node:url';
const core=await import(pathToFileURL(process.argv[1]).href);
const network=JSON.parse(await new Promise(resolve=>{let value='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>value+=chunk);process.stdin.on('end',()=>resolve(value));}));
core.validateNetwork(network);
const baseline=core.calculateNetwork(network,Number(process.argv[2]));
const variation=core.calculateNetwork(network,Number(process.argv[3]));
console.log(JSON.stringify({baseline_edge_count:baseline.visible_edges.length,variation_edge_count:variation.visible_edges.length,node_count:baseline.node_ids.length}));"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(LINKED_CORE_PATH), str(parameter["baseline"]), str(parameter["variation"])],
        input=json.dumps(network), text=True, capture_output=True, check=False,
    )
    if result.returncode != 0:
        raise ValueError(f"Linked network rejected by checked numeric core: {result.stderr.strip()}")
    return json.loads(result.stdout)


def _load_linked_network(config: dict[str, Any], config_path: Path) -> dict[str, Any]:
    """Resolve the checked linked network used by the sample config."""
    relative = config.get("network_file")
    if not isinstance(relative, str) or Path(relative).is_absolute():
        raise ValueError("Linked config requires a relative network_file")
    network_path = (config_path.parent / relative).resolve()
    network = _read_json(network_path)
    _validate_linked_network_shape(network)
    actual = _run_linked_core(network, config["parameter"])
    if actual != config["oracle"]:
        raise ValueError(f"Linked network oracle mismatch: expected {config['oracle']}, observed {actual}")
    return network


def _validate_linked_network_shape(network: dict[str, Any]) -> None:
    """Close every nested linked-network field before browser embedding."""
    fields = {"schema", "note", "focal_id", "fragment_tol_da", "baseline_threshold", "threshold_presets", "nodes", "candidates", "generation_brief"}
    _require_exact_keys(network, fields, "linked network")
    if network["schema"] != "studium/linked-spectrum-network/v1":
        raise ValueError("Linked network schema is invalid")
    if not all(isinstance(network[field], str) for field in ("note", "focal_id")):
        raise ValueError("Linked network note and focal ID must be text")
    for preset in network["threshold_presets"]:
        item = _require_exact_keys(preset, {"id", "label", "value"}, "threshold preset")
        if not isinstance(item["id"], str) or not ID_PATTERN.fullmatch(item["id"]) or not isinstance(item["label"], str):
            raise ValueError("Threshold presets require public IDs and labels")
        if not _is_finite_number(item["value"]):
            raise ValueError("Threshold preset values must be finite")
    _validate_linked_nodes(network.get("nodes"))
    _validate_linked_candidates(network.get("candidates"))
    _validate_generation_brief(network.get("generation_brief"))


def _validate_linked_nodes(nodes: object) -> None:
    """Validate the exact public spectrum fields used by the viewer."""
    if not isinstance(nodes, list):
        raise ValueError("Linked network nodes must be an array")
    for node in nodes:
        item = _require_exact_keys(node, {"id", "label", "role", "precursor_mz", "peaks"}, "linked node")
        if not isinstance(item["id"], str) or not ID_PATTERN.fullmatch(item["id"]):
            raise ValueError("Linked node IDs must be bounded ASCII")
        if not all(isinstance(item[field], str) for field in ("label", "role")):
            raise ValueError("Linked node labels and roles must be text")


def _validate_linked_candidates(candidates: object) -> None:
    """Validate the exact candidate fields shown in the linked table."""
    if not isinstance(candidates, list):
        raise ValueError("Linked network candidates must be an array")
    fields = {"node_id", "candidate", "formula", "scope"}
    for candidate in candidates:
        item = _require_exact_keys(candidate, fields, "linked candidate")
        if not isinstance(item["node_id"], str) or not ID_PATTERN.fullmatch(item["node_id"]):
            raise ValueError("Linked candidate node ID is invalid")
        if not all(isinstance(item[field], str) for field in fields - {"node_id"}):
            raise ValueError("Linked candidate display fields must be text")


def _validate_generation_brief(brief: object) -> None:
    """Validate known linked-fixture metadata without accepting arbitrary objects."""
    fields = {"id", "learning_goal", "inputs", "reference_calculation", "allowed_parameters", "hidden_information", "cross_view_questions", "learner_sequence", "export_policy"}
    item = _require_exact_keys(brief, fields, "generation brief")
    for field in ("id", "learning_goal", "reference_calculation", "export_policy"):
        if not isinstance(item[field], str):
            raise ValueError("Generation brief scalar fields must be text")
    for field in ("inputs", "allowed_parameters", "hidden_information", "cross_view_questions", "learner_sequence"):
        if not isinstance(item[field], list) or not all(isinstance(value, str) for value in item[field]):
            raise ValueError("Generation brief list fields must contain text")


def _materialize_config(config: dict[str, Any], config_path: Path) -> dict[str, Any]:
    """Validate template-specific fields and inline checked public inputs."""
    _validate_common_config(config)
    template_id = config["template_id"]
    if template_id == "linked-representations":
        _require_exact_keys(config, COMMON_CONFIG_FIELDS | {"network_file", "parameter", "oracle"}, "linked config")
        _validate_parameter(config.get("parameter"))
        _validate_oracle(config.get("oracle"), {"baseline_edge_count", "variation_edge_count", "node_count"}, integer=True)
        if config["data_status"] != "synthetic teaching fixture":
            raise ValueError("The checked linked-spectrum core requires explicitly synthetic data")
        result = copy.deepcopy(config)
        result["network"] = _load_linked_network(config, config_path)
        result.pop("network_file", None)
    elif template_id == "parameter-comparison":
        _require_exact_keys(config, COMMON_CONFIG_FIELDS | {"parameter", "model", "oracle", "control"}, "parameter config")
        _validate_parameter(config.get("parameter"))
        _validate_comparison(config)
        result = copy.deepcopy(config)
    elif template_id == "evidence-claim":
        _require_exact_keys(config, COMMON_CONFIG_FIELDS | {"claims", "supported_claim_id", "feedback"}, "evidence config")
        _validate_claim_config(config)
        result = copy.deepcopy(config)
    elif template_id == "diagnose-analysis":
        fields = {"steps", "repairs", "flawed_result", "result_unit", "supported_repair_id", "oracle"}
        _require_exact_keys(config, COMMON_CONFIG_FIELDS | fields, "diagnosis config")
        _validate_diagnosis_config(config)
        result = copy.deepcopy(config)
    elif template_id == "conclusion-robustness":
        fields = {"scenarios", "baseline_scenario_id", "metric", "decision", "oracle"}
        _require_exact_keys(config, COMMON_CONFIG_FIELDS | fields, "robustness config")
        _validate_robustness_config(config)
        result = copy.deepcopy(config)
    else:
        raise ValueError(f"Unsupported ready template: {template_id}")
    return result


def _validate_oracle(oracle: object, fields: set[str], integer: bool = False) -> None:
    """Validate a closed finite numerical oracle."""
    oracle = _require_exact_keys(oracle, fields, "oracle")
    for value in oracle.values():
        valid_type = isinstance(value, int) and not isinstance(value, bool) if integer else _is_finite_number(value)
        if not valid_type or not _is_finite_number(value):
            raise ValueError("Oracle values must be finite numbers of the declared type")


def _validate_comparison(config: dict[str, Any]) -> None:
    """Validate a linear controlled model against its exact numerical oracle."""
    model_fields = {"kind", "fixed_input", "input_label", "input_unit", "output_label", "output_unit", "equation"}
    model = _require_exact_keys(config.get("model"), model_fields, "comparison model")
    if model["kind"] != "linear_gain" or not _is_finite_number(model["fixed_input"]):
        raise ValueError("Comparison model must be a finite linear_gain fixture")
    if not all(isinstance(model[key], str) and model[key].strip() for key in model_fields - {"fixed_input"}):
        raise ValueError("Comparison model labels and equation must be nonblank text")
    _validate_oracle(config.get("oracle"), {"baseline_output", "variation_output", "delta"})
    parameter, oracle = config["parameter"], config["oracle"]
    expected = {"baseline_output": parameter["baseline"] * model["fixed_input"], "variation_output": parameter["variation"] * model["fixed_input"]}
    expected["delta"] = expected["variation_output"] - expected["baseline_output"]
    if any(not math.isclose(oracle[key], value, rel_tol=0, abs_tol=1e-12) for key, value in expected.items()):
        raise ValueError("Comparison oracle does not match the declared model")
    if not isinstance(config.get("control"), str) or not config["control"].strip():
        raise ValueError("Comparison config requires a nonblank control statement")


def _validate_claim_config(config: dict[str, Any]) -> None:
    """Validate the source-backed choice used by the evidence template."""
    claims = config.get("claims")
    if not isinstance(claims, list) or len(claims) < 2:
        raise ValueError("Evidence activity requires at least two claims")
    for claim in claims:
        _require_exact_keys(claim, {"id", "text"}, "claim")
        if not isinstance(claim["id"], str) or not ID_PATTERN.fullmatch(claim["id"]) or not isinstance(claim["text"], str) or not claim["text"].strip():
            raise ValueError("Claims require a valid ID and nonblank text")
    claim_ids = [claim["id"] for claim in claims]
    if len(claim_ids) != len(claims) or len(set(claim_ids)) != len(claim_ids):
        raise ValueError("Evidence claims require unique IDs")
    if config.get("supported_claim_id") not in claim_ids:
        raise ValueError("Supported claim must reference a supplied claim")
    if not isinstance(config.get("feedback"), str) or not config["feedback"].strip():
        raise ValueError("Evidence activity requires nonblank feedback")


def _require_choice_source_id(value: object, prefix: str, label: str) -> str:
    """Validate a config ID and its emitted trace choice identifier."""
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise ValueError(f"{label} ID must be a bounded ASCII identifier")
    if len(prefix) + len(value) > CHOICE_ID_MAX_LENGTH:
        raise ValueError(f"{label} choice ID exceeds {CHOICE_ID_MAX_LENGTH} characters")
    return value


def _is_finite_number(value: object) -> bool:
    """Return whether a value is a finite JSON number rather than a boolean."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _validate_diagnosis_steps(steps: object) -> list[str]:
    """Validate the closed ordered analysis steps."""
    if not isinstance(steps, list) or len(steps) < 2:
        raise ValueError("Diagnosis activity requires at least two steps")
    ids: list[str] = []
    for step in steps:
        item = _require_exact_keys(step, {"id", "label", "description"}, "diagnosis step")
        ids.append(_require_choice_source_id(item["id"], "step_", "step"))
        if not all(isinstance(item[field], str) and item[field].strip() for field in ("label", "description")):
            raise ValueError("Each diagnosis step needs a nonblank label and description")
    if len(ids) != len(set(ids)):
        raise ValueError("Diagnosis step IDs must be unique")
    return ids


def _validate_diagnosis_repairs(repairs: object) -> tuple[list[str], dict[str, float]]:
    """Validate supplied repair descriptions and captured finite results."""
    if not isinstance(repairs, list) or len(repairs) < 2:
        raise ValueError("Diagnosis activity requires at least two repairs")
    results: dict[str, float] = {}
    for repair in repairs:
        item = _require_exact_keys(repair, {"id", "label", "explanation", "result"}, "diagnosis repair")
        repair_id = _require_choice_source_id(item["id"], "repair_", "repair")
        if repair_id in results:
            raise ValueError("Diagnosis repair IDs must be unique")
        if not all(isinstance(item[field], str) and item[field].strip() for field in ("label", "explanation")):
            raise ValueError("Each diagnosis repair needs a nonblank label and explanation")
        if not _is_finite_number(item["result"]):
            raise ValueError("Diagnosis repair results must be finite numbers")
        results[repair_id] = item["result"]
    return list(results), results


def _validate_diagnosis_config(config: dict[str, Any]) -> None:
    """Validate captured diagnosis choices and their supplied teaching oracle."""
    _validate_diagnosis_steps(config.get("steps"))
    repair_ids, results = _validate_diagnosis_repairs(config.get("repairs"))
    if not _is_finite_number(config.get("flawed_result")):
        raise ValueError("Diagnosis flawed result must be a finite number")
    if not isinstance(config.get("result_unit"), str) or not config["result_unit"].strip():
        raise ValueError("Diagnosis result unit must be nonblank text")
    supported = config.get("supported_repair_id")
    if supported not in repair_ids:
        raise ValueError("Supported repair must reference a supplied repair")
    oracle = _require_exact_keys(config.get("oracle"), {"repaired_result"}, "diagnosis oracle")
    if not _is_finite_number(oracle["repaired_result"]):
        raise ValueError("Diagnosis oracle repaired result must be finite")
    if oracle["repaired_result"] != results[supported]:
        raise ValueError("Diagnosis oracle must match the supported repair result")


def _validate_robustness_scenarios(scenarios: object) -> tuple[list[str], list[float]]:
    """Validate supplied assumption scenarios and captured values."""
    if not isinstance(scenarios, list) or len(scenarios) < 2:
        raise ValueError("Robustness activity requires at least two scenarios")
    ids: list[str] = []
    values: list[float] = []
    for scenario in scenarios:
        item = _require_exact_keys(scenario, {"id", "label", "assumption", "value"}, "robustness scenario")
        ids.append(_require_choice_source_id(item["id"], "scenario_", "scenario"))
        if not all(isinstance(item[field], str) and item[field].strip() for field in ("label", "assumption")):
            raise ValueError("Each robustness scenario needs a nonblank label and assumption")
        if not _is_finite_number(item["value"]):
            raise ValueError("Robustness scenario values must be finite numbers")
        values.append(item["value"])
    if len(ids) != len(set(ids)):
        raise ValueError("Robustness scenario IDs must be unique")
    return ids, values


def _validate_metric(metric: object) -> None:
    """Validate the displayed metric without accepting extra semantics."""
    item = _require_exact_keys(metric, {"label", "unit"}, "robustness metric")
    if not all(isinstance(item[field], str) and item[field].strip() for field in ("label", "unit")):
        raise ValueError("Robustness metric label and unit must be nonblank text")


def _validate_decision(decision: object) -> dict[str, Any]:
    """Validate one closed finite threshold decision."""
    item = _require_exact_keys(decision, {"operator", "threshold", "claim"}, "robustness decision")
    if not isinstance(item["operator"], str) or item["operator"] not in {"gte", "lte"}:
        raise ValueError("Robustness decision operator must be gte or lte")
    if not _is_finite_number(item["threshold"]):
        raise ValueError("Robustness decision threshold must be finite")
    if not isinstance(item["claim"], str) or not item["claim"].strip():
        raise ValueError("Robustness decision claim must be nonblank text")
    return item


def _validate_robustness_config(config: dict[str, Any]) -> None:
    """Validate scenario-limited threshold support against the exact oracle."""
    scenario_ids, values = _validate_robustness_scenarios(config.get("scenarios"))
    if config.get("baseline_scenario_id") not in scenario_ids:
        raise ValueError("Baseline scenario must reference a supplied scenario")
    _validate_metric(config.get("metric"))
    decision = _validate_decision(config.get("decision"))
    oracle = _require_exact_keys(config.get("oracle"), {"supporting_scenario_ids"}, "robustness oracle")
    supporting_ids = oracle["supporting_scenario_ids"]
    if not isinstance(supporting_ids, list):
        raise ValueError("Robustness oracle supporting scenario IDs must be an array")
    if not all(isinstance(item, str) and item in scenario_ids for item in supporting_ids):
        raise ValueError("Robustness oracle IDs must reference supplied scenarios")
    compare = (lambda value: value >= decision["threshold"]) if decision["operator"] == "gte" else (lambda value: value <= decision["threshold"])
    expected = [scenario_id for scenario_id, value in zip(scenario_ids, values) if compare(value)]
    if supporting_ids != expected:
        raise ValueError("Robustness oracle must match the finite scenario comparison")


def _activity_document(entry: dict[str, Any], context: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    """Create the public activity document embedded in the local viewer."""
    scene = context["scene"]
    activity_id = f"activity_{uuid.uuid4().hex}"
    document = {
        "schema": ACTIVITY_SCHEMA,
        "activity_id": activity_id,
        "template_id": entry["id"],
        "template_version": entry["version"],
        "scene_id": scene["id"],
        "scene": {key: scene[key] for key in ("title", "objective_refs") if key in scene},
        "data_status": config["data_status"],
        "learning_goal": entry["learning_goal"],
        "scope": config["scope"],
        "prediction_prompt": config["prediction_prompt"],
        "expected_source_inputs": config["expected_source_inputs"],
        "independent_checks": config["independent_checks"],
        "config": config,
    }
    if entry["id"] == "linked-representations":
        document["engine"] = {
            "module": str(LINKED_CORE_PATH.relative_to(ROOT)),
            "sha256": _sha256(LINKED_CORE_PATH.read_bytes()),
        }
    return document


def _validate_materialized_config(config: dict[str, Any]) -> None:
    """Validate the closed config embedded in a prepared activity."""
    _validate_common_config(config)
    template_id = config.get("template_id")
    if template_id == "linked-representations":
        _require_exact_keys(config, COMMON_CONFIG_FIELDS | {"network", "parameter", "oracle"}, "linked config")
        _validate_parameter(config.get("parameter")); _validate_oracle(config.get("oracle"), {"baseline_edge_count", "variation_edge_count", "node_count"}, integer=True)
        _validate_linked_network_shape(config.get("network"))
        if _run_linked_core(config.get("network"), config["parameter"]) != config["oracle"]:
            raise ValueError("Prepared linked network does not match its oracle")
    elif template_id == "parameter-comparison":
        _require_exact_keys(config, COMMON_CONFIG_FIELDS | {"parameter", "model", "oracle", "control"}, "parameter config")
        _validate_parameter(config.get("parameter")); _validate_comparison(config)
    elif template_id == "evidence-claim":
        _require_exact_keys(config, COMMON_CONFIG_FIELDS | {"claims", "supported_claim_id", "feedback"}, "evidence config"); _validate_claim_config(config)
    elif template_id == "diagnose-analysis":
        fields = {"steps", "repairs", "flawed_result", "result_unit", "supported_repair_id", "oracle"}
        _require_exact_keys(config, COMMON_CONFIG_FIELDS | fields, "diagnosis config")
        _validate_diagnosis_config(config)
    elif template_id == "conclusion-robustness":
        fields = {"scenarios", "baseline_scenario_id", "metric", "decision", "oracle"}
        _require_exact_keys(config, COMMON_CONFIG_FIELDS | fields, "robustness config")
        _validate_robustness_config(config)
    else:
        raise ValueError("Prepared activity uses an unsupported template")


def validate_prepared_activity(value: object) -> dict[str, Any]:
    """Validate and return a detached, closed public prepared-activity document."""
    common = {"schema", "activity_id", "template_id", "template_version", "scene_id", "scene", "data_status", "learning_goal", "scope", "prediction_prompt", "expected_source_inputs", "independent_checks", "config"}
    if not isinstance(value, dict):
        raise ValueError("Prepared activity must be an object")
    fields = common | ({"engine"} if value.get("template_id") == "linked-representations" else set())
    document = _require_exact_keys(value, fields, "prepared activity")
    ids = (document["activity_id"], document["template_id"])
    if document["schema"] != ACTIVITY_SCHEMA or not all(isinstance(item, str) and ID_PATTERN.fullmatch(item) for item in ids):
        raise ValueError("Prepared activity schema or IDs are invalid")
    if not isinstance(document["template_version"], str) or not document["template_version"].strip() or len(document["template_version"]) > 80:
        raise ValueError("Prepared activity version is invalid")
    if not isinstance(document["scene_id"], str) or not document["scene_id"].strip() or len(document["scene_id"]) > 240:
        raise ValueError("Prepared activity scene ID is invalid")
    scene = document["scene"]
    if not isinstance(scene, dict) or not scene.keys() <= {"title", "objective_refs"}:
        raise ValueError("Prepared activity scene has unknown fields")
    if "title" in scene and not isinstance(scene["title"], str):
        raise ValueError("Prepared activity scene title must be text")
    if "objective_refs" in scene and (
        not isinstance(scene["objective_refs"], list)
        or not all(isinstance(item, str) for item in scene["objective_refs"])
    ):
        raise ValueError("Prepared activity objective refs must be text")
    for field in ("data_status", "learning_goal", "scope", "prediction_prompt"):
        if not isinstance(document[field], str) or not document[field].strip():
            raise ValueError(f"Prepared activity {field} must be nonblank text")
    _require_strings(document, "expected_source_inputs")
    _validate_checks(document["independent_checks"])
    _validate_materialized_config(document["config"])
    config = document["config"]
    bound_fields = ("data_status", "scope", "prediction_prompt", "expected_source_inputs", "independent_checks")
    if config["template_id"] != document["template_id"] or any(config[field] != document[field] for field in bound_fields):
        raise ValueError("Prepared activity config binding is inconsistent")
    entry = _template_entry(document["template_id"])
    if document["template_version"] != entry["version"] or document["learning_goal"] != entry["learning_goal"]:
        raise ValueError("Prepared activity catalogue binding is inconsistent")
    if document["template_id"] == "linked-representations":
        engine = _require_exact_keys(document["engine"], {"module", "sha256"}, "engine")
        expected_module = str(LINKED_CORE_PATH.relative_to(ROOT))
        if engine["module"] != expected_module or engine["sha256"] != _sha256(LINKED_CORE_PATH.read_bytes()):
            raise ValueError("Prepared activity engine does not match the checked local core")
    return copy.deepcopy(document)


def activity_digest(value: object) -> str:
    """Bind a trace to every validated byte-equivalent prepared-activity field."""
    return _sha256(_canonical_bytes(validate_prepared_activity(value)))


def _safe_script_json(value: object) -> str:
    """Serialize data for an inline script without creating an HTML end tag."""
    return json.dumps(value, ensure_ascii=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def _render_viewer(activity: dict[str, Any], presentation: dict[str, Any] | None = None) -> str:
    """Render the shared local viewer and inject the checked linked core once."""
    template = VIEWER_PATH.read_text(encoding="utf-8").replace(
        "/* STUDIUM_THEME */", THEME_PATH.read_text(encoding="utf-8")
    )
    presentation = presentation or load_presentation()
    language_script = (ROOT / "ui/activity-language.mjs").read_text().replace("export ", "")
    support_script = ""
    if presentation["render_assets"] or re.search(r"\\[([]|\$\$", json.dumps(activity)):
        built = ROOT / "packages/activity-presentation/dist/support.js"
        if not built.is_file():
            raise ValueError("Build local renderers first: pnpm --filter @studium/activity-presentation build")
        support_script = built.read_text().replace("</script", "<\\/script")
    template = template.replace("/* PRESENTATION_LIBRARIES */", language_script + "\n" + support_script)
    template = template.replace("/* PRESENTATION_DATA */", "const PRESENTATION = " + _safe_script_json(presentation) + ";")
    linked_core = LINKED_CORE_PATH.read_text(encoding="utf-8").replace("export ", "")
    data = f"const ACTIVITY = {_safe_script_json(activity)};\nconst ACTIVITY_SHA256 = \"{activity_digest(activity)}\";"
    return add_contextual_help(template.replace("/* LINKED_CORE */", linked_core).replace("/* ACTIVITY_DATA */", data))


def _task_markdown(activity: dict[str, Any], output_dir: Path) -> str:
    """Build the editable human/harness task for one prepared activity."""
    sources = "\n".join(f"- {item}" for item in activity["expected_source_inputs"])
    checks = "\n".join(f"- `{item['id']}` — {item['description']}" for item in activity["independent_checks"])
    return f"""# {activity['learning_goal']}

Template: `{activity['template_id']}` v{activity['template_version']}

Activity: `{activity['activity_id']}`

Scene: `{activity['scene_id']}`
Status: local draft built from public context; teacher review is still required.

## Scope

{activity['scope']}

## Learner sequence

Ask the learner for their own prediction before revealing results. Let them inspect the supplied results, use the exposed controls or choices, record an optional observation and conclusion, then export only when they choose. Do not answer for the learner or infer missing events.

## Explain the method

The viewer's question-mark controls explain the purpose, student action, teacher rationale,
limits and project source. Reuse `ui/context-help.json` for chat or custom viewers,
in the learner's requested language. Give a brief explanation at first use and expand
on request; never reveal an expected result to explain the method. Reading this help
does not create a learner event. See `docs/learn/language-and-supports.md`.

## Expected source inputs

{sources}

## Independent checks

{checks}

## Local artifacts and report handoff

Open `index.html` locally. Its explicit **Export activity trace** control downloads a partial trace; **Complete and export final trace** adds the final completion event. The page makes no network request and persists nothing automatically. Save the selected download as `LEARNER_ACTIONS.json`, then run:

```sh
.venv/bin/python tools/learner_report.py export {output_dir.resolve()}-report --actions LEARNER_ACTIONS.json --activity {output_dir.resolve()}/activity.json
.venv/bin/python tools/learner_report.py verify {output_dir.resolve()}-report
```

See `docs/learn/learner-report.md` for optional journal and original-text choices. Report sharing and student release remain separate explicit decisions.
"""


def _write_outputs(output_dir: Path, activity: dict[str, Any], context: dict[str, Any], config_path: Path, presentation: dict[str, Any]) -> PreparedActivity:
    """Create a new activity directory after all inputs have validated."""
    validate_prepared_activity(activity)
    viewer_html = _render_viewer(activity, presentation)
    output_dir.mkdir()
    activity_path, viewer_path, task_path = (output_dir / name for name in ("activity.json", "index.html", "task.md"))
    activity_path.write_text(json.dumps(activity, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    viewer_path.write_text(viewer_html, encoding="utf-8")
    task_path.write_text(_task_markdown(activity, output_dir), encoding="utf-8")
    (output_dir / "learner-actions.schema.json").write_text(json.dumps(activity_json_schema(), indent=2) + "\n", encoding="utf-8")
    if presentation != load_presentation():
        (output_dir / "presentation.json").write_text(json.dumps(presentation, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    provenance = {
        "presentation_sha256": _sha256(_canonical_bytes(presentation)),
        "schema": "studium/prepared-activity-provenance/v1",
        "context_sha256": _sha256(_canonical_bytes(context)),
        "config_sha256": _sha256(config_path.read_bytes()),
        "generator_sha256": _sha256(Path(__file__).read_bytes()),
        "viewer_sha256": _sha256(viewer_path.read_bytes()),
        "scientific_validation": "not_run; listed independent checks remain expected checks",
        "learning_assessment": "none",
        "student_release": "not approved by preparation",
    }
    (output_dir / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    return PreparedActivity(output_dir, activity_path, viewer_path, task_path)


def prepare_activity(template_id: str, context_path: Path, output_dir: Path, config_path: Path | None = None, *, language: str = "en", translations_path: Path | None = None, supports_path: Path | None = None) -> PreparedActivity:
    """Prepare one ready activity from checked public context into a new directory."""
    entry = _template_entry(template_id)
    if entry["status"] != "ready":
        raise ValueError(f"Template {template_id} is proposed and cannot be prepared")
    output_dir = output_dir.resolve()
    if output_dir.exists():
        raise FileExistsError(output_dir)
    context = _load_context(context_path)
    config, selected_config = _load_config(entry, config_path)
    activity = _activity_document(entry, context, _materialize_config(config, selected_config))
    presentation = load_presentation(language=language, translations_path=translations_path, supports_path=supports_path)
    return _write_outputs(output_dir, activity, context, selected_config, presentation)


def _parser() -> argparse.ArgumentParser:
    """Create the command-line parser."""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    listing = commands.add_parser("list", help="list ready and proposed templates")
    listing.add_argument("--json", action="store_true", help="print the complete JSON catalogue")
    prepare = commands.add_parser("prepare", help="prepare a ready template into a new local directory")
    prepare.add_argument("--template", required=True)
    prepare.add_argument("--context", required=True, type=Path)
    prepare.add_argument("--out", required=True, type=Path)
    prepare.add_argument("--config", type=Path, help="optional explicit public config matching the template")
    prepare.add_argument("--language", default="en", help="initial presentation language (BCP47)")
    prepare.add_argument("--translations", type=Path, help="local language-to-text translation dictionaries")
    prepare.add_argument("--supports", type=Path, help="optional local RenderAsset support manifest")
    return parser


def main(argv: list[str] | None = None) -> int:
    """List templates or prepare one local activity."""
    args = _parser().parse_args(argv)
    try:
        if args.command == "list":
            catalogue = list_templates()
            if args.json:
                print(json.dumps(catalogue, indent=2))
            else:
                for item in catalogue["templates"]:
                    print(f"{item['id']}\t{item['status']}\tv{item['version']}\t{item['title']}")
            return 0
        prepared = prepare_activity(args.template, args.context, args.out, args.config, language=args.language, translations_path=args.translations, supports_path=args.supports)
        print(prepared.output_dir)
        return 0
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"activity templates: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
