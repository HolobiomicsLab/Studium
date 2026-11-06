"""conversation_sources.py: a conversation transcript becomes prepare_sources input."""
from __future__ import annotations

import json
from pathlib import Path

import conversation_sources as cs


def _entry(kind: str, content, **extra) -> str:
    return json.dumps({"type": kind, "message": {"role": kind, "content": content}, **extra})


def _transcript(tmp_path: Path, lines: list[str]) -> Path:
    path = tmp_path / "session.jsonl"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


FAKE_KEY = "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2"


def _session(tmp_path: Path) -> Path:
    return _transcript(tmp_path, [
        _entry("user", "Pourquoi la porte de prérequis renvoie-t-elle à la même question ?",
               timestamp="2026-11-06T08:00:00Z", uuid="u1"),
        _entry("assistant", [
            {"type": "thinking", "thinking": "private reasoning"},
            {"type": "text", "text": "Parce que la notion n'avait qu'une seule question notée."},
            {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "graph-nav.ts"}},
        ], uuid="a1"),
        _entry("user", [{"type": "tool_result", "tool_use_id": "t1",
                         "content": [{"type": "text", "text": "export const MAX_PREREQ_DETOURS = 3;\n" + "x" * 5000}]}]),
        _entry("assistant", "sub-agent chatter", isSidechain=True),
        _entry("user", "<system-reminder>internal</system-reminder>harness only", isMeta=True),
        _entry("user", "This session is being continued…", isCompactSummary=True),
        "not json at all",
        json.dumps({"type": "summary", "summary": "ignored"}),
        _entry("user", f"<system-reminder>noise</system-reminder>Voici ma clé {FAKE_KEY} et token = abcdefghijklmnop1234"),
        _entry("assistant", "Le budget de détours vaut trois par prérequis."),
    ])


def test_keeps_what_the_user_and_the_assistant_wrote_in_order(tmp_path: Path) -> None:
    document = cs.build(_session(tmp_path), language="fr")
    assert document["schema"] == "studium/conversation-sources/v1"
    assert [turn["role"] for turn in document["turns"]] == ["user", "assistant", "user", "assistant"]
    assert document["transcript"]["turns_total"] == 4
    assert document["transcript"]["tool_results_included"] is False
    source = document["sources"][0]
    assert source["kind"] == "conversation" and source["license"] == "private"
    assert source["title"] == "Conversation avec un assistant IA (tours 1–4)"
    text = source["text"]
    assert "[tour 1 · utilisateur · 2026-11-06T08:00:00Z]\nPourquoi la porte" in text
    assert "[tour 2 · assistant]\nParce que la notion" in text
    for absent in ("private reasoning", "sub-agent chatter", "harness only", "being continued", "noise",
                   "MAX_PREREQ_DETOURS"):
        assert absent not in text


def test_redacts_credential_looking_strings(tmp_path: Path) -> None:
    document = cs.build(_session(tmp_path))
    text = document["sources"][0]["text"]
    assert FAKE_KEY not in text and "abcdefghijklmnop1234" not in text
    assert "Voici ma clé [redacted] et token = [redacted]" in text
    assert document["transcript"]["redactions"] == 2


def test_tool_results_only_on_request_and_truncated(tmp_path: Path) -> None:
    document = cs.build(_session(tmp_path), include_tool_results=True, tool_result_chars=60)
    assert [turn["role"] for turn in document["turns"]] == ["user", "assistant", "tool", "user", "assistant"]
    text = document["sources"][0]["text"]
    assert "[turn 3 · tool result]\nRead\nexport const MAX_PREREQ_DETOURS = 3;" in text
    assert "x" * 100 not in text and "[…]" in text


def test_focus_keeps_matching_turns_and_neighbours_accent_insensitive(tmp_path: Path) -> None:
    document = cs.build(_session(tmp_path), focus=["PREREQUIS RENVOIE"])
    assert [turn["index"] for turn in document["turns"]] == [1, 2]
    assert cs.build(_session(tmp_path), focus=["nothing like this"])["sources"] == []


def test_last_and_size_cap_keep_the_most_recent_turns(tmp_path: Path) -> None:
    assert [turn["index"] for turn in cs.build(_session(tmp_path), last=1)["turns"]] == [4]
    capped = cs.build(_session(tmp_path), max_chars=60)
    assert [turn["index"] for turn in capped["turns"]] == [4]
    assert capped["transcript"]["truncated"] is True
    assert cs.build(_session(tmp_path))["transcript"]["truncated"] is False


def test_plain_text_export_splits_on_speaker_lines(tmp_path: Path) -> None:
    path = tmp_path / "chat.md"
    path.write_text("User: What is a prerequisite gate?\nmore\n\nAssistant: A check before a scene.\n\n"
                    "### Utilisateur : et ensuite ?\nClaude: On avance.\n", encoding="utf-8")
    document = cs.build(path)
    assert [(turn["role"], turn["index"]) for turn in document["turns"]] == [
        ("user", 1), ("assistant", 2), ("user", 3), ("assistant", 4)]
    assert "[turn 1 · user]\nWhat is a prerequisite gate?\nmore" in document["sources"][0]["text"]
    plain = tmp_path / "notes.txt"
    plain.write_text("No speaker here, one block.", encoding="utf-8")
    assert cs.build(plain)["transcript"]["turns_total"] == 1


def test_cli_writes_the_document_and_refuses_an_empty_selection(tmp_path: Path, capsys) -> None:
    out = tmp_path / "sources.json"
    assert cs.main([str(_session(tmp_path)), "--out", str(out), "--language", "fr"]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["sources"][0]["kind"] == "conversation"
    assert "4 of 4 turns" in capsys.readouterr().out
    assert cs.main([str(_session(tmp_path)), "--focus", "absent-term"]) == 1
    assert cs.main([str(tmp_path / "missing.jsonl")]) == 2
