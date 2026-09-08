# Extensión BPMN `lila:` y política de ids

Fuente de verdad: `LILA_MODELER_ESTRUCTURA.md`, sección 4 (ADR-012 "Identidad de elemento y de proceso", ADR-013 "Dónde vive cada dato", ADR-014 "Un solo namespace de extensión, definido una sola vez") y sección 5 (ruta de `lila.moddle.json` en el repositorio). Este documento es la referencia operativa para implementar el parser/serializador (`packages/engine/src/bpmn/parse.ts`) y el descriptor moddle (`packages/engine/src/bpmn/lila.moddle.json`); no repite el razonamiento de las ADR, lo aplica.

Este documento se apega a ADR-012 y ADR-014; cualquier discrepancia entre este archivo y esas ADR la resuelve `LILA_MODELER_ESTRUCTURA.md` y se corrige aquí.

---

## 1. Namespace

```
xmlns:lila="https://lila-modeler.org/schema/bpmn/1"
```

Decidido en ADR-014. El IRI **no necesita resolver** (no hay nada publicado en esa URL) — solo debe ser estable y no cambiar antes de M4. El sufijo `/1` es la versión del namespace, no la versión del proceso: crece de forma **aditiva** (se agregan elementos nuevos; nunca se quita ni se resignifica uno existente) mientras el namespace siga siendo `/1`. Un cambio incompatible requeriría `/2` — no se anticipa antes de M4.

El namespace se declara **una sola vez**, en `bpmn:definitions`, y se usa igual en:

- el editor (`apps/web`, vía `BpmnModeler({ moddleExtensions: { lila } })`),
- la CLI y el motor (`packages/engine`),
- cualquier servidor futuro (`packages/server`, M6).

Los tres leen el mismo descriptor: `packages/engine/src/bpmn/lila.moddle.json` (sección 5 del documento de estructura). No existe una segunda copia del descriptor en ninguna otra parte del repositorio.

### Round-trip

bpmn-moddle preserva namespaces desconocidos al hacer `saveXML` tras `importXML` (verificado con archivos reales de BPSim, qbp y Bizagi — ver `investigacion-2026-09-03/02-bizagi-simulacion.md` y `03-editor-bpmn.md`). Esto es lo que permite que `lila:*` sobreviva a una herramienta que no lo conoce (round-trip por Camunda Modeler, Signavio, ADORIS, etc.) sin que esa herramienta necesite el descriptor. Ese comportamiento se prueba en M4 contra herramientas reales; si alguna no preserva namespaces ajenos, el plan B es un sidecar `annotations.json` keyed por `id` de elemento con el mismo vocabulario (mismos nombres de campo que los elementos `lila:*`), fuera del `.bpmn`.

---

## 2. Elementos v1

Todos los elementos de la extensión son **elementos XML hijos**, nunca atributos del elemento BPMN que documentan — la única excepción es que cada elemento `lila:*` sí puede tener sus propios atributos (p. ej. `lila:responsibility` tiene los atributos `type` y `roleRef`). La razón de usar elementos y no atributos en el punto de inserción es permitir **listas**: un `bpmn:task` puede tener varios `lila:systemRef` (usa más de un sistema), varios `lila:input`/`lila:output`, etc. Un atributo XML no puede repetirse en el mismo nodo.

Todos (salvo `versionTag`, ver más abajo) van dentro de `bpmn:extensionElements` del elemento BPMN que documentan (tarea, evento, gateway, lane, o el propio `bpmn:process`):

```xml
<bpmn:task id="Task_7f3k2q1" name="Revisar solicitud">
  <bpmn:extensionElements>
    <lila:responsibility type="R" roleRef="rol-1"/>
    <lila:responsibility type="A" roleRef="rol-2"/>
    <lila:systemRef ref="sys-crm"/>
    <lila:documentRef ref="doc-solicitud"/>
    <lila:input ref="doc-solicitud"/>
    <lila:output ref="doc-solicitud-revisada"/>
  </bpmn:extensionElements>
  <bpmn:incoming>Flow_1</bpmn:incoming>
  <bpmn:outgoing>Flow_2</bpmn:outgoing>
</bpmn:task>
```

