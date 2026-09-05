"""Oráculo Prosimos — LILA-052.

Corre el modelo de `tools/oracles/to_prosimos.py` con Prosimos (PyPI, `import prosimos`) y
resume la salida en las métricas de `docs/RESULTS_FORMAT.md`, para congelarlas como fixture en
`packages/engine/test/fixtures/oracles/prosimos-chain5.json`.

**No se usan las estadísticas propias de Prosimos**: su utilización es `worked_time /
available_time` según el calendario del recurso, no `busyTime / (capacity × statisticsDuration)`
(RESULTS_FORMAT §4), y sus tiempos de ciclo agregan a nivel de traza con otra convención. Se
recorre el log en memoria (`log_info.trace_list`, con `enabled_at`/`started_at`/`completed_at` en
segundos) y se calculan las métricas con la misma definición que `simulate()` y que
`des_simpy.py`, que es lo único que hace comparable la cifra.

Semilla: Prosimos muestrea vía `scipy.stats`, que usa el RNG global de NumPy, y los gateways vía
`numpy.random.choice`; sembrar `numpy.random.seed` y `random.seed` antes de cada replicación
hace la corrida reproducible. Cada replicación usa `seed + i`, igual que `run.replications` en
Lila (R-ARR-8).

Uso: `tools/oracles/run_prosimos.sh` (crea el venv). Directo:
`python tools/oracles/run_prosimos.py --n 5000 --seed 42 --replications 30`
"""

import argparse
import datetime
import json
import random
import sys
import tempfile
from importlib import metadata

import numpy

from to_prosimos import ARRIVAL_MEAN, TASKS, write_model

# Instante inicial fijo (lunes 00:00 UTC). Sin él, `run_simulation` usa `datetime.now()`, y como
# Prosimos convierte los tiempos de disponibilidad de recurso a datetime y de vuelta (redondeando
# a microsegundos contra ese origen), dos corridas con la misma semilla difieren en el 8.º dígito.
# No cambia el modelo — el calendario es 24×7 — pero hace el fixture reproducible bit a bit.
STARTING_AT = "2026-01-05T00:00:00.000000+00:00"


