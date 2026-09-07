# Qué abrir y qué pegar esta noche

**Abre una instancia principal en Codex y una en Claude Code.** Esta es la configuración vigente, adaptada al 23 % de Codex observado y a la instrucción de conservar los restablecimientos gratuitos. Los seis roles y 18 tickets del plan original siguen vigentes; no se lanzan seis orquestadores.

| Dónde | Orquestador | Trabajadores simultáneos | Qué pegar |
|---|---|---|---|
| Codex, proyecto Lila Modeler | Astra | Máximo 1: Sol para lógica compleja; Luna para trabajo acotado | [PROMPT-CODEX.md](PROMPT-CODEX.md) |
| Claude Code, mismo repositorio local | Fable, si está disponible en tu configuración | Máximo 2: Sonnet habitual; Opus para bloques difíciles | [PROMPT-CLAUDE.md](PROMPT-CLAUDE.md) |

Son **dos sesiones que tú abres y hasta cinco contextos activos en total**. Codex implementa A mediante bloques delegados y rota C/D; Claude coordina B/E y asume F sin otra instancia permanente. No asignar el mismo ticket a ambos ni heredar Astra/Fable a los trabajadores.

## Paso 1: Codex

Selecciona Astra en una tarea del proyecto local Lila Modeler. Pega el contenido completo de PROMPT-CODEX.md. Como entrada corta alternativa, pega:

```text
Lee /Users/brito/development/Lila Modeler/docs/plan-operativo-2026-09-06/PROMPT-CODEX.md y ejecútalo completo. Usa Astra como orquestador y como máximo un subagente activo, con Sol o Luna explícito según el trabajo. Conserva todos los restablecimientos gratuitos. No gastes cuota en rehacer el plan; prepara la base común, integra y ejecuta.
```

Codex prepara el commit común de documentos y la rama de integración preservando cambios existentes. Su implementación va en worktree exclusivo. No usar aquí una tarea que esté modificando otro proyecto.

## Paso 2: Claude Code

Abre una sola sesión local en este repositorio con tu coordinador Fable. Pega el contenido de PROMPT-CLAUDE.md. Entrada corta alternativa:

```text
Lee /Users/brito/development/Lila Modeler/docs/plan-operativo-2026-09-06/PROMPT-CLAUDE.md y ejecútalo completo. Usa Fable como orquestador si está disponible y como máximo dos subagentes activos: Sonnet habitual, Opus solo para bloques difíciles. Codex prepara la base común; no escribas el checkout original ni su rama canónica. No habilites gasto adicional. Ejecuta escritorio, escenarios y empaquetado en tus worktrees.
```

Puedes iniciar ambos al comienzo; Claude revisa su alcance mientras aparece el checkpoint de Codex. No hace falta que compartan memoria de conversación: comparten SHAs y reportes por Git local. Si Claude no muestra Fable, el prompt contempla Opus como coordinador grande alternativo y pide dejarlo indicado, sin inventar comandos/modelos.

La instalación CLI local confirmó comandos claude y codex, pero estos prompts están pensados para las sesiones que tú seleccionas. No es necesario activar modos experimentales, cambiar permisos o usar bypass. Mantener Auto/permisos autorizados y comprobar al principio que los worktrees permiten las operaciones Git/npm del trabajo.

## Cuando se agote uso

El trabajo queda en commits pequeños, reportes y worktrees persistentes. El otro proveedor sigue con sus tareas y puede construir una rama candidata con commits ya verificados. No toca un worktree ajeno ni se apropia de una tarea activa por mero silencio. Ver [USO-LIMITADO.md](USO-LIMITADO.md).

Si ambas cuentas dejan de admitir solicitudes, el modelo deja de trabajar. Este plan no activa un monitor, scheduler ni reinicio automático de sesiones al reset. Los scripts de build/tests ya iniciados pueden continuar si sus procesos permanecen vivos, pero no crean nuevas decisiones de implementación.

Cuando vuelva a haber cuota, reanuda la sesión original o pega [PROMPT-RECUPERACION.md](PROMPT-RECUPERACION.md) en la plataforma disponible. Debe leer los checkpoints y verificar qué agentes siguen activos antes de escribir.

## Resultado exigido

Un artefacto Mac probado sin Vite, commits identificados y guía para abrir/guardar/simular/comparar. Windows/Linux y extras avanzan con el cupo restante y se reportan según su nivel real de prueba. No borrar worktrees ni sesiones con cambios pendientes.

El detalle de cuotas, reserva, selección de modelos y continuidad está en [USO-LIMITADO.md](USO-LIMITADO.md). La plantilla de reporte está en [PLANTILLA-CHECKPOINT.md](PLANTILLA-CHECKPOINT.md).
