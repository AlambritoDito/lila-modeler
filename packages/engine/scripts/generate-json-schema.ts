/**
 * Genera `docs/scenario.schema.json` desde el esquema zod de `src/scenario.ts`.
 *
 *   npx tsx packages/engine/scripts/generate-json-schema.ts
 *
 * El archivo generado no se edita a mano: `test/scenario.test.ts` falla si difiere.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { toJsonSchema } from '../src/scenario.js';

const out = fileURLToPath(new URL('../../../docs/scenario.schema.json', import.meta.url));

writeFileSync(out, `${JSON.stringify(toJsonSchema(), null, 2)}\n`);
console.log(`escrito ${out}`);
