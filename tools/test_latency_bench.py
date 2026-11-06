"""Latency bench: command lines, agent files, the synthetic learner and a full run against a stub CLI (no paid call).

The form and panel lanes call no model: they are played against a stub MCP server, then against the real one."""
from __future__ import annotations

import json
import shutil
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
    # --durable: the state goes to a folder the caller names (a temporary one), as on a learner's machine
    durable = bench.mcp_config(tmp_path, tmp_path / "fixtures", data_dir=tmp_path / "data")["mcpServers"]["studium"]
    assert durable["env"] == {**server["env"], "STUDIUM_DATA_DIR": str(tmp_path / "data")}


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


# ── The lanes without a model: forms (MCP elicitation) and the panel (panel_action) ──────────────────────────────

MCP_STUB = r"""
import json, sys
log = open(sys.argv[1], "a", encoding="utf-8")
def send(message):
    sys.stdout.write(json.dumps(message) + "\n"); sys.stdout.flush()
def read():
    line = sys.stdin.readline()
    if not line:
        sys.exit(0)
    return json.loads(line)
def note(*parts):
    log.write(json.dumps(parts) + "\n"); log.flush()
def text(payload, **extra):
    return {"content": [{"type": "text", "text": json.dumps(payload)}], **extra}
asked = []
def form(properties):  # ask the client a form and wait for its answer
    send({"jsonrpc": "2.0", "id": "form-%d" % len(asked), "method": "elicitation/create",
          "params": {"mode": "form", "message": "screen", "requestedSchema": {"type": "object", "properties": properties}}})
    asked.append(1)
    answer = read()["result"]
    note("form", answer)
    return answer
QUIZ = {"choice": {"type": "string", "enum": ["b", "a"]}, "confidence": {"type": "integer"}}
INTRO, QUIZ_STEP = {"scene_id": "s1", "scene_type": "intro"}, {"scene_id": "s2", "scene_type": "quiz", "correct": True}
PANEL = [  # the views panel_action returns, in order
    {"kind": "scene", "scene": {"id": "s2", "type": "quiz", "choices": [{"id": "b", "text": "B"}, {"id": "a", "text": "A"}]}},
    {"kind": "scene", "scene": {"id": "s3", "type": "explain_back"}, "verdict": {"scene_id": "s2", "graded": True, "correct": True}},
    {"kind": "scene", "scene": {"id": "s4", "type": "quiz", "choices": [{"id": "a", "text": "A"}]}, "self_rating": {"scene_id": "s3"}},
    {"kind": "scene", "scene": {"id": "s4", "type": "quiz", "choices": [{"id": "a", "text": "A"}]}},
    {"kind": "done", "verdict": {"scene_id": "s4", "graded": True, "correct": False}},
]
plays, panel_step = 0, 0
while True:
    message = read()
    method, params = message.get("method"), message.get("params") or {}
    if method == "initialize":
        note("capabilities", params["capabilities"])
        send({"jsonrpc": "2.0", "id": message["id"], "result": {"protocolVersion": params["protocolVersion"],
              "capabilities": {"tools": {}}, "serverInfo": {"name": "stub", "version": "1"}}})
    elif method == "notifications/initialized":
        send({"jsonrpc": "2.0", "method": "notifications/message", "params": {"level": "info", "data": "ready"}})
    elif method == "tools/call":
        name, args = params["name"], params["arguments"]
        note("call", name, args)
        if name == "start_lesson_session":
            result = text({"session_id": "S", "presentation": {"scene": {"id": "s1", "type": "intro"}}})
        elif name == "play_in_forms":
            plays += 1
            if plays > 1:
                form(QUIZ)
                result = text({"status": "complete", "steps": [{"scene_id": "s4", "scene_type": "quiz", "correct": False}]})
            elif form({})["action"] != "accept":
                result = text({"status": "paused", "reason": "cancelled", "steps": []})
            elif form(QUIZ)["action"] != "accept":
                result = text({"status": "paused", "reason": "cancelled", "steps": [INTRO]})
            else:
                result = text({"status": "needs_conversation", "steps": [INTRO, QUIZ_STEP],
                               "presentation": {"scene": {"id": "s3", "type": "explain_back"}}})
        elif name == "submit_response":
            result = text({"transition": {"kind": "next", "self_rating": {"scene_id": "s3"},
                                          "presentation": {"scene": {"id": "s4", "type": "quiz"}}}})
        elif name == "rate_recall":
            result = text({"rated": True})
        elif name == "open_lesson_panel":
            panel = {"kind": "scene", "session_id": "S", "scene": {"id": "s1", "type": "intro"}, "surface": {"rank": 3, "kind": "panel"}}
            result = text({"panel": panel}, structuredContent={"panel": panel})
        elif name == "panel_action":
            panel = dict(PANEL[panel_step], session_id="S"); panel_step += 1
            result = text({"panel": panel}, structuredContent={"panel": panel})
        else:
            result = text({"error": "unknown tool"}, isError=True)
        send({"jsonrpc": "2.0", "id": message["id"], "result": result})
"""


