# Ejemplos y fixtures de regresión

Lila es una herramienta de modelado y simulación BPMN. Los ejemplos muestran cómo construir un
modelo, definir supuestos, comparar escenarios e interpretar resultados. Esta política aplica a
los casos actuales y futuros, incluyendo documentación, capturas, textos de Issues/PR y adjuntos.

## Criterios de publicación

- Usar procesos sintéticos y datos inventados, o material de referencia cuya publicación esté
  permitida y tenga fuente y atribución documentadas. Que un documento sea público no implica
  que exista permiso para copiarlo.
- Mantener fuera del repositorio público los enunciados privados, actividades académicas,
  preguntas de evaluación, respuestas entregadas y datos personales o confidenciales. Cambiar
  solamente títulos o nombres no basta: revisar narrativa, datos, etiquetas, IDs, resultados e imágenes.
- Para pruebas de regresión, reducir el comportamiento a un fixture neutral con el alcance mínimo
  útil, dentro de `test/fixtures/` del paquete correspondiente. Los resultados numéricos esperados
  y oráculos analíticos son adecuados cuando verifican reglas o invariantes explícitas del motor.
- Mantener los ejemplos de uso en `examples/`. Su README debe indicar fuente u origen sintético,
  propósito, supuestos, reproducción y limitaciones. Conservar atribución y licencia de terceros;
  no presentar una referencia atribuida como un caso sintético original.
- Validar referencias BPMN, resolución de escenarios y comportamiento declarado. Conservar
  comparaciones reproducibles y documentar cambios de IDs que afecten las secuencias aleatorias.

## Inventario actual de casos

| Ubicación | Propósito y procedencia |
|---|---|
| `examples/pedido/` | Demo de pedidos de restaurante y benchmark de regresión del proyecto; su README documenta supuestos y comandos. |
| `examples/mm1/` | Modelos sintéticos de colas con resultados analíticos Erlang C y scripts de reproducción. |
| `examples/bizagi-levels/` | Reconstrucciones atribuidas de ejemplos públicos de referencia, con URLs, valores esperados y diferencias documentadas. |
| `examples/bizagi-exports/` | Fixtures de interoperabilidad BPMN MIWG sin modificar, con commit de origen y atribución CC BY 3.0. |
| `packages/engine/test/fixtures/service-request/` | Datos neutrales de regresión para recursos, desenlaces, interfaz y replay. |
| `packages/engine/test/fixtures/service-shared-denial.bpmn` | Fixture neutral de ruta compartida para invariantes del enrutamiento condicionado. |
| `packages/engine/test/fixtures/zero-time-driver.ts` | Modelos sintéticos de ciclos sin avance temporal y controles finitos para #368; ejecutados en procesos hijos con timeout externo. |

Este inventario describe el propósito mantenido de los casos; revisar nuevamente procedencia y
permisos cuando se agregue o sustituya material de origen. Actualizar el inventario al incorporar
una familia de casos. Los demás fixtures puntuales siguen los mismos criterios de publicación.

## Trabajo privado y revisión

Guardar archivos privados fuera del repositorio o en las carpetas ignoradas `local/`, `private/`
o `exports/` de la raíz. `.gitignore` no elimina contenido rastreado ni protege textos de GitHub,
adjuntos, historial de commits o clones existentes. Revisar juntos el diff preparado y el PR.

Antes de integrar, confirmar procedencia, alcance público y pruebas de aceptación relevantes en
el checklist del PR. Si la procedencia es incierta, preparar un nuevo fixture sintético antes de publicar.
