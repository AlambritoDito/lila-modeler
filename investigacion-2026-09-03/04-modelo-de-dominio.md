# Modelo de dominio y fronteras de módulos de una plataforma de Process Intelligence, aprendidos de ADONIS, Signavio, Apromore, Camunda Web Modeler, ARIS, Bizagi, Bonita, Flowable y Modelio, más los estándares (BPMN 2.0 extensiones, BPSim, DMN, CMMN, XPDL, XES, OCEL 2.0), para definir identidad/versionado/namespace/layout mínimos del MVP de Lila Modeler sin forzar una reescritura.

_Investigación verificada el 2026-09-03 por un agente con búsqueda web. Cada hallazgo lleva su nivel de confianza._

## Recomendación

Lo que el MVP debe fijar desde el día uno (y no cuesta casi nada): (1) Identidad de elemento = el atributo `id` BPMN, generado por Lila como NCName con prefijo por tipo y sufijo aleatorio (estilo `Activity_7f3k2q1` o `sid-<uuid>`), nunca regenerado al importar/exportar ni al renombrar, y nuevo id al copiar/pegar; toda información de negocio o simulación se cuelga de ese id, jamás del nombre. (2) Identidad de proceso = `bpmn:process@id` como clave lógica estable (slug ASCII, tipo `credito-solicitud`) + una etiqueta de versión; en `bpmn:definitions` escribir `exporter="Lila Modeler"`, `exporterVersion` y `targetNamespace` propio. (3) Un único namespace de extensión versionado, p. ej. `xmlns:lila="https://lila-modeler.org/schema/bpmn/1.0"`, con un descriptor moddle desde el primer PoC de bpmn-js; los datos de documentación por elemento van DENTRO del .bpmn como `extensionElements` (elementos, no atributos, para permitir listas): descripción usando el estándar `bpmn:documentation` (lo leen ADONIS, Signavio y Camunda), y `lila:responsibility type="R|A|C|I" roleRef="…"`, `lila:systemRef`, `lila:documentRef`, `lila:riskRef`, `lila:controlRef`, `lila:kpiRef`, `lila:input`/`lila:output`, `lila:versionTag` (calcado de `zeebe:versionTag`). Regla: los `*Ref` apuntan a ids de un catálogo externo; una referencia colgante es un warning de lint, no un error. (4) Los parámetros de simulación NO van en el .bpmn (ADR-007): un `scenario.json` por escenario, keyed por id de elemento, con el vocabulario de BPSim 2.0 (processingTime, probability, quantity, fixedCost/unitCost, seed, warmup, replication, `inherits` para what-if) y la codificación de distribuciones de Prosimos; así el importador/exportador BPSim futuro es un mapeo 1:1 y no un rediseño. (5) Layout de ficheros mínimo, apto para git: `processes/<clave>/model.bpmn`, `processes/<clave>/scenarios/<nombre>.json`, `catalog.json` (roles, sistemas, documentos, riesgos, controles, KPIs, cada uno con id estable y tipo) a nivel de repositorio. (6) Versionado MVP = git (commit/tag por versión; AS-IS y TO-BE son dos ficheros o dos ramas); comparar versiones = diff XML como hace Camunda. (7) El log de simulación se emite plano con columnas case_id, activity_id, resource_id, event_type/lifecycle, timestamp, para poder convertirlo a XES/OCEL sin rehacer el motor.

Lo que puede esperar sin dolor porque todo lo anterior lo hace posible: la base de datos (cuando llegue, la tabla de versiones guarda el XML como blob keyed por (clave, versionTag) y las filas por elemento son un índice derivado, exactamente como Flowable/Camunda; no un segundo modelo canónico), el workflow de release con estados y fechas de validez (ADONIS), la reutilización tipo ARIS de un mismo elemento en varios diagramas, el editor de atributos custom por tipo de elemento (Signavio), categorías de catálogo más allá de las seis básicas, DMN/CMMN (enlazar por id cuando haga falta), el import/export BPSim 2.0 (adaptador sobre el scenario.json), XPDL (nunca), atributos multi-idioma, revisión/aprobación y minería (OCEL 2.0 vía pm4py). Por el contrario, las dos decisiones que sí forzarían reescritura si se toman mal ahora son (a) dejar que el motor o la UI usen nombres en lugar de ids como clave y (b) meter roles/sistemas/documentos como texto libre dentro del elemento en vez de referencias a un catálogo con ids.

Riesgos a comprobar en el spike de bpmn-js antes de cerrar el namespace: que `lila:` sobreviva un round-trip por Camunda Desktop Modeler, Signavio y ADONIS CE (bpmn-moddle lo hace en tests, pero otras herramientas pueden descartar extensiones ajenas), y que Bizagi conserve `bpmn:documentation`, lanes y performers al exportar a BPMN (sus extended attributes se pierden con seguridad). Si algún vendor descarta `lila:`, la salida barata es un `annotations.json` sidecar keyed por id, que el mismo descriptor puede leer y escribir; el modelo de dominio no cambia.

