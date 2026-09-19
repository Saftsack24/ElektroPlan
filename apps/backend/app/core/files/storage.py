"""S3-kompatibler Object Storage (lokal MinIO).

In der Datenbank liegen nur Metadaten; der Inhalt liegt im Storage (ADR 0002).
Der urspruengliche Dateiname wird nie als Pfad verwendet.

Zwei Endpunkte, zwei Clients:

* **intern** - Backend zu MinIO, im Docker-Netz z. B. ``http://minio:9000``.
* **oeffentlich** - signierte URLs, die der Browser aufruft, z. B.
  ``http://localhost:9000``.

Die Signatur nach SigV4 umfasst den Host. Deshalb wird mit genau dem Endpunkt
signiert, den der Browser spaeter aufruft. Ein nachtraegliches Ersetzen des
Hostnamens im fertigen URL wuerde die Signatur ungueltig machen.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import IO, TYPE_CHECKING
from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import get_settings
from app.logging_config import get_logger

if TYPE_CHECKING:
    from mypy_boto3_s3.client import S3Client

logger = get_logger(__name__)

#: Erlaubte Inhaltstypen als Whitelist. SVG und HTML sind ausgeschlossen -
#: sie sind ein XSS-Vektor (docs/security.md, Abschnitt 7).
ALLOWED_CONTENT_TYPES: dict[str, tuple[bytes, ...]] = {
    "application/pdf": (b"%PDF-",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/webp": (b"RIFF",),
    "text/csv": (),
    "text/plain": (),
}

#: Zeichen, die im ASCII-Teil von ``Content-Disposition`` verbleiben duerfen.
_UNSAFE_HEADER_CHARS = re.compile(r'[^\x20-\x7e]|["\\]')


@dataclass(frozen=True, slots=True)
class StoredObject:
    """Ergebnis eines Uploads."""

    storage_key: str
    size_bytes: int
    content_type: str


def build_storage_key(
    organization_id: uuid.UUID,
    file_id: uuid.UUID,
    filename: str,
    *,
    project_id: uuid.UUID | None = None,
) -> str:
    """Serverseitig erzeugter Schluessel.

    Schema ``org/<org-id>/project/<project-id>/<file-id><ext>`` bei
    Projektbezug, sonst ``org/<org-id>/<file-id><ext>``
    (docs/architecture.md, Abschnitt 15). Die Endung stammt aus dem
    Originalnamen, der Rest wird verworfen - der Dateiname wird nie Teil
    des Pfads.
    """
    suffix = ""
    if "." in filename:
        candidate = filename.rsplit(".", 1)[-1]
        if candidate.isalnum() and len(candidate) <= 8:
            suffix = f".{candidate.lower()}"
    scope = f"org/{organization_id}"
    if project_id is not None:
        scope = f"{scope}/project/{project_id}"
    return f"{scope}/{file_id}{suffix}"


def matches_magic_bytes(content_type: str, head: bytes) -> bool:
    """Prueft den tatsaechlichen Inhalt, nicht nur die Endung."""
    signatures = ALLOWED_CONTENT_TYPES.get(content_type)
    if signatures is None:
        return False
    if not signatures:
        return True
    return any(head.startswith(signature) for signature in signatures)


def content_disposition(filename: str) -> str:
    """Baut einen injektionssicheren ``Content-Disposition``-Wert.

    Zeilenumbrueche, Steuerzeichen, Anfuehrungszeichen und Backslashes werden
    aus dem ASCII-Teil entfernt; der Originalname folgt zusaetzlich
    prozentkodiert als ``filename*`` (RFC 6266/5987).
    """
    ascii_name = _UNSAFE_HEADER_CHARS.sub("_", filename).strip() or "download"
    encoded = quote(filename, safe="")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"


class ObjectStorage:
    """Duenne Huelle um den S3-Client."""

    def __init__(self, client: S3Client, signing_client: S3Client, bucket: str) -> None:
        self._client = client
        self._signing_client = signing_client
        self._bucket = bucket

    def ensure_bucket(self) -> None:
        """Legt den Bucket an, falls er fehlt (Entwicklung/MinIO)."""
        try:
            self._client.head_bucket(Bucket=self._bucket)
        except ClientError:
            self._client.create_bucket(Bucket=self._bucket)
            logger.info("bucket_created", bucket=self._bucket)

    def put_stream(
        self, key: str, stream: IO[bytes], content_type: str, size_bytes: int
    ) -> StoredObject:
        """Laedt aus einem Datenstrom hoch, ohne ihn vollstaendig zu puffern."""
        self._client.upload_fileobj(
            stream,
            self._bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )
        return StoredObject(storage_key=key, size_bytes=size_bytes, content_type=content_type)

    def presigned_download_url(
        self, key: str, *, filename: str, expires_in: int | None = None
    ) -> str:
        """Zeitlich begrenzte, autorisierte Download-URL.

        Signiert mit dem **oeffentlichen** Endpunkt, damit der Browser die URL
        aufloesen kann. ``Content-Disposition: attachment`` verhindert, dass
        Nutzerinhalte im Browser ausgefuehrt werden.
        """
        ttl = expires_in if expires_in is not None else get_settings().download_url_ttl_seconds
        return self._signing_client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self._bucket,
                "Key": key,
                "ResponseContentDisposition": content_disposition(filename),
            },
            ExpiresIn=ttl,
        )

    def delete(self, key: str) -> None:
        """Entfernt ein Objekt - u. a. zum Aufraeumen verwaister Uploads."""
        self._client.delete_object(Bucket=self._bucket, Key=key)


def _build_client(endpoint_url: str) -> S3Client:
    settings = get_settings()
    client: S3Client = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        config=Config(signature_version="s3v4"),
    )
    return client


@lru_cache(maxsize=1)
def get_object_storage() -> ObjectStorage:
    """Prozessweiter Storage-Zugriff."""
    settings = get_settings()
    internal = _build_client(settings.s3_endpoint_url)
    signing = (
        internal
        if settings.s3_signing_endpoint_url == settings.s3_endpoint_url
        else _build_client(settings.s3_signing_endpoint_url)
    )
    return ObjectStorage(internal, signing, settings.s3_bucket)