| Elemento | Atributos | Qué documenta | Apunta a |
|---|---|---|---|
| `lila:responsibility` | `type` (`R`\|`A`\|`C`\|`I`), `roleRef` | Matriz RACI del elemento: una fila por combinación responsable/rol. Un elemento puede tener varios `lila:responsibility` (varios roles, o el mismo rol con distinto `type` no tiene sentido pero no se valida como error — es warning). | `roleRef` → id en el catálogo de roles (`catalog.json`, ver ADR-013). |
| `lila:systemRef` | `ref` | Sistema/aplicación que interviene en el elemento. | id en el catálogo de sistemas. |
| `lila:documentRef` | `ref` | Documento asociado al elemento (entrada, salida o solo referencia general). | id en el catálogo de documentos. |
| `lila:riskRef` | `ref` | Riesgo asociado al elemento. | id en el catálogo de riesgos. |
| `lila:controlRef` | `ref` | Control asociado al elemento (mitiga un riesgo). | id en el catálogo de controles. |
| `lila:kpiRef` | `ref` | Indicador que mide el elemento. | id en el catálogo de KPIs. |
| `lila:input` | `ref` | Documento/dato que el elemento consume. Subconjunto semántico de `documentRef` con dirección explícita; puede coexistir con `documentRef` para el mismo id. | id en el catálogo de documentos. |
| `lila:output` | `ref` | Documento/dato que el elemento produce. | id en el catálogo de documentos. |
| `lila:versionTag` | `value` | Ver sección 4 (clave de proceso). Único elemento que **no** cuelga de un elemento de flujo — cuelga de `bpmn:process`. | — (valor libre, no referencia catálogo). |

Todas las referencias (`roleRef`, y los `ref` de `systemRef`/`documentRef`/`riskRef`/`controlRef`/`kpiRef`/`input`/`output`) apuntan a ids del catálogo (`catalog.json`, fuera del `.bpmn` — ADR-013). Una referencia colgante (id que no existe en el catálogo) es un **warning de lint**, no un error de validación — el catálogo puede completarse después del diagrama.

`versionTag` va como hijo de `bpmn:extensionElements` de `bpmn:process` (no de `bpmn:definitions` ni de una tarea):

```xml
<bpmn:process id="credito-solicitud" isExecutable="false">
  <bpmn:extensionElements>
    <lila:versionTag value="1.3.0"/>
  </bpmn:extensionElements>
  ...
</bpmn:process>
```

Patrón calcado de `zeebe:versionTag` (Camunda 8), citado como precedente en ADR-012.

### Qué NO es v1

Los parámetros de simulación (`processingTime`, `resources`, `interTriggerTimer`, etc.) **no** son parte de esta extensión — viven en `*.scenario.json`, separados del `.bpmn` (ADR-007, ADR-013; formato completo en `SCENARIO_FORMAT.md`). `lila:` documenta el proceso (RACI, sistemas, documentos, riesgos, controles, KPIs, versión); no lo parametriza para simular.

---

## 3. Política de ids (ADR-012)

### Id de elemento

