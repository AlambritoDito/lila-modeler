import { defineConfig } from 'vitest/config';

const { CI } = process.env;
const onCi = CI !== undefined && CI !== '' && CI !== 'false';

/**
 * Configuración única de vitest para todo el repo (#326). Hasta ahora no había ninguna y todo
 * corría con los valores por defecto; este archivo solo fija el paralelismo en el CI y deja
 * intacto el resto (pool `forks`, `isolate: true`, `include` por defecto).
 */
export default defineConfig({
  test: {
    // Cada fork corre simulaciones de 30 réplicas de examples/pedido. Con `maxForks` por
    // defecto (un proceso por core) el runner del CI queda saturado, y de ahí salen los
    // timeouts de hook y las corridas que no se pueden reproducir (#326).
    //
    // ponytail: dos procesos es un número fijo, no medido contra el runner. Techo: si el CI
    // cambia de máquina habrá que volver a mirarlo; el criterio es "menos procesos que cores",
    // no el 2 exacto. En local no se toca nada.
    poolOptions: { forks: { maxForks: onCi ? 2 : undefined } },
    // El aislamiento por archivo es lo que garantiza que el estado de módulo de un test no
    // llegue al siguiente; es el valor por defecto y se deja explícito para que no se pierda.
    isolate: true,
  },
});
