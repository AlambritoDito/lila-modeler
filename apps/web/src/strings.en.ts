/**
 * Base catalog of the web app's UI texts (LILA-066, made the base language in LILA-210).
 *
 * Everything a person reads in the app — button and field labels, `title`/`aria-label`/
 * `placeholder`, error and warning messages, and the texts painted over the canvas — comes from
 * here. `strings.test.ts` is the acceptance test: it re-reads the `.tsx`/`.ts` files of
 * `apps/web/src` with the TypeScript parser and fails if a UI literal shows up outside the
 * catalogs.
 *
 * This file is the **base language**: it defines the shape (`Strings`, in `strings.types.ts`) and
 * every translation — today `strings.es.ts` — is annotated with that type, so `tsc` refuses a
 * translation that forgets a key or invents one. Adding a text is: write it here, then translate
 * it there.
 *
 * Four decisions that explain the shape of the object:
 *
 * 1. **A plain object, no i18n framework.** `S.escenario.guardar` is a named constant that
 *    typechecks, not a dotted string key looked up at runtime; `i18n.ts` is 60 lines of store and
 *    `useStrings()` hands the right catalog to the component.
 * 2. **Texts with parameters are functions**, not templates with placeholders:
 *    `S.resultados.corridas(n)` typechecks, and plural or gender is decided here — per language —
 *    and not in the view.
 * 3. **Grouped by view or module**, named after the file that uses it. No generic keys (`text1`):
 *    the name says where the text is read.
 * 4. **Keys stay in Spanish** (`app.guardar`, `escenario.seccionCorrida`). They are identifiers,
 *    not text: renaming ~380 of them would touch every component for no reader's benefit.
 *
 * What is **not** here, on purpose:
 *
 * - Engine messages (`packages/engine`): catalog § 17 of `docs/SEMANTICS.md` rules, and the web
 *   shows them exactly as they arrive so the same error does not get two spellings. Since #280
 *   the engine is *asked* for them in the active locale (`{ locale }` on `validate`,
 *   `validateScenario`, `parseScenario`, `simulate`, `compare`), so «as they arrive» and «in the
 *   user's language» are the same thing — but they are still not written here.
 * - The Bizagi result column names (`Id`, `Name`, `Type`, `From`, `To`, `Metric`): they live in
 *   `S.resultados.columnas` so they are read from here, but `docs/BIZAGI_PARITY.md` (rule 4 of
 *   `BACKLOG.md`) rules their value and they are **identical in every language**.
 * - The scenario JSON Schema keys (`run`, `calendars`, `capacity`, …): they are the name of the
 *   field in the file, not a label; `docs/SCENARIO_FORMAT.md` is their spelling.
 */

