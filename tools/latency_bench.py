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

It calls a paid model, so nothing runs without --live. It measures a relay, never what anyone learned,
and one run of a few turns does not establish a difference of a second.
"""
from __future__ import annotations

import argparse
import json
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


def mcp_config(repo: Path, bundles_root: Path) -> dict:
    """The Studium server from source, keeping nothing on disk and calling no judge model."""
    loader = repo / "apps" / "lesson-mcp" / "node_modules" / "tsx" / "dist" / "loader.mjs"
    entry = repo / "apps" / "lesson-mcp" / "src" / "index.ts"
    env = {"STUDIUM_EPHEMERAL": "1", "BUNDLES_ROOT": str(bundles_root), "LITELLM_BASE_URL": ""}
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
    parser.add_argument("--mode", choices=("relay", "agent", "delegate"), default="relay")
    parser.add_argument("--model", help="model alias of the session (relay, delegate), or an override (agent)")
    parser.add_argument("--effort")
    parser.add_argument("--agent-file", type=Path, action="append", default=[],
                        help="agent definition; the first is the relay, the others are available to it")
    parser.add_argument("--turns", type=int, default=6)
    parser.add_argument("--bundle", default="atomistique-l1/lesson.json")
    parser.add_argument("--bundles-root", type=Path, default=REPO / "fixtures")
    parser.add_argument("--label")
    parser.add_argument("--probe", action="store_true", help="also ask for the answer and for a deep explanation on a quiz")
    parser.add_argument("--json", type=Path, help="write the rows here")
    parser.add_argument("--claude", default="claude", help="the Claude Code executable")
    parser.add_argument("--live", action="store_true", help="really call the model (paid)")
    args = parser.parse_args(argv)
    label = args.label or "-".join(filter(None, [args.mode, args.model, args.effort]))
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
            rows = play(session, bundle=args.bundle, learner=f"auto-bench-{label}", turns=args.turns, probe=args.probe)
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