def percentile(sorted_values, p):
    """Percentil empírico con interpolación lineal, idéntico a `metrics.ts#percentile`."""
    if not sorted_values:
        return 0.0
    position = (len(sorted_values) - 1) * p
    lower = int(position)
    upper = int(-(-position // 1))
    left = sorted_values[lower]
    if lower == upper:
        return left
    return left + (sorted_values[upper] - left) * (position - lower)


def run_once(bpmn_path, json_path, n, seed):
    from prosimos.simulation_engine import run_simulation

    numpy.random.seed(seed)
    random.seed(seed)
    _kpi, log_info = run_simulation(bpmn_path, json_path, n, starting_at=STARTING_AT)

    busy = {t["id"]: 0.0 for t in TASKS}
    wait_sum = {t["id"]: 0.0 for t in TASKS}
    wait_n = {t["id"]: 0 for t in TASKS}
    cycle_times = []
    makespan = 0.0

    for trace in log_info.trace_list:
        events = trace.event_list
        if not events:
            continue
        started = min(e.enabled_at for e in events)
        ended = max(e.completed_at for e in events)
        cycle_times.append(ended - started)
        makespan = max(makespan, ended)
        for event in events:
            task_id = event.task_id
            # `ideal_duration` es el tiempo de trabajo sin descansos de calendario: con 24×7
            # coincide con `real_duration`, y es lo que RESULTS_FORMAT §4 llama `busyTime`.
            busy[task_id] += event.ideal_duration
            wait_sum[task_id] += event.started_at - event.enabled_at
            wait_n[task_id] += 1

    cycle_times.sort()
    return {
        "now": makespan,
        "cycleTime": {
            "mean": sum(cycle_times) / len(cycle_times) if cycle_times else 0.0,
            "p95": percentile(cycle_times, 0.95),
        },
        "resources": [
            {
                "id": t["id"],
                "capacity": t["cap"],
                "utilization": busy[t["id"]] / (t["cap"] * makespan) if makespan > 0 else 0.0,
                "busyTime": busy[t["id"]],
                "waitMean": wait_sum[t["id"]] / wait_n[t["id"]] if wait_n[t["id"]] > 0 else 0.0,
            }
            for t in TASKS
        ],
    }


def summarize(values):
    """Media e IC95 con la t de Student, misma fórmula que `summarizeKpi` (RESULTS_FORMAT §8)."""
    n = len(values)
    mean = sum(values) / n
    if n < 2:
        return {"mean": mean, "ci95": [mean, mean]}
    variance = sum((v - mean) ** 2 for v in values) / (n - 1)
    # t(0.975; df) para df 1..30, la misma tabla que `T975` en `packages/engine/src/core/replications.ts`.
    t_table = [12.7062047364, 4.30265272975, 3.18244630528, 2.7764451052, 2.57058183564,
               2.44691184879, 2.36462425101, 2.3060041352, 2.26215716285, 2.22813885196,
               2.20098516008, 2.17881282966, 2.16036865646, 2.14478668792, 2.13144954556,
               2.11990529922, 2.10981557783, 2.10092204024, 2.09302405441, 2.08596344727,
               2.07961384473, 2.0738730679, 2.06865761042, 2.06389856163, 2.05953855275,
               2.05552943864, 2.05183051648, 2.0484071418, 2.04522964213, 2.0422724563]
    df = n - 1
    t = t_table[df - 1] if df <= len(t_table) else 1.96
    half = t * (variance / n) ** 0.5
    return {"mean": mean, "ci95": [mean - half, mean + half]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n", type=int, default=5000, help="casos por replicación")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--replications", type=int, default=30)
    parser.add_argument("--out", help="fichero de salida (por defecto stdout)")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="lila-prosimos-model-") as out_dir:
        bpmn_path, json_path = write_model(out_dir)
        replications = [run_once(bpmn_path, json_path, args.n, args.seed + i) for i in range(args.replications)]

    kpis = {
        "process.cycleTime.mean": summarize([r["cycleTime"]["mean"] for r in replications]),
        "process.cycleTime.p95": summarize([r["cycleTime"]["p95"] for r in replications]),
    }
    for task in TASKS:
        pick = lambda r, tid=task["id"]: next(x for x in r["resources"] if x["id"] == tid)
        kpis[f"resources.{task['id']}.utilization"] = summarize([pick(r)["utilization"] for r in replications])
        kpis[f"elements.{task['id']}.resourceWait.mean"] = summarize([pick(r)["waitMean"] for r in replications])

    fixture = {
        "$comment": (
            "Fixture congelado del oráculo Prosimos (LILA-052). Regenerar con "
            "`tools/oracles/run_prosimos.sh`; ver docs/ORACLES.md. Ni código ni binarios de "
            "Prosimos entran al repo: sólo estas cifras."
        ),
        "oracle": "prosimos",
        "prosimosVersion": metadata.version("prosimos"),
        "python": "%d.%d.%d" % sys.version_info[:3],
        "generatedAt": datetime.date.today().isoformat(),
        "model": {
            "description": "5 tareas secuenciales, un pool por tarea, llegadas exponenciales, 24x7",
            "arrival": {"type": "exponential", "mean": ARRIVAL_MEAN},
            "tasks": [
                {"id": t["id"], "capacity": t["cap"], "processingTime": {"type": "uniform", "min": t["min"], "max": t["max"]}}
                for t in TASKS
            ],
        },
        "params": {"n": args.n, "seed": args.seed, "replications": args.replications, "startingAt": STARTING_AT},
        "kpis": kpis,
    }

    text = json.dumps(fixture, indent=2, ensure_ascii=False) + "\n"
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
