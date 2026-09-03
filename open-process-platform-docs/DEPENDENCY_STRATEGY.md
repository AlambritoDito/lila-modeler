# Dependency and Fork Strategy

## Objetivo

Aprovechar piezas existentes sin convertir el proyecto en rehén de dependencias abandonadas.

## Regla general

Antes de adoptar una dependencia crítica evaluar:

1. Licencia.
2. Actividad reciente.
3. Número de contribuidores.
4. Calidad del código.
5. Cobertura de tests.
6. API estable.
7. Dependencias transitivas.
8. Facilidad de fork.
9. Complejidad de mantenimiento.
10. Importancia estratégica para el producto.

## Clasificación

### A. Commodity dependency

Ejemplos:

- JSON parser.
- HTTP framework.
- ORM.
- UI primitives.

Normalmente se usa directamente.

### B. Strategic dependency

Ejemplos:

- BPMN editor.
- Simulation engine.
- BPMN parser.

Debe estar encapsulada detrás de interfaces propias.

### C. Candidate for fork

Una pieza puede ser candidata si:

- Resuelve una parte difícil.
- Código razonablemente bueno.
- Licencia compatible.
- Proyecto poco activo o abandonado.
- Costaría más reescribirlo desde cero que mantenerlo.
- Podemos asumir ownership técnico.

## Política de fork

Un fork no debe hacerse sólo para “tener control”.

Debe existir una razón concreta:

- Proyecto abandonado.
- Roadmap incompatible.
- Bugs críticos no resueltos.
- Cambios necesarios rechazados upstream.
- Necesidad de eliminar dependencias.
- Necesidad de integrar profundamente el motor.

Si se hace fork:

- Cambiar namespace.
- Mantener atribuciones requeridas.
- Documentar origen.
- Crear política de releases.
- Añadir CI.
- Añadir tests.
- Reducir deuda antes de agregar funciones.

## BPMN editor

Candidato actual:

- bpmn-js.

Antes de confirmar:

- Crear PoC.
- Importar BPMN real.
- Modificar UX.
- Probar custom properties.
- Probar extensions.
- Probar serialization.
- Probar diagrams grandes.
- Revisar licencia vigente.

## Simulation engines

No comprometerse todavía con un motor.

Evaluar:

- Motores BPMN existentes.
- Motores DES generales.
- Librerías Python.
- Librerías TypeScript.
- Motores escritos en otros lenguajes.

Criterio:

> Si el motor BPMN existente nos ahorra trabajo real y podemos mantenerlo, usarlo o forkearlo.  
> Si está demasiado acoplado, viejo o limitado, construir nuestra capa BPMN sobre un DES general.

## Regla de arquitectura

Nunca:

```text
Whole product → third-party engine internals
```

Preferir:

```text
Whole product
      ↓
Our Simulation Interface
      ↓
Adapter
      ↓
Third-party engine
```

## Investigación continua

Mantener una tabla en este repositorio:

| Proyecto | Tipo | Actividad | Licencia | PoC | Decisión |
|---|---|---:|---|---|---|
| bpmn-js | Editor | TBD | TBD | Pending | Evaluate |
| SimPy | DES | TBD | TBD | Pending | Evaluate |
| Scylla | BPMN Simulation | Low | MIT reported | Pending | Research/Fork candidate |
| Prosimos | BPMN Simulation | Low/Unknown | Verify | Pending | Research |
| BIMP/QBP | BPMN Simulation | Mixed | Verify | Pending | Academic reference |

No considerar esta tabla como auditoría legal. Revisar licencias nuevamente antes de distribuir software.