def stub_client(tmp_path, capabilities: dict) -> "bench.McpClient":
    stub = tmp_path / "mcp_stub.py"
    stub.write_text(MCP_STUB, encoding="utf-8")
    return bench.McpClient([sys.executable, str(stub), str(tmp_path / "seen.jsonl")], env={}, cwd=tmp_path,
                           capabilities=capabilities)


def seen(tmp_path) -> list[list]:
    return [json.loads(line) for line in (tmp_path / "seen.jsonl").read_text(encoding="utf-8").splitlines()]


def test_the_form_lane_is_played_by_a_client_that_answers_the_forms_with_a_delay_per_act(tmp_path):
    client = stub_client(tmp_path, bench.FORM_CAPABILITIES)
    rows = bench.play_forms(client, bundle="demo/lesson.json", learner="auto-bench-test", turns=40)
    client.close()

    assert [(row["act"], row["scene"]) for row in rows] == [
        ("start", "intro"), ("form_shown", "intro"), ("form", "intro"), ("form", "quiz"),
        ("conversation", "explain_back"), ("rating", "explain_back"),  # words, then the self-rating they earn
        ("form_shown", "quiz"), ("form", "quiz")]                      # back to forms until the lesson is complete
    assert all(isinstance(row["wall_ms"], float) and row["wall_ms"] >= 0 for row in rows)
    assert [row.get("correct") for row in rows if row["act"] == "form"] == [None, True, False]

    log = seen(tmp_path)
    assert log[0] == ["capabilities", {"elicitation": {}}]
    quiz = {"action": "accept", "content": {"choice": "b", "confidence": 2}}  # the first choice displayed
    assert [entry[1] for entry in log if entry[0] == "form"] == [{"action": "accept", "content": {}}, quiz, quiz]
    assert [entry[1:] for entry in log if entry[0] == "call"] == [
        ["start_lesson_session", {"bundle_ref": "demo/lesson.json", "learner_id": "auto-bench-test"}],
        ["play_in_forms", {"session_id": "S", "max_steps": 40}],
        ["submit_response", {"session_id": "S", "input": {"kind": "reply", "text": bench.WRITTEN_REPLY}}],
        ["rate_recall", {"session_id": "S", "scene_id": "s3", "grade": "good"}],
        ["play_in_forms", {"session_id": "S", "max_steps": 40}]]
    text = bench.report_acts("forms", rows, "form")
    assert "no model" in text and '"n": 3' in text


def test_the_form_lane_stops_at_its_cap_by_closing_the_next_form(tmp_path):
    client = stub_client(tmp_path, bench.FORM_CAPABILITIES)
    rows = bench.play_forms(client, bundle="demo/lesson.json", learner="auto-bench-test", turns=1)
    client.close()
    assert [row["act"] for row in rows] == ["start", "form_shown", "form"]
    assert rows[-1]["wall_ms"] >= 0  # known from the arrival of the form it closed
    assert [entry[1]["action"] for entry in seen(tmp_path) if entry[0] == "form"] == ["accept", "cancel"]


