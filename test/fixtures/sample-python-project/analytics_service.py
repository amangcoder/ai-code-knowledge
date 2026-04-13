"""Analytics tracking service."""
from datetime import datetime


@_ensure_initialized
def track_event(event_name: str, metadata: dict) -> None:
    """Track an analytics event."""
    print(f"[{datetime.now()}] {event_name}: {metadata}")


async def flush_events() -> int:
    """Flush pending events to the analytics backend."""
    return 0


class EventBuffer:
    """Buffers events before sending."""

    def __init__(self, max_size: int = 100):
        self._buffer = []
        self._max_size = max_size

    def add(self, event: dict) -> None:
        """Add an event to the buffer."""
        self._buffer.append(event)
        if len(self._buffer) >= self._max_size:
            self.flush()

    def flush(self) -> list:
        """Flush the buffer."""
        events = self._buffer.copy()
        self._buffer.clear()
        return events
