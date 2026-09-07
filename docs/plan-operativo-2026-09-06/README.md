# Plan para tener Lila Modeler operando

Auditoría: noche del 6 de septiembre de 2026, America/Mexico_City. Repositorio `AlambritoDito/lila-modeler`, `main` local y remoto en `3a58ecbb91f0b93fb8d350bf25082ce5f84d62e8` al consultar. Máquina observada: macOS arm64; Node 24.16.0 y npm 11.13.0.

## Decisión y cantidad de agentes

**Configuración vigente por cuota: 2 instancias principales —Astra en Codex y Fable en Claude Code—, hasta 3 subagentes económicos activos y 6 responsabilidades A–F.** Los 18 paquetes siguen organizados en 3 rondas lógicas; no abrir seis sesiones manuales. Lee primero [USO-LIMITADO.md](USO-LIMITADO.md). Cada paquete tiene su archivo de ticket, dependencias, responsable y aceptación; son paquetes operativos que agrupan issues existentes y brechas nuevas, no 18 nuevos issues de GitHub.

La entrega principal es una **beta local utilizable en la Mac de Brito**: abrir una aplicación, crear/abrir un proceso propio, editar y documentar, guardar sin perder trabajo, configurar escenarios, simular, consultar resultados y comparar AS-IS/TO-BE. Windows y Linux tienen una segunda puerta de aceptación: sus instaladores se construyen y prueban en sus respectivos sistemas.

Para iniciar, usar [LANZAMIENTO.md](LANZAMIENTO.md) y pegar los prompts [Codex](PROMPT-CODEX.md) y [Claude](PROMPT-CLAUDE.md). [PROMPT-RECUPERACION.md](PROMPT-RECUPERACION.md) retoma el avance si se corta el uso. Brito indicó conservar los restablecimientos gratuitos.

Tres rondas son una organización del trabajo, no una garantía de acabar en tres respuestas de un modelo. Las dependencias y los fallos de integración pueden requerir una ronda correctiva. Reservar el último 25 % de la sesión para instalar, probar y corregir. El resultado de la noche debe ser un artefacto que abre y funciona, con evidencia; la versión pública 1.0.0 puede esperar.

No recomiendo un agente por issue ni 18 agentes editando simultáneamente: el cuello actual está en `main.tsx`, `Modeler.tsx`, `scenario.ts`, contratos de almacenamiento y archivos de dependencias. Más escritores sobre ellos aumenta la integración pendiente.

## Lo comprobado

| Área | Evidencia | Consecuencia |
|---|---|---|
| Base del repositorio | `main` limpio al empezar y coincidente con el SHA remoto | Hay una referencia reproducible para todos |
| Pruebas | `npm test`: 868 pasan, 1 omitida; 66 archivos pasan y 1 omitido | Buena base técnica; la omitida requiere `ORACLES=1` para ejecutar SimPy |
| Tipos | `npm run typecheck` pasa | Motor, MCP y tipos de web compilan |
| Producción web | `npm run build -w @lila/web` pasa; aviso de bundle principal de 783,73 kB | El build raíz no sustituye el build de Vite |
| Editor real | En navegador local abre `pedido`, 31 elementos; Modelar activo | Simular, Resultados y Comparar están deshabilitados en la cabecera |
| Resultados reales | `/results.html` ejecuta AS-IS, semilla 42, 30 réplicas y muestra tablas, CSV y avisos | Existe el componente y funciona el Worker; es una demo aparte, excluida del build de producción |
| Motor | Código y pruebas de recursos, calendarios, réplicas, métricas y comparación | No hay que reescribir el simulador |
| Escritorio | No existe `apps/desktop` ni `DesktopStore` | Falta ventana nativa, archivos y empaquetado |
| Persistencia | `BrowserStore` es memoria + descarga; `ProjectStore` no tiene lectura de escenarios ni historial de runs | Hay que completar el contrato para reabrir proyectos propios |
| GitHub | 95 issues abiertos: 79 tickets y 16 épicas; 13 PR abiertos | No equivalen a 95 tareas necesarias para mañana |
| PR | Los 13 tenían checks Node 22/24 exitosos y aparecían fusionables en sus bases al consultar | Eso no demuestra que la combinación de todos pase ni que el producto esté integrado |

