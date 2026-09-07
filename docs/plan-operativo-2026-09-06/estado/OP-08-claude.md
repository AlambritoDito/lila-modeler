# OP-08 — estado final (dueño B, Claude Sonnet 5)

- Rama: `codex/op-b-desktop`.
- SHA base (tras `git merge --no-edit codex/claude-entrega-20260906`, fast-forward): `97dabb0`.
- SHA final: `2cba842`.
- Commits (orden):
  1. `2d26b57` — checkpoint inicial (este archivo, vacío).
  2. `e16ef9a` — `projectTypes.ts` + `projectIO.ts` (lectura/escritura tolerante y atómica) + `projectIO.test.ts`.
  3. `f70d5b0` — `bridge.ts`/`preload.cts`/`main.ts`: puente reducido a `chooseFolder`/`readProject`/`writeProject`.
  4. `2cba842` — `DesktopStore.ts` + `DesktopStore.test.ts`.

## Decisiones (más allá de lo ya fijado por el coordinador)

1. **`projectTypes.ts` duplica `ProjectDocument`/`ScenarioDocument`/`StoredRun` en `apps/desktop`.**
   Razón: `import type { ProjectDocument } from '.../apps/web/src/store/ProjectStore.ts'` dentro de
   `apps/desktop` revienta con `TS6059` ("File is not under 'rootDir'") bajo el `tsconfig.json` de
   este paquete (`rootDir: "src"`, `composite: false`, sin `references`) — verificado a mano antes
   de escribir nada (`npx tsc -p apps/desktop/tsconfig.json --noEmit` con ese import como único
   contenido de un archivo de prueba, borrado después). La dirección contraria (`apps/web`
   importando `type { LilaBridge }` de `apps/desktop/src/bridge.ts`) sí compila — confirmado con el
   mismo método —, así que `DesktopStore.ts` importa el tipo directamente, sin el `lila-bridge.d.ts`
   de reserva que preveía el ticket.
   **Petición a A**: mover esta forma a un paquete compartido (p. ej. `packages/contracts`) para
   dejar de mantener dos copias a mano. Mientras tanto, cualquier cambio a `ProjectDocument` en
   `apps/web/src/store/ProjectStore.ts` debe reflejarse también en `apps/desktop/src/projectTypes.ts`.

