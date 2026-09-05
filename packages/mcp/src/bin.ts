#!/usr/bin/env node
/** Punto de entrada stdio real. `lila mcp` (LILA-056) llamará a esto mismo; por ahora se invoca
 * directo con `lila-mcp` o `node dist/bin.js`. */
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { createServer } from './server.js';

const server = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
