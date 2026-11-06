#!/usr/bin/env python
"""Turn a conversation with an AI assistant into sources a Studium lesson can cite.

Reads a Claude Code session transcript (``.jsonl``) or a plain-text export, keeps what the learner
and the assistant wrote, and prints a JSON document whose ``sources`` go to the MCP tool
``prepare_sources`` unchanged (each has ``kind: "conversation"``). Every turn keeps its number, so a
quote of the lesson can be traced back to the exchange.

Local only: nothing is sent anywhere. Tool results (file contents, command output) are left out
unless ``--include-tool-results`` is given, and strings that look like credentials are replaced by
``[redacted]`` in every case. The redaction is a net, not a guarantee: read the output before sharing it.

Usage:
    python tools/conversation_sources.py SESSION.jsonl --focus "prerequisite gate" --out sources.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

SCHEMA = "studium/conversation-sources/v1"
# prepare_sources accepts 200 000 characters in all (MAX_TOTAL_SOURCE_CHARS); leave room for headers.
DEFAULT_MAX_CHARS = 150_000
DEFAULT_TOOL_RESULT_CHARS = 2_000
REDACTED = "[redacted]"

ROLE_LABELS = {
    "fr": {"user": "utilisateur", "assistant": "assistant", "tool": "résultat d'outil", "turn": "tour",
           "title": "Conversation avec un assistant IA", "turns": "tours"},
    "en": {"user": "user", "assistant": "assistant", "tool": "tool result", "turn": "turn",
           "title": "Conversation with an AI assistant", "turns": "turns"},
}

# Values that look like credentials. Each pattern's group 1, when present, is kept (the key name).
SECRET_PATTERNS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.S),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{30,}"),
    re.compile(r"\bglpat-[A-Za-z0-9_-]{16,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}=*"),
    re.compile(r"(?i)\b((?:api[_-]?key|token|secret|passw(?:or)?d)\w*\s*[:=]\s*[\"']?)[^\s\"']{12,}"),
]
# Harness plumbing inside a user message: never the learner's words.
PLUMBING = re.compile(
    r"<(system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-stderr|"
    r"task-notification|user-prompt-submit-hook)\b[^>]*>.*?</\1>", re.S)
TEXT_ROLE = re.compile(r"^\s*(?:#{1,6}\s*)?(user|human|utilisateur|moi|assistant|claude|codex|ai|ia)\s*:\s*", re.I)
TEXT_USER_ROLES = {"user", "human", "utilisateur", "moi"}


@dataclass
class Turn:
    index: int
    role: str  # user | assistant | tool
    text: str
    timestamp: str | None = None
    uuid: str | None = None


def redact(text: str) -> tuple[str, int]:
    """Replace credential-looking strings; returns the text and how many were replaced."""
    count = 0
    for pattern in SECRET_PATTERNS:
        def replace(match: re.Match[str]) -> str:
            nonlocal count
            count += 1
            return (match.group(1) if match.lastindex else "") + REDACTED
        text = pattern.sub(replace, text)
    return text, count


def _block_text(content: Any) -> str:
    """The text of a message content: a string, or the text blocks of a block list."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n\n".join(block.get("text", "") for block in content
                           if isinstance(block, dict) and block.get("type") == "text")
    return ""


def parse_claude_code(lines: Iterable[str], *, include_tool_results: bool, tool_result_chars: int) -> list[Turn]:
    """Turns of a Claude Code transcript: the user's and the assistant's text, in order. Sub-agent
    threads, harness messages, compaction summaries and the assistant's private reasoning are left out."""
    turns: list[Turn] = []
    tool_names: dict[str, str] = {}

    def add(role: str, text: str, entry: dict[str, Any]) -> None:
        text = text.strip()
        if text:
            turns.append(Turn(len(turns) + 1, role, text, entry.get("timestamp"), entry.get("uuid")))

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(entry, dict) or entry.get("type") not in ("user", "assistant"):
            continue
        if entry.get("isSidechain") or entry.get("isMeta") or entry.get("isCompactSummary"):
            continue
        message = entry.get("message")
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if entry["type"] == "assistant":
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_use" and isinstance(block.get("id"), str):
                        tool_names[block["id"]] = str(block.get("name", "tool"))
            add("assistant", _block_text(content), entry)
            continue
        if isinstance(content, list):
            for block in content:
                if not (isinstance(block, dict) and block.get("type") == "tool_result"):
                    continue
                if include_tool_results:
                    name = tool_names.get(str(block.get("tool_use_id")), "tool")
                    result = _block_text(block.get("content")).strip()
                    if len(result) > tool_result_chars:
                        result = result[:tool_result_chars].rstrip() + " […]"
                    add("tool", f"{name}\n{result}" if result else "", entry)
        add("user", PLUMBING.sub("", _block_text(content)), entry)
    return turns