2. **`StoredRun.result` es `unknown` en el lado de `apps/desktop`** (no `RunResult` de `@lila/engine`):
   añadir esa dependencia al paquete `@lila/desktop` está fuera del aislamiento del ticket ("sin
   dependencias nuevas") y el proceso main nunca interpreta el contenido de `result`, solo lo
   serializa/deserializa. `DesktopStore.toProjectDocument` (apps/web/src/store/DesktopStore.ts) hace
   el único cast (`run.result as RunResult`) en la frontera IPC — no oculta una invalidez de
   dominio, repara un tipo que dos paquetes sin dependencia compartida no pueden expresar igual.

3. **`problems` viaja como campo extra de lo que devuelve `readProject`, no como un canal IPC aparte.**
   `LilaBridge.readProject(dir): Promise<LilaProjectDocument>`, donde
   `LilaProjectDocument extends ProjectDocument { readonly problems: readonly ProjectProblem[] }`.
   Sigue siendo "un `ProjectDocument`" (con un campo de más que el contrato de A no declara), así
   que no contradice la firma fijada en la decisión 2 del coordinador. `DesktopStore` separa
   `problems` en `toProjectDocument` y lo expone por `get lastProblems()`.
   **Petición a A**: declarar `problems?: readonly { file: string; message: string }[]` opcional en
   `ProjectDocument` (`apps/web/src/store/ProjectStore.ts`) para que esta extensión deje de ser
   necesaria y B no tenga que inventar una forma paralela.

4. **`lila-project.json` roto (JSON inválido o campos con forma inválida) se trata igual que
   ausente**: se reconstruye con id nuevo y revisiones en 0, y además se anota en `problems` (a
   diferencia del caso "ausente", que es silencioso — es el estado normal de una carpeta con
   `model.bpmn` puesto a mano). El ticket solo especifica el caso "ausente"; extender el mismo
   trato tolerante a "presente pero corrupto" sigue el espíritu de la decisión 3 sin contradecirla.
   Igual tratamiento tolerante se aplicó a `runs/*.result.json` roto o sin forma de `StoredRun`
   (antes solo se pedía explícitamente para `*.scenario.json`): se excluye y queda en `problems`.

5. **Errores de `ProjectIOError` cruzan el IPC como `"CODIGO: mensaje"` en `error.message`**, no
   como una propiedad `.code` en el objeto de error del renderer: Electron no preserva propiedades
   custom de una excepción lanzada en `ipcMain.handle` al rechazar la promesa del lado
   `ipcRenderer.invoke` (solo sobrevive el mensaje, aproximadamente). `DesktopStore`/su test
   verifican el código con `error.message` (p. ej. `.rejects.toThrow('E-SIN-MODELO')`).

6. **Métodos históricos de `ProjectStore` (`listProcesses`/`getProcess`/`putProcess`/
   `listScenarios`/`putScenario`/`putRun`) son mínimo viable sobre el documento activo en memoria +
   `saveProject`**, sin persistencia propia: como esta modalidad solo tiene un proyecto abierto a
   la vez, `processId` no distingue nada (mismo compromiso que ya documenta `BrowserStore`: "el id
   real es irrelevante en esta modalidad"). `getProcess(id)` devuelve el proceso activo si el `id`
   coincide con `model.id`; si no, delega en `openProject()` (mismo trato que "abrir selector" de
   `BrowserStore`). Estos métodos no se ejercitan hoy desde `App.tsx` con `DesktopStore` real
   porque `main.tsx` todavía no lo instancia (ver "Entrega a A" abajo); quedan cubiertos solo por
   `DesktopStore.test.ts` con el puente falso.

## Comandos y resultados

| Comando | Resultado |
|---|---|
| `npx vitest run apps/desktop apps/web/src/store` | 5 archivos, 83 tests, todos verdes (incluye `safePaths.test.ts` y `store-boundary.test.ts`/`BrowserStore.test.ts` preexistentes, sin tocar). |
| `npm run typecheck -w @lila/desktop` | limpio. |
| `npm run typecheck -w @lila/web` | limpio. |
| `npm run build -w @lila/web` | build de Vite ok (warning preexistente de chunk >500 kB, no relacionado con este ticket). |
| `npm run build -w @lila/desktop` | `tsc --build` + copia de `dist/web` ok. |
| `LILA_SMOKE=1 npx electron apps/desktop` | `{"lienzo":true,"tema":true,"fuente":true,"puente":true,"consoleErrors":[],"loadFailure":null,"ok":true}`. |

## Archivos tocados

- `apps/desktop/src/projectTypes.ts` (nuevo)
- `apps/desktop/src/projectIO.ts` (nuevo)
- `apps/desktop/src/projectIO.test.ts` (nuevo)
- `apps/desktop/src/bridge.ts` (reescrito: `chooseFolder`/`readProject`/`writeProject`, retira `openFolder`/`listFiles`/`readFile`/`writeFile`)
- `apps/desktop/src/preload.cts` (implementa el nuevo contrato)
- `apps/desktop/src/main.ts` (handlers IPC nuevos + validación de forma/nombres; `runSmoke`/`SmokeChecks` sin tocar)
- `apps/web/src/store/DesktopStore.ts` (nuevo)
- `apps/web/src/store/DesktopStore.test.ts` (nuevo)
- No se tocó `apps/web/src/store/lila-bridge.d.ts`: no hizo falta (ver decisión 1).

## Limitaciones / fuera de alcance (anotadas, no resueltas aquí)

- Borrar escenarios que ya no estén en el documento al guardar: fuera de alcance (dicho por el
  ticket), `writeProjectFolder` nunca borra archivos.
- La garantía de "escritura segura" es por archivo (temporal + `rename`), no una transacción
  multi-archivo: si el proceso muere entre el primer y el segundo `rename` de `writeProjectFolder`,
  algunos archivos quedan actualizados y otros no. Aceptable según la decisión 4 del coordinador
  ("adelanto de OP-14 §3"); una transacción completa (p. ej. vía un directorio `.tmp` hermano con
  rename atómico de todo el árbol) queda para OP-14 si hiciera falta.
- `DesktopStore` no está enchufado en `main.tsx` (fuera de mi propiedad): ver bootstrap abajo.
- Los métodos históricos de `ProjectStore` en `DesktopStore` son un puente de compatibilidad
  mínimo, no el flujo pensado a largo plazo (`createProject`/`openProject`/`saveProject`); cuando
  `App.tsx` adopte ese flujo directamente, probablemente dejen de hacer falta.

## Entrega a A

**Bootstrap para `main.tsx`** (no lo edito yo; es del integrador):

```ts
import { BrowserStore } from './store/BrowserStore';
import { DesktopStore } from './store/DesktopStore';

const store = typeof window.lila !== 'undefined' ? new DesktopStore() : new BrowserStore(/* semilla actual */);
```

`DesktopStore` sin argumento usa `window.lila` por defecto (lanza un error claro si no existe, así
que el `typeof window.lila !== 'undefined'` de arriba debe evaluarse antes de construirlo, no
dentro de un `try`).

**Peticiones concretas**:

1. Declarar `problems?: readonly { file: string; message: string }[]` opcional en `ProjectDocument`
   (`apps/web/src/store/ProjectStore.ts`) — hoy `DesktopStore` lo expone por separado
   (`get lastProblems()`) porque el tipo de A no lo tiene.
2. Evaluar mover `ProjectDocument`/`ScenarioDocument`/`StoredRun` a un paquete compartido (p. ej.
   `packages/contracts`) sin `rootDir` propio, para que `apps/desktop` deje de mantener una copia
   manual en `projectTypes.ts` (ver decisión 1).
3. `apps/web/src/store/BrowserStore.ts` todavía no implementa `ProjectSessionStore`
   (`createProject`/`openProject`/`saveProject`) — hoy solo `ProjectStore`. El bootstrap de arriba
   asume que se completa en algún punto para que ambas modalidades ofrezcan el mismo contrato a
   `App.tsx`; no lo toqué porque es de A.
