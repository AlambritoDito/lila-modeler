# Editor BPMN para la UI web de Lila Modeler: bpmn-js (licencia bpmn.io, watermark, actividad 2026, extensibilidad, rendimiento, tipos) frente a alternativas (KIE bpmn-editor/React Flow, diagram-js solo, bpmn-visualization, LogicFlow, Camunda Web Modeler, editores Apache/EPL/GPL, Rust/Tauri)

_Investigación verificada el 2026-09-03 por un agente con búsqueda web. Cada hallazgo lleva su nivel de confianza._

## Recomendación

Usar bpmn-js tal cual, con el watermark, y no forkear. La licencia es MIT más un enlace "Powered by bpmn.io" en la esquina del canvas que no se puede quitar ni ocultar (tampoco en un fork, tampoco con licencia Apache/MIT propia: Camunda Desktop Modeler, Fluxnova y Miragon lo llevan y son productos con marca). Se puede mover si sigue totalmente visible, así que el único requisito de diseño es reservar la esquina inferior derecha del canvas (panel de propiedades en un contenedor hermano, no superpuesto). Una vía de pago para retirarlo no está documentada y usuarios reportan que Camunda no la ofrece; no planificar en torno a ella. A cambio se obtiene la única librería del sector que en 2026 publica varias veces al mes (18.27.1 hoy), con tipos incluidos, ejemplos oficiales para exactamente lo que Lila necesita (moddle extension con namespace propio, PropertiesProvider propio, renderer custom para resaltar cuellos de botella) y con el comportamiento "nueva tarea → nombre editable sin 'Task 1'" ya de serie. Reemplazarla por diagram-js solo significa reescribir ~28.000 líneas y 27 módulos; ninguna alternativa Apache es equivalente: KIE bpmn-editor es la única candidata real (React + reactflow 11, React ≤18, semántica jBPM, una sola release, incubando) y conviene revisitarla en un año, no adoptarla ahora; bpmn-visualization es solo visor; LogicFlow no es BPMN conforme; el resto son Java/Eclipse de escritorio o proyectos de 0-100 estrellas.

Estructura mínima que no obliga a reescribir: (1) un paquete `bpmn-model` (bpmn-moddle + bpmnlint + bpmn-auto-layout, todos MIT y Node-nativos) que es el que usan CLI, API REST y MCP para leer/escribir/validar/auto-diagramar .bpmn sin navegador; (2) un namespace XML propio (p.ej. `lila:`) definido una sola vez como descriptor moddle JSON y compartido por el editor y el servidor, de modo que las propiedades de simulación y documentación viajen dentro del .bpmn estándar como extensionElements/atributos y sobrevivan a cualquier otra herramienta (bpmn-moddle preserva namespaces desconocidos en el round-trip; verificado en sus tests); (3) en la UI, un componente React fino que monte BpmnModeler con `moddleExtensions: { lila }`, `additionalModules` propios y un panel de propiedades propio (o el oficial con un provider extra); el resto de la app sólo ve `importXML/saveXML`, el eventBus y `modeling.updateProperties`. No usar element templates (sólo bindean namespaces bpmn/zeebe/camunda), no usar bpmn-js-headless en producción (experimental, no endorsado), y dejar el escenario de simulación fuera del .bpmn (ADR-007) aunque los valores por defecto por actividad puedan ir en `lila:`.

Riesgos aceptados y cómo se acotan: rendimiento (SVG sin virtualización) — el benchmark oficial de julio 2026 opera con 8.099 elementos y los procesos de negocio reales están muy por debajo, así que basta con un test de importación con el BPMN más grande que Brito tenga; tipos — bpmn-js y bpmn-moddle tienen tipos, los paquetes del properties panel no, por lo que si se escribe panel propio en React se evita esa laguna; dependencia estratégica — el aislamiento real no es una "abstracción de editor" (nadie va a cambiar de editor BPMN sin reescribir la UI) sino que todo lo que importa viva en el .bpmn estándar y en el paquete Node `bpmn-model`, que no depende del editor. Con eso, el spike del Paso 3 de NEXT_STEPS.md queda en: montar BpmnModeler en React, cargar/guardar el benchmark .bpmn, crear tarea y comprobar edición inmediata, añadir `lila:duration` vía moddle extension y verlo en el XML exportado; debería caber en un día.

## Hallazgos

