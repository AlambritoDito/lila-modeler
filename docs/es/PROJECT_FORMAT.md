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
- **Un proyecto versión 1 se lee como un repositorio de un proceso**, en carpeta y en `.lila`. No
  se migra nada: abrirlo y guardarlo sin cambios devuelve los mismos bytes.
- **La carpeta se mueve, no se copia.** El primer guardado en versión 2 de una *carpeta* versión 1
  mueve el `model.bpmn`, los escenarios y las corridas del primer proceso de la raíz a
  `processes/<slug>/`, en el mismo commit de todo o nada que el resto del guardado. Volver a un
  proceso escribe otra vez los archivos de la raíz y deja `processes/` en disco para que lo quites tú.
  La carpeta de un proceso borrado también se queda, huérfana, y no vuelve: un proceso nuevo nunca
  toma un slug que esté listado en disco, que tenga carpeta en `processes/` o que se haya borrado
  en la sesión —«Cobro» pasa a `cobro-2`—, y el escritor rechaza (`E-CARPETA-OCUPADA`, sin borrar
  nada) un proceso nuevo cuya carpeta ya tenga escenarios o corridas de otro. El manifiesto se escribe después de los
  archivos de los procesos, así que un cierre brusco a mitad de ese primer guardado deja intacto el
  proyecto versión 1.
- **Los escenarios y las corridas son de cada proceso.** La simulación corre un proceso a la vez —el
  del lienzo— y una actividad de llamada sigue siendo una tarea con su propio tiempo; hacer doble
  clic en una abre el proceso cuyo id de proceso BPMN es su `calledElement`.
- **En el `.lila`**, lo que quede fuera de las carpetas `processes/<slug>/` listadas se avisa y se
  descarta, igual que un archivo suelto en un archivo versión 1; un proceso listado sin su
  `model.bpmn` es fatal (`LILA-NO-MODEL`).

## Versiones

`version` es `1` o `2`. Los cambios a este formato solo pueden **añadir campos opcionales**; lo que
haría que un lector interpretara mal un archivo lleva una `version` nueva, y el lector la rechaza en
vez de adivinar: el lector actual rechaza una versión 3 con `LILA-MANIFEST` (en la carpeta,
`E-MANIFEST`). No hay paso de migración ni está previsto: los archivos están en el disco del usuario,
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

**Lo que no está en la disposición de arriba se avisa y se descarta.** Un `notes.md` o una carpeta
`attachments/` dentro de un `.lila` aparecen en `problems` al abrirlo y no se vuelven a escribir al
guardar. Conservarlos obligaría a llevar bytes opacos a través de `structuredClone` (la frontera IPC
del escritorio) y de `JSON.stringify` (la copia en `localStorage` del navegador), y ninguno de los
dos respeta un `Uint8Array` con honestidad. En la forma de **carpeta** esos archivos simplemente se
dejan en paz, porque el escritor solo toca los archivos que son suyos; así que hoy el sitio para
notas y adjuntos es la carpeta, no el archivo.

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
estructural, con códigos de error estables), `lila.ts` (`encodeLila`/`decodeLila` sobre `fflate`, y
el manifiesto de la versión 2), `repository.ts` (`processesOf`/`withProcesses`, que pliegan la lista
de procesos en el documento: sus campos de primer nivel son el primer proceso, y `process`/`processes`
llevan el resto). Se publica como `@lila-modeler/engine/project`. El lector/escritor de carpetas es
`apps/desktop/src/projectIO.ts`; la mitad `.lila` del escritorio es `apps/desktop/src/lilaFile.ts`.

Los códigos del motor son `LILA-ZIP`, `LILA-NO-MANIFEST`, `LILA-MANIFEST`, `LILA-NO-MODEL`,
`LILA-ENTRY-PATH` (el contenedor) y `LILA-DOCUMENT`, `LILA-PROBLEMS`, `LILA-RUN`, `LILA-RUN-INPUTS`
(el documento). Cada interfaz los redacta a su manera: el escritorio los traduce a sus propios
`E-ZIP`, `E-NO-MANIFEST`, `E-MANIFEST`, `E-NO-MODEL`, `E-ENTRY-PATH`, `E-DOCUMENTO`, `E-DIAGNOSTICO`,
`E-CORRIDA`, `E-ENTRADAS-CORRIDA` en la frontera IPC (un mapa explícito en `lilaFile.ts`, listado en
la cabecera de `bridge.ts`); la app web los traduce en `apps/web/src/project.ts`. Guardar un `.lila`
pasa por las mismas guardias `E-CARPETA-OCUPADA`/`E-CAMBIO-EXTERNO` que guardar una carpeta.
