# Ported from Scriptorium scriptorium/literature/doi_sources.py (_MCPSession). Keep in sync.
"""Streamable-HTTP MCP session for Perspicacité.

Performs the 3-step handshake (initialize -> capture Mcp-Session-Id ->
notifications/initialized) on first use and caches the session ID for
subsequent call_tool / list_tools calls.  Connection failures degrade
gracefully (None / []) rather than raising.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_MCP_PROTOCOL_VERSION = "2024-11-05"
_MCP_ACCEPT = "application/json, text/event-stream"


def _parse_mcp_sse_data(body: str) -> dict | None:
    """Extract the JSON payload from one ``event: message\\ndata: <json>`` block."""
    for line in body.splitlines():
        if line.startswith("data: "):
            try:
                return json.loads(line[len("data: "):])
            except ValueError:
                return None
    return None


class _MCPSession:
    """Thin wrapper around the MCP streamable-HTTP transport.

    Performs the 3-step handshake (``initialize`` -> capture
    ``Mcp-Session-Id`` -> ``notifications/initialized``) on first use and
    caches the session ID for subsequent ``call_tool`` / ``list_tools``
    calls. Responses are SSE-framed (``event: message\\ndata: <json>``);
    the wrapper strips the framing and returns the parsed JSON payload.

    Connection failures and parse errors return ``None`` / ``[]`` (rather
    than raising) so callers can degrade gracefully.
    """

    def __init__(
        self,
        mcp_url: str,
        *,
        http_client: httpx.Client | None = None,
        timeout: float = 10.0,
        client_name: str = "studium",
        client_version: str = "0.1",
    ) -> None:
        self._http = http_client or httpx.Client(timeout=timeout)
        self._mcp_url = mcp_url
        self._client_name = client_name
        self._client_version = client_version
        self._session_id: str | None = None
        self._next_request_id = 1
        # When the server is unreachable, the handshake error fires once per
        # bib entry — a wall of identical warnings in a long resolve run.
        # _connect_failed remembers the first failure so subsequent
        # ensure_session calls short-circuit silently after one info-level
        # line is emitted; toolkit users still see what happened.
        self._connect_failed: bool = False

    @property
    def session_id(self) -> str | None:
        return self._session_id

    def ensure_session(self) -> bool:
        """Run the initialize + notifications/initialized handshake.

        Returns True on success; cached so the handshake runs once per
        instance. After the first network failure, returns False silently —
        long batch runs would otherwise emit one warning per entry against a
        server that's known-down.
        """
        if self._session_id is not None:
            return True
        if self._connect_failed:
            return False
        init_body = {
            "jsonrpc": "2.0",
            "id": self._next_request_id,
            "method": "initialize",
            "params": {
                "protocolVersion": _MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": self._client_name,
                    "version": self._client_version,
                },
            },
        }
        self._next_request_id += 1
        try:
            resp = self._http.post(
                self._mcp_url,
                json=init_body,
                headers={
                    "Accept": _MCP_ACCEPT,
                    "Content-Type": "application/json",
                },
            )
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            logger.info(
                "Perspicacité MCP unreachable at %s (%s) — falling back to "
                "offline mode for the rest of this run",
                self._mcp_url, exc,
            )
            self._connect_failed = True
            return False
        if resp.status_code != 200:
            logger.warning("mcp initialize %d", resp.status_code)
            self._connect_failed = True
            return False
        sid = resp.headers.get("mcp-session-id") or resp.headers.get(
            "Mcp-Session-Id"
        )
        if not sid:
            logger.warning("mcp initialize missing Mcp-Session-Id")
            return False
        # notifications/initialized (response is 202 Accepted)
        try:
            self._http.post(
                self._mcp_url,
                json={"jsonrpc": "2.0", "method": "notifications/initialized"},
                headers={
                    "Accept": _MCP_ACCEPT,
                    "Content-Type": "application/json",
                    "Mcp-Session-Id": sid,
                },
            )
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            logger.warning("mcp notify network error: %s", exc)
            return False
        self._session_id = sid
        return True

    def list_tools(self) -> list[dict]:
        """Return the tool descriptors advertised by the MCP server.

        Each entry is a ``dict`` (typically with ``name`` and
        ``description`` keys). Returns ``[]`` on handshake or transport
        failure.
        """
        if not self.ensure_session():
            return []
        body = {
            "jsonrpc": "2.0",
            "id": self._next_request_id,
            "method": "tools/list",
        }
        self._next_request_id += 1
        try:
            resp = self._http.post(
                self._mcp_url,
                json=body,
                headers={
                    "Accept": _MCP_ACCEPT,
                    "Content-Type": "application/json",
                    "Mcp-Session-Id": self._session_id or "",
                },
            )
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            logger.warning("mcp tools/list network error: %s", exc)
            return []
        if resp.status_code != 200:
            logger.warning("mcp tools/list %d", resp.status_code)
            return []
        payload = _parse_mcp_sse_data(resp.text)
        if payload is None:
            return []
        try:
            tools = payload["result"]["tools"]
        except (KeyError, TypeError):
            return []
        return list(tools) if isinstance(tools, list) else []

    def call_tool(
        self, *, tool_name: str, arguments: dict[str, Any]
    ) -> dict | None:
        """Invoke ``tools/call`` and return the parsed JSON-RPC payload.

        Returns the full JSON-RPC response dict (so callers can inspect
        ``payload["result"]["content"]`` themselves), or ``None`` on
        transport / parse failure.
        """
        if not self.ensure_session():
            return None
        body = {
            "jsonrpc": "2.0",
            "id": self._next_request_id,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments,
            },
        }
        self._next_request_id += 1
        try:
            resp = self._http.post(
                self._mcp_url,
                json=body,
                headers={
                    "Accept": _MCP_ACCEPT,
                    "Content-Type": "application/json",
                    "Mcp-Session-Id": self._session_id or "",
                },
            )
        except (httpx.TransportError, httpx.TimeoutException) as exc:
            logger.warning("mcp tools/call (%s) network error: %s", tool_name, exc)
            return None
        if resp.status_code != 200:
            logger.warning("mcp tools/call (%s) %d", tool_name, resp.status_code)
            return None
        return _parse_mcp_sse_data(resp.text)
