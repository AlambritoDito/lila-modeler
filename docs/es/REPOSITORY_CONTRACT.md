# El contrato del repositorio (RM-01): objetos de catálogo, identidad y almacenamiento por objeto

> Leer en: [English](../REPOSITORY_CONTRACT.md).

**Estado:** aceptado el 2026-10-14 (ADR-032); el contrato del lote A1 (catálogo, almacén por
objeto, selectores, explorador). Nada de este documento está implementado salvo lo que dice «hoy». Amplía
[el formato de proyecto](PROJECT_FORMAT.md) (versiones 1 y 2, que se quedan exactamente como están)
y fija lo que [ADR-029](DECISIONS.md) dejó abierto: la disposición de la versión 3, la identidad de
los objetos, las referencias, la interfaz de almacenamiento, los adjuntos, la recuperación ante
fallos y los presupuestos de rendimiento. La sección 10 recoge las decisiones del dueño sobre las
preguntas de producto. El orden de entrega está en el [roadmap](ROADMAP.md).

**Debe**, **no debe** y **puede** son normativos. «La app» es la app web y la de escritorio por
igual; «el motor» es `@lila-modeler/engine` (y, a través de él, la CLI y el servidor MCP).

## 1. Disposición y manifiesto

### 1.1 La disposición de la versión 3

Un repositorio con al menos un objeto de catálogo o un adjunto se escribe como **versión 3**. Es la
disposición de la versión 2 más dos carpetas:

```
lila-project.json                    manifiesto, "version": 3
processes/<slug>/model.bpmn          como en la versión 2, sin cambios
processes/<slug>/<nombre>.scenario.json
processes/<slug>/runs/<id>.result.json
catalog/<tipo>/<id>.json             un archivo por objeto de catálogo (sección 2)
attachments/<sha256>[.<ext>]         bytes de los objetos documento (sección 6)
```

Nombres reservados, **que A1 no escribe**: `maps/` (mapas de procesos, fase 3), `analysis/`,
`dashboards/`, `records/` (ADR-029) y `processes/<slug>/process.json` (responsable y estado de
liberación de un proceso). Sus esquemas son de contratos posteriores. Un lector A1 los conserva
(§ 1.4).

`attachments/` no está en el esbozo de ADR-029. El nombre es el que `docs/PROJECT_FORMAT.md` ya
usa como ejemplo de carpeta que hoy se descarta; va aparte de `catalog/` porque sus entradas son
binarias, inmutables y direccionadas por contenido, mientras que las del catálogo son JSON pequeños
y editables. Poner los bytes junto al objeto documento (`catalog/document/<id>.bin`) convertiría el
cambio de bytes en una edición del catálogo e impediría deduplicar.

### 1.2 El manifiesto de la versión 3

```json
{
  "version": 3,
  "id": "6f1c2d4e-0b7a-4c55-9a51-3e2f8d7b9c10",
  "name": "Empresa Ejemplo",
  "processes": [
    { "id": "process-4k9w2m7q1z8c", "slug": "pedidos", "name": "Pedidos",
      "model": { "id": "Process_Pedidos", "name": "model.bpmn", "revision": 3 },
      "scenarioRevisions": { "as-is.scenario.json": 2 } },
    { "id": "process-p0x3n8d2r5ta", "slug": "facturacion", "name": "Facturación",
      "model": { "id": "Process_Facturacion", "name": "model.bpmn", "revision": 1 },
      "scenarioRevisions": {} }
  ],
  "engine": "1.0.0"
}
```

Es el manifiesto de la versión 2 (`RepositoryManifest` en `packages/engine/src/project/lila.ts`)
con dos añadidos: cada proceso tiene un **`id`**, su identidad estable (§ 3.2), y un `limits`
opcional (abajo). No se lista nada más:
los objetos de catálogo y los adjuntos se descubren listando sus carpetas, y el índice id → archivo
se deriva al abrir, como exige ADR-029. Poner el catálogo en el manifiesto haría que cada edición de
un objeto tocara el único archivo que también tocan todas las demás, que es justo el conflicto de
mezcla que un archivo por objeto quiere evitar.

**`limits` opcional.** Un repositorio puede cambiar para sí los límites de adjuntos de § 6:

```json
"limits": { "attachmentBytes": 52428800, "repositoryBytes": 524288000 }
```

- `attachmentBytes` es el adjunto más grande que se puede añadir; `repositoryBytes` es el total
  máximo de todas las entradas de adjuntos del repositorio. Los dos son opcionales; un miembro
  ausente, o la ausencia de `limits`, significa el valor por defecto: 20 MB (20.971.520 bytes) y
  200 MB (209.715.200 bytes).
- Cada miembro debe ser un entero positivo no mayor que 4.294.967.295, el mayor tamaño que cabe en
  un `.lila` (el escritor del archivo no tiene ZIP64). Un valor inválido
  se informa en `problems`, se aplica el valor por defecto y el valor se vuelve a escribir tal como
  se encontró hasta que alguien ponga uno válido; el manifiesto se sigue leyendo.
- La app lo cambia desde los ajustes del repositorio. Límites mayores son decisión del repositorio:
  hacen más lento guardar un `.lila` y más pesado el navegador, y los presupuestos de § 9 se miden
  con los valores por defecto.
- **Bajar un límite nunca quita nada.** Los adjuntos que ya están en el repositorio se quedan, y se
  abren y se guardan como antes en los dos contenedores; solo se rechaza añadir un adjunto nuevo que
  superaría un límite (`E-ADJUNTO`).

### 1.3 Qué versión se escribe

| El repositorio tiene | Se escribe como |
| --- | --- |
| Un proceso, nada que necesite la versión 3 | Versión 1, byte a byte como hoy (más las entradas desconocidas, que ahora se conservan, § 1.4) |
| Dos o más procesos, nada que necesite la versión 3 | Versión 2, como hoy (más las entradas desconocidas, que ahora se conservan, § 1.4) |
| Algún objeto de catálogo, adjunto o miembro `limits`, o alguna entrada bajo un nombre reservado de § 1.1 (`maps/`, `analysis/`, `dashboards/`, `records/`, `processes/<slug>/process.json`), **o se leyó como versión 3** | Versión 3 |