## Hallazgos

- **[verified]** ADONIS estructura el repositorio como tipos de modelo separados que se enlazan entre sí: Company Map, Business Process Model / Business Process Diagram (BPMN), Working Environment Model (unidades, performers, roles, recursos), Document Model, IT System Model, Risk Model, Control Model y Use Case Diagram. Las actividades del proceso referencian roles ('responsible for execution'), documentos y sistemas del resto de modelos; el repositorio permite consultar 'todas las actividades que usan el documento X o ejecuta el rol Y'.
  - _Evidencia_: Overview de ADONIS:CE (bpmsoftware.wordpress.com/adonis-community-edition-overview) lista los tipos de modelo y el enlace actividad→rol/documento/sistema; docs.boc-group.com/adonis/en/bpmn_guide describe 'BPMN fit for business' con referencias a roles, documentos, aplicaciones, riesgos, controles, KPIs y RACI; boc-group.com/en/adonis/features confirma 'link roles, systems, risks, and KPIs'.
- **[verified]** ADONIS versiona con un release workflow: estados Draft → Under Methodical Review → Under Business Review → Released → Valid/Invalid → Archived; el número de versión pasa de decimales (0.01, 0.02…) a entero (1.00) al liberar; los objetos contenidos (p. ej. Processes dentro de un Process Landscape) se liberan junto con el modelo y se pueden versionar por separado; 'Valid from' / 'Valid until' (por defecto 12 meses) con fecha de resubmisión.
  - _Evidencia_: docs.boc-group.com/adonis/en/docs/17.0/user_manual/rwf-000000/ (Release Workflows) y docs.boc-group.com/adonis/en/docs/14.0/news/ ('Versioned objects transition through the release process along with the models').
- **[verified]** ADONIS importa/exporta BPMN DI 2.0 (ficheros .bpmn/.xml o ZIP), con opción 'Export with subprocesses' y 'Allow recursion' para la jerarquía completa; la documentación pública no especifica si escribe sus atributos propios (roles, documentos, riesgos) como extensionElements ni bajo qué namespace.
  - _Evidencia_: docs.boc-group.com/adonis/en/docs/16.0/user_manual/bmpndi-00000/. La preservación de extensiones ajenas al reimportar no aparece documentada.
- **[likely]** ADONIS:Community Edition sigue existiendo en 2026 como SaaS gratuito con cuenta que se renueva cada 60 días de uso; no hay indicios de discontinuación.
  - _Evidencia_: adonis-community.com/en/faq-items/9567/ y noticias recientes en adonis-community.com (búsqueda 2026).
- **[verified]** SAP Signavio Process Manager separa 'diagrama' de 'dictionary' (glosario). El dictionary tiene categorías predefinidas (Organizational Units, Documents, Activities, Events, IT Systems) y categorías custom; las entradas son objetos reutilizables con id propio; los elementos del diagrama se enlazan a entradas mediante atributos de tipo 'Dictionary link' (con sugerencias filtradas por categoría).
  - _Evidencia_: help.sap.com/docs/signavio-process-manager/sap-signavio-process-manager-api/dictionary (endpoints /spm/v1/glossary y /spm/v1/glossarycategory, 'dictionary' = 'glossary' en la API; metaDataValues para atributos custom); help.sap.com/.../workspace-admin-guide/define-custom-attributes-for-raci (tipo 'Dictionary link', 'Only for the category Organizational Units'); Ardoq (help.ardoq.com/en/articles/174350) confirma categorías Departments/Activities/IT Systems/Roles.
- **[verified]** En Signavio, RACI no es un concepto nativo del metamodelo: se implementa con atributos custom sobre el tipo de elemento Task, con nombres EXACTOS 'responsible' / 'accountable' / 'consulted' / 'informed' (o sus variantes en DE/FR), tipo 'Dictionary link', 'As list', restringido a la categoría Organizational Units. Los documentos se enlazan con atributos custom de tipo 'Document/URL' (también 'As list').
  - _Evidencia_: help.sap.com/docs/signavio-process-manager/workspace-admin-guide/define-custom-attributes-for-raci y .../create-custom-attributes-to-link-documents (leídas en el navegador).
- **[verified]** Los atributos custom de Signavio se definen por notación + tipo de elemento o por categoría del dictionary; tipos: texto de una/varias líneas, fecha (formato fijo una vez elegido), Dictionary link, Document/URL, etc.; modificador 'As list'; opción 'Read-only (irreversible)'; el tipo de dato no puede cambiarse tras crear el atributo; un mismo atributo puede reutilizarse en varios elementos y conserva el mismo ID técnico, lo que permite que Collaboration Hub 'herede' valores de un diagrama enlazado.
  - _Evidencia_: help.sap.com/docs/signavio-process-manager/workspace-admin-guide/custom-attributes (leída en el navegador).
