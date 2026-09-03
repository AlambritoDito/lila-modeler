# Fixtures reales exportados por Bizagi Modeler

Este directorio contiene archivos `.bpmn` **reales**, exportados por Bizagi Modeler (no
fabricados a mano), usados para validar que el motor de parseo de Lila Modeler no se rompe
ante el XML que Bizagi produce en la práctica: namespace `xmlns:bizagi` dentro de
`extensionElements`, elementos `<bizagi:BizagiExtensions>` / `<bizagi:BizagiProperties>` /
`<bizagi:BizagiProperty>` anidados en prácticamente cada nodo, colaboraciones con lanes,
subprocesos, gateways de varios tipos, boundary events, call activities, etc.

Ninguno de estos archivos fue creado o editado a mano para este ticket; son copias íntegras
(sin modificar) de archivos publicados por terceros, descargados directamente de GitHub.

## Procedencia

Fuente: **BPMN Model Interchange Test Suite** (BPMN MIWG, grupo de trabajo de interoperabilidad
BPMN de la OMG). Repositorio: <https://github.com/bpmn-miwg/bpmn-miwg-test-suite>.

- **Licencia del repositorio**: Creative Commons Attribution 3.0 Unported (CC BY 3.0), según
  `LICENSE.txt` en la raíz del repo
  (<https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/master/LICENSE.txt>).
  Es una licencia permisiva que solo exige atribución; no es AGPL ni LGPL, por lo que es
  compatible con nuestro repo (Apache-2.0). Esta atribución la damos aquí y en cada entrada.
- **Carpeta de origen dentro del repo**: `Bizagi Modeler 2.8.0.8/` — el propio nombre de la
  carpeta, puesto por BPMN MIWG, indica que estos archivos fueron generados exportando desde
  **Bizagi Modeler versión 2.8.0.8**. El XML no trae un atributo `exporterVersion` explícito
  (Bizagi no lo emite en esta versión), así que la versión se toma de esa carpeta, no del
  contenido del archivo.
- **Commit fijado**: `9dec051a098387b856ae97992eba681d1bb70b35` (se referencia ese commit
  exacto en las URLs de abajo para reproducibilidad; el archivo puede haberse movido o
  renombrado desde entonces en `main` del repo origen).

Todos los archivos fueron descargados sin modificar con `curl` desde
`raw.githubusercontent.com` y verificados con:
- `xmllint --noout` → XML bien formado en los 7.
- `grep -ci bizagi` → coincidencias abundantes (68 a 1142) en los 7.
- Tamaño de archivo: entre 16 KB y 302 KB, todos muy por debajo del límite de ~2 MB.

## Archivos incluidos

| Archivo | Origen (URL exacta) | Tamaño | Elementos destacados |
|---|---|---|---|
| `bizagi-miwg-A.1.0-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/A.1.0-roundtrip.bpmn | 16 KB | Caso base: colaboración con 2 participants, 1 lane, secuencia lineal de 3 tasks. Sirve como "smoke test" mínimo de extensiones Bizagi. |
| `bizagi-miwg-A.2.0-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/A.2.0-roundtrip.bpmn | 29 KB | Añade 2 `exclusiveGateway` (split/join). |
| `bizagi-miwg-A.3.0-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/A.3.0-roundtrip.bpmn | 30 KB | 1 `subProcess` embebido + 2 `boundaryEvent` sobre él. |
| `bizagi-miwg-A.4.0-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/A.4.0-roundtrip.bpmn | 55 KB | 3 participants con `messageFlow` entre pools, 2 `subProcess`, 2 lanes. Buen caso para colaboración multi-pool. |
| `bizagi-miwg-A.4.1-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/A.4.1-roundtrip.bpmn | 59 KB | Variante de A.4.0 con 3 lanes en vez de 2; el `<process id>` usa un id tipo `sid-XXXXXXXX-...` (formato distinto al resto, que usan `WFP-6-` o `_<uuid>`), útil para probar normalización de ids heterogéneos. |
| `bizagi-miwg-B.1.0-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/B.1.0-roundtrip.bpmn | 105 KB | 3 `callActivity`, `parallelGateway` + `exclusiveGateway` combinados, `userTask`/`serviceTask`, `dataObject`, 5 participants. Caso de complejidad media-alta. |
| `bizagi-miwg-B.2.0-roundtrip.bpmn` | https://github.com/bpmn-miwg/bpmn-miwg-test-suite/blob/9dec051a098387b856ae97992eba681d1bb70b35/Bizagi%20Modeler%202.8.0.8/B.2.0-roundtrip.bpmn | 301 KB | El más grande y completo: 5 `subProcess`, 11 `boundaryEvent`, gateways de los 4 tipos (`exclusive`, `parallel`, `inclusive`, `eventBased`), `intermediateCatchEvent`/`intermediateThrowEvent`, 85 `sequenceFlow`. Cubre casi todo el catálogo de patrones BPMN 2.0 que Bizagi es capaz de exportar. |

Todos comparten:
- `xmlns:bizagi="http://www.bizagi.com/bpmn20"` declarado localmente en cada
  `<bizagi:BizagiExtensions>` (patrón repetido nodo a nodo, no declarado una sola vez en la
  raíz — así es como Bizagi 2.8.0.8 lo emite realmente).
- `<extensionElements><bizagi:BizagiExtensions><bizagi:BizagiProperties><bizagi:BizagiProperty
  name="..." value="..." /></bizagi:BizagiProperties></bizagi:BizagiExtensions></extensionElements>`
  en prácticamente todos los nodos (eventos, tasks, gateways, sequenceFlows).
- ids con formato `_<uuid>` (con guion bajo inicial) o `WFP-6-`/`WFP-6-1` para el proceso; no se
  encontraron ids con espacios o dos-puntos en estos 7 archivos (no todo export de Bizagi trae
  ids no-NCName; si se necesita ese caso específico, hace falta un fixture adicional que sí lo
  tenga — ver sección "Pendiente" abajo).

## Fixtures descartados

Durante la búsqueda se encontraron muchos otros `.bpmn` con marcas Bizagi en código de GitHub
(vía `gh api search/code`), pero se descartaron por no tener licencia verificable en el
repositorio de origen (repos personales de estudiantes/proyectos universitarios sin archivo
`LICENSE`, lo que legalmente es "todos los derechos reservados" y no se puede redistribuir
aquí), por ejemplo: `rrojasda94/provecho-erp`, `chenKuer/Umise-Cat_Named_Doggie`,
`JosephMarcell/autocodegeneration`, `genomike/modelado_y_analisis_de_software`,
`Abdullah-57/Business-Model-Parsing-and-Analysis`, `angelo-casciani/sitcalc4bpmn`,
`aleferrariuy/aleferrariuy`, `Wadagraprana/Testing_pm4py`, `iamlvv/BPE-be`. Se priorizó
`bpmn-miwg-test-suite` porque es un repositorio institucional (OMG/BPMN MIWG) con licencia
explícita y permisiva.

## Pendiente (no bloqueante para este ticket)

Los 7 fixtures aquí son todos de la misma versión de Bizagi Modeler (2.8.0.8) porque es la
única carpeta de Bizagi que aparece en `bpmn-miwg-test-suite`, y no se encontró en el resto de
la búsqueda otro `.bpmn` real de una versión distinta de Bizagi con licencia permisiva
verificable. Si en el futuro Brito exporta un `.bpmn` propio desde una versión más reciente de
Bizagi Modeler (idealmente uno con algún id no-NCName, si el modelador llega a generar alguno),
añadirlo aquí mejora la cobertura de versiones y de ese caso límite específico.
