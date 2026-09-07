# Protocolo autónomo: seis responsabilidades, worktrees y varias plataformas

**Perfil vigente:** [USO-LIMITADO.md](USO-LIMITADO.md) distribuye estas responsabilidades entre dos orquestadores y hasta tres subagentes. Sus límites de cuota, modelos, ramas y recuperación prevalecen sobre los ejemplos de seis sesiones de este documento. El coordinador Claude asume F; no hace falta abrir una sesión F adicional.

## Autoridad y modo de trabajo

Brito pide que los agentes trabajen prácticamente sin supervisión, tomen decisiones técnicas razonables, terminen sus tickets con commits y entreguen una aplicación utilizable mañana. Este protocolo convierte esa intención en una secuencia verificable. No se usa la falta de supervisión como razón para omitir pruebas o declarar trabajo incompleto como terminado.

Todos leen `BACKLOG.md`, las ADR vigentes en `docs/DECISIONS.md` y el documento de estructura. Quien toque motor lee antes `docs/SEMANTICS.md`, `docs/SCENARIO_FORMAT.md` y `docs/RESULTS_FORMAT.md`. No había `AGENTS.md` aplicable encontrado durante la auditoría; volver a comprobar al iniciar porque puede aparecer después.

Valores por defecto para decidir sin preguntar:

- Electron según ADR-023, misma SPA y mismo motor. Persistencia en archivos de una carpeta elegida por el usuario; sin cuentas, base de datos ni servidor externo para uso local.
- macOS arm64 primero; macOS Intel, Windows x64 y Linux x64 según runners disponibles. Cada plataforma se declara verificada solo si hay evidencia en ese sistema/arquitectura.
- TypeScript, React, npm workspaces; reutilizar el código de PR existente. Estado sencillo con APIs de React, sin otra librería global si no resuelve un problema demostrado.
- Guardado explícito, indicador de cambios y confirmación nativa de guardar/descartar/cancelar al cerrar; copia de recuperación local si es viable. Ninguna escritura inválida sustituye un archivo válido sin decisión visible del usuario de la app.
- Documentar un borrador de escenario inválido como borrador; nunca permitir simularlo ni confundirlo con el último escenario válido. Separar tipo de documento editable del tipo resuelto validado.
- Dos resultados solo se comparan como actuales si corresponden a revisiones identificables del modelo y escenario. Mostrar moneda/unidad/semilla y advertencias; bloquear comparaciones sin significado definido, por ejemplo costos entre monedas distintas sin conversión.
- Mantener la semántica publicada del motor; si un bug exige cambiarla, fijar antes la decisión y un contraejemplo en test. No ajustar entradas de ejemplos para hacer coincidir resultados.
- Artefactos de beta local sin firma son aceptables para esta entrega; documentar la apertura conforme al sistema. No desactivar protecciones del sistema ni esperar certificados para completar una compilación local.

Para decisiones reversibles, elegir la opción más pequeña compatible con las ADR y escribir `Decisión / razón / prueba` en el informe del ticket. No generar una consulta a Brito por cada decisión. Si faltan credenciales, certificado o acceso a otro sistema, completar el trabajo independiente y registrar la limitación exacta.

## Aislamiento: comparación de opciones

| Organización | Resultado | Uso recomendado |
|---|---|---|
| Varios agentes, misma carpeta/checkout | Se pisan archivos, índice, rama y dependencias | Evitar |
| Varias ramas cambiadas con checkout en una sola carpeta | Cambiar rama mueve el suelo de todos | Evitar |
| Un worktree y rama por agente en la misma Mac | Archivos, índice, builds y dependencias separados; objetos Git compartidos | Opción de esta noche |
| Un clone por computadora + worktrees locales | Cada host trabaja aislado; las ramas se intercambian por Git remoto | Opción para Mac/Windows/Linux y servicios de agentes distintos |
| Dos agentes en un mismo worktree | Sigue existiendo competencia sobre archivos aunque sean proveedores diferentes | Evitar |

Codex, Claude Code u otras herramientas pueden consumir los mismos Markdown y comandos Git. El protocolo no depende de que compartan memoria de conversación. Un agente remoto no puede usar la ruta de un worktree de otra máquina: necesita su propio clone, rama y dependencias.

## Preparación por el integrador A

La creación de worktrees y commits descrita aquí es trabajo de la futura sesión; esta auditoría solo dejó el plan. No ejecutar ciegamente `git add .` sobre el proyecto del usuario.

