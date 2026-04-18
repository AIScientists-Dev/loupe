"""Per-paper event bus for SSE streaming.

Producers (pipeline steps, localize worker) call `emit(paper_id, event, data)`.
Consumers (SSE route handlers) call `subscribe(paper_id)` to get a queue
and `unsubscribe(...)` when done.

No persistence — events missed during disconnect are not replayed. Frontend
contract: on SSE reconnect, do a full GET /v1/papers/{id} refetch.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


class EventBus:
    def __init__(self) -> None:
        self._subscribers: Dict[str, List[asyncio.Queue]] = defaultdict(list)

    def subscribe(self, paper_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subscribers[paper_id].append(q)
        return q

    def unsubscribe(self, paper_id: str, queue: asyncio.Queue) -> None:
        lst = self._subscribers.get(paper_id)
        if not lst:
            return
        try:
            lst.remove(queue)
        except ValueError:
            pass
        if not lst:
            self._subscribers.pop(paper_id, None)

    def emit(self, paper_id: str, event: str, data: Dict[str, Any]) -> None:
        """Fire-and-forget event. Safe to call from any coroutine or thread."""
        payload = {"event": event, "data": data}
        for q in list(self._subscribers.get(paper_id, [])):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                logger.warning("SSE queue full for paper %s; dropping %s", paper_id, event)


bus = EventBus()


def format_sse(event: str, data: Dict[str, Any]) -> bytes:
    """Serialize an event as an SSE frame."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")
