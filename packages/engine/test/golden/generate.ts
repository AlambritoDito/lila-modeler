import { writeFileSync } from 'node:fs';

import { PEDIDO_GOLDEN_PATH, renderPedidoGolden } from './pedido.js';

const bytes = await renderPedidoGolden(42);
writeFileSync(PEDIDO_GOLDEN_PATH, bytes, 'utf8');
console.log(`Golden seed 42 actualizado: ${PEDIDO_GOLDEN_PATH} (${Buffer.byteLength(bytes)} bytes)`);