1. Leer estado local/remoto, PR y agentes ya trabajando. Elegir una base actual, registrar su SHA y preservar todo cambio previo.
2. Incorporar estos documentos en un commit identificado del plan, seleccionando solamente `docs/plan-operativo-2026-09-06/`. Si otros cambios modificaron esos mismos archivos, revisarlos antes. Los nuevos worktrees deben recibir ese commit.
3. Crear una rama de entrega `codex/operativo-20260906` desde esa base. A es su único escritor y solo él integra ramas de otros agentes.
4. Crear worktrees y ramas individuales B–F desde el commit del plan. Al fusionarse dependencias, cada agente trae el checkpoint por `git merge`, sin reescribir una rama que otro ya esté consumiendo.

Ejemplo de comandos POSIX, desde el repositorio en esta Mac, **después de preparar el commit del plan**. Si una rama/ruta ya existe, inspeccionarla y reutilizarla o elegir un sufijo libre; no borrarla:

```sh
git status --short
git fetch origin
git worktree list
git worktree add -b codex/operativo-20260906 ../lila-wt-integracion HEAD
git worktree add -b codex/op-b-desktop ../lila-wt-b-desktop HEAD
git worktree add -b codex/op-c-bpmn ../lila-wt-c-bpmn HEAD
git worktree add -b codex/op-d-engine ../lila-wt-d-engine HEAD
git worktree add -b codex/op-e-paneles ../lila-wt-e-paneles HEAD
git worktree add -b codex/op-f-qa ../lila-wt-f-qa HEAD
```

Si `HEAD` local va por detrás del remoto al iniciar, usar primero la base vigente con el plan incorporado; no imponer el SHA de esta auditoría como el más reciente. El checkout original permanece disponible para el usuario. No hacer reset, clean, stash global ni cambios de rama sobre él.

En cada worktree: `npm ci` una vez para instalar sus dependencias desde el lockfile propio. **No compartir `node_modules`, `dist`, caché de build ni un servidor Vite entre worktrees.** Asignar puertos distintos cuando haya dos servidores: 5173 A, 5174 B, 5175 C, 5176 D, 5177 E y 5178 F. No levantar servidores que ese agente no necesite.

## Intercambio entre computadoras o plataformas de agentes

Publicar ramas de trabajo privadas en el remoto del proyecto cuando el entorno ya tenga acceso autorizado. Cada agente publica únicamente su rama. A publica los checkpoints de integración por la rama de entrega; otros hosts hacen fetch y merge de ella. No copiar directorios `.git`, binarios o `node_modules` entre sistemas.

Ejemplo de protocolo para un agente B en otra máquina:

```sh
git fetch origin
git switch codex/op-b-desktop
git merge origin/codex/operativo-20260906
# trabajar, verificar y hacer commits en B
git push -u origin codex/op-b-desktop
```

En un clone nuevo, crear la rama local siguiendo la remota si existe, o desde el checkpoint remoto acordado. En Windows PowerShell los comandos Git son los mismos; adaptar rutas y no pegar sintaxis de shell POSIX como si fuera PowerShell. El agente informa sistema operativo, arquitectura, SHA base y SHA entregado en cada reporte.

Si no hay permiso/conexión para push, seguir con commits y artefactos locales y entregar referencias o patches. No confundir esa limitación con fallo del código. El trabajo que requiere una rama en otro host queda explícitamente bloqueado por transporte, mientras los módulos independientes continúan.

## Contratos que A fija al principio

A escribe un pequeño documento de contrato versionado, coordinado con B y C. No necesita implementar todos los componentes para publicarlo:

1. `ProjectStore`: abrir/crear proyecto, listar/leer/escribir escenarios crudos, leer/escribir resultados con identidad de revisión, Guardar como y cancelación diferenciada de error. Añadir únicamente operaciones consumidas por la UI. Los paths físicos pertenecen al adaptador, los ids BPMN al dominio; no volver a usar un UUID de sesión como si fuera el id lógico del proceso.
2. Estado: proyecto/proceso seleccionado, XML/revisión, escenarios y sus revisiones, resultado por corrida, modo activo, cambios pendientes y estado de simulación. El resultado lleva o referencia un snapshot de sus entradas sin alterar innecesariamente `RunResult`.
3. Puente Electron: operaciones específicas a través de preload/contextBridge; renderer sin `fs`, `nodeIntegration: false`, `contextIsolation: true`, sandbox y validación de mensajes/paths en main. El renderer no recibe una primitiva para ejecutar comandos o leer arbitrariamente el equipo.
4. `Modelador`: observar selección y cambios semánticos, abrir transaccionalmente, exportar, nuevo diagrama y avisos de import. C es dueño de esa implementación; A consume la interfaz.

Contrato no implica la creación de otro paquete `shared`. Mantener las costuras existentes y documentar los tipos mínimos. Los mocks de pruebas deben reflejar el contrato, sin convertirse en una segunda implementación del producto.

## Propiedad de archivos y conflictos

