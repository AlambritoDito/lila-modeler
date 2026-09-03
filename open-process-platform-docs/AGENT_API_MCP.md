# Agent API and MCP

## Principio

El producto debe ser agent-first.

Un agente no debe automatizar la UI como método principal.

Debe existir una API semántica para procesos.

## Arquitectura

```text
                 ┌──────────── UI
                 │
Domain Services ─┼──────────── REST
                 │
                 └──────────── MCP
```

## Operaciones básicas

### Processes

```text
create_process
get_process
list_processes
update_process
create_process_version
compare_versions
```

### BPMN

```text
import_bpmn
export_bpmn
validate_bpmn
get_element
create_activity
update_activity
delete_activity
connect_elements
create_gateway
```

### Documentation

```text
set_activity_description
set_inputs
set_outputs
set_business_rules
assign_system
assign_document
```

### RACI

```text
create_role
assign_responsible
assign_accountable
assign_consulted
assign_informed
get_raci_matrix
validate_raci
```

### Simulation

```text
create_simulation_scenario
set_arrival_pattern
set_activity_duration
create_resource
set_resource_capacity
set_gateway_probability
run_simulation
get_simulation_results
compare_simulation_runs
find_bottlenecks
```

## Ejemplos de prompts futuros

> Revisa este proceso y dime qué actividades no tienen responsable.

> Simula qué pasa si agregamos un analista más.

> Compara el escenario AS-IS con el TO-BE.

> Identifica actividades que puedan automatizarse.

> Crea un borrador de RACI a partir de la documentación actual.

> Revisa las entrevistas y actualiza el modelo AS-IS.

## Agent-assisted process discovery

Roadmap:

```text
Interview
   ↓
Transcription
   ↓
Entity extraction
   ↓
Activities
Actors
Systems
Documents
Decisions
Times
Pain points
   ↓
Draft process
   ↓
Human review
   ↓
BPMN
```

## Contradiction resolution

Un agente podrá detectar:

```text
Sales says:
"Finance approves every request"

Finance says:
"We only review requests above $X"
```

y crear un finding:

```text
Contradiction:
Approval rule not consistent across interviews.

Needs validation:
Threshold and exception path.
```

## Seguridad

Los agentes deberán respetar los mismos permisos del usuario.

Nunca diseñar un MCP con acceso total implícito.

Permisos previstos:

```text
process:read
process:write
simulation:run
simulation:configure
repository:admin
interview:read
interview:write
```
