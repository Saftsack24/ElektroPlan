# ElektroPlan - Entwicklungsbefehle
# Windows ohne make: stattdessen  tasks.ps1 <befehl>  verwenden.

BACKEND := apps/backend
VENV := $(BACKEND)/.venv/Scripts
# Projektlokaler uv-Cache - hermetisch und unabhaengig vom Benutzerprofil.
export UV_CACHE_DIR := $(CURDIR)/apps/backend/.uv-cache

.PHONY: help install dev test lint format typecheck boundaries migrate seed openapi lock lock-check check

help:
	@echo "install     Abhaengigkeiten installieren"
	@echo "dev         Docker Compose starten"
	@echo "test        Backend- und Frontend-Tests"
	@echo "lint        ruff + eslint"
	@echo "typecheck   mypy + tsc"
	@echo "boundaries  Modulgrenzen pruefen (import-linter)"
	@echo "migrate     Alembic upgrade head"
	@echo "seed        Startbestand anlegen"
	@echo "openapi     OpenAPI exportieren und API-Client erzeugen"
	@echo "check       Alle Qualitaetsschranken"

install:
	cd $(BACKEND) && python -m venv .venv \n		&& .venv/Scripts/python.exe -m pip install --quiet --upgrade pip uv==0.12.17 \n		&& UV_PROJECT_ENVIRONMENT=.venv .venv/Scripts/uv.exe sync --frozen --extra dev
	npm ci

dev:
	docker compose up

test:
	cd $(BACKEND) && .venv/Scripts/python.exe -m pytest
	npm run test --workspaces --if-present

lint:
	cd $(BACKEND) && .venv/Scripts/python.exe -m ruff check .
	cd $(BACKEND) && .venv/Scripts/python.exe -m ruff format --check .
	npm run lint

format:
	cd $(BACKEND) && .venv/Scripts/python.exe -m ruff format .
	cd $(BACKEND) && .venv/Scripts/python.exe -m ruff check . --fix

typecheck:
	cd $(BACKEND) && .venv/Scripts/python.exe -m mypy app
	npm run typecheck

boundaries:
	cd $(BACKEND) && .venv/Scripts/lint-imports.exe --config .importlinter

migrate:
	cd $(BACKEND) && .venv/Scripts/python.exe -m alembic upgrade head

seed:
	cd $(BACKEND) && .venv/Scripts/python.exe -m app.cli seed

openapi:
	cd $(BACKEND) && .venv/Scripts/python.exe -m app.cli export-openapi openapi.json
	npm run generate:api

lock:
	cd $(BACKEND) && .venv/Scripts/uv.exe lock

lock-check:
	cd $(BACKEND) && .venv/Scripts/uv.exe lock --check

check: lint typecheck boundaries lock-check test
	@echo "Alle Qualitaetsschranken bestanden."
