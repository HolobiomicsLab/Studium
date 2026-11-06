"""Latency bench: command lines, agent files, the synthetic learner and a full run against a stub CLI (no paid call)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

import latency_bench as bench

AGENTS = Path(__file__).resolve().parent.parent / ".claude" / "agents"

STUB = r'''
import json, sys
scenes = ["intro", "quiz", "explain_back"]
step = 0
def emit(event):
    sys.stdout.write(json.dumps(event) + "\n"); sys.stdout.flush()
for line in sys.stdin:
    json.loads(line)
    if step < len(scenes):
        transition = {"kind": "next", "presentation": {"scene": {"type": scenes[step]}}}
    else:
        transition = {"kind": "complete"}
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "mcp__studium__submit_response", "input": {}}]}})
    emit({"type": "assistant", "parent_tool_use_id": "t1", "message": {"content": [{"type": "tool_use", "name": "mcp__studium__get_current_scene", "input": {}}]}})
    emit({"type": "user", "message": {"content": [{"type": "tool_result", "content": [{"type": "text", "text": json.dumps({"transition": transition})}]}]}})
    emit({"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Écran"}}})
    emit({"type": "assistant", "message": {"content": [{"type": "text", "text": "Écran"}]}})
    step += 1
    emit({"type": "result", "num_turns": 2, "is_error": False, "result": "Écran %d" % step,
          "modelUsage": {"stub": {"outputTokens": 40 * step}}})
'''


def result(transition: dict) -> str:
    return json.dumps({"transition": transition})


def test_the_shipped_agents_parse_and_name_their_models():
    lesson = bench.parse_agent_file(AGENTS / "studium-lesson.md")
    explainer = bench.parse_agent_file(AGENTS / "studium-explainer.md")
    assert lesson["name"] == "studium-lesson" and lesson["definition"]["model"] == "haiku"
    assert explainer["name"] == "studium-explainer" and explainer["definition"]["model"] == "sonnet"
    assert "submit_response" in lesson["definition"]["prompt"]
    assert "---" not in lesson["definition"]["prompt"].splitlines()[0]
    # --agents takes lists where the file may hold a comma-separated string
    assert "mcp__*" in explainer["definition"]["disallowedTools"] and "Bash" in explainer["definition"]["disallowedTools"]


def test_an_agent_file_without_front_matter_is_refused(tmp_path):
    path = tmp_path / "broken.md"
    path.write_text("You relay.\n", encoding="utf-8")
    with pytest.raises(bench.BenchError, match="no front matter"):
        bench.parse_agent_file(path)
    path.write_text("---\nmodel: haiku\n---\nYou relay.\n", encoding="utf-8")
    with pytest.raises(bench.BenchError, match="name and a description"):
        bench.parse_agent_file(path)


def test_the_server_of_a_run_keeps_nothing_and_calls_no_judge(tmp_path):
    server = bench.mcp_config(tmp_path, tmp_path / "fixtures")["mcpServers"]["studium"]
    assert server["env"] == {"STUDIUM_EPHEMERAL": "1", "BUNDLES_ROOT": str(tmp_path / "fixtures"), "LITELLM_BASE_URL": ""}


def test_each_mode_builds_its_own_command(tmp_path):
    agent = {"name": "studium-lesson", "definition": {"description": "d", "prompt": "p", "model": "haiku"}}
    relay = bench.build_command(["claude"], "relay", tmp_path / "m.json", model="fable", effort="low", agents=[])
    assert relay[relay.index("--model") + 1] == "fable" and relay[relay.index("--effort") + 1] == "low"
    assert bench.RELAY_RULE in relay and "--agent" not in relay

    as_agent = bench.build_command(["claude"], "agent", tmp_path / "m.json", model=None, effort=None, agents=[agent])
    assert as_agent[as_agent.index("--agent") + 1] == "studium-lesson" and "--model" not in as_agent
    assert json.loads(as_agent[as_agent.index("--agents") + 1])["studium-lesson"]["model"] == "haiku"
    assert "--append-system-prompt" not in as_agent

    delegate = bench.build_command(["claude"], "delegate", tmp_path / "m.json", model="fable", effort=None, agents=[agent])
    assert "`studium-lesson` agent" in delegate[delegate.index("--append-system-prompt") + 1]

    with pytest.raises(bench.BenchError, match="--agent-file"):
        bench.build_command(["claude"], "agent", tmp_path / "m.json", model=None, effort=None, agents=[])
    with pytest.raises(bench.BenchError, match="--model"):
        bench.build_command(["claude"], "relay", tmp_path / "m.json", model=None, effort=None, agents=[])


def test_the_synthetic_learner_follows_the_scene_type():
    scene = lambda kind: result({"kind": "next", "presentation": {"scene": {"type": kind}}})
    assert bench.next_reply([scene("intro")]) == ("intro", "Continuer")
    assert bench.next_reply([scene("quiz")]) == ("quiz", "a, confiance 2")
    assert bench.next_reply([scene("explain_back")]) == ("explain_back", bench.WRITTEN_REPLY)
    assert bench.next_reply([result({"kind": "next", "self_rating": {"scene_id": "s"}})]) == ("rating", "good")
    assert bench.next_reply([result({"kind": "complete"})]) == ("complete", None)
    # the last readable result wins; text that is not JSON (a delegated agent's prose) is skipped
    assert bench.next_reply([scene("quiz"), "Voici l'écran suivant."]) == ("quiz", "a, confiance 2")
    assert bench.next_reply(["rien de lisible", "[1, 2]"]) == ("unknown", "Continuer")
    # a session start returns the presentation at the top level
    assert bench.next_reply([json.dumps({"session_id": "x", "presentation": {"scene": {"type": "concept"}}})])[0] == "concept"


def test_summary_is_a_median_over_the_turns_that_ended():
    rows = [{"wall_s": 4.0, "first_token_s": 1.0, "output_tokens": 100, "round_trips": 2},
            {"wall_s": 8.0, "first_token_s": None, "output_tokens": 300, "round_trips": 2},
            {"wall_s": 6.0, "first_token_s": 3.0, "output_tokens": 200, "round_trips": 3},
            {"error": "timeout"}]
    assert bench.summarise(rows) == {"n": 3, "wall_s": 6.0, "first_token_s": 2.0, "output_tokens": 200, "round_trips": 2}
    assert bench.summarise([{"error": "timeout"}]) == {"n": 0}


def test_a_run_against_a_stub_assistant_plays_measures_and_stops_at_the_end(tmp_path):
    stub = tmp_path / "stub.py"
    stub.write_text(STUB, encoding="utf-8")
    session = bench.Session([sys.executable, str(stub)], tmp_path)
    rows = bench.play(session, bundle="demo/lesson.json", learner="auto-bench-test", turns=6, probe=False)
    session.close()

    assert [row["scene"] for row in rows] == ["start", "intro", "quiz", "explain_back"]  # then the lesson is complete
    assert [row["sent"] for row in rows[1:]] == ["Continuer", "a, confiance 2", bench.WRITTEN_REPLY]
    assert "auto-bench-test" in rows[0]["sent"] and "synthétique" in rows[0]["sent"]
    assert all(row["output_tokens"] == 40 for row in rows)  # per turn, from a cumulative counter
    assert all(row["first_token_s"] is not None and row["first_token_s"] <= row["wall_s"] for row in rows)
    assert rows[1]["calls"] == ["submit_response", "(get_current_scene)"]  # a delegated call is in brackets
    text = bench.report("stub", rows)
    assert "MEDIAN learner turn" in text and '"n": 3' in text


PROBE_STUB = r'''
import json, sys
scenes = ["intro", "concept", "quiz", "concept"]
step, tokens = 0, 0
def emit(event):
    sys.stdout.write(json.dumps(event) + "\n"); sys.stdout.flush()
def end(text):
    global tokens
    tokens += 10
    emit({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}})
    emit({"type": "result", "num_turns": 1, "is_error": False, "result": text, "modelUsage": {"stub": {"outputTokens": tokens}}})
for line in sys.stdin:
    text = json.loads(line)["message"]["content"][0]["text"]
    if "en détail" in text:  # the deep question: handed to an agent left in the background, which returns later
        emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Agent", "input": {}}]}})
        end("L'explication arrive.")
        end("Voici l'explication.")
    elif text.startswith(("Je ne sais pas", "Avant de répondre")):
        end("Un indice existe ; il compte.")
    else:
        emit({"type": "user", "message": {"content": [{"type": "tool_result", "content": json.dumps(
            {"transition": {"kind": "next", "presentation": {"scene": {"type": scenes[min(step, len(scenes) - 1)]}}}})}]}})
        step += 1
        end("Écran %d" % step)
'''


def test_probes_ask_for_depth_where_nothing_waits_then_for_the_answer_on_a_quiz(tmp_path):
    stub = tmp_path / "probe_stub.py"
    stub.write_text(PROBE_STUB, encoding="utf-8")
    session = bench.Session([sys.executable, str(stub)], tmp_path)
    rows = bench.play(session, bundle="demo/lesson.json", learner="auto-bench-test", turns=0, probe=True)
    session.close()

    assert [row["scene"] for row in rows] == [
        "start", "intro",                                    # "Continuer" on the intro serves the concept screen
        "probe:asks_for_depth", "probe:explanation_arrives",  # asked there; the explanation comes in a later reply
        "concept",                                           # "Continuer" on the concept serves the quiz
        "probe:asks_for_answer", "probe:asks_for_the_notion"]
    assert rows[2]["calls"] == ["Agent"] and rows[3]["sent"] is None and rows[3]["reply"] == "Voici l'explication."
    text = bench.report("stub", rows)
    assert "(nothing sent)" in text and "Un indice existe" in text
    assert '"n": 2' in text  # the medians leave the probes out


def test_an_assistant_that_exits_is_reported_at_once(tmp_path):
    stub = tmp_path / "exits.py"
    stub.write_text("import sys; sys.stderr.write('Invalid --agents configuration'); sys.exit(1)", encoding="utf-8")
    session = bench.Session([sys.executable, str(stub)], tmp_path)
    rows = bench.play(session, bundle="demo/lesson.json", learner="auto-bench-test", turns=6, probe=True)
    assert "Invalid --agents" in session.close()
    assert rows[0]["error"] == "the assistant process has ended"
    assert all(row.get("error") for row in rows) and "ERROR" in bench.report("stub", rows)


def test_nothing_runs_without_live(tmp_path, capsys):
    assert bench.main(["--model", "haiku", "--claude", str(tmp_path / "absent")]) == 0
    assert "Dry run" in capsys.readouterr().out
    assert bench.main(["--mode", "agent", "--live"]) == 2
    assert "--agent-file" in capsys.readouterr().err
