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

export const startupEn = { loading: 'Opening your workspace…', error: 'Lila Modeler could not finish starting. Please reload to try again.', reload: 'Reload' };

export const en = {
  startup: startupEn,
  /* ------------------------------------------------------------------ *
   * App shell (`App.tsx`)
   * ------------------------------------------------------------------ */
  app: {
    /** Product name in the top-bar lockup (`.identidad`, design 2d); hidden in Electron, where
     * the OS title bar already carries it. */
    marca: 'Lila Modeler',
    /** Label of each mode of the top bar; the id comes from `ids.ts` (`MODO_IDS`). */
    modos: {
      modelar: 'Model',
      simular: 'Simulate',
      resultados: 'Results',
    },
    /** Label of each tab of the right panel; the id comes from `ids.ts` (`PESTANA_IDS`). */
    pestanas: {
      propiedades: 'Properties',
      documentacion: 'Documentation',
      simulacion: 'Simulation',
    },

    /** Visible name of each built-in theme (`src/theme/themes/*.json`). */
    temas: { 'lila-light': 'Lila Light', 'lila-dark': 'Lila Dark', 'eva-01': 'Eva-01', papel: 'Paper', tieso: 'Tieso', akira: 'Akira', montana: 'Montana' },
    /** Visible name of each density; the id (`ids.ts`) is what goes to `localStorage`. */
    densidades: { compacta: 'Compact', normal: 'Normal', comoda: 'Comfortable' },
    /** The name as the status bar reads it («Comfortable density»). */
    densidadNombre: (id: string): string =>
      ({ compacta: 'Compact', normal: 'Normal', comoda: 'Comfortable' })[id] ?? id,

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
    /** A `.bpmn`/`.xml` from another tool (#591), opened as the current diagram. */
    importarBpmn: 'Import BPMN…',
    exportarBpmn: 'Export .bpmn',
    /** Diagram export (#451): downloads on the web; PDF is the browser's print dialog. */
    exportarSvg: 'Export diagram as SVG',
    exportarPng: 'Export diagram as PNG',
    /** Process document (#454): Word or a single HTML page, like Bizagi's «Publish to Word». */
    exportarDocx: 'Export process document (Word)',
    exportarHtml: 'Export process document (HTML)',
    imprimirPdf: 'Print / Save as PDF…',
    tituloNuevo: 'New project',
    tituloAbrir: 'Open project',
    tituloGuardar: 'Save project',
    tituloGuardarComo: 'Save as',

    /**
     * Desktop «File» menu (#411): same `<details className="menu-archivo">` as the browser, but
     * these entries mirror the native menu bar word for word (`apps/desktop/src/strings/en.ts`),
     * because the owner reads both and they must agree. The native menu (and its accelerators)
     * stays; this is only about the owner finding the same actions inside the window too.
     */
    menuEscritorio: {
      nuevoProyecto: 'New project',
      abrirProyecto: 'Open project…',
      abrirProyectoArchivo: 'Open project file (.lila)…',
      importarBpmn: 'Import BPMN…',
      abrirReciente: 'Open recent',
      // QA of #432 (N1): word for word with the native menu's own empty state
      // (`apps/desktop/src/strings/en.ts`'s `menu.ninguno`), not a longer paraphrase.
      ninguno: 'None',
      guardarProyecto: 'Save project',
      guardarComo: 'Save as…',
      guardarComoCarpeta: 'Save as folder…',
      exportarSvg: 'Export diagram as SVG…',
      exportarPng: 'Export diagram as PNG…',
      exportarPdf: 'Export diagram as PDF…',
      exportarDocx: 'Export process document (Word)…',
      exportarHtml: 'Export process document (HTML)…',
      imprimir: 'Print…',
    },

    /** The bar's search button: it opens the command palette (#410). */
    buscar: 'Search activity',
    buscarPista: 'Search activity…',

    deshacer: 'Undo',
    rehacer: 'Redo',
    ajustes: 'Settings',
    cancelar: 'Cancel',

    /** Primary action and its progress. */
    ejecutar: 'Run simulation',
    preparando: 'Preparing…',
    replicacion: (actual: number, total: number): string => `Replication ${actual} of ${total}`,
    porCiento: (n: number): string => `${n} %`,

    /** Detachable scenario window (design 2c): toggle in the top bar and the docked panel's stand-in. */
    escenarioAcoplado: 'Scenario docked ↗',
    escenarioDesacoplado: 'In its own window',
    acoplar: 'Dock',
    enVentanaAparte: 'Scenario in its own window ↗',
    mostrarVentana: 'Show',
    ventanaBloqueada: 'The browser blocked the scenario window. Allow pop-ups for this site to detach it.',
    acercaBloqueada: 'The About window was blocked; allow pop-ups for this site.',
    tituloVentanaEscenario: (nombre: string): string => `Scenario ${nombre} — Lila Modeler`,
    /** Detachable Results window (#395): same toggle and stand-in as the scenario's. */
    resultadosAcoplados: 'Results docked ↗',
    resultadosDesacoplados: 'Results in their own window',
    resultadosEnVentana: 'Results in another window ↗',
    resultadosBloqueada: 'The browser blocked the Results window. Allow pop-ups for this site to detach it.',
    tituloVentanaResultados: 'Results — Lila Modeler',

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
    /** Settings → About Lila Modeler (LILA-381): closes Settings and opens the About dialog. */
    acercaDe: 'About Lila Modeler',

    /** Validation chips over the canvas and counters of the status bar. */
    irAlPrimerProblema: 'Go to the first element with problems',
    errores: (n: number): string => `${n} ${n === 1 ? 'error' : 'errors'}`,
    avisos: (n: number): string => `${n} ${n === 1 ? 'warning' : 'warnings'}`,

    /** Results mode and Compare mode with nothing to show yet. */
    sinResultados: 'Simulate the current revision to see results.',
    sinCorridaActual: 'There is no current run for the selected scenario.',
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
    /** Name of the main bottleneck: the id is added only when it adds something (#226). */
    nombreDeCuello: (nombre: string, id: string): string => `${nombre} (${id})`,

    /** Diagram tabs, bottom left. */
    cerrarDiagrama: 'Close diagram',
    cerrarArchivo: (archivo: string): string => `Close ${archivo}`,
    /** Divider between the canvas and the right panel (design 2a). */
    redimensionarPanel: 'Resize the right panel',
    /** Divider between the left column and the canvas (#406). */
    redimensionarIzquierda: 'Resize the left column',
    /**
     * Panel visibility toggles, top bar right (#412): the region names label the buttons and the
     * items of the «View» menu that replaces them in narrow windows; the titles carry the key.
     */
    vista: 'View',
    /** Group of align and distribute buttons on the canvas, in Model (#453). */
    alinear: 'Align and distribute',
    regiones: {
      izquierda: 'Left column',
      derecha: 'Right panel',
      diagramas: 'Diagram tabs',
      estado: 'Status bar',
      dock: 'Results table',
    },
    tituloRegiones: {
      izquierda: 'Show or hide the left column',
      derecha: 'Show or hide the right panel',
      diagramas: 'Show or hide the diagram tabs',
      estado: 'Show or hide the status bar',
      dock: 'Show or hide the results table',
    },
    /** The status bar toggle while an error keeps the bar on screen (#412). */
    tituloEstadoForzado: 'Show or hide the status bar — it stays while it shows an error',

    /** Status bar. */
    semilla: (valor: string): string => `Seed ${valor}`,
    /** Unknown seed: the scenario does not resolve or does not declare one. */
    sinValor: '—',
    densidadEstado: (nombre: string): string => `${nombre} density`,
    zoom: (porCiento: number): string => `Zoom ${porCiento} % · fit`,
    cambioExterno: 'The file changed outside Lila',
    recargarCambioExterno: 'Reload',
    mantenerMios: 'Keep mine',
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
    exportacionOcupada: 'Another export, save or process switch is still running. Export again when it finishes.',
    guardadoOcupado: 'An export, save or process switch is still running. Save again when it finishes.',
    errorProyectoCambio:
      'The project changed while the file was opening. Your changes are kept; open it again.',
    errorRecienteAusente: 'That project is no longer in its folder; it was removed from recents.',
    errorAbrirOcupado: (archivo: string): string =>
      `"${archivo}" was not opened: another operation is in progress. Open it again when it finishes.`,
    /** The autosave copy offered at launch could not be read (#459); it is deleted. */
    errorCopiaRecuperacion: (mensaje: string): string =>
      `The recovery copy of the last session could not be opened and was discarded: ${mensaje}`,
    errorEscenarioDesconocido: (ruta: string): string => `unknown scenario: ${ruta}`,
    problemaDeArchivo: (archivo: string, mensaje: string): string => `${archivo}: ${mensaje}`,
  },

  /* ------------------------------------------------------------------ *
   * Desktop welcome (`Bienvenida.tsx`, artboard 08)
   * ------------------------------------------------------------------ */
  bienvenida: {
    titulo: 'Welcome',
    nombre: 'Lila Modeler',
    subtitulo: (version: string): string => `v${version} · open source · BPMN 2.0`,
    empezar: 'Get started',
    abrirLila: 'Open project (.lila)…',
    abrirLilaPista: 'a project file with its scenarios and saved runs',
    abrirCarpeta: 'Open project folder',
    abrirCarpetaPista: 'a folder with model.bpmn',
    nuevo: 'New process',
    nuevoPista: 'creates an empty .bpmn',
    // #458: one row per public example (`docs/EXAMPLES_POLICY.md`), keyed by `Ejemplo['id']`
    // (`ejemplos.ts`) so `strings.test.ts` (LILA-210) catches a catalog and a gallery that drift.
    ejemplosTitulo: 'Examples',
    ejemplos: {
      pedido: { titulo: 'Restaurant order', pista: 'Counter service with AS-IS / TO-BE scenarios' },
      // QA of #505, N5/M1: name these as reconstructions, matching `examples/bizagi-levels/
      // README.md`, but in one short line — a longer one forced `.bienvenida-izq` to its
      // `white-space: nowrap` min-content width and crushed the right column (QA must-fix M1).
      'bizagi-level-1': { titulo: 'Bizagi level 1', pista: "Reconstruction of Bizagi's tutorial: routes only" },
      'bizagi-level-2': { titulo: 'Bizagi level 2', pista: "Reconstruction of Bizagi's tutorial: adds processing times" },
      'bizagi-level-3': { titulo: 'Bizagi level 3', pista: "Reconstruction of Bizagi's tutorial: adds three nurses" },
      'bizagi-level-4': { titulo: 'Bizagi level 4', pista: "Reconstruction of Bizagi's tutorial: adds shifts" },
      'mm1-rho08': { titulo: 'M/M/1 queue (ρ=0.8)', pista: 'Single-server queue validated against Erlang C' },
      mm3: { titulo: 'M/M/3 queue (ρ=0.8)', pista: 'Three-server queue validated against Erlang C' },
    },
    documentacion: 'Documentation',
    repositorio: 'Repository',
    recientes: 'Recent',
    sinRecientes: 'No recent projects yet. Open one or start from one of the examples.',
    novedades: (version: string): string => `What's new in ${version}`,
    notasVersion: 'Release notes',
    tema: (tema: string, densidad: string): string => `${tema} theme · ${densidad}`,
    cambiarApariencia: 'change in Settings → Appearance',
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
    /** Following the system's light/dark scheme (#472). */
    seguirSistema: 'Follow the system theme',
    seguirSistemaAyuda: 'Switches between the light and dark theme below when your system changes mode.',
    temaClaro: 'Light theme',
    temaOscuro: 'Dark theme',
    /** One-time prompt the first time the theme switches on its own (#472). */
    avisoTitulo: 'Theme changed',
    avisoTexto: (tema: string, oscuro: boolean): string =>
      `The theme changed to ${tema} because your system switched to ${oscuro ? 'dark' : 'light'} mode. Keep it automatic?`,
    mantener: 'Keep',
    apagar: 'Turn off',

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
   * Settings dialog shell (`settings/Ajustes.tsx`, artboard 09, #407)
   * ------------------------------------------------------------------ */
  ajustes: {
    /** Nav tab labels, left column (`role="tablist"`). */
    secciones: {
      general: 'General',
      apariencia: 'Appearance',
      atajos: 'Shortcuts',
    },
    /** Column headers of the Shortcuts table. */
    accion: 'Action',
    tecla: 'Key',
    /** General → «Advanced» switch (#447) and the text beside it. */
    avanzado: 'Advanced',
    avanzadoAyuda: 'Show BPMN element ids next to names',
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
    /** Title of a boundary event or a lane while nothing fitting is selected (#456). */
    requiereActividad: (figura: string): string => `${figura}: select a task or a sub-process to attach it to`,
    requiereContenedor: (figura: string): string => `${figura}: add a pool first`,
    /** The lane tool waiting for a click on a pool (#580); Escape cancels. */
    eligePool: 'Click the pool or lane to add the lane to. Esc cancels.',
    /** The ⌘K command palette (`PaletaComandos.tsx`, #410); its actions reuse the bar's labels. */
    comandos: {
      titulo: 'Command palette',
      pista: 'Search elements, scenarios, modes and actions',
      sinResultados: (consulta: string): string => `Nothing matches «${consulta}».`,
      grupos: { elementos: 'Elements', escenarios: 'Scenarios', modos: 'Modes', acciones: 'Actions' },
    },
    grupos: {
      eventosInicio: 'Start events',
      eventosIntermedios: 'Intermediate events',
      eventosFin: 'End events',
      eventosBorde: 'Boundary events',
      actividades: 'Activities',
      compuertas: 'Gateways',
      datos: 'Data',
      artefactos: 'Artifacts',
      poolsYCarriles: 'Pools and lanes',
    },
    figuras: {
      inicio: 'Start',
      inicioMensaje: 'Message start',
      inicioTemporizador: 'Timer start',
      inicioSenal: 'Signal start',
      inicioCondicional: 'Conditional start',
      intermedio: 'Intermediate',
      capturaMensaje: 'Message catch',
      capturaTemporizador: 'Timer catch',
      capturaSenal: 'Signal catch',
      capturaEnlace: 'Link catch',
      capturaCondicional: 'Conditional catch',
      lanzamientoMensaje: 'Message throw',
      lanzamientoSenal: 'Signal throw',
      lanzamientoEnlace: 'Link throw',
      lanzamientoEscalado: 'Escalation throw',
      fin: 'End',
      finMensaje: 'Message end',
      finTerminar: 'Terminate end',
      finError: 'Error end',
      finSenal: 'Signal end',
      bordeMensaje: 'Message boundary',
      bordeTemporizador: 'Timer boundary',
      bordeError: 'Error boundary',
      bordeSenal: 'Signal boundary',
      tarea: 'Task',
      tareaUsuario: 'User task',
      tareaServicio: 'Service task',
      tareaManual: 'Manual task',
      tareaScript: 'Script task',
      tareaEnvio: 'Send task',
      tareaRecepcion: 'Receive task',
      tareaReglaNegocio: 'Business rule task',
      subproceso: 'Sub-process',
      subprocesoPlegado: 'Collapsed sub-process',
      subprocesoEvento: 'Event sub-process',
      transaccion: 'Transaction',
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
      carril: 'Lane',
    },
  },

  /* ------------------------------------------------------------------ *
   * bpmn-js's own texts (`bpmnTranslate.ts`, #456): context pad, replace menu, popup search.
   * The keys are bpmn-js's English templates, verbatim, so this base catalog is the identity; a
   * `{name}` placeholder is filled by bpmn-js. A template missing here is shown as bpmn-js wrote it.
   * ------------------------------------------------------------------ */
  bpmnJs: {
    // Context pad (ContextPadProvider)
    'Delete': 'Delete',
    'Add lane above': 'Add lane above',
    'Divide into two lanes': 'Divide into two lanes',
    'Divide into three lanes': 'Divide into three lanes',
    'Add lane below': 'Add lane below',
    'Append task': 'Append task',
    'Append end event': 'Append end event',
    'Append gateway': 'Append gateway',
    'Append intermediate/boundary event': 'Append intermediate/boundary event',
    'Append receive task': 'Append receive task',
    'Append message intermediate catch event': 'Append message intermediate catch event',
    'Append timer intermediate catch event': 'Append timer intermediate catch event',
    'Append conditional intermediate catch event': 'Append conditional intermediate catch event',
    'Append signal intermediate catch event': 'Append signal intermediate catch event',
    'Append compensation activity': 'Append compensation activity',
    'Change element': 'Change element',
    'Add text annotation': 'Add text annotation',
    'Connect to other element': 'Connect to other element',
    'Connect using association': 'Connect using association',
    'Connect using data input association': 'Connect using data input association',
    'Align elements': 'Align elements',
    'Align elements left': 'Align elements left',
    'Align elements center': 'Align elements center',
    'Align elements right': 'Align elements right',
    'Align elements top': 'Align elements top',
    'Align elements middle': 'Align elements middle',
    'Align elements bottom': 'Align elements bottom',
    'Distribute elements horizontally': 'Distribute elements horizontally',
    'Distribute elements vertically': 'Distribute elements vertically',
    'Open {element}': 'Open {element}',
    'Search in diagram': 'Search in diagram',
    'flow elements must be children of pools/participants': 'flow elements must be children of pools/participants',
    'Data object must be placed within a pool/participant.': 'Data object must be placed within a pool/participant.',
    // bpmn-js palette (hidden by the app, translated for completeness)
    'Activate hand tool': 'Activate hand tool',
    'Activate lasso tool': 'Activate lasso tool',
    'Activate create/remove space tool': 'Activate create/remove space tool',
    'Activate global connect tool': 'Activate global connect tool',
    'Create start event': 'Create start event',
    'Create intermediate/boundary event': 'Create intermediate/boundary event',
    'Create end event': 'Create end event',
    'Create gateway': 'Create gateway',
    'Create task': 'Create task',
    'Create data object reference': 'Create data object reference',
    'Create data store reference': 'Create data store reference',
    'Create expanded sub-process': 'Create expanded sub-process',
    'Create pool/participant': 'Create pool/participant',
    'Create group': 'Create group',
    // Replace menu: activities (PopupEntries, ReplaceOptions)
    'Task': 'Task',
    'User task': 'User task',
    'Service task': 'Service task',
    'Send task': 'Send task',
    'Receive task': 'Receive task',
    'Manual task': 'Manual task',
    'Business rule task': 'Business rule task',
    'Script task': 'Script task',
    'Call activity': 'Call activity',
    'Transaction': 'Transaction',
    'Event sub-process': 'Event sub-process',
    'Sub-process': 'Sub-process',
    'Sub-process (collapsed)': 'Sub-process (collapsed)',
    'Sub-process (expanded)': 'Sub-process (expanded)',
    'Ad-hoc sub-process': 'Ad-hoc sub-process',
    'Ad-hoc sub-process (collapsed)': 'Ad-hoc sub-process (collapsed)',
    'Ad-hoc sub-process (expanded)': 'Ad-hoc sub-process (expanded)',
    // Replace menu: gateways, data, pools and flows
    'Exclusive gateway': 'Exclusive gateway',
    'Parallel gateway': 'Parallel gateway',
    'Inclusive gateway': 'Inclusive gateway',
    'Complex gateway': 'Complex gateway',
    'Event-based gateway': 'Event-based gateway',
    'Event based instantiating Gateway': 'Event based instantiating Gateway',
    'Parallel Event based instantiating Gateway': 'Parallel Event based instantiating Gateway',
    'Data store reference': 'Data store reference',
    'Data object reference': 'Data object reference',
    'Expanded pool/participant': 'Expanded pool/participant',
    'Empty pool/participant': 'Empty pool/participant',
    'Empty pool/participant (removes content)': 'Empty pool/participant (removes content)',
    'Sequence flow': 'Sequence flow',
    'Default flow': 'Default flow',
    'Conditional flow': 'Conditional flow',
    // Replace menu: events
    'Start event': 'Start event',
    'Intermediate throw event': 'Intermediate throw event',
    'Boundary event': 'Boundary event',
    'End event': 'End event',
    'Message start event': 'Message start event',
    'Timer start event': 'Timer start event',
    'Conditional start event': 'Conditional start event',
    'Signal start event': 'Signal start event',
    'Error start event': 'Error start event',
    'Escalation start event': 'Escalation start event',
    'Compensation start event': 'Compensation start event',
    'Message start event (non-interrupting)': 'Message start event (non-interrupting)',
    'Timer start event (non-interrupting)': 'Timer start event (non-interrupting)',
    'Conditional start event (non-interrupting)': 'Conditional start event (non-interrupting)',
    'Signal start event (non-interrupting)': 'Signal start event (non-interrupting)',
    'Escalation start event (non-interrupting)': 'Escalation start event (non-interrupting)',
    'Message intermediate catch event': 'Message intermediate catch event',
    'Message intermediate throw event': 'Message intermediate throw event',
    'Timer intermediate catch event': 'Timer intermediate catch event',
    'Escalation intermediate throw event': 'Escalation intermediate throw event',
    'Conditional intermediate catch event': 'Conditional intermediate catch event',
    'Link intermediate catch event': 'Link intermediate catch event',
    'Link intermediate throw event': 'Link intermediate throw event',
    'Compensation intermediate throw event': 'Compensation intermediate throw event',
    'Signal intermediate catch event': 'Signal intermediate catch event',
    'Signal intermediate throw event': 'Signal intermediate throw event',
    'Message boundary event': 'Message boundary event',
    'Timer boundary event': 'Timer boundary event',
    'Escalation boundary event': 'Escalation boundary event',
    'Conditional boundary event': 'Conditional boundary event',
    'Error boundary event': 'Error boundary event',
    'Cancel boundary event': 'Cancel boundary event',
    'Signal boundary event': 'Signal boundary event',
    'Compensation boundary event': 'Compensation boundary event',
    'Message boundary event (non-interrupting)': 'Message boundary event (non-interrupting)',
    'Timer boundary event (non-interrupting)': 'Timer boundary event (non-interrupting)',
    'Escalation boundary event (non-interrupting)': 'Escalation boundary event (non-interrupting)',
    'Conditional boundary event (non-interrupting)': 'Conditional boundary event (non-interrupting)',
    'Signal boundary event (non-interrupting)': 'Signal boundary event (non-interrupting)',
    'Message end event': 'Message end event',
    'Escalation end event': 'Escalation end event',
    'Error end event': 'Error end event',
    'Cancel end event': 'Cancel end event',
    'Compensation end event': 'Compensation end event',
    'Signal end event': 'Signal end event',
    'Terminate end event': 'Terminate end event',
    // Replace menu: markers (ReplaceMenuProvider)
    'Parallel multi-instance': 'Parallel multi-instance',
    'Sequential multi-instance': 'Sequential multi-instance',
    'Loop': 'Loop',
    'Collection': 'Collection',
    'Participant multiplicity': 'Participant multiplicity',
    'Toggle non-interrupting': 'Toggle non-interrupting',
  },

  /* ------------------------------------------------------------------ *
   * Properties and documentation panel (`PropertiesPanel.tsx`)
   * ------------------------------------------------------------------ */
  propiedades: {
    /* #396: «Quick view · simulation» under the selected element's header. */
    vistaRapida: 'Quick view · simulation',
    vistaTiempo: 'Time',
    vistaRecurso: 'Resource',
    vistaEsperaP95: 'Resource wait p95',
    vistaEsperaMedia: 'Resource wait (mean)',
    vistaSinCorrida: 'no run',
    editarEnTiempos: 'Edit in Times',
    editarEnRecursos: 'Edit in Resources',

    sinSeleccion: 'Select an element of the canvas to see its properties.',
    variosSeleccionados: (n: number): string =>
      `${n} elements selected. Colour applies to all of them; ` +
      'select a single one to edit its other properties.',

    /* Right-panel header with nothing selected (design "Turno 2", block 2d). */
    nadaSeleccionado: 'Nothing selected',
    pistaSeleccion: 'Pick a shape to edit it, or start with the process.',
    proceso: 'Process',
    elementos: 'Elements',
    // «Pools / lanes» (QA of round 1 of #392): a sample with pools but no internal lanes used to
    // read «Lanes 0» with two pools plainly on screen; this row counts both (see `PanelVacio`).
    carriles: 'Pools / lanes',
    avisos: 'Warnings',
    atajos: 'Shortcuts',
    renombrar: 'Rename',

    textoAnotacion: 'Annotation text',
    nombre: 'Name',
    sinNombre: 'No name',
    tipoSinNombre: 'This type has no name',
    nombreProceso: 'Process name',
    tipo: 'Type',
    id: 'Id',
    copiar: 'Copy',
    copiado: 'Copied',
    /** Activity width (#563): the Properties field and why a value is refused. */
    ancho: 'Width',
    anchoProblemas: {
      vacio: 'Enter a width.',
      numero: 'The width must be a number, for example 120.',
      minimo: (minimo: number): string => `The width must be at least ${minimo}.`,
      maximo: (maximo: number): string => `The width must be at most ${maximo}.`,
    },
    /** Colours per element (#452): the panel row, the context pad entry and the eight colours. */
    color: 'Color',
    cambiarColor: 'Change color',
    colores: {
      ninguno: 'None',
      azul: 'Blue',
      verde: 'Green',
      amarillo: 'Yellow',
      naranja: 'Orange',
      rojo: 'Red',
      morado: 'Purple',
      turquesa: 'Teal',
      gris: 'Gray',
    },

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
   * Scenario rail of Simulate (`RailEscenarios.tsx`, design 2a)
   * ------------------------------------------------------------------ */
  rail: {
    /** The BASE badge of «Scenario ▾» and of the panel header. */
    base: 'BASE',
  },

  /* ------------------------------------------------------------------ *
   * Scenario panel (`ScenarioPanel.tsx`)
   * ------------------------------------------------------------------ */
  escenario: {
    guardar: 'Save',
    duplicar: 'Duplicate',
    /** Footer of the detached window, next to Duplicate and Save. */
    pieVentana: 'changes show on the canvas instantly',
    /** Header: errors and warnings of the scenario being edited. */
    conteo: (errores: number, avisos: number): string =>
      `${errores} ${errores === 1 ? 'error' : 'errors'} · ${avisos} ${
        avisos === 1 ? 'warning' : 'warnings'
      }`,
    titulo: (nombre: string): string => `Scenario ${nombre}`,
    /** Mono line under the header: the file and its `extends` parent, «—» for a base scenario. */
    archivoHereda: (archivo: string, padre: string | null): string =>
      `${archivo} · inherits from ${padre ?? '—'}`,

    /**
     * #333/#396, Lote M — the six steps of the Simulate panel, named after what each one edits (the
     * design's labels). `docs/COMING-FROM-BIZAGI.md` maps them to Bizagi's four levels.
     */
    pasos: 'Steps',
    paso: {
      arrivals: 'Arrivals',
      times: 'Times',
      routes: 'Routes',
      resources: 'Resources',
      calendars: 'Calendars',
      run: 'Run',
    } as Record<string, string>,
    pasoAyuda: {
      arrivals: 'How cases come in: how often each start event fires and how many cases it creates.',
      times: 'How long each activity takes, and what it costs each time it runs.',
      routes: 'Which share of the cases follows each path out of a gateway.',
      resources:
        'Who does the work: pools, how many units, when each pool works (its calendar and capacity per shift), and which task takes which pool.',
      calendars: 'When the work is possible: calendars and holidays, and which element follows which calendar.',
      run: 'How long the simulation runs, from when, and how many replications.',
    } as Record<string, string>,
    /** Lote M: the «! n» of a step, read out with the step's name. */
    pasoProblemas: (n: number): string => `${n} ${n === 1 ? 'problem' : 'problems'}`,
    /** Lote M: a task the scenario gives no `processingTime` (the engine would run it in zero time). */
    sinDuracion: (tarea: string): string => `${tarea}: no duration, so it would take no time.`,

    /** Element lists of the steps: what is already parameterised and what is still missing. */
    listaTiempos: 'Times by element',
    listaRecursos: 'Resources by element',
    listaLlegadas: 'Arrivals by start event',
    /** «every 5 min · 100 cases»: the arrival line of one start event in the Arrivals list. */
    resumenLlegada: (cada: string, casos: number | null): string =>
      casos === null ? cada : `${cada} · ${casos} ${casos === 1 ? 'case' : 'cases'}`,
    /** #396: Calendars no longer repeats the pools; this says where a pool's calendar went. */
    irARecursos: 'Go to Resources',
    /** #430: entries for ids the diagram no longer has (a configured shape was deleted). */
    huerfanas: 'Entries for elements that are no longer in the diagram',
    quitarHuerfanas: 'Remove orphan entries',
    sinResumen: '—',
    resumenAsignacion: (pool: string, cantidad: number): string => `${pool} ×${cantidad}`,

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
    /** #579: the create control, on top of Calendars and Resources. */
    nuevoCalendario: 'New calendar',
    ejemploCalendario: 'night-shift',
    crearCalendario: '+ Blank',
    nuevoRecurso: 'New resource',
    ejemploRecurso: 'analyst',
    crearRecurso: '+ Create resource',
    claveRepetida: (clave: string): string => `${clave} already exists; edit it below or use another id.`,
    itemNumerado: (etiqueta: string, i: number): string => `${etiqueta} ${i}`,
    eliminadoNull: 'deleted (null)',
    /** Label for `EstadoReservado`'s `'propio'`/`'heredado'`: never the internal state id (#477). */
    estadoPropio: 'own',
    estadoHeredado: 'inherited',
    estadoReservado: (etiquetaEstado: string, valor: string): string => `${etiquetaEstado}: ${valor}`,
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

    /**
     * #332 — the label of each scenario field, so the form reads like a form and not like the
     * file. The key is the spelling of `docs/SCENARIO_FORMAT.md`; a key that is not here falls
     * back to itself, which is what keeps a field added to the schema tomorrow from disappearing.
     */
    campos: {
      // run (§ 2.2)
      start: 'Start',
      duration: 'Duration',
      warmup: 'Warm-up',
      replications: 'Replications',
      seed: 'Seed',
      baseTimeUnit: 'Time unit',
      currency: 'Currency',
      serviceLevel: 'Service level',
      // calendars (§ 2.3)
      intervals: 'Intervals',
      days: 'Days',
      from: 'From',
      to: 'To',
      monthDays: 'Days of the month',
      monthWeekdays: 'Weekdays of the month',
      dates: 'Yearly dates',
      nth: 'Week of the month',
      day: 'Weekday',
      // resources (§ 2.4)
      name: 'Name',
      type: 'Type',
      capacity: 'Capacity',
      costPerHour: 'Cost per hour',
      // elements (§ 2.5)
      processingTime: 'Processing time',
      resources: 'Resources',
      selection: 'Resource selection',
      fixedCost: 'Fixed cost',
      interTriggerTimer: 'Time between arrivals',
      triggerCount: 'Max arrivals',
      calendar: 'Calendar',
      probability: 'Probability',
      ref: 'Pool',
      quantity: 'Quantity',
      // distribution parameters (§ 3)
      value: 'Value',
      min: 'Minimum',
      mode: 'Mode',
      max: 'Maximum',
      mean: 'Mean',
      sd: 'Standard deviation',
      shape: 'Shape',
      scale: 'Scale',
      k: 'Phases (k)',
      alpha: 'Alpha',
      beta: 'Beta',
      n: 'Trials (n)',
      p: 'Success probability (p)',
      points: 'Points',
      // ADR-028: conditions on a flow leaving a diverging XOR
      flowTaken: 'Flow already taken',
      // reserved (§ 4)
      priority: 'Priority',
      preempt: 'Preemption',
      batch: 'Batch',
      conditions: 'Conditions',
      holidays: 'Holidays',
      timezone: 'Timezone',
    } as Record<string, string>,

    /** Short help under a field. Only where the file's unit or default is not obvious. */
    ayudas: {
      start: 'Zero instant of the virtual clock; its offset is the timezone calendars are read in.',
      duration: 'How long the simulated clock runs.',
      warmup: 'Cases started before this are excluded from the statistics.',
      serviceLevel: 'Target cycle time; reporting only, it does not change the simulation.',
      baseTimeUnit: 'Presentation only: times are always stored in seconds.',
      replications: 'Independent runs; 30 is the usual recommendation.',
      processingTime: 'Duration of the work.',
      interTriggerTimer: 'Time between arrivals at this start event.',
      triggerCount: 'Maximum number of cases this start event generates.',
      probability: 'Between 0 and 1. Without it the gateway splits evenly.',
      conditions: 'Only on a flow leaving a diverging exclusive gateway: the probability to use when the case already took the flow named here. The first match wins; with none, the plain probability applies.',
      flowTaken: 'Id of a sequence flow of the diagram, upstream of this gateway.',
      'conditions.probability': 'Between 0 and 1. The weight this flow takes when the condition matches; it replaces the plain probability, it does not add to it.',
      fixedCost: 'Cost per token completed at this element.',
      costPerHour: 'Cost per busy hour, not per available hour.',
      capacity: 'Units of the pool available at the same time.',
      quantity: 'Units of the pool this task takes.',
      selection: 'and: waits for every pool. or: takes whichever is free first.',
      calendar: 'Without a calendar the element is available 24×7.',
    } as Record<string, string>,

    /** The 13 distributions of BPSim plus the constant and the empirical one (§ 3). */
    distribuciones: {
      constant: 'Constant',
      uniform: 'Uniform',
      triangular: 'Triangular',
      exponential: 'Exponential',
      normal: 'Normal',
      truncatedNormal: 'Truncated normal',
      lognormal: 'Lognormal',
      gamma: 'Gamma',
      erlang: 'Erlang',
      weibull: 'Weibull',
      beta: 'Beta',
      poisson: 'Poisson',
      binomial: 'Binomial',
      user: 'Empirical (points)',
    } as Record<string, string>,

    /** Unit the times of the panel are typed in, shown beside every duration. */
    unidades: { s: 'sec', min: 'min', h: 'h', day: 'days' } as Record<string, string>,

    /** `run.start` (R8): a date and time plus the UTC offset, instead of a hand-written ISO. */
    fechaHora: 'Date and time',
    desfase: 'UTC offset',

    /** Routes step (#332, Lote M C4): a gateway without exits. */
    compuertaSinSalientes: 'This gateway has no outgoing flows.',

    /** Advanced view: the raw delta of the file being edited (§ 6), for when the form is not enough. */
    seccionJson: 'Advanced: scenario JSON',
    aplicarJson: 'Apply',
    jsonInvalido: (mensaje: string): string => `Not valid JSON: ${mensaje}`,
    jsonNoEsObjeto: 'The scenario has to be a JSON object.',

    /** #449: scenario parameters from Excel/CSV, reviewed before they are applied. */
    importar: 'Import Excel/CSV…',
    plantilla: 'Download template',
    importarAyuda: 'Download the template, fill it in Excel and import it back. Empty cells change nothing and nothing is applied until you confirm.',
    importarSinModelo: 'Open a diagram first: the rows are matched against its elements.',
    importarTitulo: (archivo: string): string => `Import from ${archivo}`,
    importarCambios: (n: number): string => (n === 1 ? '1 change to apply:' : `${n} changes to apply:`),
    importarSinCambios: 'Nothing to change: the file says what the scenario already has.',
    importarNuevo: 'new',
    importarNoEmparejadas: (n: number): string => `Rows not applied: they match nothing or are ambiguous (${n})`,
    importarErrores: (n: number): string => `Rows not applied: invalid values (${n})`,
    importarAvisos: (n: number): string => `Notes (${n})`,
    importarAplicar: 'Apply',
    importarCancelar: 'Cancel',
    importarAplicado: (n: number): string => (n === 1 ? 'Imported 1 change.' : `Imported ${n} changes.`),
    importarDeshacer: 'Undo import',
    importarIlegible: 'The file could not be read as a spreadsheet: pick an .xlsx workbook or a CSV file.',
    importarDemasiadoGrande: 'The workbook is too large to import (more than 50 MB of sheets once uncompressed).',
    importarFueraDeLimites: 'The workbook has cells beyond the last row or column Excel allows; it looks damaged.',
    importarLint: (n: number): string => `Errors the scenario would have after applying (${n}): fix the file and import it again`,
    importarDesde: (hoja: string, fila: number): string => `${hoja}, row ${fila}`,
    importarCaducado: 'The scenario changed after the file was read: import it again to apply it.',
    importarCaducadoDiagrama: 'The diagram changed after the file was read: import it again to apply it.',

    /** `resources[pool].capacity` (LILA-164): fixed or per shift. */
    capacidadFija: 'Fixed',
    capacidadPorTurno: 'Per shift',
    tramo: (i: number): string => `range ${i}`,
    quitarTramo: (i: number): string => `remove range ${i}`,
    anadirTramo: 'Add range',

    /** `calendars[key].intervals` (LILA-203): weekly grid or generic list. */
    editarComoLista: 'Edit as list',
    editarComoRejilla: 'Edit as grid',
    calendarioConMinutos: 'this calendar has minute slots, which the grid cannot show: use the ranges or the list',

    /** «Assign lane to pool» (LILA-334): a bulk edit of `elements[task].resources`. */
    carrilCarril: 'Lane',
    carrilPool: 'Resource',
    carrilAsignar: 'Assign lane → resource',
    carrilAyuda: (tareas: number): string =>
      `Every task of the lane (${tareas}) gets this resource; the lane itself is never stored.`,
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
    /** A grid cell's accessible name: the translated day (`diasLargos`) and the hour. */
    celda: (dia: string, hhmm: string): string => `${dia} ${hhmm}`,
    /** Range picker above the grid (#448). */
    nuevaFranja: 'New time range',
    presets: { laborables: 'Mon–Fri', todos: 'Every day', finDeSemana: 'Weekend' },
    dias: { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' },
    diasLargos: {
      MON: 'Monday',
      TUE: 'Tuesday',
      WED: 'Wednesday',
      THU: 'Thursday',
      FRI: 'Friday',
      SAT: 'Saturday',
      SUN: 'Sunday',
    } satisfies Record<(typeof DIAS_SEMANA)[number], string>,
    desde: 'From',
    hasta: 'To',
    formatoHora: 'HH:MM',
    anadir: 'Add range',
    lista: 'Current ranges',
    franja: (dias: string, from: string, to: string): string => `${dias} ${from}–${to}`,
    quitar: 'Remove',
    quitarFranja: (franja: string): string => `Remove ${franja}`,
    /** #82: how the new range repeats — weekly, monthly or yearly (R-CAL-12, R-CAL-13). */
    repeticion: 'Repeats',
    repeticiones: {
      semanal: 'Weekly',
      diaDelMes: 'Monthly, on a day',
      diaSemanaDelMes: 'Monthly, on a weekday',
      anual: 'Yearly, on a date',
    },
    diaDelMes: 'Day of the month',
    ultimoDia: 'Last day',
    semanaDelMes: 'Week of the month',
    ordinales: { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '5': '5th', '-1': 'Last' } as Record<string, string>,
    diaSemana: 'Weekday',
    mes: 'Month',
    dia: 'Day',
    meses: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    /** The list row of a monthly or yearly range. */
    diaN: (n: number): string => `day ${n}`,
    /** `n` counted from the end of the month: 1 is the last, 2 the second to last… */
    desdeElFinal: (n: number, cosa: string): string =>
      n === 1 ? `last ${cosa}` : n === 2 ? `second-to-last ${cosa}` : n === 3 ? `third-to-last ${cosa}` : `${n}th-to-last ${cosa}`,
    diaCosa: 'day',
    cadaMesDias: (dias: string): string => `${dias} of each month`,
    cadaMesSemana: (quien: string): string => `${quien} of each month`,
    cadaAno: (fechas: string): string => `Every year on ${fechas}`,
    fecha: (dia: number, mes: string): string => `${mes} ${dia}`,
    /** #82: holidays, closed all day whatever the ranges say (R-CAL-14). */
    festivos: 'Holidays',
    nuevoFestivo: 'Holiday date',
    festivoCadaAno: 'Every year',
    anadirFestivo: 'Add holiday',
    listaFestivos: 'Current holidays',
    festivoAnual: (mmdd: string): string => `${mmdd} (every year)`,
    quitarFestivo: (festivo: string): string => `Remove ${festivo}`,
    ayudaFestivos: 'Closed all day, whatever the ranges above say.',
  },
  /** Lote M (C3): the calendar manager of the Calendars step (`GestorCalendarios.tsx`). */
  gcal: {
    vacioTitulo: 'No calendars yet',
    vacioTexto: 'Without a calendar, resources work 24 hours every day. Start from a template:',
    desdePlantilla: 'Or from a template',
    /** Template buttons; the same text is the new calendar's name. */
    plantillas: { laborable: 'Mon–Fri 9–18', continuo: '24/7', extendido: 'Mon–Sat 6–22' },
    /** Name of a blank calendar created without typing one. */
    nombreEnBlanco: 'calendar',
    enBlancoAviso: 'A blank calendar has no hours until you paint them in Week.',
    lista: 'Calendars of the scenario',
    horasSemana: (horas: string): string => `${horas} h/wk`,
    horasPorSemana: (horas: string): string => `${horas} h per week`,
    usadoPorN: (n: number): string => `Used by ${n}`,
    sinUso: 'Not used',
    conProblemas: 'Has problems',
    nombre: 'Calendar name',
    nombreRepetido: (nombre: string): string => `A calendar named «${nombre}» already exists`,
    nombreVacio: 'The name cannot be empty',
    eliminar: 'Delete calendar',
    eliminarBloqueado: 'It cannot be deleted while something uses it (see «Used by»).',
    pestanasRotulo: 'Calendar sections',
    pestanas: { semana: 'Week', festivos: 'Holidays', repeticiones: 'Repetitions', uso: 'Used by' },
    ayudaSemana: 'Drag to paint working hours; drag over a painted hour to clear it. Keyboard: arrows, Space, and Shift+arrow to paint.',
    sinHoras: 'This calendar has no hours: whoever uses it will never work.',
    copiarLunes: 'Copy Monday to Mon–Fri',
    vaciar: 'Clear',
    ayudaRepeticiones:
      'Hours added on dates that repeat: a day of the month (or the last one), the nth weekday of the month, or a date every year.',
    nadieLoUsa: 'Nothing uses this calendar yet.',
    tiposUso: { recurso: 'Resource', turno: 'Shift', tarea: 'Task', llegada: 'Arrivals', elemento: 'Element' },
    turnoCapacidad: (n: number): string => `${n} on the shift`,
    irA: (nombre: string): string => `Go to ${nombre} in Resources`,
    asignarA: 'Assign to a resource',
    nombreEnDerivado: (nombre: string, archivo: string): string => `${archivo} already has a calendar named «${nombre}»`,
    usadoEnDerivados: (archivos: string): string => `Also named in scenarios that extend this one: ${archivos}.`,
    ahoraUsa: (nombre: string, calendario: string): string => `${nombre} (now: ${calendario})`,
    asignar: 'Assign',
    asignado: (nombre: string): string => `Assigned to ${nombre}.`,
    sinRecursos: 'There are no resources yet: create them in Resources.',
    todosAsignados: 'Every resource already uses it or has per-shift capacity (those choose a calendar per shift, in Resources).',
  },

  /* ------------------------------------------------------------------ *
   * Lote M, C2: the Resources step, master-detail (`PasoRecursos.tsx`, `FichaRecurso.tsx`)
   * ------------------------------------------------------------------ */
  recursos: {
    nuevo: '+ New resource',
    /** Prefix of the key a new resource gets: `resource-1`, `resource-2`… */
    prefijoClave: 'resource',
    vacioTitulo: 'No resources yet',
    vacioTexto:
      'Without resources every task starts as soon as a case arrives and nobody ever waits. Create one per role or piece of equipment.',
    lista: 'Resources',
    colRecurso: 'Resource · calendar',
    colCapacidad: 'Cap.',
    colCosto: (moneda: string): string => `${moneda}/h`,
    capacidadFija: (n: string): string => `×${n}`,
    turnos: (n: number): string => (n === 1 ? '1 shift' : `${n} shifts`),
    siempre: '24/7',
    porTurnos: 'by shifts',
    conErrores: (n: number): string => (n === 1 ? '1 error' : `${n} errors`),
    volver: '← Resources',
    ficha: 'Resource',
    nombre: 'Name',
    ejemploNombre: 'e.g. Supervisor',
    /** Settings → «Advanced» (#447): the key the scenario file uses, renamed with its references. */
    clave: 'Id in the scenario',
    claveMotivo: {
      vacia: 'The id cannot be empty.',
      repetida: 'Another resource already has this id.',
      heredada: 'This resource comes from the parent scenario: its id is renamed there.',
      enDerivado: 'A scenario derived from this one already has a resource with this id.',
    } as Record<string, string>,
    apartados: 'Resource sections',
    apartado: { cap: 'Capacity', cost: 'Costs', uso: 'Calendar and use' },
    capacidad: 'Capacity',
    fija: 'Fixed',
    porTurno: 'By shifts',
    unidades: 'Units available',
    capacidadCero: 'Capacity 0: the tasks of this resource will never start.',
    restar: 'Remove one unit',
    sumar: 'Add one unit',
    turnoN: (i: number): string => `Shift ${i}`,
    turnoCalendario: 'Calendar',
    turnoCapacidad: 'Units',
    quitarTurno: (i: number): string => `Remove shift ${i}`,
    anadirTurno: '+ Shift',
    ayudaTurnos: 'Each shift is a calendar with its own number of units; its hours are edited in Calendars.',
    sinCalendarios: 'There are no calendars yet: create one in Calendars to work by shifts.',
    porHora: (moneda: string): string => `Per hour (${moneda})`,
    fijoPorUso: (moneda: string): string => `Fixed per use (${moneda})`,
    costoEjemplo: (importe: string, moneda: string): string =>
      `One use of one hour with one unit costs ${importe} ${moneda}.`,
    calendario: 'Calendar',
    calendarioSiempre: 'Always available (24/7)',
    calendarioPorTurnos: 'By shifts: each shift’s calendar says when it works.',
    horasSemana: (horas: string, resumen: string): string => (resumen === '' ? `${horas} h a week` : `${horas} h a week · ${resumen}`),
    sinCalendario: 'No calendar: works 24 hours a day.',
    tipo: 'Type',
    tipos: { role: 'Person or role', equipment: 'Equipment' } as Record<string, string>,
    tareas: 'Tasks it performs',
    ningunaTarea: 'None yet.',
    cantidad: (n: number): string => `×${n}`,
    eliminar: 'Delete resource',
    eliminarUsado: (tareas: number): string =>
      `${tareas} ${tareas === 1 ? 'task uses' : 'tasks use'} this resource: ${tareas === 1 ? 'it' : 'they'} will be left pointing at nothing.`,
    eliminarConfirmar: 'Delete anyway',
    eliminarCancelar: 'Cancel',
    eliminarBloqueado: (escenarios: string): string => `It cannot be deleted: the derived scenarios ${escenarios} use it.`,
    descartarTurnos: (n: number): string =>
      `Fixed keeps only shift 1; ${n === 1 ? 'the other shift is' : `the other ${n} shifts are`} discarded.`,
    descartarConfirmar: 'Switch to fixed',
    descartarCancelar: 'Cancel',
    carrilEntero: 'Assign a whole lane',
    carrilEnteroAyuda: 'Or click a lane’s name on the canvas.',
    carrilTitulo: (carril: string, tareas: number): string =>
      `Lane «${carril}» · ${tareas} ${tareas === 1 ? 'task' : 'tasks'}`,
    carrilTituloAyuda: 'Assign all its tasks to one resource.',
    carrilSinNombre: (n: number): string => `Unnamed lane ${n}`,
    recurso: 'Resource',
    asignar: 'Assign',
    cerrarCarril: 'Close',
    carrilHecho: (tareas: number, carril: string, recurso: string): string =>
      `${tareas} ${tareas === 1 ? 'task' : 'tasks'} of «${carril}» now ${tareas === 1 ? 'uses' : 'use'} «${recurso}».`,
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
    /** `espera` carries its unit, as in the tables (`3000.56 min`, `50.01 h (3000.56 min)`). */
    cuelloDetalle: (espera: string, utilizacion: string): string =>
      ` — total wait ${espera}, utilization ${utilizacion}%`,

    avisos: 'Warnings',

    /**
     * Footnote of the Process tab (#358). `process.costPerCase` is the mean cost of the cases
     * that **completed** (`docs/RESULTS_FORMAT.md` § 5), so it is not `Total cost / Instances
     * completed`: dividing one by the other gives a third, meaningless number.
     */
    notaCostoPorCaso:
      'Cost per case is the mean cost of the cases that completed, not Total cost divided by ' +
      'Instances completed: the cost of the cases still in flight is part of Total cost and not ' +
      'of this mean.',
    /**
     * Footnote of the Resources tab (#358): the two cost readings the workbook puts side by side
     * (§ 4 and § 12) answer different questions, and neither is an estimate of the other.
     */
    notaCostoRecursos:
      'Unit cost charges only the hours the pool was actually occupied. The Payroll cost of the ' +
      'exported workbook charges availability instead — capacity × cost per hour × the open ' +
      'hours of the run, busy or idle.',
    /**
     * Footnote under the warnings when a pool reported `W-RECURSO-SATURADO` (#357). Two things the
     * warning's own text cannot say: the criterion behind it (`docs/SEMANTICS.md` § 17 — neither
     * door decides alone), and that the number it shows is read off the log of the simulated
     * horizon, not the theoretical load `λ/(μ·c)` invites. It covers both variants of the warning,
     * the one that prints the ratio and the one that prints the utilization, so it never claims
     * the number beside it is a ratio.
     */
    notaSaturacion:
      'The warning fires when attributed demand divided by what the pool served reaches 1.1, or ' +
      'its utilization reaches 90 %, and in addition the queue grows or work is left pending: ' +
      'neither number decides alone. Attributed demand counts only the instances that waited ' +
      'while the pool was full, so the number the warning shows — that ratio, or the utilization ' +
      'when it fires through that door — is observed over the simulated horizon, not the load of ' +
      'all external demand.',
    /**
     * #356/#385: results stored before 1.0.0-beta.1 carry no `n` and were computed with the
     * previous definition of the cross-replication mean — replications without an observation
     * counted as zero (`docs/RESULTS_FORMAT.md` § 8). They are never recomputed, so the reader is
     * told once, next to the warnings, instead of silently reading a mean that means something
     * different from a run made after that version. `CompareView` reuses the same sentence.
     */
    notaReplicacionesLegado:
      'Calculated before 1.0.0-beta.1: replications without observations counted as zero in the ' +
      'means.',
    /**
     * Footnote under the warnings when the run reports `W-REPLICACIONES-SIN-OBSERVACIONES`
     * (#356), the same pattern as `notaSaturacion` above: the warning's own text names the subject
     * and the count, this note explains what it means for the numbers on screen.
     */
    notaReplicacionesSinObservaciones:
      'Some replications did not observe the subject named in the warning; its statistics use ' +
      'only the replications that did (see n in the results file).',
    /** #431: every arrival fell inside the warm-up (the web's notice, not an engine `W-*`). */
    todoEnCalentamiento:
      'Every arrival fell inside the warm-up, so nothing was measured: lengthen the run or shorten the warm-up.',
  },

  /* ------------------------------------------------------------------ *
   * Simulate dock under the canvas (#394, `DockSimular.tsx`)
   * ------------------------------------------------------------------ */
  dock: {
    /** Announced (role=status) when a run lands in Results. */
    corridaTerminada: (casos: string): string => `Run finished: ${casos} completed cases.`,
    vacio: 'Simulate the scenario to see its results by task and its run log here.',
    /** «Warnings» grouped by code: the disclosure with the other occurrences. */
    ocurrencias: (n: number): string => `${n} occurrences`,
    sinLog: 'This run has no event log in memory (it was reopened from a file): run it again to see it.',
    logTruncado: (n: number): string => `The log sample stopped at ${n} rows: later events are not in it.`,
    logMostrando: (mostradas: number, total: number): string => `Showing the first ${mostradas} of ${total} rows.`,
    log: {
      caso: 'Case',
      elemento: 'Element',
      recurso: 'Resource',
      habilitada: (unidad: string): string => `Enabled (${unidad})`,
      inicio: (unidad: string): string => `Started (${unidad})`,
      fin: (unidad: string): string => `Ended (${unidad})`,
      espera: (unidad: string): string => `Wait (${unidad})`,
      costo: 'Cost',
    },
    sinAvisos: 'No warnings for this run or this scenario.',
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
    /**
     * #356/#385 QA on PR #385: the generic `sinSignificancia` above says "at least 2
     * replications are needed", which is false when the real reason is a legacy run (no `n`)
     * mixed with a new one (with `n`) — both can well have 30 replications each. `CompareView`
     * picks this text instead of `sinSignificancia` when `compareWarnings().mixedReplicationDefinitions`
     * is the actual reason `significanceAvailable` is `false`.
     */
    sinSignificanciaMixtas:
      'Significance is not shown: the compared runs use different replication statistics (one ' +
      'was calculated before 1.0.0-beta.1).',
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
    /**
     * #356/#385: a legacy run (stored before 1.0.0-beta.1, no `n`) compared against a new one
     * (with `n`) can mark a false "significant" difference — `compare()` subtracts the raw
     * numbers without knowing they come from two different definitions. Comparing two legacy
     * runs against each other is not this case (same definition on both sides).
     */
    avisoReplicacionesMixtas:
      'The compared runs use different replication statistics (one was calculated before ' +
      '1.0.0-beta.1); significance marks are not shown.',
    avisoSemillas: (semillas: readonly number[]): string =>
      `Different seeds between runs (${semillas.join(' vs ')}): the runs do not share the same ` +
      'random sequence.',
    avisoReplicas: (replicas: readonly number[]): string =>
      `Different number of replications between runs (${replicas.join(' vs ')}).`,
  },

  /* ------------------------------------------------------------------ *
   * Charts of Results and Compare (#460, `GraficasSvg.tsx`)
   * ------------------------------------------------------------------ */
  graficas: {
    /** The chart's `<desc>` and alt text: every value, since the table is the source. */
    valor: (etiqueta: string, texto: string): string => `${etiqueta}: ${texto}`,
    sinDatos: 'No data to chart.',
    utilizacion: 'Utilization by resource (%)',
    instancias: 'Instances started by task',
    percentiles: (unidad: string): string => `Cycle and wait time percentiles (${unidad})`,
    ciclo: 'Cycle time',
    espera: 'Wait time',
    sinCompletados: 'No case completed, so cycle and wait time have no value to chart.',
    histograma: (unidad: string): string => `Cycle time per case (${unidad})`,
    histogramaSub: (casos: number, replicas: number): string =>
      replicas > 1
        ? `${casos} completed cases of replication 1 of ${replicas}`
        : `${casos} completed cases`,
    histogramaSinLog: 'The cycle time histogram needs this run’s per-case times, which are kept in memory only: run the scenario again to see it.',
    sinVentana: 'Every arrival fell inside the warm-up, so nothing was measured to chart.',
    error: 'This chart could not be drawn. The table has the values.',
    histogramaSinCasos: 'No case of replication 1 completed: there is no cycle time to distribute.',
    clase: (desde: string, hasta: string): string => `${desde} to ${hasta}`,
    casos: (n: number): string => (n === 1 ? '1 case' : `${n} cases`),
    ejeCasos: 'Cases',
    verDatos: 'Histogram data',
    columnaClase: (unidad: string): string => `Cycle time (${unidad})`,
    columnaCasos: 'Cases',
    comparar: 'Charts',
    compararCiclo: (unidad: string): string => `Cycle time average by scenario (${unidad})`,
    compararCosto: 'Cost per case by scenario',
    compararUtilizacion: 'Utilization by resource and scenario (%)',
    compararCostoNoComparable: 'Cost per case is not charted: the scenarios use different currencies.',
    compararDemasiados: (n: number): string => `Only the first 8 of the ${n} visible scenarios are charted; the tables show them all.`,
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
    /** Context pad entries of a lane (#580). */
    moverCarrilArriba: 'Move lane up',
    moverCarrilAbajo: 'Move lane down',

    /** Floating label of the bottleneck overlay (#226): short above, complete in the `title`. */
    cuelloEtiqueta: (espera: string, utilizacion: number): string => `${espera} · ${utilizacion}%`,
    /** `espera` carries its unit, as in the tables. */
    cuelloTitulo: (espera: string, utilizacion: string): string =>
      `mean wait ${espera} · utilization ${utilizacion}%`,
    /** Short unit for the label; the `title` uses the scenario code. */
    unidadesCortas: { day: 'd', h: 'h', min: 'min', s: 's' },

    /** Validation marker: the disc and its native tooltip. */
    marcadorSimbolo: '!',
    /** The two keys come from the shortcut map (`atajos.ts`), formatted for the platform. */
    marcadorAcciones: (renombrar: string, panel: string): string => `${renombrar} rename · ${panel} properties`,
    marcadorTitulo: (mensajes: readonly string[], acciones: string): string =>
      `${mensajes.join('\n')}\n${acciones}`,
  },

  /* ------------------------------------------------------------------ *
   * Routes step and the canvas percentage fields (Lote M, C4: `PasoRutas.tsx`,
   * `etiquetasPorcentaje.ts`, the gateway block of the properties panel)
   * ------------------------------------------------------------------ */
  rutas: {
    cajaTitulo: (flujo: string, destino: string): string => `${flujo} → ${destino}`,
    campoLienzo: (flujo: string, compuerta: string): string => `Percentage of flow «${flujo}» of «${compuerta}»`,
    porciento: (n: number): string => `${n} %`,
    resto: (n: number): string => `rest ${n} %`,
    listaTitulo: 'Gateways',
    listaVacia: 'This process has no gateway that splits cases between two or more exits. Add an exclusive or inclusive gateway in Model to give it percentages.',
    listaAyuda: 'Percentages are also edited on the canvas, on the label of each flow.',
    volver: '← Gateways',
    flujosSalientes: 'Outgoing flows',
    tipoXor: 'Exclusive: each case takes a single exit',
    tipoOr: 'Inclusive: each exit is taken on its own',
    barraAria: (reparto: string, suma: number): string => `Split: ${reparto}. Adds up to ${suma} %`,
    porcentajeDe: (flujo: string): string => `Percentage of «${flujo}»`,
    haciaDestino: (destino: string): string => `→ ${destino}`,
    porDefecto: 'Default flow: takes the rest',
    suma100: 'Adds up to 100 %',
    listo: 'Ready to simulate.',
    sumaMal: (suma: number, diferencia: number): string =>
      `Adds up to ${suma} %: ${diferencia > 0 ? `${diferencia} points missing` : `${-diferencia} points over`}`,
    sumaMalCuerpo: 'The simulation will scale the split to 100 % and warn about it.',
    sumaCero: 'Every exit is at 0 %: no case can leave this gateway.',
    arreglo: (flujo: string, porcentaje: number): string => `Set «${flujo}» to ${porcentaje} %`,
    repartirIgual: 'Split evenly',
    notaTeclas: '↑/↓ adds or takes 5 %. On an inclusive gateway each exit has its own probability and they do not need to add up to 100 %.',
    union: 'Join gateway: it merges paths and does not split cases. It takes no parameters.',
    sumaPildora: (suma: number): string => `${suma} %`,
    propiedadesTitulo: 'Route split',
    invalido: 'Write a number from 0 to 100.',
    editarReparto: 'Edit the route split',
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

  /** The processes of a repository (ADR-029, #498): the canvas tabs and their dialogs. */
  procesos: {
    nuevo: 'New process',
    tituloNuevo: 'New process in this project',
    tituloRenombrar: 'Rename process',
    nombre: 'Process name',
    /** Suggested name of the process the «+» creates: «Process 2», «Process 3»… */
    nombrePorDefecto: (n: number): string => `Process ${n}`,
    crear: 'Create',
    renombrar: 'Rename',
    renombrarProceso: (nombre: string): string => `Rename process ${nombre}`,
    borrar: 'Delete',
    borrarProceso: (nombre: string): string => `Delete process ${nombre}`,
    tituloBorrar: 'Delete process',
    confirmarBorrar: (nombre: string): string =>
      `Delete «${nombre}» with its scenarios and runs? The other processes of the project stay.`,
    /** Breadcrumb back from a called process (#461). */
    volverA: (nombre: string): string => `Back to ${nombre}`,
    /** Double-click on a call activity whose `calledElement` is not a process here (#461). */
    llamadaSinResolver: (destino: string): string =>
      `The call activity calls «${destino}», which is not a process of this project.`,
    llamadaSinDestino: 'This call activity does not name the process it calls.',
    llamadaMismoProceso: 'This call activity calls the process it is in.',
  },

  almacen: {
    errorSinBridge: 'DesktopStore requires `window.lila`: is it being instantiated outside Electron?',
    errorProyectoDistinto:
      'E-PROYECTO-DISTINTO: the document to save is not the active project; use "Save as" ' +
      'to write it into a new folder.',
    /** «Save as» of a loose diagram over the folder that already is its project (LILA-208). */
    errorMismaCarpeta:
      'This folder already has its model.bpmn; to turn the loose diagram into a project pick another folder.',
    /** #539: re-reading the open project after an outside change failed; `codigo` is the disk's code. */
    errorRecarga: (ruta: string, codigo: string): string =>
      `${codigo}: ${ruta} changed outside Lila but could not be read back; what is on screen is unchanged.`,
    /** `E-ARCHIVO-OCUPADO` from the disk (#466): another program holds the `.lila`'s lock. */
    errorArchivoOcupado: (ruta: string): string =>
      `E-ARCHIVO-OCUPADO: another program is saving ${ruta} right now, so nothing was saved. ` +
      'Try again in a moment.',
    /** `E-CAMBIO-EXTERNO` from the disk (#539): `nombre` changed outside Lila since it was last read. */
    errorCambioExterno: (nombre: string): string =>
      `E-CAMBIO-EXTERNO: ${nombre} changed outside Lila since it was opened, so nothing was saved. ` +
      'Reload to get the other version, or use Save As to keep yours in another file.',
    /** `E-CARPETA-OCUPADA` from the disk (#517): `ruta` holds another project's files. */
    errorCarpetaOcupada: (ruta: string): string =>
      `E-CARPETA-OCUPADA: ${ruta} holds files of another project or process, and saving would ` +
      `overwrite them. Choose another destination or move ${ruta} out of the way.`,
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
   * Lote M, C1: the guided Simulate panel — numbered steps, «▶ Simulate», the step banner,
   * the selection header and the canvas labels of the step (`etiquetasPaso.ts`).
   * ------------------------------------------------------------------ */
  pasosSim: {
    simular: 'Simulate',
    /** Badge of «▶ Simulate»: problems that hold the run back. */
    insignia: (n: number): string => `${n} ${n === 1 ? 'problem' : 'problems'} to fix`,
    noSePuede: (n: number): string =>
      `Cannot simulate: ${n} ${n === 1 ? 'problem' : 'problems'} to fix. Taking you to the first one.`,
    pasoDe: (n: number, total: number, escenario: string): string => `Step ${n} of ${total} · ${escenario}`,
    /** The question each step answers: its heading, and the tab's tooltip. */
    titulos: {
      arrivals: 'When cases come in',
      times: 'How long each task takes',
      routes: 'Which share follows each path',
      resources: 'Who does each task',
      calendars: 'When each resource works',
      run: 'Horizon and replications',
    } as Record<string, string>,
    tabTitulo: (titulo: string, tecla: string): string => `${titulo} (${tecla})`,
    sinProblemas: 'no problems',
    bannerUno: 'One problem in this step',
    bannerVarios: (n: number): string => `${n} problems in this step`,
    sinPaso: 'Problems outside the steps',
    ir: 'Go',
    /** Selection header: the element, its kind, and that only this step's fields are shown. */
    soloEstePaso: (tipo: string): string => `${tipo} · only this step`,
    verTodo: 'Show all',
    verTodoTitulo: 'Clear the selection (Esc)',
    nada: (tipo: string, paso: string): string => `${tipo} without parameters in ${paso}.`,
    consejos: {
      task: 'A task is set in Times, Resources and Calendars.',
      start: 'A start event is set in Arrivals.',
      gateway: 'Its percentages are edited in Routes.',
      flow: 'A flow is edited in Routes, from its gateway.',
      end: 'End events have no parameters: they only count the cases that finish.',
      otro: 'Nothing to set here.',
    } as Record<string, string>,
    irA: (paso: string): string => `Go to ${paso}`,
    anterior: (paso: string): string => `← ${paso}`,
    siguiente: (paso: string): string => `${paso} →`,
    /** Arrivals */
    inicioDe: (nombre: string): string => `Start event · ${nombre}`,
    patron: 'Arrival pattern',
    limites: 'Limits',
    tasaHora: (porHora: string): string => `≈ ${porHora} per hour · around the clock`,
    tasaSemana: (porHora: string, porSemana: string, calendario: string): string =>
      `≈ ${porHora} per hour · ≈ ${porSemana} per week within «${calendario}»`,
    tasaSinMedia: 'Enter a mean above 0 to see the arrival rate.',
    soloDentro: 'Only arrive within',
    siempre: 'Always (24/7)',
    limitesAyuda: 'Leave the maximum empty for cases to keep arriving for the whole horizon.',
    /** Times */
    duracionMedia: 'Mean duration',
    sinDuracion: 'No duration',
    faltaDuracion: 'Missing duration: without one this task takes no time.',
    /** Run */
    horizonte: 'Horizon',
    replicas: 'Replications',
    avanzado: 'Advanced',
    calentamientoAyuda: 'Cases of the warmup do not count, so the process is measured once it is running.',
    replicasAyuda: '30 replications are usually enough. With the same seed, the same scenario always gives the same result.',
    confianza: 'Results report a 95 % confidence interval.',
    /** Canvas labels under each element (`etiquetasPaso.ts`). */
    etiquetas: {
      sinDuracion: 'No duration',
      sinRecurso: 'No resource',
      siempre: '24 h',
      cada: (tiempo: string): string => `every ${tiempo}`,
    },
    entradas: (n: number): string => `Entries of this scenario (${n})`,
    masAcciones: 'More',
  },

  /* ------------------------------------------------------------------ *
   * Shortcut map (`atajos.ts`, #413): one label per entry id, and one title per group. The keys
   * themselves are not text: `etiqueta()` formats them per platform.
   * ------------------------------------------------------------------ */
  atajos: {
    grupos: {
      archivo: 'File',
      buscar: 'Search',
      modos: 'Modes',
      simulacion: 'Simulation',
      lienzo: 'Canvas',
      paneles: 'Panels',
    },
    nuevo: 'New project',
    abrir: 'Open project',
    guardar: 'Save project',
    guardarComo: 'Save as',
    imprimir: 'Print the diagram',
    ajustes: 'Settings',
    paleta: 'Command palette',
    'modo:modelar': 'Model',
    'modo:simular': 'Simulate',
    'modo:resultados': 'Results',
    ejecutar: 'Run simulation',
    cancelar: 'Cancel the run',
    'paso:arrivals': 'Step 1: Arrivals',
    'paso:times': 'Step 2: Times',
    'paso:routes': 'Step 3: Routes',
    'paso:resources': 'Step 4: Resources',
    'paso:calendars': 'Step 5: Calendars',
    'paso:run': 'Step 6: Run',
    reproducir: 'Play or pause the tokens (Results)',
    zoomMas: 'Zoom in',
    zoomMenos: 'Zoom out',
    ajustarVista: 'Fit the diagram',
    renombrar: 'Rename the selected element',
    deshacer: 'Undo',
    rehacer: 'Redo',
    borrar: 'Delete the selection',
    seleccionarTodo: 'Select all',
    copiar: 'Copy',
    pegar: 'Paste',
    lazo: 'Lasso tool',
    mano: 'Hand tool',
    conectar: 'Connect tool',
    editarEtiqueta: 'Edit the label',
    reemplazar: 'Replace the element',
    alinearIzquierda: 'Align left',
    alinearCentro: 'Align center',
    alinearDerecha: 'Align right',
    alinearArriba: 'Align top',
    alinearMedio: 'Align middle',
    alinearAbajo: 'Align bottom',
    distribuirHorizontal: 'Distribute horizontally',
    distribuirVertical: 'Distribute vertically',
    izquierda: 'Show or hide the left column',
    derecha: 'Show or hide the right panel',
    diagramas: 'Show or hide the diagram tabs',
    estado: 'Show or hide the status bar',
    irModos: 'Move the focus to the modes',
    irPanel: 'Move the focus to the right panel',
    dock: 'Show or hide the results table',
  },

  /* ------------------------------------------------------------------ *
   * Extended attributes (#509)
   * ------------------------------------------------------------------ */
  atributos: {
    titulo: 'Extended attributes',
    deProceso: 'Process attributes',
    definir: 'Define attributes…',
    ninguno: (tipo: string): string => `No attributes are defined for ${tipo} yet.`,
    categorias: {
      task: 'tasks',
      gateway: 'gateways',
      event: 'events',
      subProcess: 'sub-processes',
      lane: 'pools and lanes',
      process: 'the process',
    },
    tipos: { text: 'Text', number: 'Number', list: 'List', date: 'Date' },
    sinValor: '—',
    porDefecto: (valor: string): string => `Default: ${valor}`,
    noEsOpcion: (valor: string): string => `${valor} (not an option)`,
    problemas: {
      number: 'Not a number. Use digits, with a dot for decimals (for example 4.5).',
      date: 'Not a date. Use year-month-day (for example 2026-09-28).',
      option: 'Not one of the list\'s options.',
    },
    huerfano: (ref: string): string => `${ref} (no definition)`,
    quitarHuerfano: (ref: string): string => `Remove the value of ${ref}`,
    dialogo: 'Define extended attributes',
    paraTipo: 'Element type',
    nombre: (n: number): string => `Name ${n}`,
    tipo: (n: number): string => `Type ${n}`,
    opciones: (n: number): string => `Options ${n}`,
    valorPorDefecto: (n: number): string => `Default ${n}`,
    quitar: (n: number): string => `Remove attribute ${n}`,
    anadir: 'Add attribute',
    guardar: 'Save',
    cancelar: 'Cancel',
    volver: 'Back',
    aplicar: 'Apply',
    errores: {
      nombre: 'Every attribute needs a name.',
      repetido: (nombre: string): string => `Two attributes are called ${nombre}.`,
      opciones: (nombre: string): string => `The list ${nombre} needs at least one option.`,
      porDefecto: (nombre: string): string => `The default of ${nombre} does not fit its type.`,
    },
    confirmarTitulo: 'Existing values',
    confirmarTexto: 'These changes touch attributes that elements already have values for. Choose what to do with them.',
    renombrado: (antes: string, ahora: string): string => `${antes} is renamed to ${ahora}.`,
    cambiaTipo: (antes: string, ahora: string): string => `Its type changes from ${antes} to ${ahora}.`,
    opcionesQuitadas: (opciones: string): string => `Options removed: ${opciones}.`,
    conValores: (n: number, invalidos: number): string =>
      `${n} ${n === 1 ? 'element has' : 'elements have'} a value` +
      (invalidos === 0 ? ', and every one still fits.' : `; ${invalidos} no longer ${invalidos === 1 ? 'fits' : 'fit'}.`),
    limpiar: (n: number): string => `Clear the ${n} ${n === 1 ? 'value that no longer fits' : 'values that no longer fit'}`,
    repetidas: (n: number): string =>
      `${n} repeated ${n === 1 ? 'definition is' : 'definitions are'} ignored (the same attribute twice, for example after pasting a pool). Saving the definitions keeps one of each.`,
    varios: (n: number, valores: string): string => `This element has ${n} values for this attribute (${valores}); the field edits the first.`,
    sinReferencia: 'Attribute without a reference',
    atributoN: (n: number): string => `Attribute ${n}`,
    etiquetas: { nombre: 'Name', tipo: 'Type', opciones: 'Options, one per line', porDefecto: 'Default value' },
    conservar: 'Keep the values',
    borrado: (nombre: string, n: number): string =>
      `${nombre} is deleted together with its ${n} ${n === 1 ? 'value' : 'values'}.`,
  },

  /* ------------------------------------------------------------------ *
   * Development demo pages (`*-demo.tsx`, outside the bundle)
   * ------------------------------------------------------------------ */
  demos: {
    cargando: 'Loading examples/pedido…',
    tituloResultados: 'Lila Modeler · Results (LILA-062 demo)',
    tituloComparar: 'Lila Modeler · Compare (LILA-063 demo)',
  },
  /* ------------------------------------------------------------------ *
   * Lote M, workstream C5: results on the map, compare inside Results, the scenario dropdown that
   * replaced the rail, and the results table that replaced the dock.
   * ------------------------------------------------------------------ */
  c5: {
    escenario: {
      rotulo: 'Scenario',
      base: 'Base',
      titulo: 'Choose, duplicate, rename or save the scenario',
      lista: 'Scenarios of the process',
      simulado: 'Simulated',
      sinSimular: 'Not simulated',
      enVentana: 'In the detached window',
      hereda: (padre: string): string => `Extends ${padre}`,
      heredaDe: 'Extends',
      ninguno: 'Nothing (base scenario)',
      guardar: 'Save project',
      duplicar: 'Duplicate',
      duplicarTitulo: 'Duplicate the active scenario; the copy extends it and can be renamed right away',
      renombrar: 'Rename',
      nombre: 'Scenario name',
      nombreAyuda: 'Enter keeps the name, Esc leaves it as it was',
      problemas: 'Problems of the scenario',
    },
    resultados: {
      barra: 'Results toolbar',
      meta: (replicas: number, semilla: string, unidad: string): string => `${replicas} ${replicas === 1 ? 'replication' : 'replications'} · seed ${semilla} · unit ${unidad}`,
      capas: 'Layers on the map',
      mapaCalor: 'Heat map',
      tokens: 'Tokens',
      compararCon: 'Compare with…',
      compararTitulo: 'Compare this scenario with another one; a scenario without results is simulated when you pick it',
      seSimulara: 'Not simulated · simulated when picked',
      sinOtros: 'There is no other scenario: duplicate this one first.',
      vacioKicker: 'No results',
      vacioTitulo: (nombre: string): string => `You have not simulated «${nombre}» yet`,
      vacioTexto: 'Press Simulate: the diagram stays here and shows the waits, the bottlenecks and the cases moving over it.',
      simularAhora: 'Simulate now',
      corriendo: 'Simulating…',
      errorKicker: 'The simulation stopped',
      errorTitulo: (n: number): string => (n === 1 ? '1 problem to fix' : `${n} problems to fix`),
      irAlPrimero: 'Go to the first one',
      reintentar: 'Retry',
      resumen: 'Summary',
      kpis: {
        ciclo: 'Cycle time',
        espera: 'Wait per case',
        completados: 'Completed cases',
        costoCaso: 'Cost per case',
        utilMax: 'Max. utilization',
        enCurso: 'In progress at the end',
      },
      kpiTitulos: {
        ciclo: 'Mean time from arrival to end, over every replication',
        espera: 'Mean time a case spent waiting for resources',
        completados: 'Cases that reached an end event, mean over the replications',
        costoCaso: 'Total cost divided by completed cases',
        utilMax: 'Utilization of the busiest resource',
        enCurso: 'Cases still in the process when the run ended (in a queue or being worked on)',
      },
      ic95: (desde: string, hasta: string): string => `95 % confidence interval ${desde} – ${hasta}`,
      cuellos: 'Bottlenecks',
      cuellosNota: 'The engine’s ranking: total wait for resources, then utilization.',
      tarea: 'Selected task',
      sinSeleccion: 'Pick a task on the map or in the table to see its detail.',
      casos: 'Cases',
      proceso: 'Mean processing',
      espera: 'Mean wait',
      utilizacion: 'Utilization',
      consejoCuello: 'It is in the engine’s bottleneck ranking: more capacity for its resource, or less work routed to it, shortens the wait.',
      consejoSinEspera: 'It barely waits: its resource is not what holds the cases back.',
      enVentana: 'The results are in another window.',
    },
    tabla: {
      region: 'Results table',
      vistas: 'Results table views',
      titulo: 'Results by task',
      sub: (replicas: number): string => `mean of ${replicas} ${replicas === 1 ? 'replication' : 'replications'} · durations in hours (minutes)`,
      plegar: 'Collapse the results table',
      desplegar: 'Expand the results table',
      redimensionar: 'Resize the results table',
      pestanas: { tareas: 'Tasks', detalle: 'Full results', log: 'Run log', avisos: 'Warnings' },
      columnas: {
        tarea: 'Task',
        recurso: 'Resource',
        casos: 'Cases',
        proceso: 'Mean processing',
        espera: 'Mean wait',
        utilizacion: 'Utilization',
        costo: 'Total cost',
      },
      utilizacionTitulo: 'Utilization of the busiest resource the task uses',
      costoTitulo: 'The task’s fixed cost over the run; resource costs are in Full results → Resources',
      nadie: 'Nobody',
      notaCosto: 'Total cost per task is the task’s own fixed cost. What the resources cost is in Full results → Resources.',
      exportarCsv: 'CSV',
      exportarCsvTitulo: 'Download the elements table (elements.csv)',
      exportarXlsx: 'XLSX',
      exportarXlsxTitulo: 'Download the workbook with every table',
    },
    tiempo: {
      barra: 'Token replay',
      reproducir: 'Play the tokens (Space)',
      pausar: 'Pause the tokens (Space)',
      reiniciar: 'Back to the start',
      velocidad: 'Speed',
      posicion: 'Simulated time',
      leyenda: 'Tint: wait compared with the task’s own processing time',
      niveles: { low: 'little wait', mid: 'comparable', high: 'waits longer than it works' },
      truncadoCorto: (filas: number): string => `Partial replay: first ${filas} log rows`,
      ocupacion: (recurso: string, ocupados: number, capacidad: number): string => `${recurso} ${ocupados}/${capacidad}`,
    },
    mapa: {
      espera: (t: string): string => `Wait ${t}`,
      esperaTitulo: (t: string): string => `Mean resource wait ${t}`,
      cuello: 'BOTTLENECK',
    },
    comparar: {
      comparando: 'Comparing',
      intercambiar: 'Swap sides',
      elegir: 'Choose scenario',
      leyenda: 'green = better · red = worse · ▲▼ up or down',
      cerrar: 'Close comparison',
      referencia: 'Reference',
      mapaDe: (nombre: string): string => `Map of ${nombre}`,
      mapaSub: 'heat by wait',
      mapaDeltaSub: 'difference in wait per task',
      valorRef: (nombre: string, valor: string): string => `${nombre}: ${valor}`,
      mejora: 'better',
      empeora: 'worse',
      igual: 'no change',
      deltaTitulo: (t: string): string => `Mean wait ${t} against the reference`,
      simulandoKicker: 'Simulating',
      simulando: (nombre: string): string => `Simulating «${nombre}»…`,
      simulandoTexto: 'It had no results yet; it runs with its own seed and replications.',
      canceladaKicker: 'Cancelled',
      cancelada: (nombre: string): string => `The run of «${nombre}» was cancelled`,
      canceladaTexto: 'The comparison waits until you run it again.',
      errorKicker: 'Could not simulate',
      errorTitulo: (nombre: string): string => `«${nombre}» has problems`,
      corregir: 'Fix it in Simulate',
      elegirOtro: 'Choose another scenario',
      vacioKicker: 'Compare',
      vacioTitulo: 'You need a second scenario',
      vacioTexto: 'Duplicate this one, change what you want to try and compare both.',
      duplicarComo: (nombre: string): string => `Duplicate ${nombre}`,
      detalle: 'Comparison tables and charts',
      sinMapa: 'The maps could not be drawn here. The tables below have every number.',
    },
    validarRutas: 'Validate paths',
    validarRutasTitulo: 'Walk tokens through the routes (Model only; not the simulation)',
    compararConEscenario: (nombre: string): string => `Compare with ${nombre}`,
  },
} as const;
