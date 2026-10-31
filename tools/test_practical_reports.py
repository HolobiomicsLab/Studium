"""Prove the new teaching patterns use the existing trace/report contracts."""
import json
from pathlib import Path

import pytest

from experience_templates import activity_digest, prepare_activity
from learner_report import export_learner_report, verify_learner_report
from learner_trace import validate_trace_payload


@pytest.mark.parametrize('template_id', ['diagnose-analysis', 'conclusion-robustness'])
def test_captured_judgments_roundtrip_through_common_report(tmp_path: Path, template_id: str) -> None:
    """Declared test choices stay traceable without including learner prose by default."""
    context = tmp_path / 'context.json'
    context.write_text(json.dumps({'schema': 'studium/operator-context/v1', 'session_id': 'synthetic-test',
        'scene': {'id': 'scène_rapport', 'title': 'Synthetic review test', 'objective_refs': []}, 'run_manifest': None}))
    prepared = prepare_activity(template_id, context, tmp_path / 'activity')
    activity = json.loads(prepared.activity_path.read_text())
    config = activity['config']
    choices = (['step_' + config['steps'][0]['id'], 'repair_' + config['repairs'][-1]['id']]
               if template_id == 'diagnose-analysis' else ['scenario_' + config['scenarios'][-1]['id']])
    entries = [('activity_started', {}), ('learner_text_submitted', {'phase': 'prediction', 'text': 'Synthetic private prediction'}),
        ('results_revealed', {}), *[('learner_choice_selected', {'choice_id': choice}) for choice in choices], ('activity_completed', {})]
    trace = {key: activity[key] for key in ('activity_id', 'template_id', 'template_version', 'scene_id')}
    trace.update(schema='studium/learner-actions/v1', activity_sha256=activity_digest(activity), events=[
        {'sequence': index, 'recorded_at': f'2026-09-11T10:00:{index:02d}Z', 'actor': 'learner',
         'origin': 'browser_observed', 'kind': kind, 'data': data} for index, (kind, data) in enumerate(entries, 1)])
    validate_trace_payload(trace)
    path = tmp_path / 'actions.json'
    path.write_text(json.dumps(trace))
    report = export_learner_report(path, tmp_path / 'report', activity_path=prepared.activity_path)
    verify_learner_report(report)
    captured = json.loads((report / 'sources/learner-actions.json').read_text())
    assert [event['data']['choice_id'] for event in captured['events'] if event['kind'] == 'learner_choice_selected'] == choices
    assert 'Synthetic private prediction' not in (report / 'index.html').read_text()
