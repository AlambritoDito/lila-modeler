# Open Process Platform — Working Title

> Plataforma open source de modelado, análisis y simulación de procesos BPMN, diseñada desde el inicio para humanos y agentes de IA.

## Estado

Proyecto en etapa de definición y prototipado.

La prioridad inicial es construir o integrar un **motor de simulación BPMN cuantitativa** que pueda reemplazar la parte de simulación de herramientas como Bizagi, sin depender de Windows y manteniendo compatibilidad con archivos `.bpmn` estándar.

## Visión

La plataforma deberá poder funcionar:

- En navegador.
- Localmente en una computadora.
- En un servidor propio.
- Como despliegue self-hosted mediante Docker.
- Eventualmente como aplicación de escritorio mediante un wrapper web como Tauri, si aporta valor.

La UI estará pensada tanto para uso humano como para colaboración con agentes de IA.

El objetivo a largo plazo no es solamente ser un modelador BPMN, sino una plataforma de **Process Intelligence** que combine:

- Modelado BPMN.
- Simulación operacional.
- Documentación de actividades.
- RACI.
- Roles.
- Sistemas.
- Documentos.
- Riesgos.
- Controles.
- KPIs.
- Versionado AS-IS / TO-BE.
- Análisis automatizado.
- Agentes de entrevistas.
- Generación asistida de procesos.
- API.
- MCP.
- Process Mining en una etapa posterior.

## Principios del proyecto

1. **BPMN estándar primero**
   - Importar y exportar archivos `.bpmn`.
   - Evitar formatos propietarios como fuente principal.
   - Las extensiones propias deben convivir con BPMN estándar.

2. **No reinventar lo que ya funciona**
   - Evaluar librerías y motores existentes.
   - Reutilizar piezas activas y con licencias compatibles.
   - Probar antes de decidir.

3. **Fork cuando tenga sentido**
   - Si una pieza es técnicamente valiosa pero dejó de mantenerse, considerar un fork.
   - Si se hace fork, el proyecto asumirá explícitamente su mantenimiento.
   - Evitar depender críticamente de proyectos abandonados sin control sobre el código.

4. **API-first**
   - Toda operación importante disponible en UI debe poder ejecutarse programáticamente.

5. **Agent-first**
   - Los agentes deben poder leer, crear, modificar, analizar y simular procesos mediante API/MCP.

6. **Web-first**
   - La misma aplicación debe funcionar en macOS, Windows, Linux y servidores.

7. **Motor desacoplado de la UI**
   - El simulador debe funcionar sin navegador.
   - Debe poder ejecutarse por CLI, API, tests y MCP.

## Primer objetivo útil

Ejecutar:

```bash
process-sim run process.bpmn scenario.json
```

y obtener resultados como:

```text
Simulation: AS-IS
Cases: 10,000

Average cycle time      11m 42s
Average waiting time     5m 18s
P95 cycle time          23m 11s

Resource utilization
Cashier                 91.3 %
Cook                    72.4 %

Primary bottleneck
Cashier

Throughput
48.2 cases/hour
```

Ese milestone debe existir antes de construir la plataforma completa.
