"""Oráculo SimPy — LILA-049.

Puerto de `bench/des_simpy.py` (benchmark de rendimiento del ADR-009) al modelo exacto que
usa `packages/engine/test/theory-simpy.test.ts`: 5 tareas secuenciales, cada una con su propio
pool de recursos (capacidad 1-3), llegadas exponenciales y duraciones triangulares. Sin
`duration` ni warmup: la corrida arranca vacía y termina cuando se atendieron los `n` casos y
se vació la cola, igual que el motor de Lila con `run.duration` ausente (R-ARR-3).

No es benchmark de velocidad (eso ya lo cubrió el ADR-009): aquí sólo importa que las
distribuciones y la contabilidad de espera/ocupación midan lo mismo que
`docs/RESULTS_FORMAT.md` §2/§4/§5, para poder comparar contra el IC95 de `simulate()`.

Corre `--replications` corridas independientes (semilla `seed + i`), igual que
`scenario.run.replications` en Lila (R-ARR-8): comparar un único run de SimPy contra el IC95 de
30 replicaciones de Lila no es válido (el IC95 de una media de 30 muestras es mucho más angosto
que el ruido de una sola corrida) — así que el test de vitest calcula el IC95 de **ambos** lados
con la misma fórmula y compara si se solapan, en vez de exigir que el punto de SimPy caiga
dentro del IC95 de Lila.

Uso: `uv run --with simpy python tools/oracles/des_simpy.py --n 5000 --seed 42 --replications 30`
(`simpy` no está instalado globalmente; `uv run --with` lo resuelve al vuelo).

Imprime un único JSON por stdout: `{params, replications: [{cycleTime, resources}, ...]}`.
"""

import argparse
import json
import random

import simpy

# Mismas 5 tareas del benchmark original (bench/des.js / bench/des_simpy.py), capacidades 1-3.
TASKS = [
    {"id": "T1", "cap": 2, "min": 5, "mode": 8, "max": 15},
    {"id": "T2", "cap": 3, "min": 10, "mode": 20, "max": 30},
    {"id": "T3", "cap": 1, "min": 3, "mode": 5, "max": 8},
    {"id": "T4", "cap": 2, "min": 8, "mode": 12, "max": 20},
    {"id": "T5", "cap": 1, "min": 2, "mode": 4, "max": 7},
]


def percentile(sorted_values, p):
    """Percentil empírico con interpolación lineal, idéntico a `metrics.ts#percentile`."""
    if not sorted_values:
        return 0.0
    position = (len(sorted_values) - 1) * p
    lower = int(position)
    upper = -(-position // 1)  # ceil sin importar math
    upper = int(upper)
    left = sorted_values[lower]
    if lower == upper:
        return left
    return left + (sorted_values[upper] - left) * (position - lower)


def run_once(n: int, seed: int, arrival_mean: float):
    rnd = random.Random(seed)
    env = simpy.Environment()
    resources = [simpy.Resource(env, capacity=t["cap"]) for t in TASKS]
    busy_time = [0.0] * len(TASKS)
    wait_sum = [0.0] * len(TASKS)
    wait_n = [0] * len(TASKS)
    cycle_times = []

    def case(t0):
        for k, t in enumerate(TASKS):
            enabled_at = env.now
            with resources[k].request() as req:
                yield req
                wait_sum[k] += env.now - enabled_at
                wait_n[k] += 1
                d = rnd.triangular(t["min"], t["max"], t["mode"])
                busy_time[k] += d
                yield env.timeout(d)
        cycle_times.append(env.now - t0)

    def generator():
        for _ in range(n):
            yield env.timeout(rnd.expovariate(1 / arrival_mean))
            env.process(case(env.now))

    env.process(generator())
    env.run()  # sin `until`: para sola al vaciarse el heap (R-ARR-3), igual que `simulate()`.

    now = env.now
    cycle_times.sort()
    resource_metrics = [
        {
            "id": t["id"],
            "capacity": t["cap"],
            # busyTime/(capacity × statisticsDuration), docs/RESULTS_FORMAT.md §4; sin
            # calendarios ni warmup, statisticsDuration = `now` (ADR-016, caso M2).
            "utilization": busy_time[k] / (t["cap"] * now) if now > 0 else 0.0,
            "busyTime": busy_time[k],
            "waitMean": wait_sum[k] / wait_n[k] if wait_n[k] > 0 else 0.0,
        }
        for k, t in enumerate(TASKS)
    ]

    return {
        "now": now,
        "cycleTime": {
            "mean": sum(cycle_times) / len(cycle_times) if cycle_times else 0.0,
            "p95": percentile(cycle_times, 0.95),
        },
        "resources": resource_metrics,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--n", type=int, default=5000, help="casos por replicación")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--replications", type=int, default=30)
    parser.add_argument("--arrival-mean", type=float, default=10.0, help="media de la exponencial de llegadas, en segundos")
    args = parser.parse_args()

    replications = [run_once(args.n, args.seed + i, args.arrival_mean) for i in range(args.replications)]
    print(json.dumps({
        "params": {"n": args.n, "seed": args.seed, "replications": args.replications, "arrivalMean": args.arrival_mean},
        "replications": replications,
    }))