- El id de cada elemento BPMN (`bpmn:task@id`, `bpmn:sequenceFlow@id`, etc.) es la **única clave** para colgar datos de negocio o de simulación. Nunca el nombre visible (`name`).
- Formato: **NCName** válido (XML `Name` sin `:`), generado por Lila como `<PrefijoPorTipo>_<sufijo aleatorio>`, p. ej. `Task_7f3k2q1`, `Gateway_a91nc0x`, `Flow_k2m8p1q`. El sufijo aleatorio evita colisiones sin necesitar un contador centralizado.
- Prefijo por tipo (no exhaustivo, crece con el IR): `Start_`, `End_`, `Task_`, `Gateway_` (XOR/OR/AND comparten prefijo; el tipo exacto vive en el IR, no en el id), `Timer_`, `Flow_`, `SubProcess_`.
- **Nunca se regenera** un id existente al importar, exportar o renombrar el elemento (renombrar cambia `name`, no `id`). Regenerar el id rompería cualquier referencia externa: entradas de `*.scenario.json` keyed por id, filas de event log, referencias de catálogo.
- **Se genera un id nuevo** al copiar/pegar un elemento — un elemento copiado es una entidad distinta y no debe arrastrar los datos (`lila:*`, escenario) del original bajo el mismo id.
- **Sanitización reversible para ids ajenos no-NCName**: algunas herramientas (Bizagi entre ellas) pueden emitir ids que no son NCName válidos. Al importar, Lila sanitiza esos ids a NCName y guarda el mapa `idSanitizado → idOriginal` en `ir.source.originalIds` (ver la forma de `ProcessIR` en la sección 6 del documento de estructura), de modo que un re-export pueda restaurar el id original si la herramienta de destino lo necesita. La sanitización es determinista (mismo id ajeno → mismo id sanitizado) para que reimportar el mismo archivo no genere ids distintos cada vez.

El editor aplica el mismo `sanitizeXmlIds` del motor antes de entregar el documento a bpmn-js y
conserva el mapa por instancia de modelador. Al exportar, restaura en una sola pasada tanto las
declaraciones como las referencias (`sourceRef`, `targetRef`, `default`, `bpmnElement` y referencias
textuales), incluidas las de BPMNDI. La apertura se prepara en una instancia candidata y solo
reemplaza el lienzo activo cuando la importación completa termina; un XML mal formado o sin diagrama
renderizable no sustituye el XML, selección, servicios ni historial anteriores. Si el lector reportó
una pérdida semántica —por ejemplo, una referencia topológica rota— la exportación exige una decisión
visible con el detalle del aviso, porque el árbol serializado ya no puede reconstruir ese contenido.

### Id de proceso

- Clave lógica de un proceso: **`bpmn:process@id` (slug ASCII) + `lila:versionTag`**. Ejemplo: `credito-solicitud` + `1.3.0`. Es la clave que identifica "el mismo proceso, versión X" a través de reimportaciones y ediciones — no es solo `process@id`, porque dos versiones del mismo proceso de negocio pueden (y en general deben) coexistir como archivos o commits distintos con el mismo `process@id`.
- `bpmn:process@id` se genera igual que cualquier otro id de elemento (NCName; ver arriba) pero se recomienda un slug ASCII legible (`credito-solicitud`, no `Process_7f3k2q1`) porque además de clave técnica funciona como nombre de carpeta/archivo en el layout de proyecto.
- `lila:versionTag` es una cadena libre (semver recomendado, `1.3.0`, pero no forzado por el esquema — un usuario puede versionar como `v2`, `2026-Q3`, etc.). Ausente por defecto; su ausencia no es error.

### `exporter` / `exporterVersion`

Todo `.bpmn` que Lila escribe declara, en `bpmn:definitions`:

```xml
<bpmn:definitions
    xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:lila="https://lila-modeler.org/schema/bpmn/1"
    exporter="Lila Modeler"
    exporterVersion="0.1.0"
    ...>
```

`exporterVersion` es la versión de paquete de `@lila/engine` que generó el archivo (siempre la del motor, también cuando quien guarda es la app web: los dos atributos los escribe un único helper, `marcarExportador` en `packages/engine/src/bpmn/ids.ts`) — sirve para diagnosticar diferencias de comportamiento entre versiones del motor, igual que hacen bpmn-js y Camunda Modeler con sus propios `exporter`/`exporterVersion`. Bizagi, por comparación, **no** declara estos atributos en su export (verificado en 5 archivos reales — ver `investigacion-2026-09-03/02-bizagi-simulacion.md`), lo que hace imposible saber qué versión de Bizagi Modeler generó un archivo dado; Lila evita ese problema desde el día uno.

---

## 4. Descriptor moddle (ejemplo)