/** Weekdays of the calendar format, in canonical order (`CalendarEditor.DIAS`). */
const DIAS_SEMANA = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export const en = {
  /* ------------------------------------------------------------------ *
   * App shell (`App.tsx`)
   * ------------------------------------------------------------------ */
  app: {
    /** Label of each mode of the top bar; the id comes from `ids.ts` (`MODO_IDS`). */
    modos: {
      modelar: 'Model',
      simular: 'Simulate',
      resultados: 'Results',
      comparar: 'Compare',
      animar: 'Animate',
      rutas: 'Validate paths',
    },
    /** Label of each tab of the right panel; the id comes from `ids.ts` (`PESTANA_IDS`). */
    pestanas: {
      propiedades: 'Properties',
      documentacion: 'Documentation',
      simulacion: 'Simulation',
    },

    /** Visible name of each built-in theme (`src/theme/themes/*.json`). */
    temas: { 'eva-01': 'Eva-01', papel: 'Paper' },
    /** Visible name of each density; the id (`ids.ts`) is what goes to `localStorage`. */
    densidades: { compacta: 'Compact', normal: 'Normal', comoda: 'Comfortable' },
    /** The name as the status bar reads it («Comfortable density»). */
    densidadNombre: (id: string): string =>
      ({ compacta: 'Compact', normal: 'Normal', comoda: 'Comfortable' })[id] ?? id,

    /** Shortcut in parentheses after the tooltip: `⌘S` on Mac, `Ctrl+S` everywhere else. */
    atajo: (letra: string, shift: boolean, mac: boolean): string =>
      mac ? ` (${shift ? '⇧' : ''}⌘${letra})` : ` (Ctrl+${shift ? 'Shift+' : ''}${letra})`,

    /** Default name of a new project and of the one the app ships with. */
    proyectoNuevo: 'My project',
    proyectoDemo: 'Sample order',

    /** Top bar: project identity and save state. */
    sinGuardar: 'Unsaved',
    guardado: 'Saved',

    /** Browser «File» menu (in Electron it is the native menu). */
    menuArchivo: 'File',
    nuevo: 'New',
    abrir: 'Open',
    guardar: 'Save',
    guardarComo: 'Save as',
    abrirBpmn: 'Open .bpmn',
    exportarBpmn: 'Export .bpmn',
    tituloNuevo: 'New project',
    tituloAbrir: 'Open project',
    tituloGuardar: 'Save project',
    tituloGuardarComo: 'Save as',

    /** Inert search box of the bar (the command palette is another ticket). */
    buscar: 'Search activity',
    buscarPista: 'Search activity…',
    buscarPendiente: 'Search and the command palette arrive in LILA-066',

    deshacer: 'Undo',
    rehacer: 'Redo',
    ajustes: 'Settings',
    cancelar: 'Cancel',

    /** Primary action and its progress. */
    ejecutar: 'Run simulation',
    preparando: 'Preparing…',
    replicacion: (actual: number, total: number): string => `Replication ${actual} of ${total}`,
    porCiento: (n: number): string => `${n} %`,

    /** Canvas zoom controls. */
    acercar: 'Zoom in',
    alejar: 'Zoom out',
    ajustarPantalla: 'Fit to screen',

    /** Unsaved changes dialog. */
    reemplazoTitulo: 'Unsaved changes',
    reemplazoTexto: (proyecto: string): string =>
      `Save the changes to ${proyecto} before continuing, or discard them.`,
    guardarYContinuar: 'Save and continue',
    descartar: 'Discard',

    /** Loss dialog when exporting or saving (LILA-192). */
    perdidaVerbo: { exportar: 'Export', guardar: 'Save' },
    perdidaTitulo: (n: number): string =>
      `${n} ${
        n === 1
          ? 'reference the original file already had broken will be lost'
          : 'references the original file already had broken will be lost'
      }`,
    perdidaTexto: (guardando: boolean): string =>
      `The editor can only write back what it could read, so the ${
        guardando ? 'saved' : 'downloaded'
      } .bpmn will not carry them:`,
    perdidaConfirmar: (verbo: string): string => `${verbo} anyway`,

    /** Settings dialog. The endonym of each language is the same in every catalog. */
    idioma: 'Language',
    idiomaAuto: 'System default',
    idiomas: { en: 'English', es: 'Español' },
    apariencia: 'Appearance',
    tema: 'Theme',
    densidad: 'Density',
    cerrar: 'Close',

    /** Validation chips over the canvas and counters of the status bar. */
    irAlPrimerProblema: 'Go to the first element with problems',
    errores: (n: number): string => `${n} ${n === 1 ? 'error' : 'errors'}`,
    avisos: (n: number): string => `${n} ${n === 1 ? 'warning' : 'warnings'}`,

    /** Results mode and Compare mode with nothing to show yet. */
    sinResultados: 'Simulate the current revision to see results.',
    sinCorridaActual: 'There is no current run for the selected scenario.',
    escenarioBase: 'Base scenario',
    sinComparacion:
      'Simulate the base scenario and at least one other scenario of the current revision to compare.',
    corridaResumen: (
      escenario: string,
      modelRevision: number,
      scenarioRevision: number,
      semilla: string,
      moneda: string,
    ): string =>
      `${escenario} · revision ${modelRevision}/${scenarioRevision} · seed ${semilla} · ${moneda}`,

    /** «Simulation» tab of the right panel. */
    escenario: 'Scenario',
    errorSimular: (mensaje: string): string => `Could not simulate: ${mensaje}`,
    verCuellos: 'Bottlenecks',
    cuellosSinCorrida: 'Simulate to see the bottlenecks over the diagram.',
    cuellosSinEspera: 'No element waited for a resource in this run.',
    /** Name of the main bottleneck: the id is added only when it adds something (#226). */
    nombreDeCuello: (nombre: string, id: string): string => `${nombre} (${id})`,

    /** Diagram tabs, bottom left. */
    cerrarDiagrama: 'Close diagram',
    cerrarArchivo: (archivo: string): string => `Close ${archivo}`,
    nuevoDiagrama: 'New diagram',

    /** Status bar. */
    semilla: (valor: string): string => `Seed ${valor}`,
    /** Unknown seed: the scenario does not resolve or does not declare one. */
    sinValor: '—',
    densidadEstado: (nombre: string): string => `${nombre} density`,
    zoom: (porCiento: number): string => `Zoom ${porCiento} % · fit`,
    diagramaSuelto: 'Loose diagram: scenarios and runs are not saved until «Save as»',
    perdidaAlExportar: (n: number, lista: string): string =>
      `${n} ${n === 1 ? 'element or reference' : 'elements or references'} will be lost on export: ${lista}`,
    avisosAlImportar: (n: number): string =>
      `${n} ${
        n === 1 ? 'warning' : 'warnings'
      } on import; review the diagnosis before simulating or exporting`,
    errorAbrirDiagrama: (mensaje: string): string => `Could not open the diagram: ${mensaje}`,
    errorTema: (mensaje: string): string => `Could not load the theme: ${mensaje}`,

    /** I/O errors of the shell. */
    errorTemaHttp: (estado: number): string => `the server answered ${estado}`,
    errorModeladorNoListo: 'The modeler is not ready yet.',
    errorModeloCambio: 'The model changed while saving. Save the current revision again.',
    errorProyectoCambio:
      'The project changed while the file was opening. Your changes are kept; open it again.',
    errorRecienteAusente: 'That project is no longer in its folder; it was removed from recents.',
    errorAbrirOcupado: (archivo: string): string =>
      `"${archivo}" was not opened: another operation is in progress. Open it again when it finishes.`,
    errorEscenarioDesconocido: (ruta: string): string => `unknown scenario: ${ruta}`,
    problemaDeArchivo: (archivo: string, mensaje: string): string => `${archivo}: ${mensaje}`,
  },

  /* ------------------------------------------------------------------ *
   * Settings → Appearance (`settings/Apariencia.tsx`, LILA-114)
   * ------------------------------------------------------------------ */
  apariencia: {
    nombre: 'Theme name',
    /** A built-in theme is not edited: the first edit lands on this copy. */
    copia: (nombre: string): string => `${nombre} (copy)`,
    duplicar: 'Duplicate',
    restablecer: 'Reset',
    exportar: 'Export',
    importar: 'Import',
    eliminar: 'Delete',
    integrado: 'Built-in',
    delUsuario: 'Mine',
    muestraTexto: 'Text on surface',
    muestraSecundario: 'Secondary text',
    muestraBoton: 'Accent',

    /**
     * Label of each group of the editor, by token prefix. They are the same groups
     * `theme/tokens.ts` lists the 40 tokens with; the order comes from that list, not from this
     * object.
     */
    grupos: {
      bg: 'Base',
      border: 'Base',
      shadow: 'Base',
      fg: 'Text',
      accent: 'Accents',
      status: 'States',
      canvas: 'Canvas and diagram',
      diagram: 'Canvas and diagram',
      sim: 'Simulation',
      font: 'Typography',
      density: 'Typography',
    } as Record<string, string>,
    color: (token: string): string => `Color of ${token}`,
    hex: (token: string): string => `Hex of ${token}`,
    tamanoBase: 'Base size (px)',
    /**
     * Families the app ships with (`#238`), plus «System» so it depends on none. `valor` is the
     * token value verbatim: a list of CSS families with its fallback.
     * ponytail: there is no font editor nor loading of system families; ceiling: if needed, a
     * `<datalist>` with `queryLocalFonts()` where the browser allows it.
     */
    fuentes: [
      { nombre: 'Archivo', valor: 'Archivo, Inter, system-ui, sans-serif' },
      { nombre: 'JetBrains Mono', valor: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace" },
      { nombre: 'System', valor: 'system-ui, sans-serif' },
    ],

    /** Errors of importing someone else's JSON; they are read inside the dialog, nothing applied. */
    errorImportar: (mensaje: string): string => `The theme was not imported. ${mensaje}`,
    errorJson: 'The file is not valid JSON.',
    errorForma: 'The file is not a Lila Modeler theme: expected { "name": …, "tokens": { … } }.',
    errorNombre: 'The theme has no name ("name").',
    errorToken: (token: string): string => `The token "${token}" does not exist in Lila Modeler.`,
    errorValor: (token: string): string => `The token "${token}" has no text value.`,
    errorHex: (token: string, valor: string): string =>
      `The token "${token}" is a color and "${valor}" is not a hex (#rgb, #rrggbb or #rrggbbaa).`,
    errorDensidad: (valor: string): string =>
      `The density "${valor}" does not exist: use compacta, normal or comoda.`,
  },

  /* ------------------------------------------------------------------ *
   * Shape palette (`Paleta.tsx`)
   * ------------------------------------------------------------------ */
  paleta: {
    filtrar: 'Filter shapes',
    modoCompacto: 'Compact mode',
    entrarCompacto: 'Compact mode (icons only)',
    salirCompacto: 'Leave compact mode',
    arrastrar: 'drag',
    piePrefijo: 'Drag to the canvas or press ',
    pieTecla: 'Enter',
    pieSufijo: ' to insert',
    sinCoincidencias: (filtro: string): string => `No shape matches «${filtro}».`,
    grupos: {
      eventos: 'Events',
      actividades: 'Activities',
      compuertas: 'Gateways',
      datos: 'Data',
      artefactos: 'Artifacts',
      poolsYCarriles: 'Pools and lanes',
    },
    figuras: {
      inicio: 'Start',
      intermedio: 'Intermediate',
      fin: 'End',
      mensaje: 'Message',
      temporizador: 'Timer',
      tarea: 'Task',
      tareaUsuario: 'User task',
      tareaServicio: 'Service task',
      subproceso: 'Sub-process',
      actividadLlamada: 'Call activity',
      exclusiva: 'Exclusive',
      paralela: 'Parallel',
      inclusiva: 'Inclusive',
      basadaEnEventos: 'Event-based',
      objetoDeDatos: 'Data object',
      almacenDeDatos: 'Data store',
      anotacion: 'Annotation',
      grupo: 'Group',
      pool: 'Pool',
    },
  },

  /* ------------------------------------------------------------------ *
   * Properties and documentation panel (`PropertiesPanel.tsx`)
   * ------------------------------------------------------------------ */
  propiedades: {
    sinSeleccion: 'Select an element of the canvas to see its properties.',
    variosSeleccionados: (n: number): string =>
      `${n} elements selected: acting on several at once is not there yet. ` +
      'Select a single one to edit it.',

    textoAnotacion: 'Annotation text',
    nombre: 'Name',
    sinNombre: 'No name',
    tipoSinNombre: 'This type has no name',
    nombreProceso: 'Process name',
    tipo: 'Type',
    id: 'Id',
    copiar: 'Copy',
    copiado: 'Copied',

    descripcion: 'Description',
    descripcionProceso: 'Process description',
    descripcionPista: 'What this element is for',
    versionProceso: 'Process version',
    versionPista: '1.0.0',

    responsabilidades: 'Responsibilities',
    anadirResponsabilidad: '+ Add responsibility',
    quitarResponsabilidad: 'Remove responsibility',
    quitarResponsabilidadN: (i: number): string => `Remove responsibility ${i}`,
    tipoResponsabilidad: (i: number): string => `Responsibility type ${i}`,
    rol: (i: number): string => `Role ${i}`,
    rolPista: 'role id',
    sinTipo: 'No type',
    noEsRaci: (tipo: string): string => `${tipo} · not RACI`,
    /** RACI types of `lila:responsibility` (`docs/BPMN_EXTENSION.md` § 2). */
    raci: [
      ['R', 'R · Responsible'],
      ['A', 'A · Accountable'],
      ['C', 'C · Consulted'],
      ['I', 'I · Informed'],
    ],

    anadir: '+ Add',
    anadirA: (etiqueta: string): string => `Add to ${etiqueta}`,
    referenciaN: (etiqueta: string, i: number): string => `${etiqueta} ${i}`,
    quitarDe: (etiqueta: string): string => `Remove from ${etiqueta.toLowerCase()}`,
    quitarDeN: (etiqueta: string, i: number): string => `Remove from ${etiqueta.toLowerCase()} ${i}`,
    /** Symbol of the remove button; not a text that gets translated. */
    cruz: '×',

    /** The loose `lila:*Ref`s: moddle type, group label and help text of the field. */
    referencias: [
      ['lila:SystemRef', 'Systems', 'system id'],
      ['lila:DocumentRef', 'Documents', 'document id'],
      ['lila:RiskRef', 'Risks', 'risk id'],
      ['lila:ControlRef', 'Controls', 'control id'],
      ['lila:KpiRef', 'KPIs', 'indicator id'],
      ['lila:Input', 'Inputs', 'input id'],
      ['lila:Output', 'Outputs', 'output id'],
    ],

    /** Readable name of the BPMN `$type`; what is not here comes out without the `bpmn:` prefix. */
    tipos: {
      'bpmn:Task': 'Task',
      'bpmn:UserTask': 'User task',
      'bpmn:ManualTask': 'Manual task',
      'bpmn:ServiceTask': 'Service task',
      'bpmn:ScriptTask': 'Script task',
      'bpmn:SendTask': 'Send task',
      'bpmn:ReceiveTask': 'Receive task',
      'bpmn:BusinessRuleTask': 'Business rule task',
      'bpmn:CallActivity': 'Call activity',
      'bpmn:SubProcess': 'Sub-process',
      'bpmn:StartEvent': 'Start event',
      'bpmn:EndEvent': 'End event',
      'bpmn:IntermediateCatchEvent': 'Intermediate catch event',
      'bpmn:IntermediateThrowEvent': 'Intermediate throw event',
      'bpmn:BoundaryEvent': 'Boundary event',
      'bpmn:ExclusiveGateway': 'Exclusive gateway (XOR)',
      'bpmn:ParallelGateway': 'Parallel gateway (AND)',
      'bpmn:InclusiveGateway': 'Inclusive gateway (OR)',
      'bpmn:EventBasedGateway': 'Event-based gateway',
      'bpmn:ComplexGateway': 'Complex gateway',
      'bpmn:SequenceFlow': 'Sequence flow',
      'bpmn:MessageFlow': 'Message flow',
      'bpmn:Association': 'Association',
      'bpmn:DataObjectReference': 'Data object',
      'bpmn:DataStoreReference': 'Data store',
      'bpmn:TextAnnotation': 'Text annotation',
      'bpmn:Group': 'Group',
      'bpmn:Participant': 'Pool',
      'bpmn:Lane': 'Lane',
      'bpmn:Process': 'Process',
      'bpmn:Collaboration': 'Collaboration',
    } as Record<string, string>,
  },

  /* ------------------------------------------------------------------ *
   * Scenario panel (`ScenarioPanel.tsx`)
   * ------------------------------------------------------------------ */
  escenario: {
    guardar: 'Save',
    duplicar: 'Duplicate',
    /** Header: errors and warnings of the scenario being edited. */
    conteo: (errores: number, avisos: number): string =>
      `${errores} ${errores === 1 ? 'error' : 'errors'} · ${avisos} ${
        avisos === 1 ? 'warning' : 'warnings'
      }`,
    hereda: (padre: string): string =>
      `Inherits from ${padre}: resolved values are shown and only the delta is edited.`,

    seccionCorrida: 'Run',
    seccionCalendarios: 'Calendars',
    seccionRecursos: 'Resources',
    seccionElemento: 'Selected element',
    seccionValidacion: (errores: number): string =>
      `Validation (${errores} ${errores === 1 ? 'error' : 'errors'})`,

    /** Selected element: the id rules, the BPMN name goes beside it as context. */
    nombreEntreParentesis: (nombre: string): string => ` (${nombre})`,

    /** Form generated from the JSON Schema. */
    sinDefinir: '(not set)',
    quitar: 'Remove',
    quitarHeredado: 'Remove inherited',
    restaurarHeredado: 'Restore inherited',
    quitarClave: (clave: string): string => `remove ${clave}`,
    quitarElemento: 'remove',
    quitarItem: (etiqueta: string, i: number): string => `remove ${etiqueta} ${i}`,
    anadir: 'Add',
    anadirEtiqueta: (etiqueta: string): string => `Add ${etiqueta}`,
    claveNueva: 'new key',
    claveRepetida: (clave: string): string => `${clave} already exists; edit it below or use another id.`,
    itemNumerado: (etiqueta: string, i: number): string => `${etiqueta} ${i}`,
    eliminadoNull: 'deleted (null)',
    estadoReservado: (estado: string, valor: string): string => `${estado}: ${valor}`,
    /** Label of a variant with neither discriminator nor known type. */
    opcionN: (i: number): string => `option ${i}`,
    /** JSON types of the schema, in English, for the variant selector. */
    tiposJson: {
      string: 'text',
      number: 'number',
      integer: 'integer',
      boolean: 'yes/no',
      object: 'object',
      array: 'list',
    } as Record<string, string>,

    /**
     * JSON Schema field names the panel labels by hand (`docs/SCENARIO_FORMAT.md`): they are the
     * spelling of the file, not a translatable label. They are read from here so the acceptance
     * test does not need a separate allow list.
     */
    claves: { capacity: 'capacity', calendar: 'calendar', intervals: 'intervals' },

    /** `resources[pool].capacity` (LILA-164): fixed or per shift. */
    capacidadFija: 'Fixed',
    capacidadPorTurno: 'Per shift',
    tramo: (i: number): string => `range ${i}`,
    quitarTramo: (i: number): string => `remove range ${i}`,
    anadirTramo: 'Add range',

    /** `calendars[key].intervals` (LILA-203): weekly grid or generic list. */
    editarComoLista: 'Edit as list',
    editarComoRejilla: 'Edit as grid',
    calendarioConMinutos: 'this calendar has minute slots; edit it as a list',

    /** «Assign lane to pool» (LILA-334): a bulk edit of `elements[task].resources`. */
    carrilCarril: 'Lane',
    carrilPool: 'Pool',
    carrilAsignar: 'Assign lane',
    carrilAyuda: (tareas: number): string =>
      `Fills resources for every task in the lane (${tareas}); the lane itself is never stored.`,
    carrilYaAsignadas: (tareas: number): string =>
      `${tareas} ${tareas === 1 ? 'task already has' : 'tasks already have'} resources; assigning replaces them:`,
    carrilSobrescribir: 'Overwrite',
    carrilCancelar: 'Cancel',

    /** «Duplicate»: name and file of the copy (§ 6 of `docs/SCENARIO_FORMAT.md`). */
    sufijoCopia: ' (copy)',
    errorEscenarioDesconocido: (ruta: string): string => `unknown scenario: ${ruta}`,
  },

  /* ------------------------------------------------------------------ *
   * Weekly calendar editor (`CalendarEditor.tsx`)
   * ------------------------------------------------------------------ */
  calendario: {
    rejilla: 'Weekly schedule: days by hours',
    celda: (dia: (typeof DIAS_SEMANA)[number], hhmm: string): string => `${dia} ${hhmm}`,
  },

  /* ------------------------------------------------------------------ *
   * Results view (`ResultsView.tsx`)
   * ------------------------------------------------------------------ */
  resultados: {
    /**
     * Column names fixed by Bizagi (`docs/BIZAGI_PARITY.md`, RESULTS_FORMAT § 10, rule 4 of
     * `BACKLOG.md`): read from here, but **not** translated — the CLI, the CSVs and this view
     * have to call the same column the same way in every language.
     */
    columnas: { id: 'Id', name: 'Name', type: 'Type', from: 'From', to: 'To', metric: 'Metric' },
    /** `columnLabel(...)` plus the scenario unit in parentheses. */
    columnaConUnidad: (etiqueta: string, unidad: string): string => `${etiqueta} (${unidad})`,

    /** Section labels; `CompareView` reuses them so it does not invent others. */
    secciones: {
      elements: 'Process elements',
      flows: 'Flows',
      process: 'Process',
      resources: 'Resources',
    },

    exportarCsv: 'Export CSV',
    exportarXlsx: 'Export XLSX',
    cabecera: (
      escenario: string,
      semilla: number,
      replicaciones: number,
      unidad: string,
      moneda: string | undefined,
    ): string =>
      `Scenario ${escenario} · seed ${semilla} · replications ${replicaciones} · time unit ${unidad}${
        moneda === undefined ? '' : ` · currency ${moneda}`
      }`,

    /** Title of the per-outcome table (`process.byEndEvent`, #316). */
    desenlaces: 'Outcomes',

    cuellos: 'Bottlenecks',
    sinCuellos: 'No resource wait detected.',
    cuelloDetalle: (espera: string, unidad: string, utilizacion: string): string =>
      ` — total wait ${espera} ${unidad}, utilization ${utilizacion}%`,

    avisos: 'Warnings',
  },

  /* ------------------------------------------------------------------ *
   * Comparison view (`CompareView.tsx`, `compareWarnings.ts`)
   * ------------------------------------------------------------------ */
  comparar: {
    cabecera: (unidad: string): string => `Time unit ${unidad} (base scenario) · Utilization in %`,
    base: (nombre: string): string => `${nombre} (base)`,
    etiquetaBase: 'base',
    mostrarTodos: 'Show every KPI',
    avisos: 'Warnings',
    significancia: 'Significance',
    marcaSignificativa: 'Significant difference (disjoint CI95)',
    /** The asterisk of the mark; a symbol, not text. */
    asterisco: '*',
    sinSignificancia:
      'No confidence intervals in this comparison: at least 2 replications per run are needed, ' +
      'so no significance marker is shown below.',
    leyenda:
      ' significant difference (CI95 without overlap). Highlighted cells are the ones that ' +
      'changed against the base.',
    /** Column header: the name and, in parentheses, whatever metadata exists. */
    columnaConMeta: (nombre: string, etiquetas: readonly string[]): string =>
      etiquetas.length === 0 ? nombre : `${nombre} (${etiquetas.join(' · ')})`,
    metaSemilla: (semilla: number): string => `seed ${semilla}`,
    metaReplicas: (n: number): string => `${n} replications`,
    metaUnidad: (unidad: string): string => `unit ${unidad}`,
    /** Cell with no value in the base (same spelling as `lila compare`). */
    sinValor: '-',
    noComparable: 'not comparable',
    celdaConDelta: (valor: string, delta: string): string => `${valor} (${delta})`,
    /** Utilization: percentage, same as in the CLI. */
    porCiento: (valor: string): string => `${valor}%`,

    /* Warnings derived from the run metadata (`compareWarnings.ts`, OP-05). */
    sinMoneda: 'no currency',
    avisoMonedas: (monedas: readonly string[]): string =>
      `Costs in different currencies (${monedas.join(' vs ')}): they are not compared without conversion.`,
    avisoUnidades: (unidades: readonly string[]): string =>
      `Different time units between runs (${unidades.join(' vs ')}): each value is shown with ` +
      'the unit of its own run.',
    avisoSignificancia:
      'No confidence intervals: ≥ 2 replications are needed to talk about significance.',
    avisoSemillas: (semillas: readonly number[]): string =>
      `Different seeds between runs (${semillas.join(' vs ')}): the runs do not share the same ` +
      'random sequence.',
    avisoReplicas: (replicas: readonly number[]): string =>
      `Different number of replications between runs (${replicas.join(' vs ')}).`,
  },

  /* ------------------------------------------------------------------ *
   * Canvas: bpmn-js, bottleneck overlay and validation markers
   * (`Modeler.tsx`, `BottleneckOverlay.ts`, `ValidationMarkers.ts`)
   * ------------------------------------------------------------------ */
  lienzo: {
    /**
     * Caption of the minimap header, painted by `app.css` as `content: attr(data-titulo)`: a
     * pseudo-element cannot read a catalog, so `Modeler.tsx` writes the text on the element and
     * the stylesheet only draws it (uppercased by `text-transform`).
     */
    minimapa: 'Minimap',
    plegarMinimapa: 'Collapse minimap',
    desplegarMinimapa: 'Expand minimap',
    errorSinBpmn: 'The modeler has no BPMN open yet.',

    /** Floating label of the bottleneck overlay (#226): short above, complete in the `title`. */
    cuelloEtiqueta: (espera: string, utilizacion: number): string => `${espera} · ${utilizacion}%`,
    cuelloTitulo: (espera: string, unidad: string, utilizacion: string): string =>
      `mean wait ${espera} ${unidad} · utilization ${utilizacion}%`,
    /** Short unit for the label; the `title` uses the scenario code. */
    unidadesCortas: { day: 'd', h: 'h', min: 'min', s: 's' },

    /** Validation marker: the disc and its native tooltip. */
    marcadorSimbolo: '!',
    marcadorAcciones: 'F2 rename · ⇥ properties',
    marcadorTitulo: (mensajes: readonly string[], acciones: string): string =>
      `${mensajes.join('\n')}\n${acciones}`,
  },

  /* ------------------------------------------------------------------ *
   * «Validate paths» mode (`TokenSim.tsx`, LILA-065 and LILA-205 / #264)
   * ------------------------------------------------------------------ */
  tokenSim: {
    aviso:
      'bpmn-js token animation: this is not discrete-event simulation; it does not use the ' +
      'scenario and it produces no results.',
    /**
     * `bpmn-js-token-simulation@0.40.0` writes its UI with literal strings in the HTML: it does
     * not go through bpmn-js's `translate` service, so translating it means substituting the
     * texts in the canvas DOM (`traducirSimulacion` in `TokenSim.tsx`). The module already writes
     * English, so in this catalog the map is **empty**: no entry matches, nothing is rewritten,
     * and the text the module wrote is the text that stays. The `MutationObserver` still runs —
     * it is what would translate a node the module adds later — it simply finds nothing to change.
     */
    traducciones: {} as Readonly<Record<string, string>>,
    /** `title="Set animation speed = Slow"`: the prefix is translated, the speed looked up above. */
    prefijoVelocidad: 'Set animation speed = ',
    velocidad: (nombre: string): string => `Animation speed: ${nombre}`,
    /** `title="Focus process instance <id>"`. */
    prefijoInstancia: 'Focus process instance ',
    instancia: (id: string): string => `Go to instance ${id}`,
  },

  /* ------------------------------------------------------------------ *
   * Project, stores and simulation gate
   * (`project.ts`, `store/*.ts`, `simulationGate.ts`, `simulationClient.ts`, `modelerXml.ts`)
   * ------------------------------------------------------------------ */
  proyecto: {
    /** Names of the diagram «New» creates (they are seen on the canvas). */
    procesoNuevo: 'My process',
    inicio: 'Start',
    actividad: 'Activity',
    fin: 'End',
    /** Names of the two default scenarios of a new project. */
    escenarioAsIs: 'AS-IS',
    escenarioToBe: 'TO-BE',

    errorDocumento: 'Invalid project document or unsupported version.',
    errorDiagnostico: 'Invalid project diagnosis.',
    errorCorrida: 'Invalid saved run.',
    errorEntradasCorrida: 'The inputs of the saved run are invalid.',

    /** The five failures of the `.lila` CONTAINER (ADR-027), as opposed to the document's. */
    errorZip: 'This file is not a readable .lila (it could not be decompressed).',
    errorSinManifiesto: 'The file has no "lila-project.json": it is not a .lila project.',
    errorManifiesto: 'The file\u2019s "lila-project.json" is invalid or of an unsupported version.',
    errorSinModelo: 'The file has no "model.bpmn": it is not a .lila project.',
    errorEntrada: 'The .lila file holds an entry whose path is not valid inside a project.',
  },

  almacen: {
    errorSinBridge: 'DesktopStore requires `window.lila`: is it being instantiated outside Electron?',
    errorProyectoDistinto:
      'E-PROYECTO-DISTINTO: the document to save is not the active project; use "Save as" ' +
      'to write it into a new folder.',
    /** «Save as» of a loose diagram over the folder that already is its project (LILA-208). */
    errorMismaCarpeta:
      'This folder already has its model.bpmn; to turn the loose diagram into a project pick another folder.',
  },

  simulacion: {
    cancelada: 'The simulation was cancelled.',
    errorEscenarioDesconocido: (ruta: string): string => `Unknown scenario: ${ruta}`,
    errorFaltaModelORun: 'Missing model or run in the resolved scenario.',
    errorModeloDistinto: (delEscenario: string, activo: string): string =>
      `The scenario points at ${delEscenario}, but the active model is ${activo}.`,
    errorExportacionBloqueada: (detalle: string): string =>
      `Export blocked by lost content:\n${detalle}`,
  },

  /* ------------------------------------------------------------------ *
   * Replay of the event log on the diagram (#331)
   * ------------------------------------------------------------------ */
  animacion: {
    titulo: 'Replay',
    /** Button of the results header that jumps into the replay mode. */
    reproducirDesdeResultados: 'Play',
    reproducir: 'Play',
    pausar: 'Pause',
    reiniciar: 'Reset',
    velocidad: 'Speed',
    /** Simulated seconds per second of real time; `instantanea` jumps straight to the end. */
    velocidades: {
      '1': '1x',
      '10': '10x',
      '60': '60x',
      '600': '600x',
      instantanea: 'Instant',
    },
    /** Counter painted over each element: enabled / completed, with the queue in brackets. */
    contador: (iniciados: number, completados: number, cola: number): string =>
      `${iniciados}/${completados}${cola > 0 ? ` (${cola})` : ''}`,
    contadorTitulo: (iniciados: number, completados: number, cola: number, activos: number): string =>
      `Started ${iniciados} · completed ${completados} · queued ${cola} · in progress ${activos}`,
    /** Simulated clock: the date of the scenario plus the elapsed time of the replication. */
    reloj: (fecha: string): string => `Simulated time ${fecha}`,
    /** Same clock when the scenario has no start date: only the elapsed time. */
    relojSinFecha: (dia: number, hora: string): string => `Day ${dia}, ${hora} into the run`,
    recursos: 'Pools',
    columnaRecurso: 'Pool',
    columnaOcupados: 'Busy',
    columnaCapacidad: 'Capacity',
    /** Which replication is on screen; totals of a multi-replication run are means, this is not. */
    replicacion: (total: number): string =>
      `Replication 1 of ${total}: the counters on the diagram are for this replication only.`,
    truncado: (filas: number): string =>
      `Only the first ${filas} log rows were kept, so the tail of the replication is missing from the replay.`,
    /** No run for the selected scenario, or a run whose log is no longer in memory. */
    sinCorrida: 'Run the simulation to animate the selected scenario.',
    sinLog: 'This run has no event log in memory (it came from a saved file): run the simulation again to animate it.',
    fin: 'End of the replication.',
    progreso: (porcentaje: number): string => `${porcentaje}% of the replication`,
  },

  /* ------------------------------------------------------------------ *
   * Development demo pages (`*-demo.tsx`, outside the bundle)
   * ------------------------------------------------------------------ */
  demos: {
    cargando: 'Loading examples/pedido…',
    tituloResultados: 'Lila Modeler · Results (LILA-062 demo)',
    tituloComparar: 'Lila Modeler · Compare (LILA-063 demo)',
  },
} as const;
