# Numeric oracles

> Read this in: [Español](es/ORACLES.md)

Oracles are **independent** implementations of the same model, used to verify that
`simulate()` measures what it claims to measure (`docs/RESULTS_FORMAT.md`). They are acceptance
criterion (b) of M2 in `LILA_MODELER_ESTRUCTURA.md` §7: if the engine and an unrelated simulator
disagree, the one that is wrong is almost always the engine.

Project rule (`LILA_MODELER_ESTRUCTURA.md` §6, point 4): **not a single line of code or binary
from an external simulator enters the repo**. What gets versioned is either the script that
invokes it from an ephemeral environment, or its output frozen as a fixture with a statistical
tolerance.

| Oracle | Ticket | What it validates | When it runs |
|---|---|---|---|
| `tools/oracles/erlang_c.ts` | LILA-011 | Closed-form M/M/c formula | Always (`packages/engine/test/mm1.test.ts`) |
| `tools/oracles/des_simpy.py` | LILA-049 | Independent DES in SimPy (MIT) | Only with `ORACLES=1` (launches Python) |
| `tools/oracles/run_prosimos.py` | LILA-052 | Independent BPMN DES in Prosimos | Always, against a frozen fixture |

---

## SimPy (LILA-049)

MIT, resolved on the fly with `uv run --with simpy`, so there is nothing to freeze: the test
launches the Python process and compares the 95% CIs of 30 replications from each side.

```bash
ORACLES=1 npx vitest run packages/engine/test/theory-simpy.test.ts
```

Method details (why 95% CI vs 95% CI and not point vs 95% CI) are in `tools/oracles/README.md`.

---

## Prosimos (LILA-052)

