// Ambient declaration for `bpmn-auto-layout` 1.3 (MIT, bpmn.io), which ships no types. Only the
// one function `outline.ts` uses: BPMN XML without DI in, the same XML with DI out.
declare module 'bpmn-auto-layout' {
  export function layoutProcess(xml: string): Promise<string>;
}
