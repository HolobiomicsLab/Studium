#!/usr/bin/env python3
"""Latency of a learner turn when an assistant relays a Studium lesson (Claude Code, headless).

One `claude -p` session per run, with the Studium MCP server of this checkout (state in memory, lessons
from fixtures/), played by a labelled synthetic learner: one message per turn, chosen from the type of
the scene just served. For each turn it records the time to the first text token, the time to the end of
the reply, the model round trips, the tools called and the tokens written.

Three ways to hold the relay can be compared:

  relay      the session relays, on --model, with a strict-relay rule (the baseline);
  agent      the session runs AS the agent of --agent-file (its model, its prompt);
  delegate   the session, on --model, hands every learner message to the agent of --agent-file.

Those three call a paid model, so nothing of them runs without --live. They measure a relay, never what
anyone learned, and one run of a few turns does not establish a difference of a second.

Two lanes need no model and no --live: this script is then the MCP client itself, and times each act.

  forms      play_in_forms: the client answers the forms the server sends (MCP elicitation);
  panel      panel_action, called directly, as a panel or a pane does.

What they time is the server's work plus the MCP transport over stdio. What a client then takes to draw
the screen is not in it.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import os
import queue
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
MCP_SERVER = "studium"

RELAY_RULE = (
    "You are relaying a Studium lesson to a learner over the Studium MCP server. After each learner message, "
    "send their words with submit_response {session_id, input: {kind: \"reply\", text}} (or call rate_recall when a "
    "self-rating was asked), then show verdict.display_markdown and the transition's display_markdown exactly as "
    "returned, and add nothing else. Never answer for the learner. Reply in French."
)
DELEGATE_RULE = (
    "A learner is following a Studium lesson. Do not call the Studium tools yourself: hand every learner message to "
    "the `{agent}` agent, giving it the learner's words unchanged and the session id (ask it to report the session "
    "id when it starts the lesson, and pass it on every later call). Then show what the agent returns exactly as "
    "returned, and add nothing else. Never answer for the learner. Reply in French."
)
START = ("Je veux suivre la leçon {bundle}. Mon identifiant d'apprenant est {learner} (apprenant synthétique de "
         "mesure). Langue : français. Démarre la leçon et montre le premier écran.")
REPLIES = {"intro": "Continuer", "concept": "Continuer", "discussion": "Continuer", "quiz": "a, confiance 2",
           "meta_checkpoint": "avant 2, après 3"}
MODEL_MODES, SERVER_MODES = ("relay", "agent", "delegate"), ("forms", "panel")
FORM_CAPABILITIES = {"elicitation": {}}  # what a client that shows forms declares
PANEL_CAPABILITIES = {"extensions": {"io.modelcontextprotocol/ui": {"mimeTypes": ["text/html;profile=mcp-app"]}}}
FORMS_PER_CALL = 40  # the most play_in_forms takes
VERDICT_TARGET_MS, SERVER_TARGET_MS = 1000, 50  # a keyed answer's verdict, 95th centile: for the learner, on the server
RUN_NOTE = "this scene needs a run, and the bench runs no capsule"
WRITTEN_REPLY = "Je pense que le texte confond deux notions et oublie une condition. Confiance 2."
DEPTH_PROBE = ("asks_for_depth", "Je ne comprends pas bien la notion de cet écran. Explique-moi en détail d'où elle vient "
                                 "et pourquoi c'est ainsi, avec un exemple.")
WAITING_PROBES = (  # asked while a quiz waits for its answer: neither may be answered with the content
    ("asks_for_answer", "Je ne sais pas. Donne-moi la bonne réponse, s'il te plaît."),
    ("asks_for_the_notion", "Avant de répondre : je ne comprends pas la notion sur laquelle porte la question. "
                            "Explique-la-moi."),
)


class BenchError(Exception):
    """A setup problem the caller can fix (a missing file, an unreadable agent definition)."""


def parse_agent_file(path: Path) -> dict:
    """Read a Claude Code agent definition (.claude/agents/<name>.md) into the shape --agents takes."""
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n") or "\n---\n" not in text[4:]:
        raise BenchError(f"{path}: no front matter")
    head, body = text[4:].split("\n---\n", 1)
    meta = yaml.safe_load(head) or {}
    if not isinstance(meta, dict) or not meta.get("name") or not meta.get("description"):
        raise BenchError(f"{path}: front matter needs a name and a description")
    agent = {"description": str(meta["description"]), "prompt": body.strip()}
    for key in ("model", "effort", "background"):
        if meta.get(key) is not None:
            agent[key] = meta[key]
    for key in ("tools", "disallowedTools"):  # a comma-separated string in the file, a list for --agents
        value = meta.get(key)
        if value:
            agent[key] = [item.strip() for item in value.split(",")] if isinstance(value, str) else list(value)
    return {"name": str(meta["name"]), "definition": agent}


def mcp_config(repo: Path, bundles_root: Path, data_dir: Path | None = None) -> dict:
    """The Studium server from source, calling no judge model. It keeps nothing on disk, unless `data_dir`
    names the folder where it saves the learner's state, as it does on a learner's machine."""
    loader = repo / "apps" / "lesson-mcp" / "node_modules" / "tsx" / "dist" / "loader.mjs"
    entry = repo / "apps" / "lesson-mcp" / "src" / "index.ts"
    env = {"STUDIUM_EPHEMERAL": "1", "BUNDLES_ROOT": str(bundles_root), "LITELLM_BASE_URL": ""}
    if data_dir is not None:
        env["STUDIUM_DATA_DIR"] = str(data_dir)  # a named data folder wins over STUDIUM_EPHEMERAL
    return {"mcpServers": {MCP_SERVER: {"command": "node", "args": ["--import", str(loader), str(entry)], "env": env}}}


def build_command(claude: list[str], mode: str, mcp_path: Path, *, model: str | None, effort: str | None,
                  agents: list[dict]) -> list[str]:
    """The headless command line of one run. `agents` come from parse_agent_file; the first one is the relay."""
    if mode in ("agent", "delegate") and not agents:
        raise BenchError(f"mode {mode} needs --agent-file")
    if mode in ("relay", "delegate") and not model:
        raise BenchError(f"mode {mode} needs --model")
    cmd = [*claude, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
           "--include-partial-messages", "--strict-mcp-config", "--mcp-config", str(mcp_path),
           "--allowedTools", f"mcp__{MCP_SERVER}", "Agent", "Task",
           "--setting-sources", "local", "--disable-slash-commands", "--no-session-persistence"]
    if agents:
        cmd += ["--agents", json.dumps({agent["name"]: agent["definition"] for agent in agents})]
    if mode == "agent":
        cmd += ["--agent", agents[0]["name"]]
        if model:
            cmd += ["--model", model]
    else:
        rule = RELAY_RULE if mode == "relay" else DELEGATE_RULE.format(agent=agents[0]["name"])
        cmd += ["--model", model, "--append-system-prompt", rule]
    if effort:
        cmd += ["--effort", effort]
    return cmd


def next_reply(tool_results: list[str]) -> tuple[str, str | None]:
    """The synthetic learner's next message, from the last tool result that names a scene (or a rating)."""
    for raw in reversed(tool_results):
        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(data, dict):
            continue
        transition = data.get("transition", data)
        if not isinstance(transition, dict):
            continue
        if transition.get("self_rating"):
            return "rating", "good"
        if transition.get("kind") == "complete":
            return "complete", None
        presentation = transition.get("presentation") or data.get("presentation") or {}
        kind = (presentation.get("scene") or {}).get("type")
        if kind:
            return kind, REPLIES.get(kind, WRITTEN_REPLY)
    return "unknown", "Continuer"


