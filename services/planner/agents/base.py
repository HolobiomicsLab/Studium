"""LLM transport for the legacy/research planner pipeline.

The deterministic mock remains available for tests and research runs, but only
when callers explicitly select ``STUDIUM_LLM_MODE=mock``.
"""
from __future__ import annotations
import json
import os
import time
import uuid
from typing import Any, TypeVar
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

_SUPPORTED_LLM_MODES = frozenset({"litellm", "mock"})
_LITELLM_BASE = os.environ.get("LITELLM_BASE_URL", "http://localhost:4000")
_LITELLM_KEY = os.environ.get("LITELLM_API_KEY", "")


def configured_llm_mode() -> str | None:
    """Return the explicitly selected supported mode, if any."""
    mode = os.environ.get("STUDIUM_LLM_MODE")
    return mode if mode in _SUPPORTED_LLM_MODES else None


class BaseAgent:
    alias: str = "studium/base"
    system_prompt: str = ""
    max_retries: int = 3

    def _call_llm(self, user_msg: str) -> str:
        mode = configured_llm_mode()
        if mode == "litellm":
            try:
                import httpx
                messages = []
                if self.system_prompt:
                    messages.append({"role": "system", "content": self.system_prompt})
                messages.append({"role": "user", "content": user_msg})
                resp = httpx.post(
                    f"{_LITELLM_BASE}/v1/chat/completions",
                    json={"model": self.alias, "messages": messages},
                    headers={"Authorization": f"Bearer {_LITELLM_KEY}"} if _LITELLM_KEY else {},
                    timeout=30.0,
                )
                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"]
            except Exception as exc:
                raise RuntimeError(f"planner model request failed: {exc}") from exc
        if mode == "mock":
            return self._mock_response()
        raise RuntimeError("planner model not configured")

    def _mock_response(self, reason: str = "") -> str:
        raise NotImplementedError("Sous-classes doivent implémenter _mock_response")

    def _audit(self, attempt: int, status: str, latency: float, error: str = "") -> dict[str, Any]:
        result: dict[str, Any] = {
            "provider": configured_llm_mode() or "unconfigured",
            "alias": self.alias,
            "latency_s": round(latency, 3),
            "attempt": attempt,
            "status": status,
        }
        if error:
            result["error"] = error
        return result

    def _parse_validated(self, raw: str, model: type[T]) -> T:
        """Parse JSON + validation Pydantic (rule 002). Lève ValueError si échec."""
        data = json.loads(raw)
        return model(**data)

    def _run_id(self) -> str:
        return uuid.uuid4().hex[:8]
