"""Presentation stays separate from scientific identity and learner authorship."""
import json
from pathlib import Path
import pytest
from experience_templates import prepare_activity
from activity_presentation import load_presentation


def test_language_and_translations_validate_before_preparation(tmp_path):
    translations = tmp_path / 'translations.json'
    translations.write_text(json.dumps({'fr': {'A claim': 'Une affirmation'}}))
    result = load_presentation(language='fr', translations_path=translations)
    assert result['language'] == 'fr'
    assert result['translations']['fr']['A claim'] == 'Une affirmation'
    with pytest.raises(ValueError, match='language'):
        load_presentation(language='<script>')
    with pytest.raises(ValueError, match='language'):
        load_presentation(language='en-a')
    assert load_presentation(language='FR-ca')['language'] == 'fr-CA'
    translations.write_text(json.dumps({'fr': {'id': {'unsafe': 'shape'}}}))
    with pytest.raises(ValueError, match='translation'):
        load_presentation(translations_path=translations)


def test_activity_preparation_packages_language_without_rewriting_source(tmp_path):
    context = tmp_path / 'context.json'
    context.write_text(json.dumps({'schema':'studium/operator-context/v1','session_id':'x',
        'scene':{'id':'scene_1','title':'Source','source_content':'Original'},'run_manifest':None}))
    result = prepare_activity('conclusion-robustness', context, tmp_path/'activity', language='fr')
    original = json.loads(result.activity_path.read_text())
    assert original['template_id'] == 'conclusion-robustness'
    presentation = json.loads((result.output_dir/'presentation.json').read_text())
    assert presentation['language'] == 'fr'
    provenance = json.loads((result.output_dir/'provenance.json').read_text())
    assert len(provenance['presentation_sha256']) == 64
    html = result.viewer_path.read_text()
    assert 'activityLanguage' in html and 'installActivityLanguage' in html
    assert 'const PRESENTATION' in html