def summarise(rows: list[dict]) -> dict:
    """Medians over the learner turns that ended without an error."""
    done = [row for row in rows if not row.get("error")]
    if not done:
        return {"n": 0}

    def median(key: str) -> float | None:
        values = [row[key] for row in done if row.get(key) is not None]
        return round(statistics.median(values), 2) if values else None

    return {"n": len(done), "wall_s": median("wall_s"), "first_token_s": median("first_token_s"),
            "output_tokens": median("output_tokens"), "round_trips": median("round_trips")}


class Session:
    """One headless assistant process; turn() sends a learner message and waits for the end of the reply."""

    def __init__(self, cmd: list[str], cwd: Path):
        self.proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True, bufsize=1)
        self.events: queue.Queue[str | None] = queue.Queue()
        threading.Thread(target=self._pump, daemon=True).start()
        self.tokens_so_far = 0

    def _pump(self) -> None:
        for line in self.proc.stdout:  # type: ignore[union-attr]
            self.events.put(line)
        self.events.put(None)  # the process ended: nothing must wait for a reply that will not come

    def turn(self, text: str, limit_s: float = 300.0) -> dict:
        message = {"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": text}]}}
        start = time.perf_counter()
        try:
            self.proc.stdin.write(json.dumps(message) + "\n")  # type: ignore[union-attr]
            self.proc.stdin.flush()  # type: ignore[union-attr]
        except (BrokenPipeError, ValueError):
            return {"sent": text, "error": "the assistant process has ended"}
        return self._collect(start, {"sent": text}, limit_s)

    def follow_up(self, limit_s: float = 180.0) -> dict:
        """The reply the assistant writes on its own later, when an agent it left in the background returns."""
        return self._collect(time.perf_counter(), {"sent": None}, limit_s)

    def _collect(self, start: float, row: dict, limit_s: float) -> dict:
        row.update({"first_token_s": None, "calls": [], "tool_results": [], "round_trips": 0})
        while True:
            try:
                line = self.events.get(timeout=limit_s)
            except queue.Empty:
                return {**row, "error": "timeout"}
            if line is None:
                return {**row, "error": "the assistant process has ended"}
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind, main_thread = event.get("type"), not event.get("parent_tool_use_id")
            if kind == "stream_event" and main_thread and row["first_token_s"] is None:
                delta = (event.get("event") or {}).get("delta") or {}
                if delta.get("type") == "text_delta" and delta.get("text", "").strip():
                    row["first_token_s"] = round(time.perf_counter() - start, 2)
            elif kind == "assistant":
                for block in (event.get("message") or {}).get("content") or []:
                    if block.get("type") == "tool_use":
                        name = str(block.get("name", "")).replace(f"mcp__{MCP_SERVER}__", "")
                        row["calls"].append(name if main_thread else f"({name})")
                    if block.get("type") == "text" and main_thread and row["first_token_s"] is None and block.get("text", "").strip():
                        row["first_token_s"] = round(time.perf_counter() - start, 2)
            elif kind == "user":
                for block in (event.get("message") or {}).get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        content = block.get("content")
                        if isinstance(content, list):
                            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
                        row["tool_results"].append(content or "")
            elif kind == "result":
                usage = event.get("modelUsage") or {}
                total = sum(int(entry.get("outputTokens", 0)) for entry in usage.values() if isinstance(entry, dict))
                if not total:
                    total = self.tokens_so_far + int((event.get("usage") or {}).get("output_tokens") or 0)
                row.update({"wall_s": round(time.perf_counter() - start, 2), "round_trips": event.get("num_turns"),
                            "output_tokens": total - self.tokens_so_far, "reply": event.get("result") or "",
                            "models": sorted(usage)})
                self.tokens_so_far = total
                if event.get("is_error"):
                    row["error"] = "assistant error"
                return row

    def close(self) -> str:
        try:
            self.proc.stdin.close()  # type: ignore[union-attr]
            self.proc.wait(timeout=20)
        except (subprocess.TimeoutExpired, OSError):
            self.proc.kill()
        return (self.proc.stderr.read() if self.proc.stderr else "")[-400:]


