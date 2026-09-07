# Perfil de ejecución con cuota limitada: Codex + Claude Code

Este perfil reemplaza la recomendación inicial de abrir seis sesiones manuales. Conserva los 18 tickets y seis responsabilidades A–F, pero las atiende con **dos orquestadores y hasta tres subagentes activos**. Tiene precedencia sobre la asignación de instancias de LANZAMIENTO.md y los seis prompts individuales; los criterios de aceptación de los tickets permanecen.

## Instancias y modelos

| Plataforma | Sesiones que Brito abre | Subagentes activos | Responsabilidad |
|---|---:|---:|---|
| Codex | 1 orquestador | Máximo 1; reutilizar o rotar por bloque | A: shell/integración. Subagente alterna C: BPMN y D: motor |
| Claude Code | 1 orquestador | Máximo 2 | Un subagente B: escritorio/archivos y otro E: escenarios/comparación. El coordinador asume F: aceptación/empaquetado e integración de su equipo |
| Total | **2** | **Hasta 3** | **Máximo 5 contextos activos**, no cinco cuotas independientes |

No crear un orquestador por ticket ni suborquestadores dentro de los trabajadores. Si los dos subagentes Claude están ocupados, F prepara aceptación y revisa integraciones; la implementación mecánica de builder/tests se asigna al primer trabajador liberado, con transferencia explícita de archivos. En Codex, C y D no trabajan simultáneamente salvo que el usuario cambie este presupuesto.

**Selección explícita de Brito, que prevalece sobre el perfil económico anterior:**

| Rol | Modelo | Esfuerzo y regla de escalado |
|---|---|---|
| Orquestador Codex | **GPT-6 Astra** | Medio como punto de partida; alto para una decisión/conflicto concreto. Delegar implementación, mantener arquitectura/integración/revisión |
| Trabajador Codex de BPMN/motor/estado complejo | **GPT-5.6 Sol** | Medio; alto solo al reproducir un fallo difícil. No heredar Astra por defecto |
| Trabajador Codex mecánico/acotado | **GPT-5.6 Luna** | Bajo/medio: documentación breve, configuración acotada, implementación clara o pruebas dirigidas. Escalar a Sol si falla por complejidad |
| Orquestador Claude Code | **Fable**, según la configuración disponible de Brito | Usar Fable 5 con Ultracode si ese es el perfil existente; concentrarlo en decisiones e integración |
| Trabajador Claude habitual | **Sonnet** | Implementación de Electron, persistencia, formularios, pruebas y empaquetado con contrato definido |
| Trabajador Claude especializado | **Opus** | Solo seguridad del IPC, fallo complejo de almacenamiento, concurrencia o revisión difícil; después devolver trabajo rutinario a Sonnet |

Opus aquí es una escalada de calidad, no se presenta como más barato que Sonnet. No lanzar todos los subagentes con Opus ni heredar Fable/Astra por comodidad. No crear trabajadores Fable/Astra. Máximo un escalado costoso por equipo a la vez, conservando el límite total de trabajadores.

El modelo Fable procede de la preferencia de Brito y de su skill local; no se verificó su disponibilidad ni alias CLI en esta auditoría. Verificar el selector antes de arrancar. Si no existe, usar Opus como alternativa de coordinador grande y dejarlo indicado, sin inventar un identificador o instalar otro proveedor. No modificar una selección válida de Fable. La selección de modelos no autoriza API/extra usage de pago.

