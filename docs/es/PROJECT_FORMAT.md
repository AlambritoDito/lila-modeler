# El formato de proyecto de Lila: la carpeta y el archivo `.lila`

> Leer en: [English](../PROJECT_FORMAT.md)

Un proyecto de Lila es una **carpeta** (ADR-018). Un archivo `.lila` es esa misma carpeta
**comprimida en zip**, con la misma disposición y los mismos nombres de archivo (ADR-027). Los dos
son el mismo proyecto en dos contenedores:

```bash
cd pedido && zip -r ../pedido.lila .   # un .lila válido
unzip pedido.lila -d pedido            # una carpeta de proyecto válida
```

Entre una forma y otra no se convierte, migra ni reescribe nada. La carpeta es lo que se guarda en
git —se compara y se fusiona, que es justo la razón de que sea la forma principal—. El `.lila` es
lo que se le pasa a alguien: un archivo que adjuntar, descargar o abrir con doble clic.

Un proyecto puede tener **varios procesos** (ADR-029, #498). Con uno es la disposición de la
versión 1 de abajo, sin cambios; con dos o más es un *repositorio* versión 2 en el que cada proceso
conserva esa misma disposición dentro de `processes/<slug>/` (ver [Versión 2](#versión-2-el-repositorio)).
Un repositorio con objetos de catálogo —roles, unidades, sistemas y documentos— es la versión 3 (ver
[Versión 3](#versión-3-el-catálogo)), tal como la define [el contrato del
repositorio](REPOSITORY_CONTRACT.md). El resto de la ADR-029 —mapas, adjuntos, un almacén por
objeto— todavía no forma parte del formato; el [roadmap organizacional](ROADMAP.md) dice en qué orden
está planeado.

## Disposición

| Entrada | Qué es |
| --- | --- |
| `lila-project.json` | El manifiesto (abajo). Obligatorio en un `.lila`; opcional en una carpeta, donde se reconstruye si falta. |
| `model.bpmn` | El XML BPMN, byte a byte. Obligatorio. |
| `<nombre>.scenario.json` | Un documento de escenario crudo por escenario, con `extends` intacto: nunca se resuelve ni al entrar ni al salir. El nombre del archivo es la identidad del escenario: es a lo que apunta `extends`. |
| `runs/<id>.result.json` | Una corrida guardada: el `RunResult` del motor más las entradas que la produjeron (`docs/RESULTS_FORMAT.md`). |

Las entradas se escriben en un orden canónico —manifiesto, modelo, escenarios por nombre, corridas
por id— y con una fecha fija, así que guardar dos veces el mismo proyecto produce los mismos bytes.

## El manifiesto

```json
{
  "version": 1,
  "id": "e2a1…",
  "name": "pedido",
  "model": { "id": "Process_Pedido", "name": "model.bpmn", "revision": 3 },
  "scenarioRevisions": { "as-is.scenario.json": 2, "to-be-3-cajeros.scenario.json": 1 },
  "engine": "1.0.0-beta.1"
}
```

`engine` es el único campo que la carpeta no tiene: la versión de `@lila-modeler/engine` que
escribió las corridas de este archivo. Es informativo —los lectores lo anotan y siguen— y a
propósito no forma parte del documento en memoria, así que abrir y guardar lo vuelve a sellar en
vez de arrastrar la versión de otra persona.

## Versión 2: el repositorio

Un proyecto con más de un proceso se escribe en la versión 2 (ADR-029). El manifiesto conserva su
nombre, `lila-project.json`, y lista los procesos; cada proceso es exactamente la disposición de la
versión 1, sin manifiesto propio, en su carpeta:

```
lila-project.json              manifiesto, "version": 2
processes/<slug>/model.bpmn
processes/<slug>/<nombre>.scenario.json
processes/<slug>/runs/<id>.result.json
```

```json
{
  "version": 2,
  "id": "e2a1…",
  "name": "pedido",
  "processes": [
    { "slug": "pedido", "name": "Pedido",
      "model": { "id": "Process_Pedido", "name": "model.bpmn", "revision": 3 },
      "scenarioRevisions": { "as-is.scenario.json": 2 } },
    { "slug": "facturacion", "name": "Facturación",
      "model": { "id": "Process_Facturacion", "name": "model.bpmn", "revision": 1 },
      "scenarioRevisions": {} }
  ],
  "engine": "1.0.0"
}
```

- **El slug es la carpeta**: minúsculas `a-z`, dígitos y guiones, único en el proyecto, sacado del
  nombre al crear el proceso y que no cambia al renombrarlo. `name` es lo que enseña la pestaña del
  lienzo. El orden de `processes` es el de las pestañas.
- **La versión 2 solo se escribe cuando hace falta.** Mientras un proyecto tiene un proceso se
  guarda en la versión 1, byte a byte, así que las versiones de la app que solo leen la 1 lo siguen
  abriendo. Añadir un segundo proceso escribe la versión 2; volver a uno escribe otra vez la 1.
  Un manifiesto versión 2 que lista un solo proceso (escrito por otra herramienta, o editado a mano)
  se sigue leyendo como repositorio: ese proceso conserva su slug y su nombre, y un proceso añadido
  después va a su lado en vez de moverlo a otra carpeta — hasta que se guarda como proyecto de un
  proceso (versión 1). Desde entonces su slug y su nombre salen otra vez del nombre del proyecto,
  así que el slug puede cambiar. Añadir un proceso la deja en la versión 2; cuenta cualquier otro
  guardado, también el del motor: en cuanto la CLI o el servidor MCP escriben en un `.lila` así (un
  escenario, una corrida guardada, un proceso editado), queda en la versión 1, y un agente que siga
  pasando el slug viejo en `--process` (`process` en las herramientas MCP) recibe «no tiene el
  proceso». Con un solo proceso, omite `--process`.
- **Un proyecto versión 1 se lee como un repositorio de un proceso**, en carpeta y en `.lila`. No
  se migra nada: abrirlo y guardarlo sin cambios devuelve los mismos bytes.
- **La carpeta se mueve, no se copia.** El primer guardado en versión 2 de una *carpeta* versión 1
  mueve el `model.bpmn`, los escenarios y las corridas del primer proceso de la raíz a
  `processes/<slug>/`, en el mismo commit de todo o nada que el resto del guardado. Volver a un
  proceso escribe otra vez los archivos de la raíz y deja `processes/` en disco para que lo quites tú.
  La carpeta de un proceso borrado también se queda, huérfana, y no vuelve: un proceso nuevo nunca
  toma un slug que esté listado en disco, que tenga carpeta en `processes/` o que se haya borrado
  en la sesión —«Cobro» pasa a `cobro-2`—, y el escritor rechaza (`E-CARPETA-OCUPADA`, sin borrar
  nada) un proceso nuevo cuya carpeta ya tenga escenarios o corridas de otro. Un manifiesto editado a
  mano después de que la app lo leyera (uno que quita un proceso abierto, por ejemplo) se rechaza antes
  como `E-CAMBIO-EXTERNO`. El manifiesto se escribe después de los
  archivos de los procesos, así que un cierre brusco a mitad de ese primer guardado deja intacto el
  proyecto versión 1.
- **Los escenarios y las corridas son de cada proceso.** La simulación corre un proceso a la vez —el
  del lienzo— y una actividad de llamada sigue siendo una tarea con su propio tiempo; hacer doble
  clic en una abre el proceso cuyo id de proceso BPMN es su `calledElement`.
- **En el `.lila`**, lo que quede fuera de las carpetas `processes/<slug>/` listadas se avisa y se
  conserva, igual que un archivo suelto en un archivo versión 1 (ver [Qué se tolera](#qué-se-tolera-y-qué-no));
  un proceso listado sin su `model.bpmn` es fatal (`LILA-NO-MODEL`).

## Versión 3: el catálogo

Un repositorio con objetos de catálogo se escribe en la versión 3 ([el contrato del
repositorio](REPOSITORY_CONTRACT.md) § 1–2, ADR-032). Es la disposición de la versión 2 más un archivo
JSON por objeto, y un id para cada proceso del manifiesto:

```
lila-project.json              manifiesto, "version": 3
processes/<slug>/…             como en la versión 2
catalog/<tipo>/<id>.json       un archivo por objeto de catálogo
```

```json
{
  "version": 3,
  "id": "e2a1…",
  "name": "Hotel",
  "processes": [
    { "id": "process-4k9w2m7q1z8c", "slug": "front-desk", "name": "Front desk",
      "model": { "id": "Process_FrontDesk", "name": "model.bpmn", "revision": 2 },
      "scenarioRevisions": { "as-is.scenario.json": 1 } }
  ],
  "engine": "1.0.0"
}
```

```json
{
  "type": "role",
  "id": "role-7k2m9q4x1pzd",
  "name": "Recepcionista",
  "description": "Recibe a los huéspedes.",
  "revision": 2,
  "unitRef": "unit-b3r8w1c6k0qe"
}
```

- **Objetos.** Todo objeto tiene `type`, `id`, `name` (no vacío), `revision` (un entero, al menos 1)
  y, opcionalmente, `description` y `attributes` (una lista de pares de texto `{ "name", "value" }`).
  Los tipos de esta versión son `role` (`unitRef`), `unit` (`parentRef`), `system` (`ownerRef`, `url`)
  y `document` (`ownerRef`, `url`); una `url` es una dirección `http`/`https` que se muestra como
  enlace y nunca se descarga. Los adjuntos no forman parte de esta versión. Los campos que esta
  versión no conoce se conservan, en su orden. Los objetos de un tipo que no conoce (`risk`,
  `control`, `kpi`…) se leen comprobando su sobre y conservando todos sus campos, como objetos de
  solo lectura. Un archivo se escribe con sangría de dos espacios y un salto de línea final; un
  objeto que nadie cambió conserva los bytes con los que se leyó allí donde esos bytes viajan (todo
  guardado del motor, la CLI, el servidor MCP y el escritorio, y la app web hasta que se recarga), y
  si no se reescribe con los mismos campos.
- **Ids.** El id de un objeto nuevo es `<tipo>-<12 caracteres de [0-9a-z]>`, aleatorio; todo id
  cumple `^[a-z0-9][a-z0-9-]{0,63}$`, nunca cambia y nunca sale del nombre. Una referencia escrita a
  mano antes de que existiera el catálogo (`rol-1`) puede convertirse en un objeto con ese mismo id
  si cumple la gramática y no es un nombre que Windows rechaza (`con`, `nul`…). Los ids son únicos en
  todo el catálogo; el mismo id con dos tipos (una edición a mano, una fusión) carga los dos y se avisa.
- **Ids de proceso.** Cada proceso de un manifiesto versión 3 tiene un `id`, `process-<12
  caracteres de [0-9a-z]>`: su identidad de almacenamiento en el repositorio. Un proyecto versión 1
  o 2 recibe ids nuevos cuando pasa a la versión 3; solo se escriben en un manifiesto versión 3.
  `--process` (`process` en las herramientas MCP) sigue recibiendo el slug.
- **La versión 3 se escribe cuando hace falta, y después se queda.** El primer objeto de catálogo
  pasa el proyecto a la versión 3; quitar el último lo deja en la versión 3, con sus ids de proceso.
  Un proyecto versión 3 con un solo proceso sigue en `processes/<slug>/` en vez de volver a la
  versión 1, así que su slug no cambia nunca bajo un agente. Un objeto de catálogo o un nombre
  reservado (abajo) que aparezca en un archivo versión 1 o 2 —añadido a mano o por otra
  herramienta— se lee, y el siguiente guardado escribe la versión 3.
- **Un objeto roto** —que no es JSON, al que le falta un campo obligatorio o cuyo `type`/`id` no
  coincide con su ruta— se excluye y se explica en `problems`, y se conserva byte a byte: otros
  objetos pueden apuntar a él, y arreglarlo a mano no debe costar perderlo.
- **`limits`**, los límites opcionales de adjuntos del manifiesto, se vuelven a escribir tal como
  estaban; un miembro inválido se avisa en `problems`.
- **Las versiones anteriores la rechazan limpiamente**: de la 1.0.0-beta.15 a la beta.28 con
  `LILA-MANIFEST` («declara la versión 3»), y las que solo leen la versión 1 con «falta model.bpmn».
- **En una carpeta** (#671) la versión 3 son los mismos archivos, descomprimidos; el manifiesto de la
  carpeta no lleva `engine`, como en las versiones 1 y 2. El primer guardado versión 3 de una carpeta
  versión 1 mueve sus archivos a `processes/<slug>/` en el mismo commit de todo o nada que usa la
  versión 2, junto con los objetos del catálogo: primero los objetos y los archivos de los procesos,
  luego el manifiesto y al final los archivos que salen de la raíz. Un fallo a mitad de camino
  devuelve la carpeta versión 1 ([el contrato del repositorio](REPOSITORY_CONTRACT.md) § 7). Un
  guardado escribe solo los archivos de objetos que cambiaron: un objeto que su archivo ya tiene, con
  el formato que sea, no se reescribe. El archivo de un objeto eliminado en la sesión se borra, pero
  solo si esta versión lo leyó como objeto; un archivo que otro añadió mientras tanto, o uno roto, se
  queda. Un archivo de objeto que cambió en disco desde que se leyó es `E-CAMBIO-EXTERNO`, como un
  modelo o un escenario, y el escritorio recarga cuando otro programa cambia un archivo de
  `catalog/`. Como en el archivo, un catálogo o una carpeta no vacía de un nombre reservado (`maps/`…)
  que aparece en una carpeta versión 1 o 2 se lee como versión 3, y el siguiente guardado la escribe.

Las entradas se escriben manifiesto, procesos (como en la versión 2), objetos de catálogo ordenados
por tipo y luego por id, y al final las entradas que se conservan tal como estaban (abajo) ordenadas
por nombre, con la misma fecha fija: dos guardados del mismo repositorio siguen dando los mismos bytes.

## Versiones

`version` es `1`, `2` o `3`. Los cambios a este formato solo pueden **añadir campos opcionales**; lo
que haría que un lector interpretara mal un archivo lleva una `version` nueva, y el lector la rechaza
en vez de adivinar: el lector actual rechaza una versión 4 con `LILA-MANIFEST` (`E-MANIFEST` en una
carpeta, cuyo escritor tampoco guarda encima de un manifiesto de una versión que no lee, así que no
se escribe nada). No hay paso de migración ni está previsto: los archivos están en el disco del usuario,
no en una base de datos que alguien controle.

Una versión de la app que solo lee la versión 1 (hasta la 1.0.0-beta.14) rechaza limpiamente un
repositorio versión 2: busca el `model.bpmn` de la raíz antes de leer la versión del manifiesto, así
que el rechazo que da es «falta model.bpmn» (`E-NO-MODEL` en un `.lila`, `E-SIN-MODELO` en una
carpeta), nunca un proyecto leído a medias.

## Qué se tolera y qué no

Abrir es tolerante donde el formato es flexible y estricto donde no lo es:

- Un `*.scenario.json` puede tener un **borrador que todavía no valida**: para eso se edita. Solo
  tiene que ser un objeto JSON.
- Un escenario ilegible o una corrida inválida se **excluyen y se explican** en los `problems` del
  proyecto; nunca abortan la apertura. Perder una corrida rota no debería costarte el proyecto.
- Que falte `lila-project.json` o `model.bpmn` es **fatal**: no hay proyecto.
- Las entradas con segmentos `..`, rutas absolutas, letras de unidad o barras invertidas se
  **rechazan sin más**: un zip que trae una no es un proyecto al que le falta un archivo.

**Lo que no está en la disposición de arriba se conserva, no se descarta**, en todas las versiones
([el contrato del repositorio](REPOSITORY_CONTRACT.md) § 1.4):

- Un `notes.md` dentro de un `.lila` aparece en `problems` como «not understood by this version;
  kept as is» (esta versión no lo entiende y lo conserva tal cual), y todo guardado lo vuelve a
  escribir byte a byte: el de la app, el de la CLI y el del servidor MCP.
- Los nombres reservados para fases posteriores —`maps/`, `analysis/`, `dashboards/`, `records/`,
  `attachments/` y `processes/<slug>/process.json`— se conservan sin avisar, y pasan el repositorio
  a la versión 3.
- La basura del sistema operativo (`__MACOSX/`, `.DS_Store`, `Thumbs.db`) y los restos de los propios
  escritores (`*.tmp-*`, `*.prev-*`, `*.lock`) se descartan sin avisar.
- Las entradas conservadas de un proceso borrado en la sesión se van con él, salvo cuando el
  proyecto vuelve a la versión 1, que las conserva como la carpeta conserva una carpeta `processes/`
  vieja. Las entradas bajo un `processes/<slug>/` que el manifiesto no lista son una carpeta
  huérfana, y se conservan; un guardado que daría su slug a un proceso mientras la carpeta tiene un
  `model.bpmn`, un escenario o una corrida se rechaza (`LILA-ENTRY-PATH`) en vez de leerlos después
  como de ese proceso.

Se conservan **junto al** documento, nunca dentro: el documento es lo que cruza la frontera IPC del
escritorio (`structuredClone`) y va a la copia en `localStorage` del navegador (`JSON.stringify`), y
ninguno de los dos lleva bytes con honestidad. Así que:

- **El motor, la CLI y el servidor MCP** vuelven a escribir las entradas del `.lila` que
  sobrescriben, leídas dentro de su `.lila.lock` (`writeLilaFile`), así que toda escritura de un
  agente las conserva.
- **El escritorio** hace lo mismo cuando guarda sobre el archivo que abrió; «Guardar como» empieza
  una copia nueva sin ellas. Su copia de autoguardado (`recovery.lila`) no las tiene para un archivo
  que abrió el escritorio: se quedan en ese archivo.
- **La app web** las guarda en memoria para el archivo que abrió y las escribe en cada guardado a un
  archivo. La copia en `localStorage` que recupera la sesión tras recargar no puede tenerlas, así que
  al abrir un archivo así se muestra un aviso de que la recuperación automática no las incluirá.
- **El catálogo** forma parte del documento, así que siempre viaja: guardados, autoguardado,
  recuperación y toda escritura de un agente.

En la forma de **carpeta** esos archivos simplemente se dejan en paz, como antes, porque el escritor
solo toca los archivos que son suyos: no se avisan. Una carpeta no vacía de un nombre reservado
sigue haciendo del repositorio una versión 3, como arriba.

## Tipo MIME y extensión

El tipo MIME es `application/vnd.lila-modeler+zip`. No está registrado en la IANA; sigue la
convención del sufijo estructurado `+zip` (RFC 8081), así que un cliente que no sabe nada de Lila
puede reconocer igualmente que es un ZIP.

La extensión `.lila` tampoco está registrada. El único otro uso encontrado es **LARSIM «LiLa»**, un
formato de modelado hidrológico de las agencias del agua alemanas, sin tipo MIME registrado ni
asociación de archivos de escritorio: la colisión es nominal y ninguna herramienta nuestra ni suya
puede confundir uno con otro, porque un proyecto de Lila empieza con la firma ZIP `PK`.

## Dónde está el código

`packages/engine/src/project/`: `types.ts` (el contrato del documento), `document.ts` (validación
estructural, con códigos de error estables), `lila.ts` (`encodeLila`/`decodeLila` sobre `fflate`, los
manifiestos de las versiones 2 y 3, y `decodeLilaArchive`, que además devuelve las entradas que se
conservan junto al documento), `repository.ts` (`processesOf`/`withProcesses`, que pliegan la lista
de procesos en el documento: sus campos de primer nivel son el primer proceso, y `process`/`processes`
llevan el resto), `catalog.ts` (objetos de catálogo e ids: `newCatalogId`, `newProcessId`,
`isCatalogId`, `isAdoptableId`) y `upgrade.ts` (`formatVersionOf`, `upgradesToVersion3`,
`asVersion3`, `withCatalog`: en qué versión se escribe un documento, y el paso sin vuelta a la 3). Se publica como `@lila-modeler/engine/project`, que sigue siendo apto para el navegador. La mitad de
disco es `packages/engine/src/project-fs/`, publicada como `@lila-modeler/engine/project-fs` (solo
Node, #466): el lector/escritor de carpetas `projectIO.ts`, el archivo `.lila` `lilaFile.ts` e
`input.ts`, que abre un proceso de un `.lila` para la CLI y el servidor MCP y escribe un escenario de
vuelta. El escritorio, la CLI y el servidor MCP la usan.

Los códigos del motor son `LILA-ZIP`, `LILA-NO-MANIFEST`, `LILA-MANIFEST`, `LILA-NO-MODEL`,
`LILA-ENTRY-PATH` (el contenedor) y `LILA-DOCUMENT`, `LILA-PROBLEMS`, `LILA-RUN`, `LILA-RUN-INPUTS`
(el documento). Cada interfaz los redacta a su manera: el escritorio los traduce a sus propios
`E-ZIP`, `E-NO-MANIFEST`, `E-MANIFEST`, `E-NO-MODEL`, `E-ENTRY-PATH`, `E-DOCUMENTO`, `E-DIAGNOSTICO`,
`E-CORRIDA`, `E-ENTRADAS-CORRIDA` en la frontera IPC (un mapa explícito en `lilaFile.ts`, listado en
la cabecera de `bridge.ts`); la app web los traduce en `apps/web/src/project.ts`. Guardar un `.lila`
pasa por las mismas guardias `E-CARPETA-OCUPADA`/`E-CAMBIO-EXTERNO` que guardar una carpeta, con un
`<archivo>.lila.lock` junto al archivo mientras comprueba y escribe, para que quienes escriben desde
procesos distintos (el escritorio, la CLI, servidores MCP) se turnen; quien no consigue el bloqueo en
3 segundos rechaza con `E-ARCHIVO-OCUPADO` (no se escribe nada). Quien lo tiene lo toca cada 2
segundos, así que un bloqueo sin tocar durante 10 segundos se borra como restos de un cierre
inesperado; nadie borra un bloqueo cuyo token (un id aleatorio escrito dentro) no haya comprobado.