- **[verified]** La licencia de bpmn-js ("bpmn.io license") es texto MIT estándar (Copyright 2014-present Camunda Services GmbH) más una única cláusula adicional: "The source code responsible for displaying the bpmn.io project watermark that links back to https://bpmn.io as part of rendered diagrams MUST NOT be removed or changed. When this software is being used in a website or application, the watermark must stay fully visible and not visually overlapped by other elements." No hay copyleft, ni restricción de uso comercial, ni obligación de publicar código propio.
  - _Evidencia_: Texto íntegro descargado hoy (2026-09-03) de https://raw.githubusercontent.com/bpmn-io/bpmn-js/develop/LICENSE y https://bpmn.io/license/ (cubre bpmn-js, dmn-js, form-js, cmmn-js). GitHub API reporta license NOASSERTION (licencia custom); npm reporta "SEE LICENSE IN LICENSE".
- **[verified]** El watermark es un enlace <a class="bjs-powered-by" href="http://bpmn.io" title="Powered by bpmn.io"> con el logo SVG, añadido por la función addProjectLogo(container) en lib/BaseViewer.js dentro de un bloque delimitado por comentarios /* <project-logo> */; se inserta como hijo del contenedor del diagrama, posicionado absoluto abajo-derecha (15px, z-index 100). El código del lightbox está en lib/util/PoweredByUtil.js. Son los únicos puntos del código con esta lógica.
  - _Evidencia_: grep sobre clon superficial de bpmn-io/bpmn-js (lib/BaseViewer.js líneas 180-184 y 859-911; lib/util/PoweredByUtil.js:59) y lectura de https://raw.githubusercontent.com/bpmn-io/bpmn-js/main/lib/BaseViewer.js (comentario: "Adds the project logo to the diagram container as required by the bpmn.io license").
- **[verified]** Postura oficial del equipo bpmn.io sobre el logo: no se puede quitar, ocultar, cubrir, redimensionar ni recolorear ("No size adjustments are allowed according to the license", barmac, 2024-07-04; "This is not allowed" ante cambiar verde a negro; "You cannot change the size and position of the logo"). Sí se admitió reubicarlo cuando otro widget lo tapaba, siempre que siga totalmente visible ("we think it's OK to move the logo so that it's still fully visible", 2024-06-11).
  - _Evidencia_: https://forum.bpmn.io/t/bpmn-js-license-watermark-doubt/11267 ; https://forum.bpmn.io/t/bpmn-io-license/4006 ; https://forum.bpmn.io/t/license-watermark-position/11152 ; https://forum.bpmn.io/t/license-questions/85
- **[verified]** Un fork de bpmn-js NO permite quitar el watermark: la cláusula aplica a "all copies or substantial portions of the Software" y el equipo lo dijo explícitamente: "By forking bpmn-js you agree to adhere to our license, too" y "You have to display the project logo as soon as you reuse substantial portions of the library".
  - _Evidencia_: Texto de la licencia + https://forum.bpmn.io/t/license-questions/85
- **[unverified]** Existencia de una vía de pago para retirar el logo: el equipo bpmn.io y Camunda (Niall) dicen "get in contact with Camunda sales and request a re-licensing agreement" / "reach out to the sales team to find out if there's an option", pero usuarios que lo intentaron reportan que el equipo comercial "had no information of the relicensing agreement possibility". No hay ninguna oferta pública documentada.
  - _Evidencia_: https://forum.bpmn.io/t/license-questions/85 ; https://forum.bpmn.io/t/license-type-clarification-commercial-use/6443 ; https://forum.camunda.io/t/bpmn-license-bpmn-io/51338
- **[verified]** Productos con marca propia conviven con el watermark sin problema legal: Camunda Desktop Modeler (MIT, Electron) lo muestra y declara "Uses bpmn-js, dmn-js, and form-js licensed under the bpmn.io license"; Fluxnova Modeler (FINOS, MIT, fork del Desktop Modeler) y Miragon/bpmn-modeler (Apache-2.0, VS Code/Theia) también se construyen sobre bpmn.io y conservan el logo. Es decir, que el proyecto sea "Apache" o "MIT" no elimina el watermark si por debajo hay bpmn-js.
  - _Evidencia_: https://github.com/camunda/camunda-modeler (MIT, 1.706 estrellas, push 2026-09-03); https://github.com/finos/fluxnova-modeler (MIT, THIRD_PARTY_NOTICES con bpmn.io license, 31 estrellas); https://github.com/Miragon/bpmn-modeler (Apache-2.0, 35 estrellas, push 2026-09-03). Datos vía api.github.com.
- **[verified]** bpmn-js está muy activo en 2026: última versión 18.27.1 publicada 2026-09-03; 27 releases npm en 2026 (16 en 2025); 253 commits en develop desde 2026-01-01; 77 contribuidores (incluye anónimos); 9.645 estrellas, 1.485 forks, 128 issues abiertos. diagram-js 15.26.0 (2026-08-28) con 32 releases en 2026. Blog bpmn.io publicó en 2026-01-20 (copy/paste nativo entre editores, bpmn-js 18.10.0).
  - _Evidencia_: npm view bpmn-js time; api.github.com/repos/bpmn-io/bpmn-js (pushed_at 2026-09-03T13:59:04Z); cabecera Link de /commits?since=2026-01-01 (page=253) y /contributors?anon=true (page=77); https://github.com/bpmn-io/bpmn-js/releases ; https://bpmn.io/blog/posts/2026-cross-editor-copy-and-paste
