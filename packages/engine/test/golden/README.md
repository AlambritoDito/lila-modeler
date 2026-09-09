# Golden de `examples/pedido`

> **Working document, kept in Spanish.** The public documentation is in [`docs/`](../../../../docs/) and [`README.md`](../../../../README.md).

`pedido.seed-42.json` es el `RunResult` completo y legible del escenario AS-IS con seed 42. No es
un snapshot interno de Vitest: se revisa como JSON normal y el test compara sus bytes exactos.

`pedido-nivel3.seed-42.json` es el mismo escenario **con** recursos y **sin** la capa de
calendarios: el oráculo de R-DEG-2 (LILA-043). A diferencia del anterior, sus bytes son los de
`linux/x64`, la plataforma del CI, porque en nivel 3 `resourceWait` resta instantes de casos
distintos y la deriva de último bit de `Math.log`/`Math.exp` entre arquitecturas ya no se cancela
(R-DET-6). Por eso el test lo compara byte a byte cuando `process.env.CI` está definido y con
tolerancia relativa `1e-9` fuera del CI.

Para regenerarlos deliberadamente desde la raíz del repositorio:

```sh
npm run golden:update
git diff -- packages/engine/test/golden/
```

`golden:update` regenera el de M1 en cualquier máquina, pero **se niega** a tocar el de nivel 3
fuera de `linux/x64` y termina en error: regenerado en otra arquitectura rompería el CI sin cambio
semántico ninguno.

El script parsea el BPMN y el escenario reales y retira explícitamente `resources`, `calendars`,
`elements[*].resources`, `selection` y las referencias `elements[*].calendar` antes de validar y
simular. Esa es la entrada degradada que entendía M1 y permite comprobar que añadir
`ResourceManager` no cambia sus bytes (LILA-039). Un cambio del golden debe acompañar el cambio
semántico que lo provoca; nunca se actualiza solo para silenciar una prueba. La matriz de CI
existente ejecuta esta comparación con Node 22 y Node 24 (R-DET-6).
