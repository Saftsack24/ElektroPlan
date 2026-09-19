"""Engine- und Session-Verwaltung.

Bewusst synchrones SQLAlchemy (ADR 0011): Endpunkte werden als ``def``
definiert und laufen im Threadpool.
"""

from __future__ import annotations

from collections.abc import Generator, Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """Zwischengespeicherte Engine."""
    settings = get_settings()
    return create_engine(
        settings.database_url,
        echo=settings.database_echo,
        pool_size=settings.database_pool_size,
        pool_pre_ping=True,
        future=True,
        # Ohne Timeout blockiert ein Health-Check, wenn die Datenbank nicht
        # erreichbar ist - im Betrieb wie im Test.
        connect_args={"connect_timeout": settings.database_connect_timeout},
    )


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    """Zwischengespeicherte Session-Factory."""
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Session mit Transaktionsklammer fuer Skripte und Tests."""
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Generator[Session, None, None]:
    """FastAPI-Dependency. Die Transaktion steuert die Unit of Work.

    Bei einer Ausnahme wird **ausdruecklich** zurueckgerollt, bevor die
    Session geschlossen wird. Eine Session mit fehlgeschlagener Transaktion
    darf nicht weiterverwendet werden; der zentrale Exception-Handler in
    :mod:`app.errors` laeuft erst danach und fasst sie deshalb nicht mehr an.
    """
    session = get_session_factory()()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
