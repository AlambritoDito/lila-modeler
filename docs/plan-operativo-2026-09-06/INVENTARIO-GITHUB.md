# Inventario GitHub y mapeo operativo

Snapshot consultado la noche del 6 de septiembre de 2026. 157 issues recuperados en total, 95 abiertos: 79 tickets y 16 épicas. 13 PR abiertos. Los estados pueden cambiar; consultar antes de asignar. Los checks de los 13 PR estaban verdes al consultar, pero cada PR tiene su propia base.

**Advertencia de identidad:** la cabecera histórica de BACKLOG.md dice que LILA-nnn coincide con #nnn. Ya no es cierto en varios tickets nuevos: LILA-185 = #198, LILA-186 = #200, LILA-187 = #201, LILA-188 = #206, LILA-204 = #236; temas LILA-113/114 = #143/144. Usar siempre el número GitHub del enlace. Los OP de este plan no reservan números GitHub.

## PR existentes: reutilizar antes de escribir

| PR | Cambio | Base observada | Tratamiento |
|---|---|---|---|
| [#207](https://github.com/AlambritoDito/lila-modeler/pull/207) | feat(mcp): patch_scenario con JSON Patch RFC 6902 (LILA-055) | `main` | OP-17 antes de #208 |
| [#208](https://github.com/AlambritoDito/lila-modeler/pull/208) | feat(cli): subcomando `lila mcp` y E2E con el cliente MCP oficial (LILA-056) | `lila-55-patch-scenario` | OP-17 después de #207 |
| [#209](https://github.com/AlambritoDito/lila-modeler/pull/209) | feat(web): vista de comparación AS-IS vs TO-BE con resaltado y significancia (LILA-063) | `main` | OP-01 → OP-05 |
| [#215](https://github.com/AlambritoDito/lila-modeler/pull/215) | feat(web): panel de propiedades propio con los campos lila: y RACI (LILA-060) | `main` | OP-01 |
| [#221](https://github.com/AlambritoDito/lila-modeler/pull/221) | fix(bpmn): parseBpmn conserva los warnings de bpmn-moddle y validate los clasifica (LILA-185) | `main` | OP-03 |
| [#222](https://github.com/AlambritoDito/lila-modeler/pull/222) | feat(cli): moneda, tabla de cuellos de botella y costo por caso en `lila run`; README al día (LILA-188) | `main` | OP-04; README coordinado con E |
| [#223](https://github.com/AlambritoDito/lila-modeler/pull/223) | chore(release): @lila/engine publicable en npm con `npx lila`, release.yml por tag (LILA-048) | `main` | OP-17 opcional; no publicación automática |
| [#227](https://github.com/AlambritoDito/lila-modeler/pull/227) | feat(web): overlay de cuellos de botella sobre bpmn-js y pestaña Simulación en el shell (LILA-064) | `main` | OP-01 antes de #234 |
| [#229](https://github.com/AlambritoDito/lila-modeler/pull/229) | feat(engine): `triggerCount` sin `interTriggerTimer` = N llegadas en t = 0 (LILA-186) | `main` | OP-04 primero |
| [#230](https://github.com/AlambritoDito/lila-modeler/pull/230) | fix(examples): topología, probabilidades y llegadas oficiales en bizagi-levels 1–4; paridad sobre examples/ (LILA-187) | `lila-200-triggercount-t0` | OP-04 después de #229 |
| [#231](https://github.com/AlambritoDito/lila-modeler/pull/231) | test(oracles): fixture congelado de Prosimos 2.0.6 sobre la cadena de 5 tareas (LILA-052) | `main` | OP-04 opcional |
| [#234](https://github.com/AlambritoDito/lila-modeler/pull/234) | feat(web): panel de escenario generado desde el JSON Schema, con extends, validación en vivo y duplicar (LILA-061) | `lila-64-bottleneck-overlay` | OP-01 después de #227 |
| [#235](https://github.com/AlambritoDito/lila-modeler/pull/235) | feat(scenario): capacidad de un pool por turno (`capacity: [{calendar, capacity}]`) y nivel 4 de Bizagi (LILA-164) | `lila-201-bizagi-levels-errata` | OP-04 después de #230 |

Tres cadenas apiladas: **#227 → #234**, **#229 → #230 → #235**, **#207 → #208**. El resto apuntaba a main. Fusionable en su base no significa fusionable sin conflictos con todas las otras ramas.

## Todos los issues abiertos

Asignación a OP significa alcance relacionado; no presupone cerrar automáticamente el issue completo. Las épicas se actualizan al finalizar sus hijos. Lo pospuesto se mantiene visible.

| Issue | Título exacto | Destino |
|---|---|---|
| [#48](https://github.com/AlambritoDito/lila-modeler/issues/48) | LILA-048 · Publicación en npm y `npx lila` | OP-17 |
| [#51](https://github.com/AlambritoDito/lila-modeler/issues/51) | LILA-051 · Fixture congelado de Scylla | Pospuesto: otro oráculo; no bloquea uso local |
| [#52](https://github.com/AlambritoDito/lila-modeler/issues/52) | LILA-052 · Fixture congelado de Prosimos | OP-04 |
| [#55](https://github.com/AlambritoDito/lila-modeler/issues/55) | LILA-055 · `patch_scenario` | OP-17 |
| [#56](https://github.com/AlambritoDito/lila-modeler/issues/56) | LILA-056 · `lila mcp` y prueba de humo con Claude Code | OP-17 |
| [#60](https://github.com/AlambritoDito/lila-modeler/issues/60) | LILA-060 · Panel de propiedades propio | OP-01, OP-15 |
| [#61](https://github.com/AlambritoDito/lila-modeler/issues/61) | LILA-061 · Panel de escenario | OP-01, OP-11 |
| [#63](https://github.com/AlambritoDito/lila-modeler/issues/63) | LILA-063 · Vista de comparación | OP-01, OP-05, OP-13 |
| [#64](https://github.com/AlambritoDito/lila-modeler/issues/64) | LILA-064 · Overlay de cuellos de botella | OP-01 |
| [#65](https://github.com/AlambritoDito/lila-modeler/issues/65) | LILA-065 · Pestaña "validar rutas" con token-simulation | Pospuesto: animación didáctica de tokens |
| [#66](https://github.com/AlambritoDito/lila-modeler/issues/66) | LILA-066 · UI en español y estado global | OP-01, OP-07, OP-13 |
| [#67](https://github.com/AlambritoDito/lila-modeler/issues/67) | LILA-067 · Demo online en GitHub Pages | Pospuesto: demo pública; la beta local no depende de Pages |
| [#68](https://github.com/AlambritoDito/lila-modeler/issues/68) | LILA-068 · Round-trip de `lila:` en herramientas ajenas | OP-15 |
| [#69](https://github.com/AlambritoDito/lila-modeler/issues/69) | LILA-069 · Rendimiento de la UI con diagramas grandes | OP-06, OP-18 |
| [#70](https://github.com/AlambritoDito/lila-modeler/issues/70) | LILA-070 · `apps/desktop`: main, preload, IPC | OP-02, OP-14 |
| [#71](https://github.com/AlambritoDito/lila-modeler/issues/71) | LILA-071 · `DesktopStore` | OP-08, OP-13, OP-14 |
| [#72](https://github.com/AlambritoDito/lila-modeler/issues/72) | LILA-072 · electron-builder y asociación de `.bpmn` | OP-12, OP-18 |
| [#73](https://github.com/AlambritoDito/lila-modeler/issues/73) | LILA-073 · CI de escritorio en matriz macOS / Windows / Linux | OP-12, OP-18 |
| [#74](https://github.com/AlambritoDito/lila-modeler/issues/74) | LILA-074 · Recientes, estado de ventana, arranque | OP-14 |
| [#75](https://github.com/AlambritoDito/lila-modeler/issues/75) | LILA-075 · README final | OP-17, OP-18 |
| [#76](https://github.com/AlambritoDito/lila-modeler/issues/76) | LILA-076 · Nota de licencias de terceros | OP-12, OP-17 |
| [#77](https://github.com/AlambritoDito/lila-modeler/issues/77) | LILA-077 · Release 1.0.0 | OP-17, OP-18 |
| [#78](https://github.com/AlambritoDito/lila-modeler/issues/78) | LILA-078 · `lila import-qbp` | Después de beta local; ver backlog original |
| [#79](https://github.com/AlambritoDito/lila-modeler/issues/79) | LILA-079 · Import/export BPSim 2.0 (`.bpsim` independiente) | Después de beta local; ver backlog original |
| [#80](https://github.com/AlambritoDito/lila-modeler/issues/80) | LILA-080 · Export XLSX de resultados | Después de beta local; ver backlog original |
| [#81](https://github.com/AlambritoDito/lila-modeler/issues/81) | LILA-081 · Start quantity / completion quantity, boundary events, message/signal, event-based gateway | Después de beta local; ver backlog original |
| [#82](https://github.com/AlambritoDito/lila-modeler/issues/82) | LILA-082 · Calendarios mensuales/anuales, festivos y zona horaria | Después de beta local; ver backlog original |
| [#83](https://github.com/AlambritoDito/lila-modeler/issues/83) | LILA-083 · `packages/server` con REST `/api/v1` | Después de beta local; ver backlog original |
| [#84](https://github.com/AlambritoDito/lila-modeler/issues/84) | LILA-084 · Interfaz `Storage` con SQLite y PostgreSQL | Después de beta local; ver backlog original |
| [#85](https://github.com/AlambritoDito/lila-modeler/issues/85) | LILA-085 · Autenticación local | Después de beta local; ver backlog original |
| [#86](https://github.com/AlambritoDito/lila-modeler/issues/86) | LILA-086 · `RemoteStore` en la SPA | Después de beta local; ver backlog original |
| [#87](https://github.com/AlambritoDito/lila-modeler/issues/87) | LILA-087 · MCP por HTTP con la misma autenticación | Después de beta local; ver backlog original |
| [#88](https://github.com/AlambritoDito/lila-modeler/issues/88) | LILA-088 · Docker y compose | Después de beta local; ver backlog original |
| [#89](https://github.com/AlambritoDito/lila-modeler/issues/89) | LILA-089 · Versiones con `lila:versionTag` y lista de versiones | Después de beta local; ver backlog original |
| [#90](https://github.com/AlambritoDito/lila-modeler/issues/90) | LILA-090 · Comparar versiones (diff XML + `compare()` de resultados) | Después de beta local; ver backlog original |
| [#91](https://github.com/AlambritoDito/lila-modeler/issues/91) | LILA-091 · Flujo de liberación (Draft → Released → Valid until), comentarios, búsqueda | Después de beta local; ver backlog original |
| [#92](https://github.com/AlambritoDito/lila-modeler/issues/92) | LILA-092 · `catalog.json` y editor de catálogo (roles, sistemas, documentos, riesgos, controles, KPIs) | Después de beta local; ver backlog original |
| [#93](https://github.com/AlambritoDito/lila-modeler/issues/93) | LILA-093 · Referencias `lila:*Ref` con selector desde el catálogo en el panel de propiedades | Después de beta local; ver backlog original |
| [#94](https://github.com/AlambritoDito/lila-modeler/issues/94) | LILA-094 · Matriz RACI (consulta sobre IR × responsabilidades) y export | Después de beta local; ver backlog original |
| [#95](https://github.com/AlambritoDito/lila-modeler/issues/95) | LILA-095 · Lint "actividad sin responsable" y referencias colgantes | Después de beta local; ver backlog original |
| [#96](https://github.com/AlambritoDito/lila-modeler/issues/96) | LILA-096 · Pools de recursos del escenario referenciando roles del catálogo | Después de beta local; ver backlog original |
| [#97](https://github.com/AlambritoDito/lila-modeler/issues/97) | LILA-097 · `create_process_draft` (IR mínimo → .bpmn con `bpmn-auto-layout`) | Después de beta local; ver backlog original |
| [#98](https://github.com/AlambritoDito/lila-modeler/issues/98) | LILA-098 · `create_activity`, `connect_elements`, `create_gateway`, `delete_element`, `rename` | Después de beta local; ver backlog original |
| [#99](https://github.com/AlambritoDito/lila-modeler/issues/99) | LILA-099 · `annotate_element` (documentation, RACI, refs) y `get_raci_matrix` | Después de beta local; ver backlog original |
| [#100](https://github.com/AlambritoDito/lila-modeler/issues/100) | LILA-100 · Permisos por tool (`process:read`, `process:write`, `simulation:run`, …) y audit log | Después de beta local; ver backlog original |
| [#101](https://github.com/AlambritoDito/lila-modeler/issues/101) | LILA-101 · `Finding` e `Interview` como documentos JSON en `processes/<clave>/findings/` | Después de beta local; ver backlog original |
| [#102](https://github.com/AlambritoDito/lila-modeler/issues/102) | LILA-102 · Ingesta de transcripciones y extracción (actividades, actores, sistemas, decisiones, tiempos, dolores) | Después de beta local; ver backlog original |
| [#103](https://github.com/AlambritoDito/lila-modeler/issues/103) | LILA-103 · Detección de contradicciones entre entrevistas y solicitud de faltantes | Después de beta local; ver backlog original |
| [#104](https://github.com/AlambritoDito/lila-modeler/issues/104) | LILA-104 · Revisión de calidad del proceso y TO-BE sugerido como escenario con `extends` | Después de beta local; ver backlog original |
| [#105](https://github.com/AlambritoDito/lila-modeler/issues/105) | LILA-105 · `mining/` con pm4py: importar XES/CSV con las columnas del event log de Lila | Después de beta local; ver backlog original |
| [#106](https://github.com/AlambritoDito/lila-modeler/issues/106) | LILA-106 · Descubrimiento ligero de escenario observado (llegadas, empíricas por actividad, probabilidades de gateway) | Después de beta local; ver backlog original |
| [#107](https://github.com/AlambritoDito/lila-modeler/issues/107) | LILA-107 · "Documentado vs observado" con el mismo `compare()`; desviaciones y rework | Después de beta local; ver backlog original |
| [#108](https://github.com/AlambritoDito/lila-modeler/issues/108) | LILA-108 · Puente opcional a Simod y salida OCEL 2.0 | Después de beta local; ver backlog original |
| [#109](https://github.com/AlambritoDito/lila-modeler/issues/109) | LILA-109 · Firma y notarización (macOS con la cuenta Apple Developer de Brito; certificado Windows) | Después de beta local; ver backlog original |
| [#110](https://github.com/AlambritoDito/lila-modeler/issues/110) | LILA-110 · Auto-update con electron-builder | Después de beta local; ver backlog original |
| [#111](https://github.com/AlambritoDito/lila-modeler/issues/111) | LILA-111 · Evaluar Tauri si los ~150 MB del instalador se vuelven problema | Después de beta local; ver backlog original |
| [#115](https://github.com/AlambritoDito/lila-modeler/issues/115) | E3 — Motor DES, niveles 1 y 2 de Bizagi (M1) | Épica de seguimiento; no asignar como implementación independiente |
| [#117](https://github.com/AlambritoDito/lila-modeler/issues/117) | E5 — Nivel 4: calendarios y paridad (M3) | Épica de seguimiento; no asignar como implementación independiente |
| [#118](https://github.com/AlambritoDito/lila-modeler/issues/118) | E6 — CLI `lila` (M1–M3) | Épica de seguimiento; no asignar como implementación independiente |
| [#119](https://github.com/AlambritoDito/lila-modeler/issues/119) | E7 — Validación numérica y oráculos (M1–M3) | Épica de seguimiento; no asignar como implementación independiente |
| [#120](https://github.com/AlambritoDito/lila-modeler/issues/120) | E8 — MCP local para agentes (M4) | Épica de seguimiento; no asignar como implementación independiente |
| [#121](https://github.com/AlambritoDito/lila-modeler/issues/121) | E9 — App web: editor, escenario, resultados (M5) | Épica de seguimiento; no asignar como implementación independiente |
| [#122](https://github.com/AlambritoDito/lila-modeler/issues/122) | E10 — App de escritorio con Electron (M5) | Épica de seguimiento; no asignar como implementación independiente |
| [#123](https://github.com/AlambritoDito/lila-modeler/issues/123) | E11 — Release v1 (M5) | Épica de seguimiento; no asignar como implementación independiente |
| [#124](https://github.com/AlambritoDito/lila-modeler/issues/124) | E12 — Adaptadores y cobertura BPMN extra | Épica de seguimiento; no asignar como implementación independiente |
| [#125](https://github.com/AlambritoDito/lila-modeler/issues/125) | E13 — Servidor self-hosted para intranet (M6) | Épica de seguimiento; no asignar como implementación independiente |
| [#126](https://github.com/AlambritoDito/lila-modeler/issues/126) | E14 — Repositorio y versiones | Épica de seguimiento; no asignar como implementación independiente |
| [#127](https://github.com/AlambritoDito/lila-modeler/issues/127) | E15 — Catálogo y RACI | Épica de seguimiento; no asignar como implementación independiente |
| [#128](https://github.com/AlambritoDito/lila-modeler/issues/128) | E16 — MCP de modelado para agentes | Épica de seguimiento; no asignar como implementación independiente |
| [#129](https://github.com/AlambritoDito/lila-modeler/issues/129) | E17 — Asistencia IA y agente de entrevistas | Épica de seguimiento; no asignar como implementación independiente |
| [#130](https://github.com/AlambritoDito/lila-modeler/issues/130) | E18 — Process mining (proceso Python separado, AGPL aislado) | Épica de seguimiento; no asignar como implementación independiente |
| [#131](https://github.com/AlambritoDito/lila-modeler/issues/131) | E19 — Distribución | Épica de seguimiento; no asignar como implementación independiente |
| [#143](https://github.com/AlambritoDito/lila-modeler/issues/143) | LILA-113 · Sistema de temas tipo VS Code | Pospuesto: apariencia y temas |
| [#144](https://github.com/AlambritoDito/lila-modeler/issues/144) | LILA-114 · Ajustes → Apariencia: editor de tokens, tipografía, importar/exportar | Pospuesto: apariencia y temas |
| [#164](https://github.com/AlambritoDito/lila-modeler/issues/164) | LILA-164 · Capacidad de un pool variable por turno (paridad Bizagi nivel 4) | OP-04 |
| [#198](https://github.com/AlambritoDito/lila-modeler/issues/198) | LILA-185 · `parseBpmn` y `lila validate` descartan los warnings de bpmn-moddle | OP-03 |
| [#200](https://github.com/AlambritoDito/lila-modeler/issues/200) | LILA-186 · `triggerCount` sin `interTriggerTimer` produce cero casos en silencio | OP-04 |
| [#201](https://github.com/AlambritoDito/lila-modeler/issues/201) | LILA-187 · Errata en `examples/bizagi-levels`: topología, probabilidades y llegadas del proceso oficial | OP-04 |
| [#206](https://github.com/AlambritoDito/lila-modeler/issues/206) | LILA-188 · `lila run` no imprime `run.currency` ni las tablas `bottlenecks` y `costPerCase`; README desfasado | OP-04 |
| [#210](https://github.com/AlambritoDito/lila-modeler/issues/210) | LILA-189 · CompareView no muestra `warnings`, `compareWarnings` ni `run.currency` | OP-05 |
| [#211](https://github.com/AlambritoDito/lila-modeler/issues/211) | LILA-190 · Determinismo bit a bit entre arquitecturas: log/exp/cos/pow propios en `core/` y CI arm64 | Pospuesto: determinismo entre arquitecturas; conservar contrato actual |
| [#213](https://github.com/AlambritoDito/lila-modeler/issues/213) | LILA-191 · Aviso `W-RECURSO-SATURADO` cuando un pool no alcanza estado estacionario | OP-16 |
| [#214](https://github.com/AlambritoDito/lila-modeler/issues/214) | LILA-192 · Exportar desde la app web pierde en silencio las referencias rotas del .bpmn original | OP-09 |
| [#216](https://github.com/AlambritoDito/lila-modeler/issues/216) | LILA-193 · Abrir en la app web un .bpmn con ids no NCName pierde elementos al exportar | OP-09 |
| [#217](https://github.com/AlambritoDito/lila-modeler/issues/217) | LILA-194 · Ningún camino escribe `exporter="Lila Modeler"` / `exporterVersion` en el .bpmn | OP-09 |
| [#218](https://github.com/AlambritoDito/lila-modeler/issues/218) | LILA-195 · Panel de propiedades: proceso seleccionable, deshacer limpio, refs recortadas, TextAnnotation y aria-labels | OP-15 |
| [#219](https://github.com/AlambritoDito/lila-modeler/issues/219) | LILA-196 · Afinar R-NOSOP-6: falsos positivos de `E-PARSE-INCOMPLETO` y texto de `W-PARSE` | OP-03 |
| [#220](https://github.com/AlambritoDito/lila-modeler/issues/220) | LILA-197 · `sanitizeXmlIds` solo reescribe ids entre comillas dobles | OP-03 |
| [#224](https://github.com/AlambritoDito/lila-modeler/issues/224) | LILA-198 · Seis códigos de SEMANTICS §17 no se emiten con ese nombre; avisos `W-TAREA-SIN-TIEMPO` en ráfaga | OP-16 |
| [#225](https://github.com/AlambritoDito/lila-modeler/issues/225) | LILA-199 · `npm run dev` de apps/web bloquea la fuente de iconos de bpmn-js (403 por `server.fs.allow`) | OP-06 |
| [#226](https://github.com/AlambritoDito/lila-modeler/issues/226) | LILA-200 · Pestaña Simulación: etiquetas del overlay, top-N, avisos, nombre del cuello y arnés de tests del shell | OP-01, OP-06, OP-07, OP-13 |
| [#228](https://github.com/AlambritoDito/lila-modeler/issues/228) | LILA-201 · La CLI no imprime las columnas de espera, `totalCost` ni percentiles de `waitTime`; nombres distintos entre CLI, CSV y web | OP-10, OP-16 |
| [#232](https://github.com/AlambritoDito/lila-modeler/issues/232) | LILA-202 · Mensajes de zod en español (error map compartido por CLI, MCP y web) | OP-16 |
| [#233](https://github.com/AlambritoDito/lila-modeler/issues/233) | LILA-203 · Editor semanal de calendarios por franjas y control de campos reservados heredados en el panel de escenario | OP-11 |
| [#236](https://github.com/AlambritoDito/lila-modeler/issues/236) | LILA-204 · Utilización: denominador con `warmup`, valores > 1 con turnos y textos de `E-REC-CAPACIDAD` fuera de §17 | OP-10 |

## Brechas nuevas o insuficientemente cubiertas por tickets actuales

Estos puntos se incorporan a paquetes OP; no crear duplicados de issues ya existentes. Si se formalizan nuevos issues después, copiar la aceptación del OP y relacionar sus issues fuente.

| Brecha | Paquetes |
|---|---|
| Contrato de lectura de escenarios/runs, snapshots y separación borrador/resuelto | OP-01, OP-08 |
| IR vigente tras edición, validación antes de Worker, cancelación visible y resultados obsoletos | OP-07 |
| Abrir carpeta propia, crear/importar escenarios y comparar runs reales desde shell | OP-08, OP-13 |
| Dirty, Guardar como, conflictos externos y fallo de escritura sin truncado | OP-14 |
| Nuevo modelo y recorrido de edición/documentación completo | OP-15 |
| Build Vite en CI, E2E del artefacto y assets/Worker fuera de Vite | OP-06, OP-12, OP-18 |
| Responsables de integración, worktrees, checkpoints e intercambio entre hosts | COORDINACION.md |

## Límite de este inventario

El backlog E12–E19 continúa la visión completa del producto: adaptadores, servidor, repositorio, RACI, modelado por MCP, entrevistas y minería. Los 18 paquetes estiman el cierre de la beta local y su distribución inicial, no toda esa plataforma futura. Estimar toda la visión con la misma cifra de agentes/rondas sería engañoso.
