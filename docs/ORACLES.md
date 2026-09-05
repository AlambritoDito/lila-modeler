# Oráculos numéricos

Los oráculos son implementaciones **independientes** del mismo modelo, usadas para verificar que
`simulate()` mide lo que dice medir (`docs/RESULTS_FORMAT.md`). Son la aceptación (b) de M2 en
`LILA_MODELER_ESTRUCTURA.md` §7: si el motor y un simulador ajeno no coinciden, el que está mal
es casi siempre el motor.

Regla del proyecto (`LILA_MODELER_ESTRUCTURA.md` §6, punto 4): **ni una línea de código ni un
binario de un simulador externo entra al repo**. Lo que se versiona es, o bien el script que lo
invoca desde un entorno efímero, o bien su salida congelada como fixture con tolerancia
estadística.

| Oráculo | Ticket | Qué valida | Cuándo corre |
|---|---|---|---|
| `tools/oracles/erlang_c.ts` | LILA-011 | Fórmula cerrada M/M/c | Siempre (`packages/engine/test/mm1.test.ts`) |
| `tools/oracles/des_simpy.py` | LILA-049 | DES independiente en SimPy (MIT) | Sólo con `ORACLES=1` (lanza Python) |
| `tools/oracles/run_prosimos.py` | LILA-052 | DES BPMN independiente en Prosimos | Siempre, contra fixture congelado |

---

## SimPy (LILA-049)

MIT, se resuelve al vuelo con `uv run --with simpy`, así que no hay nada que congelar: el test
lanza el proceso Python y compara los IC95 de 30 replicaciones de cada lado.

```bash
ORACLES=1 npx vitest run packages/engine/test/theory-simpy.test.ts
```

Detalle del método (por qué IC95 contra IC95 y no punto contra IC95) en `tools/oracles/README.md`.

---

## Prosimos (LILA-052)