def test_the_panel_lane_calls_panel_action_directly_with_a_delay_per_action(tmp_path):
    client = stub_client(tmp_path, bench.PANEL_CAPABILITIES)
    rows = bench.play_panel(client, bundle="demo/lesson.json", learner="auto-bench-test", turns=40)
    client.close()

    assert [(row["act"], row["scene"]) for row in rows] == [
        ("open", "intro"), ("action", "intro"), ("action", "quiz"), ("action", "explain_back"),
        ("rating", "explain_back"), ("action", "quiz")]
    assert rows[0]["surface"] == "panel"
    assert all(isinstance(row["wall_ms"], float) and row["wall_ms"] >= 0 for row in rows)
    assert [row.get("correct") for row in rows if row["act"] == "action"] == [None, True, None, False]

    log = seen(tmp_path)
    assert log[0] == ["capabilities", bench.PANEL_CAPABILITIES] and "io.modelcontextprotocol/ui" in log[0][1]["extensions"]
    assert [entry[1:] for entry in log if entry[0] == "call"] == [
        ["open_lesson_panel", {"bundle_ref": "demo/lesson.json", "learner_id": "auto-bench-test"}],
        ["panel_action", {"session_id": "S", "action": {"type": "respond", "input": {"kind": "ack"}}}],
        ["panel_action", {"session_id": "S", "action": {"type": "respond", "input": {"kind": "quiz_choice", "choiceId": "b", "confidence": 2}}}],
        ["panel_action", {"session_id": "S", "action": {"type": "respond", "input": {"kind": "reply", "text": bench.WRITTEN_REPLY}}}],
        ["panel_action", {"session_id": "S", "action": {"type": "rateRecall", "sceneId": "s3", "grade": "good"}}],
        ["panel_action", {"session_id": "S", "action": {"type": "respond", "input": {"kind": "quiz_choice", "choiceId": "a", "confidence": 2}}}]]
    assert '"n": 4' in bench.report_acts("panel", rows, "action")


def test_the_panel_lane_stops_at_its_cap(tmp_path):
    client = stub_client(tmp_path, bench.PANEL_CAPABILITIES)
    rows = bench.play_panel(client, bundle="demo/lesson.json", learner="auto-bench-test", turns=2)
    client.close()
    assert [row["act"] for row in rows] == ["open", "action", "action"]


def test_delays_are_summarised_as_a_median_a_95th_centile_and_a_maximum():
    rows = [{"act": "form", "wall_ms": float(value)} for value in range(1, 21)]
    rows += [{"act": "start", "wall_ms": 900.0}, {"act": "form", "error": "refused"}]  # another act, and one that failed
    assert bench.summarise_acts(rows, "form") == {"n": 20, "median_ms": 10.5, "p95_ms": 19.0, "max_ms": 20.0}
    three = [{"act": "form", "wall_ms": value} for value in (30.0, 10.0, 20.0)]
    assert bench.summarise_acts(three, "form") == {"n": 3, "median_ms": 20.0, "p95_ms": 30.0, "max_ms": 30.0}
    assert bench.summarise_acts([], "form") == {"n": 0}


def test_a_server_that_exits_is_reported_with_its_last_words(tmp_path):
    stub = tmp_path / "exits.py"
    stub.write_text("import sys; sys.stderr.write('Cannot find module tsx'); sys.exit(1)", encoding="utf-8")
    with pytest.raises(bench.BenchError, match="Cannot find module tsx"):
        bench.McpClient([sys.executable, str(stub)], env={}, cwd=tmp_path, capabilities={})


REAL_SERVER = bool(shutil.which("node")) and (
    bench.REPO / "apps" / "lesson-mcp" / "node_modules" / "tsx" / "dist" / "loader.mjs").exists()


@pytest.mark.skipif(not REAL_SERVER, reason="needs node and the installed workspace (pnpm install)")
@pytest.mark.parametrize("mode, act, at_least, more", [
    ("forms", "form", 3, []), ("panel", "action", 4, []), ("panel", "action", 4, ["--durable"])])
def test_the_real_server_is_measured_without_a_model_and_without_live(mode, act, at_least, more, tmp_path, capsys, monkeypatch):
    # fixtures/atomistique-l1 opens with a screen, a screen, a quiz, then a written scene: four acts
    monkeypatch.setenv("STUDIUM_HOME", str(tmp_path / "home"))  # nothing may reach the real ~/.studium
    out = tmp_path / "rows.json"
    assert bench.main(["--mode", mode, "--turns", "4", "--json", str(out), "--claude", str(tmp_path / "absent"), *more]) == 0
    printed = capsys.readouterr().out
    assert "Dry run" not in printed and "no model" in printed
    assert ("state saved to disk" in printed) == bool(more) and not (tmp_path / "home").exists()
    rows = json.loads(out.read_text(encoding="utf-8"))["rows"]
    assert not [row for row in rows if row.get("error")]
    acts = [row for row in rows if row["act"] == act]
    assert at_least <= len(acts) <= 4 and all(0 <= row["wall_ms"] < 5000 for row in acts)
