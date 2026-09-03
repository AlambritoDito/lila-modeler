# Product Vision

## Problema

Las herramientas BPM tradicionales suelen tener varias limitaciones:

- Dependencia de sistemas operativos específicos.
- Interfaces envejecidas.
- UX poco cuidada en operaciones básicas.
- Simulación incluida sólo en productos comerciales.
- Ecosistemas cerrados.
- Integraciones limitadas para agentes.
- APIs pensadas como complemento y no como parte central de la arquitectura.
- Separación artificial entre modelado, documentación, análisis y automatización.

Ejemplo de fricción que el producto debe evitar:

En algunos modeladores, al crear una actividad aparece un texto predeterminado como `Task 1`, obligando al usuario a seleccionar y borrar manualmente el contenido antes de escribir.

La nueva plataforma debe tratar estos detalles como parte esencial del producto.

## Propuesta

Crear una alternativa open source a herramientas como Bizagi y ADONIS, con un diseño moderno y preparado para agentes.

La plataforma deberá ofrecer una experiencia integrada para:

- Diseñar procesos.
- Documentarlos.
- Analizarlos.
- Simularlos.
- Comparar escenarios.
- Administrar responsabilidades.
- Identificar riesgos y controles.
- Colaborar con agentes.
- Mantener un repositorio organizacional de procesos.

## Diferenciador

El producto no debe posicionarse únicamente como:

> “Un Bizagi open source.”

La visión es:

> **An open process intelligence platform built for humans and AI agents.**

Arquitecturalmente:

```text
Human ──┐
        ├── Process Platform ── Process Model
Agent ──┘
```

La UI y los agentes deben utilizar el mismo dominio y las mismas operaciones.

## Casos de uso iniciales

### Académico

- Modelar BPMN.
- Configurar tiempos.
- Configurar recursos.
- Configurar probabilidades.
- Ejecutar simulaciones.
- Comparar AS-IS y TO-BE.
- Encontrar cuellos de botella.

### Empresa

- Repositorio central de procesos.
- Versionado.
- Identificación de responsables.
- Sistemas utilizados.
- Entradas y salidas.
- Riesgos.
- Controles.
- KPIs.
- RACI.

### Agentes

Un agente podrá:

- Entrevistar a participantes de un proceso.
- Extraer actividades, decisiones y actores.
- Crear un borrador AS-IS.
- Detectar contradicciones.
- Solicitar información faltante.
- Actualizar el proceso.
- Proponer escenarios TO-BE.
- Ejecutar simulaciones.
- Analizar resultados.

## Filosofía UX

La UI deberá sentirse moderna incluso en acciones pequeñas.

Ejemplos:

- Nueva tarea → edición inmediata del nombre.
- Sin `Task 1` innecesario.
- Autocomplete opcional.
- Sugerencias del agente sin bloquear escritura manual.
- Propiedades accesibles sin navegar por múltiples diálogos.
- Undo/redo consistente.
- Atajos.
- Drag & drop natural.
- Acciones masivas.
- Navegación rápida por actividades.
- Validación en tiempo real.
- Historial de cambios.
