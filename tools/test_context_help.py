"""Contextual explanations stay generic, bilingual and compatible with old reports."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from contextual_help import help_tip, help_assets, load_catalogue
from learner_report import export_learner_report, verify_learner_report, ReportError
from test_learner_report import journal, write_json
from test_report_theme import _rehash_html

ROOT = Path(__file__).resolve().parents[1]


def test_catalogue_has_explained_roles_and_real_project_sources():
    catalogue = load_catalogue()
    assert catalogue['schema'] == 'studium/context-help/v1'
    for topic in catalogue['topics'].values():
        assert (ROOT / topic['source']).is_file()
        for locale in ('en', 'fr'):
            assert all(topic[locale][field].strip() for field in
                       ('title', 'what', 'student', 'teacher', 'objective', 'limit', 'method'))


def test_native_help_is_bilingual_passive_and_contextually_named():
    value = help_tip('prediction')
    assert '<details' in value and '<summary' in value
    assert 'About: Prediction' in value and 'Prédiction' in value
    assert 'data-help-topic="prediction"' in value
    assert 'For students' in value and 'For teachers' in value
    assert '<script' not in value and 'onclick' not in value
    with pytest.raises(ValueError, match='Unknown help topic'):
        help_tip('nonexistent')


def test_assets_do_not_call_a_provider_or_track_the_reader():
    assets = help_assets()
    assert 'studium-help-styles' in assets
    assert 'fetch(' not in assets and 'localStorage' not in assets


def test_browser_and_python_renderers_agree_for_every_topic_and_audience():
    script = '''import {readFileSync} from 'node:fs';
import {renderHelp} from './ui/context-help.mjs';
const c=JSON.parse(readFileSync('ui/context-help.json','utf8'));
console.log(JSON.stringify(Object.keys(c.topics).flatMap(id =>
 ['student','teacher'].map(role => renderHelp(id,c,role)))));'''
    actual = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=ROOT))
    expected = [help_tip(topic, role) for topic in load_catalogue()['topics']
                for role in ('student', 'teacher')]
    assert actual == expected


def test_pre_help_report_still_verifies_and_rehashed_tampering_fails(tmp_path):
    out = tmp_path / 'host-journal'
    shutil.copytree(ROOT / 'tools/fixtures/learner-report-v2/host-journal', out)
    assert verify_learner_report(out)['ok']
    p = out / 'index.html'
    p.write_text(p.read_text().replace('Learning assessment: not performed.', 'Learning assessment: passed.'))
    _rehash_html(out)
    with pytest.raises(ReportError, match='browser rendering is stale'):
        verify_learner_report(out)


def test_new_report_explains_trace_and_provenance_without_scripts(tmp_path):
    out = tmp_path / 'report'
    export_learner_report(None, out, journal_path=write_json(tmp_path / 'journal.json', journal()))
    page = (out / 'index.html').read_text()
    assert 'data-help-topic="trace"' in page
    assert 'data-help-topic="provenance"' in page
    assert '<script' not in page.lower()
    assert verify_learner_report(out)['ok']
