# Plantilla de checkpoint

Copiar a `estado/OP-xx-codex.md` o `estado/OP-xx-claude.md` dentro del plan, en la rama del dueño. Crear antes de editar y actualizar después del incremento/commit. No usar un mismo archivo mutable para los dos equipos.

```text
OP e incremento:
Equipo y responsable:
Modelo trabajador:
Host/arquitectura:
Worktree absoluto:
Rama:
SHA base:
SHA del código recuperable:
Estado: en-curso | listo-verificado | wip-no-verificado | bloqueado
Archivos a mi cargo:
Objetivo pequeño de este incremento:
Decisión / razón:
Qué quedó implementado:
Pruebas ejecutadas y resultado:
Qué NO está verificado:
Cambios todavía sin commit:
Próximo comando o acción concreta:
Dependencia que espero:
Artefacto y SHA de origen, si existe:
Sesión trabajadora: activa | detenida-confirmada | desconocida
Cesión a otro equipo: no | sí, con alcance y motivo
```

`listo-verificado` requiere aceptación comprobada. `wip-no-verificado` permite preservar trabajo parcial sin declararlo integrado. La marca de tiempo por sí sola no prueba que el escritor dejó de estar activo. No incluir credenciales ni volcar configuración privada en estos reportes.