- **[verified]** Signavio exporta BPMN 2.0 con sus metadatos como <signavio:signavioMetaData metaKey="…" metaValue="…"/> dentro de extensionElements (namespace xmlns:signavio="http://www.signavio.com"), ids de elemento con formato 'sid-<uuid>' y atributos exporter="Signavio Process Editor, http://www.signavio.com" exporterVersion="7.0.0" en definitions. Ejemplos de metaKey vistos: bgcolor, userstory, risiko, riskandcontrols.
  - _Evidencia_: Fichero real handle-invoice.bpmn del repositorio bpmn-miwg/bpmn-miwg-demos (raw.githubusercontent.com/bpmn-miwg/bpmn-miwg-demos/.../handle-invoice.bpmn) y bpmn-miwg-test-suite/Reference/C.1.1.bpmn.
- **[verified]** Apromore ya no tiene código open source activo: las 9 repos de github.com/apromore están archivadas (ApromoreCore archivada el 29-ago-2025, LGPL-3.0, último push 07-jun-2025; ApromoreCE archivada 2022). Según su README, Core = Portal + editor + discovery; la Enterprise Edition (comercial) añade filtros de logs, dashboards, conformance, comparación de modelos, animación, SIMULACIÓN, ETL, conectores, compliance, predictive monitoring, AI Copilot y SSO. apromore.com se presenta hoy como 'Full Spectrum Process Intelligence Platform' con simulación y 'Build Digital Twins', sin mención de edición comunitaria.
  - _Evidencia_: github.com/apromore (todas archivadas), github.com/apromore/ApromoreCore (banner de archivado y README), api.github.com/repos/apromore/ApromoreCore (archived=true, LGPL-3.0), apromore.com. La afirmación de que Apromore es propiedad de Salesforce apareció en el resumen de la web pero no se verificó de forma independiente.
- **[verified]** Camunda Web Modeler (8.9): una 'version' es un snapshot manual de un fichero BPMN/DMN con nombre y descripción; se puede restaurar (crea nueva versión '(restored)') y comparar (diff visual y diff XML lado a lado). Una process application se versiona como bundle; desde 8.9 crear una versión del bundle YA NO escribe automáticamente versionTag en el XML (se edita a mano). Desde 8.7 'milestone' pasó a llamarse 'version'.
  - _Evidencia_: docs.camunda.io/docs/components/modeler/web-modeler/versions/ y docs.camunda.io/docs/components/modeler/web-modeler/process-applications/process-application-versioning/.
- **[verified]** Camunda 8.10 (Hub) cambia a versionado a nivel de fichero con autoguardado e historial propio por fichero, comparación entre dos versiones cualesquiera, jerarquía Organization → Workspace → Project y catálogo compartido; los antiguos 'projects' pasan a Workspaces y las process applications a Projects. Es decir, el líder del mercado ha convergido en 'versión = snapshot de un fichero'.
  - _Evidencia_: camunda.com/blog/2026/07/camunda-hub-is-coming-build-collaborate-and-scale-with-confidence/ (8.10 alpha 5).
- **[verified]** Camunda guarda el version tag del proceso como extensión: <bpmn:process><bpmn:extensionElements><zeebe:versionTag value="v1.0.0"/></bpmn:extensionElements> (Camunda 8.6; en Camunda 7 era el atributo camunda:versionTag). El Modeler anota la plataforma objetivo con un namespace propio: xmlns:modeler="http://camunda.org/schema/modeler/1.0", modeler:executionPlatform / modeler:executionPlatformVersion en bpmn:definitions (descriptor modeler-moddle, MIT).
  - _Evidencia_: unsupported.docs.camunda.io/8.6/docs/guides/migrating-from-camunda-7/technical-details/ (mapeo camunda:versionTag → zeebe:versionTag), github.com/camunda/modeler-moddle README.
- **[verified]** Camunda 7 Community Edition llegó a EOL con la 7.24 el 14-oct-2025 (repo archivado, sin más releases); la EE tiene soporte hasta abril 2030 (+extendido hasta 2032). CMMN solo existía en Camunda 7 (mantenimiento) y no está en Camunda 8.
  - _Evidencia_: forum.camunda.io/t/important-update-camunda-7-community-edition-end-of-life-announced/50921, docs.camunda.org/enterprise/announcement/, camunda.com/blog/2020/08/how-cmmn-never-lived-up-to-its-potential/.
- **[verified]** ARIS resuelve la reutilización con el par 'definición / ocurrencia': un objeto vive una sola vez en la base de datos y cada aparición en un diagrama es una occurrence copy; editar atributos en una ocurrencia cambia todas; una 'definition copy' crea un objeto independiente. Convención: los artefactos reutilizables (roles, sistemas, documentos) viven en una librería y se colocan como ocurrencias.
  - _Evidencia_: ariscommunity.com/users/ronakgupta/2016-02-25-definition-and-occurrence-copies, ariscommunity.com/users/yong-yeow-ching/2020-05-01-when-use-occurrence-copy-and-when-use-definition-copy-aris-model-design; ARIS 10 Method Manual abril 2026 (docs.aris.com/latest/yaa-method-guide/en/Method-Manual.pdf) existe pero no se abrió por tamaño.
