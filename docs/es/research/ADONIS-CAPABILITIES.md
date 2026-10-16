# Investigación de capacidades públicas de ADONIS para la hoja de ruta de Lila Modeler

> Leer en: [English](../../research/ADONIS-CAPABILITIES.md).

Revisado el 2026-09-26; citas actualizadas el 2026-10-15 con el manual de usuario de la **Biblioteca de Aplicación BPMS de ADONIS 19.1**. Este es un estudio documental de material público de BOC Group. No es una auditoría de una instalación con licencia, una prueba de compatibilidad ni una exportación completa del metamodelo del proveedor, y **nada de lo que contiene se observó en uso** en un ADONIS real. Los enlaces apuntan a páginas 19.1 cuando la revisión del 2026-10-15 leyó esa página; los demás siguen apuntando a las páginas 17.1 (o 17.0) revisadas al principio, porque su equivalente 19.1 no se comprobó (ver *Versión de cada cita* más abajo). La [página de novedades 19.0](https://www.boc-group.com/en/adonis/whats-new/) enumera más material específico de versiones; no debe combinarse información de distintas versiones para afirmar que una edición concreta tiene todas esas funciones. La [hoja de ruta de Lila](../ROADMAP.md) ya cubre la mayoría de las familias generales que se describen aquí. Esta nota aporta evidencia más precisa y preguntas para pruebas de aceptación, sin cambiar los compromisos de la hoja de ruta.

## Reglas de evidencia y disponibilidad

- **Comportamiento documentado para usuarios** significa que una página del manual de usuario (19.1, o 17.1 cuando el enlace lo indica) describe la función en la Biblioteca BPMS. La biblioteca instalada, la configuración, el rol del sistema, la licencia y la edición pueden cambiar su disponibilidad. [Método y metamodelo](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/amm-000000/), [tipos de modelo](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mty-000000/).
- **Administración/configuración** significa que el manual de administración describe un ajuste o personalización; no establece que todos los clientes puedan usarlo. La [página administrativa de propiedades](https://docs.boc-group.com/adonis/en/docs/17.1/admin_page/attrmm-000000/) dice expresamente que depende de la licencia. La [administración de permisos](https://docs.boc-group.com/adonis/en/docs/17.1/admin_page/rightswc-000000/) separa permisos de contenido de derechos de rol del sistema para módulos, metamodelo, liberación y validación.
- **Enterprise/limitación de licencia** se usa únicamente cuando el manual lo indica. El [manual de flujos de liberación 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/rwf-000000/) limita expresamente los flujos de modelos y documentos a Enterprise y a la licencia correspondiente. La [página actual del producto](https://www.boc-group.com/en/adonis/) comercializa Community, Starter, Grow e Individual, mientras que la [comparación de ediciones](https://www.boc-group.com/en/adonis/comparison-of-editions/) usa Community, Starter y Enterprise. Los nombres y paquetes deben conciliarse con una cotización o instancia real. La extracción HTML de la tabla comparativa pierde algunas marcas visuales y la alineación de columnas. La mera presencia de una fila **no prueba** su inclusión en una edición concreta. La comparación sí enuncia por escrito los límites de Community (gratuita): 256 modelos, 2.000 objetos, documentos PDF de 1 MB, validación de sintaxis BPMN, un idioma, un solo usuario e informes PDF estándar; Starter y Enterprise no tienen esos límites. Los flujos de liberación y Control & Release son solo Enterprise ([flujo de liberación](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/rwf-000000/), [escenario de gobierno](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/sta-300000/)). No se pudo determinar a qué edición pertenecen las demás funciones.
- **Versión de cada cita.** Comprobadas en 19.1 el 2026-10-15: tipos de modelo, modelado gráfico, Explorador, análisis de uso, propiedades, gestión de documentos, editor tabular, vista textual, Insights, gráficos, búsqueda, Modelador de Dependencias y flujo de liberación, además de las páginas citadas por primera vez en el mapa de capacidades de más abajo. Algunos detalles de esos párrafos vienen de la lectura de 17.1 y no se reconfirmaron uno por uno en 19.1 (por ejemplo, el pegado de lo posible y las celdas grises del editor tabular, que Insights oculte las secciones vacías, la lista de plantillas de gráficos, Insights de Unidad); trátense como observaciones de 17.1. Siguen en 17.1, sin comprobar en 19.1: método y metamodelo, páginas de administración (propiedades, permisos, concepto de uso), importación/exportación de objetos, BPMN DI, comparación de modelos, validación, simulación y novedades 17.1. Sigue en 17.0: el escenario Design & Document.
- **Complemento/integración** significa que el proveedor identifica un módulo separado o un producto conectado. La [página de funciones](https://www.boc-group.com/en/adonis/features/) presenta simulación, minería, automatización e informes avanzados como extensiones; [Process Mining Essentials](https://www.boc-group.com/en/marketplace/bpm/adonis-process-mining-essentials/) se denomina explícitamente extensión de producto y requiere ADONIS 17.0 o posterior. Las ofertas del [Marketplace](https://knowledge.boc-group.com/en/marketplace/adonis/) no son prueba de una función instalada.

## 1. Vocabulario de modelos y objetos

La [guía de tipos de modelo 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mty-000000/) enumera explícitamente Modelo de Producto; Paisaje de Procesos; Diagramas de Proceso de Negocio, Conversación y Coreografía; Modelo de Entorno de Trabajo; Modelo de Sistema TI, Diagrama de Casos de Uso, Modelo de Documentos y Modelo de Datos; Conjuntos de Controles, Riesgos y Objetivos de Control; y Modelo Interdominio. Los modelos de producto, entorno de trabajo, TI y documentos pueden tener modelos subordinados. Los paisajes permiten navegar jerarquías de procesos. Los modelos interdominio admiten todos los tipos de objetos y relaciones y pueden guardar análisis de dependencias. **Alcance:** documentación de la Biblioteca BPMS; no demuestra que todos los clientes o ediciones muestren cada tipo. **Lila:** mantener un registro incremental y contratos separados por modelo, como proponen las fases 3–6; no tratar todas estas familias como elementos BPMN.

La misma fuente menciona objetos específicos según el contexto: productos/componentes, procesos, estructura organizativa, sistemas/aplicaciones/infraestructura, documentos, entidades/propiedades, riesgos, controles y objetivos de control. Los [temas de búsqueda](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/searc-000000/) muestran además ejecutantes, usuarios, unidades, roles, servicios, interfaces, operaciones, atributos, entidades, iniciativas e indicadores de desempeño. Son ejemplos, **no una lista canónica completa de tipos, atributos y relaciones**. Una lista extraída de la página de búsqueda puede variar según biblioteca y versión. **Lila:** usarlos para descubrir posibles casos de prueba, y aprobar tipos y relaciones exactos en contratos propios. No copiar nombres internos del proveedor ni inventar un esquema completo de ADONIS.

La [guía de modelado gráfico 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/objgra-00000/) distingue objetos de modelado locales al modelo de objetos reutilizables del repositorio. Describe restricciones de extremos de conectores y creación de relaciones desde el Explorador o mediante anidamiento; el comportamiento depende de la biblioteca. **Lila:** separar definición y aparición, definir extremos y cardinalidad permitidos, y preservar referencias al mover modelos. **Sin verificar:** matriz completa de extremos e identificadores de serialización.

## 2. Repositorio, reutilización y relaciones

El [manual del Explorador](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mamoo-00000/) documenta catálogos separados de modelos y objetos, grupos jerárquicos, elementos recientes/favoritos, búsqueda/filtro por tipo, objetos reutilizables entre modelos y relaciones entre objetos o entre objetos y modelos. También documenta reemplazo/fusión y advertencias al borrar objetos usados o referenciados; una opción de anulación permite borrarlos. El [Análisis de Uso](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/usa-000000/) muestra referencias entrantes/salientes, válidas/rotas y los modelos que usan un objeto de repositorio. **Lila:** el índice inverso de la fase 1 debe permitir renombrado, búsqueda de uso, inspección de referencias colgantes y una política deliberada para borrar/reemplazar. Mostrar las consecuencias del borrado; no asumir que la anulación de ADONIS sea deseable. **Sin verificar:** semántica exacta de identidad/versionado y conflictos; requieren una instancia y archivos de prueba exportados.

El [manual de propiedades 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/adinf-00000/) describe atributos y relaciones de modelos/objetos como propiedades editables. [Propiedades en Administración](https://docs.boc-group.com/adonis/en/docs/17.1/admin_page/attrmm-000000/) las ordena en capítulos y grupos y expone nombres independientes del idioma, tipos y controles de obligatoriedad, solo lectura y valor predeterminado; se pueden localizar etiquetas de relaciones. **Alcance:** la edición administrativa depende de la licencia y algunas relaciones pueden estar bloqueadas por personalizadores del producto. **Lila:** los formularios tipados y selectores de relaciones pueden derivarse del registro propio de Lila; un esquema preliminar debe preservar IDs estables, etiquetas locales y metadatos de validación. **Sin verificar:** en la revisión de 17.1 no se encontró una exportación pública completa de la biblioteca predeterminada, y en 19.1 no se buscó.

El [manual de gestión de documentos](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/condms-00000/) indica que los archivos cargados se convierten en objetos Documento con una propiedad de archivo referenciado, pueden usarse en modelos y se incluyen en copias del repositorio y migraciones. Los tipos permitidos y el tamaño máximo son configurables (el manual indica hasta 50 MB); puede haber variantes de archivo por idioma. La [búsqueda](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/searc-000000/) describe búsqueda en el contenido de documentos. **Lila:** el contrato de adjuntos de fase 2 debe fijar bytes, política de tipos/MIME, tamaño, integridad e idas y vueltas; los recursos multilingües pueden ser una decisión posterior. **Sin verificar:** API de almacenamiento, deduplicación y formato exacto de respaldo.

El [manual de importación/exportación de objetos](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/impexpobj-00000/) documenta importación/actualización configurable desde Excel mediante XML y configuraciones de ejemplo de la Biblioteca BPMS, además de sincronización de objetos con ADOIT. La [guía de BPMN DI](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/bmpndi-00000/) describe importación BPMN/XML o ZIP y exportación opcional de subprocesos incrustados y actividades de llamada referenciados. **Lila:** tratar la importación de catálogos y el intercambio BPMN como contratos distintos con informes de pérdidas. **Sin verificar:** ida y vuelta semántica de relaciones personalizadas, extensiones de Lila y del proveedor; probar archivos reales antes de afirmar paridad.

## 3. Superficies de edición y lectura

El [editor tabular 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/tab-000000/) muestra objetos en filas y atributos/relaciones en columnas, tanto para un modelo como para objetos de catálogo seleccionados. Permite editar celdas, seleccionar varias, copiar/pegar dentro y entre tablas o con Excel, elegir columnas, ordenar, agregar objetos existentes o nuevos y exportar XLSX. Las celdas inaplicables aparecen en gris. El manual indica que el pegado múltiple aplica lo posible e ignora las celdas incompatibles. **Lila:** la edición masiva atómica y su deshacer en la hoja de ruta son una elección de calidad de Lila, no paridad observada con ADONIS; mostrar errores por celda. **Sin verificar:** transacciones, deshacer y edición concurrente en ADONIS.

La [vista textual 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/tex-000000/) ordena pasos, descripciones, responsabilidades y recursos del proceso, enlaza al siguiente objeto o a referencias, permite controlar columnas/detalles y exportar XLSX. La Biblioteca BPMS estándar la activa para Diagramas de Proceso de Negocio; otros tipos dependen de configuración. **Lila:** considerar una vista legible de instrucciones de trabajo, distinta de tabla editable y diagrama, con navegación y procedencia. Aún no es una fila explícita de la hoja de ruta. **Sin verificar:** si muestra todas las rutas BPMN o elementos de notación no compatibles.

El [manual de Insights 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/) separa paneles de lectura/análisis de propiedades editables. La Biblioteca BPMS los activa para Diagramas de Proceso de Negocio y tipos de objetos de repositorio, con red de relaciones, uso, riesgos/controles, objetivos de control, cronología y paneles específicos. Los paneles de proceso incluyen jerarquía, SIPOC, RACI, documentos, aplicaciones/recursos, madurez, riesgos, indicadores e iniciativas. Las secciones sin datos se ocultan por defecto; los paneles permiten filtrar/exportar y navegar al artefacto fuente. **Lila:** implementar consultas tipadas con enlace a la fuente y distinguir ausencia de cero. **Alcance:** las tarjetas dependen de biblioteca/versión; variantes y grafo de seguimiento directo procedentes de minería requieren Process Mining Essentials y un proyecto vinculado. **Sin verificar:** cálculos exactos de madurez y riesgo del proveedor, permisos en cada navegación y tarjetas de otras versiones.

El [manual de gráficos 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/modwv-00000/) documenta conjuntos de análisis reutilizables con gráficos de barras, cajas anidadas, burbujas, Gantt y matrices. Una matriz puede representar relaciones directas u objetos intermedios; plantillas especiales de BPMS incluyen RACI, OMRA, valor en riesgo, progreso de iniciativas y madurez de objetivos de control, según configuración. Los gráficos pueden guardarse/compartirse y exportarse. **Lila:** la fase 5 podría introducir conjuntos guardados y rutas de relaciones como concepto del producto; RACI sería una configuración sobre esa base. **Sin verificar:** disponibilidad de plantillas y edición en cada edición actual.

La [guía de búsqueda/análisis 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/searc-000000/) describe búsqueda de modelos, objetos y contenido de documentos, filtros por tema/tipo/propiedad, criterios AND/OR y análisis sin texto de búsqueda. El [Análisis de Uso](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/usa-000000/) y el [Modelador de Dependencias](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/dep-000000/) complementan la navegación del grafo. Este último crea una vista de dependencias con carriles a partir de relaciones entrantes/salientes, con plantillas definidas por administración. **Lila:** considerar consultas guardadas, rutas explícitas de relaciones y filtros de referencias faltantes junto a la búsqueda del Explorador. **Sin verificar:** latencia/rendimiento de índices y filtros de acceso de cada instancia.

## 4. Responsabilidades, riesgo, indicadores y gobierno

La [página de Insights de proceso 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/) confirma una tabla RACI de roles y acceso a una matriz. Insights de Rol sigue Tarea → relación RACI → Rol y muestra responsabilidades de proceso/modelo; Insights de Unidad Organizativa agrega roles y procesos asignados. La [página administrativa Concept of Use](https://docs.boc-group.com/adonis/en/docs/17.1/admin_page/conwc-000000/) diferencia los **objetos Rol de negocio** de los **roles del sistema** que conceden permisos. **Lila:** preservar esa separación; RACI no debe implicar acceso a la aplicación ni capacidad de simulación. **Sin verificar:** cardinalidad y reglas de validación RACI completas.

La [guía de tipos de modelo 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mty-000000/) documenta conjuntos de Riesgos, Controles y Objetivos de Control. [Insights](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/) vincula riesgos relevantes con controles mitigadores y muestra probabilidad, impacto, detección, valor en riesgo, responsable y controles requeridos; también informa madurez actual/objetivo de relaciones con objetivos de control. Los [gráficos](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/modwv-00000/) permiten evaluar riesgos en burbujas y matrices. **Lila:** la fase 4 necesita IDs de catálogo, escala y procedencia de puntuación, cobertura de controles e historial de evaluaciones. Un control vinculado no demuestra eficacia. **Sin verificar:** fórmulas exactas de ADONIS, semántica de riesgo inherente/residual y si GRC avanzado requiere un módulo o integración con ADOGRC en una edición dada. La [página de ediciones](https://www.boc-group.com/en/adonis/comparison-of-editions/) menciona módulos GRC, pero las marcas extraídas no permiten asignarlos por edición.

Los [paneles de proceso Insights 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/) muestran estado, valores actual/objetivo, unidad y periodicidad de Indicadores de Desempeño, así como estado/progreso/responsable de iniciativas y atributos de madurez del proceso. El [escenario Design & Document 17.0](https://docs.boc-group.com/adonis/en/docs/17.0/user_manual/sta-100000/) describe comparación con objetivos y filtros KPI por responsable/proceso. **Lila:** la fase 5 debe añadir fecha observada, tipo de medición y fuente, datos no visibles en estos resúmenes. **Sin verificar:** esquema completo de mediciones, series históricas, ingestión automática y disponibilidad por edición.

El [flujo de liberación 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/rwf-000000/) documenta borradores de modelos, revisiones metodológica y de negocio, liberación, archivado del predecesor, historial de versiones, comentarios de cambio y vigencia/prórroga opcional. El flujo predeterminado cubre Diagramas de Proceso de Negocio, Paisajes de Procesos y objetos Proceso; los documentos tienen flujo separado. Depende explícitamente de Enterprise/licencia y es personalizable. La [comparación de modelos](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/compa-000000/) destaca cambios de modelos, objetos, conectores y propiedades, y compara una versión con su predecesora. La [validación](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/val-000000/) comprueba reglas de modelado. **Lila:** la fase 7 necesita contratos independientes para identidad de versión, publicaciones inmutables, autorización de aprobación, vigencia y comparación semántica. El comportamiento de archivado/referencias del proveedor es un caso de prueba, no una elección automática para Lila. **Sin verificar:** inmutabilidad exacta de auditoría y flujos propios de cada instancia.

La [administración de permisos](https://docs.boc-group.com/adonis/en/docs/17.1/admin_page/rightswc-000000/) describe permisos de usuario/grupo sobre contenido y derechos de roles del sistema sobre funciones y elementos del metamodelo. **Lila:** un servidor futuro debe exigir autorización de escritura en el servidor y auditar transiciones; metadatos locales del propietario no bastan. **Sin verificar:** herencia exacta de permisos del proveedor y casos de autorización de API.

## 5. Módulos, integración y señales de versiones nuevas

El [manual de simulación 17.1](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/sim-000000/) documenta análisis de tiempo de ciclo, costo y recursos; la [página actual de funciones](https://www.boc-group.com/en/adonis/features/) presenta simulación como extensión y la [oferta de optimización](https://www.boc-group.com/en/adonis/solution/process-optimization/) la llama módulo adicional. Un capítulo del manual no equivale a disponibilidad base. **Lila:** conservar contratos de simulación existentes y comparar entradas/salidas explícitas, no etiquetas comerciales. **Sin verificar:** paridad numérica o igualdad de supuestos.

La [oferta de Process Mining Essentials](https://www.boc-group.com/en/marketplace/bpm/adonis-process-mining-essentials/) y la [documentación de Insights 19.1](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/) sitúan rutas descubiertas, variantes, conformidad y grafos de seguimiento directo detrás de un complemento separado y un proyecto de minería vinculado. Las [instrucciones de integración](https://docs.boc-group.com/adonis/en/processmining/adonis-integration/) diferencian vinculación por ID de proyecto en 17.0/17.1 de selección directa en 17.2+. **Lila:** la fase 8 debe conservar procedencia de eventos observados y límites de adaptadores. **Sin verificar:** esquema de eventos, conectores fuente, algoritmos y paquetes de licencia.

El [Marketplace](https://knowledge.boc-group.com/en/marketplace/adonis/) distingue módulos, integraciones, aplicaciones móviles y formación. Enumera Process Portal, Strategy & Performance Management, Word Report Creator, Process Mining Essentials y Process Automation. La [página de funciones](https://www.boc-group.com/en/adonis/features/) presenta Teams/SharePoint/Confluence, ADOIT y ADOGRC como integraciones. **Lila:** mantenerlos como oportunidades separadas del ecosistema; no incluir sus funciones en una supuesta base del producto. **Sin verificar:** precios actuales, requisitos de instalación y contratos de datos de cada conector.

El [resumen de API del Portal de Desarrolladores BOC](https://developer.boc-group.com/adoxx/en/API-introduction/) enumera API de metamodelo, repositorio (lectura/escritura/búsqueda), favoritos y usuarios, y especificación OpenAPI. El [índice de versiones](https://developer.boc-group.com/adoxx/en/versions/) agrupa documentación por versión de producto. El [repositorio oficial de ejemplos](https://github.com/BOC-Group/developer-examples) ilustra llamadas autenticadas; la [oferta de API REST de ADONIS](https://knowledge.boc-group.com/en/module/adonis-rest-api/) indica que debe activarse. **Lila:** la API de catálogos/modelos y MCP de fase 8 deben exponer reglas explícitas de autorización, identidad y revisión. **Sin verificar:** correspondencia completa de endpoints/campos y disponibilidad en una suscripción específica.

Las [novedades 17.1](https://docs.boc-group.com/adonis/en/docs/17.1/news/) agregan coloreado de varios tipos de objetos y mejoras de Propiedades bajo licencia. El [manual de paneles configurables 18.0](https://docs.boc-group.com/adonis/en/docs/18.0/user_manual/confda-00000/) y las [novedades de producto 19.0](https://www.boc-group.com/en/adonis/whats-new/) describen paneles configurables por rol y funciones nuevas de IA. Son **señales de una versión específica** para revisar la hoja de ruta, no funciones base; la revisión del 2026-10-15 no las comprobó en 19.1. **Lila:** considerar definiciones de paneles configurables después de Insights fijos iniciales. **Sin verificar:** disponibilidad real por edición y comportamiento de migración.

## Mapa de capacidades (19.1, consultado el 2026-10-15)

Cómo leer este mapa:

- **Fuente y versión.** Todo comportamiento de abajo viene del manual de usuario de ADONIS 19.1
  (`https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/<página>/`) y de la
  [página de terminología](https://developer.boc-group.com/adoxx/en/terminology/) de BOC (rotulada
  ADONIS 19–20), consultados el 2026-10-15 mediante un lector que resume y parafraseados aquí. **Nada
  se observó en uso.** *Documentado* significa que una página 19.1 lo dice; *inferido* significa
  nuestra lectura de un comportamiento documentado que la página no enuncia. Edición: ninguna de las
  capacidades asignadas a S1–S7 aparece como solo Enterprise en las páginas leídas, pero no se
  estableció su disponibilidad por edición (ver *Reglas de evidencia y disponibilidad*); los límites
  de Community de 256 modelos, 2.000 objetos y un solo usuario valen para cualquier comparación.
- **Lila hoy.** Rutas verificadas en `origin/main` en `02c8d83` (v1.0.0-beta.28) el 2026-10-16 con
  `git show`/`git grep`. RM-01 es el [contrato del repositorio](../REPOSITORY_CONTRACT.md): una
  especificación, no código.
- **Claves de alcance.** S1–S7 son el alcance «Repositorio organizacional v1» acordado con el dueño
  el 2026-10-16 ([hoja de ruta](../ROADMAP.md#repositorio-organizacional-v1)); S8 es la fase
  siguiente; FUERA queda excluido de v1.

### M1. Un rol, una identidad (S1)

- **Problema del usuario:** el mismo rol se escribe distinto en cada proceso; renombrarlo obliga a
  editar cada tarea y los documentos no coinciden.
- **Escenario (documentado, Quick Start):** crear el rol «Receptionist» en un grupo Roles del Object
  Catalogue, arrastrarlo a las propiedades de una tarea y elegir la relación «Responsible for
  execution» ([modqs-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/modqs-00000/)).
- **Entidades, relaciones, reglas:** los objetos de repositorio viven en el Object Catalogue y se
  reutilizan entre modelos con los mismos atributos en todas partes; los objetos de modelado existen
  solo en su modelo ([terminología](https://developer.boc-group.com/adoxx/en/terminology/),
  [objgra-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/objgra-00000/)). Un
  interref es una relación que se muestra en las propiedades como un atributo y puede apuntar a
  otros modelos. Nombre y descripción son globales; algunos atributos, como el color, son propios de
  cada modelo ([adinf-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/adinf-00000/)).
  Renombrar con un nombre existente del mismo tipo ofrece «Replace object», una fusión en la que las
  relaciones entrantes se mueven y las salientes no; copiar y pegar en el catálogo crea un objeto
  nuevo ([mamoo-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mamoo-00000/)).
- **Documentado o inferido:** lo anterior está documentado. Inferido: un renombrado se ve en todos
  los modelos que usan el objeto (se deduce del nombre global; ninguna página lo dice). No se indica:
  si pegar en el editor gráfico crea una referencia o una copia.
- **Lila hoy:** `lila:responsibility` lleva las cadenas libres `type` y `roleRef`
  ([`lila.moddle.json`](../../../packages/engine/src/bpmn/lila.moddle.json)); `readAnnotations` en
  [`annotate.ts`](../../../packages/engine/src/bpmn/annotate.ts) las devuelve como
  `{ type, roleRef }`; el [panel de propiedades](../../../apps/web/src/PropertiesPanel.tsx) edita
  `roleRef` como un campo de texto. No hay catálogo, así que un rol no tiene nombre propio.
- **Brecha:** objeto rol, selector, renombrado en un solo lugar, adopción de los ids ya escritos.
- **Propuesta (S1):** objetos `role` de catálogo (RM-01 § 2.2) referenciados por id desde `roleRef`;
  un selector sustituye al campo de texto y escribe el mismo atributo (§ 3.1); un renombrado escribe
  solo el archivo del objeto (§ 3.4); un id escrito sin objeto puede adoptarse como id de ese objeto
  (§ 2.3, § 3.4). Los objetos nunca se emparejan por nombre (§ 3.5), una diferencia deliberada con
  «Replace object»: reemplazar es un comando explícito de S2.
- **Verificación:** la aceptación de S1 — «Receptionist» en el catálogo, referenciado desde tareas de
  tres procesos mediante el selector, renombrado una vez, y los tres muestran el nombre nuevo;
  guardar el `.lila`, reabrir, mismo id; los proyectos v1 y v2 abren sin cambios; los ids de
  `roleRef` escritos a mano pueden adoptarse.

### M2. Dónde se usa, referencias rotas y borrado (S2)

- **Problema del usuario:** antes de cambiar o borrar un rol, sistema o documento nadie ve quién lo
  usa, y un borrado deja ids colgantes sin avisar.
- **Escenario (documentado):** clic derecho en un objeto → *Show usage*: un árbol de referencias
  (válidas y rotas), uso en modelos y un resumen de uso, con filtro, navegación y exportación XLSX
  ([usa-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/usa-000000/)).
- **Entidades, relaciones, reglas:** `Supr` quita una aparición solo del modelo; `Mayús+Supr` la quita
  del modelo y del catálogo
  ([edimo-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/edimo-00000/)). Borrar
  desde el catálogo un objeto en uso muestra un aviso y `Mayús+Supr` lo fuerza; las referencias
  entrantes generan una advertencia para continuar o cancelar; un borrado forzado deja referencias
  rotas ([mamoo-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mamoo-00000/)).
- **Documentado o inferido:** documentado.
- **Lila hoy:** nada. [`BPMN_EXTENSION.md`](../BPMN_EXTENSION.md) en `main` promete una advertencia de
  lint para referencias ausentes de un catálogo, pero ningún código las comprueba (este PR corrige
  esa afirmación).
- **Brecha:** índice de uso, lint, política de borrado.
- **Propuesta (S2):** el índice de uso derivado de RM-01 § 4, con la misma respuesta en la app, la
  CLI y el servidor MCP; una advertencia de lint para referencias que no están en el catálogo, solo
  en un repositorio que lo tiene (§ 3.4); borrar un objeto en uso se rechaza salvo que el usuario
  elija *reemplazar por* o *quitar las referencias*, cada uno un único comando deshacible (§ 3.4,
  `E-OBJETO-EN-USO`). Es más estricto que ADONIS a propósito: Lila nunca deja referencias rotas.
- **Verificación:** un rol usado por dos procesos y por un campo de objeto lista tres usos; su borrado
  se rechaza; *reemplazar por* reescribe todas las referencias y deshacer las restaura; un id
  ausente del catálogo da una advertencia en un repositorio versión 3 y ninguna en un proyecto v1 o
  v2.

### M3. Vistas RACI (S3)

- **Problema del usuario:** responder «quién hace qué» en un proceso y entre procesos, con nombres, y
  exportarlo.
- **Escenario (documentado):** la sección de Insights de proceso «Involved Roles (RACI)» con la acción
  rápida RACI Matrix; el panel de rol «Assigned Tasks and Processes»; un gráfico Matrix de tareas ×
  roles; «My BPM → RACI» en Read & Explore
  ([igh-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/),
  [modwv-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/modwv-00000/)).
- **Entidades, relaciones, reglas:** relaciones tarea → rol «Responsible for execution» (R),
  «Accountable for approving results» (A), «Cooperation/Participation» (C) y «To inform» (I)
  ([sta-200000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/sta-200000/); letras en
  igh-000000).
- **Documentado o inferido:** documentado. Inferido: cuánto abarca el gráfico Matrix entre procesos
  depende del conjunto de datos que elija el usuario.
- **Lila hoy:** `raciMatrix` en
  [`process-document.ts`](../../../packages/engine/src/process-document.ts) arma la matriz de un
  proceso: elementos con responsabilidades como filas e ids `roleRef` crudos como columnas, en orden
  de primera aparición. La CLI (`lila process raci`) y la tool MCP `get_raci_matrix` la exponen, con
  CSV mediante `raciCsv` ([`agent-tools.ts`](../../../packages/engine/src/project-fs/agent-tools.ts)).
  No hay vista RACI en la app, ni matriz entre procesos, ni nombres de rol.
- **Brecha:** vista en la app, matriz entre procesos, nombres del catálogo, XLSX.
- **Propuesta (S3):** una vista en la app de tareas × roles por proceso y entre procesos, con nombres
  del catálogo, exportable a CSV/XLSX; por proceso, sus celdas son iguales a `raciMatrix` del motor.
- **Verificación:** en cada proceso de un caso sintético las celdas de la vista son iguales a
  `raciMatrix`; la vista entre procesos es su unión; las exportaciones llevan nombres e ids.

### M4. Unidades organizativas (S4)

- **Problema del usuario:** un rol pertenece a un departamento y la RACI se lee departamento por
  departamento.
- **Escenario (documentado):** el Working Environment Model es el organigrama y puede anidarse
  ([mty-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mty-000000/)); una
  Organizational Unit tiene tipo, responsable y número de ejecutantes, y un Role «Belongs to» una
  Organizational Unit ([igh-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/)).
- **Documentado o inferido:** documentado. No se encontró un objeto Position en las páginas leídas.
- **Lila hoy:** nada organizacional. Los pools de recursos del escenario
  ([`scenario.ts`](../../../packages/engine/src/scenario.ts)) son capacidad, no un directorio.
- **Brecha:** unidades, su jerarquía, la unidad de un rol.
- **Propuesta (S4):** `unit` de catálogo con `parentRef` y `role.unitRef` (RM-01 § 2.2), un árbol de
  unidades y un filtro de la RACI por unidad. Un organigrama dibujado y puestos/personas quedan
  FUERA.
- **Verificación:** se muestra un árbol de tres niveles; un ciclo se muestra cortado en la unidad
  repetida (§ 2.2); el filtro deja exactamente los roles de la unidad elegida (si cuentan las
  unidades hijas se decide en el issue del lote).

### M5. Del carril a las responsabilidades de las tareas (S5)

- **Problema del usuario:** los carriles ya dicen quién hace cada tarea; reescribir la RACI tarea por
  tarea es trabajo perdido.
- **Escenario (documentado):** un carril tiene una referencia Resource; su comando contextual «Assign
  responsibilities to tasks» la copia en la relación «Responsible for execution» de las tareas que
  contiene ([edimo-00000, § edimo-09000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/edimo-00000/)).
- **Documentado o inferido:** documentado. Inferido: pertenecer al carril no asigna nada por sí solo;
  el comando es explícito.
- **Lila hoy:** [`laneToPool.ts`](../../../apps/web/src/laneToPool.ts) (LILA-334) asigna en bloque
  las tareas de un carril a un pool de recursos de **simulación** (`elements[task].resources` del
  escenario), no a un rol RACI.
- **Brecha:** el mismo gesto para responsabilidades.
- **Propuesta (S5):** un comando de carril que escribe `lila:responsibility type="R"` con un rol del
  catálogo elegido una vez en cada tarea del carril, como un único comando deshacible, e informa de
  las tareas que ya tienen una R. Nunca automático y nunca toca el escenario.
- **Verificación:** un carril de cuatro tareas, una ya R de otro rol: tres entradas nuevas, el informe
  lista la cuarta, deshacer restaura, el archivo de escenario queda idéntico byte a byte.

### M6. Jerarquía de procesos (S6)

- **Problema del usuario:** navegar desde un proceso superior a los procesos que llama, y ver dónde se
  usa un proceso.
- **Escenario (documentado):** el Process Landscape es el punto de entrada de la navegación; un objeto
  Process apunta a su «Referenced business process/process landscape»; un subproceso apunta a un
  diagrama subordinado ([mty-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mty-000000/),
  [igh-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/igh-000000/),
  [motoo-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/motoo-00000/)). El botón
  *Hierarchy* muestra el camino más corto al modelo superior, con clic, además de «Also referenced
  in», atrás/adelante y vistas abiertas (motoo-00000). Una sincronización opcional en un sentido copia
  responsable, gestor, revisor, analista, sistemas, riesgos y controles de un diagrama a su objeto
  Process ([adinf-00000, § adinf-09000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/adinf-00000/),
  [procmap-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/procmap-000000/)).
- **Documentado o inferido:** documentado. «Value chain» y «process group» no aparecieron en 19.1.
- **Lila hoy:** en [`App.tsx`](../../../apps/web/src/App.tsx) (#461) un doble clic en una actividad de
  llamada abre el proceso del proyecto cuyo id de proceso BPMN es su `calledElement`, y avisa cuando
  no se resuelve o es el mismo proceso. No hay árbol ni «usado en» inverso.
- **Brecha:** árbol derivado, caminos inversos.
- **Propuesta (S6):** un árbol de procesos derivado de las actividades de llamada, con los caminos
  «usado en» de cada proceso y todos los nodos con clic. Un tipo de diagrama dibujado de paisaje o
  cadena de valor queda FUERA.
- **Verificación:** A llama a B y C, D llama a B: el árbol muestra A → B, A → C y D → B; el «usado en»
  de B lista A y D con sus caminos; un ciclo se muestra cortado; un `calledElement` sin resolver se
  lista.

### M7. Documentos con nombres e informe por rol (S7)

- **Problema del usuario:** el documento Word/HTML muestra ids de rol como `rol-1` y nadie puede
  imprimir lo que hace un rol.
- **Escenario (documentado):** informes PDF/RTF (estándar, preguntas abiertas, resumen de proyecto,
  QM) y una publicación HTML sin conexión
  ([pubwc-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/pubwc-000000/),
  [red-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/red-000000/)); el panel de
  rol «Assigned Tasks and Processes» (igh-000000).
- **Documentado o inferido:** documentado; no se revisó el contenido de cada plantilla de informe.
- **Lila hoy:** [`process-document.ts`](../../../packages/engine/src/process-document.ts) escribe cada
  responsabilidad como `R: <roleRef>`, el id crudo.
- **Brecha:** nombres, un informe por rol.
- **Propuesta (S7):** resolver los nombres al generar (RM-01 § 3.1), con los ids sin resolver
  marcados como tales; un informe por rol con tareas y procesos por letra RACI.
- **Verificación:** renombrar un rol y regenerar: aparece el nombre nuevo; un id sin resolver aparece
  marcado; el informe por rol es igual a la columna de ese rol en S3.

### M8. Riesgos y controles (S8, fase siguiente)

- **Documentado:** Risk, Control y Control Objective Pools; la relación «Assigned risks»; un panel Risk
  and Control Overview (igh-000000). Inferido: una matriz riesgo–control dentro del propio ADONIS
  (solo documentada en material comercial de ADOGRC).
- **Lila hoy:** `lila:riskRef` y `lila:controlRef` guardan ids libres; RM-01 § 2.5 reserva los tipos.
- **Propuesta:** S8 en el lote A4 con su propio contrato. No entra en v1.

### Fuera de v1

| Capacidad | Fuente 19.1 | Edición / nota | Por qué no entra en v1 |
| --- | --- | --- | --- |
| Flujo de liberación: borrador → revisión metodológica → revisión de negocio → liberado → archivado | [rwf-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/rwf-000000/) | Solo Enterprise | FUERA: flujos de liberación (fase 7) |
| Roles de gobierno: responsable, gestor, revisor metodológico, analista/diseñador del proceso | [sta-300000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/sta-300000/) | Control & Release es solo Enterprise | Fase 7; los metadatos de responsable no prueban aprobación |
| Responsable del objeto «Responsible Person» (no es RACI) | [adinf-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/adinf-00000/) | — | FUERA: puestos/personas; RM-01 mantiene `ownerRef` a un rol |
| Organisation Portal | [sta-400000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/sta-400000/) | No se ofrece a clientes nuevos desde 15.0 | FUERA: portal |
| Search & Analysis con consultas guardadas | [searc-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/searc-000000/) | — | FUERA: consultas guardadas |
| Gráficos de barras, cajas anidadas, burbujas y Gantt; paneles configurables | [modwv-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/modwv-00000/) | — | FUERA: paneles/Insights configurables (S3 es la única matriz fija) |
| Dependency Modeller | [dep-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/dep-000000/) | — | FUERA |
| Comparación de modelos | [compa-000000 (17.1)](https://docs.boc-group.com/adonis/en/docs/17.1/user_manual/compa-000000/) | Sin recomprobar en 19.1 | FUERA |
| Editor tabular con pegado desde Excel; vista textual | [tab-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/tab-000000/), [tex-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/tex-000000/) | — | FUERA: editor tabular; la vista textual no tiene punto S |
| Objetos Documento con archivo cargado (≤ 50 MB, tipos configurables) | [condms-00000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/condms-00000/) | Community: documentos PDF de 1 MB | FUERA: adjuntos (RM-01 § 6 sigue siendo el contrato) |
| Organigrama, paisaje de procesos y Modelo de Sistema TI dibujados | [mty-000000](https://docs.boc-group.com/adonis/en/docs/19.1/user_manual/mty-000000/) | — | FUERA: tipos de diagrama de organigrama/paisaje |
| Multiusuario, comentarios, permisos, SSO, API REST, sincronización ADOIT/ADOGRC, IA, minería, personalización del metamodelo, KPI/Ishikawa/SIPOC, control documental ISO | Secciones 4–5 de arriba (17.1 y páginas del proveedor) | Mayormente módulos o integraciones; sin comprobar en 19.1 | FUERA |

Cómo se verifica, en general: el comportamiento del proveedor es una referencia, no un oráculo. Cada
punto S se acepta con casos sintéticos de Lila (el escenario de S1 de arriba y las comprobaciones de
cada bloque) y con las funciones del propio motor (`raciMatrix`, el índice de uso de RM-01), nunca
con una ejecución de ADONIS, que esta investigación no tuvo.

## Observaciones para la hoja de ruta

La hoja de ruta actual incluye las familias principales de repositorio, vistas, riesgo, KPI, gobierno e integración. La evidencia pública sugiere cuatro decisiones explícitas al especificar cada fase: (1) una vista textual legible de procesos/instrucciones de trabajo distinta de la edición tabular; (2) búsquedas guardadas y conjuntos de análisis entre objetos; (3) liberación/versionado de documentos separado de modelos; y (4) paneles configurables como opción posterior a Insights fijos. Son **posibles adiciones**, no requisitos de paridad con el proveedor. Conservar decisiones propias de Lila, como edición masiva atómica, fuente/fecha/tipo de métricas e identidades seguras entre modelos aunque el manual de ADONIS no las prometa.

## Pruebas prácticas pendientes

1. Obtener una instancia de prueba autorizada y registrar versión, edición/plan, licencia, biblioteca y módulos habilitados; revisar menús reales de tipos y derechos. No deducir las marcas de la tabla web de ediciones.
2. Crear casos sintéticos con dos procesos que comparten rol, aplicación, documento, riesgo y control. Probar creación, renombrado, reemplazo, borrado, uso y referencias rotas. En particular, probar si un objeto Proceso compartido con versiones y sus referencias pasan a una versión nueva cuando se libera uno o ambos modelos que lo contienen; luego inspeccionar importación/exportación de ida y vuelta.
3. Comparar vistas gráfica, textual, tabular, RACI e Insights del mismo proceso. Probar pegado masivo inválido, permisos, deshacer y representación de constructos BPMN no compatibles.
4. Ejercitar borrador/revisión/liberación, comparación con predecesor, referencias, vigencia y versiones de documentos con distintos roles, si la licencia lo permite.
5. Confirmar límites de complementos para simulación, minería, IA, informes, portal e integraciones mediante documentación o cotización del proveedor; probar permisos y autenticación de API solo en instancias autorizadas.

Todas las descripciones del proveedor son paráfrasis. Ningún esquema privado, captura propietaria o comportamiento sin licencia se presenta como hecho observado.
