import json
import httpx
from perspicacite_mcp.session import _MCPSession, _parse_mcp_sse_data

def _sse(payload: dict) -> str:
    return f"event: message\ndata: {json.dumps(payload)}\n\n"

def test_parse_sse_extracts_json():
    assert _parse_mcp_sse_data(_sse({"a": 1})) == {"a": 1}
    assert _parse_mcp_sse_data("no data line") is None

def test_handshake_then_call_tool():
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body.get("method") == "initialize":
            return httpx.Response(200, headers={"Mcp-Session-Id": "sid-1"}, text=_sse({"result": {}}))
        if body.get("method") == "notifications/initialized":
            return httpx.Response(202)
        if body.get("method") == "tools/call":
            return httpx.Response(200, text=_sse({"result": {"content": [{"text": json.dumps({"success": True, "results": []})}]}}))
        return httpx.Response(500)
    client = httpx.Client(transport=httpx.MockTransport(handler))
    sess = _MCPSession("http://x/mcp", http_client=client)
    payload = sess.call_tool(tool_name="get_relevant_passages", arguments={"query": "q"})
    assert payload["result"]["content"][0]["text"]

def test_unreachable_server_degrades_to_none():
    def boom(request): raise httpx.ConnectError("down")
    client = httpx.Client(transport=httpx.MockTransport(boom))
    sess = _MCPSession("http://x/mcp", http_client=client)
    assert sess.call_tool(tool_name="get_relevant_passages", arguments={}) is None
