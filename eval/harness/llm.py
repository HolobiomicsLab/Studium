"""LLM bridge for the eval harness.

The harness needs a "live Claude" backend for three agentic roles — AUTHOR,
STUDENT, AUDITOR — WITHOUT requiring a LiteLLM proxy or the anthropic Python
SDK (neither is reachable/installed in this environment, per the design's
runnability notes). It shells out to the `claude` CLI in print mode
(`claude -p ... --output-format json`), which is present and authenticated via
the ambient ANTHROPIC_BASE_URL.

This is intentionally a thin, dependency-free seam:
- `claude_available()` probes for the binary (no network call).
- `complete()` runs one non-interactive prompt and returns the text result.
- `complete_json()` wraps `complete()`, strips ``` fences, and parses JSON,
  retrying once with a terse "valid JSON only" reminder.

Offline / key-free runs never touch this module; the deterministic author and
heuristic auditor are pure-Python. The harness records which path was used in
author_provenance.json and the audit dossier so a stub run is never mistaken
for a live one.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass


class LLMError(RuntimeError):
    pass


def claude_available() -> bool:
    return shutil.which("claude") is not None


@dataclass
class ClaudeCli:
    """One-shot, non-interactive Claude calls via the local `claude` CLI."""

    model: str | None = None
    timeout_s: int = 240

    def complete(self, prompt: str, system: str | None = None) -> str:
        if not claude_available():
            raise LLMError("`claude` CLI not found on PATH — cannot run live LLM steps")
        cmd = ["claude", "-p", prompt, "--output-format", "json"]
        if self.model:
            cmd += ["--model", self.model]
        if system:
            cmd += ["--append-system-prompt", system]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout_s,
            )
        except subprocess.TimeoutExpired as exc:  # pragma: no cover - timing dependent
            raise LLMError(f"claude CLI timed out after {self.timeout_s}s") from exc
        if proc.returncode != 0:
            raise LLMError(f"claude CLI exited {proc.returncode}: {proc.stderr[:500]}")
        try:
            envelope = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            raise LLMError(f"claude CLI returned non-JSON envelope: {proc.stdout[:500]}") from exc
        if envelope.get("is_error"):
            raise LLMError(f"claude CLI reported error: {envelope.get('result', '')[:500]}")
        result = envelope.get("result")
        if not isinstance(result, str):
            raise LLMError("claude CLI envelope missing string `result`")
        return result

    def complete_json(self, prompt: str, system: str | None = None) -> dict | list:
        raw = self.complete(prompt, system=system)
        try:
            return _parse_json_lenient(raw)
        except ValueError:
            # one corrective retry
            retry = self.complete(
                prompt + "\n\nRespond with VALID JSON ONLY. No prose, no markdown fences.",
                system=system,
            )
            return _parse_json_lenient(retry)


def _parse_json_lenient(text: str) -> dict | list:
    """Parse JSON, tolerating ```json fences and leading/trailing prose."""
    s = text.strip()
    if s.startswith("```"):
        # strip a fenced block
        s = s.split("```", 2)[1] if s.count("```") >= 2 else s.strip("`")
        if s.lstrip().lower().startswith("json"):
            s = s.lstrip()[4:]
    s = s.strip()
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    # last resort: grab the outermost {...} or [...]
    for opener, closer in (("{", "}"), ("[", "]")):
        start = s.find(opener)
        end = s.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(s[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError(f"could not parse JSON from LLM output: {text[:300]}")