[Prosimos](https://github.com/AutomatedProcessImprovement/Prosimos) (University of Tartu) is the
open source BPMN DES engine with the best resource semantics, and the closest to what Lila does.

### License status: **unlicensed**

Verified on 2026-09-03 (`investigacion-2026-09-03/05-simuladores-open-source.md`) and again while
writing this document:

- The `AutomatedProcessImprovement/Prosimos` repo **has no `LICENSE` file** on `main`; the GitHub
  API returns `license: null` and `GET /license` responds 404.
- Its `pyproject.toml` declares no license field, and the `METADATA` of the wheel published on
  PyPI (`prosimos 2.0.6`) carries no `License` field or license classifier either.
- The repo also includes **proprietary** third-party binaries
  (`bimp_simulation_engine/qbp-simulator-engine.jar`, from the closed-source QBP simulator).

With no express license, the legal default is "all rights reserved": its code cannot be copied,
adapted, or redistributed. What **is** allowed is installing the published package and running
it, which is all we do. Because of that:

- neither Prosimos code nor jars enter the repo;
- the venv is created **outside** the working tree (in `${TMPDIR}`) and deleted by hand when
  done (`rm -rf ${TMPDIR}/lila-prosimos`); the script does not leave it inside the repo;
- what is versioned is our own conversion (`tools/oracles/to_prosimos.py`), the driver that reads
  its output (`tools/oracles/run_prosimos.py`), and the resulting **figures**
  (`packages/engine/test/fixtures/oracles/prosimos-chain5.json`);
- **the job is not in CI**: the test that runs in CI only reads the fixture and needs no Python.

The sibling repos (`prosimos-docker`, `prosimos-frontend`, `prosimos-microservice`) are indeed
Apache-2.0, which suggests a permissive intent that was never formalized. If a `LICENSE` ever
appears on `main`, this section gets revisited.

### The model being compared

The same one as `tools/oracles/des_simpy.py`: 5 sequential tasks, one resource pool per task with
capacity 1-3, exponential arrivals with mean 10 s, 5000 cases, no calendars (24×7), no warmup.
That gives **three legs on the same model**: Lila, SimPy, and Prosimos.

One deliberate deviation: **durations are uniform, not triangular**. Prosimos does not implement
the triangular distribution — `DistributionType.TRIANGULAR` exists in `pix_framework`'s enum but
`DurationDistribution.from_dict` has no branch for `triang` and returns `None`, which blows up
when sampling. Approximating it with another family (a truncated normal with matched mean and
variance, for example) would compare two different laws and turn any discrepancy into noise that
cannot be attributed. The uniform distribution over the same `[min, max]` is sampled
**identically** by both engines (Lila `{"type":"uniform","min":a,"max":b}`; Prosimos
`st.uniform.rvs(loc=a, scale=b-a)`), so the comparison measures queue semantics and metric
accounting, which is what matters.

Other equivalences from the conversion, all in `tools/oracles/to_prosimos.py`:

| Lila | Prosimos |
|---|---|
| `resources[id].capacity: n` | pool with `resource_list[0].amount: n` (expands into `n` one-unit resources) |
| `{"type":"exponential","mean":10}` | `expon` with `params [mean=10, min=0, max=1e6]` (`st.expon.rvs(loc=0, scale=10)`; the `max` is the rejection-sampling cap, set high enough that it never triggers) |
| no calendar ⇒ 24×7 | `resource_calendars` and `arrival_time_calendar` with all 7 days from `00:00:00.000` to `23:59:59.999` (Prosimos does not accept `24:00:00`: the 1 ms/day gap is negligible) |
| first arrival at `t = 0` (R-ARR-1) | `generate_all_arrival_events` starts at `arrival_time = 0` |
| stop when the queue drains (R-ARR-3) | the event queue simply runs out; `duration` is unused |

Metrics are **not** taken from Prosimos's own statistics: its utilization is
`worked_time / available_time` per the resource's calendar, not
`busyTime / (capacity × statisticsDuration)` (`RESULTS_FORMAT.md` §4). The driver walks the
in-memory log (`enabled_at` / `started_at` / `completed_at` in seconds) and computes cycle time,
p95, utilization, and wait using Lila's definitions, which is the only thing that makes them
comparable.

Seed: Prosimos exposes no `seed`. It samples via `scipy.stats`, which uses NumPy's global RNG, so
the driver seeds `numpy.random.seed(seed + i)` and `random.seed(seed + i)` before each
replication. It also passes a fixed `starting_at` (Monday 2026-01-05 00:00 UTC): by default
Prosimos starts at `datetime.now()` and, since it converts resource-availability times to
`datetime` and back rounding to microseconds against that origin, two runs with the same seed
differed in the eighth digit. With both fixes in place, the fixture regenerates bit-for-bit
identical.

### Regenerating the fixture

```bash
tools/oracles/run_prosimos.sh                       # 30 replicaciones × 5000 casos, ~25 s
tools/oracles/run_prosimos.sh --n 2000 --replications 10
```

Creates a venv with `uv` in `${TMPDIR}/lila-prosimos` (configurable with `LILA_PROSIMOS_VENV`),
installs `prosimos==2.0.6` from PyPI (`LILA_PROSIMOS_VERSION` to try another one), and rewrites
the fixture; the test checks that the fixture's version is still the frozen one. Python 3.11
because Prosimos requires `<3.12`.
From the test, `ORACLES=1 npx vitest run packages/engine/test/theory-prosimos.test.ts` does the
same before comparing. Delete the venv when done: `rm -rf ${TMPDIR}/lila-prosimos`.

### Test tolerances

`packages/engine/test/theory-prosimos.test.ts` compares **mean against mean**: the fixture is a
frozen point and Lila runs with its own RNG, so there is no shared seed, and the 95% CI overlap
used by the SimPy test would add nothing here (with 30×5000 the 95% CIs are ±0.6%, and the test
would become fragile against any third-order difference). The margins are generous relative to
the measured noise:

| KPI | Tolerance | Why |
|---|---|---|
| `process.cycleTime.mean` | ±3% relative | 95% CI on each side ≈ ±0.6%; leaves ~5σ and a single lost wait still breaks it |
| `process.cycleTime.p95` | ±5% relative | a tail percentile varies more between replications than the mean |
| `resources.*.utilization` | ±0.03 **absolute** | it is a ratio in `[0, 1]` with additive error; a relative margin would over-penalize lightly loaded resources |
| `elements.*.resourceWait.mean` | ±10% relative | queue wait grows nonlinearly with utilization: it is the noisiest metric |

Differences observed when freezing the fixture (2026-09-05, Prosimos 2.0.6): mean cycle time
−0.16%, p95 +0.07%, utilizations within 0.0013 absolute, waits between −3.7% (`T4`) and +1.0%
(`T1`).

If the test fails after an engine change, the question is which of the two semantics changed: the
fixture is not regenerated to "fix" the red without understanding the difference.
