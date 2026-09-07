Ejecuta el plan de Lila Modeler como orquestador Claude Code. El repositorio original es `/Users/brito/development/Lila Modeler`. La meta es una beta Mac que abra sin Vite, trabaje con modelos y escenarios propios, guarde sin perder trabajo y permita simular y comparar. Trabaja autónomamente, toma decisiones reversibles con las ADR existentes y entrega commits y artefactos verificados; no termines con sugerencias para que Brito integre a mano.

Lee primero `docs/plan-operativo-2026-09-06/USO-LIMITADO.md`. Ese perfil reemplaza las seis instancias manuales del plan anterior. Lee luego los contratos/worktrees de `COORDINACION.md` y los tickets que vayas a ejecutar. No cargues todo el historial o inventario en cada trabajador.

Usa **Fable como modelo grande de coordinación**, con Fable 5/Ultracode si es la configuración disponible de Brito. Verifica el selector: no inventes un alias CLI. Si Fable no está disponible, utiliza Opus como alternativa de coordinador grande y deja constancia. Conserva la configuración válida de Fable y los ajustes Auto/permisos existentes.

Divide el trabajo en **dos subagentes económicos como máximo**, con contexto acotado, modelo explícito y worktrees distintos:

1. B, **Sonnet**: Electron, preload/IPC, DesktopStore y guardado seguro. OP-02 → OP-08 → OP-14, en incrementos pequeños. Rama `codex/op-b-desktop` y worktree propio.
2. E, **Sonnet**: comparación con moneda/avisos, edición de escenarios y guía. OP-05 → OP-11 → OP-17, dando prioridad a campos funcionales sobre calendario visual/temas. Rama `codex/op-e-paneles` y worktree propio.

Usa **Opus como subagente solo para un bloque difícil** de seguridad de IPC, almacenamiento, concurrencia o diagnóstico que lo justifique; vuelve a Sonnet al terminar. No heredar Fable a todos los trabajadores. No crear suborquestadores ni permitir delegación recursiva. Cada despacho lleva incremento/OP, base SHA, cwd exclusivo, archivos permitidos, entregable y prueba. Si un agente no puede ejecutar en su worktree, no lo dejes escribir desde el cwd compartido del padre: resuelve el aislamiento o ejecuta el bloque secuencialmente.

Tú coordinas B/E y asumes F: arquitectura de aceptación, integración de tu equipo, preparación de instaladores y prueba final. Delega los cambios mecánicos de OP-06/OP-12 al primer trabajador libre, transfiriendo explícitamente los archivos; nunca añadas un tercero para saltarte el límite. Usa el modelo grande para decidir, revisar e integrar, no para reescribir componentes que los trabajadores pueden implementar.

Codex/A prepara el commit común del plan y publica el contrato ProjectStore/estado/Modelador. No hagas commits ni cambios en el checkout original mientras Codex lo prepara. Puedes leer/revisar el alcance hasta que exista la base común. Entonces crea tu worktree de coordinación `../lila-wt-claude` y rama `codex/claude-entrega-20260906` desde ese checkpoint; B y E parten de esa misma base. Ya hay worktrees de PR en este equipo: no tomarlos como directorios libres ni eliminarlos.

No escribas la rama canónica `codex/operativo-20260906`, el shell/estado de A, Modeler/parser de C ni core/scenario de D. Pide contratos con un reporte concreto; no construyas interfaces incompatibles mientras esperas. Puedes avanzar main/preload, tests, configuración de builder y revisión de los componentes existentes en paralelo a los contratos.

Entrega primero una app Electron que carga la SPA y el Worker, después lectura/guardado de carpeta y escenarios, protección dirty/cierre y comparación interpretable. Configura el empaquetado temprano y verifica con Vite apagado. Los recursos usan rutas compatibles con la app empaquetada, incluido el tema y las fuentes. La app final debe leer y reabrir datos propios, no depender de los fixtures compilados en la demo.

Antes de editar cada incremento, escribe `estado/OP-xx-claude.md` con dueño, worktree/rama, HEAD, archivos y próximo comando. Haz commits pequeños tras avances significativos, con pruebas y próximo paso en el reporte. Un WIP no verificado puede preservar trabajo en una rama propia; no se integra como ticket terminado. No esperes a agotar uso para escribir el resumen. Conserva worktrees y archivos si la sesión corta antes del commit.

Publica solo tu disponibilidad en `estado/equipo-claude.md`, incluyendo SHA listo para consumo y tarea activa. Lee reportes de Codex desde su rama usando Git; no supongas que el HEAD ajeno es verificado. En esta Mac basta Git local. No hace falta que Brito copie mensajes entre las plataformas.

Al inicio observa `/usage` o el indicador disponible. No supongas un porcentaje a partir de la suscripción. Si el agente no tiene acceso programático al saldo, registra «no disponible». Al acercarte a un límite, reduce de dos trabajadores a uno, termina/commitea bloques P0 y reserva el último esfuerzo para integración, app y evidencia. No consultes uso después de cada comando ni gastes turnos esperando sin cambios.

**No comprar ni activar extra usage, no pasar a API de pago, no cambiar de cuenta ni intentar evadir el límite. Los restablecimientos de Codex deben conservarse, por instrucción explícita de Brito.** Compactar contexto no restablece cuota. Un corte puede impedir el último commit; los checkpoints previos y el worktree conservado son la recuperación. No crear loops infinitos de reintentos ni afirmar que habrá continuación automática al reset.

Si Codex deja de responder, sigue B/E/F y consume únicamente sus commits listos. Puedes producir `codex/claude-candidato-20260906` desde su último checkpoint verificado más tus commits, con un instalador candidato. No muevas su rama canónica ni toques sus carpetas. Para continuar trabajo suyo incompleto exige cesión explícita o estado detenido/cuota agotada verificable; hazlo en un worktree nuevo. Un silencio no es una cesión.

No empujar a main, publicar releases/npm, desplegar, contactar producción ni usar datos reales de clientes. Si las herramientas están en hosts distintos, usa solo ramas privadas de trabajo cuando su publicación ya esté autorizada; en esta Mac usa Git local. Conserva los permisos y ajustes de la sesión; no desactives protecciones para evitar pausas.

Pruebas dirigidas mientras implementas; coordina con A para serializar las suites completas. OP-18 debe probar el artefacto del SHA final con Vite detenido: crear/abrir carpeta, editar BPMN, guardar, cerrar/reabrir, ejecutar dos escenarios, comparar y exportar CSV. Comprobar cancelación, ids ajenos y fallos de guardado. Windows/Linux avanzan si hay cupo y runners, indicando qué fue compilado y qué realmente se instaló/probó.

Entrega rama/SHA, ubicación de app/DMG, guía de apertura y reportes de pruebas por sistema. No elimines worktrees al terminar. Después de cada bloque terminado toma el siguiente desbloqueado; solo cierra cuando el alcance asignado esté entregado o haya un bloqueo externo concreto, no porque completaste el primer ticket.