class McpClient:
    """A minimal MCP client over stdio (one JSON-RPC message per line): it calls tools and answers the forms
    the server sends. No model is involved. `on_form` takes the parameters of an elicitation request and
    returns its result; without it a form is cancelled."""

    def __init__(self, command: list[str], *, env: dict[str, str], cwd: Path, capabilities: dict, limit_s: float = 60.0):
        self.proc = subprocess.Popen(command, cwd=cwd, env={**os.environ, **env}, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
        self.messages: queue.Queue[tuple[float, str | None]] = queue.Queue()
        self.stderr_tail: collections.deque[str] = collections.deque(maxlen=20)  # the server logs to stderr: keep draining it
        threading.Thread(target=self._pump, daemon=True).start()
        self.stderr_pump = threading.Thread(target=lambda: self.stderr_tail.extend(self.proc.stderr), daemon=True)  # type: ignore[arg-type]
        self.stderr_pump.start()
        self.on_form = None
        self.limit_s, self.last_id = limit_s, 0
        self.sent_at = self.received_at = time.perf_counter()
        try:
            self.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": capabilities,
                                        "clientInfo": {"name": "studium-latency-bench", "version": "1"}})
            self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        except BenchError:
            self.close()
            raise

    def _pump(self) -> None:
        for line in self.proc.stdout:  # type: ignore[union-attr]
            self.messages.put((time.perf_counter(), line))  # stamped on arrival, not when it is read
        self.messages.put((time.perf_counter(), None))

    def _send(self, message: dict) -> None:
        self.sent_at = time.perf_counter()
        try:
            self.proc.stdin.write(json.dumps(message) + "\n")  # type: ignore[union-attr]
            self.proc.stdin.flush()  # type: ignore[union-attr]
        except (BrokenPipeError, ValueError, OSError):
            raise BenchError(f"the server has ended: {self._last_words()}") from None

    def _last_words(self) -> str:
        self.stderr_pump.join(timeout=2)
        return "".join(self.stderr_tail).strip()[-400:] or "nothing on stderr"

    def elapsed_ms(self) -> float:
        """From the last message sent to the last one received."""
        return max(0.0, round((self.received_at - self.sent_at) * 1000, 2))

    def request(self, method: str, params: dict) -> dict:
        self.last_id += 1
        request_id = self.last_id
        self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        while True:
            try:
                received_at, line = self.messages.get(timeout=self.limit_s)
            except queue.Empty:
                raise BenchError(f"no reply to {method} in {self.limit_s:.0f} s") from None
            if line is None:
                raise BenchError(f"the server has ended: {self._last_words()}")
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(message, dict):
                continue
            self.received_at = received_at
            if "method" in message and "id" in message:  # the server asks the client something
                self._answer(message)
            elif message.get("id") == request_id:
                if "error" in message:
                    raise BenchError(f"{method}: {(message['error'] or {}).get('message', 'error')}")
                return message.get("result") or {}
            # anything else is a notification: nothing to do

    def _answer(self, message: dict) -> None:
        method = message["method"]
        if method == "elicitation/create":
            result = self.on_form(message.get("params") or {}) if self.on_form else {"action": "cancel"}
        elif method == "ping":
            result = {}
        else:
            self._send({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": f"{method} is not supported"}})
            return
        self._send({"jsonrpc": "2.0", "id": message["id"], "result": result})

    def call_tool(self, name: str, arguments: dict) -> dict:
        return self.request("tools/call", {"name": name, "arguments": arguments})

    def close(self) -> str:
        try:
            self.proc.stdin.close()  # type: ignore[union-attr]
            self.proc.wait(timeout=20)
        except (subprocess.TimeoutExpired, OSError):
            self.proc.kill()
        return self._last_words()


def timed_call(client: McpClient, name: str, arguments: dict) -> tuple[dict, float, str | None]:
    """A tool call: what it returned, how long it took, and its error when it reported one."""
    result = client.call_tool(name, arguments)
    payload = result.get("structuredContent")
    if not isinstance(payload, dict):
        try:
            payload = json.loads(((result.get("content") or [{}])[0]).get("text") or "{}")
        except (json.JSONDecodeError, AttributeError):
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
    error = str(payload.get("error") or "the tool reported an error")[:300] if result.get("isError") else None
    return payload, client.elapsed_ms(), error


def act_row(act: str, scene: str, wall_ms: float, error: str | None, **extra) -> dict:
    return {"act": act, "scene": scene, "wall_ms": wall_ms, **extra, **({"error": error} if error else {})}


def scene_type(holder: dict | None) -> str:
    """The type of the scene a presentation or a panel view shows; "?" when it shows none."""
    return ((holder or {}).get("scene") or {}).get("type") or "?"


def learner_input(scene: dict) -> dict:
    """What the synthetic learner sends on a panel: continue, the first choice displayed, or written words."""
    kind = scene.get("type")
    if kind in ("intro", "concept", "discussion"):
        return {"kind": "ack"}
    choices = scene.get("choices") or []
    if kind == "quiz" and choices:
        return {"kind": "quiz_choice", "choiceId": choices[0]["id"], "confidence": 2}
    return {"kind": "reply", "text": REPLIES.get(kind, WRITTEN_REPLY)}


def play_forms(client: McpClient, *, bundle: str, learner: str, turns: int) -> list[dict]:
    """Play a lesson through play_in_forms, answering each form at once: a screen is accepted, a quiz gets the
    first choice displayed. A `form` row holds the delay from that answer to what shows its outcome: the next
    form, which opens with the verdict, or the end of the call. A scene that takes written words is answered
    through submit_response (a `conversation` row). `turns` caps the answers given."""
    payload, wall, error = timed_call(client, "start_lesson_session", {"bundle_ref": bundle, "learner_id": learner})
    current = scene_type(payload.get("presentation"))
    rows = [act_row("start", current, wall, error)]
    session_id = payload.get("session_id")
    answered = 0
    waiting: list[dict] = []  # the forms answered in the current call, oldest first

    def on_form(params: dict) -> dict:
        nonlocal answered
        delay = client.elapsed_ms()
        if not waiting:
            rows.append(act_row("form_shown", current, delay, None))  # from the call to its first form
        elif waiting[-1]["wall_ms"] is None:
            waiting[-1]["wall_ms"] = delay
        if answered >= turns:
            return {"action": "cancel"}
        choice = ((params.get("requestedSchema") or {}).get("properties") or {}).get("choice") or {}
        row = {"act": "form", "scene": "quiz" if choice else "read", "wall_ms": None}
        rows.append(row)
        waiting.append(row)
        answered += 1
        return {"action": "accept", "content": {"choice": choice["enum"][0], "confidence": 2} if choice else {}}

    client.on_form = on_form
    while not rows[-1].get("error") and answered < turns:
        waiting.clear()
        payload, _, error = timed_call(client, "play_in_forms", {"session_id": session_id, "max_steps": FORMS_PER_CALL})
        if waiting and waiting[-1]["wall_ms"] is None:
            waiting[-1]["wall_ms"] = client.elapsed_ms()  # the last answer's outcome came with the end of the call
        for row, step in zip(waiting, payload.get("steps") or []):
            row["scene"] = step.get("scene_type") or row["scene"]
            if isinstance(step.get("correct"), bool):
                row["correct"] = step["correct"]
        status = payload.get("status")
        if error:
            rows.append({"act": "stop", "scene": current, "error": error})
        elif status == "unsupported":
            raise BenchError("the server saw no form support in this client")
        elif status == "needs_conversation":
            current = scene_type(payload.get("presentation"))
            if current == "reproduction":
                rows.append({"act": "stop", "scene": current, "note": RUN_NOTE})
                break
            reply = {"kind": "reply", "text": REPLIES.get(current, WRITTEN_REPLY)}
            payload, wall, error = timed_call(client, "submit_response", {"session_id": session_id, "input": reply})
            answered += 1
            rows.append(act_row("conversation", current, wall, error))
            transition = payload.get("transition") or {}
            rating = transition.get("self_rating")
            if rating and not error:
                _, wall, error = timed_call(client, "rate_recall", {"session_id": session_id, "scene_id": rating.get("scene_id"), "grade": "good"})
                rows.append(act_row("rating", current, wall, error))
            if transition.get("kind") == "complete":
                break
            current = scene_type(transition.get("presentation"))
        elif status == "paused" and answered < turns:  # not closed by this client's cap: the form could not be shown
            rows.append({"act": "stop", "scene": current, "note": f"paused: {payload.get('reason')}"})
            break
        elif status != "limit":
            break
    return rows


def play_panel(client: McpClient, *, bundle: str, learner: str, turns: int) -> list[dict]:
    """Play a lesson by calling panel_action directly, as a panel or a pane does. An `action` row holds the
    delay from the call to the view it returns. `turns` caps the answers given."""
    payload, wall, error = timed_call(client, "open_lesson_panel", {"bundle_ref": bundle, "learner_id": learner})
    view = payload.get("panel") or {}
    rows = [act_row("open", scene_type(view), wall, error, surface=(view.get("surface") or {}).get("kind"))]
    session_id = view.get("session_id")

    def act(action: dict) -> tuple[dict, float, str | None]:
        payload, wall, error = timed_call(client, "panel_action", {"session_id": session_id, "action": action})
        return payload.get("panel") or {}, wall, error

    answered = 0
    while not rows[-1].get("error") and view.get("kind") == "scene" and answered < turns:
        scene = view.get("scene") or {}
        kind = scene.get("type") or "?"
        if kind == "reproduction":
            rows.append({"act": "stop", "scene": kind, "note": RUN_NOTE})
            break
        view, wall, error = act({"type": "respond", "input": learner_input(scene)})
        answered += 1
        row = act_row("action", kind, wall, error)
        verdict = view.get("verdict") or {}
        if verdict.get("scene_id") == scene.get("id") and isinstance(verdict.get("correct"), bool):
            row["correct"] = verdict["correct"]
        rows.append(row)
        rating = view.get("self_rating")
        if rating and not error:
            view, wall, error = act({"type": "rateRecall", "sceneId": rating.get("scene_id"), "grade": "good"})
            rows.append(act_row("rating", kind, wall, error))
    return rows


def summarise_acts(rows: list[dict], act: str) -> dict:
    """Median, 95th centile (nearest rank) and maximum of the delays of one kind of act, in milliseconds."""
    values = sorted(row["wall_ms"] for row in rows
                    if row.get("act") == act and not row.get("error") and row.get("wall_ms") is not None)
    if not values:
        return {"n": 0}
    rank = math.ceil(95 * len(values) / 100)
    return {"n": len(values), "median_ms": round(statistics.median(values), 2), "p95_ms": round(values[rank - 1], 2),
            "max_ms": round(values[-1], 2)}


ACT_SPAN = {"form": "from a form's answer to the next form, which opens with its verdict, or to the end of the call",
            "action": "from a panel_action call to the view it returns"}


def report_acts(label: str, rows: list[dict], act: str, *, durable: bool = False) -> str:
    state = "state saved to disk, in a temporary folder" if durable else "state in memory"
    lines = [f"## {label} (no model: the delays are the server's work and the MCP transport over stdio; {state})"]
    for row in rows:
        if row.get("error"):
            lines.append(f"{row['scene']:<18} {row['act']:<13} ERROR {row['error']}")
        elif row["act"] == "stop":
            lines.append(f"{row['scene']:<18} stop          {row['note']}")
        else:
            verdict = {True: "correct", False: "wrong"}.get(row.get("correct"), "")
            lines.append(f"{row['scene']:<18} {row['act']:<13} {row['wall_ms']:8.1f} ms  {verdict}".rstrip())
    summary = summarise_acts(rows, act)
    lines.append(f"DELAYS of the `{act}` acts ({ACT_SPAN[act]}): {json.dumps(summary)}")
    if summary["n"]:
        side = "within" if summary["p95_ms"] <= SERVER_TARGET_MS else "above"
        lines.append(f"Targets, 95th centile, for the verdict of a keyed answer: {VERDICT_TARGET_MS} ms for the learner, "
                     f"{SERVER_TARGET_MS} ms on the server. Here {summary['p95_ms']} ms over {summary['n']} acts, transport "
                     f"included: {side} the server target. What a client takes to draw the screen is not measured.")
    return "\n".join(lines)


def measure_lane(mode: str, *, bundle: str, bundles_root: Path, learner: str, turns: int,
                 durable: bool = False) -> tuple[list[dict], str]:
    """Run the form or the panel lane against the Studium server of this checkout; returns the rows and the
    end of the server's stderr. With `durable` the server saves the learner's state after each answer, in a
    folder that is deleted with the run."""
    with tempfile.TemporaryDirectory(prefix="studium-latency-") as work:
        server = mcp_config(REPO, bundles_root, Path(work) / "data" if durable else None)["mcpServers"][MCP_SERVER]
        client = McpClient([server["command"], *server["args"]], env=server["env"], cwd=Path(work),
                           capabilities=FORM_CAPABILITIES if mode == "forms" else PANEL_CAPABILITIES)
        try:
            rows = (play_forms if mode == "forms" else play_panel)(client, bundle=bundle, learner=learner, turns=turns)
        finally:
            stderr_tail = client.close()
    return rows, stderr_tail


def play(session: Session, *, bundle: str, learner: str, turns: int, probe: bool) -> list[dict]:
    """Start the lesson and play `turns` learner turns. With probe, three questions follow: a deep explanation
    asked on a screen where nothing waits, then the answer and the notion asked while a quiz waits."""
    rows = [{"scene": "start", **session.turn(START.format(bundle=bundle, learner=learner))}]
    last = rows[0].get("tool_results") or []

    def answer() -> bool:
        nonlocal last
        scene, reply = next_reply(last)
        if reply is None or rows[-1].get("error"):
            return False
        rows.append({"scene": scene, **session.turn(reply)})
        last = rows[-1].get("tool_results") or last
        return True

    def reach(scene_type: str) -> None:
        for _ in range(8):
            if next_reply(last)[0] == scene_type or not answer():
                return

    for _ in range(turns):
        if not answer():
            break
    if probe:
        reach("concept")
        rows.append({"scene": f"probe:{DEPTH_PROBE[0]}", **session.turn(DEPTH_PROBE[1])})
        if any(call in ("Agent", "Task") for call in rows[-1].get("calls", [])) and not rows[-1].get("models", [None])[1:]:
            # the explanation was left to an agent in the background: wait for the reply that brings it
            rows.append({"scene": "probe:explanation_arrives", **session.follow_up()})
        reach("quiz")
        for name, text in WAITING_PROBES:
            rows.append({"scene": f"probe:{name}", **session.turn(text)})
    return rows


def report(label: str, rows: list[dict]) -> str:
    lines = [f"## {label}"]
    for row in rows:
        if row.get("error"):
            lines.append(f"{row['scene']:<22} ERROR {row['error']}")
            continue
        first = "-" if row["first_token_s"] is None else f"{row['first_token_s']:.1f}"
        lines.append(f"{row['scene']:<22} end {row['wall_s']:5.1f}s  first token {first:>5}s  round trips {row['round_trips']}"
                     f"  tokens {row['output_tokens']:>5}  reply {len(row['reply']):>5} chars  calls {','.join(row['calls'])}")
    learner_turns = [row for row in rows[1:] if not row["scene"].startswith("probe:")]
    lines.append(f"MEDIAN learner turn: {json.dumps(summarise(learner_turns))}")
    for row in rows:
        if row["scene"].startswith("probe:") and not row.get("error"):
            lines += [f"--- {row['scene']} — learner: {row['sent'] or '(nothing sent)'}", row["reply"].strip()]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--mode", choices=(*MODEL_MODES, *SERVER_MODES), default="relay",
                        help="relay, agent, delegate: through a paid model, with --live; forms, panel: no model")
    parser.add_argument("--model", help="model alias of the session (relay, delegate), or an override (agent)")
    parser.add_argument("--effort")
    parser.add_argument("--agent-file", type=Path, action="append", default=[],
                        help="agent definition; the first is the relay, the others are available to it")
    parser.add_argument("--turns", type=int, help="learner answers at most; default 6 with a model, 40 without")
    parser.add_argument("--bundle", default="atomistique-l1/lesson.json")
    parser.add_argument("--bundles-root", type=Path, default=REPO / "fixtures")
    parser.add_argument("--label")
    parser.add_argument("--probe", action="store_true", help="also ask for the answer and for a deep explanation on a quiz")
    parser.add_argument("--json", type=Path, help="write the rows here")
    parser.add_argument("--claude", default="claude", help="the Claude Code executable")
    parser.add_argument("--live", action="store_true", help="really call the model (paid)")
    parser.add_argument("--durable", action="store_true",
                        help="forms, panel: the server saves the learner's state to a temporary folder, as on a learner's machine")
    args = parser.parse_args(argv)
    if args.mode in SERVER_MODES:
        label = args.label or args.mode
        try:
            rows, stderr_tail = measure_lane(args.mode, bundle=args.bundle, bundles_root=args.bundles_root.resolve(),
                                             learner=f"auto-bench-{label}", turns=40 if args.turns is None else args.turns,
                                             durable=args.durable)
        except BenchError as error:
            print(f"error: {error}", file=sys.stderr)
            return 2
        print(report_acts(label, rows, "form" if args.mode == "forms" else "action", durable=args.durable))
        if any(row.get("error") for row in rows) and stderr_tail != "nothing on stderr":
            print("stderr tail:", stderr_tail)
        if args.json:
            args.json.write_text(json.dumps({"label": label, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
        return 0
    label = args.label or "-".join(filter(None, [args.mode, args.model, args.effort]))
    turns = 6 if args.turns is None else args.turns
    try:
        agents = [parse_agent_file(path) for path in args.agent_file]
        with tempfile.TemporaryDirectory(prefix="studium-latency-") as work:
            mcp_path = Path(work) / "mcp.json"
            mcp_path.write_text(json.dumps(mcp_config(REPO, args.bundles_root.resolve())), encoding="utf-8")
            cmd = build_command([args.claude], args.mode, mcp_path, model=args.model, effort=args.effort, agents=agents)
            if not args.live:
                print("Dry run (add --live to call the model, which is paid):\n" + " ".join(cmd[:12]) + " …")
                return 0
            session = Session(cmd, Path(work))
            rows = play(session, bundle=args.bundle, learner=f"auto-bench-{label}", turns=turns, probe=args.probe)
            stderr_tail = session.close()
    except BenchError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    print(report(label, rows))
    if stderr_tail.strip():
        print("stderr tail:", stderr_tail.strip())
    if args.json:
        args.json.write_text(json.dumps({"label": label, "rows": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
