# OP-07 Codex A
Dueño A; rama codex/operativo-20260906; base 91573b2 + OP03 4e26fc4.
Archivos: App.tsx, simulationGate.ts, tests App/validación, CSS.
Objetivo: gate compartido de validación, modos/resultados, invalidación y cancelación.
Próximo comando: implementar gate antes de Worker y pruebas de carreras.
Estado: activo, no verificado.

Incremento verificado dirigido: 9 tests App/gate + 18 worker/cliente pasan; typecheck web PASS. Validación antes de crear Worker, avisos conservados, cancelación durante parse/worker, descarte de resultados/progreso tardíos, cleanup y modos Modelar/Simular/Resultados.
Decisión: montar siempre Modeler y ocultarlo en Resultados conserva undo. Revisiones numéricas conservadoras invalidan también hijos extends. Inputs guardados en historial en memoria; persistencia se conecta en OP-13. No se declara OP-07 completo hasta aceptación Worker real empaquetado.
Próximo: combinar OP04, suite completa y OP13.
