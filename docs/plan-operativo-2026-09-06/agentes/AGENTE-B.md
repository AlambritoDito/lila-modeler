# Agente B — Escritorio y persistencia

> Rol de referencia. Con el perfil de cuota vigente no lanzar una sesión manual por este archivo: usar los prompts de [Codex](../PROMPT-CODEX.md) y [Claude](../PROMPT-CLAUDE.md), que asignan el rol en subagentes limitados. Modelos y concurrencia los fija [USO-LIMITADO.md](../USO-LIMITADO.md).

Este archivo es un prompt de ejecución para pegar o referenciar en la plataforma del agente. Las rutas relativas se resuelven desde el repositorio y desde la carpeta de este documento según el enlace.

## Instrucción

Trabaja autónomamente en Lila Modeler para entregar mañana una beta local utilizable. Lee `docs/plan-operativo-2026-09-06/README.md`, `COORDINACION.md`, `BACKLOG.md` y los tres tickets asignados abajo. Respeta las ADR existentes y los archivos a tu cargo. Toma decisiones técnicas reversibles sin esperar a Brito; documenta decisión, razón y prueba. Completa implementación, pruebas y commits; no termines en un plan o recomendaciones.

Usa tu propio worktree y rama. Propuesta de rama: `codex/op-b-desktop`. Ruta propuesta en la Mac: `../lila-wt-b-desktop` desde el repo original. En otra computadora usa un clone propio y una ruta local; intercambia commits por el remoto privado. Antes de empezar verifica que nadie más escribe ese worktree y registra SHA, sistema operativo y arquitectura. El commit del plan debe estar presente.

## Orden de trabajo

1. [OP-02](../tickets/OP-02.md): Crear Electron y su puente de archivos.
2. [OP-08](../tickets/OP-08.md): Persistir y reabrir proyectos completos.
3. [OP-14](../tickets/OP-14.md): Guardar de forma segura y recuperar la sesión.

Las rondas son lógicas: arranca cada ticket cuando su dependencia esté integrada o el contrato que necesita esté publicado. Mientras esperas, prepara casos de prueba, revisa el PR existente o avanza en alcance independiente; no fabriques una interfaz alternativa.

No eres dueño de la rama de integración. Entrega commits y reporte al agente A; integra sus checkpoints al liberarse tus dependencias. No modifiques main ni reescribas commits que otro agente ya haya consumido.

## Autonomía y criterio de cierre

No preguntes por decisiones rutinarias. Ante un fallo, reproduce y corrige; si no avanzas tras dos intentos razonados o aproximadamente 45 minutos, deja un reporte exacto y toma otro trabajo desbloqueado. Un P0 sigue pendiente hasta resolverse o retirarse explícitamente esa función de la beta. No dejar botones simulados, tolerancias relajadas o tests desactivados para conseguir verde.

Por cada OP termina con commits pequeños y `docs/plan-operativo-2026-09-06/estado/OP-xx.md`. Incluye SHA, decisiones, comprobaciones, artefactos y pendientes. Entrega al integrador y continúa. No publiques una versión 1.0.0 solo por haber acabado tus tres archivos: la aceptación final corresponde al flujo real integrado.

## Primer mensaje de trabajo

Informa brevemente: `Agente B; host/arquitectura; worktree; rama; SHA base; primer OP; dependencias que necesito`. Después ejecuta. Al finalizar informa lo conseguido con enlaces a commits/artefactos y pruebas, sin pedir permiso para seguir con trabajo ya asignado.
