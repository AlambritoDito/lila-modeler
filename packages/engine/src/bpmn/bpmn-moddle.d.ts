// Declaración ambiente para `bpmn-moddle` 10.x: el paquete publica tipos de los elementos
// (`bpmn-moddle/types`) pero no del constructor, y su `exports` no expone condición "types",
// así que TypeScript no encuentra nada al importar 'bpmn-moddle'.
//
// ponytail: es un subconjunto escrito a mano con exactamente lo que usa `parse.ts`, no un
// binding completo. Techo: si el parser necesita más campos del modelo, se agregan aquí;
// el camino de mejora es que bpmn-moddle publique su propio `index.d.ts` (upstream) o
// pasar a `@types/bpmn-moddle` si algún día existe.
declare module 'bpmn-moddle' {
  /** Nodo del árbol moddle. Solo los campos que lee el parser. */
  export interface ModdleElement {
    $type: string;
    id: string;
    name?: string;
    /** Elemento que lo contiene; `undefined` en `bpmn:Definitions`. */
    $parent?: ModdleElement;
    /** `bpmn:Definitions` */
    rootElements?: ModdleElement[];
    exporter?: string;
    exporterVersion?: string;
    /** `bpmn:Process` / `bpmn:SubProcess` */
    isExecutable?: boolean;
    flowElements?: ModdleElement[];
    laneSets?: ModdleElement[];
    triggeredByEvent?: boolean;
    /** `bpmn:LaneSet` */
    lanes?: ModdleElement[];
    /** `bpmn:Lane` */
    childLaneSet?: ModdleElement;
    flowNodeRef?: ModdleElement[];
    /** eventos */
    eventDefinitions?: ModdleElement[];
    eventDefinitionRef?: ModdleElement[];
    parallelMultiple?: boolean;
    /** `bpmn:Activity` */
    loopCharacteristics?: ModdleElement;
    startQuantity?: number;
    completionQuantity?: number;
    /** `bpmn:SequenceFlow` (referencias ya resueltas por moddle) */
    sourceRef?: ModdleElement;
    targetRef?: ModdleElement;
    conditionExpression?: ModdleElement;
    /** flujo por defecto de un gateway o actividad */
    default?: ModdleElement;
    /** `bpmn:documentation` de cualquier elemento */
    documentation?: ModdleElement[];
    /** texto de un `bpmn:Documentation` */
    text?: string;
    /** `bpmn:extensionElements` */
    extensionElements?: ModdleElement;
    /** hijos de `bpmn:ExtensionElements` */
    values?: ModdleElement[];
    /** `bpmn:Collaboration` */
    participants?: ModdleElement[];
    messageFlows?: ModdleElement[];
    conversations?: ModdleElement[];
    conversationNodes?: ModdleElement[];
    artifacts?: ModdleElement[];
    /** atributos de los elementos `lila:` */
    type?: string;
    roleRef?: string;
    ref?: string;
    value?: string;
  }

  /**
   * Aviso que moddle-xml recoge en vez de lanzar, por dos motivos distintos: una referencia que
   * no se pudo resolver (`property` es la propiedad rota, p. ej. `bpmn:sourceRef`, `element` el
   * elemento que la declara) o un elemento entero descartado al leer el XML ("unparsable
   * content", con la razón en `error.message`: `illegal ID <...>` o `unknown type <...>`).
   */
  export interface ModdleWarning {
    message: string;
    error?: { message: string };
    element?: ModdleElement;
    property?: string;
  }

  export interface Moddle {
    fromXML(
      xml: string,
      typeName?: string,
    ): Promise<{ rootElement: ModdleElement; warnings: ModdleWarning[] }>;
    toXML(element: ModdleElement, options?: unknown): Promise<{ xml: string }>;
    create(type: string, attrs?: Record<string, unknown>): ModdleElement;
  }

  export function BpmnModdle(packages?: Record<string, unknown>, options?: unknown): Moddle;
}
