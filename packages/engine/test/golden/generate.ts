import { writeFileSync } from 'node:fs';

import {
  PEDIDO_GOLDEN_PATH,
  PEDIDO_NIVEL3_GOLDEN_PATH,
  renderPedidoGolden,
  renderPedidoNivel3Golden,
} from './pedido.js';

// El golden de nivel 3 se compara byte a byte en el CI, que es Linux x64. Regenerarlo en otra
// arquitectura lo deja distinto en el último bit (R-DET-6) y rompe el CI sin cambio semántico.
if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.warn(
    `AVISO: ${process.platform}/${process.arch} no es la plataforma del CI (linux/x64). El golden de`
      + ' nivel 3 quedará distinto en el último bit; regenéralo en el CI (R-DET-6).',
  );
}

const bytes = await renderPedidoGolden(42);
writeFileSync(PEDIDO_GOLDEN_PATH, bytes, 'utf8');
console.log(`Golden seed 42 actualizado: ${PEDIDO_GOLDEN_PATH} (${Buffer.byteLength(bytes)} bytes)`);

const nivel3 = await renderPedidoNivel3Golden(42);
writeFileSync(PEDIDO_NIVEL3_GOLDEN_PATH, nivel3, 'utf8');
console.log(
  `Golden nivel 3 seed 42 actualizado: ${PEDIDO_NIVEL3_GOLDEN_PATH} (${Buffer.byteLength(nivel3)} bytes)`,
);