- **[verified]** bpmn-moddle (parser/serializador BPMN 2.0) es MIT, versión 10.2.0 (2026-08-25), ESM, requiere Node >= 20.12, incluye tipos TypeScript (dist/types/index.d.ts) y depende sólo de moddle, moddle-xml (parser saxen, MIT) y min-dash: funciona en Node sin DOM ni navegador, independiente del editor.
  - _Evidencia_: https://registry.npmjs.org/bpmn-moddle/latest ; https://registry.npmjs.org/moddle-xml/latest (saxen ^11.1.0, Node >= 18, MIT); https://raw.githubusercontent.com/bpmn-io/bpmn-moddle/main/LICENSE ; README https://github.com/bpmn-io/bpmn-moddle
- **[verified]** bpmn-moddle preserva atributos y elementos de namespaces desconocidos en el round-trip: el test 'generic xml extensions' lee <i18n:translation> dentro de extensionElements como elemento genérico ($type 'i18n:translation', $body), y los tests 'extension attributes' / 'extension attributes on expression' re-serializan atributos con prefijo ajeno (p.ej. myNs:expressionType). Esto permite que un .bpmn con extensiones propias (o de Bizagi/Camunda) sobreviva a importar/exportar aunque no se registre el moddle extension.
  - _Evidencia_: Clon de bpmn-io/bpmn-moddle: test/spec/xml/read.js líneas 833-870 y test/spec/xml/roundtrip.js líneas 152-185; fixture test/fixtures/bpmn/extension-attributes.bpmn
- **[verified]** Herramientas oficiales bpmn.io utilizables en Node (para la API REST / MCP sin navegador): bpmnlint 11.13.0 (MIT, CLI, Node >= 20, depende de bpmn-moddle) para validación; bpmn-auto-layout 1.3.0 (MIT, Node >= 22.12; 2.0.0-alpha.2 el 2026-07-24) para generar BPMNDI de diagramas sin coordenadas (caso típico: un agente crea el proceso); bpmn-js-native-copy-paste 0.3.0 (MIT).
  - _Evidencia_: npm view bpmnlint / bpmn-auto-layout / bpmn-js-native-copy-paste (version, license, time); https://github.com/bpmn-io/bpmn-auto-layout
- **[verified]** bpmn-js-headless (bpmn-io/bpmn-js-headless, 0.2.0 publicado 2026-07-28) permite operaciones de modelado de bpmn-js en Node sin DOM, pero su README advierte: "This is an experimental library and not officially supported / endorsed by bpmn.io". GitHub API no reporta licencia (None) y npm no muestra campo license; 3 estrellas.
  - _Evidencia_: https://github.com/bpmn-io/bpmn-js-headless ; npm view bpmn-js-headless; api.github.com/repos/bpmn-io/bpmn-js-headless
- **[verified]** Properties panel: @bpmn-io/properties-panel 3.54.0 (MIT, basado en Preact, 34 releases en 2026, sin .d.ts propios) y bpmn-js-properties-panel 5.65.0 (MIT, sin .d.ts). Peer deps del segundo: bpmn-js >= 11.5, diagram-js >= 11.9, @bpmn-io/properties-panel >= 3.42, camunda-bpmn-js-behaviors >= 0.4 (MIT, 1.18.0) — incluso el proveedor BPMN genérico arrastra ese paquete de Camunda.
  - _Evidencia_: https://registry.npmjs.org/@bpmn-io/properties-panel/latest ; https://registry.npmjs.org/bpmn-js-properties-panel/latest ; https://unpkg.com/@bpmn-io/properties-panel/?meta (solo .d.ts de preact embebido) ; https://unpkg.com/bpmn-js-properties-panel/?meta (ningún .d.ts); npm view camunda-bpmn-js-behaviors
- **[verified]** Añadir propiedades propias es un patrón documentado y pequeño: (1) descriptor JSON de moddle extension con name/uri/prefix y types con extends/superClass y properties isAttr/isMany/type; (2) pasarlo en new BpmnModeler({ moddleExtensions: { qa: qaExtension } }); (3) leer/escribir con modeling.updateProperties(element, {...}); (4) se serializa como atributos con namespace propio (qa:suitable="...") o como elementos dentro de bpmn:extensionElements (qa:AnalysisDetails). Para la UI, un PropertiesProvider registrado con prioridad baja añade un grupo (ejemplo magic:spell en properties-panel-extension).
  - _Evidencia_: https://github.com/bpmn-io/bpmn-js-example-model-extension ; https://github.com/bpmn-io/bpmn-js-examples/tree/main/properties-panel-extension