- **La versión 3 se escribe solo cuando hace falta, y después se queda.** A diferencia del paso de
  versión 2 a versión 1 de `docs/PROJECT_FORMAT.md` (#517), un repositorio leído como versión 3 se
  guarda como versión 3 aunque se borre su último objeto. Volver atrás perdería los ids de proceso a
  los que apuntan otras entradas (mapas futuros, registros, o archivos que conserva una versión más
  nueva) y dejaría que el slug de un proceso solitario volviera a cambiar: la sorpresa de
  `--process` que `PROJECT_FORMAT.md` documenta para la versión 2. La única vuelta atrás es una
  exportación explícita, que A1 no necesita ofrecer.
- **Al subir de versión se escriben los ids de proceso.** Un repositorio de versión 1 o 2 no tiene
  ids de proceso. Al abrirlo, cada proceso recibe uno nuevo en memoria (nada persistido puede
  apuntarle todavía) y el primer guardado en versión 3 lo escribe. Una *carpeta* de versión 1 mueve
  sus archivos de la raíz a `processes/<slug>/` en el mismo commit de todo o nada que usa hoy la
  versión 2 (#498).
- **El catálogo y los adjuntos se leen diga lo que diga el manifiesto.** Un repositorio de versión 1
  o 2 escrito por Lila nunca los tiene; si uno los tiene (añadidos a mano o por otra herramienta), se
  cargan y el siguiente guardado escribe la versión 3.

### 1.4 Lectores anteriores y entradas desconocidas

Las versiones anteriores de la app rechazan la versión 3 limpiamente, con una excepción más abajo;
no hay que tocarlas:

- Las que leen las versiones 1 y 2 (de 1.0.0-beta.15 hasta hoy) rechazan cualquier `version` mayor
  que 2: `decodeLila` mira el manifiesto antes de buscar un modelo y lanza `LILA-MANIFEST`
  («declares version 3; this reader understands versions 1 and 2»), y el lector de carpetas
  (`readRepositoryManifestOf` en `packages/engine/src/project-fs/projectIO.ts`) lanza
  `E-MANIFEST`. Nunca llegan a descartar el catálogo al guardar.
- Las que solo leen la versión 1 (hasta 1.0.0-beta.14) la rechazan igual que a la versión 2: no hay
  `model.bpmn` en la raíz (`LILA-NO-MODEL`, que el escritorio muestra como `E-NO-MODEL`;
  `E-SIN-MODELO` para una carpeta).
- La excepción: en las versiones de 1.0.0-beta.15 a beta.26, `isRepositoryProcessFolder`
  (`projectIO.ts`) se traga el `E-MANIFEST` de un padre de versión 3. Por eso abrir directamente la
  carpeta `processes/<slug>/` de un repositorio de versión 3 (o su `model.bpmn`) la lee como un
  proyecto de versión 1 independiente, y guardarla puede escribir un
  `processes/<slug>/lila-project.json` anidado. El repositorio en sí no se daña, pero las corridas de ese proceso no se marcan obsoletas; A1 informa ese
  `lila-project.json` anidado como entrada desconocida y lo conserva tal cual.

**Las entradas desconocidas se conservan; ya no se descartan.** Hoy una entrada del archivo fuera
de la disposición se informa y no se vuelve a escribir (`decodeLila`, `decodeRepository`), porque
sus bytes no podían viajar por `structuredClone` ni por el espejo de `localStorage`. Con este
contrato los bytes ya no viajan por ahí (§ 5), así que una versión que lo implemente, para **todas**
las versiones del formato:

- conserva byte a byte cada entrada segura que no interpreta y la vuelve a escribir sin cambios, en
  el archivo como en la carpeta (donde el escritor ya deja en paz los archivos ajenos);
- la informa en `problems` como «esta versión no la entiende; se conserva tal cual», **salvo** las
  entradas bajo los nombres reservados de § 1.1 y los archivos de catálogo de tipos desconocidos
  (§ 2.4), que son esperables y se conservan en silencio;
- descarta sin aviso la basura del sistema operativo: `__MACOSX/`, `.DS_Store`, `Thumbs.db`, y los
  restos del propio escritor `*.tmp-*`, `*.prev-*`, `*.lock`;
- sigue rechazando los nombres de entrada inseguros (`LILA-ENTRY-PATH`), como hoy;
- elimina las entradas de un proceso borrado en la sesión; las entradas bajo un `processes/<slug>/`
  que el manifiesto no lista son una carpeta huérfana, que se conserva y cuenta como slug ocupado,
  como ya pasa hoy en la carpeta (`occupiedSlugs`).

Esto es lo que permite a fases posteriores añadir `maps/` o `process.json` **sin una versión
nueva**: un lector de la versión 3 que no los entiende los conserva. Un añadido posterior toma una
`version` nueva solo si un lector anterior que edita a su alrededor lo corrompería: la regla de
`PROJECT_FORMAT.md` § Versiones («lo que haría que un lector malinterpretara un archivo toma una
versión nueva») no cambia. Todo lo que escriba una fase posterior debe forzar la versión 3, para que
ningún lector que lo descarte pueda abrir el archivo: las versiones de 1.0.0-beta.15 a beta.26
descartan las entradas desconocidas al guardar un `.lila` (`decodeLila`, `decodeRepository`).

### 1.5 Orden canónico

Las entradas se escriben así: manifiesto, procesos (como hoy), objetos de catálogo ordenados por
tipo y luego por id, adjuntos ordenados por nombre, entradas conservadas ordenadas por nombre, con
la marca de tiempo fija de `encodeLila`. Los adjuntos se guardan sin comprimir (nivel 0): suelen
venir comprimidos ya, y una entrada sin comprimir se copia barato en cada guardado. Dos guardados del
mismo repositorio siguen dando bytes idénticos.

## 2. Objetos de catálogo

### 2.1 Sobre común

Cada objeto es un archivo JSON `catalog/<tipo>/<id>.json`, con sangría de dos espacios y salto de
línea final, como los escenarios:

| Campo | Tipo | Obligatorio | Significado |
| --- | --- | --- | --- |
| `type` | texto | sí | El tipo; debe coincidir con la carpeta `<tipo>`. |
| `id` | texto | sí | La identidad (§ 2.3); debe coincidir con el nombre del archivo sin `.json`. |
| `name` | texto | sí | Lo que muestra la UI. No vacío tras recortar espacios. No es clave ni único. |
| `description` | texto | no | Texto plano. |
| `revision` | entero ≥ 1 | sí | 1 al crearlo, +1 en cada escritura que cambia el contenido (§ 5.4). |
| `attributes` | lista de `{ "name": texto, "value": texto }` | no | Atributos extendidos libres, en orden. |
| *campos del tipo* | — | no | § 2.2. |

- **Los escritores conservan los campos que no conocen**, en su orden original detrás de los
  conocidos, para que lo que añade una versión más nueva sobreviva a la edición de una anterior. Los
  campos conocidos van primero, en el orden de las tablas.
- **Sin marcas de tiempo ni responsable en el sobre.** `createdAt`, `updatedAt` y `createdBy` quedan
  reservados para el modo servidor (fase 7), donde hay un historial autenticado; en local, git y el
  sistema de archivos ya dicen cuándo cambió un archivo, y una marca escrita en cada edición haría
  que dos ediciones idénticas dieran bytes distintos. El responsable es un campo del tipo donde
  tiene sentido.
- **Los atributos extendidos tipados llegan después.** El `lila:attributeDefinition` del BPMN
  (`docs/BPMN_EXTENSION.md`, #509) define atributos por tipo de elemento dentro de un modelo; un
  registro de tipos, atributos y relaciones para todo el repositorio es un contrato de la fase 6.
  Hasta entonces, `attributes` son pares de texto que el explorador muestra y edita tal cual.

### 2.2 Tipos del lote A1

| Tipo | Campos propios | Notas |
| --- | --- | --- |
| `role` | `unitRef?`: id de unidad | Un responsable en RACI (`lila:responsibility roleRef`). Nunca crea capacidad de simulación: enlazar un rol con un recurso de simulación es una relación posterior y explícita. |
| `unit` | `parentRef?`: id de unidad | Unidad organizativa. La jerarquía es `parentRef`; un ciclo se informa y se muestra cortado en la unidad repetida. |
| `system` | `ownerRef?`: id de rol; `url?`: URL `http`/`https` | Aplicación o sistema (`lila:systemRef`). La URL se muestra como enlace y nunca se descarga. |
| `document` | `ownerRef?`: id de rol; `url?`; `attachment?`: § 6 | Documento o dato (`lila:documentRef`, `lila:input`, `lila:output`). |

El responsable apunta a un rol, no a una persona ni a una unidad: una responsabilidad la tiene un
rol, y la unidad del rol da el departamento. Personas y puestos llegan después. Los campos de
control documental (código, versión, estado) esperan a la gobernanza de la fase 7 (§ 2.5, § 10).

Ejemplos (datos sintéticos, [política de ejemplos](EXAMPLES_POLICY.md)):

```json
{
  "type": "role",
  "id": "role-7k2m9q4x1pzd",
  "name": "Analista de crédito",
  "description": "Revisa las solicitudes contra la política de préstamos.",
  "revision": 2,
  "unitRef": "unit-b3r8w1c6k0qe"
}
```

```json
{
  "type": "document",
  "id": "document-x9d2k7m4q1wa",
  "name": "Formulario de solicitud de crédito",
  "revision": 1,
  "ownerRef": "role-7k2m9q4x1pzd",
  "attributes": [{ "name": "Conservación", "value": "5 años" }],
  "attachment": {
    "file": "attachments/9b74c9897bac770ffc029102a200c5de1b8b2c3a4f5e6d7c8b9a0f1e2d3c4b5a.pdf",
    "name": "Formulario de solicitud.pdf",
    "mediaType": "application/pdf",
    "size": 48213,
    "sha256": "9b74c9897bac770ffc029102a200c5de1b8b2c3a4f5e6d7c8b9a0f1e2d3c4b5a"
  }
}
```

### 2.3 Identidad de los objetos

- **Gramática:** `^[a-z0-9][a-z0-9-]{0,63}$`, la de los slugs de proceso de `isProcessSlug`
  (`packages/engine/src/project/repository.ts`). Solo minúsculas, porque los sistemas de archivos de
  macOS y Windows no distinguen mayúsculas por defecto y el id es un nombre de archivo; por
  construcción es un nombre de entrada ZIP seguro.
- **Ids generados:** `<tipo>-<12 caracteres de [0-9a-z]>`, con `crypto.getRandomValues` (existe en
  el navegador y en Node). 62 bits hacen despreciable una colisión accidental entre dos
  repositorios, que es lo que mantiene simples las importaciones (§ 3.5). El prefijo hace legible un
  id suelto en el XML BPMN y en los diffs. No se reutilizan los generadores de hoy: el `newId` de
  BPMN es un contador determinista (`Task_2`), correcto dentro de un modelo pero que colisiona entre
  repositorios, y el `Attr_<7 al azar>` de `apps/web/src/AtributosExtendidos.tsx` es demasiado corto
  para un espacio de nombres de todo el repositorio.
- **Ids adoptados:** una referencia escrita a mano antes de que existiera el catálogo (`rol-1`,
  `sys-crm` en `docs/BPMN_EXTENSION.md`) puede convertirse en un objeto con ese mismo id cuando
  cumple la gramática y no es un nombre reservado de Windows (`con`, `nul`, `com1`…, que
  `processSlug` ya evita). Así no se reescribe ningún BPMN. Un valor que no la cumple
  (`Analista Crédito`) recibe un id generado, y todas sus referencias en todos los procesos se
  reescriben en el mismo comando deshacible.
- **Nunca se deriva del nombre ni cambia.** Renombrar cambia solo `name`. Dos objetos pueden
  compartir nombre; la UI avisa cuando un nombre nuevo repite el de otro del mismo tipo, y nada más.
- **Único en todo el catálogo**, no solo dentro de un tipo, para que una referencia nunca necesite el
  tipo para ser inequívoca. Los escritores nunca crean un duplicado. Un lector que encuentra el mismo
  id en dos tipos (una edición a mano, una mezcla) carga los dos, lo informa, y resuelve cada
  referencia tipada contra el tipo que esa referencia espera.

### 2.4 Reglas de lectura

- Solo es un objeto `catalog/<tipo>/<nombre>.json` a un nivel de profundidad; `<tipo>` cumple
  `^[a-z][a-z0-9-]{0,31}$`. Los restos `.tmp-*`/`.prev-*` no terminan en `.json` y nunca se leen
  como objetos.
- Un archivo que no es JSON, al que le falta un campo obligatorio, o cuyo `type`/`id` no coincide
  con su ruta se **excluye y se explica** en `problems` y se **conserva byte a byte**: nunca se
  reescribe ni lo borra un guardado. A diferencia de un escenario roto en un archivo `.lila` hoy, un
  objeto roto no se descarta: otros objetos pueden apuntarle, y arreglar un archivo a mano no debe
  costar perderlo.
- **Los objetos de tipos que esta versión no conoce** (`risk`, `control`, `kpi`…) se cargan solo con
  el sobre y en solo lectura: aparecen en el explorador y resuelven referencias (`lila:riskRef`), y
  sus archivos se conservan intactos.

### 2.5 Tipos reservados

Listados para que A1 no ocupe sus nombres; sus campos son de contratos posteriores: `position`,
`person`, `risk`, `control`, `control-objective`, `requirement`, `kpi`, `product`, `partner`,
`resource`, `cost-centre`, `goal`, `initiative`. Campos reservados de `document`, para el control
documental de la fase 7: `code`, `version`, `status`; los escritores de A1 no los crean y los
conservan como cualquier campo desconocido.

## 3. Referencias

### 3.1 Del BPMN al catálogo

La extensión BPMN no cambia. Los atributos que existen hoy (`packages/engine/src/bpmn/annotate.ts`,
`REF_KINDS` y `Responsibility`) guardan un **id de catálogo**:

| BPMN | Tipo esperado |
| --- | --- |
| `lila:responsibility type="R\|A\|C\|I" roleRef` | `role` |
| `lila:systemRef ref` | `system` |
| `lila:documentRef ref`, `lila:input ref`, `lila:output ref` | `document` |
| `lila:riskRef ref`, `lila:controlRef ref`, `lila:kpiRef ref` | `risk`, `control`, `kpi` (reservados) |

El BPMN nunca guarda el nombre de un objeto de catálogo ni ninguna otra copia de sus campos. El
documento del proceso (Word/HTML) y todas las vistas resuelven los nombres al pintar. Hoy el panel
de propiedades (`apps/web/src/PropertiesPanel.tsx`) recibe estos ids como texto escrito a mano; A1
sustituye el campo de texto por un selector que escribe el mismo atributo.

Los campos del catálogo que apuntan a otros objetos (`unitRef`, `parentRef`, `ownerRef`) guardan un
id suelto del tipo que el campo espera, con las mismas reglas.

### 3.2 Identidad del proceso

La identidad estable de un proceso es el `processes[].id` del manifiesto (§ 1.2), generado como
`process-<12 caracteres de [0-9a-z]>`. No es ninguna de las dos claves que existen hoy:

- **No es el slug.** El slug es un nombre de carpeta, y las rutas nunca son claves (ADR-029). Ya
  cambia en un caso documentado (un proceso solitario de versión 2 guardado como versión 1), y un
  proceso importado debe tomar otro slug cuando el suyo está ocupado.
- **No es el id del proceso BPMN** (`model.id`). El usuario puede editarlo (ids tras «Avanzado»,
  #447), y los modelos importados coinciden en él (`Process_1`). Los modelos nuevos reciben uno al
  azar (`newModelXml` en `apps/web/src/project.ts`), pero nada garantiza que sea único en un
  repositorio.

Esto precisa ADR-012 sin sustituirla. La clave de ADR-012, `bpmn:process@id` más
`lila:versionTag` (`docs/BPMN_EXTENSION.md` § 3), es la identidad **lógica** de un proceso de
negocio entre herramientas, archivos y versiones, y la propia ADR-012 espera que dos versiones de un
proceso compartan `process@id`. Justo por eso no sirve para señalar un modelo guardado dentro de un
repositorio, donde las dos versiones pueden convivir (fase 7). El id de proceso es la identidad de
**almacenamiento** de un modelo en un repositorio; la clave lógica sigue siendo la que usan el
intercambio, las importaciones y el futuro contexto de versión (§ 3.3).

Una actividad de llamada sigue nombrando su destino por el id del proceso BPMN en `calledElement`,
el atributo estándar. Hoy (#461) gana el primer otro proceso que declara ese id (`findIndex` en
`apps/web/src/App.tsx`); A1 lo cambia: dos procesos que declaran el mismo id de proceso BPMN se
informan como ambigüedad, sin resolverlos a ciegas.

### 3.3 Referencias a un elemento de otro modelo

Donde un documento del repositorio apunte a un elemento de un proceso (un nodo de mapa, un riesgo
sobre una actividad, un registro: todo de fases posteriores), escribe:

```json
{ "process": "process-4k9w2m7q1z8c", "element": "Task_7f3k2q1" }
```

`process` es el id del proceso; `element` es el id del elemento BPMN, que BPMN ya nunca regenera
(`docs/BPMN_EXTENSION.md` § 3). Una referencia al proceso mismo omite `element`. Ids de elemento
iguales en dos procesos nunca se mezclan, porque la clave es el par. Queda reservado un miembro
`version` para la identidad de las liberaciones (fase 7); sin él, la referencia es a la versión de
trabajo. Nunca se escriben nombres ni rutas en una referencia.

### 3.4 Referencias sin resolver, renombrar, borrar

- **Las referencias sin resolver se conservan y se muestran; nunca se inventan.** Una referencia
  cuyo id no coincide con ningún objeto se queda en el archivo tal cual. La UI la muestra como sin
  resolver, con el id, y ofrece crear un objeto para ella (adoptando el id según § 2.3), solo cuando
  el usuario lo pide. El lint la informa como aviso (como promete `docs/BPMN_EXTENSION.md`), y solo
  en un repositorio con catálogo: un proyecto de versión 1 o 2 no tiene contra qué comprobar, y sus
  ids escritos a mano se muestran sin avisos.
- **Renombrar** escribe un archivo, el del objeto. Nada más cambia, porque nada más guarda el nombre.
- **Borrar un objeto en uso se rechaza** con la lista de sus usos (§ 4), y se ofrecen dos
  alternativas explícitas: *sustituir por* otro objeto del mismo tipo (se reescriben todas las
  referencias y después se borra) o *quitar las referencias y borrar*. Cada una es un solo comando
  deshacible sobre todos los procesos y objetos afectados. La app nunca deja referencias sin resolver
  a propósito. Los agentes tienen la misma regla (§ 8): el borrado falla con `E-OBJETO-EN-USO` salvo
  que se pida `replaceWith` o `removeReferences`.
- Los usos dentro de entradas que esta versión conserva pero no entiende (los `maps/` de una versión
  más nueva) no son visibles para ella. Borrar un objeto así deja esas referencias sin resolver, y la
  versión que las entiende las muestra como tales. Se acepta: la alternativa es rechazar todo
  borrado.

### 3.5 Importar

- **Un archivo BPMN** importado como proceso conserva sus referencias `lila:` tal cual; se resuelven
  contra el catálogo de este repositorio o aparecen sin resolver. No se crea nada automáticamente.
- **Un proceso o un repositorio de otro repositorio**: cada proceso importado recibe un id de proceso
  nuevo (siempre, para que la copia de una copia nunca colisione) y un slug libre (`processSlug`).
  Los ids de sus elementos BPMN no se tocan. Los objetos de catálogo a los que apunta vienen con él:
  - mismo id, mismo tipo, contenido idéntico: un solo objeto;
  - mismo id con contenido distinto: un conflicto que el usuario resuelve objeto por objeto,
    *conservar el objeto de este repositorio* (las referencias entrantes apuntan a él) o *importarlo
    como objeto nuevo* (id nuevo, referencias entrantes reescritas);
  - los objetos **nunca se emparejan por nombre**. Un diálogo de importación puede sugerir
    coincidencias de nombre; solo el usuario convierte una sugerencia en una sustitución.

## 4. El índice de usos («dónde se usa»)

El índice es **derivado y nunca se persiste** en el repositorio: una copia persistida quedaría
desfasada con cada mezcla de git o edición a mano, y reconstruirlo es lo bastante barato (§ 9).

Asocia cada `(tipo, id)` con sus usos, en el orden de los procesos y luego del documento:

- `{ "process": <id de proceso>, "element": <id BPMN>, "relation": "responsibility:R" | "systemRef"
  | "documentRef" | "input" | "output" | "riskRef" | "controlRef" | "kpiRef" }`;
- `{ "object": <tipo>/<id>, "field": "unitRef" | "parentRef" | "ownerRef" }`.

También lista todas las referencias sin resolver (misma forma, más el id que falta) y los ids de
proceso BPMN que declara más de un proceso.

Se construye después de abrir, en segundo plano (un worker en la app web), a partir del modelo de
cada proceso y del catálogo, con una función pura del motor, para que la app, la CLI y el servidor
MCP respondan «dónde se usa» igual. Editar un proceso vuelve a recorrer solo ese proceso; editar un
objeto, solo ese objeto. Hasta que termina la primera construcción, los recuentos de uso se muestran
como pendientes, nunca como cero. Si no se cumple el presupuesto de § 9, la alternativa es una caché
**fuera** del repositorio (la carpeta de datos de la app, con el hash del contenido de cada modelo
como clave), nunca un archivo dentro de él.

## 5. Almacenamiento y revisiones

### 5.1 Qué se carga y cuándo

| Parte | Se carga | Obligatorio en A1 |
| --- | --- | --- |
| Manifiesto, lista de procesos | Al abrir | Sí |
| Objetos de catálogo (todos los tipos, completos) | Al abrir: son pequeños, y los selectores y la búsqueda los necesitan todos | Sí |
| Modelo y escenarios de un proceso | Al abrir su pestaña; el índice de usos lee además en segundo plano los modelos de todos | Puede seguir siendo al abrir hasta que falle el presupuesto de § 9 |
| Corridas guardadas | Listadas por resumen (id, escenario, revisiones) al abrir el proceso; el `RunResult`, al mostrarlo | Antes de la aceptación de rendimiento |
| Bytes de los adjuntos | Solo al abrirlos, exportarlos o copiarlos a otro contenedor | Sí |
| Entradas desconocidas conservadas | Nunca se interpretan; sus bytes se quedan donde está el contenedor (§ 5.3) | Sí |

A1 puede mantener el IPC de documento completo y el autoguardado del repositorio entero sin los bytes
de los adjuntos (preparados y nombrados por hash); el IPC por objeto y la recuperación por conjunto
de cambios se adoptan solo cuando fallan los presupuestos de § 9, como esta tabla ya permite para
los modelos. Lo que A1 no debe hacer es poner bytes de adjuntos ni entradas conservadas en el
documento que cruza el IPC o llega al almacenamiento del navegador.

### 5.2 Esbozo de la interfaz

Es un esbozo para que A1 lo implemente, no código que exista. Sustituye al `ProjectStore` de seis
métodos de `apps/web/src/store/ProjectStore.ts` y, en `ProjectSessionStore`, a `openProject`/
`saveProject`/`createProject`/`openRecent`/`openHandle`/`reload` (que devuelven una cabecera en vez
de un `ProjectDocument`) y al `restoreSession` síncrono (asíncrono, leído de IndexedDB); `setDirty`,
`listRecents`, `onExternalChange`, `forget`, `importBpmn`, `occupiedSlugs`, `undoOpen` y
`onSaveRequested` se quedan.

```ts
type CatalogType = string; // 'role' | 'unit' | 'system' | 'document' | un tipo que esta versión no conoce

interface CatalogObject {
  readonly type: CatalogType;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly revision: number;
  readonly attributes?: readonly { readonly name: string; readonly value: string }[];
  readonly [field: string]: unknown; // campos del tipo y campos que esta versión no conoce
}

interface ProcessHead {
  readonly id: string;     // id de proceso (§ 3.2)
  readonly slug: string;
  readonly name: string;
  readonly modelId: string;
  readonly modelRevision: number;
}

interface RepositoryHead {
  readonly version: 1 | 2 | 3;              // tal como se leyó
  readonly id: string;
  readonly name: string;
  readonly processes: readonly ProcessHead[];
  readonly objects: readonly CatalogObject[];
  readonly problems: readonly ProjectProblem[];
}

interface RunSummary {
  readonly id: string;
  readonly scenarioName: string;
  readonly modelRevision: number;
  readonly scenarioRevision: number;
}

interface LoadedProcess {
  readonly model: ProjectModel;                 // packages/engine/src/project/types.ts
  readonly scenarios: Readonly<Record<string, ScenarioDocument>>;
  readonly scenarioRevisions: Readonly<Record<string, number>>;
  readonly runs: readonly RunSummary[];
}

/** Un guardado: solo lo que cambió. `null` borra. */
interface ChangeSet {
  readonly name?: string;
  readonly processes?: readonly ProcessHead[];  // la lista y el orden nuevos, si cambiaron
  readonly models?: Readonly<Record<string, { readonly xml: string; readonly baseRevision: number }>>;
  readonly scenarios?: Readonly<Record<string, Readonly<Record<string, ScenarioDocument | null>>>>;
  readonly runs?: Readonly<Record<string, readonly StoredRun[]>>;          // solo corridas nuevas
  readonly objects?: readonly {
    readonly type: CatalogType;
    readonly id: string;
    readonly object: CatalogObject | null;
    readonly baseRevision: number | null;     // null: el objeto es nuevo
  }[];
  readonly attachments?: readonly string[];   // sha256 preparados que este guardado hace permanentes
}

interface RepositoryStore {
  open(options?: { readonly fileOnly?: boolean }): Promise<RepositoryHead | null>; // null: cancelado
  readProcess(processId: string): Promise<LoadedProcess>;
  readRun(processId: string, runId: string): Promise<StoredRun>;
  readAttachment(sha256: string): Promise<Uint8Array>;    // verificado contra su hash (§ 6)
  stageAttachment(source: AttachmentSource): Promise<AttachmentRef>; // § 6; bytes guardados hasta commit o descarte
  commit(changes: ChangeSet, options?: { readonly saveAs?: boolean; readonly asFolder?: boolean; readonly overwrite?: boolean }):
    Promise<RepositoryHead | null>;
}
```

`commit` es el Guardar explícito que la app tiene hoy (la marca de cambios sin guardar, ⌘S, la
guardia de cierre); no es una escritura directa en cada pulsación. Escribe solo las entradas que toca
el conjunto de cambios, y decide la versión (§ 1.3). Las revisiones de modelos y escenarios funcionan
como hoy (`model.revision` y `scenarioRevisions` en el manifiesto, que las corridas usan para saber
si sus resultados están desfasados); las revisiones de los objetos viven en el archivo del objeto
(§ 2.1).

### 5.3 Cómo lo cumple cada adaptador

- **Carpeta** (proceso principal del escritorio, `packages/engine/src/project-fs/projectIO.ts`).
  `open` lee el manifiesto y lista `catalog/`; todo lo demás se lee a demanda. `commit` escribe solo
  los archivos tocados, con el `commitWithRollback` que ya existe (§ 7). Los archivos no tocados,
  incluidos los conservados y los ajenos, ni se abren.
- **Archivo** (`.lila`: proceso principal del escritorio, la CLI y el MCP a través de
  `lilaFile.ts`/`input.ts`; el navegador para su propia copia). `open` lee el directorio del ZIP e
  infla el manifiesto y el catálogo; las demás entradas se inflan a demanda (`unzipSync` de `fflate`
  acepta un filtro). Quien tiene el archivo abierto conserva sus bytes, así que `commit` construye el
  archivo nuevo con las entradas cambiadas más cada entrada no tocada con su contenido conservado
  byte a byte (los adjuntos van sin comprimir, así que no se recomprimen), bajo el `.lila.lock` que ya existe. El códec del motor adopta esta forma: el
  documento que decodifica ya no descarta lo que no interpreta; guarda los bytes de esas entradas
  junto al documento, nunca dentro, y `encodeLila` los vuelve a escribir. Hoy `writeLilaScenario` y
  todas las escrituras de los agentes recodifican el documento entero; con este cambio llevan el
  catálogo, los adjuntos y las entradas conservadas sin cambios y sin saber que existen.
- **IPC del escritorio** (`apps/desktop/src/bridge.ts`, `main.ts`). El proceso principal guarda el
  contenedor abierto (ruta, instantáneas y, para un archivo, sus bytes). En el diseño de destino el
  renderer pide la cabecera, un proceso, una corrida o un adjunto, y envía conjuntos de cambios, así
  que el repositorio entero nunca cruza el IPC; A1 todavía puede enviar el documento entero en los
  dos sentidos, sin bytes de adjuntos ni entradas conservadas (§ 5.1). Cada manejador conserva las guardias de hoy (`isTrustedSender` en
  `ipcGuards.ts`, la ruta autorizada), y los argumentos son identidades de la disposición (ids de
  proceso, `<tipo>/<id>`, sha256) validadas contra su gramática, nunca rutas libres. Un adjunto
  añadido desde disco lo lee el proceso principal desde la ruta que devolvió el diálogo nativo
  (`stageAttachment`), así que sus bytes no cruzan el IPC al entrar.
- **Navegador** (`apps/web/src/store/BrowserStore.ts`). El espejo de `localStorage`
  (`lila.project.v1`, unos 5 MB, solo texto) no puede guardar un catálogo con adjuntos. Lo sustituye
  una base de datos IndexedDB con la copia de trabajo como entradas cuya clave es su ruta en la
  disposición (IndexedDB guarda `Uint8Array`/`Blob` de forma nativa, y también un
  `FileSystemFileHandle`, así que Guardar puede seguir escribiendo sobre el archivo abierto, #573).
  Cada conjunto de cambios es una transacción de IndexedDB, que es atómica. La clave antigua se lee
  una vez en el primer arranque de la versión nueva, se migra y se borra. Guardar escribe el `.lila`
  con `createWritable` (Chromium escribe en un archivo temporal y lo intercambia en `close()`) o lo
  descarga, como hoy.
- **Servidor** (`RemoteStore`, fase 7): las mismas entradas como filas; no se especifica aquí.

### 5.4 Revisiones y conflictos

- La `revision` de un objeto sube en uno en cada commit que cambia su contenido. Un commit cuyo
  objeto es idéntico al guardado no escribe nada y conserva la revisión, como un `patch_scenario`
  sin efecto hoy (#627).
- **Quien llama al almacén pasa `baseRevision`**: la revisión que leyó, o `null` para un objeto
  nuevo. Un commit cuya base ya no coincide se rechaza con `E-REVISION` y no escribe nada. Es la
  comprobación que necesitan los agentes y el futuro servidor; la app la tiene gratis.
- **En disco, la detección de conflictos se queda donde está hoy** y solo se afina donde el
  contenedor lo permite:
  - Carpeta: por archivo. La instantánea que ya existe de cada archivo que Lila leyó o escribió
    (`rememberSnapshot`, `assertPathsUnchanged`: mtime y tamaño) se comprueba para los archivos que
    escribe el conjunto de cambios, así que la edición de un objeto por un agente no bloquea el
    guardado de otro por la app. Un archivo tocado que cambió rechaza el guardado con
    `E-CAMBIO-EXTERNO`, como hoy.
  - Archivo `.lila`: el archivo entero, como hoy (`writeLilaFile`: instantánea comprobada dentro del
    candado). Mezclar en un mismo archivo ediciones externas disjuntas es posible con bases por
    entrada y se deja para cuando haga falta.
- Los cambios externos siguen su camino actual (#539): `projectWatcher.ts` detecta un cambio que
  Lila no escribió (`isOwnSnapshot`) y la app ofrece recargar. En una carpeta, el vigilante debe
  contar también `catalog/` y `attachments/` como archivos del proyecto (`relevantProjectFile`).

## 6. Adjuntos

- **Qué:** los bytes de un objeto `document`. Un documento tiene como mucho un adjunto; un documento
  sin adjunto es solo metadatos (o una `url`). Los demás tipos no llevan archivos en A1.
- **Dónde:** `attachments/<sha256>` más la extensión en minúsculas del nombre original cuando cumple
  `^[a-z0-9]{1,10}$`, p. ej. `attachments/9b74…4b5a.pdf`. La extensión solo está para que quien usa
  la carpeta pueda abrir el archivo; la identidad es el hash.
- **Metadatos** en el campo `attachment` del documento: `file` (la ruta de la entrada), `name` (el
  nombre original, que se muestra y se usa al abrir o exportar el archivo), `mediaType` (por la
  extensión al añadirlo, nunca adivinado por el contenido), `size` (bytes) y `sha256` (hexadecimal en
  minúsculas). `file` debe ser la ruta que se deriva de `sha256` y `name`; si no, el documento se
  informa y su adjunto se trata como ausente.
- **Inmutable y compartido.** Un adjunto nunca se reescribe: cambiar el archivo de un documento
  escribe una entrada nueva y apunta el documento a ella. Dos documentos con los mismos bytes
  comparten una entrada. Un guardado elimina una entrada que dejó sin referencias en esa sesión; una
  entrada sin referencias encontrada al abrir (una mezcla, una edición a mano) se informa y se
  conserva.
- **Integridad:** el hash se calcula al añadir el archivo y se verifica siempre que se leen los bytes
  (abrir, exportar, copiar a otro contenedor). Una discrepancia se informa (`problems`), la entrada se
  conserva tal cual y la app se niega a abrirla. Una entrada ausente se muestra como «no incluido en
  esta copia», que es un estado normal (ver compartir, abajo), no una corrupción.
- **Límites (decisión del dueño, § 10):** por defecto 20 MB por adjunto y 200 MB de adjuntos por
  repositorio, en la carpeta y en el archivo por igual, configurables por repositorio en el `limits`
  del manifiesto (§ 1.2). Un adjunto por encima de un límite se rechaza al añadirlo (`E-ADJUNTO`).
  Un repositorio por encima de sus límites (un límite bajado después, una mezcla, una edición a mano)
  se abre y se guarda con normalidad en los dos contenedores: los límites rechazan adjuntos nuevos y
  nunca borran ni descartan los que ya hay.
- **Tipos (decisión del dueño, § 10):** solo esta lista permitida de formatos de documento e imagen;
  cualquier otra extensión, o ninguna, se rechaza al añadirla (`E-ADJUNTO`). La lista es de la
  versión de la app, no del repositorio. Los formatos antiguos de Office (`doc`, `xls`, `ppt`) quedan
  fuera porque pueden llevar macros; añadirlos después cambia la lista, no el formato.

  | Extensiones | `mediaType` |
  | --- | --- |
  | `pdf` | `application/pdf` |
  | `docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
  | `xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
  | `pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` |
  | `odt`, `ods`, `odp` | `application/vnd.oasis.opendocument.text`, `…spreadsheet`, `…presentation` |
  | `txt`, `md`, `csv` | `text/plain`, `text/markdown`, `text/csv` |
  | `png`, `jpg`/`jpeg`, `gif`, `webp` | `image/png`, `image/jpeg`, `image/gif`, `image/webp` |
  | `svg` | `image/svg+xml` |

  La app nunca ejecuta un adjunto: lo abre con el sistema operativo solo si su extensión está en la
  lista, solo previsualiza `png`, `jpg`/`jpeg`, `gif` y `webp`, y trata `svg` como archivo opaco (un
  SVG puede llevar código). Un adjunto que ya está en un repositorio con una extensión fuera de la
  lista (una edición a mano, una versión más nueva) se conserva y se lista, y se puede exportar, pero
  no se abre.
- **Antes de Guardar:** un adjunto preparado vive fuera del repositorio (el escritorio lo copia a la
  carpeta de datos de la app al añadirlo, el navegador lo guarda en IndexedDB), así que un cierre
  inesperado antes de Guardar no lo pierde y el archivo original puede moverse entretanto. Un commit
  con éxito o un descarte borran la copia preparada.
- **Ida y vuelta:** carpeta ↔ archivo es la misma ruta y los mismos bytes; `unzip` y `zip -r` siguen
  funcionando (§ 1.5). Copiar entre contenedores verifica cada hash.
- **Compartir (decisión del dueño, § 10):** una copia compartida incluye los adjuntos por defecto.
  Las corridas siguen siendo opcionales (ADR-029). El usuario puede dejar fuera explícitamente los
  bytes de los adjuntos; entonces los documentos conservan sus metadatos y muestran el archivo como no
  incluido. Los adjuntos nunca se quedan fuera en silencio.

## 7. Recuperación ante fallos

- **Carpeta.** `commitWithRollback` (`projectIO.ts`) ya escribe archivos temporales, aparta cada
  destino a `.prev-*`, mueve los nuevos a su sitio, deshace en orden inverso si algo falla, y deja
  `lila-recovery.json` con `E-RECUPERACION-PENDIENTE` cuando falla hasta el deshacer. Un commit de la
  versión 3 lo usa sin cambios, en este orden: primero los adjuntos nuevos (nombres nuevos, nunca
  pisan nada, así que un cierre inesperado deja como mucho un adjunto sin referencias), después los
  objetos y los archivos de procesos, luego el manifiesto, y las retiradas al final: el orden que ya
  usa el guardado de la versión 2 (QA de #511), así que un cierre inesperado deja el manifiesto
  antiguo apuntando a archivos que todavía existen. Los lectores ignoran `*.tmp-*` y `*.prev-*`.
- **Archivo `.lila`.** `writeLilaFile` escribe un archivo temporal junto al destino y lo renombra
  encima del antiguo dentro del `.lila.lock` (`withLilaLock`): el archivo en disco es siempre el
  antiguo o el nuevo. No cambia nada.
- **Navegador.** Una transacción de IndexedDB por conjunto de cambios; el `.lila` en disco, con el
  intercambio de `createWritable` al cerrar, o una descarga.
- **Autoguardado y recuperación (escritorio, #459).** Hoy el renderer codifica el proyecto entero
  como `.lila` y envía sus bytes a `lila:writeRecovery`, que escribe `userData/recovery.lila` de forma
  atómica (`apps/desktop/src/recovery.ts`). **A1 lo mantiene**, sin los bytes de los adjuntos ni las
  entradas conservadas: la copia nombra los adjuntos por hash, los preparados se quedan en la carpeta
  de preparación (§ 6), y al restaurar el proceso principal toma los bytes de los adjuntos y las
  entradas conservadas de la carpeta de preparación y del origen. Si el origen ya no está, un adjunto
  que solo tenía él se muestra como no incluido. La regla de un solo archivo se mantiene: que exista
  la copia es la señal, y se borra cuando el documento deja de tener cambios sin guardar. Un
  `recovery.lila` que quede de una versión anterior es un proyecto completo y se restaura como hoy.
- **Diseño de reserva, solo si falla el presupuesto de autoguardado de § 9:** la copia pasa a ser
  **el conjunto de cambios pendiente**. El renderer envía el mismo `ChangeSet` que confirmaría, y el
  proceso principal escribe `userData/recovery-changes.zip` con una marca `autosave.json`
  (`{ "version": 1, "source": <ruta o null>, "container": "folder" | "lila", "base": <la instantánea
  del origen al leerlo>, "deleted": [<rutas>] }`) y las entradas cambiadas en sus rutas de la
  disposición. No reutiliza `lila-recovery.json`, que ya significa un deshacer fallido
  (`E-RECUPERACION-PENDIENTE`), ni `recovery.lila`; las versiones anteriores nunca lo leen.
  - **Restaurar** vuelve a abrir el origen y aplica el conjunto de cambios, y el repositorio se abre
    con cambios sin guardar. Si el origen ya no está o cambió bajo una entrada tocada, el conjunto de
    cambios se aplica a lo que haya ahora y el resultado se abre como repositorio nuevo sin guardar,
    que hay que guardar con «Guardar como»: el trabajo del usuario nunca se tira ni se mezcla en
    silencio con un archivo que siguió su camino.
  - Un repositorio que nunca se guardó no tiene origen: su conjunto de cambios es el repositorio
    entero, así que se restaura por sí solo.
- **Recuperación en el navegador.** La copia de trabajo de IndexedDB es la recuperación: se escribe en cada cambio.

## 8. Compatibilidad

- **Las versiones 1 y 2 se abren sin cambios**, carpeta y archivo, y abrir y guardar sin cambios
  sigue devolviendo los mismos bytes (más, ahora, las entradas desconocidas que antes se descartaban,
  § 1.4). Solo se reescriben como versión 3 cuando algo de lo que lista § 1.3 lo necesita.
- **El motor, la CLI y el servidor MCP siguen funcionando sobre un repositorio de versión 3.** Lo
  leen y lo escriben con el mismo códec (`decodeLila`/`encodeLila`, `openLilaProcess`,
  `writeLilaProject` en `packages/engine/src/project-fs/input.ts`). Toda herramienta que no sabe del
  catálogo (`patch_scenario`, `run_simulation` con `saveRun`, `create_process`, `edit_process`,
  `annotate_element`, `import_scenario_sheet`) debe dejar los objetos de catálogo, los adjuntos y las
  entradas conservadas byte a byte. `annotate_element` sigue escribiendo los ids tal como se los dan:
  no los comprueba contra el catálogo, y un id que no coincide con ningún objeto es una referencia sin
  resolver como cualquier otra. `get_project` informa `formatVersion: 3`. La aceptación de A1 incluye
  una ida y vuelta de un repositorio de versión 3 de prueba por cada herramienta MCP y cada
  comando de la CLI que escribe, incluidos el renombrado y el borrado de procesos que añade el Lote R
  (#634, MCP y CLI), comparando cada entrada no tocada.
- **`--process` / `process`** siguen tomando el slug. Como la versión 3 nunca vuelve a la 1, el slug
  de un proceso solitario ya no cambia bajo los pies de un agente. Las herramientas que toman un
  proceso podrán aceptar también el id de proceso más adelante; A1 no lo necesita.
- **Los motores anteriores a este contrato** rechazan un `.lila` de versión 3 con su mensaje
  `LILA-MANIFEST` (§ 1.4); un agente ve un error claro, nunca una escritura con pérdidas.
  `@lila-modeler/mcp` fija la versión del motor (ADR-030), así que los dos se actualizan juntos.
- **Las herramientas de catálogo para agentes** (listar, leer, crear, actualizar con
  `baseRevision`, borrar con `replaceWith`/`removeReferences`, dónde se usa) siguen este contrato
  cuando se añadan; sus nombres y formas son de los tickets de A1, no de aquí.
- **Códigos de error nuevos** que introduce A1: `E-OBJETO-EN-USO` (borrar un objeto en uso, § 3.4),
  `E-REVISION` (`baseRevision` desfasada, § 5.4) y `E-ADJUNTO` (adjunto rechazado por tamaño o tipo,
  § 6), con sus equivalentes del motor en el mapa explícito de `lilaFile.ts`. Los códigos que ya
  existen conservan su significado.
- `docs/BPMN_EXTENSION.md` ya apunta las referencias al catálogo por objeto y dice que todavía no se
  comprueban. La regla de «se informa y se descarta» de `docs/PROJECT_FORMAT.md` la actualiza A1
  junto con el código, para que nunca describa algo que no está construido.

## 9. Presupuestos de rendimiento

Son **objetivos que hay que medir**, no resultados. Nada de lo que sigue se ha medido.

### 9.1 El repositorio grande sintético

Un generador con semilla, escrito en A1 y guardado junto a las pruebas (se versiona solo el
generador, no lo que produce), crea el mismo repositorio como carpeta y como `.lila`. Todos los
nombres son sintéticos («Proceso 017», «Rol 0412»), según la [política de ejemplos](EXAMPLES_POLICY.md).

| Repositorio | Procesos | Nodos de flujo | Objetos de catálogo | Referencias | Adjuntos | Corridas |
| --- | --- | --- | --- | --- | --- | --- |
| `synthetic-org-s` | 10 | 700 | 200 | 2.500 | 10 × 100 KB | ninguna |
| `synthetic-org-l` | 200, con 4 carriles y 2 escenarios cada uno | 14.000 (50 tareas, 10 compuertas, 10 eventos por proceso) | 5.000: 1.500 roles, 300 unidades, 700 sistemas, 2.500 documentos | 50.000 (por tarea: 2 RACI, 1 sistema, 1 entrada, 1 salida), 1 % sin resolver | 300, de 50 KB a 2 MB, unos 150 MB | ninguna |
| `synthetic-org-l+runs` | como `l` | como `l` | como `l` | como `l` | como `l` | 1 por proceso, unos 300 KB cada una |

### 9.2 Hardware de referencia

- **A:** Mac con Apple silicon (clase M1), 8 GB de RAM, el macOS vigente, la app de escritorio
  publicada y Chrome estable.
- **B:** portátil con Windows 11 x64, 4 núcleos, 8 GB de RAM, Chrome estable, la PWA instalada
  (ADR-031).

Cada medición anota el modelo de máquina, el sistema operativo, el build de la app, la versión del
navegador o de Electron, el repositorio y la semilla, y da la mediana y el p95 de cinco ejecuciones;
«abrir» se mide con la app en frío y la caché de archivos caliente.

### 9.3 Presupuestos (`synthetic-org-l`)

| Operación | A, carpeta | A, `.lila` | B, `.lila` |
| --- | --- | --- | --- |
| Abrir hasta un lienzo interactivo con el explorador (manifiesto, catálogo, primer proceso) | 1,5 s | 2,5 s | 4 s |
| Índice de usos completo, en segundo plano | 3 s | 3 s | 6 s |
| Búsqueda mientras se escribe (nombres de objetos, de procesos y de elementos) | 100 ms | 100 ms | 150 ms |
| Tabla de objetos: primer pintado de 5.000 filas (virtualizada) | 300 ms | 300 ms | 450 ms |
| Tabla de objetos: confirmar la edición de una celda, con diagrama e índice al día | 100 ms | 100 ms | 150 ms |
| Guardar tras cambiar un objeto | 300 ms | 3 s | 5 s |
| Autoguardado (A1: documento entero sin los bytes de adjuntos; alternativa: conjunto de cambios); bloqueo más largo del hilo de entrada | 200 ms; 50 ms | 200 ms; 50 ms | — |
| Memoria del renderer con el repositorio abierto (sin abrir adjuntos) | 400 MB | 400 MB | 400 MB |

Con `synthetic-org-l+runs`, abrir y buscar mantienen los mismos presupuestos (las corridas no se
cargan), y ningún mensaje IPC, salvo la lectura explícita de un adjunto, pasa de 8 MB. Un
presupuesto que no se cumple es un hallazgo para los tickets de A1, no un motivo para cambiar este
contrato en silencio; los valores medidos, el hardware y el repositorio se anotan en el ticket que
cierra la aceptación de rendimiento.

## 10. Decisiones del dueño (2026-10-14)

Todo lo demás de este documento es una decisión técnica y reversible, tomada con su razón. El dueño
decidió estas cuatro preguntas de producto:

1. **Tipos de adjunto:** solo la lista permitida de formatos de documento e imagen de § 6.
2. **Tamaño de los adjuntos:** 20 MB por adjunto y 200 MB por repositorio son los valores por
   defecto, configurables por repositorio en el `limits` del manifiesto (§ 1.2). Bajar un límite
   rechaza adjuntos nuevos y nunca borra los que ya hay.
3. **Control documental:** código, versión y estado (control documental al estilo ISO) esperan a la
   gobernanza de la fase 7; quedan reservados (§ 2.5) y no forman parte de A1.
4. **Compartir:** una copia compartida incluye los adjuntos por defecto (§ 6); las corridas siguen
   siendo opcionales.

## Dónde estará el código

Aún no está construido. La mitad del formato va en `packages/engine/src/project/` (manifiesto de la
versión 3, lectura y escritura de objetos de catálogo, el índice de usos), junto a `lila.ts` y
`repository.ts`, para que siga siendo seguro en el navegador; la mitad de disco en
`packages/engine/src/project-fs/`; los almacenes en `apps/web/src/store/`; el IPC en
`apps/desktop/src/bridge.ts` y `main.ts`. El `core/` del motor sigue sin código de catálogo.