Vive en `packages/engine/src/bpmn/lila.moddle.json` (única definición — sección 5 del documento de estructura). Forma que tendrá (ejemplo v1, sujeto a los ajustes menores que exija bpmn-moddle en implementación):

```json
{
  "name": "Lila",
  "uri": "https://lila-modeler.org/schema/bpmn/1",
  "prefix": "lila",
  "xml": {
    "tagAlias": "lowerCase"
  },
  "types": [
    {
      "name": "Responsibility",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "type", "isAttr": true, "type": "String" },
        { "name": "roleRef", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "SystemRef",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "DocumentRef",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "RiskRef",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "ControlRef",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "KpiRef",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "Input",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "Output",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "ref", "isAttr": true, "type": "String" }
      ]
    },
    {
      "name": "VersionTag",
      "superClass": ["Element"],
      "meta": { "allowedIn": ["bpmn:ExtensionElements"] },
      "properties": [
        { "name": "value", "isAttr": true, "type": "String" }
      ]
    }
  ]
}
```

Notas de implementación (no normativas, se resuelven en el ticket que crea el archivo real):

- `meta.allowedIn` documenta la intención (todos menos `VersionTag` van en el `extensionElements` de un elemento de flujo; `VersionTag` en el de `bpmn:process`); bpmn-moddle no valida `allowedIn` en tiempo de parseo — la validación real de "quién puede contener qué" la hace `packages/engine/src/bpmn/validate.ts`.
- No se usan `associations` porque ninguno de estos tipos necesita sustituir o extender un tipo BPMN existente; todos son elementos nuevos que cuelgan de `bpmn:extensionElements`, que ya acepta cualquier `values[]` de un namespace declarado.
- Todas las propiedades son `isAttr: true` (atributos del elemento `lila:*`, no hijos propios) — mantiene cada elemento en una sola línea XML y es suficiente para v1 porque ninguno necesita texto libre ni anidamiento.

---

## 5. Fragmento de ejemplo completo

`bpmn:extensionElements` de una tarea con responsabilidad RACI, referencias de catálogo y versión de proceso:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
    xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:lila="https://lila-modeler.org/schema/bpmn/1"
    id="Definitions_1"
    exporter="Lila Modeler"
    exporterVersion="0.1.0"
    targetNamespace="http://lila-modeler.org/schema/bpmn">

  <bpmn:process id="credito-solicitud" name="Solicitud de crédito" isExecutable="false">
    <bpmn:extensionElements>
      <lila:versionTag value="1.3.0"/>
    </bpmn:extensionElements>

    <bpmn:startEvent id="Start_9k2m1qa" name="Solicitud recibida">
      <bpmn:outgoing>Flow_a1</bpmn:outgoing>
    </bpmn:startEvent>

    <bpmn:task id="Task_7f3k2q1" name="Revisar solicitud">
      <bpmn:extensionElements>
        <lila:responsibility type="R" roleRef="rol-1"/>
        <lila:responsibility type="A" roleRef="rol-2"/>
        <lila:systemRef ref="sys-crm"/>
        <lila:documentRef ref="doc-solicitud"/>
        <lila:input ref="doc-solicitud"/>
        <lila:output ref="doc-solicitud-revisada"/>
        <lila:kpiRef ref="kpi-tiempo-revision"/>
      </bpmn:extensionElements>
      <bpmn:incoming>Flow_a1</bpmn:incoming>
      <bpmn:outgoing>Flow_a2</bpmn:outgoing>
    </bpmn:task>

    <bpmn:endEvent id="End_k9x3m2z" name="Fin">
      <bpmn:incoming>Flow_a2</bpmn:incoming>
    </bpmn:endEvent>

    <bpmn:sequenceFlow id="Flow_a1" sourceRef="Start_9k2m1qa" targetRef="Task_7f3k2q1"/>
    <bpmn:sequenceFlow id="Flow_a2" sourceRef="Task_7f3k2q1" targetRef="End_k9x3m2z"/>
  </bpmn:process>
