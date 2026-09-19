"""Einfaches In-Memory-Rate-Limiting.

Ausreichend fuer den Einzelbetrieb mit einem Anwendungsprozess. Bei
Mehrinstanzbetrieb auf einen gemeinsamen Zaehler umstellen
(docs/security.md, Abschnitt 11).
"""

from __future__ import annotations

import time
from collections import defaultdict, deque


class SlidingWindowLimiter:
    """Zaehlt Ereignisse je Schluessel in einem gleitenden Zeitfenster."""

    def __init__(self, *, limit: int, window_seconds: int) -> None:
        self._limit = limit
        self._window = window_seconds
        self._events: defaultdict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> bool:
        """True, wenn noch ein Versuch erlaubt ist (ohne ihn zu zaehlen)."""
        return len(self._prune(key)) < self._limit

    def register(self, key: str) -> None:
        """Zaehlt einen Versuch."""
        self._prune(key).append(time.monotonic())

    def reset(self, key: str) -> None:
        """Setzt den Zaehler zurueck, z. B. nach erfolgreicher Anmeldung."""
        self._events.pop(key, None)

    def _prune(self, key: str) -> deque[float]:
        now = time.monotonic()
        events = self._events[key]
        while events and now - events[0] > self._window:
            events.popleft()
        return events
