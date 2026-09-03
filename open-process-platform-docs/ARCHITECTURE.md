# Architecture

## Objetivo

Mantener el producto modular para poder reemplazar componentes individuales sin reescribir toda la plataforma.

## Arquitectura de alto nivel

```text
┌──────────────────────────────────────────────┐
│                   Web UI                     │
│        React / TypeScript / BPMN editor      │
│                                              │
│ Modeler │ Simulation │ RACI │ Repository     │
└───────────────────┬──────────────────────────┘
                    │
              REST / WebSocket
                    │
┌───────────────────▼──────────────────────────┐
│              Application API                 │
│                                              │
│ Processes │ Versions │ Analysis │ Simulation │
│ Roles │ RACI │ Risks │ Controls │ Documents  │
└───────────────┬───────────────────┬──────────┘
                │                   │
        ┌───────▼────────┐   ┌──────▼─────────┐
        │ Simulation Core│   │   MCP Server   │
        │                │   │                │
        │ BPMN → Events  │   │ Agent tools    │
        └───────┬────────┘   └────────────────┘
                │
        ┌───────▼────────┐
        │ DES Scheduler  │
        │ SimPy / other  │
        └────────────────┘

                │
        ┌───────▼────────┐
        │   PostgreSQL   │
        └────────────────┘
```

## Capas

### 1. BPMN Editor

Responsabilidades:

- Crear diagramas.
- Editar diagramas.
- Importar `.bpmn`.
- Exportar `.bpmn`.
- Validar sintaxis y estructura.
- Integrar propiedades propias.

Candidato inicial:

- `bpmn-js`.

La decisión definitiva dependerá de:

- Actividad del proyecto.
- Calidad de extensibilidad.
- Licencia.
- Compatibilidad BPMN.
- Posibilidad de mantener la pieza a largo plazo.

## 2. Domain Model

No depender exclusivamente del XML BPMN como base de datos.

Entidades previstas:

```text
Process
ProcessVersion
Diagram
Activity
Role
System
Document
Risk
Control
KPI
RACIEntry
SimulationScenario
SimulationRun
Interview
Finding
Improvement
```

Cada entidad relacionada con el diagrama deberá poder referenciar:

```text
bpmn_element_id
```

Ejemplo:

```text
Activity
────────────────────────────
id
process_version_id
bpmn_element_id
name
description
purpose
owner_role_id
system_id
inputs
outputs
business_rules
```

## 3. BPMN Interchange

`.bpmn` será formato estándar de intercambio.

Principio:

```text
Internal model ≠ BPMN XML
```

El BPMN deberá poder:

- Importarse.
- Exportarse.
- Preservar extensiones compatibles.
- Ser abierto por otras herramientas cuando sea posible.

## 4. Simulation Engine

Debe ser independiente de:

- React.
- bpmn-js.
- navegador.
- base de datos.

Interfaces esperadas:

```text
CLI
REST API
Python API
MCP
Tests
```

## 5. Persistence

PostgreSQL es la opción preferida para el producto completo.

Para prototipos iniciales:

- Archivos JSON.
- SQLite.
- In-memory.

No introducir infraestructura innecesaria antes de validar el motor.

## 6. Deployment

### Local

```text
docker compose up
```

### Servidor

```text
Docker
Linux
PostgreSQL
Reverse proxy
HTTPS
```

### Desktop futuro

Posible wrapper:

- Tauri.

No es prioridad inicial.

## 7. API-first

La UI no debe contener lógica de negocio que no esté disponible en servicios.

Ejemplo:

```text
UI ──────┐
REST ────┼── Domain Services
MCP ─────┘
```

Esto permite que un agente haga lo mismo que un usuario.
