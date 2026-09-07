/**
 * Detección de una ruta `.bpmn` a abrir desde argumentos de línea de comandos (OP-14, incremento
 * 2, "arranque frío y segunda apertura" de OP-12). Pura: sin `electron`, sin tocar el sistema de
 * archivos — `main.ts` decide qué hacer con la ruta encontrada (verificar que existe, autorizar su
 * carpeta) usando `node:fs/promises`.
 */

/** `true` si `p` termina en `.bpmn` (insensible a mayúsculas: `Model.BPMN` también cuenta). */
export function isBpmnPath(p: string): boolean {
  return p.toLowerCase().endsWith('.bpmn');
}

/**
 * Primer argumento de `argv` (desde el índice `skip`) que parece una ruta `.bpmn` de usuario: no
 * empieza por `-` (para no confundir una flag como `--foo.bpmn`, que no es un caso real pero
 * cuesta cero excluir) y termina en `.bpmn`. `skip` deja fuera el ejecutable y, sin empaquetar, la
 * carpeta de la app (`main.ts` decide cuánto según `app.isPackaged`); para `second-instance`
 * (Electron ya entrega `argv` sin ese prefijo variable) usa `skip = 1` para saltar el propio
 * ejecutable. `null` si ninguno califica.
 */
export function findBpmnArg(argv: readonly string[], skip: number): string | null {
  for (let i = skip; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== undefined && !arg.startsWith('-') && isBpmnPath(arg)) return arg;
  }
  return null;
}