| Archivos | Escritor responsable |
|---|---|
| Shell/App, estado global, navegación, bootstrap de stores y contrato de `ProjectStore` | A |
| Electron main/preload y `DesktopStore` | B |
| `bpmn/`, `Modeler.tsx`, propiedades y comandos del editor | C |
| `core/`, `scenario.ts`, schemas, formatos numéricos y semántica | D |
| `ScenarioPanel`, calendarios visuales, `CompareView`, traducciones locales y guía | E |
| Pruebas E2E, workflows de QA, configuración de empaquetado | F |
| `package-lock.json`, dependencias raíz y CSS global | A integra propuestas pequeñas; no seis editores concurrentes |

Los PR iniciales pueden tocar varios grupos de archivos. A integra los PR web; C los del parser; D los del motor. Antes de tocar un archivo de otro responsable, entregar un parche o acordar una transferencia explícita. En particular A no reimplementa métodos de `Modeler.tsx` durante OP-07: pide a C el contrato y recibe su commit. F no rehace el main de Electron para empaquetar; B proporciona su punto de entrada.

Cada agente registra sus dependencias nuevas en su entrega. A consolida manifiestos y regenera un solo lockfile por checkpoint; si un agente necesita instalar para desarrollar, usa su rama y reporta el delta para la integración. No resolver conflictos del lockfile eligiendo todo un lado sin revisar dependencias.

## Ciclo de ejecución e integración

1. Consultar dependencias y tomar el primer ticket asignado desbloqueado. Si espera código, avanzar en prueba reproducible, contrato o siguiente tarea independiente de su lista.
2. Implementar y ejecutar la aceptación del ticket. Hacer commits pequeños con `OP-xx` e issue de GitHub correcto; no un commit gigante de toda la noche.
3. Escribir `docs/plan-operativo-2026-09-06/estado/OP-xx.md` en la rama de trabajo con base/HEAD, estado, decisiones, pruebas, límites, artefactos y siguiente paso. Cada ticket tiene su archivo; no todos editan un mismo checklist.
4. Entregar rama/SHA a A. A revisa y fusiona la rama en la integración. En PR apilados integrar primero la base, después el hijo; no duplicar commits mediante mezclar merge y cherry-pick del mismo cambio.
5. A comprueba el checkpoint combinado y publica el SHA. Los consumidores integran ese checkpoint antes de iniciar trabajos que dependan de él. Los tests verdes individuales no sustituyen esto.
6. F toma snapshots del checkpoint integrado, no un worktree que A esté modificando mientras F prueba. Reporta fallos al dueño con pasos exactos; A integra la corrección y F repite solo lo afectado más la prueba de aceptación final.

Para traer un PR existente a una rama local, usar `gh pr checkout <número>` en un worktree dedicado o `git fetch origin pull/<número>/head:<rama-local-libre>`, inspeccionar su SHA y fusionar esa referencia. Nunca hacer checkout de PR en el worktree de otro agente. Consultar el inventario para el orden de bases.

Tras fallar una aceptación: reproducir, corregir y volver a medir. Si tras dos intentos razonados o unos 45 minutos no hay progreso, registrar el bloqueo concreto y seguir con una tarea independiente. Estos umbrales sirven para reasignar trabajo, no para cerrar el ticket. Los fallos P0 regresan al integrador; se resuelven o se retira la función afectada del alcance anunciado de la beta. No esconderlos.

## Verificación y entrega final

Por checkpoint significativo: `npm test`, `npm run typecheck`, `npm run build -w @lila/web`. Usar pruebas dirigidas durante el desarrollo y no ejecutar seis baterías completas a la vez en la misma Mac. A serializa las pruebas completas; F ejecuta pruebas de aceptación y builds pesados con un límite de concurrencia. En otros hosts CI puede correr en paralelo.

F construye desde el SHA final. La app debe poder abrirse cuando el servidor de desarrollo ya esté detenido. Comprobar carga de assets/tema/Worker y paths con espacios/tildes. No prometer igualdad byte a byte entre arquitecturas: el contrato vigente usa tolerancia donde corresponde; #211 queda pospuesto.

A entrega la rama integrada, un PR revisable si el flujo del repo lo permite, commits y ubicación del artefacto Mac; F entrega los resultados por plataforma. No es necesario publicar npm, mover un tag 1.0.0, activar auto-update ni fusionar a `main` para que Brito use el artefacto local mañana. La sesión puede culminar autónomamente con la beta compilada desde la rama de entrega. Si el usuario ya autorizó un flujo de merge/publicación en la sesión de ejecución, seguirlo; este protocolo no añade una aprobación por cada commit.

No eliminar worktrees con trabajo pendiente ni ramas al terminar. Conservar los informes y artefactos para que la mañana no empiece intentando reconstruir lo que pasó.
