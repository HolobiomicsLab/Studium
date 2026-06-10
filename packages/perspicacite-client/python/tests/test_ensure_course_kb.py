from perspicacite_mcp.client import LivePerspicaciteClient

class _RecordingSession:
    """Records call_tool invocations; returns canned envelopes by tool name."""
    def __init__(self, existing_kbs=None, added=2):
        self.calls = []
        self._existing = existing_kbs or []
        self._added = added
    def call_tool(self, *, tool_name, arguments):
        import json
        self.calls.append((tool_name, arguments))
        if tool_name == "list_knowledge_bases":
            inner = {"success": True, "knowledge_bases": [{"name": n} for n in self._existing]}
        elif tool_name in ("create_knowledge_base",):
            inner = {"success": True, "name": arguments.get("name")}
        elif tool_name in ("add_dois_to_kb", "add_local_papers_to_kb", "build_kb_from_search"):
            inner = {"success": True, "added": self._added, "skipped": 0, "errored": 0}
        else:
            inner = {"success": False}
        return {"result": {"content": [{"text": json.dumps(inner)}]}}


class _RecordingSessionPerTool(_RecordingSession):
    """Like _RecordingSession but returns different `added` per tool name."""
    def __init__(self, existing_kbs=None, added_by_tool=None):
        super().__init__(existing_kbs=existing_kbs, added=0)
        self._added_by_tool = added_by_tool or {}

    def call_tool(self, *, tool_name, arguments):
        import json
        self.calls.append((tool_name, arguments))
        if tool_name == "list_knowledge_bases":
            inner = {"success": True, "knowledge_bases": [{"name": n} for n in self._existing]}
        elif tool_name == "create_knowledge_base":
            inner = {"success": True, "name": arguments.get("name")}
        elif tool_name in ("add_dois_to_kb", "add_local_papers_to_kb", "build_kb_from_search"):
            added = self._added_by_tool.get(tool_name, 0)
            inner = {"success": True, "added": added, "skipped": 0, "errored": 0}
        else:
            inner = {"success": False}
        return {"result": {"content": [{"text": json.dumps(inner)}]}}

REFS = [{"ref_type": "doi", "doi": "10.1/x", "title": "X"},
        {"ref_type": "local_file", "title": "notes.pdf", "ref_id": "/tmp/notes.pdf"}]

def test_builds_kb_and_routes_refs_by_type():
    s = _RecordingSession(existing_kbs=[], added=3)
    c = LivePerspicaciteClient(session=s, default_kb="domain")
    res = c.ensure_course_kb(course_id="m1", corpus_refs=REFS, keywords=None)
    assert res["kb_name"] == "studium-course-m1"
    assert res["status"] == "ready" and res["added"] >= 1
    tools = [t for t, _ in s.calls]
    assert "create_knowledge_base" in tools
    assert "add_dois_to_kb" in tools and "add_local_papers_to_kb" in tools

def test_idempotent_when_kb_exists():
    s = _RecordingSession(existing_kbs=["studium-course-m1"])
    c = LivePerspicaciteClient(session=s, default_kb="domain")
    res = c.ensure_course_kb(course_id="m1", corpus_refs=REFS, keywords=None)
    assert res["status"] == "ready"
    assert "create_knowledge_base" not in [t for t, _ in s.calls]  # no rebuild

def test_degraded_when_nothing_added():
    s = _RecordingSession(existing_kbs=[], added=0)
    c = LivePerspicaciteClient(session=s, default_kb="domain")
    res = c.ensure_course_kb(course_id="m1", corpus_refs=REFS, keywords=None)
    assert res["status"] == "degraded"


# Corpus refs whose dois/paths yield nothing — used by keyword-fallback test
_EMPTY_CORPUS_REFS: list[dict] = []


def test_keywords_fallback_when_dois_and_paths_add_nothing():
    """When add_dois/add_local return added=0 but build_kb_from_search returns added>0,
    ensure_course_kb should return status='ready' and must have called build_kb_from_search."""
    s = _RecordingSessionPerTool(
        existing_kbs=[],
        added_by_tool={
            "add_dois_to_kb": 0,
            "add_local_papers_to_kb": 0,
            "build_kb_from_search": 3,
        },
    )
    c = LivePerspicaciteClient(session=s, default_kb="domain")
    # corpus_refs that yield no dois/paths: empty list
    res = c.ensure_course_kb(course_id="m1", corpus_refs=_EMPTY_CORPUS_REFS, keywords="x")
    assert res["status"] == "ready", f"expected ready, got {res['status']}"
    tools_called = [t for t, _ in s.calls]
    assert "build_kb_from_search" in tools_called, (
        f"build_kb_from_search should have been called; calls={tools_called}"
    )
