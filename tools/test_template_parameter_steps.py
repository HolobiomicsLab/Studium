"""Prevent native range controls from silently changing the prepared comparison."""
import copy
import json
from pathlib import Path

import pytest

from experience_templates import prepare_activity


@pytest.mark.parametrize('field', ['baseline', 'variation'])
def test_prepare_rejects_parameter_value_unreachable_by_slider(tmp_path: Path, field: str) -> None:
    """A Chrome range snaps 0.2 to 0.3 on a 0.3 grid; refuse that mismatch."""
    root = Path(__file__).resolve().parents[1]
    config = json.loads((root / 'examples/activity-templates/parameter-comparison/config.json').read_text())
    config['parameter'].update(min=0, max=1, step=0.3, baseline=0.3, variation=0.6)
    config['parameter'][field] = 0.2
    baseline = config['parameter']['baseline'] * config['model']['fixed_input']
    variation = config['parameter']['variation'] * config['model']['fixed_input']
    config['oracle'] = {'baseline_output': baseline, 'variation_output': variation, 'delta': variation - baseline}
    context = tmp_path / 'context.json'
    context.write_text(json.dumps({'schema': 'studium/operator-context/v1', 'scene': {'id': 'grid-check'}}))
    source = tmp_path / 'config.json'
    source.write_text(json.dumps(config))
    output = tmp_path / 'prepared'
    with pytest.raises(ValueError, match='step'):
        prepare_activity('parameter-comparison', context, output, source)
    assert not output.exists()


@pytest.mark.parametrize('values', [
    {'min': -1, 'max': 1, 'step': 0.3, 'baseline': -0.7, 'variation': -0.4},
    {'min': -0.001, 'max': 0.001, 'step': 0.0001, 'baseline': -0.0002, 'variation': 0},
    {'min': 0, 'max': 1, 'step': 0.1, 'baseline': 0.1 + 0.2, 'variation': 0.7},
])
def test_valid_fractional_parameter_steps_remain_usable(values: dict) -> None:
    """Negative offsets and floating arithmetic noise do not reject usable controls."""
    from experience_templates import _validate_parameter
    parameter = {'id': 'gain', 'label': 'Gain', 'unit': 'x', **values}
    original = copy.deepcopy(parameter)
    assert _validate_parameter(parameter) == original
    assert parameter == original
