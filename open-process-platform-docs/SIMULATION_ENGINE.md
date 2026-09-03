# Simulation Engine

## Prioridad

El motor de simulación es la primera pieza funcional del proyecto.

Antes de construir RACI, repositorios, entrevistas con IA o process mining, debemos tener una simulación cuantitativa funcional.

## Tipo de simulación

Se requiere **Discrete Event Simulation (DES)**.

No confundir con token simulation.

### Token simulation

Sirve para:

- Visualizar rutas.
- Entender gateways.
- Ver el movimiento lógico del proceso.

No sirve por sí sola para:

- Colas.
- Recursos.
- Utilización.
- Costos.
- Llegadas.
- Distribuciones.
- Cycle time.
- Throughput.

### Operational simulation

Debe modelar:

- Casos.
- Tiempo.
- Colas.
- Recursos.
- Capacidad.
- Calendarios.
- Distribuciones.
- Probabilidades.
- Costos.
- Eventos.

## MVP del motor

### BPMN soportado

Primera versión:

- Start Event.
- End Event.
- Task.
- Sequence Flow.
- Exclusive Gateway.
- Parallel Gateway.

Después:

- Inclusive Gateway.
- Intermediate Events.
- Timer Events.
- Subprocesses.
- Boundary Events.
- Message Events.

## Parámetros de simulación

### Cases

- Número de instancias.
- Duración total.
- Warm-up.
- Random seed.

### Arrival

Distribuciones iniciales:

- Constant.
- Uniform.
- Exponential.
- Normal.
- Triangular.

Después:

- Log-normal.
- Gamma.
- Empirical distribution.
- Arrival calendars.

### Activities

Cada actividad puede tener:

```json
{
  "duration": {
    "distribution": "triangular",
    "min": 300,
    "mode": 480,
    "max": 900
  }
}
```

### Resources

```json
{
  "id": "credit-analyst",
  "capacity": 3,
  "cost_per_hour": 220,
  "calendar": "business-hours"
}
```

### Gateways

```json
{
  "gateway_id": "approval-decision",
  "flows": {
    "approved": 0.78,
    "rejected": 0.22
  }
}
```

## Simulation Scenario

Separar escenario y diagrama.

Ejemplo:

```json
{
  "scenario": "AS-IS",
  "arrivals": {
    "type": "exponential",
    "mean": 240
  },
  "resources": [],
  "activities": {},
  "routing": {}
}
```

Esto permite usar un mismo BPMN con múltiples escenarios:

```text
AS-IS
TO-BE A
TO-BE B
Peak demand
Low demand
Extra employee
Automation
```

## Pipeline

```text
BPMN
 ↓
Parser
 ↓
Intermediate Representation
 ↓
Validator
 ↓
Simulation Compiler
 ↓
DES Scheduler
 ↓
Event Log
 ↓
Metrics
```

## Intermediate Representation

El motor no debe ejecutar directamente el XML.

Ejemplo conceptual:

```json
{
  "process": "credit-request",
  "nodes": [
    {
      "id": "receive",
      "type": "task"
    },
    {
      "id": "review",
      "type": "task"
    },
    {
      "id": "decision",
      "type": "exclusive_gateway"
    }
  ],
  "edges": []
}
```

## DES Scheduler

Estrategia:

1. Evaluar motores/librerías existentes.
2. Probarlos con procesos reales.
3. Elegir el más estable y mantenible.
4. Encapsularlo detrás de una interfaz propia.

No permitir que todo el código del proyecto dependa directamente de una librería.

Interfaz conceptual:

```python
class SimulationScheduler:
    def now(self): ...
    def schedule(self, event): ...
    def request_resource(self, resource): ...
    def release_resource(self, resource): ...
    def run(self): ...
```

Así se podría migrar en el futuro entre:

```text
SimPy
Custom engine
Rust engine
Other DES engine
```

## Outputs iniciales

- Completed cases.
- Failed cases.
- Average cycle time.
- Median cycle time.
- P90.
- P95.
- Processing time.
- Waiting time.
- Queue time.
- Queue length.
- Resource utilization.
- Resource waiting.
- Throughput.
- Cost per case.
- Total cost.
- Bottleneck candidate.

## Event Log

Cada ejecución debe poder generar un event log.

Ejemplo:

```text
case_id
activity_id
resource_id
event_type
timestamp
duration
queue_time
cost
```

Esto será útil posteriormente para:

- Debugging.
- Charts.
- Process mining.
- Comparación contra datos reales.