- **[verified]** Renderers personalizados: subclase de BaseRenderer con prioridad 1500 (por encima del 1000 por defecto), canRender(element) selectivo, drawShape que puede delegar en bpmnRenderer.drawShape y decorar el SVG, getShapePath para el recorte de conexiones; se registra vía additionalModules. También hay ejemplos oficiales de custom palette/context pad y custom modeling rules.
  - _Evidencia_: https://github.com/bpmn-io/bpmn-js-example-custom-rendering ; https://github.com/bpmn-io/bpmn-js-examples (custom-elements, custom-modeling-rules)
- **[verified]** Element templates: la especificación (bpmn-io/element-templates, package.json license MIT, sin archivo LICENSE en raíz) y la implementación bpmn-js-element-templates 2.35.0 (MIT, 2026-08-28) sólo ofrecen proveedores para Camunda 7 (ElementTemplatesPropertiesProviderModule) y Camunda 8 (CloudElementTemplatesPropertiesProviderModule). Los bindings documentados escriben únicamente en namespaces bpmn:, zeebe: y camunda: (property, zeebe:input/output/property/taskHeader/taskDefinition, bpmn:Message#property, etc.); no existe mecanismo para un namespace propio. Controles: String, Text, Number, Boolean, Dropdown, Hidden.
  - _Evidencia_: https://raw.githubusercontent.com/bpmn-io/element-templates/main/package.json ; https://raw.githubusercontent.com/bpmn-io/bpmn-js-element-templates/main/README.md ; https://docs.camunda.io/docs/components/modeler/element-templates/template-properties/ ; api.github.com/repos/bpmn-io/element-templates (license None)
- **[verified]** "Nueva tarea → nombre editable de inmediato, sin 'Task 1'" es el comportamiento por defecto de bpmn-js: lib/features/label-editing/LabelEditingProvider.js escucha 'create.end' (prioridad 500) y 'autoPlace.end' y llama directEditing.activate(element) para bpmn:Activity, bpmn:Event, bpmn:TextAnnotation y bpmn:Participant; sólo se omite en eventos táctiles o si hints.createElementsBehavior === false. No se asigna ningún nombre por defecto. Esfuerzo: cero.
  - _Evidencia_: https://raw.githubusercontent.com/bpmn-io/bpmn-js/main/lib/features/label-editing/LabelEditingProvider.js (handlers create.end / autoPlace.end y función activateDirectEdit)
- **[verified]** Rendimiento en diagramas grandes: bpmn-js renderiza SVG en el DOM sin virtualización. En junio 2026 un usuario reportó 4 s de bloqueo al mover ~500 de 1.000 shapes; nikku lo atribuyó a layout thrashing y lo corrigió en diagram-js PR #1063 (merge 2026-07-05: setup del preview con 500 elementos 246 ms → 54 ms), publicado en diagram-js 15.19.0 (2026-07-06, changelog: "improve rendering and editing of larger diagrams significantly") y consumido por bpmn-js 18.20.0/18.21.0 (2026-07-06/08). bpmn-js PR #2460 (merge 2026-07-06) añadió un benchmark con diagramas de 49 / 1.049 / 4.099 / 8.099 elementos: en 8.099 elementos getParents 1.517 → 1,7 ms, copy 6.709 → 901 ms, space preview 19.213 → 2.052 ms, move preview 7.194 → 1.654 ms; el import no cambió (~1,0x). Además 18.15.0 (2026-04-22) mejoró render de texto e import.
  - _Evidencia_: https://forum.bpmn.io/t/performance-of-diagram-js-for-large-diagrams/15211 ; https://github.com/bpmn-io/diagram-js/pull/1063 ; https://github.com/bpmn-io/bpmn-js/pull/2460 ; https://raw.githubusercontent.com/bpmn-io/diagram-js/develop/CHANGELOG.md ; npm view diagram-js/bpmn-js time
- **[likely]** La afirmación de que bpmn-js "sufre por encima de ~500 elementos" proviene del marketing de JointJS (competidor comercial que vende BPMN 'sin watermark' en JointJS+); el benchmark oficial de julio 2026 opera con 8.099 elementos. Para procesos de negocio típicos (decenas a pocos cientos de nodos por diagrama) no es un factor.
  - _Evidencia_: https://www.jointjs.com/blog/jointjs-vs-bpmn-js-technical-comparison-for-production-bpmn-editors ; https://www.jointjs.com/bpmn-modeling-tools ("MPL 2.0 core, JointJS+ commercial", BPMN sólo en JointJS+) ; PR #2460
- **[verified]** TypeScript: bpmn-js incluye declaraciones de tipos desde 13.0.0 (2023-04-19; post oficial 2024-01-09) generadas con bio-dts a partir de JSDoc (types: lib/index.d.ts); 18.18.0 (2026-06-08) añadió declaration maps; diagram-js expone lib/Diagram.d.ts; bpmn-moddle tiene tipos. Servicios se obtienen con genéricos: modeler.get('modeling'). Las lagunas están en @bpmn-io/properties-panel y bpmn-js-properties-panel (sin tipos) y en moddle extensions custom (business objects tipados como any).
  - _Evidencia_: https://bpmn.io/blog/posts/2024-bpmn-js-type-declarations ; https://registry.npmjs.org/bpmn-js/latest (types ./lib/index.d.ts) ; https://registry.npmjs.org/diagram-js/latest ; CHANGELOG bpmn-js (18.18.0 'ship type declaration maps', 13.0.0 'rework and complete type definitions')
- **[verified]** bpmn-js 18 (2024-11-06) exige Node >= 20 para build, hizo el canvas un elemento enfocable nativo y eliminó el binding explícito de teclado (keyboard.bind/bindTo ahora produce errores en consola); los atajos sólo actúan cuando el canvas tiene foco, lo que facilita convivir con una app React (canvas.focus(), canvas.isFocused(), evento canvas.focus.changed).
  - _Evidencia_: https://bpmn.io/blog/posts/2025-bpmn-js-18-playing-nicely-with-others ; CHANGELOG bpmn-js 18.0.0; npm time 18.0.0 = 2024-11-06
- **[verified]** Tamaño de lo que habría que reescribir si se optara por 'diagram-js solo' (MIT, sin watermark): bpmn-js/lib tiene 28.100 líneas JS en 176 archivos y 27 módulos de features (modeling, replace, popup-menu, palette, context-pad, copy-paste, auto-place, space-tool, snapping, grid-snapping, label-editing, drilldown, search, rules, ordering, di-ordering, etc.); sólo BpmnRenderer.js son 2.420 líneas. diagram-js/lib son 32.527 líneas. El equipo bpmn.io confirma que construir directamente sobre diagram-js no tiene restricción de logo.
  - _Evidencia_: wc -l sobre clones superficiales de bpmn-io/bpmn-js y bpmn-io/diagram-js (2026-09-03); https://forum.bpmn.io/t/license-questions/85 (diagram-js 'no restrictions'); https://raw.githubusercontent.com/bpmn-io/diagram-js/main/LICENSE (MIT)
- **[verified]** Camunda Web Modeler no es open source: la documentación oficial dice que el código fuente de Web Modeler y Console "is provided on demand" (dependency-request@camunda.com) bajo licencia propietaria; gratis hasta 5 usuarios en uso no productivo. Sólo el Desktop Modeler (Electron + bpmn-js) es MIT.
  - _Evidencia_: https://docs.camunda.io/docs/reference/dependencies/ ; https://docs.camunda.io/docs/reference/licenses/ ; https://github.com/camunda/camunda-modeler
- **[verified]** Apache KIE BPMN Editor nuevo (@kie-tools/bpmn-editor, Apache-2.0, proyecto en incubación ASF): componente React 'controlado' construido sobre reactflow ^11.8.3 (no @xyflow/react 12), PatternFly 5, @kie-tools/bpmn-marshaller tipado; peerDependency react >=18.3.1 <19 (en la 10.2.0 publicada: >=17.0.2 <19) → no soporta React 19. Única versión publicada: 10.2.0 el 2026-04-26 (anuncio 2026-04-29: "replaces the legacy GWT-based tooling"). También existe @kie-tools/bpmn-editor-standalone 10.2.0. El EPIC #1933 se cerró el 2026-06-01 con 14 ítems marcados y 12 sin marcar; en la fase de prototipo faltaban edge splicing, guías de alineación, minimap y explorer. Repo: 293 estrellas, 336 issues abiertos, push 2026-09-02.
  - _Evidencia_: https://registry.npmjs.org/@kie-tools/bpmn-editor (time 10.2.0 = 2026-04-26) ; https://raw.githubusercontent.com/apache/incubator-kie-tools/main/packages/bpmn-editor/package.json ; https://raw.githubusercontent.com/apache/incubator-kie-tools/main/packages/bpmn-editor/README.md ; https://kie.apache.org/blog/kie_10_2_0_release/ ; api.github.com/repos/apache/incubator-kie-issues/issues/1933 (closed_at 2026-06-01) ; api.github.com/repos/apache/incubator-kie-tools/releases/latest (10.2.0, 2026-04-26)
- **[verified]** El editor KIE está semánticamente orientado a jBPM/Kogito/Drools (WorkItemDefinition, onEntry/onExit scripts, Activity SLAs, Business Rule Task con DMN/Drools, paneles de correlación) y su README avisa que el proyecto en incubación 'has yet to be fully endorsed by the ASF'. Para un producto ajeno a KIE implica cargar PatternFly y convenciones jBPM, y depender de un editor con una sola release pública y sin historial de compatibilidad.
  - _Evidencia_: README de packages/bpmn-editor ; EPIC #1933
- **[verified]** bpmn-visualization (process-analytics / Bonitasoft): Apache-2.0, TypeScript con tipos, pero estrictamente visualización/overlays (sin edición); depende de mxgraph 4.2.2 (no maxGraph). Versión 0.48.0 (2026-06-23), 288 estrellas, push 2026-09-03. No sirve como editor; podría servir para vistas de resultados de simulación sobre el diagrama.
  - _Evidencia_: https://github.com/process-analytics/bpmn-visualization-js ; https://raw.githubusercontent.com/process-analytics/bpmn-visualization-js/master/package.json ; npm view bpmn-visualization time
- **[likely]** LogicFlow (didi, Apache-2.0, 11.676 estrellas, @logicflow/extension 2.3.1 del 2026-07-30) tiene BpmnAdapter/BpmnXmlAdapter orientados a Activiti, con bugs documentados de conversión XML (arrays, nodos #text, orden de bpmn:incoming/outgoing) y la propia documentación desaconseja depender sólo del adapter para BPMN/XML. No es un editor BPMN 2.0 conforme.
  - _Evidencia_: api.github.com/repos/didi/LogicFlow ; npm view @logicflow/extension ; https://github.com/didi/LogicFlow/issues/718 ; https://github.com/didi/LogicFlow/issues/325 ; https://07.logic-flow.cn/guide/extension/bpmn-element.html
- **[verified]** ProcessMaker/modeler: MIT según GitHub (package.json sin campo license), Vue 2 + jointjs ^3.7.7 + bpmn-moddle ^6 + bpmnlint ^6; v1.69.45, push 2026-09-03, 94 estrellas. Está acoplado al ecosistema ProcessMaker (vue-form-elements, bpmnlint-plugin-processmaker) y a Vue 2, ya fuera de soporte.
  - _Evidencia_: api.github.com/repos/ProcessMaker/modeler ; https://raw.githubusercontent.com/ProcessMaker/modeler/develop/package.json
- **[verified]** Open BPMN (imixs): licencia EPL-2.0 OR GPL-2.0 with Classpath-exception, arquitectura Eclipse GLSP (servidor Java + cliente web/Theia); 137 estrellas, push 2026-08-14. Requiere un servidor Java para editar; no encaja con una UI React ligera.
  - _Evidencia_: https://raw.githubusercontent.com/imixs/open-bpmn/master/LICENSE ; api.github.com/repos/imixs/open-bpmn ; https://github.com/imixs/open-bpmn
- **[likely]** Editores de escritorio no web: Modelio es GPL-3.0, Java/Eclipse RCP, versión 6.2.0 (1.046 estrellas, push 2026-08-26); Eclipse BPMN2 Modeler es un plugin Eclipse (Graphiti/EMF) cuya última versión 1.5.2 data de 2022; Activiti Modeler está deprecado según su comunidad. Ninguno es embebible en una web app.
  - _Evidencia_: api.github.com/repos/ModelioOpenSource/Modelio ; https://marketplace.eclipse.org/content/eclipse-bpmn2-modeler ; https://projects.eclipse.org/projects/soa.bpmn2-modeler ; https://connect.hyland.com/t5/alfresco-forum/what-modeler-i-can-use-for-activiti-7-or-8/m-p/43231
- **[likely]** React Flow / xyflow (MIT) no trae BPMN: el único editor BPMN serio sobre reactflow es el de KIE; el resto son visualizadores o demos (p.ej. MohamadAlturky/bpmn-designer). Construir BPMN sobre xyflow significa implementar desde cero la semántica BPMN (pools/lanes, boundary events, subprocesos, reglas de conexión, DI, etiquetas, replace menu).
  - _Evidencia_: https://github.com/xyflow/xyflow ; https://github.com/MohamadAlturky/bpmn-designer ; package.json del KIE bpmn-editor (@kie-tools/xyflow-react-kie-diagram propio)
- **[verified]** No existe un editor BPMN nativo en Rust/Tauri/egui. Lo más cercano: dquinteros/diagrams (MIT, Tauri 2 + React 19, DSL de texto, sin XML BPMN 2.0, 0 estrellas) y crates de backend: ebi_bpmn (MIT, parser/writer/espacio de estados, "does not currently consider or export layouting (bpmndi) information"), snurr, bpmn-engine, bpxe (5 años sin cambios). Tauri sigue siendo viable sólo como wrapper de la web app (y el watermark de bpmn-js debe seguir visible dentro del wrapper).
  - _Evidencia_: https://github.com/dquinteros/diagrams ; https://github.com/BPM-Research-Group/Ebi_BPMN ; https://crates.io/keywords/bpmn ; https://github.com/tauri-apps/tauri-egui (archivado 2025-11-07)
- **[verified]** bpmn-js-token-simulation (MIT, 0.40.0 del 2026-07-01, 312 estrellas) ofrece animación de tokens sobre bpmn-js; es útil como visualización didáctica, pero no es DES (sin colas, recursos ni tiempos), tal como ya distingue SIMULATION_ENGINE.md.
  - _Evidencia_: npm view bpmn-js-token-simulation ; api.github.com/repos/bpmn-io/bpmn-js-token-simulation
- **[verified]** Integración con React: bpmn-js es agnóstico de framework (se monta en un div); el wrapper oficial bpmn-io/react-bpmn (MIT, 222 estrellas, push 2026-09-02) es un visor mínimo. El properties panel es Preact montado en un contenedor DOM; una app React puede usarlo tal cual o sustituirlo por un panel propio que lea/escriba el business object vía modeling.updateProperties.
  - _Evidencia_: https://github.com/bpmn-io/react-bpmn ; https://registry.npmjs.org/@bpmn-io/properties-panel/latest
- **[unverified]** Los posts 'Ditching the XML in BPMN 2.0' (2025-04-01) e 'Introducing EBPMN' (2024-04-01) del blog bpmn.io llevan fecha 1 de abril; no deben tomarse como cambios de roadmap sin confirmación.
  - _Evidencia_: https://bpmn.io/blog/ (listado con fechas); las URLs de esos posts no resolvieron en la ruta probada

## Preguntas abiertas

- ¿Existe realmente una vía comercial con Camunda para retirar el watermark? El equipo bpmn.io remite a ventas, pero usuarios reportan que ventas no la conoce; sólo un correo directo a Camunda lo aclararía. Para Lila no es bloqueante: el plan asume el logo visible.
- ¿Licencia y viabilidad de bpmn-js-headless? GitHub/npm no muestran licencia y el README lo declara experimental y no endorsado; si el MCP necesita operaciones de modelado (no solo parseo) en servidor, habrá que decidir entre bpmn-js-headless, jsdom + bpmn-js, o implementar las operaciones sobre bpmn-moddle + bpmn-auto-layout.
- ¿Calidad real del nuevo editor BPMN de Apache KIE (10.2.0, abril 2026)? No se ha probado; su EPIC cerró con 12 ítems sin marcar, sólo hay una versión publicada y exige React ≤18 y reactflow 11. Vale la pena un spike de medio día en 6-12 meses si aparece una segunda release.
- ¿Cómo se comporta bpmn-js con los .bpmn exportados por Bizagi (extensiones bizagi:*, DI)? bpmn-moddle preserva namespaces desconocidos según sus tests, pero conviene validar con archivos reales de Brito en el spike.
- ¿Se necesitan tipos para el properties panel oficial? Ni @bpmn-io/properties-panel ni bpmn-js-properties-panel publican .d.ts; si se escribe panel propio en React el problema desaparece, pero hay que decidirlo en el spike.
- Rendimiento por encima de ~8.000 elementos no está medido por bpmn.io (el benchmark llega a 8.099 y el import no mejoró); irrelevante para procesos de negocio, relevante sólo si se importan diagramas generados automáticamente muy grandes.
- Los posts del blog bpmn.io fechados el 1 de abril (2024 'Introducing EBPMN', 2025 'Ditching the XML') no pudieron abrirse; se asume que son bromas y no cambios de roadmap.

## Fuentes

- https://raw.githubusercontent.com/bpmn-io/bpmn-js/develop/LICENSE
- https://bpmn.io/license/
- https://raw.githubusercontent.com/bpmn-io/bpmn-js/main/lib/BaseViewer.js
- https://raw.githubusercontent.com/bpmn-io/bpmn-js/main/lib/features/label-editing/LabelEditingProvider.js
- https://forum.bpmn.io/t/license-questions/85
- https://forum.bpmn.io/t/bpmn-io-license/4006
- https://forum.bpmn.io/t/license-type-clarification-commercial-use/6443
- https://forum.bpmn.io/t/bpmn-js-license-watermark-doubt/11267
- https://forum.bpmn.io/t/license-watermark-position/11152
- https://forum.camunda.io/t/bpmn-license-bpmn-io/51338
- https://github.com/bpmn-io/bpmn.io/issues/16
- https://github.com/bpmn-io/bpmn-js/releases
- https://raw.githubusercontent.com/bpmn-io/bpmn-js/main/CHANGELOG.md
- https://registry.npmjs.org/bpmn-js/latest
- https://registry.npmjs.org/bpmn-moddle/latest
- https://registry.npmjs.org/diagram-js/latest
- https://registry.npmjs.org/moddle-xml/latest
- https://registry.npmjs.org/@bpmn-io/properties-panel/latest
- https://registry.npmjs.org/bpmn-js-properties-panel/latest
- https://unpkg.com/@bpmn-io/properties-panel/?meta
- https://unpkg.com/bpmn-js-properties-panel/?meta
- https://raw.githubusercontent.com/bpmn-io/bpmn-moddle/main/LICENSE
- https://github.com/bpmn-io/bpmn-moddle
- https://raw.githubusercontent.com/bpmn-io/diagram-js/main/LICENSE
- https://raw.githubusercontent.com/bpmn-io/diagram-js/develop/CHANGELOG.md
- https://github.com/bpmn-io/diagram-js/pull/1063
- https://github.com/bpmn-io/bpmn-js/pull/2460
- https://forum.bpmn.io/t/performance-of-diagram-js-for-large-diagrams/15211
- https://forum.camunda.io/t/bpmn-modeler-performance-issues-with-large-diagrams/58520
- https://bpmn.io/blog/
- https://bpmn.io/blog/posts/2024-bpmn-js-type-declarations
- https://bpmn.io/blog/posts/2025-bpmn-js-18-playing-nicely-with-others
- https://bpmn.io/blog/posts/2026-cross-editor-copy-and-paste
- https://github.com/bpmn-io/bpmn-js-examples
- https://github.com/bpmn-io/bpmn-js-examples/tree/main/properties-panel-extension
- https://github.com/bpmn-io/bpmn-js-example-model-extension
- https://github.com/bpmn-io/bpmn-js-example-custom-rendering
- https://github.com/bpmn-io/element-templates
- https://raw.githubusercontent.com/bpmn-io/element-templates/main/package.json
- https://raw.githubusercontent.com/bpmn-io/bpmn-js-element-templates/main/README.md
- https://docs.camunda.io/docs/components/modeler/element-templates/template-properties/
- https://github.com/bpmn-io/bpmn-js-headless
- https://github.com/bpmn-io/bpmn-auto-layout
- https://github.com/bpmn-io/react-bpmn
- https://github.com/camunda/camunda-modeler
- https://docs.camunda.io/docs/reference/dependencies/
- https://docs.camunda.io/docs/reference/licenses/
- https://github.com/apache/incubator-kie-tools/tree/main/packages/bpmn-editor
- https://raw.githubusercontent.com/apache/incubator-kie-tools/main/packages/bpmn-editor/README.md
- https://raw.githubusercontent.com/apache/incubator-kie-tools/main/packages/bpmn-editor/package.json
- https://registry.npmjs.org/@kie-tools/bpmn-editor
- https://github.com/apache/incubator-kie-issues/issues/1933
- https://github.com/apache/incubator-kie-tools/releases
- https://kie.apache.org/blog/kie_10_2_0_release/
- https://github.com/process-analytics/bpmn-visualization-js
- https://raw.githubusercontent.com/process-analytics/bpmn-visualization-js/master/package.json
- https://github.com/didi/LogicFlow
- https://github.com/didi/LogicFlow/issues/718
- https://github.com/didi/LogicFlow/issues/325
- https://github.com/imixs/open-bpmn
- https://raw.githubusercontent.com/imixs/open-bpmn/master/LICENSE
- https://github.com/ProcessMaker/modeler
- https://raw.githubusercontent.com/ProcessMaker/modeler/develop/package.json
- https://github.com/finos/fluxnova-modeler
- https://github.com/finos/fluxnova-bpm-platform/discussions/6
- https://github.com/Miragon/bpmn-modeler
- https://github.com/ModelioOpenSource/Modelio
- https://marketplace.eclipse.org/content/eclipse-bpmn2-modeler
- https://www.jointjs.com/bpmn-modeling-tools
- https://raw.githubusercontent.com/clientIO/joint/master/LICENSE
- https://github.com/xyflow/xyflow
- https://github.com/MohamadAlturky/bpmn-designer
- https://github.com/dquinteros/diagrams
- https://github.com/BPM-Research-Group/Ebi_BPMN
- https://crates.io/keywords/bpmn
- https://github.com/tauri-apps/tauri-egui
- https://api.github.com/repos/bpmn-io/bpmn-js
- https://api.github.com/repos/apache/incubator-kie-tools
