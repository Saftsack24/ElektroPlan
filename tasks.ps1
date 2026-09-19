<#
.SYNOPSIS
    Entwicklungsbefehle fuer ElektroPlan (Windows).

.DESCRIPTION
    Entspricht dem Makefile, laeuft aber ohne installiertes make.

.EXAMPLE
    .\tasks.ps1 check
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('help', 'install', 'dev', 'test', 'lint', 'format', 'typecheck',
        'boundaries', 'migrate', 'seed', 'openapi', 'lock', 'check')]
    [string]$Task = 'help'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'apps/backend'
# Projektlokaler uv-Cache: macht Laeufe hermetisch und umgeht einen defekten
# globalen Cache unter %LOCALAPPDATA%.
$env:UV_CACHE_DIR = Join-Path $backend '.uv-cache'
$python = Join-Path $backend '.venv/Scripts/python.exe'
$linter = Join-Path $backend '.venv/Scripts/lint-imports.exe'

function Invoke-Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Host ""
    Write-Host "== $Name ==" -ForegroundColor Cyan
    # Viele Werkzeuge (uv, npm) schreiben Fortschritt nach stderr. Mit
    # 'Stop' wuerde PowerShell das als Fehler werten, obwohl der Exitcode 0
    # ist. Massgeblich ist allein $LASTEXITCODE.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Action
    }
    finally {
        $ErrorActionPreference = $previous
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FEHLGESCHLAGEN: $Name" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

function Assert-Venv {
    if (-not (Test-Path $python)) {
        Write-Host "Virtuelle Umgebung fehlt. Zuerst ausfuehren: .\tasks.ps1 install" -ForegroundColor Red
        exit 1
    }
}

switch ($Task) {
    'help' {
        Write-Host @"
ElektroPlan - Entwicklungsbefehle

  install      Abhaengigkeiten installieren (venv + npm)
  dev          Docker Compose starten
  test         Backend- und Frontend-Tests
  lint         ruff + eslint
  format       Code formatieren und automatisch korrigieren
  typecheck    mypy + tsc
  boundaries   Modulgrenzen vollstaendig pruefen (import-linter,
               Backend-AST-Grenzen inkl. Datenbank, Port-Typisierung mit
               mypy-Negativfixtures, Frontend-Grenzpruefung)
  migrate      Alembic upgrade head
  seed         Startbestand anlegen
  lock         uv.lock nach einer Aenderung an pyproject.toml erneuern
  openapi      OpenAPI exportieren und API-Client erzeugen
  check        Alle Qualitaetsschranken

Datenbanktests brauchen PostgreSQL:
  `$env:ELEKTROPLAN_TEST_DATABASE_URL = 'postgresql+psycopg://elektroplan:elektroplan@localhost:5432/elektroplan_test'
"@
    }

    'install' {
        # Reproduzierbar: installiert wird ausschliesslich aus uv.lock
        # (--frozen) bzw. package-lock.json (npm ci). Kein zweiter Installationsweg.
        Invoke-Step 'Python-Umgebung (uv sync --frozen)' {
            Push-Location $backend
            if (-not (Test-Path '.venv')) { python -m venv .venv }
            # uv-Bootstrap: uv steht selbst im Lock und ueberlebt daher das sync.
            & '.venv/Scripts/python.exe' -m pip install --quiet --upgrade pip 'uv==0.12.17'
            $env:UV_PROJECT_ENVIRONMENT = (Resolve-Path '.venv').Path
            & '.venv/Scripts/uv.exe' sync --frozen --extra dev
            Pop-Location
        }
        Invoke-Step 'Node-Abhaengigkeiten (npm ci)' { npm ci }
    }

    'dev' { docker compose up }

    'test' {
        Assert-Venv
        Invoke-Step 'Backend-Tests' { Push-Location $backend; & $python -m pytest; Pop-Location }
        Invoke-Step 'Frontend-Tests' { npm run test --workspaces --if-present }
    }

    'lint' {
        Assert-Venv
        Invoke-Step 'ruff check' { Push-Location $backend; & $python -m ruff check .; Pop-Location }
        Invoke-Step 'ruff format' { Push-Location $backend; & $python -m ruff format --check .; Pop-Location }
        Invoke-Step 'eslint' { npm run lint }
    }

    'format' {
        Assert-Venv
        Push-Location $backend
        & $python -m ruff format .
        & $python -m ruff check . --fix
        Pop-Location
    }

    'typecheck' {
        Assert-Venv
        Invoke-Step 'mypy' { Push-Location $backend; & $python -m mypy app; Pop-Location }
        Invoke-Step 'tsc' { npm run typecheck }
    }

    'boundaries' {
        Assert-Venv
        Invoke-Step 'import-linter' {
            Push-Location $backend
            & $linter --config .importlinter
            Pop-Location
        }
        Invoke-Step 'Backend-Modul- und Datenbankgrenzen (AST + Metadaten)' {
            Push-Location $backend
            & $python -m pytest tests/test_module_boundaries.py tests/test_module_registry.py `
                --no-header -q
            Pop-Location
        }
        Invoke-Step 'Port-Typisierung (mypy-Negativfixtures)' {
            Push-Location $backend
            & $python -m pytest tests/test_ports_typing.py --no-header -q
            Pop-Location
        }
        Invoke-Step 'Frontend-Modulgrenzen (npm run check:boundaries)' {
            npm run check:boundaries
        }
    }

    'migrate' {
        Assert-Venv
        Push-Location $backend; & $python -m alembic upgrade head; Pop-Location
    }

    'seed' {
        Assert-Venv
        Push-Location $backend; & $python -m app.cli seed; Pop-Location
    }

    'lock' {
        Assert-Venv
        Push-Location $backend
        & '.venv/Scripts/uv.exe' lock
        Pop-Location
    }

    'openapi' {
        Assert-Venv
        Invoke-Step 'OpenAPI exportieren' {
            Push-Location $backend
            & $python -m app.cli export-openapi openapi.json
            Pop-Location
        }
        Invoke-Step 'API-Client erzeugen' { npm run generate:api }
    }

    'check' {
        Assert-Venv
        Invoke-Step 'ruff check' { Push-Location $backend; & $python -m ruff check .; Pop-Location }
        Invoke-Step 'ruff format' { Push-Location $backend; & $python -m ruff format --check .; Pop-Location }
        Invoke-Step 'mypy' { Push-Location $backend; & $python -m mypy app; Pop-Location }
        Invoke-Step 'Modulgrenzen' {
            Push-Location $backend
            & $linter --config .importlinter
            Pop-Location
        }
        Invoke-Step 'Alembic: genau ein Head' {
            Push-Location $backend
            $heads = & $python -m alembic heads 2>&1 | Where-Object { $_ -match '\(head\)' }
            Pop-Location
            if (@($heads).Count -ne 1) {
                Write-Host "Es muss genau einen Alembic-Head geben, gefunden: $(@($heads).Count)" -ForegroundColor Red
                $global:LASTEXITCODE = 1
            }
            else {
                Write-Host "Ein Head: $heads"
                $global:LASTEXITCODE = 0
            }
        }
        Invoke-Step 'Lockfile aktuell' {
            Push-Location $backend
            & '.venv/Scripts/uv.exe' lock --check
            Pop-Location
        }
        Invoke-Step 'Backend-Tests' { Push-Location $backend; & $python -m pytest; Pop-Location }
        Invoke-Step 'API-Client aktuell' {
            Push-Location $backend
            & $python -m app.cli export-openapi openapi.json | Out-Null
            Pop-Location
            npm run check:api
        }
        Invoke-Step 'Frontend' {
            npm run typecheck
            if ($LASTEXITCODE -ne 0) { return }
            npm run lint
            if ($LASTEXITCODE -ne 0) { return }
            npm run check:boundaries
            if ($LASTEXITCODE -ne 0) { return }
            npm run test --workspaces --if-present
            if ($LASTEXITCODE -ne 0) { return }
            npm run build
        }
        Write-Host ""
        Write-Host "Alle Qualitaetsschranken bestanden." -ForegroundColor Green
    }
}