Los subagentes de Codex deben nacer con contexto acotado y modelo explícito: Sol o Luna. En esta herramienta, para poder sobrescribir el modelo se utiliza un contexto nuevo o reducido, no un fork completo que hereda Astra. Entregar el ticket activo, contrato y rutas, no toda esta conversación. En Claude elegir Sonnet/Opus explícitamente en la invocación o definición del trabajador y comprobar que no haya una configuración que fuerce el modelo del padre. [Subagentes Codex](https://learn.chatgpt.com/docs/agent-configuration/subagents), [subagentes Claude](https://code.claude.com/docs/en/sub-agents).

Modelos menores y contexto acotado pueden extender el cupo; no hay una conversión fija entre porcentaje restante y tickets terminados. [Guía oficial de uso](https://learn.chatgpt.com/docs/pricing).

## Saldo observado y límites reales

Consulta de cuenta en esta conversación: Codex mostraba **77 % usado / 23 % restante** en una ventana semanal y reinicio **7 de septiembre de 2026, 08:03:02, America/Mexico_City**. Es un snapshot; leerlo de nuevo al arrancar. No convertir ese 23 % en horas o número garantizado de tickets. El saldo ordinario de créditos figuraba en cero. Aparecían tres restablecimientos gratuitos disponibles, distintos de créditos comprados; **Brito indicó expresamente «No usar restablecimientos; conservarlos»**. No consumirlos esta noche ni intentar sortear esta restricción.

La cuota de Spark aparecía separada y sin consumo en la consulta, pero no asumir que está habilitada en cualquier sesión ni que soporta el mismo flujo. Puede reservarse para tareas pequeñas si el selector y límites vigentes confirman acceso; la cadena crítica no dependerá de ese fallback.

No se consultó el saldo privado de Claude. Al iniciar, comprobar `/usage` en su interfaz y registrar ventanas/reset si están disponibles; si un agente no puede consultar porcentajes programáticamente, debe decir «no disponible», no inventar un monitor. El plan de 100 dólares no prueba cuánta capacidad queda esta noche. [Comandos oficiales de Claude Code](https://support.claude.com/en/articles/14553413-claude-code-cheatsheet).

Más subagentes consumen más contexto y trabajo de modelo; no crean otra bolsa de uso. Claude comparte el uso entre sus superficies. Un límite duro bloquea nuevas solicitudes hasta que el servicio vuelva a admitirlas; compactar el contexto no restablece la cuota. [Subagentes Codex](https://learn.chatgpt.com/docs/agent-configuration/subagents), [límites de Claude](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work), [errores de cuota Claude Code](https://code.claude.com/docs/en/errors).

## Orden para producir algo útil antes del corte

Las rondas son dependencias lógicas. Cada OP grande se divide en incrementos con valor propio; no asignar sus tres tickets completos a un trabajador en una sola petición.

| Prioridad de la sesión | Codex | Claude Code |
|---|---|---|
| 1. Desbloquear | A fija contrato de proyecto/estado y reutiliza los PR web. Subagente integra correcciones existentes C/D por bloques, sin reescribirlas | B crea Electron arrancable; E revisa CompareView. F prepara el build de app y aceptación |
| 2. Primer recorrido | OP-07 mínimo: validar → Worker → Resultados; C cierra import/export sin pérdida | OP-08: abrir/guardar carpeta y escenarios. E cierra moneda/avisos. F produce una primera `.app` |
| 3. Uso propio | OP-13 mínimo: nuevo/abrir proyecto, dos escenarios y comparar; OP-15 básico de edición | OP-14 guardado/cierre seguro. E conecta parámetros y escenarios válidos; F prueba reinicio |
| 4. Confianza | D resuelve métricas P0 y A integra el recorrido final | F ejecuta OP-18 sobre el artefacto, E deja guía de arranque |
| 5. Si queda cupo | Resto de diagnósticos y pruebas justificadas | Calendario visual, otros sistemas y documentación adicional |

Los criterios originales siguen abiertos cuando solo se completó un incremento. Una app que abre pero aún pierde datos no se etiqueta como beta lista. Una primera app sirve como checkpoint para que el siguiente agente continúe sin volver a montar la infraestructura.

F puede construir desde la rama Claude para probar su escritorio con el último checkpoint de Codex. Esto evita que todo el trabajo de Electron espere a que A haya terminado la UI completa.

## Política de consumo y reserva

Umbrales de operación elegidos para esta noche, no propiedades del proveedor:

- En Codex, consultar saldo **al terminar un incremento o antes de empezar uno grande**; no por cada comando ni mediante consultas periódicas cuando no hay trabajo. Con más de 15 % restante, máximo un trabajador. Entre 8–15 %, solo incrementos P0 que puedan cerrarse pronto. Entre 5–8 %, no abrir nuevos frentes: cerrar, integrar y probar. Por debajo de 5 %, usar la reserva para entrega, errores críticos y evidencia, sin intentar apurar hasta cero deliberadamente.
- En Claude, observar todas las ventanas que `/usage` muestre. Cerca de agotamiento de cualquiera, pasar de dos trabajadores a uno y priorizar terminar el bloque en curso. Si el cupo exacto no está disponible, mantener bloques de unos 15–30 minutos de alcance y checkpoints frecuentes; el tiempo no predice cuota, solo limita trabajo sin registrar.
- No llamar al modelo para ejecutar un loop de espera, resumir logs sin cambios o pedir a cada trabajador otra auditoría completa del proyecto. Pasar solo el ticket activo, contrato y archivos relevantes. El inventario completo se lee una vez por coordinador; los trabajadores no tienen que cargar los 28 documentos.
- Pruebas dirigidas por cambio; batería completa una vez por checkpoint integrado significativo, serializada. No repetir una suite verde si no hay cambios o dudas que lo justifiquen.
- No comprar créditos, activar extra usage, pasar a API de pago, cambiar de cuenta ni consumir resets sin autorización específica. No poner un reintento infinito alrededor de un error de cuota.

## Checkpoints que no dependen de un último mensaje

El corte puede ocurrir después de editar y antes del commit. Por eso se trabaja así:

1. **Antes de editar**, escribir `estado/OP-xx-<equipo>.md`: dueño, worktree/rama, HEAD, incremento actual, próximo comando y archivos previstos. Es un archivo de ese equipo, no un registro compartido que ambos pisan.
2. Completar un incremento pequeño, guardar archivos y actualizar las pruebas ejecutadas. Hacer commit de los archivos exactos del incremento; evitar `git add .` o incluir datos ajenos.
3. Si hace falta interrumpir antes de tener pruebas verdes, se permite un commit `wip(OP-xx): ...` en la rama propia, con estado **no verificado**. Un WIP preserva trabajo, no entra en la rama entregable como si pasara aceptación.
4. Tras el commit actualizar el reporte con SHA recuperable y siguiente paso. El reporte también se versiona. No esperar a tener el OP completo para producir el primer commit.
5. Publicar un archivo de disponibilidad `estado/equipo-codex.md` o `estado/equipo-claude.md`: qué commits están listos para consumir, qué tareas siguen activas, próxima dependencia y si cede tareas. Cada equipo escribe solo el suyo.

La promesa razonable es preservar commits previos y conservar el worktree con cambios en disco. Ningún prompt garantiza salvar un razonamiento que no llegó a ejecutarse ni hacer un commit después de que el servicio dejó de responder. Las sesiones de agentes no se deben eliminar, y los worktrees con cambios no se limpian.

## Aislamiento y ramas concretas

Asumimos ambas herramientas en esta Mac. Usar worktrees persistentes nombrados, no depender de un worktree temporal que pueda desaparecer al limpiar una sesión. Ya existían 13 worktrees de PR en la auditoría: tratarlos como entradas, no reutilizarlos para editar sin comprobar quién trabaja allí.

- Codex A: `codex/operativo-20260906`, worktree `../lila-wt-integracion`.
- Codex C/D: `codex/op-c-bpmn` y `codex/op-d-engine`, worktrees propios; un trabajador activo a la vez. Terminar/cerrar el trabajador anterior antes de asignar otro dueño a la misma ruta.
- Claude coordinador/F: `codex/claude-entrega-20260906`, worktree `../lila-wt-claude`.
- Claude B/E: `codex/op-b-desktop` y `codex/op-e-paneles`, worktrees propios.

Los seis roles se ejecutan con cinco contextos simultáneos como máximo y seis directorios persistentes; el directorio C o D puede estar inactivo. F no necesita otro contexto permanente. No asumir que un subagente crea worktree automáticamente: comprobar y pasar su cwd exacto; si la herramienta comparte cwd, cambiarlo explícitamente para sus comandos o ejecutar ese bloque secuencialmente. La interfaz de Claude ofrece `isolation: worktree`, pero para esta noche se prefieren directorios nombrados conservados por los coordinadores.

Al inicio **Codex es el único que prepara el commit común del plan** desde el checkout original preservando cambios ajenos; Claude no añade archivos allí. Claude puede leer su prompt y preparar su alcance mientras espera a que exista el commit/rama común. Después crea su rama desde ese checkpoint. No hacer commits de implementación en el checkout original.

Mismo host: intercambiar por ramas locales y `git show rama:ruta-del-reporte`, sin red ni transcripción de mensajes. Otros hosts: publicar solamente las ramas de trabajo en el remoto privado autorizado, nunca main/release, y usar fetch. Si push no está autorizado, conservar commits locales; no prometer failover entre equipos que no pueden transportar commits.

## Qué pasa si uno se queda sin uso

- El proveedor aún activo continúa **sus propios tickets**. Un silencio no autoriza tomar el worktree ajeno ni matar sus procesos.
- Consumir solo SHAs que el otro equipo marcó listos/verificados. HEAD de una rama ajena no significa terminado. Si hay WIP, tratarlo como entrada a revisar.
- Codex mantiene la rama canónica de integración. Si Codex deja de responder, Claude puede crear `codex/claude-candidato-20260906` desde el último checkpoint verificado, integrar sus propios commits listos y producir un artefacto candidato allí. No mueve la rama canónica ni anuncia un merge a main.
- Si Claude se detiene, Codex puede crear análogamente una rama candidata para integrar los commits B/E/F publicados. Priorizar el recorrido Mac y posponer extras.
- Solo continuar **el trabajo ajeno inacabado** tras una cesión explícita escrita por el dueño, o estado de sesión detenido/cuota agotada verificable. Continuar en un worktree nuevo desde el último commit, nunca en la carpeta donde pudo quedar un escritor. Si solo hay silencio, seguir tareas propias o una revisión de los commits publicados.
- Si ambos agotan uso, se detiene trabajo de modelo. Tests/builds ya iniciados pueden seguir si sus procesos y el equipo siguen vivos; no asumir que la plataforma los conserva. La reanudación necesita una sesión activa cuando haya cuota o un mecanismo externo expresamente configurado. Este plan no instala un scheduler ni presume reanudación automática al reset.

## Recuperación mínima

Usar [PROMPT-RECUPERACION.md](PROMPT-RECUPERACION.md). Leer reportes, `git log`, estado de worktrees y SHAs; preservar cambios no committed. No repetir la auditoría inicial. Verificar lo heredado y retomar el próximo incremento. Si el equipo inicial vuelve, no reanudar dos escritores sobre el mismo ticket: reconocer la cesión/rama candidata primero.

La Mac debe permanecer encendida y las sesiones locales disponibles. No cambiar permisos globales ni usar flags de bypass para evitar pausas: conservar Auto/permisos autorizados, verificar al comienzo que edición/Git/npm en los worktrees funcionan y registrar cualquier bloqueo real.

## Entregables de este perfil

Dos prompts para pegar: [Codex](PROMPT-CODEX.md) y [Claude Code](PROMPT-CLAUDE.md). Los informes/commits/artefactos se generan al ejecutar. Hasta entonces los tickets permanecen pendientes. Este perfil está preparado sin lanzar agentes ni consumir restablecimientos.
