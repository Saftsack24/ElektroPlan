"""In-Memory-Rate-Limiting (docs/security.md, Abschnitt 11).

Je Anwendungsprozess ein Zaehler. Das genuegt fuer den vorgesehenen
Einzelbetrieb mit **einem** Prozess. Mehrere Prozesse oder Instanzen zaehlen
getrennt - die wirksame Grenze vervielfacht sich dann mit ihrer Anzahl. Fuer
einen solchen Betrieb braucht es einen gemeinsamen Zaehler (etwa in PostgreSQL
oder einem eigenen Dienst); das ist bewusst noch nicht gebaut.

Eigenschaften:

* **Atomar:** :meth:`SlidingWindowLimiter.acquire` prueft und reserviert unter
  einer Sperre - parallele Anfragen koennen die Grenze nicht gemeinsam
  ueberschreiten. Eine Reservierung, die nicht zaehlen soll (etwa eine
  erfolgreiche Anmeldung), gibt :meth:`SlidingWindowLimiter.release` zurueck.
* **Begrenzter Speicher:** abgelaufene Eintraege werden laufend entfernt; ueber
  ``max_keys`` hinaus verdraengt der Limiter die am laengsten unbenutzten
  Schluessel (protokolliert nur die Anzahl).
* **Keine personenbezogenen Schluessel in Logs:** Protokolliert wird nur die
  Art eines Schluessels (``ip``, ``user`` ...), nie sein Wert.
"""

from __future__ import annotations

import hashlib
import itertools
import math
import threading
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from dataclasses import dataclass

from app.errors import RateLimitedError
from app.logging_config import get_logger

logger = get_logger(__name__)

#: Nach so vielen Reservierungen werden alle Schluessel einmal bereinigt.
_SWEEP_EVERY = 1000

_registry: list[SlidingWindowLimiter] = []


class RateLimitExceededError(Exception):
    """Mindestens ein Schluessel hat seine Grenze erreicht."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(f"retry after {retry_after}s")
        self.retry_after = retry_after


@dataclass(frozen=True, slots=True)
class Reservation:
    """Ein reservierter Versuch je Schluessel - zurueckgebbar mit ``release``.

    Jeder Eintrag traegt eine **eindeutige** Kennung. ``release`` entfernt genau
    diese Eintraege - nie einen fremden Versuch, auch nicht bei gleichem
    Zeitstempel - und ist bei erneutem Aufruf wirkungslos.
    """

    entries: tuple[tuple[str, int], ...]


#: Ein gezaehlter Versuch: (Zeitpunkt, eindeutige Kennung).
_Event = tuple[float, int]


class SlidingWindowLimiter:
    """Zaehlt Ereignisse je Schluessel in einem gleitenden Zeitfenster."""

    def __init__(
        self,
        *,
        limit: int,
        window_seconds: float,
        name: str,
        max_keys: int = 20_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.name = name
        self.limit = limit
        self.window = window_seconds
        self.max_keys = max_keys
        self._clock = clock
        self._lock = threading.Lock()
        self._events: OrderedDict[str, deque[_Event]] = OrderedDict()
        self._ids = itertools.count(1)
        self._since_sweep = 0
        _registry.append(self)

    # ----------------------------------------------------------- oeffentlich

    def acquire(self, *keys: str) -> Reservation:
        """Prueft **und** reserviert atomar je Schluessel einen Versuch.

        Alles oder nichts: Ist auch nur ein Schluessel voll, wird keiner
        gezaehlt und :class:`RateLimitExceededError` mit der Wartezeit bis zum
        Freiwerden aller vollen Schluessel geworfen.
        """
        with self._lock:
            now = self._clock()
            self._since_sweep += 1
            if self._since_sweep >= _SWEEP_EVERY:
                self._sweep(now)
            wait = 0.0
            denied = False
            for key in keys:
                events = self._pruned(key, now)
                if events is not None and len(events) >= self.limit:
                    denied = True
                    wait = max(wait, events[0][0] + self.window - now)
            if denied:
                raise RateLimitExceededError(max(1, math.ceil(wait)))
            entries = []
            for key in keys:
                event_id = next(self._ids)
                self._append(key, (now, event_id))
                entries.append((key, event_id))
            return Reservation(tuple(entries))

    def release(self, reservation: Reservation) -> None:
        """Nimmt eine Reservierung zurueck - der Versuch zaehlt nicht."""
        with self._lock:
            for key, event_id in reservation.entries:
                events = self._events.get(key)
                if events is None:
                    # Abgelaufen, verdraengt oder schon zurueckgegeben.
                    continue
                for event in events:
                    if event[1] == event_id:
                        events.remove(event)
                        break
                if not events:
                    del self._events[key]

    def reset(self, key: str) -> None:
        """Setzt den Zaehler eines Schluessels zurueck."""
        with self._lock:
            self._events.pop(key, None)

    def clear(self) -> None:
        """Vergisst alle Zaehler. Fuer Tests, die unabhaengig starten muessen."""
        with self._lock:
            self._events.clear()
            self._since_sweep = 0

    def key_count(self) -> int:
        """Anzahl gefuehrter Schluessel (Speicherverbrauch, fuer Tests)."""
        with self._lock:
            return len(self._events)

    def count(self, key: str) -> int:
        """Gezaehlte Versuche eines Schluessels im aktuellen Fenster (fuer Tests)."""
        with self._lock:
            events = self._pruned(key, self._clock())
            return 0 if events is None else len(events)

    # ----------------------------------------------------------------- intern

    def _pruned(self, key: str, now: float) -> deque[_Event] | None:
        events = self._events.get(key)
        if events is None:
            return None
        while events and now - events[0][0] >= self.window:
            events.popleft()
        if not events:
            del self._events[key]
            return None
        return events

    def _append(self, key: str, event: _Event) -> None:
        events = self._events.get(key)
        if events is None:
            if len(self._events) >= self.max_keys:
                self._sweep(event[0])
            if len(self._events) >= self.max_keys:
                evicted = 0
                while len(self._events) >= self.max_keys:
                    self._events.popitem(last=False)
                    evicted += 1
                logger.warning("rate_limit_keys_evicted", limiter=self.name, count=evicted)
            events = deque()
            self._events[key] = events
        else:
            self._events.move_to_end(key)
        events.append(event)

    def _sweep(self, now: float) -> None:
        self._since_sweep = 0
        for key in list(self._events):
            self._pruned(key, now)


def enforce(limiter: SlidingWindowLimiter, *keys: str, message: str, log_event: str) -> Reservation:
    """Reserviert einen Versuch oder antwortet einheitlich mit ``429``.

    Die Antwort traegt ``Retry-After`` in Sekunden. Protokolliert werden nur
    der Limiter und die **Arten** der Schluessel.
    """
    try:
        return limiter.acquire(*keys)
    except RateLimitExceededError as exc:
        logger.warning(
            log_event,
            limiter=limiter.name,
            key_kinds=sorted({key.split(":", 1)[0] for key in keys}),
        )
        raise RateLimitedError(message, retry_after=exc.retry_after) from None


def pseudonymous_key(kind: str, value: str) -> str:
    """Schluessel ohne Klartext (etwa fuer E-Mail-Adressen im Speicher)."""
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:32]
    return f"{kind}:{digest}"


def clear_all_limiters() -> None:
    """Vergisst alle Zaehler aller Limiter - nur fuer Tests."""
    for limiter in _registry:
        limiter.clear()