def parse_text(text: str) -> list[Turn]:
    """Turns of a plain-text export: a new turn at each line starting with a speaker name and a colon
    (User:, Assistant:, Claude:, Utilisateur: ...). A text without such lines is one assistant-free block."""
    turns: list[Turn] = []
    role, buffer = None, []

    def flush() -> None:
        body = "\n".join(buffer).strip()
        if body:
            turns.append(Turn(len(turns) + 1, role or "user", body))

    for line in text.splitlines():
        match = TEXT_ROLE.match(line)
        if match:
            flush()
            role = "user" if match.group(1).lower() in TEXT_USER_ROLES else "assistant"
            buffer = [line[match.end():]]
        else:
            buffer.append(line)
    flush()
    return turns


def _fold(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))


def select(turns: list[Turn], *, focus: list[str], last: int | None, max_chars: int) -> tuple[list[Turn], bool]:
    """Keep the turns that mention a focus term (and their neighbours), then the last N, then as many
    of the most recent as fit in max_chars. Returns the kept turns and whether the size cap dropped any."""
    kept = turns
    terms = [_fold(term) for term in focus if term.strip()]
    if terms:
        hits = {i for i, turn in enumerate(turns) if any(term in _fold(turn.text) for term in terms)}
        around = {j for i in hits for j in (i - 1, i, i + 1) if 0 <= j < len(turns)}
        kept = [turns[i] for i in sorted(around)]
    if last is not None:
        kept = kept[-last:] if last > 0 else []
    total, fitted = 0, []
    for turn in reversed(kept):
        if total + len(turn.text) > max_chars and fitted:
            break
        fitted.append(turn)
        total += len(turn.text)
    fitted.reverse()
    return fitted, len(fitted) < len(kept)


def build(path: Path, *, fmt: str = "auto", focus: list[str] | None = None, last: int | None = None,
          max_chars: int = DEFAULT_MAX_CHARS, include_tool_results: bool = False,
          tool_result_chars: int = DEFAULT_TOOL_RESULT_CHARS, language: str = "en") -> dict[str, Any]:
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    if fmt == "auto":
        fmt = "claude-code" if path.suffix == ".jsonl" else "text"
    if fmt == "claude-code":
        turns = parse_claude_code(text.splitlines(), include_tool_results=include_tool_results,
                                  tool_result_chars=tool_result_chars)
    elif fmt == "text":
        turns = parse_text(text)
    else:
        raise ValueError(f"unknown format {fmt!r}")
    kept, truncated = select(turns, focus=focus or [], last=last, max_chars=max_chars)
    labels = ROLE_LABELS["fr" if language.lower().startswith("fr") else "en"]
    redactions = 0
    blocks = []
    for turn in kept:
        body, count = redact(turn.text)
        redactions += count
        stamp = f" · {turn.timestamp}" if turn.timestamp else ""
        blocks.append(f"[{labels['turn']} {turn.index} · {labels[turn.role]}{stamp}]\n{body}")
    sources = []
    if kept:
        span = f"{labels['turns']} {kept[0].index}–{kept[-1].index}"
        sources.append({
            "title": f"{labels['title']} ({span})", "kind": "conversation", "license": "private",
            "text": "\n\n".join(blocks),
        })
    return {
        "schema": SCHEMA,
        "transcript": {
            "path": str(path), "format": fmt, "sha256": hashlib.sha256(raw).hexdigest(),
            "turns_total": len(turns), "turns_kept": len(kept), "truncated": truncated, "redactions": redactions,
            "tool_results_included": include_tool_results,
        },
        "turns": [{"index": t.index, "role": t.role, "timestamp": t.timestamp, "uuid": t.uuid, "chars": len(t.text)}
                  for t in kept],
        "sources": sources,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("transcript", type=Path, help="a Claude Code .jsonl transcript or a text export")
    parser.add_argument("--format", choices=["auto", "claude-code", "text"], default="auto")
    parser.add_argument("--focus", action="append", default=[],
                        help="keep the turns that mention this term and their neighbours (repeatable)")
    parser.add_argument("--last", type=int, help="keep the last N turns")
    parser.add_argument("--max-chars", type=int, default=DEFAULT_MAX_CHARS)
    parser.add_argument("--include-tool-results", action="store_true",
                        help="also keep tool results (file contents, command output), truncated")
    parser.add_argument("--tool-result-chars", type=int, default=DEFAULT_TOOL_RESULT_CHARS)
    parser.add_argument("--language", default="en", help="language of the turn labels (fr or en)")
    parser.add_argument("--out", type=Path, help="write the JSON here instead of standard output")
    args = parser.parse_args(argv)
    if not args.transcript.is_file():
        print(f"error: {args.transcript} is not a file", file=sys.stderr)
        return 2
    document = build(args.transcript, fmt=args.format, focus=args.focus, last=args.last, max_chars=args.max_chars,
                     include_tool_results=args.include_tool_results, tool_result_chars=args.tool_result_chars,
                     language=args.language)
    if not document["sources"]:
        print("error: no turn kept (empty transcript, or no turn mentions the focus terms)", file=sys.stderr)
        return 1
    payload = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        args.out.write_text(payload, encoding="utf-8")
        info = document["transcript"]
        print(f"{args.out}: {info['turns_kept']} of {info['turns_total']} turns, "
              f"{len(document['sources'][0]['text'])} characters, {info['redactions']} redaction(s)"
              + (", truncated to the most recent turns" if info["truncated"] else ""))
    else:
        sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
