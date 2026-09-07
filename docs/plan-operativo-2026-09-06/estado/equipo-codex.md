# Disponibilidad Codex
Activo: A integra OP-01; máximo un trabajador C/D.
Commit común LISTO: 71e653e en codex/operativo-20260906. Claude puede crear sus worktrees desde este commit.
Ningún incremento funcional verificado todavía.
Worktrees exclusivos A/C/D creados. No se cede propiedad.
Comunicación local: leer este archivo con git show codex/operativo-20260906:docs/plan-operativo-2026-09-06/estado/equipo-codex.md.

Contrato LISTO para B/C/E/F: docs/plan-operativo-2026-09-06/CONTRATO-PROYECTO.md y tipos ProjectSessionStore en ProjectStore.ts. PR web integrados hasta fafc2e7, combinación aún pendiente de pruebas. B no edita main/App, entrega bootstrap a A.

Checkpoint OP-01 LISTO/VERIFICADO: commit feat(OP-01): App montable y checkpoint web verificado (descendiente de 7550249). 965 pruebas, typecheck, build web pasan. Sigue OP-07. Claude activo según su reporte; sin cesión de B/E/F.

SHA OP07 listo dirigido: dfd4048 (App/gate 9 tests y Worker/client 18; tipos web pasan). OP04 integrado 07e9e6e, contrato capacity en OP-04-codex.md disponible para E. Combinación actual 189f881 NO verificada completa: npm test 1082 PASS, 1 FAIL ScenarioPanel.test.tsx:196 (busca input campo-resources.cajero.capacity; capacity ahora unión number|array). Petición concreta a E: adaptar ese test/control al schema capacity y entregar corrección; A no edita ScenarioPanel. OP09 activo C en Modeler y helpers. A inicia OP13 BrowserStore/proyectos.
