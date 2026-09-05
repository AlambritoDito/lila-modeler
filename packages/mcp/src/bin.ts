#!/usr/bin/env node
/** Punto de entrada stdio del bin `lila-mcp`. `lila mcp` (LILA-056) llama a la misma función. */
import { startStdioServer } from './server.js';

await startStdioServer();
