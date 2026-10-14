# Roadmap: de la simulación de procesos al repositorio organizacional

> Leer en: [English](../ROADMAP.md).

**Dirección aprobada, 2026-09-26; evidencia actualizada el 2026-10-14. Implementación pendiente
salvo las bases identificadas abajo.** En GitHub se sigue como la épica #497.
Este roadmap amplía la [ADR-029](DECISIONS.md#adr-029--el-repositorio-un-lila-puede-contener-una-organización-entera).
Define un orden de entrega, no un calendario ni una declaración de paridad completa con Bizagi/ADONIS.

Lila combinará su base de modelado BPMN y simulación con conocimiento organizacional reutilizable:
procesos, personas, aplicaciones, documentos, riesgos, controles y relaciones. Primero navegador
y escritorio locales; después servidor compartido. La ejecución de workflows permanece en motores
externos mediante adaptadores explícitos y API/MCP. Exportar BPMN no garantiza por sí solo que
cualquier motor pueda ejecutarlo.

## 1. Evidencia y brechas funcionales

Base revisada: código del commit `7dd61e2` (v1.0.0-beta.26), el 2026-10-14, más el estado de los
issues de GitHub citados en esa fecha. Es una revisión estática de código y contratos, no una
nueva prueba de la app instalada ni una ejecución reciente de las pruebas de simulación. El
backlog registra intención y no demuestra por sí solo implementación.

Claves de evidencia:

- **B1:** [documento de proyecto](../../packages/engine/src/project/types.ts), [codec del contenedor](../../packages/engine/src/project/lila.ts), [lista de procesos](../../packages/engine/src/project/repository.ts), [pestañas del lienzo](../../apps/web/src/PestanasProcesos.tsx) y [formato](PROJECT_FORMAT.md): un repositorio versión 2 contiene varios procesos bajo `processes/<slug>/` (#498, #521, #614); un proyecto de un solo proceso se sigue escribiendo como versión 1; lo que queda fuera de las carpetas de procesos listadas se reporta y descarta, así que aún no hay entradas de catálogo, mapas ni adjuntos.
- **B2:** [editor de propiedades](../../apps/web/src/PropertiesPanel.tsx), [lector/escritor de anotaciones](../../packages/engine/src/bpmn/annotate.ts), [atributos extendidos](../../packages/engine/src/bpmn/attributes.ts) y [extensiones BPMN](BPMN_EXTENSION.md): existen documentación, responsabilidades, referencias tipadas y atributos por tipo de elemento; los IDs se introducen sin catálogo de repositorio.
- **B3:** [identificadores de vistas](../../apps/web/src/ids.ts), [vista de resultados](../../apps/web/src/ResultsView.tsx) y [documento del proceso](../../packages/engine/src/process-document.ts): existen resultados de simulación con gráficas, un documento del proceso Word/HTML (#454) y una matriz RACI por proceso (#99); no hay tabla de modelos ni Insights organizacionales.
- **B4:** [esquema de escenarios](../../packages/engine/src/scenario.ts) y [pruebas de recursos](../../packages/engine/test/core/resources-sim.test.ts): capacidad, costes y calendarios son de simulación, no un directorio organizacional.
- **B5:** [interfaces de almacenamiento](../../apps/web/src/store/ProjectStore.ts) y [adaptador del navegador](../../apps/web/src/store/BrowserStore.ts): adaptadores locales que abren y guardan el documento de proyecto completo; la carga diferida por objeto y el almacenamiento remoto están planeados.
- **B6:** [comparación Bizagi](BIZAGI_PARITY.md), [contrato MCP](MCP.md) y [CLI](CLI.md): bases de simulación y dieciocho tools MCP que crean, editan, anotan, simulan y exportan un proceso de un `.lila` (épica #527, aún abierta), con límites documentados.
- **B7:** [ADR-029](DECISIONS.md#adr-029--el-repositorio-un-lila-puede-contener-una-organización-entera) y [backlog](../../BACKLOG.md): dirección aceptada, no evidencia de implementación.

Estados: **Implementado** significa que la base indicada existe en código; **Parcial**, que existe
solo parte; **Planeado**, que está aprobado pero ausente en la implementación revisada;
**No verificado**, que falta evidencia de comparación o interoperabilidad. Las fases siguientes
no son los hitos históricos M0–M6.

| Capacidad de referencia | Estado de Lila / evidencia | Brecha | Fase / dependencia | Aceptación |
| --- | --- | --- | --- | --- |
| Modelado y simulación BPMN | Base implementada, B6 | Conservar contratos y límites documentados | Todas / motor existente | Mismos datos y semilla conservan resultados de regresión |
| Repositorio organizacional | Parcial: varios procesos por `.lila`, pestañas del lienzo y navegación a call activities, B1 | Almacén por objeto, explorador, búsqueda, propietarios/metadatos | 1 / contrato RM-01 | Recorrer y buscar procesos y objetos de un repositorio |
| Objetos reutilizables y consulta de usos | Parcial: sintaxis de referencias, B2 | Catálogo, relaciones e índice inverso | 1–2 / repositorio | Renombrar actualiza todas las apariciones sin cambiar IDs |
| Fichas de propiedades y documentación | Parcial: panel de propiedades y atributos extendidos, B2 | Formularios tipados y selectores | 2 / catálogo | Asignar un rol y abrir su objeto desde una tarea |
| Tabla de modelos/objetos | Planeado, B3 | Filtros, columnas, edición múltiple, exportación | 2 / comandos compartidos | Editar y deshacer desde tabla actualiza el diagrama |
| RACI y entradas/salidas | Parcial: anotaciones y matriz por proceso en motor, CLI, MCP y documento del proceso, B2/B3/B6 | Matriz de todo el repositorio sobre roles del catálogo, vista en la app y relaciones documentales | 2 / catálogo | Ir de una fila a su tarea y rol |
| Insights de proceso/objeto | Parcial: solo métricas y gráficas de simulación, B3 | Responsabilidades, documentos, sistemas, usos y brechas | 2 / consultas derivadas | Cada widget permite abrir su fuente |
| Mapas de procesos y cadenas de valor | Planeado, B7 | Mapas jerárquicos enlazados a BPMN | 3 / objetos del repositorio | Navegar macroproceso → proceso → actividad |
| Organización y recursos | Parcial: pools de simulación, B4 | Unidades, roles, puestos, personas, socios, recursos, centros de coste | 3 / catálogo | Mostrar responsables y enlazar explícitamente rol y pool |
| Riesgos y controles | Parcial: solo referencias, B2 | Catálogos y agrupaciones, mapas, evaluaciones, matriz de calor, tratamientos | 4 / catálogo y mapas | Recorrer riesgo → controles → responsable → evidencia |
| Objetivos de control y requisitos | Planeado, B7 | Relaciones de cobertura y cumplimiento | 4 / riesgos y controles | Listar requisitos sin controles asociados |
| Documentos y adjuntos | Parcial: referencias y documento del proceso exportado; el contenedor descarta entradas desconocidas, B1/B2/B3 | Archivos, metadatos y adjuntos portables | 2 / almacenamiento versión 3 | Conservar bytes al pasar de archivo a carpeta y viceversa |
| KPIs, madurez y mejora | Parcial: referencias KPI y simulación, B2/B6 | Metas, observaciones, iniciativas, objetivos, SIPOC e Ishikawa | 5 / Insights y relaciones | Cada resultado identifica fuente, fecha y tipo de medición |
| Impacto y dependencias | Planeado, B7 | Recorrido entre modelos y análisis guardados | 5 / índice inverso | Un cambio de aplicación muestra tareas y procesos afectados |
| Mapas documentales, TI y productos | Planeado, B7 | Productos/componentes; aplicaciones/servicios/interfaces/operaciones/nodos | 6 / registro de tipos | Reutilizar una aplicación en proceso y mapa TI |
| Datos, casos de uso y decisiones | Planeado, B7 | Entidades/atributos, actores/casos, decisiones, datos de entrada, fuentes/modelos de conocimiento | 6 / contratos de modelos | Conservar enlaces al guardar/abrir; aprobar contrato DMN antes de programar |
| Colaboración, conversación y modelos transversales | Parcial: base del editor BPMN, B6 | Cobertura completa y vistas de dominio | 6 / contratos | Documentar notación soportada y conservar contenido ajeno |
| Historial y comparación semántica | Parcial: etiqueta de versión, B2 | Instantáneas, historial y diferencias semánticas | 7 / identidad de repositorio | Comparar versión publicada y borrador sin confundir escenarios |
| Aprobación, publicación y portal | Planeado, B7 | Revisión, vigencia, publicación y navegación de lectores | 7 / historial y servidor | Lector consulta contenido publicado; editor modifica un borrador |
| Colaboración de equipo | Planeado, B5/B7 | Servidor, cuentas, permisos, comentarios, auditoría, avisos, conflictos | 7 / almacenamiento por objeto | Rechazar escrituras no autorizadas y evitar sobrescrituras silenciosas |
| Registros operativos de calidad | Planeado, B7 | Auditorías, hallazgos, no conformidades y CAPA | 7 / gobierno del servidor | Registrar dueño, vencimiento, historial y enlaces al diseño |
| API/MCP del repositorio y asistencia IA | Parcial: tools por proceso de modelado, anotación, simulación y exportación con dry-run, B6 | Herramientas de catálogo y repositorio, entrevistas, propuestas revisables | 8 / servicios | Inspeccionar una propuesta antes de aplicarla |
| Minería, KPIs observados e integraciones | Planeado; compatibilidad de conectores no verificada, B7 | Importar datos observados y adaptadores externos | 8 / procedencia y API | Comparar observado y simulado con unidades y mapeos declarados |
| Paridad completa e importación propietaria | No verificado | Auditoría por edición y fixtures reales de intercambio | Evaluación separada / acceso a herramientas | Publicar cobertura y pérdidas probadas, sin deducir soporte por capturas |

## 2. Secuencia de entrega

| Fase | Entrega | Criterio / backlog |
| --- | --- | --- |
| **1 — Repositorio** | Almacenamiento por objeto, entradas de catálogo, explorador, identidad e índice de relaciones (el contenedor v2 de varios procesos y las pestañas ya existen) | ORG-1; salida v1/v2 idéntica byte a byte (más las entradas desconocidas, que ahora se conservan, REPOSITORY_CONTRACT.md § 1.4) y escenarios/corridas aislados por proceso |
| **2 — Documentación** | Catálogo inicial de roles/unidades/sistemas/documentos; adjuntos; selectores; tablas editables; RACI; Insights iniciales | E15, ORG-2, ORG-3, ORG-6; primer hito usable descrito abajo |
| **3 — Arquitectura organizacional** | Mapas de procesos, cadenas de valor, organigramas y recursos organizacionales | ORG-4 y LILA-096; navegación y enlace explícito con simulación |
| **4 — Riesgos y controles** | Catálogos/agrupaciones, mapas, evaluación inherente/residual, matriz de calor, objetivos, requisitos, evidencias y tratamiento | ORG-5; inspeccionar cobertura desde proceso y riesgo |
| **5 — Análisis y mejora** | Insights del portafolio, KPIs, madurez, dependencias, objetivos, iniciativas, SIPOC e Ishikawa | ORG-3; fuentes trazables y navegación al detalle |
| **6 — Modelos complementarios** | Vistas de documentos/TI/productos/datos/casos de uso/decisiones/comunicación y objetos transversales | ORG-7; registro común de tipos/propiedades/relaciones y contratos incrementales |
| **7 — Gobierno y equipos** | Versiones, aprobaciones, vigencia, portal, servidor propio, permisos, colaboración y registros de calidad | E13/E14/ORG-8; exportación sin pérdida y autorización/conflictos verificados |
| **8 — Ecosistema e inteligencia** | API/MCP, importaciones, observaciones/minería, entrevistas, IA revisable y adaptadores a workflows externos | E16–E18/ORG-9; pruebas explícitas de interoperabilidad y procedencia |

Las fases 1–2 forman el primer hito usable. La evaluación de riesgos llega después; no queda
implícita en el primer catálogo. El servidor de la fase 7 consume el contrato local; M6 no es
prerrequisito de las fases 1–6. M0–M5 y la estabilización de versiones siguen siendo válidos.
Las estimaciones pequeñas del backlog original no se trasladan a estas épicas ampliadas:
dimensionar cada implementación después de definir sus contratos y fixtures.
Las épicas `ORG-*` son agrupaciones locales del backlog bajo #497; las épicas de GitHub E21–E26 ya
existen con otro alcance.

### Orden de arranque

El código ADONIS empieza cuando el Lote R cierre la épica de agentes #527 (el Lote P salió en
beta.25, el Lote Q está en curso y el R va después). El contrato RM-01, solo documentación, es
[`REPOSITORY_CONTRACT.md`](REPOSITORY_CONTRACT.md), registrado como ADR-032 (aceptada el 2026-10-14
con las decisiones del dueño) en [DECISIONS.md](DECISIONS.md). Lotes de entrega propuestos:

| Lote | Alcance | Fase |
| --- | --- | --- |
| **A0** | Contrato del repositorio (RM-01, ADR-032) | 1 |
| **A1** | Almacén por objeto, catálogo (roles, unidades, sistemas, documentos), selectores, explorador del repositorio | 1–2 |
| **A2** | Editor tabular, matriz RACI agregada, Insights | 2 |
| **A3** | Mapas de procesos y cadenas de valor (macroproceso → proceso → actividad), organigrama, enlace explícito rol ↔ pool de simulación | 3 |
| **A4** | Riesgos y controles | 4 |
| **A5** | KPIs, Ishikawa, SIPOC, análisis de impacto | 5 |
| Después | Modelos complementarios, gobierno y servidor, ecosistema | 6–8 |

#639 (multi-instancia, bucles y eventos de error en el simulador) es profundidad de simulación, no
un paso del camino a ADONIS, y no condiciona estos lotes.

## 3. Reglas de arquitectura y producto

- **Definición y aparición:** identidad estable por objeto; los diagramas lo referencian. Su
  posición en un mapa no crea una copia. Las relaciones permiten consulta inversa.
- **Identidad:** referencias entre modelos incluyen identidad de modelo, contexto de versión e
  ID BPMN. Nombres y rutas no son claves. Dos modelos con iguales IDs de elemento no se fusionan.
  Las referencias son `{ process, element }` con un miembro `version` reservado
  (REPOSITORY_CONTRACT.md § 3.3).
- **Compatibilidad:** ya se cumple para procesos: v1 se abre como repositorio de un proceso sin
  reescribir archivos, y un proyecto de un solo proceso se sigue guardando como v1, byte a byte
  (más las entradas desconocidas, que ahora se conservan, REPOSITORY_CONTRACT.md § 1.4). Mantenerlo
  al añadir objetos: el contenido que requiere funciones de repositorio (catálogo, adjuntos) exige
  guardar la versión 3 (REPOSITORY_CONTRACT.md § 1.3). Las versiones 1.0.0-beta.15 y posteriores
  rechazan la versión 3 (`LILA-MANIFEST`/`E-MANIFEST`); las versiones hasta beta.14 rechazan las
  versiones 2 y 3. No se promete que un lector v1 conserve catálogos ni adjuntos.
- **Datos canónicos:** BPMN conserva diagrama y anotaciones; objetos en
  `catalog/<tipo>/<id>.json`, sustituyendo el `catalog.json` monolítico propuesto. Mapas, análisis
  y definiciones de paneles usan documentos versionados. Índices y agregados son derivados.
- **Almacenamiento:** evolucionar `ProjectStore` a listar/leer/escribir objetos con carga diferida
  y revisiones explícitas. El navegador necesita persistencia de objetos y bytes más allá de
  `localStorage`; el IPC de escritorio transfiere lo solicitado, no toda la organización.
- **Edición compartida:** tabla y diagrama usan la misma vía de comandos semánticos y deshacer/
  rehacer; edición múltiple atómica. Explicar campos inválidos/no aplicables, sin coerción oculta.
- **Documentación completa:** leer todo el BPMN, no solo el IR de simulación que omite elementos
  no simulables. Catálogo y servicios de interfaz permanecen fuera de `core/`.
- **Recursos:** roles RACI y pools conservan significados distintos y un enlace explícito.
  Una responsabilidad no genera automáticamente capacidad, coste ni disponibilidad.
- **Adjuntos:** definir entradas admitidas, límites, integridad y recuperación antes de agregarlos
  a la versión 3. Conservar bytes entre archivo y carpeta; no aplicar a adjuntos soportados el descarte de
  entradas desconocidas de v1. Las corridas siguen siendo opcionales al compartir.
- **Insights:** vistas de lectura y análisis. Cada indicador distingue evaluación manual,
  simulación u observación, con fuente/fecha y unidades aplicables. Ausencia no es cero; las
  corridas de versiones anteriores se distinguen de resultados del modelo actual.
- **Riesgos:** escalas explícitas y valores inherentes/residuales separados. Asociar un control
  no demuestra efectividad ni reduce automáticamente la exposición residual.
- **Modelos:** registro incremental de tipos, atributos, relaciones y vistas. DMN requiere una
  ADR de formato estándar antes de implementar, pues amplía el intercambio actualmente limitado
  a BPMN. Este roadmap no afirma soporte de ejecución DMN.
- **Gobierno:** propietario/estado local no demuestra aprobación. Publicar en servidor requiere
  autorización autenticada, historial y auditoría. Los registros de calidad corresponden
  principalmente al servidor; la opción local conserva las limitaciones de copias de ADR-029.
- **Diseño:** conservar marca y temas aprobados; interfaz propia de Lila sin copiar activos del
  proveedor. Catálogos inglés/español alineados y ejemplos públicos sintéticos.

Antes del primer hito, RM-01 define la versión 3 del repositorio (ids de proceso, catálogo,
adjuntos) sobre la disposición v2 ya publicada y fija identidad de referencias, interfaz de
almacenamiento/revisiones, reglas de adjuntos y recuperación. Las demás fases especificarán contratos de mapas,
evaluación de riesgos, observaciones KPI, DMN, liberación, colaboración y conectores. Son
especificaciones diferidas explícitamente, no decisiones ocultas para el PR del primer hito.
Esta entrega documental no cambia APIs de ejecución, escenarios ni códigos públicos de error.

## 4. Aceptación y validación

Primer hito usable, con una organización sintética:

1. Crear un repositorio con dos procesos que compartan roles, aplicación y documentos.
2. Asignar responsabilidades y entradas/salidas mediante selectores.
3. Editar nombres, documentación y referencias en tabla; comprobar sincronización con el diagrama,
   deshacer/rehacer y edición múltiple atómica.
4. Abrir RACI e Insights y navegar de cada fila a su actividad u objeto de origen.
5. Renombrar un objeto compartido y comprobar ambos procesos sin cambiar identidad.
6. Guardar, cerrar y reabrir en navegador y escritorio; conservar referencias, adjuntos,
   escenarios y corridas. Abrir v1 sin conversión destructiva.

Criterios transversales: IDs iguales entre modelos; referencias colgantes y borrado de objetos en
uso; extensiones BPMN ajenas y advertencias de pérdida; documentación no simulable; fallos de
guardado, cambios externos y recuperación; rechazo de versiones; teclado e idiomas; regresiones
de simulación con semilla, CLI y MCP. Medir carga diferida, búsqueda y tablas con repositorio
grande sintético; registrar hardware, tamaño y presupuestos en RM-01 antes de aceptar rendimiento.
No inferir rendimiento organizacional de resultados de un solo modelo.

Criterios posteriores: cobertura riesgo/control y evaluaciones ausentes; fuente/fecha/tipo de KPI;
reutilización entre modelos; versiones publicadas inmutables; permisos y conflictos; exportación
sin pérdida del servidor; unidades/mapeos de datos observados y conectores externos.
Aplicar las verificaciones de CONTRIBUTING a cambios de código; para documentación, validar
enlaces, generar documentación y revisar la correspondencia de traducciones.

## 5. Referencias y mantenimiento

Fuentes oficiales para familias funcionales, no para afirmar paridad de una edición licenciada.
Las capturas de planificación son referencias funcionales y no fixtures públicos.

| Fuente | Alcance | Clasificación de disponibilidad |
| --- | --- | --- |
| [Tipos de modelos ADONIS, 16.0](https://docs.boc-group.com/adonis/en/docs/16.0/user_manual/mty-000000/) | Mapas de procesos y modelos de dominio | Biblioteca BPMS documentada; licencia por edición no verificada |
| [Editor tabular, 17.1](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/tab-000000/) | Propiedades y relaciones editables de modelos/objetos | Función documentada; licencia por edición no verificada |
| [Insights, 14.0](https://docs.boc-group.com/adonis/en/docs/14.0/user_manual/igh-000000/) | Resúmenes y navegación por proceso/objeto | Depende de biblioteca; no prueba widgets idénticos entre versiones |
| [Funciones ADONIS](https://www.boc-group.com/en/adonis/features/) | Gobierno, publicación y ecosistema | Minería, informes avanzados y automatización presentados como extensiones; verificar integraciones por separado |

Fuentes del proveedor consultadas el 2026-09-26. Son versiones distintas y no establecen una edición ADONIS única exhaustiva.
Distinguir las adiciones de análisis de calidad propias de Lila de la paridad con el proveedor.

[BACKLOG.md](../../BACKLOG.md) mantiene trabajo y dependencias. Los identificadores nuevos `ORG-*` y
`RM-*` son claves locales, no números de GitHub. Conservar IDs LILA existentes y reconciliar el estado
real de issues antes de publicar/cerrar alguno. Este documento no implica sincronización con
GitHub. Actualizar la matriz al entregar cada fase con código y resultados de aceptación;
los contratos planeados nunca deben describirse como capacidades actuales.

Seguimiento: la [investigación de ADONIS y alternativas abiertas](research/README.md) documenta
hallazgos, límites por edición y posibles ajustes sin cambiar el orden de entrega aprobado.