Se inspeccionaron fuentes locales, cuerpos y archivos cambiados de PR, y el `main.tsx`/`ScenarioPanel.tsx` remoto de PR #234. No se ejecutaron aquí todas las ramas pendientes ni instaladores inexistentes. Los defectos provenientes de issues se identifican como reportados, no como todos reproducidos en esta auditoría. El issue #225 quedó corroborado por el log del servidor local: Vite rechazó `bpmn.woff2`, `bpmn.woff` y `bpmn.ttf` porque sus rutas están fuera de `server.fs.allow`. La consulta de consola del navegador no mostró esos errores; el log del servidor sí. OP-06 incluye la corrección mínima y su verificación.

## Brechas que impiden el uso diario

1. **Integración:** propiedades (#215), overlay/simulación (#227), escenario (#234) y comparación (#209) viven en PR separados. Incluso el shell de #234 mantiene los tres modos de cabecera deshabilitados. El ticket #226 ya recoge parte de esta integración.
2. **Proyectos propios:** el shell pendiente carga escenarios de `pedido` en memoria; abrir otro BPMN no los reemplaza por los escenarios de ese proceso. No hay un recorrido completo de importar/crear escenarios y reabrirlos desde una carpeta.
3. **Estado coherente:** en #234 el IR para el panel se recalcula al cambiar de proceso/modelador, no en cada cambio semántico; una tarea recién creada puede faltar en el panel. La simulación exporta el XML actual pero necesita validación del modelo y del escenario, revisión de resultados obsoletos y cancelación visible.
4. **Archivos fiables:** #214, #216 y #220 reportan pérdida de referencias o elementos en import/export. Deben resolverse antes de usar modelos de trabajo. Tampoco existe seguimiento de cambios sin guardar, Guardar como ni protección al cerrar.
5. **Escritorio:** faltan #70–#74. La arquitectura ya eligió Electron y archivos locales (ADR-018/023); no hace falta abrir otra evaluación de frameworks.
6. **Métricas interpretables:** la cadena #229 → #230 → #235 corrige llegadas, ejemplos y capacidad por turno. #236 requiere una decisión explícita sobre utilización con warmup y turnos. #210 pide moneda y avisos en comparación. #228 incluye una corrección de agregación de utilización en cuellos.
7. **Aceptación del producto:** CI no construye actualmente Vite ni comprueba el recorrido completo en una app empaquetada. Hace falta una prueba sobre el artefacto final y el mismo commit que se entrega.

## Plan por agente y ronda

Los números son archivos `OP-xx` en [tickets](tickets/). A–F son responsabilidades lógicas: Codex atiende A y rota C/D; Claude coordina B/E y F. Las rondas permiten paralelismo, pero no eliminan las dependencias ni los límites de concurrencia de USO-LIMITADO.md.

| Agente | Responsabilidad | Ronda 1: base | Ronda 2: funcionamiento | Ronda 3: entrega |
|---|---|---|---|---|
| A | Integrador y aplicación | [OP-01](tickets/OP-01.md) Integrar PR web y fijar contratos | [OP-07](tickets/OP-07.md) Estado, validación, Worker y resultados | [OP-13](tickets/OP-13.md) Proyectos propios y comparar |
| B | Escritorio y datos | [OP-02](tickets/OP-02.md) Electron y puente nativo | [OP-08](tickets/OP-08.md) DesktopStore y carpeta de proyecto | [OP-14](tickets/OP-14.md) Guardado seguro, recientes y cierre |
| C | Integridad BPMN | [OP-03](tickets/OP-03.md) Parser, ids y avisos | [OP-09](tickets/OP-09.md) Import/export sin pérdida silenciosa | [OP-15](tickets/OP-15.md) Nuevo modelo, edición y documentación |
| D | Motor y corrección numérica | [OP-04](tickets/OP-04.md) Integrar cadena del motor | [OP-10](tickets/OP-10.md) Utilización y agregaciones | [OP-16](tickets/OP-16.md) Diagnósticos y evidencia de paridad |
| E | Escenarios, comparación y guía | [OP-05](tickets/OP-05.md) Comparación con moneda y avisos | [OP-11](tickets/OP-11.md) Escenarios y calendarios utilizables | [OP-17](tickets/OP-17.md) Arranque documentado, MCP y licencias |
| F | QA, instaladores y plataformas | [OP-06](tickets/OP-06.md) Pruebas de aplicación y CI | [OP-12](tickets/OP-12.md) Empaquetar macOS/Windows/Linux | [OP-18](tickets/OP-18.md) Validar instalación y recorrido final |

**Arranque:** A publica primero el contrato mínimo de estado/almacenamiento/puente y la base de integración. B/C/D/F pueden avanzar sobre sus módulos existentes en paralelo; E revisa #209 y prepara sus pruebas mientras A lo integra. No empezar una implementación dependiente de una interfaz aún no fijada. Las dependencias que solo requieren contrato se liberan al publicarlo; no obligan a esperar el componente completo.

**Cadena crítica de Mac:** contratos + integración web → DesktopStore + estado/Worker → proyectos/guardar/comparar → artefacto macOS → aceptación. El empaquetado puede empezar antes, pero debe repetirse sobre el commit final. A integra durante toda la sesión, no al final de la tercera ronda.

## Cómo trabajar sin supervisión

Leer [USO-LIMITADO.md](USO-LIMITADO.md) y [COORDINACION.md](COORDINACION.md); entregar los dos prompts de plataforma. Los archivos de [agentes](agentes/) describen roles, no seis instancias a lanzar. La instrucción es ejecutar, verificar, hacer commits y pasar al siguiente ticket desbloqueado. Resolver decisiones de implementación con las ADR y los valores por defecto del protocolo; anotarlas en el informe del ticket. No detenerse para preguntar por nombres internos, librerías equivalentes o ajustes rutinarios.

Cada agente termina con commits, comandos y resultados de pruebas, limitaciones y siguiente paso. Los estados válidos son pendiente, en curso, listo para integrar, integrado, verificado y bloqueado. Un commit no es un ticket terminado. A y F cierran la diferencia entre código escrito y producto probado.

Si un trabajo excede la noche, entregar el recorrido básico funcionando y marcar explícitamente lo pendiente. No resolverlo con pantallas vacías, tests omitidos, cambios de tolerancias sin justificación ni mensajes que prometan funciones que todavía no existen.

## Qué recortar si falta tiempo

**Obligatorio para mañana en Mac:** editar modelo propio; abrir/guardar carpeta y escenarios; prevenir pérdida de trabajo; validar; correr y cancelar; resultados y CSV; comparar dos escenarios; ejecutar la app empaquetada sin Vite; instrucciones de apertura y limitaciones.

**Se puede posponer:** rejilla semanal arrastrable si existe edición estructurada válida; temas en caliente y editor de apariencia (#143/#144); animación de tokens (#65); publicación en npm/Pages (#48/#67); XLSX (#80); firma y autoactualización (#109/#110); optimización sin medición que la justifique. Si falta otra plataforma, se declara pendiente de validación; no se frena la entrega Mac.

**Fuera de esta noche:** servidor/usuarios/Docker, repositorio corporativo, catálogo completo/RACI calculado, entrevistas IA, minería, REST/MCP remoto y ampliación del subconjunto BPMN. Están en el inventario para que no se confundan con requisitos del uso local.

La paridad total con Bizagi no se deduce de tener cuatro niveles. Siguen existiendo diferencias numéricas documentadas, parámetros reservados y elementos no simulables. La beta debe mostrarlos y usar los contratos de Lila consistentemente.

## Entrega verificable de la mañana

- [ ] Una `.app`/DMG para la arquitectura de esta Mac y su SHA de origen.
- [ ] La app abre sin terminal, Vite, cuenta ni servidor externo.
- [ ] Carpeta nueva con BPMN y dos escenarios propios: guardar, cerrar, reabrir y reproducir resultados.
- [ ] Editar tiempos/capacidad cambia el resultado y la comparación; los avisos y moneda se ven.
- [ ] Import fallido, archivo con ids ajenos, cancelación y cierre con cambios no pierden el trabajo previo.
- [ ] `npm test`, `npm run typecheck` y build web pasan sobre el commit final.
- [ ] Instaladores Windows/Linux y sus comprobaciones, o limitación por plataforma explícita y acotada.
- [ ] Informe final con ubicación de artefactos, pruebas ejecutadas, diferencias conocidas y tickets todavía abiertos.

Consultar también [INVENTARIO-GITHUB.md](INVENTARIO-GITHUB.md): snapshot de todos los pendientes, mapeo hacia OP-xx y cadenas de PR. El snapshot no reemplaza volver a consultar GitHub al arrancar. Este plan se preparó como archivos locales: no se han lanzado agentes, fusionado PR ni creado issues remotos durante la auditoría.