</bpmn:definitions>
```

Correspondencia con el catálogo referenciado (`catalog.json`, fuera de este documento — ver `SCENARIO_FORMAT.md`/`LILA_MODELER_ESTRUCTURA.md` sección 5 para su ubicación): `rol-1`, `rol-2`, `sys-crm`, `doc-solicitud`, `doc-solicitud-revisada` y `kpi-tiempo-revision` son ids que deben existir ahí; si no existen, `validate(ir)` emite un warning de referencia colgante por cada uno, no un error.

---

## 6. Consistencia con las ADR

- **ADR-012** (identidad de elemento y de proceso): implementado en la sección 3 de este documento — NCName con prefijo por tipo, nunca regenerado, nuevo al copiar, sanitización reversible, clave de proceso = `process@id` + `versionTag`, `exporter`/`exporterVersion` en `definitions`.
- **ADR-014** (namespace único, definido una sola vez): implementado en las secciones 1, 2 y 4 — un solo IRI, un solo descriptor compartido por editor/CLI/servidor, elementos (no atributos en el punto de inserción) para permitir listas, crecimiento aditivo, plan de verificación de round-trip en M4 con fallback a `annotations.json`.

Si en el futuro alguna decisión de este documento entra en conflicto con una ADR nueva o revisada, gana la ADR y este documento se actualiza para reflejarla (nunca al revés).

---

## 7. Round-trip en la app web

La app web abre un `.bpmn` con bpmn-js y lo vuelve a escribir con `saveXML`, es decir con
bpmn-moddle serializando **el árbol que bpmn-moddle pudo leer**. Eso fija exactamente qué
sobrevive a abrir-y-exportar (LILA-192, `apps/web/src/modelerXml.ts`):

**Se conserva**

- Los ids originales del archivo, incluidos los que no son NCName. Al importar se sanean de
  forma reversible (sección 3) y al exportar se restauran uno a uno, en atributos, en texto y en
  las referencias del BPMNDI, con las comillas y las entidades del original.
- Los elementos `lila:` de este documento y las extensiones ajenas (`bizagi:` y compañía): el
  descriptor `lila` va en `moddleExtensions` y el resto viaja como contenido genérico.
- El diagrama (`bpmndi`), la documentación, los nombres y la topología.
- `exporter`/`exporterVersion` en `definitions`, que los reescribe siempre `marcarExportador`.

**No se conserva**

- Las referencias por id que apuntan a un elemento que el archivo nunca declara —`messageRef`,
  `dataStoreRef`, `categoryValueRef`, `dataObjectRef`—: bpmn-moddle no las resuelve, no llegan al árbol y el
  archivo exportado ya no las lleva. Los fixtures de `examples/bizagi-exports` son un caso real.
- Lo que el import descarta con un aviso de contenido no parseable o de referencia de topología
  sin resolver: si no entró en el modelo, no puede salir en el XML.

**Cómo se avisa** (nunca en silencio, que era la queja de LILA-192)

- La barra de estado enseña la lista completa como **error** —no como aviso—, con los ids:
  «N elementos o referencias se perderán al exportar: …» (LILA-193).
- Todo lo que escribe un .bpmn con pérdida pasa antes por el mismo diálogo, con esa misma lista
  y dos salidas: «Exportar .bpmn» ofrece «Exportar igualmente»/«Cancelar» y guardar el proyecto
  ofrece «Guardar igualmente»/«Cancelar». Cancelar no descarga ni escribe nada en disco.
- `autorizarExportacion` corta con un error cualquier exportación con pérdida que no traiga
  `aceptarPerdida`, es decir el sí explícito de ese diálogo: el XML que alimenta a la simulación
  —que el usuario no ve— nunca lo trae, y el snapshot de guardar solo lo trae después del sí.
- En Electron, cancelar el diálogo al guardar devuelve «no se guardó» al cierre de la ventana,
  así que el cierre se cancela y no se pierde nada.

Nada de esto reescribe el serializador: la fidelidad byte a byte con el archivo de origen no es
una promesa de la app, y conservar atributos rotos exigiría un serializador propio.
