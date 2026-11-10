"""Completion counts LEARNERS, not events (audit 2026-11-10, follow-up to D3).

A learner is the (lesson_id, learner_pseudonym) pair the floor already counts. A resumed learner
writes `lesson_started` twice; a second start or completion from the same learner on the same lesson
changes nothing. tools/class_report.py and the MCP class report (apps/lesson-mcp teacher-tools.ts)
use this one definition.
"""
from metrics import Population, learner_completion_rate


def _pop(*pairs):
    p = Population()
    for lesson, learner in pairs:
        p.add(lesson, learner)
    return p


def test_start_resume_start_complete_is_one_of_one():
    started = _pop(("L", "a"), ("L", "a"))
    completed = _pop(("L", "a"))
    assert learner_completion_rate(started, completed) == 1.0


def test_a_learner_who_resumed_twice_and_never_finished_is_one_start():
    started = _pop(("L", "a"), ("L", "b"), ("L", "b"), ("L", "b"))
    completed = _pop(("L", "a"))
    assert learner_completion_rate(started, completed) == 0.5


def test_a_completion_without_a_start_is_not_counted_and_nothing_started_is_none():
    assert learner_completion_rate(_pop(("L", "a")), _pop(("L", "a"), ("L", "z"))) == 1.0
    assert learner_completion_rate(_pop(), _pop(("L", "a"))) is None


def test_the_same_pseudonym_in_two_lessons_is_two_learners():
    started = _pop(("L1", "a"), ("L2", "a"))
    completed = _pop(("L1", "a"))
    assert learner_completion_rate(started, completed) == 0.5
