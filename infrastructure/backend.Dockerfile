# Backend-Image fuer die Entwicklung.
#
# Abhaengigkeiten werden ausschliesslich aus uv.lock installiert (--frozen):
# Eine frische Umgebung erhaelt exakt die getesteten Versionen.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir uv==0.12.17

WORKDIR /app

# Erst nur Manifest und Lockfile: Der Abhaengigkeits-Layer wird nur dann neu
# gebaut, wenn sich tatsaechlich Abhaengigkeiten aendern.
COPY apps/backend/pyproject.toml apps/backend/uv.lock /app/
RUN mkdir -p /app/app && touch /app/app/__init__.py \
    && uv sync --frozen --no-dev

COPY apps/backend /app

EXPOSE 8000

# Migrationen laufen bewusst NICHT automatisch beim Start
# (docs/database.md, Abschnitt 8). Ausfuehren mit:
#   docker compose exec backend alembic upgrade head
#   docker compose exec backend python -m app.cli seed
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
