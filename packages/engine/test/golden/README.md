# Golden de `examples/pedido`

`pedido.seed-42.json` es el `RunResult` completo y legible del escenario AS-IS con seed 42. No es
un snapshot interno de Vitest: se revisa como JSON normal y el test compara sus bytes exactos.

Para regenerarlo deliberadamente desde la raíz del repositorio:

```sh
npm run golden:update
git diff -- packages/engine/test/golden/pedido.seed-42.json
```

El script parsea y valida el BPMN y el escenario reales antes de simular. Un cambio del golden debe
acompañar el cambio semántico que lo provoca; nunca se actualiza solo para silenciar una prueba.
La matriz de CI existente ejecuta esta comparación con Node 22 y Node 24 (R-DET-6).
