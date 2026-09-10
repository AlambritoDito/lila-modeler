#!/usr/bin/env node
/**
 * Punto de entrada stdio del bin `lila-mcp`. `lila mcp` (LILA-056) llama a la misma función, pero
 * pasando el idioma que resolvió de `--lang`; aquí no hay línea de comandos, así que sale del
 * entorno con la misma regla (`LILA_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG`; inglés si no hay).
 */
import { resolveLocale } from '@lila/engine/messages';

import { startStdioServer } from './server.js';

await startStdioServer({ locale: resolveLocale(undefined, process.env) });