[Prosimos](https://github.com/AutomatedProcessImprovement/Prosimos) (Universidad de Tartu) es el
motor DES BPMN open source con mejor semántica de recursos, y el más parecido a lo que hace Lila.

### Estado de licencia: **sin licencia**

Verificado el 2026-09-03 (`investigacion-2026-09-03/05-simuladores-open-source.md`) y otra vez al
escribir este documento:

- El repo `AutomatedProcessImprovement/Prosimos` **no tiene archivo `LICENSE`** en `main`; la API
  de GitHub devuelve `license: null` y `GET /license` responde 404.
- Su `pyproject.toml` no declara campo de licencia, y el `METADATA` del wheel publicado en PyPI
  (`prosimos 2.0.6`) tampoco trae `License` ni clasificador de licencia.
- Además el repo incluye binarios **propietarios** de terceros
  (`bimp_simulation_engine/qbp-simulator-engine.jar`, del simulador cerrado QBP).

Sin licencia expresa, el default legal es "todos los derechos reservados": no se puede copiar,
adaptar ni redistribuir su código. **Sí** se puede instalar el paquete publicado y ejecutarlo, que
es lo único que hacemos. Por eso:

- ni código ni jars de Prosimos entran al repo;
- el venv se crea **fuera** del árbol de trabajo y se borra al terminar;
- lo versionado es la conversión propia (`tools/oracles/to_prosimos.py`), el driver que lee su
  salida (`tools/oracles/run_prosimos.py`) y las **cifras** resultantes
  (`packages/engine/test/fixtures/oracles/prosimos-chain5.json`);
- **el job no está en CI**: el test que corre en CI sólo lee el fixture, no necesita Python.

Los repos hermanos (`prosimos-docker`, `prosimos-frontend`, `prosimos-microservice`) sí son
Apache-2.0, lo que sugiere una intención permisiva no formalizada. Si algún día aparece un
`LICENSE` en `main`, esta sección se revisa.

### El modelo comparado

El mismo de `tools/oracles/des_simpy.py`: 5 tareas secuenciales, un pool de recursos por tarea con
capacidad 1-3, llegadas exponenciales de media 10 s, 5000 casos, sin calendarios (24×7), sin
warmup. Así hay **tres patas sobre el mismo modelo**: Lila, SimPy y Prosimos.

Una desviación deliberada: **las duraciones son uniformes, no triangulares**. Prosimos no
implementa la triangular — `DistributionType.TRIANGULAR` existe en el enum de `pix_framework`
pero `DurationDistribution.from_dict` no tiene rama para `triang` y devuelve `None`, que revienta
al muestrear. Aproximarla con otra familia (normal truncada con media y varianza igualadas, por
ejemplo) compararía dos leyes distintas y convertiría cualquier discrepancia en ruido no
atribuible. La uniforme sobre el mismo `[min, max]` la muestrean **idénticamente** los dos
motores (Lila `{"type":"uniform","min":a,"max":b}`; Prosimos `st.uniform.rvs(loc=a, scale=b-a)`),
así que la comparación mide semántica de cola y contabilidad de métricas, que es lo que interesa.

Otras equivalencias de la conversión, todas en `tools/oracles/to_prosimos.py`:

| Lila | Prosimos |
|---|---|
| `resources[id].capacity: n` | pool con `resource_list[0].amount: n` (expande a `n` recursos de 1 unidad) |
| `{"type":"exponential","mean":10}` | `expon` con `params [mean=10, min=0, max=1e6]` (`st.expon.rvs(loc=0, scale=10)`; el `max` es el truncamiento por rechazo, puesto tan alto que no actúa) |
| sin calendario ⇒ 24×7 | `resource_calendars` y `arrival_time_calendar` con los 7 días de `00:00:00.000` a `23:59:59.999` (Prosimos no acepta `24:00:00`: el hueco de 1 ms/día es despreciable) |
| primera llegada en `t = 0` (R-ARR-1) | `generate_all_arrival_events` arranca en `arrival_time = 0` |
| parada al vaciarse la cola (R-ARR-3) | la cola de eventos se agota sola; no se usa `duration` |

Las métricas **no** se toman de las estadísticas propias de Prosimos: su utilización es
`worked_time / available_time` según el calendario del recurso, no
`busyTime / (capacity × statisticsDuration)` (`RESULTS_FORMAT.md` §4). El driver recorre el log en
memoria (`enabled_at` / `started_at` / `completed_at` en segundos) y calcula ciclo, p95,
utilización y espera con la definición de Lila, que es lo único que las hace comparables.

Semilla: Prosimos no expone `seed`. Muestrea vía `scipy.stats`, que usa el RNG global de NumPy, así
que el driver siembra `numpy.random.seed(seed + i)` y `random.seed(seed + i)` antes de cada
replicación. Además le pasa un `starting_at` fijo (lunes 2026-01-05 00:00 UTC): por defecto
Prosimos arranca en `datetime.now()` y, como convierte los tiempos de disponibilidad de recurso a
`datetime` y de vuelta redondeando a microsegundos contra ese origen, dos corridas con la misma
semilla diferían en el octavo dígito. Con las dos cosas, el fixture se regenera bit a bit igual.

### Regenerar el fixture

```bash
tools/oracles/run_prosimos.sh                       # 30 replicaciones × 5000 casos, ~25 s
tools/oracles/run_prosimos.sh --n 2000 --replications 10
```

Crea un venv con `uv` en `${TMPDIR}/lila-prosimos` (configurable con `LILA_PROSIMOS_VENV`),
instala `prosimos` desde PyPI y reescribe el fixture. Python 3.11 porque Prosimos exige `<3.12`.
Desde el test, `ORACLES=1 npx vitest run packages/engine/test/theory-prosimos.test.ts` hace lo
mismo antes de comparar. Borrar el venv al terminar: `rm -rf ${TMPDIR}/lila-prosimos`.

### Tolerancias del test

`packages/engine/test/theory-prosimos.test.ts` compara **media contra media**: el fixture es un
punto congelado y Lila corre con su propio RNG, así que no hay semilla común y el solape de IC95
que usa el test de SimPy no aportaría nada (con 30×5000 los IC95 son de ±0.6 % y el test sería
frágil ante cualquier diferencia de tercer orden). Los márgenes son holgados respecto del ruido
medido:

| KPI | Tolerancia | Por qué |
|---|---|---|
| `process.cycleTime.mean` | ±3 % relativo | IC95 de cada lado ≈ ±0.6 %; deja ~5σ y aun así una espera perdida lo rompe |
| `process.cycleTime.p95` | ±5 % relativo | un percentil de cola varía más entre replicaciones que la media |
| `resources.*.utilization` | ±0.03 **absoluto** | es un ratio en `[0, 1]` con error aditivo; un margen relativo castigaría de más a los recursos poco cargados |
| `elements.*.resourceWait.mean` | ±10 % relativo | la espera en cola crece de forma no lineal con la utilización: es la métrica más ruidosa |

Diferencias observadas al congelar el fixture (2026-09-05, Prosimos 2.0.6): ciclo medio −0.16 %,
p95 +0.07 %, utilizaciones dentro de 0.0013 absoluto, esperas entre −3.7 % (`T4`) y +1.0 % (`T1`).

Si el test falla tras un cambio del motor, la pregunta es cuál de las dos semánticas cambió: el
fixture no se regenera para "arreglar" el rojo sin entender la diferencia.