- **[verified]** Bizagi Modeler: fichero propietario .bpm; los Recursos (tipo Role o Entity, con nombre/descripción) se definen a nivel de modelo y se asignan como Performers al pool o a cada actividad; RACI (R/A/C/I) se define por proceso y por actividad; 'Extended attributes' son el mecanismo de metadatos custom y se pueden exportar/importar como XML entre modelos. Genera documentación en Word, PDF, Excel, MediaWiki, Web y SharePoint, con opción 'Exclude unused resources' (recursos no usados en ningún rol RACI).
  - _Evidencia_: help.bizagi.com/platform/en/define_performers.htm, help.bizagi.com/platform/en/generating_documentation.htm, help.bizagi.com/platform/en/exporting_importing_attributes_between_models.htm.
- **[verified]** La exportación BPMN 2.0 de Bizagi NO incluye los extended attributes ('its extended attributes are not included in the generated package'); XPDL 2.2 conserva 'attributes, resources' pero tampoco extended attributes. Bizagi declara compatibilidad con BPMN 2.0 y XPDL 2.2; su página de estándares no menciona BPSim ni exportación de escenarios de simulación (bizagi.com marketing sí habla de 'BPSim', pero no se verificó que exporte BPSim).
  - _Evidencia_: help.bizagi.com/platform/en/exporting_to_bpmn.htm, help.bizagi.com/platform/en/xpdl_for_attributes.htm, help.bizagi.com/platform/en/intro_standards.htm.
- **[verified]** Bonita identifica un proceso por (nombre del pool, versión del pool); la versión del diagrama es independiente ('There is no link between the pool version number and the diagram version number'); pools y lanes llevan nombre + descripción. Bonita Studio es GPL-2.0 y sigue activo (push 30-jul-2026).
  - _Evidencia_: documentation.ofelia.com/bonita/latest/process/pools-and-lanes, api.github.com/repos/bonitasoft/bonita-studio.
- **[verified]** Flowable: el motor (flowable-engine) es Apache-2.0 y muy activo (push 02-sep-2026), pero las apps UI open source (modeler, admin, task) se eliminaron en la 7.0; Flowable Design es producto comercial (con edición cloud gratuita). En Design cada guardado crea una versión automáticamente (histórico de modelos, revert, comparación); en el motor la identidad estable es la 'definition key' y cada deployment incrementa 'version'; el App es la unidad de deployment con opción 'same deployment' para aislar versiones referenciadas.
  - _Evidencia_: documentation.flowable.com/latest/model/versioning-deployment, flowable.com/blog/releases/flowable-open-source-7-0-0-release, forum.flowable.org/t/license-questions/4505, api.github.com/repos/flowable/flowable-engine.
- **[verified]** Modelio es GPL-3.0 (runtime de módulos Apache), BPMN integrado en el core, última release 6.2.0 (26-ago-2024), repositorio con push el 26-ago-2026. Es un modelador UML/BPMN de escritorio (Eclipse RCP), no un repositorio de procesos con roles/riesgos/KPIs.
  - _Evidencia_: github.com/ModelioOpenSource/Modelio/releases, api.github.com/repos/ModelioOpenSource/Modelio, modelio.org/term-of-services-menu/52-licensing.html.
- **[verified]** Entidades comunes a todas las herramientas (núcleo del dominio): Process (con identidad/clave estable y versión), Version (snapshot), Element (nodo BPMN con id), Role/Performer (u organizational unit), System/Application, Document, Risk, Control, KPI, Responsibility (RACI por actividad y por proceso), Glossary/Catalog (dictionary en Signavio, repository objects en ADONIS, definiciones en ARIS, Resources en Bizagi). En todas, los objetos del catálogo tienen id propio y el elemento del diagrama los REFERENCIA; ninguna herramienta madura almacena roles/documentos como texto libre en el elemento.
  - _Evidencia_: Síntesis de los hallazgos anteriores (ADONIS, Signavio dictionary link, ARIS occurrence, Bizagi Resources a nivel de modelo).
- **[verified]** BPMN 2.0.2 (formal/13-12-09, enero 2014) define el mecanismo de extensión: en tBaseElement el atributo id es xsd:ID opcional (debe ser NCName: no puede empezar por dígito; único en el documento), <documentation textFormat="text/plain"> (0..n), <extensionElements> con xsd:any namespace="##other" processContents="lax", y xsd:anyAttribute namespace="##other" en todo elemento; en definitions existe <extension definition=QName mustUnderstand=false/>; existen tResourceRole/tPerformer/tHumanPerformer/tPotentialOwner (resourceRef) y tResource para asignar recursos de forma estándar. Herramientas modernas (bpmn-js) fallan al importar ids que no son NCName.
  - _Evidencia_: Semantic.xsd (raw.githubusercontent.com/bpmn-io/bpmn-moddle/main/resources/bpmn/xsd/Semantic.xsd), omg.org/spec/BPMN/2.0.2/About-BPMN, bpmn.io/blog/posts/2017-bpmn-js-0-24 y jboss thread sobre "'1' is not a valid value for 'NCName'".
