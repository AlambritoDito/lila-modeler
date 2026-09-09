# Architecture Decision Log

Este documento registra decisiones actuales. Son reversibles mientras el proyecto esté en etapa temprana.

---

## ADR-001 — BPMN as interchange standard

**Status:** Accepted

Usaremos archivos `.bpmn` estándar para importación y exportación.

El XML BPMN no será necesariamente nuestra única base de datos interna.

### Reason

- Interoperabilidad.
- Evitar lock-in.
- Compatibilidad con herramientas existentes.
- Permitir que el archivo sobreviva al producto.

---

## ADR-002 — Web-first platform

**Status:** Accepted

La aplicación principal será web.

Debe poder ejecutarse:

- Local.
- Self-hosted.
- Servidor.
- Cloud.

Desktop wrapper será opcional.

---

## ADR-003 — API-first and agent-first

**Status:** Accepted

Las operaciones de dominio deberán exponerse mediante servicios reutilizables.

UI y MCP utilizarán esos servicios.

---

## ADR-004 — Simulation before full BPM suite

**Status:** Accepted

El primer producto funcional será el motor de simulación.

RACI, repository, interviews y process mining vendrán después.

---

## ADR-005 — Evaluate before fork

**Status:** Accepted

No reescribir ni forkear por reflejo.

Proceso:

```text
Discover
↓
Evaluate
↓
PoC
↓
Decide:
Use / Wrap / Fork / Replace
```

---

## ADR-006 — Own the abstraction layer

**Status:** Accepted

Incluso si utilizamos un motor externo, la plataforma hablará con una interfaz propia.

Esto permite reemplazar componentes en el futuro.

---

## ADR-007 — Scenario separated from diagram

**Status:** Accepted

Los parámetros de simulación deberán poder existir como escenarios independientes del BPMN.

Esto permite múltiples escenarios sobre un mismo proceso.

---

## ADR-008 — No final product name yet

**Status:** Accepted

Usar `Open Process Platform` como working title hasta definir:

- Posicionamiento.
- Marca.
- Dominio.
- Licencia.
- Público objetivo.
