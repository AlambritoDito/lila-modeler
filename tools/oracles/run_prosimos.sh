#!/usr/bin/env bash
# Regenera el fixture congelado del oráculo Prosimos (LILA-052).
#
# Crea un venv **fuera del repo** (`$LILA_PROSIMOS_VENV`, por defecto en el tmpdir del sistema),
# instala Prosimos desde PyPI y escribe
# `packages/engine/test/fixtures/oracles/prosimos-chain5.json`. Ni el venv ni una sola línea de
# Prosimos entran al repo: sólo las cifras del fixture (ver docs/ORACLES.md, estado de licencia).
#
# Uso:  tools/oracles/run_prosimos.sh [--n 5000] [--seed 42] [--replications 30]
# Requiere `uv` (https://astral.sh/uv) en el PATH.
set -euo pipefail

# Que el intérprete del venv no deje `tools/oracles/__pycache__` dentro del repo: el único
# archivo que este script escribe en el árbol de trabajo es el fixture.
export PYTHONDONTWRITEBYTECODE=1

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
venv="${LILA_PROSIMOS_VENV:-${TMPDIR:-/tmp}/lila-prosimos}"
out="$repo/packages/engine/test/fixtures/oracles/prosimos-chain5.json"

if ! command -v uv >/dev/null 2>&1; then
  echo "run_prosimos.sh necesita 'uv' en el PATH (https://astral.sh/uv)" >&2
  exit 1
fi

# Prosimos fija numpy<2 y scipy: Python 3.11 es la versión con ruedas para toda la pila.
uv venv "$venv" --python 3.11
uv pip install --python "$venv/bin/python" --quiet prosimos

mkdir -p "$(dirname "$out")"
"$venv/bin/python" "$here/run_prosimos.py" --out "$out" "$@"
echo "fixture escrito en $out"
