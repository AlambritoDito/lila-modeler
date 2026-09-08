# tools/oracles — validación numérica del motor

Scripts sin dependencias en `core/` que sirven de oráculo independiente para verificar que
`simulate()` mide lo que dice medir (`docs/RESULTS_FORMAT.md`). Ninguno se ejecuta en `npm test`
normal.

- `erlang_c.ts` — fórmula cerrada M/M/c (LILA-011), usada por `packages/engine/test/mm1.test.ts`
  (siempre corre, sin flag).
- `des_simpy.py` — implementación independiente en SimPy del modelo de 5 tareas secuenciales con
  recursos de capacidad 1-3 (LILA-049), usada por
  `packages/engine/test/theory-simpy.test.ts`.
- `to_prosimos.py` + `run_prosimos.py` + `run_prosimos.sh` — el mismo modelo corrido con Prosimos
  (LILA-052). Prosimos **no declara licencia**, así que ni su código ni sus binarios entran al
  repo: sólo se congela su salida en `packages/engine/test/fixtures/oracles/prosimos-chain5.json`,
  que `packages/engine/test/theory-prosimos.test.ts` compara **siempre** (sin Python, también en
  CI). Ver `docs/ORACLES.md` para el estado de licencia, la conversión del escenario y las
  tolerancias.

## `ORACLES=1 npm test`

`theory-simpy.test.ts` se salta por defecto (`describe.skipIf(!process.env.ORACLES)`) porque
lanza un proceso Python con SimPy, que no es dependencia del repo. Con la variable puesta:

```bash
ORACLES=1 npm test -- theory-simpy
```

corre el mismo modelo (5 tareas, capacidades 1-3, llegadas exponenciales, duraciones
triangulares) dos veces — con `simulate()` (30 replicaciones) y con `des_simpy.py` (30
replicaciones independientes vía `uv run --with simpy`, que no requiere `simpy` instalado
globalmente) — y compara sus intervalos de confianza al 95 % (ciclo medio, p95 del ciclo,
utilización y espera media por recurso): el test pasa si los dos IC95 se solapan.

No se compara un único run de SimPy contra el IC95 de Lila: con 30 replicaciones de Lila ese
IC95 es más angosto que el ruido de una sola corrida de SimPy, así que un solo punto cae fuera
por azar aunque el modelo sea idéntico (se confirmó empíricamente antes de escribir el test).
Correr el mismo número de replicaciones en ambos lados y comparar IC95 contra IC95 es la
comparación estadísticamente válida.

`uv` (`https://astral.sh/uv`) resuelve `simpy` al vuelo sin tocar el entorno del repo:

```bash
uv run --with simpy python tools/oracles/des_simpy.py --n 5000 --seed 42 --replications 30
```