- **[verified]** bpmn-js (9.6k estrellas, push 03-sep-2026) permite extensiones vía descriptores moddle JSON {name, uri, prefix, xml:{tagAlias:'lowerCase'}, types:[{name, extends|superClass:['Element'], properties:[{name, isAttr|isMany|isBody, type}]}]} pasados en moddleExtensions; los tests de bpmn-moddle demuestran round-trip de elementos de namespaces ajenos (<vendor:baz baz="BAZ"/>) y de 'extension attributes'. La licencia es tipo MIT PERO exige no quitar ni ocultar la marca de agua bpmn.io en los diagramas renderizados.
  - _Evidencia_: github.com/bpmn-io/bpmn-js-example-model-extension, raw.githubusercontent.com/bpmn-io/bpmn-moddle/main/test/spec/xml/roundtrip.js, raw.githubusercontent.com/bpmn-io/bpmn-js/main/LICENSE, api.github.com/repos/bpmn-io/bpmn-js.
- **[likely]** Históricamente bpmn-js ha tenido bugs de pérdida de declaraciones de namespace al re-exportar diagramas foráneos (issue #1310, cerrado) y la comunidad reconoce que la preservación de extensiones desconocidas es 'uno de los retos más difíciles' de un modelador desacoplado; por tanto la preservación de un namespace 'lila:' a través de Camunda/Signavio/ADONIS debe probarse empíricamente, no asumirse.
  - _Evidencia_: github.com/bpmn-io/bpmn-js/issues/1310, jointjs.com/blog/bpmn-modeling-vs-execution.
- **[verified]** BPSim 2.0 (WfMC, doc WFMC-BPSWG-2016-1, 21-dic-2016; XSD en bpsim.org/schemas/2.0/BPSim-2.0.xsd con targetNamespace http://www.bpsim.org/schemas/2.0) es exactamente un 'sidecar' estandarizado: BPSimData → Scenario(id, name, description, created, modified, author, vendor, version, inherits, result) → ScenarioParameters(start, duration, warmup, replication, seed, baseTimeUnit=min, baseCurrencyUnit=USD, traceOutput, traceFormat=XES) + ElementParameters(elementRef=id BPMN) con TimeParameters (transferTime, queueTime, waitTime, setupTime, processingTime, validationTime, reworkTime; lagTime/duration/elapsedTime solo como resultados), ControlParameters (interTriggerTimer, triggerCount, probability, condition), ResourceParameters (availability, quantity, selection, role), CostParameters (fixedCost, unitCost), PriorityParameters (interruptible, priority), PropertyParameters (queueLength como resultado); calendarios iCalendar (RFC 5545) referenciados por 'validFor'; 13 distribuciones (Beta, Binomial, Erlang, Gamma, LogNormal, NegativeExponential, Normal, Poisson, Triangular, TruncatedNormal, Uniform, User, Weibull); ResultRequest MIN/MAX/MEAN/COUNT/SUM; escenarios que heredan de otros ('inherits') = what-if.
  - _Evidencia_: PDF de la especificación convertido con markitdown (bpsim.org/specifications/2.0/WFMC-BPSWG-2016-01.pdf) y el XSD bpsim.org/schemas/2.0/BPSim-2.0.xsd.
- **[verified]** BPSim se embebe en BPMN como <bpmn:relationship type="BPSimData"><bpmn:extensionElements><bpsim:BPSimData>…</bpsim:BPSimData></bpmn:extensionElements></bpmn:relationship> dentro de bpmn:definitions (ejemplo real de jBPM con xmlns:bpsim="http://www.bpsim.org/schemas/1.0" y elementRef apuntando al id del task). Sparx Enterprise Architect y jBPM lo implementan; no existe descriptor moddle 'bpsim' publicado en npm para bpmn-js. WfMC se disolvió en 2019 (Wikipedia) aunque bpsim.org y wfmc.org siguen en línea (pie '1993-2026'); BPSim está congelado en 2.0.
  - _Evidencia_: developer.jboss.org/thread/265741 (fragmento XML), sparxsystems.com/enterprise_architect_user_guide/17.1/model_simulation/bpsim_introduction.html, bpsim.org, en.wikipedia.org/wiki/Workflow_Management_Coalition, wfmc.org/xpdl/, búsqueda npm 'bpsim moddle' sin resultados.
- **[verified]** XPDL 2.2 (2012) es la última revisión; su organismo (WfMC) se disolvió en 2019; sigue usándose como formato de intercambio de Bizagi pero está muerto como estándar en evolución. No aporta nada que BPMN 2.0 + extensiones no cubran.
  - _Evidencia_: en.wikipedia.org/wiki/XPDL, en.wikipedia.org/wiki/Workflow_Management_Coalition, wfmc.org/xpdl/, help.bizagi.com/platform/en/intro_standards.htm.
- **[verified]** CMMN 1.1 (OMG, dic-2016) sigue soportado y desarrollado por Flowable (nuevas features CMMN en 2025.2) pero abandonado por Camunda (no existe en Camunda 8). Para Lila es opcional y de baja prioridad.
  - _Evidencia_: omg.org/spec/CMMN/1.1/About-CMMN/, documentation.flowable.com/latest/admin/release-notes/2025.2.01-release, forum.camunda.io/t/cmmn-via-bpmn/43278.
- **[likely]** DMN: la página oficial de OMG lista DMN 1.5 como versión formal (adoptada ago-2024), DMN 1.6 solo como Beta1 (sept-2024, dtc/24-05-18) y DMN 1.7 beta (sept-2024); el repositorio del DMN task force marca 1.6 como Beta1 (feb-2024) y 1.5 como formal (mar-2023). Un resultado de búsqueda afirmaba '1.6 formal junio 2025' pero no se pudo confirmar en omg.org.
  - _Evidencia_: omg.org/spec/DMN, omg.org/spec/DMN/1.6/Beta1/About-DMN, github.com/omg-dmn-taskforce/omg-dmn-spec/releases.
- **[verified]** XES es IEEE 1849-2016, revisado como IEEE 1849-2023 (aprobado 5-jun-2023; añade extensiones Micro, Software Event/Communication/Telemetry, Artifact Lifecycle). Estructura log/trace/event con extensiones concept:name, time:timestamp, org:resource, lifecycle:transition. BPSim 2.0 usa XES como formato de traza por defecto.
  - _Evidencia_: en.wikipedia.org/wiki/IEEE_1849, ieeexplore.ieee.org/document/10267858/, xes-standard.org (503 al momento de consultar), spec BPSim 2.0 (traceFormat=XES).
- **[verified]** OCEL 2.0 (RWTH PADS, arXiv 2403.01975, marzo 2024; ocel-standard.org) define eventos, objetos, tipos, relaciones evento-objeto y objeto-objeto con 'qualifiers' y cambios de atributos en el tiempo; tres formatos de intercambio: SQLite (tablas densas por tipo), XML (con XSD) y JSON. pm4py lo importa/exporta (read_ocel_json/xml, write_ocel). Es el formato natural para minería futura; para el MVP basta emitir un log plano (case_id, activity, resource, start/end timestamp) convertible a XES u OCEL.
  - _Evidencia_: arxiv.org/abs/2403.01975, ocel-standard.org, processintelligence.solutions/pm4py/api/api/pm4py.read.html.
- **[verified]** Precedentes de 'sidecar' de simulación que referencian ids BPMN: (1) Prosimos (Python, PyPI 2.0.6 sept-2024, repo con push 16-jun-2026, licencia no declarada en GitHub) usa un JSON con secciones resource_profiles, arrival_time_distribution, arrival_time_calendar, gateway_branching_probabilities (gateway_id → path_id → prob), task_resource_distribution (task_id → recurso → distribución scipy en segundos), resource_calendars, batch_processing, case_attributes, prioritisation_rules; (2) Scylla (Java, MIT, push 08-abr-2025) usa una global configuration XML (recursos, timetables) + una simulation configuration XML por diagrama; (3) QBP/BIMP (linaje Apromore) embebe qbp:processSimulationInfo en el BPMN con namespace http://www.qbp-simulator.com/Schema201212 (processId, processInstances, startDateTime, currency).
  - _Evidencia_: github.com/AutomatedProcessImprovement/Prosimos, pypi.org/project/prosimos/, api.github.com/repos/AutomatedProcessImprovement/Prosimos, github.com/bptlab/scylla (+wiki), api.github.com/repos/bptlab/scylla, qbpsimulator.github.io/qbp-simulator-engine/schemadoc/.../processSimulationInfo.html.
- **[verified]** Patrones de identidad observados: (a) el id del elemento BPMN es la única clave estable que todas las herramientas comparten (Signavio 'sid-<uuid>', bpmn-js 'Activity_xxxxxxx', jBPM '_<uuid>'); BPSim, Prosimos, Scylla y Signavio metadata cuelgan todo de ese id; (b) la identidad del PROCESO es una clave lógica + versión (Flowable definition key + version, Bonita pool name + version, Camunda process id + versionTag), nunca el nombre; (c) el catálogo (roles, sistemas, documentos, riesgos, controles, KPIs) tiene ids propios y se versiona aparte del diagrama (ADONIS los versiona junto con el modelo en el release; Signavio no versiona el dictionary con el diagrama).
  - _Evidencia_: Síntesis de handle-invoice.bpmn (Signavio), developer.jboss.org/thread/265741, documentation.flowable.com/latest/model/versioning-deployment, documentation.ofelia.com/bonita/latest/process/pools-and-lanes, docs ADONIS rwf-000000, Signavio dictionary API.
- **[verified]** El corpus previo (ARCHITECTURE.md) propone desde el inicio 'Internal model ≠ BPMN XML' con entidades Activity/Role/System/… en PostgreSQL y bpmn_element_id como referencia. Las herramientas analizadas muestran que eso es el estado final correcto (ADONIS/ARIS/Signavio), pero también que Camunda —el modelador web más moderno— trata el fichero como unidad de versión y deriva lo demás; para un MVP de simulación el fichero .bpmn + sidecars es suficiente y compatible con ese destino.
  - _Evidencia_: /Users/brito/development/Lila Modeler/open-process-platform-docs/ARCHITECTURE.md y DECISIONS.md (ADR-001, ADR-007) frente a los hallazgos de Camunda Hub 8.10 y BPSim.

## Preguntas abiertas

- ¿Camunda Desktop Modeler, Signavio y ADONIS CE preservan un namespace desconocido 'lila:' dentro de extensionElements al reexportar? Solo bpmn-moddle lo demuestra en tests; hay que hacer el round-trip real en el spike.
- ¿Qué conserva exactamente Bizagi al exportar BPMN 2.0 (bpmn:documentation, lanes, performers/RACI, extensiones)? La ayuda solo confirma que se pierden los extended attributes; conviene exportar un .bpm real y mirar el XML.
- ¿Bizagi puede importar o exportar BPSim? Su marketing lo menciona, la documentación de estándares solo lista BPMN 2.0 y XPDL 2.2.
- ¿Documentación y RACI dentro del .bpmn (lila: extension) o en un annotations.json sidecar keyed por id? La recomendación es dentro del fichero, pero depende de la prueba de round-trip anterior.
- ¿Usar los elementos estándar bpmn:performer / bpmn:potentialOwner (resourceRef) para la 'R' de RACI, dejando A/C/I en lila:? Ganaría interoperabilidad con motores, a cambio de dos mecanismos para un mismo concepto.
- Estado formal de DMN 1.6: omg.org lo lista como Beta1 (sept-2024) y a 1.5 como formal; una fuente secundaria afirmaba 'formal junio 2025'. Irrelevante para el MVP pero conviene confirmar antes de citarlo.
- Licencia de Prosimos: PyPI y la API de GitHub no declaran licencia; si se quiere reutilizar su formato JSON o código, hay que preguntarlo o comprobar el repo a mano.
- Reglas de la clave de proceso (slug) con nombres en español (acentos, ñ) y política de ids al copiar elementos entre procesos o al dividir un proceso en subprocesos/call activities en ficheros separados (ADONIS exporta la jerarquía con 'Allow recursion').
- ¿El catálogo (roles, sistemas, documentos, riesgos, controles, KPIs) se versiona con cada proceso (modelo ADONIS: objetos liberados junto con el modelo) o es global y no versionado (modelo Signavio dictionary)? Para el MVP basta un catalog.json global en git; la decisión afecta al esquema de la futura base de datos.
- Si Apromore es hoy propiedad de Salesforce: apareció en el resumen de apromore.com pero no se verificó de forma independiente.

## Fuentes

- https://docs.boc-group.com/adonis/en/docs/17.0/user_manual/rwf-000000/
- https://docs.boc-group.com/adonis/en/docs/14.0/news/
- https://docs.boc-group.com/adonis/en/docs/16.0/user_manual/bmpndi-00000/
- https://docs.boc-group.com/adonis/en/bpmn_guide/
- https://www.boc-group.com/en/adonis/features/
- https://bpmsoftware.wordpress.com/adonis-community-edition-overview/
- https://www.adonis-community.com/en/faq-items/9567/
- https://help.sap.com/docs/signavio-process-manager/workspace-admin-guide/custom-attributes
- https://help.sap.com/docs/signavio-process-manager/workspace-admin-guide/define-custom-attributes-for-raci
- https://help.sap.com/docs/signavio-process-manager/workspace-admin-guide/create-custom-attributes-to-link-documents
- https://help.sap.com/docs/signavio-process-manager/sap-signavio-process-manager-api/dictionary
- https://help.ardoq.com/en/articles/174350-sap-signavio-import-integration
- https://raw.githubusercontent.com/bpmn-miwg/bpmn-miwg-demos/09cc16c62965e54c19306576fba702e7fe5085f1/2015-06-15-19-omg-technical-meeting-berlin/execution-demo/handle-invoice.bpmn
- https://github.com/apromore
- https://github.com/apromore/ApromoreCore
- https://api.github.com/repos/apromore/ApromoreCore
- https://apromore.com/
- https://docs.camunda.io/docs/components/modeler/web-modeler/versions/
- https://docs.camunda.io/docs/components/modeler/web-modeler/process-applications/process-application-versioning/
- https://camunda.com/blog/2026/07/camunda-hub-is-coming-build-collaborate-and-scale-with-confidence/
- https://unsupported.docs.camunda.io/8.6/docs/guides/migrating-from-camunda-7/technical-details/
- https://github.com/camunda/modeler-moddle/blob/main/README.md
- https://forum.camunda.io/t/important-update-camunda-7-community-edition-end-of-life-announced/50921
- https://docs.camunda.org/enterprise/announcement/
- https://camunda.com/blog/2020/08/how-cmmn-never-lived-up-to-its-potential/
- https://ariscommunity.com/users/ronakgupta/2016-02-25-definition-and-occurrence-copies
- https://ariscommunity.com/users/yong-yeow-ching/2020-05-01-when-use-occurrence-copy-and-when-use-definition-copy-aris-model-design
- https://docs.aris.com/latest/yaa-method-guide/en/Method-Manual.pdf
- https://help.bizagi.com/platform/en/define_performers.htm
- https://help.bizagi.com/platform/en/generating_documentation.htm
- https://help.bizagi.com/platform/en/exporting_to_bpmn.htm
- https://help.bizagi.com/platform/en/xpdl_for_attributes.htm
- https://help.bizagi.com/platform/en/intro_standards.htm
- https://help.bizagi.com/platform/en/exporting_importing_attributes_between_models.htm
- https://documentation.ofelia.com/bonita/latest/process/pools-and-lanes
- https://api.github.com/repos/bonitasoft/bonita-studio
- https://documentation.flowable.com/latest/model/versioning-deployment
- https://www.flowable.com/blog/releases/flowable-open-source-7-0-0-release
- https://forum.flowable.org/t/license-questions/4505
- https://api.github.com/repos/flowable/flowable-engine
- https://documentation.flowable.com/latest/admin/release-notes/2025.2.01-release
- https://github.com/ModelioOpenSource/Modelio/releases
- https://api.github.com/repos/ModelioOpenSource/Modelio
- https://www.modelio.org/term-of-services-menu/52-licensing.html
- https://raw.githubusercontent.com/bpmn-io/bpmn-moddle/main/resources/bpmn/xsd/Semantic.xsd
- https://www.omg.org/spec/BPMN/2.0.2/About-BPMN
- https://bpmn.io/blog/posts/2017-bpmn-js-0-24
- https://github.com/bpmn-io/bpmn-js-example-model-extension
- https://raw.githubusercontent.com/bpmn-io/bpmn-moddle/main/test/spec/xml/roundtrip.js
- https://raw.githubusercontent.com/bpmn-io/bpmn-js/main/LICENSE
- https://api.github.com/repos/bpmn-io/bpmn-js
- https://github.com/bpmn-io/bpmn-js/issues/1310
- https://www.jointjs.com/blog/bpmn-modeling-vs-execution
- https://www.bpsim.org/
- https://www.bpsim.org/specifications/2.0/WFMC-BPSWG-2016-01.pdf
- https://www.bpsim.org/schemas/2.0/BPSim-2.0.xsd
- https://developer.jboss.org/thread/265741
- https://sparxsystems.com/enterprise_architect_user_guide/17.1/model_simulation/bpsim_introduction.html
- https://en.wikipedia.org/wiki/Workflow_Management_Coalition
- https://en.wikipedia.org/wiki/XPDL
- https://wfmc.org/xpdl/
- https://www.omg.org/spec/CMMN/1.1/About-CMMN/
- https://www.omg.org/spec/DMN
- https://www.omg.org/spec/DMN/1.6/Beta1/About-DMN
- https://github.com/omg-dmn-taskforce/omg-dmn-spec/releases
- https://en.wikipedia.org/wiki/IEEE_1849
- https://ieeexplore.ieee.org/document/10267858/
- https://arxiv.org/abs/2403.01975
- https://www.ocel-standard.org/
- https://processintelligence.solutions/pm4py/api/api/pm4py.read.html
- https://github.com/AutomatedProcessImprovement/Prosimos
- https://pypi.org/project/prosimos/
- https://api.github.com/repos/AutomatedProcessImprovement/Prosimos
- https://github.com/bptlab/scylla
- https://github.com/bptlab/scylla/wiki
- https://api.github.com/repos/bptlab/scylla
- https://qbpsimulator.github.io/qbp-simulator-engine/schemadoc/http___www.qbp-simulator.com_Schema201212/element/processSimulationInfo.html
- file:///Users/brito/development/Lila%20Modeler/open-process-platform-docs/ARCHITECTURE.md
- file:///Users/brito/development/Lila%20Modeler/open-process-platform-docs/DECISIONS.md
- file:///Users/brito/development/Lila%20Modeler/open-process-platform-docs/SIMULATION_ENGINE.md
