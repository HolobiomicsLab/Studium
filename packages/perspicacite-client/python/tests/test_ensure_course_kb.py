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
