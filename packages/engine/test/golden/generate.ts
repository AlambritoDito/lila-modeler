import { writeFileSync } from 'node:fs';

import {
  PEDIDO_GOLDEN_PATH,
  PEDIDO_NIVEL3_GOLDEN_PATH,
  renderPedidoGolden,
  renderPedidoNivel3Golden,
} from './pedido.js';

// El golden de M1 es estable entre arquitecturas (R-DEG-1: `processing` cancela la deriva de
// último bit), así que se regenera desde cualquier máquina.
const bytes = await renderPedidoGolden(42);
writeFileSync(PEDIDO_GOLDEN_PATH, bytes, 'utf8');
console.log(`Golden seed 42 actualizado: ${PEDIDO_GOLDEN_PATH} (${Buffer.byteLength(bytes)} bytes)`);

// El de nivel 3 no: se compara byte a byte en el CI, que es Linux x64, y regenerarlo en otra
// arquitectura lo deja distinto en el último bit (R-DET-6). Un aviso no basta —así se puso el CI
// en rojo—, de modo que fuera de linux/x64 el archivo no se toca y el comando termina en error.
if (process.platform === 'linux' && process.arch === 'x64') {
  const nivel3 = await renderPedidoNivel3Golden(42);
  writeFileSync(PEDIDO_NIVEL3_GOLDEN_PATH, nivel3, 'utf8');
  console.log(
    `Golden nivel 3 seed 42 actualizado: ${PEDIDO_NIVEL3_GOLDEN_PATH} (${Buffer.byteLength(nivel3)} bytes)`,
  );
} else {
  console.error(
    `ERROR: ${process.platform}/${process.arch} no es la plataforma del CI (linux/x64). El golden de`
      + ' nivel 3 NO se ha tocado: aquí saldría distinto en el último bit y rompería el CI sin'
      + ' cambio semántico. Regenéralo en linux/x64 (R-DET-6).',
  );
  process.exitCode = 1;
}
