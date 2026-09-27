"""Zustellung von Einladungen - eine bewusst kleine Zustaendigkeit.

Es gibt noch keinen E-Mail-Versand. Diese Datei beantwortet genau zwei
Fragen: *Ist ein Zustellweg eingerichtet?* und *Was erhaelt der Einladende
zurueck?* Ein spaeterer Versand ersetzt :func:`deliver`, ohne dass sich der
Einladungsablauf aendert. Ein allgemeines Nachrichtensystem entsteht hier
ausdruecklich nicht.

**Entwicklungslink.** In ``development_link`` wird der Aktivierungslink einmal
in der Antwort an den Einladenden zurueckgegeben. Er wird weder gespeichert
noch protokolliert und ist spaeter nicht mehr abrufbar. In Produktion ist
diese Einstellung verboten; die Konfiguration verweigert dann den Start
(:mod:`app.config`).

**Token im Fragment.** Der Link traegt das Token hinter ``#``. Browser senden
das Fragment nicht an den Server und nicht im ``Referer`` - es erscheint
damit weder in Zugriffsprotokollen des Webservers noch bei Dritten.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.config import Settings
from app.errors import InvitationDeliveryUnavailableError

DeliveryMode = Literal["development_link"]

#: Pfad der oeffentlichen Annahmeseite im Planner.
ACCEPTANCE_PATH = "/einladung"


@dataclass(frozen=True, slots=True)
class DeliveryResult:
    """Was der Einladende ueber die Zustellung erfaehrt."""

    mode: DeliveryMode
    #: Nur in ``development_link`` gesetzt - und nur in dieser einen Antwort.
    development_activation_url: str | None


def ensure_delivery_available(settings: Settings) -> None:
    """Bricht ab, **bevor** etwas angelegt wird, wenn niemand erreicht werden kann."""
    if settings.invitation_delivery != "development_link":
        raise InvitationDeliveryUnavailableError(
            "Fuer Einladungen ist noch kein Zustellweg eingerichtet. Die Einladung "
            "wurde nicht angelegt."
        )


def activation_url(settings: Settings, token: str) -> str:
    """Aktivierungslink; das Token steht im Fragment."""
    return f"{settings.public_app_url.rstrip('/')}{ACCEPTANCE_PATH}#t={token}"


def deliver(settings: Settings, token: str) -> DeliveryResult:
    """Stellt eine Einladung zu - derzeit ausschliesslich als Entwicklungslink."""
    ensure_delivery_available(settings)
    return DeliveryResult(
        mode="development_link",
        development_activation_url=activation_url(settings, token),
    )
